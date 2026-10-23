'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SONGS } = require('../miniprogram/data/nursery-songs');
const { createNurseryAudio, STORAGE_KEY } = require('../miniprogram/lib/nursery-audio');

const pagePath = path.resolve(__dirname, '../miniprogram/nursery/pages/player');
const event = values => ({ currentTarget: { dataset: values } });
const input = value => ({ detail: { value } });
const plain = value => JSON.parse(JSON.stringify(value));

function host(options = {}) {
  let definition, source = '', now = 0, nextTimer = 0, audioCreations = 0;
  const bindings = new Map(), tasks = new Map(), sources = [], calls = [], sheets = [], toasts = [], scrolls = [];
  const storage = new Map(options.saved ? [[STORAGE_KEY, options.saved]] : []);
  const manager = {
    currentTime: 0, duration: 0,
    play() { calls.push('play'); emit('Play'); },
    pause() { calls.push('pause'); emit('Pause'); },
    stop() { calls.push('stop'); emit('Stop'); },
    seek(position) { calls.push(['seek', position]); this.currentTime = position; emit('Seeked'); }
  };
  Object.defineProperty(manager, 'src', {
    get() { return source; },
    set(value) { source = value; sources.push(value); manager.currentTime = manager.startTime || 0; }
  });
  for (const name of ['Play', 'Pause', 'Stop', 'Waiting', 'Canplay', 'TimeUpdate', 'Seeked', 'Ended', 'Error', 'Next', 'Prev']) {
    manager['on' + name] = callback => bindings.set(name, callback);
    manager['off' + name] = callback => { if (bindings.get(name) === callback) bindings.delete(name); };
  }
  function emit(name, value) { if (bindings.has(name)) bindings.get(name)(value); }
  const api = {
    getBackgroundAudioManager() { audioCreations++; return manager; },
    getStorageSync(key) { if (options.failStorageReads) throw new Error('storage unavailable'); return storage.get(key); },
    setStorageSync(key, value) { if (options.failStorageWrites) throw new Error('storage full'); storage.set(key, value); },
    showShareMenu() {}, showActionSheet: value => sheets.push(value),
    showToast: value => toasts.push(value), pageScrollTo: value => scrolls.push(value)
  };
  const audio = createNurseryAudio({
    wx: api, now: () => now,
    setTimeout(callback, delay) { const id = ++nextTimer; tasks.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => tasks.delete(id), random: () => 0
  });
  vm.runInNewContext(fs.readFileSync(path.join(pagePath, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx: api,
    require(id) {
      if (id === '../../../data/nursery-songs') return { SONGS };
      if (id === '../../../lib/nursery-audio') return { getNurseryAudio: () => audio };
      throw new Error('Unexpected require ' + id);
    }
  });
  const updates = [];
  const page = { ...definition, data: structuredClone(definition.data),
    setData(value) { updates.push(value); Object.assign(this.data, value); }
  };
  page.onLoad(options.query || {}); page.onShow();
  return { page, audio, manager, sources, calls, sheets, toasts, scrolls, updates, tasks, emit,
    get audioCreations() { return audioCreations; },
    play(id) { page.playSong(event({ id })); emit('Play'); },
    advance(milliseconds) {
      const deadline = now + milliseconds;
      for (;;) {
        const next = [...tasks.entries()].filter(([, task]) => task.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = deadline;
    },
    cleanup() { page.onUnload(); audio.dispose(); }
  };
}

test('opening a shared song or bedtime scene selects content without starting native audio', () => {
  const song = SONGS.find(item => item.scene === 'sleep');
  const h = host({ query: { song: song.id, scene: 'sleep' } }), p = h.page;
  assert.equal(p.data.currentSong.id, song.id);
  assert.equal(p.data.scene, 'sleep');
  assert.ok(p.data.songs.length > 0);
  assert.ok(p.data.songs.every(item => SONGS.find(song => song.id === item.id).scene === 'sleep'));
  assert.equal(h.audioCreations, 0);
  assert.equal(h.sources.length, 0);
  assert.equal(p.data.isPlaying, false);
  assert.equal(p.data.isLoading, false);
  const share = p.onShareAppMessage(), timeline = p.onShareTimeline();
  assert.equal(share.path, '/pages/parenting/index?song=' + encodeURIComponent(song.id));
  assert.equal(timeline.query, 'song=' + encodeURIComponent(song.id));
  assert.ok(share.title.includes(song.title));
  assert.equal(share.imageUrl, song.cover);
  h.cleanup();
});

test('fresh entry aligns the visible song with native selection before previous, next or scene playback', () => {
  for (const [handler, expected] of [['previousSong', SONGS[SONGS.length - 1]], ['nextSong', SONGS[1]]]) {
    const h = host();
    assert.equal(h.page.data.currentSong.id, SONGS[0].id);
    assert.equal(h.audio.getState().currentSong.id, SONGS[0].id);
    assert.equal(h.audioCreations, 0);
    h.page[handler]();
    assert.equal(h.audio.getState().currentSong.id, expected.id);
    assert.deepEqual(h.sources, [expected.url]);
    h.cleanup();
  }
  for (const scene of ['sleep', 'active']) {
    const h = host({ query: { scene } });
    const songs = SONGS.filter(song => song.scene === scene);
    assert.equal(h.page.data.currentSong.id, songs[0].id);
    assert.equal(h.audio.getState().currentSong.id, songs[0].id);
    assert.deepEqual(h.audio.getState().queue, songs.map(song => song.id));
    assert.equal(h.audioCreations, 0);
    h.page.togglePlayback();
    assert.deepEqual(h.sources, [songs[0].url]);
    h.cleanup();
  }
});

test('restoring recent listening position and ignoring invalid entry parameters never autoplays', () => {
  const song = SONGS[1];
  const h = host({ query: { song: 'unknown', scene: 'unknown' },
    saved: { version: 1, favorites: [song.id], mode: 'shuffle', recent: { id: song.id, time: 47 } } });
  assert.equal(h.page.data.scene, 'all');
  assert.equal(h.page.data.currentSong.id, song.id);
  assert.equal(h.page.data.currentTimeText, '00:47');
  assert.equal(h.page.data.mode, 'shuffle');
  assert.equal(h.page.data.favorite, true);
  assert.equal(h.audioCreations, 0);
  h.page.togglePlayback();
  assert.equal(h.manager.startTime, 47);
  assert.deepEqual(h.sources, [song.url]);
  h.cleanup();
});

test('search intersects the selected scene and clear restores only that scene', () => {
  const h = host(), p = h.page;
  p.switchScene(event({ scene: 'sleep' }));
  const bedtime = plain(p.data.songs).map(song => song.id);
  p.searchSongs(input('  小  '));
  const expected = SONGS.filter(song => song.scene === 'sleep' && song.title.includes('小')).map(song => song.id);
  assert.deepEqual(plain(p.data.songs).map(song => song.id), expected);
  p.searchSongs(input('没有这首儿歌'));
  assert.equal(p.data.songs.length, 0);
  assert.match(p.data.emptyTitle, /还没找到/);
  p.clearSearch();
  assert.deepEqual(plain(p.data.songs).map(song => song.id), bedtime);
  p.switchScene(event({ scene: 'invalid' }));
  assert.equal(p.data.scene, 'sleep');
  assert.equal(h.audioCreations, 0);
  h.cleanup();
});

test('current-song and row favorite controls update the favorites view without playback', () => {
  const h = host(), p = h.page, first = p.data.currentSong.id, other = SONGS[1].id;
  p.switchScene(event({ scene: 'favorites' }));
  assert.equal(p.data.songs.length, 0);
  assert.match(p.data.emptyTitle, /喜欢/);
  p.toggleFavorite(event({}));
  p.toggleFavorite(event({ id: other }));
  assert.equal(p.data.favorite, true);
  assert.deepEqual(plain(p.data.songs).map(song => song.id), [first, other]);
  assert.ok(p.data.songs.every(song => song.favorite));
  p.toggleFavorite(event({ id: first }));
  assert.deepEqual(plain(p.data.songs).map(song => song.id), [other]);
  assert.equal(p.data.favorite, false);
  assert.equal(h.audioCreations, 0);
  h.cleanup();
});

test('unavailable local storage leaves favorites usable and exposes truthful persistence feedback', () => {
  const h = host({ failStorageReads: true, failStorageWrites: true }), p = h.page;
  assert.match(p.data.storageNotice, /无法读取|暂未保存/);
  p.toggleFavorite(event({ id: SONGS[0].id }));
  assert.equal(p.data.favorite, true);
  assert.match(p.data.storageNotice, /暂未保存/);
  const wxml = fs.readFileSync(path.join(pagePath, 'index.wxml'), 'utf8');
  assert.match(wxml, /\{\{storageNotice\}\}/);
  h.cleanup();
});

test('choosing from filtered results creates a playback queue that wraps inside those results', () => {
  const h = host(), p = h.page;
  p.switchScene(event({ scene: 'sleep' }));
  const visible = p.data.songs.map(song => song.id);
  assert.ok(visible.length > 1);
  h.play(visible[visible.length - 1]);
  assert.deepEqual(h.audio.getState().queue, plain(visible));
  h.emit('Ended');
  assert.equal(p.data.currentSong.id, visible[0]);
  p.previousSong();
  assert.equal(p.data.currentSong.id, visible[visible.length - 1]);
  p.searchSongs(input('没有这首歌'));
  assert.equal(p.data.songs.length, 0);
  p.nextSong();
  assert.equal(p.data.currentSong.id, visible[0], 'editing search must not silently replace the active queue');
  h.cleanup();
});

test('tapping a playing or loading row pauses it; resume keeps the native source', () => {
  const h = host(), p = h.page, id = SONGS[0].id;
  p.playSong(event({ id }));
  assert.equal(p.data.isLoading, true);
  p.playSong(event({ id }));
  assert.equal(p.data.status, 'paused');
  assert.equal(h.calls.at(-1), 'pause');
  p.playSong(event({ id }));
  assert.equal(p.data.isPlaying, true);
  assert.equal(h.sources.length, 1);
  p.playSong(event({ id }));
  assert.equal(p.data.isPlaying, false);
  p.playSong(event({ id: 'unknown' }));
  assert.equal(h.sources.length, 1);
  h.cleanup();
});

test('progress updates cannot pull the slider away from an active drag and release seeks once', () => {
  const h = host(), p = h.page;
  h.play(SONGS[0].id);
  h.manager.duration = 172; h.manager.currentTime = 12; h.emit('TimeUpdate');
  p.previewSeek(input(65));
  h.manager.currentTime = 13; h.emit('TimeUpdate');
  assert.equal(p.data.currentTime, 65);
  assert.equal(p.data.currentTimeText, '01:05');
  assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'seek').length, 0);
  p.seekSong(input(70));
  assert.deepEqual(h.calls.at(-1), ['seek', 70]);
  assert.equal(p.data.currentTimeText, '01:10');
  h.manager.currentTime = 71; h.emit('TimeUpdate');
  assert.equal(p.data.currentTime, 71);
  h.cleanup();
});

test('changing songs during a slider drag drops the old preview instead of showing the old position', () => {
  const h = host(), p = h.page;
  h.play(SONGS[0].id); p.previewSeek(input(120));
  p.nextSong();
  assert.equal(p.data.currentSong.id, SONGS[1].id);
  assert.equal(p.data.currentTime, 0);
  assert.equal(p.data.currentTimeText, '00:00');
  p.seekSong(input(120));
  assert.equal(h.audio.getState().currentTime, 0, 'a late release from the old song must not seek the new song');
  assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'seek').length, 0);
  h.cleanup();
});

