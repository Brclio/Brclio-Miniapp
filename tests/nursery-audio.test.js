'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNurseryAudio, STORAGE_KEY } = require('../miniprogram/lib/nursery-audio');
const { SONGS, SOURCE, getSongById } = require('../miniprogram/data/nursery-songs');

const songs = [
  { id: 'a', title: '第一首', artist: '儿歌多多', url: 'https://example.test/a.mp3', coverUrl: 'https://example.test/a.jpg', duration: 120 },
  { id: 'b', title: '第二首', artist: '儿歌多多', url: 'https://example.test/b.mp3', coverUrl: 'https://example.test/b.jpg', duration: 180 },
  { id: 'c', title: '第三首', artist: '儿歌多多', url: 'https://example.test/c.mp3', coverUrl: 'https://example.test/c.jpg', duration: 90 }
];

function host(settings) {
  const opts = settings || {};
  const events = new Map(), writes = [], timers = new Map();
  const calls = { create: 0, inner: 0, play: 0, pause: 0, stop: 0, seek: [], destroy: 0, sources: [] };
  let timestamp = 10000, nextTimer = 0, show = null, source = '';
  const player = {
    duration: 120, currentTime: 0, paused: true,
    play() { calls.play++; },
    pause() { calls.pause++; this.paused = true; fire('Pause'); },
    stop() { calls.stop++; fire('Stop'); },
    seek(value) { calls.seek.push(value); this.currentTime = value; },
    destroy() { calls.destroy++; }
  };
  Object.defineProperty(player, 'src', {
    get() { return source; },
    set(value) {
      assert.ok(this.title, 'native metadata must be assigned before the auto-playing src');
      source = value; calls.sources.push(value); this.currentTime = this.startTime || 0;
    }
  });
  function fire(event, data) {
    if (event === 'Play') player.paused = false;
    if (event === 'Stop') source = '';
    Array.from(events.get(event) || []).forEach(handler => handler(data));
  }
  ['Play', 'Pause', 'Stop', 'Waiting', 'Canplay', 'TimeUpdate', 'Seeked', 'Ended', 'Error', 'Next', 'Prev'].forEach(event => {
    player['on' + event] = handler => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event).add(handler);
    };
    player['off' + event] = handler => events.get(event).delete(handler);
  });
  const api = {
    getBackgroundAudioManager() { calls.create++; if (opts.backgroundFails) throw new Error('unsupported'); return player; },
    createInnerAudioContext() { calls.inner++; return player; },
    getStorageSync() { if (opts.readFails) throw new Error('unreadable'); return opts.saved; },
    setStorageSync(key, value) { if (opts.writeFails) throw new Error('quota exceeded'); writes.push({ key, value: structuredClone(value) }); },
    onAppShow(callback) { show = callback; },
    offAppShow(callback) { if (show === callback) show = null; }
  };
  const audio = createNurseryAudio({
    wx: api, songs, random: () => 0, now: () => timestamp,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: timestamp + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    audio, player, calls, fire, writes, events, timers,
    advance(milliseconds, runTimers) {
      timestamp += milliseconds;
      if (runTimers !== false) {
        const due = Array.from(timers.entries()).filter(entry => entry[1].at <= timestamp);
        due.forEach(([id, timer]) => { timers.delete(id); timer.callback(); });
      }
    },
    show() { if (show) show(); }
  };
}

test('the frozen source includes exactly the 47 available MP3s with encoded direct URLs and authentic metadata', () => {
  assert.equal(SOURCE.commit, '7de01bfb01e4893bff1299701861bf124f20957c');
  assert.equal(SONGS.length, 47);
  assert.equal(new Set(SONGS.map(song => song.id)).size, 47);
  assert.equal(SONGS.filter(song => song.scene === 'sleep').length, 4);
  for (const song of SONGS) {
    assert.equal(new URL(song.url).origin, SOURCE.origin);
    assert.equal(decodeURIComponent(new URL(song.url).pathname.slice(1)), song.filename);
    assert.match(song.sha256, /^[a-f0-9]{64}$/);
    assert.match(song.blobSha, /^[a-f0-9]{40}$/);
    assert.ok(song.duration > 0 && song.bytes > 0);
    assert.equal(getSongById(song.id), song);
  }
  assert.equal(getSongById('2079653666'), null, 'missing source files must not appear playable');
  assert.equal(SONGS.find(song => song.order === 20).url.includes('%2B'), true, 'plus signs must not be interpreted as spaces');
});

