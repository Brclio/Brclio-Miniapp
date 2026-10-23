'use strict';

const { SONGS } = require('../data/nursery-songs');

const STORAGE_KEY = 'brclio.nursery-music.v1';
const MODES = Object.freeze(['sequence', 'shuffle', 'repeat-one']);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function createNurseryAudio(options) {
  const opts = options || {};
  const platform = opts.wx || (typeof wx !== 'undefined' ? wx : {});
  const songs = opts.songs || SONGS;
  const byId = new Map(songs.map(song => [String(song.id), song]));
  const now = opts.now || Date.now;
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;
  const random = opts.random || Math.random;
  const listeners = new Set();
  const bindings = [];
  let context = null;
  let loadedSongId = '';
  let shouldPlay = false;
  let disposed = false;
  let sleepDeadline = 0;
  let sleepTimer = null;
  let pendingSeek = null;
  let lastSavedTime = 0;
  const history = [];
  const state = {
    status: 'idle', error: '', currentSong: null, currentTime: 0, duration: 0,
    mode: 'sequence', favorites: [], queue: songs.map(song => String(song.id)),
    sleepRemaining: 0, sleepMinutes: 0, storageNotice: '',
    audioBackend: typeof platform.getBackgroundAudioManager === 'function' ? 'background'
      : typeof platform.createInnerAudioContext === 'function' ? 'inner' : 'unavailable'
  };

  function knownIds(ids) {
    return Array.isArray(ids) ? Array.from(new Set(ids.map(String).filter(id => byId.has(id)))) : [];
  }

  try {
    let saved = platform.getStorageSync ? platform.getStorageSync(STORAGE_KEY) : null;
    if (typeof saved === 'string' && saved) saved = JSON.parse(saved);
    if (saved && saved.version === 1) {
      state.favorites = knownIds(saved.favorites);
      if (MODES.includes(saved.mode)) state.mode = saved.mode;
      const recent = saved.recent && byId.get(String(saved.recent.id));
      if (recent) {
        state.currentSong = recent;
        state.duration = finiteNumber(recent.duration, 0);
        state.currentTime = Math.min(finiteNumber(saved.recent.time, 0), state.duration || Infinity);
      }
    }
  } catch (_) {
    state.storageNotice = '上次的收藏与进度暂时无法读取。';
  }

  function snapshot() {
    return Object.assign({}, state, {
      currentSong: state.currentSong ? Object.assign({}, state.currentSong) : null,
      favorites: state.favorites.slice(), queue: state.queue.slice()
    });
  }

  function emit() {
    if (disposed) return;
    const value = snapshot();
    listeners.forEach(listener => {
      // A detached or failing page must not break native audio callbacks.
      try { listener(value); } catch (_) { /* subscriber owns its rendering errors */ }
    });
  }

  function persist() {
    if (typeof platform.setStorageSync !== 'function') return;
    lastSavedTime = now();
    try {
      platform.setStorageSync(STORAGE_KEY, {
        version: 1, favorites: state.favorites.slice(), mode: state.mode,
        recent: state.currentSong ? { id: String(state.currentSong.id), time: state.currentTime } : null
      });
      state.storageNotice = '';
    } catch (_) {
      state.storageNotice = '收藏与进度暂未保存，退出后可能丢失。';
    }
  }

  function ownsAudio(allowReleasedSource) {
    return context && state.currentSong && loadedSongId === String(state.currentSong.id)
      && (context.src === state.currentSong.url || allowReleasedSource && !context.src);
  }

  function readProgress() {
    if (!ownsAudio()) return;
    state.duration = finiteNumber(context.duration, 0) || finiteNumber(state.currentSong.duration, 0);
    state.currentTime = Math.min(finiteNumber(context.currentTime, state.currentTime), state.duration || Infinity);
  }

  function fail(message) {
    shouldPlay = false;
    state.status = 'error';
    state.error = message;
    persist();
    emit();
    return false;
  }

  function audioError(error) {
    if (!ownsAudio(true)) return;
    const code = Number(error && error.errCode);
    const details = code ? '（' + code + '）' : '';
    fail('音乐暂时无法播放' + details + '，请检查网络后点击重试。');
  }

  function bind(event, handler) {
    const on = context['on' + event];
    if (typeof on === 'function') {
      on.call(context, handler);
      bindings.push({ event, handler });
    }
  }

  function checkSleep() {
    if (!sleepDeadline || disposed) return false;
    state.sleepRemaining = Math.max(0, Math.ceil((sleepDeadline - now()) / 1000));
    if (state.sleepRemaining > 0) return false;
    sleepDeadline = 0;
    state.sleepMinutes = 0;
    if (sleepTimer !== null) cancel(sleepTimer);
    sleepTimer = null;
    pause();
    return true;
  }

  function ensureContext() {
    if (context) return true;
    if (disposed) return false;
    if (state.audioBackend === 'background') {
      try { context = platform.getBackgroundAudioManager(); } catch (_) { context = null; }
    }
    if (!context && typeof platform.createInnerAudioContext === 'function') {
      try {
        context = platform.createInnerAudioContext();
        state.audioBackend = 'inner';
        context.autoplay = false;
        context.obeyMuteSwitch = false;
      } catch (_) { context = null; }
    }
    if (!context) {
      state.audioBackend = 'unavailable';
      return fail('当前微信暂不支持音乐播放，请更新微信后重试。');
    }
    bind('Play', () => {
      if (!ownsAudio()) return;
      if (checkSleep()) return;
      shouldPlay = true;
      state.status = 'playing'; state.error = '';
      readProgress(); persist(); emit();
    });
    bind('Pause', () => {
      if (!ownsAudio()) return;
      shouldPlay = false;
      readProgress(); state.status = 'paused'; persist(); emit();
    });
    bind('Stop', () => {
      if (!ownsAudio(true)) return;
      shouldPlay = false;
      state.status = 'paused'; state.currentTime = 0;
      // WeChat releases the background source after Stop; assigning src is needed to replay.
      loadedSongId = ''; persist(); emit();
    });
    bind('Waiting', () => {
      if (ownsAudio() && shouldPlay) { state.status = 'loading'; emit(); }
    });
    bind('Canplay', () => {
      if (!ownsAudio()) return;
      readProgress();
      if (pendingSeek !== null) {
        const target = pendingSeek; pendingSeek = null;
        try {
          if (typeof context.seek === 'function') context.seek(target);
          state.currentTime = Math.min(target, state.duration || Infinity);
        } catch (_) { /* startTime also requests this position */ }
      }
      emit();
    });
    bind('TimeUpdate', () => {
      if (!ownsAudio()) return;
      readProgress();
      if (checkSleep()) return;
      if (now() - lastSavedTime >= 5000) persist();
      emit();
    });
    bind('Seeked', () => { if (ownsAudio()) { readProgress(); persist(); emit(); } });
    bind('Ended', () => {
      if (!ownsAudio(true)) return;
      shouldPlay = false;
      state.currentTime = 0;
      if (checkSleep()) return;
      if (state.mode === 'repeat-one') startSong(state.currentSong, true);
      else advance(1);
    });
    bind('Error', audioError);
    bind('Next', () => next());
    bind('Prev', () => previous());
    return true;
  }

  function setQueue(queue, selectedId) {
    if (Array.isArray(queue)) state.queue = knownIds(queue);
    if (!state.queue.length) state.queue = selectedId ? [selectedId] : songs.map(song => String(song.id));
    if (selectedId && !state.queue.includes(selectedId)) state.queue.unshift(selectedId);
  }

  // Selection deliberately never assigns src: BackgroundAudioManager auto-plays new src values.
  function select(songId, settings) {
    if (disposed) return false;
    const song = byId.get(String(songId));
    if (!song) return false;
    const changed = !state.currentSong || String(state.currentSong.id) !== String(song.id);
    setQueue(settings && settings.queue, String(song.id));
    if (changed) {
      shouldPlay = false;
      loadedSongId = '';
      if (context && typeof context.pause === 'function') {
        try { context.pause(); } catch (_) { /* selection remains usable when native audio fails */ }
      }
      state.currentSong = song;
      state.currentTime = 0;
      state.duration = finiteNumber(song.duration, 0);
      state.status = 'idle'; state.error = ''; pendingSeek = null;
      history.length = 0;
    }
    persist(); emit();
    return true;
  }

  function startSong(song, restart) {
    if (!song || !ensureContext()) return false;
    const sameSource = ownsAudio();
    shouldPlay = true;
    state.status = 'loading'; state.error = '';
    if (restart) state.currentTime = 0;
    emit();
    try {
      if (sameSource && !restart) context.play();
      else {
        context.title = song.title;
        context.singer = song.artist || '儿歌多多';
        context.epname = 'Brclio · 育儿音乐';
        context.coverImgUrl = song.coverUrl || '';
        context.startTime = state.currentTime;
        pendingSeek = state.currentTime > 0 ? state.currentTime : null;
        loadedSongId = String(song.id);
        context.src = song.url;
        if (state.audioBackend === 'inner') context.play();
      }
      persist();
      return true;
    } catch (_) {
      return fail('音乐暂时无法播放，请检查网络后点击重试。');
    }
  }

  function play(songId, settings) {
    if (disposed) return false;
    if (songId !== undefined && songId !== null && !select(songId, settings)) return false;
    else if (settings && settings.queue) setQueue(settings.queue, state.currentSong && String(state.currentSong.id));
    if (!state.currentSong && !select(state.queue[0] || (songs[0] && songs[0].id))) return false;
    // After an error, reassigning src forces WeChat to retry a failed network load.
    return startSong(state.currentSong, state.status === 'error' || state.currentTime >= state.duration && state.duration > 0);
  }

  function pause() {
    if (disposed) return false;
    shouldPlay = false;
    readProgress();
    try { if (context && typeof context.pause === 'function') context.pause(); } catch (_) { /* update UI even if the native callback is unavailable */ }
    state.status = state.currentSong ? 'paused' : 'idle';
    persist(); emit();
    return true;
  }

  function advance(direction) {
    if (disposed || !state.queue.length) return false;
    const currentId = state.currentSong && String(state.currentSong.id);
    let id;
    if (state.mode === 'shuffle' && direction < 0 && history.length) id = history.pop();
    else if (state.mode === 'shuffle' && state.queue.length > 1) {
      const choices = state.queue.filter(candidate => candidate !== currentId);
      const value = Math.min(0.999999999, Math.max(0, finiteNumber(random(), 0)));
      id = choices[Math.floor(value * choices.length)];
    } else {
      const currentIndex = state.queue.indexOf(currentId);
      id = currentIndex < 0 ? state.queue[direction < 0 ? state.queue.length - 1 : 0]
        : state.queue[(currentIndex + direction + state.queue.length) % state.queue.length];
    }
    const previousHistory = history.slice();
    if (currentId && direction > 0) previousHistory.push(currentId);
    if (!select(id, { queue: state.queue })) return false;
    history.push(...previousHistory.slice(-100));
    return startSong(state.currentSong, true);
  }

  function next() { return advance(1); }
  function previous() { return advance(-1); }

  function seek(seconds) {
    if (disposed || !state.currentSong || !Number.isFinite(Number(seconds))) return false;
    const position = Math.max(0, Math.min(Number(seconds), state.duration || Infinity));
    try {
      if (ownsAudio() && state.status !== 'loading' && typeof context.seek === 'function') context.seek(position);
      else pendingSeek = position;
      state.currentTime = position; persist(); emit();
      return true;
    } catch (_) { return fail('暂时无法跳转播放位置，请稍后重试。'); }
  }

  function setMode(mode) {
    if (disposed || !MODES.includes(mode)) return false;
    state.mode = mode; history.length = 0; persist(); emit(); return true;
  }

  function toggleFavorite(id) {
    if (disposed || !byId.has(String(id))) return false;
    const key = String(id), index = state.favorites.indexOf(key);
    if (index < 0) state.favorites.push(key);
    else state.favorites.splice(index, 1);
    persist(); emit(); return index < 0;
  }

  function tickSleep() {
    sleepTimer = null;
    if (!sleepDeadline || disposed || checkSleep()) return;
    emit();
    sleepTimer = schedule(tickSleep, Math.min(1000, Math.max(1, sleepDeadline - now())));
  }

  function setSleepTimer(minutes) {
    if (disposed || !Number.isFinite(Number(minutes)) || Number(minutes) < 0 || Number(minutes) > 240) return false;
    if (sleepTimer !== null) cancel(sleepTimer);
    sleepTimer = null;
    state.sleepMinutes = Number(minutes);
    sleepDeadline = minutes > 0 ? now() + Number(minutes) * 60000 : 0;
    state.sleepRemaining = Math.ceil(Number(minutes) * 60);
    if (sleepDeadline) sleepTimer = schedule(tickSleep, Math.min(1000, Number(minutes) * 60000));
    emit(); return true;
  }

  function stop() {
    if (disposed) return false;
    shouldPlay = false;
    loadedSongId = '';
    try { if (context && typeof context.stop === 'function') context.stop(); } catch (_) { /* retain controls */ }
    state.status = state.currentSong ? 'paused' : 'idle'; state.currentTime = 0;
    pendingSeek = null; setSleepTimer(0); persist(); emit(); return true;
  }

  function onAppShow() { checkSleep(); emit(); }
  if (typeof platform.onAppShow === 'function') platform.onAppShow(onAppShow);

  return {
    getState() { checkSleep(); return snapshot(); },
    subscribe(listener) {
      if (disposed || typeof listener !== 'function') return function () {};
      listeners.add(listener); listener(snapshot());
      return function () { listeners.delete(listener); };
    },
    select, play, pause, next, previous, seek, stop, setMode, toggleFavorite, setSleepTimer,
    toggle() { return state.status === 'playing' || state.status === 'loading' ? pause() : play(); },
    cycleMode() { return setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]); },
    // Page unload only unsubscribes. Dispose is for an app teardown or an isolated test.
    dispose() {
      if (disposed) return;
      stop(); disposed = true;
      if (typeof platform.offAppShow === 'function') platform.offAppShow(onAppShow);
      bindings.forEach(binding => {
        const off = context['off' + binding.event];
        if (typeof off === 'function') off.call(context, binding.handler);
      });
      if (context && state.audioBackend === 'inner' && typeof context.destroy === 'function') context.destroy();
      listeners.clear();
    }
  };
}

let singleton = null;
function getNurseryAudio() {
  if (!singleton) singleton = createNurseryAudio();
  return singleton;
}

module.exports = { STORAGE_KEY, MODES, createNurseryAudio, getNurseryAudio };