test('frequent native progress and timer ticks keep the playlist stable while real row changes refresh it', () => {
  const h = host(), p = h.page;
  h.play(SONGS[0].id);
  const songs = p.data.songs;
  h.audio.setSleepTimer(15);
  for (let seconds = 1; seconds <= 5; seconds++) {
    h.manager.currentTime = seconds; h.emit('TimeUpdate'); h.advance(1000);
  }
  assert.equal(p.data.currentTime, 5);
  assert.equal(p.data.sleepText, '14:55 后停止');
  assert.equal(p.data.songs, songs, 'unchanged rows must not be transferred on every native time update');
  p.toggleFavorite(event({ id: SONGS[0].id }));
  assert.notEqual(p.data.songs, songs);
  assert.equal(p.data.songs[0].favorite, true);
  p.togglePlayback();
  assert.equal(p.data.songs[0].playing, false);
  h.cleanup();
});

test('timer choices map to off, 15, 30 and 60 minutes and canceled or stale sheets do nothing', () => {
  const h = host(), p = h.page;
  for (const [index, minutes] of [0, 15, 30, 60].entries()) {
    p.chooseSleepTimer();
    const sheet = h.sheets.at(-1);
    assert.equal(sheet.itemList.length, 4);
    sheet.success({ tapIndex: index });
    assert.equal(h.audio.getState().sleepMinutes, minutes);
  }
  p.chooseSleepTimer(); h.sheets.at(-1).success({ tapIndex: -1 });
  assert.equal(h.audio.getState().sleepMinutes, 60);
  const pending = h.sheets.at(-1);
  p.onUnload(); pending.success({ tapIndex: 0 });
  assert.equal(h.audio.getState().sleepMinutes, 60);
  h.audio.dispose();
});