test('selecting a share or restored song never creates audio or assigns auto-playing src', () => {
  const h = host({ saved: { version: 1, recent: { id: 'b', time: 42 }, mode: 'shuffle', favorites: ['b', 'missing', 'b'] } });
  assert.equal(h.audio.getState().status, 'idle');
  assert.equal(h.audio.getState().currentSong.id, 'b');
  assert.equal(h.audio.getState().currentTime, 42);
  assert.deepEqual(h.audio.getState().favorites, ['b']);
  h.audio.select('c', { queue: ['c', 'bad', 'c'] });
  assert.equal(h.calls.create, 0);
  assert.deepEqual(h.calls.sources, []);
  assert.deepEqual(h.audio.getState().queue, ['c']);
  assert.equal(h.audio.getState().currentTime, 0);
  assert.equal(h.audio.select('missing'), false);
  h.audio.dispose();
});

test('native callbacks own loading, progress, paused, replay and error state; listeners can detach', () => {
  const h = host(), updates = [];
  const unsubscribe = h.audio.subscribe(state => updates.push(state));
  assert.equal(h.audio.play('a'), true);
  assert.equal(h.audio.getState().status, 'loading');
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.play, 0, 'background src auto-plays once');
  h.fire('Play'); assert.equal(h.audio.getState().status, 'playing');
  h.player.currentTime = 15; h.player.duration = 121; h.fire('TimeUpdate');
  assert.equal(h.audio.getState().currentTime, 15);
  assert.equal(h.audio.getState().duration, 121);
  h.fire('Waiting'); assert.equal(h.audio.getState().status, 'loading');
  h.fire('Play'); h.audio.pause(); assert.equal(h.audio.getState().status, 'paused');
  h.audio.toggle(); assert.equal(h.calls.play, 1); h.fire('Play');
  h.fire('Error', { errCode: 10002 });
  assert.equal(h.audio.getState().status, 'error');
  assert.match(h.audio.getState().error, /10002/);
  h.audio.play();
  assert.equal(h.calls.sources.length, 2, 'retry must reload a failed source');
  h.fire('Play'); assert.equal(h.audio.getState().error, '');
  unsubscribe(); const count = updates.length;
  h.fire('TimeUpdate'); assert.equal(updates.length, count);
  h.audio.dispose();
  assert.ok(Array.from(h.events.values()).every(handlers => handlers.size === 0));
});

test('selecting another song pauses old audio and ignores old-source callbacks', () => {
  const h = host();
  h.audio.play('a'); h.fire('Play');
  h.audio.select('b');
  h.fire('TimeUpdate'); h.fire('Pause'); h.fire('Error', { errCode: 10001 });
  assert.equal(h.audio.getState().currentSong.id, 'b');
  assert.equal(h.audio.getState().status, 'idle');
  assert.equal(h.calls.sources.length, 1);
  h.audio.dispose();
});

test('queue order, native track controls, single repeat and shuffle history are deterministic', () => {
  const h = host();
  h.audio.play('a', { queue: ['a', 'c'] }); h.fire('Play');
  h.fire('Ended'); assert.equal(h.audio.getState().currentSong.id, 'c');
  h.fire('Next'); assert.equal(h.audio.getState().currentSong.id, 'a');
  h.fire('Prev'); assert.equal(h.audio.getState().currentSong.id, 'c');
  h.audio.setMode('repeat-one'); h.fire('Ended');
  assert.equal(h.audio.getState().currentSong.id, 'c');
  assert.equal(h.audio.getState().currentTime, 0);
  h.audio.next(); assert.equal(h.audio.getState().currentSong.id, 'a', 'manual next escapes a single-song loop');
  h.audio.play('a', { queue: ['a', 'b', 'c'] }); h.audio.setMode('shuffle');
  h.audio.next(); assert.equal(h.audio.getState().currentSong.id, 'b');
  h.audio.next(); assert.equal(h.audio.getState().currentSong.id, 'a');
  h.audio.previous(); assert.equal(h.audio.getState().currentSong.id, 'b');
  assert.equal(h.audio.setMode('bad'), false);
  h.audio.dispose();
});

test('previous before a song is selected starts the final queue item', () => {
  const h = host();
  h.audio.previous(); assert.equal(h.audio.getState().currentSong.id, 'c');
  h.audio.dispose();
});

test('seek clamps to duration, saved progress resumes only after play, and Stop reloads its source', () => {
  const h = host({ saved: { version: 1, recent: { id: 'a', time: 25 } } });
  h.audio.play();
  assert.equal(h.player.startTime, 25);
  h.audio.seek(30);
  assert.deepEqual(h.calls.seek, [], 'a seek during loading waits for the native canplay event');
  h.fire('Canplay'); assert.deepEqual(h.calls.seek, [30]);
  assert.equal(h.audio.getState().currentTime, 30);
  h.audio.seek(1000); assert.equal(h.audio.getState().currentTime, 120);
  h.audio.seek(-5); assert.equal(h.audio.getState().currentTime, 0);
  assert.equal(h.audio.seek('nan'), false);
  h.fire('Stop'); assert.equal(h.audio.getState().status, 'paused');
  h.audio.play(); assert.equal(h.calls.sources.length, 2);
  h.audio.dispose();
});

test('sleep timer uses elapsed wall time, expires after suspension, cancels cleanly, and survives unsubscribe', () => {
  const h = host();
  h.audio.play('a'); h.fire('Play');
  const unsubscribe = h.audio.subscribe(() => {});
  h.audio.setSleepTimer(15); assert.equal(h.audio.getState().sleepRemaining, 900);
  unsubscribe();
  h.advance(1000); assert.equal(h.audio.getState().sleepRemaining, 899);
  h.audio.setSleepTimer(30); assert.equal(h.timers.size, 1);
  h.advance(1800001, false); h.show();
  assert.equal(h.audio.getState().sleepRemaining, 0);
  assert.equal(h.audio.getState().status, 'paused');
  assert.equal(h.timers.size, 0);
  h.audio.setSleepTimer(60); h.audio.setSleepTimer(0);
  const pauses = h.calls.pause;
  h.advance(3600001); assert.equal(h.calls.pause, pauses);
  assert.equal(h.audio.setSleepTimer(-1), false);
  assert.equal(h.audio.setSleepTimer(241), false);
  h.audio.dispose();
});

test('expired timer checked by native progress pauses without waiting for a JavaScript timeout', () => {
  const h = host();
  h.audio.play('a'); h.fire('Play'); h.audio.setSleepTimer(15);
  h.advance(900001, false); h.fire('TimeUpdate');
  assert.equal(h.audio.getState().status, 'paused');
  assert.equal(h.audio.getState().sleepMinutes, 0);
  h.audio.dispose();
});

test('favorites, mode and recent time persist; invalid persisted input and quota errors remain recoverable', () => {
  const h = host();
  h.audio.toggleFavorite('b'); h.audio.setMode('repeat-one'); h.audio.play('a');
  h.player.currentTime = 44; h.advance(6000); h.fire('TimeUpdate');
  assert.equal(h.writes.at(-1).key, STORAGE_KEY);
  assert.deepEqual(h.writes.at(-1).value, { version: 1, favorites: ['b'], mode: 'repeat-one', recent: { id: 'a', time: 44 } });
  h.audio.toggleFavorite('b'); assert.deepEqual(h.audio.getState().favorites, []);
  h.audio.dispose();
  const bad = host({ readFails: true, writeFails: true });
  assert.match(bad.audio.getState().storageNotice, /无法读取/);
  assert.doesNotThrow(() => bad.audio.play('b'));
  bad.fire('Play'); assert.equal(bad.audio.getState().status, 'playing');
  bad.audio.toggleFavorite('b'); assert.deepEqual(bad.audio.getState().favorites, ['b']);
  assert.match(bad.audio.getState().storageNotice, /暂未保存/);
  bad.audio.dispose();
  const malformed = host({ saved: { version: 1, recent: { id: 'bad', time: -5 }, favorites: 'bad', mode: 'bad' } });
  assert.equal(malformed.audio.getState().currentSong, null);
  assert.equal(malformed.audio.getState().mode, 'sequence');
  malformed.audio.dispose();
});

test('inner-audio fallback plays once and destroys its own context; unsupported hosts show recoverable errors', () => {
  const h = host({ backgroundFails: true });
  h.audio.play('a');
  assert.equal(h.audio.getState().audioBackend, 'inner');
  assert.equal(h.calls.inner, 1); assert.equal(h.calls.play, 1);
  assert.equal(h.player.autoplay, false);
  h.audio.dispose(); h.audio.dispose(); assert.equal(h.calls.destroy, 1);
  const unsupported = createNurseryAudio({ wx: {}, songs });
  assert.equal(unsupported.play('a'), false);
  assert.equal(unsupported.getState().status, 'error');
  unsupported.dispose();
});

test('system audio artwork follows the chosen song before its automatic playback source is set', () => {
  const h = host();
  h.audio.play('a'); assert.equal(h.player.coverImgUrl, songs[0].coverUrl);
  h.fire('Play'); h.audio.next(); assert.equal(h.player.coverImgUrl, songs[1].coverUrl);
  h.audio.previous(); assert.equal(h.player.coverImgUrl, songs[0].coverUrl);
  h.audio.dispose();
});