test('leaving the page unsubscribes rendering while background audio and its sleep timer survive', () => {
  const h = host(), p = h.page;
  h.play(SONGS[0].id); h.audio.setSleepTimer(15);
  const calls = h.calls.length;
  p.onUnload();
  const updates = h.updates.length;
  h.manager.currentTime = 10; h.emit('TimeUpdate'); h.advance(1000);
  assert.equal(h.updates.length, updates);
  assert.equal(h.calls.length, calls);
  assert.equal(h.audio.getState().status, 'playing');
  assert.equal(h.audio.getState().sleepRemaining, 899);
  h.audio.dispose();
});

test('native audio failures display a retry that reloads the selected song and clears after playing', () => {
  const h = host(), p = h.page;
  h.play(SONGS[1].id);
  h.emit('Error', { errCode: 10002 });
  assert.equal(p.data.status, 'error');
  assert.equal(p.data.isPlaying, false);
  assert.match(p.data.error, /重试/);
  p.retryPlayback();
  assert.deepEqual(h.sources, [SONGS[1].url, SONGS[1].url]);
  h.emit('Play');
  assert.equal(p.data.error, '');
  assert.equal(p.data.status, 'playing');
  h.cleanup();
});

test('playback mode, compact controls and scroll back use the same persistent player', () => {
  const h = host(), p = h.page;
  h.play(SONGS[0].id); p.changeMode();
  assert.equal(p.data.mode, 'shuffle');
  assert.equal(p.data.modeText, '随机播放');
  assert.equal(h.toasts.at(-1).title, '随机播放');
  p.onPageScroll({ scrollTop: 451 }); assert.equal(p.data.compact, true);
  const updates = h.updates.length;
  p.onPageScroll({ scrollTop: 600 }); assert.equal(h.updates.length, updates);
  p.togglePlayback(); assert.equal(p.data.status, 'paused');
  p.scrollToPlayer(); assert.deepEqual(h.scrolls.map(plain), [{ scrollTop: 0, duration: 220 }]);
  p.onPageScroll({ scrollTop: 0 }); assert.equal(p.data.compact, false);
  h.cleanup();
});

test('native template binds real handlers and labels its symbol-only playback controls', () => {
  const h = host();
  const wxml = fs.readFileSync(path.join(pagePath, 'index.wxml'), 'utf8');
  for (const match of wxml.matchAll(/(?:bind|catch)(?:tap|input|confirm|change|changing|error|touchmove)="([^"]+)"/g)) {
    assert.equal(typeof h.page[match[1]], 'function', match[1]);
  }
  for (const className of ['main-play-button', 'favorite-button', 'compact-toggle', 'compact-next', 'clear-search']) {
    const button = [...wxml.matchAll(/<button\b[^>]*>/g)].find(match => match[0].includes('class="' + className));
    assert.ok(button, className);
    assert.match(button[0], /aria-label="[^"]+"/, className);
  }
  assert.doesNotMatch(wxml, /<web-view\b/);
  h.cleanup();
});

test('a failed bundled image falls back without changing playback or losing list artwork mappings', () => {
  const h = host(), song = SONGS[0];
  h.play(song.id);
  assert.equal(h.page.data.songs[0].cover, song.cover);
  h.page.onCoverError(event({ id: song.id }));
  assert.equal(h.page.data.coverFailures[song.id], true);
  assert.equal(h.page.data.isPlaying, true);
  assert.equal(h.sources.length, 1);
  h.page.onCoverError(event({ id: 'https://attacker.test/file' }));
  assert.deepEqual(Object.keys(h.page.data.coverFailures), [song.id]);
  h.cleanup();
});
