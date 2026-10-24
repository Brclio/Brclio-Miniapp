'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountSync, CLAIM_KEY } = require('../miniprogram/lib/account-sync');
const { createNurseryAudio, STORAGE_KEY, FAVORITES_KEY } = require('../miniprogram/lib/nursery-audio');
const { SONGS } = require('../miniprogram/data/nursery-songs');
const copy = value => value === undefined ? undefined : structuredClone(value);
const BASE = Date.parse('2026-10-24T01:00:00Z');

async function host(options = {}) {
  const { validateSyncPatch, mergeSyncPatch, readSyncDocument } = await import('../web/account-sync.mjs');
  let user = options.user ? { id: options.user } : null, offline = false, source = '', pauses = 0;
  const values = new Map(options.storage || []), accounts = new Set(), bindings = new Map(), servers = options.servers || new Map();
  const sources = [];
  const wx = {
    getStorageSync: key => copy(values.get(key)),
    setStorageSync(key, value) {
      if (options.failWrite && options.failWrite(key)) throw new Error('storage full');
      values.set(key, copy(value));
    },
    removeStorageSync: key => values.delete(key),
    getBackgroundAudioManager: () => manager
  };
  const manager = { currentTime: 0, duration: 120,
    pause() { pauses++; fire('Pause'); }, stop() { source = ''; fire('Stop'); }, play() { fire('Play'); } };
  Object.defineProperty(manager, 'src', { get: () => source, set(value) { source = value; sources.push(value); } });
  for (const event of ['Play', 'Pause', 'Stop', 'TimeUpdate', 'Canplay', 'Error', 'Ended', 'Seeked']) {
    manager['on' + event] = fn => bindings.set(event, fn);
    manager['off' + event] = fn => { if (bindings.get(event) === fn) bindings.delete(event); };
  }
  function fire(event) { if (bindings.has(event)) bindings.get(event)(); }
  function server(id = user.id) {
    if (!servers.has(id)) servers.set(id, { revision: 0, entries: {} });
    return servers.get(id);
  }
  const account = {
    getCachedUser: () => user,
    subscribe(fn) { accounts.add(fn); return () => accounts.delete(fn); },
    async readSync() {
      if (offline) throw Object.assign(new Error('网络中断'), { code: 'network_error' });
      return copy(server());
    },
    async writeSync(patch) {
      if (offline) throw Object.assign(new Error('网络中断'), { code: 'network_error' });
      const current = server();
      if (patch.revision !== current.revision) throw Object.assign(new Error('conflict'), { status: 409 });
      const document = mergeSyncPatch(current, validateSyncPatch(copy(patch), BASE), BASE);
      if (document) servers.set(user.id, readSyncDocument(document));
      return copy(server());
    }
  };
  let timer = 0;
  const configuration = { wx, account, now: () => BASE, setTimeout: () => ++timer, clearTimeout() {} };
  const sync = createAccountSync(configuration);
  await sync.activate();
  const audio = createNurseryAudio({ wx, sync, now: () => BASE, setTimeout: () => ++timer, clearTimeout() {} });
  return { values, sync, audio, manager, sources, fire, server, servers, configuration,
    get pauses() { return pauses; },
    setUser(id) { user = id ? { id } : null; accounts.forEach(fn => fn()); },
    setOffline(value) { offline = value; },
    close() { audio.dispose(); sync.destroy(); }
  };
}

test('legacy music favorites move into account sync while listening progress remains local', async () => {
  const [song] = SONGS;
  const h = await host({ storage: [[STORAGE_KEY, { version: 1, favorites: [song.id], mode: 'shuffle', recent: { id: song.id, time: 31 } }]] });
  assert.deepEqual(h.audio.getState().favorites, [song.id]);
  h.setUser('account-a'); await h.audio.onPageShow();
  assert.deepEqual(h.server().entries[FAVORITES_KEY].value, { favorites: [song.id] });
  assert.equal(h.audio.getState().currentTime, 31);
  assert.equal(h.audio.getState().mode, 'shuffle');
  h.audio.setMode('repeat-one'); await h.sync.flush();
  assert.equal(h.server().entries[STORAGE_KEY], undefined);
  assert.equal(JSON.stringify(h.server()).includes('recent'), false);
  assert.deepEqual(h.sources, []);
  h.close();
});

test('remote favorites hydrate without restarting an actively playing song or changing its position', async () => {
  const h = await host({ user: 'account-a' });
  h.audio.play(SONGS[0].id); h.fire('Play');
  h.manager.currentTime = 29; h.fire('TimeUpdate');
  h.audio.setMode('repeat-one');
  const cloud = h.server(); cloud.revision++;
  cloud.entries[FAVORITES_KEY] = { value: { favorites: [SONGS[1].id] }, updatedAt: BASE + 100 };
  const pauses = h.pauses;
  await h.audio.onPageShow();
  assert.deepEqual(h.audio.getState().favorites, [SONGS[1].id]);
  assert.equal(h.audio.getState().status, 'playing');
  assert.equal(h.audio.getState().currentTime, 29);
  assert.equal(h.audio.getState().mode, 'repeat-one');
  assert.deepEqual(h.sources, [SONGS[0].url]);
  assert.equal(h.pauses, pauses);
  h.close();
});

test('switching accounts releases the old playback source and keeps favorites and local progress isolated', async () => {
  const h = await host({ user: 'account-a', storage: [[CLAIM_KEY, { userId: 'account-a', copyComplete: true }]] });
  h.audio.toggleFavorite(SONGS[0].id); h.audio.play(SONGS[0].id); h.fire('Play');
  h.manager.currentTime = 17; h.fire('TimeUpdate'); h.audio.setMode('shuffle');
  await h.sync.flush();
  const accountAKey = h.sync.getScopedKey(STORAGE_KEY);
  h.setUser('account-b');
  assert.equal(h.audio.getState().status, 'idle');
  assert.equal(h.audio.getState().currentSong, null);
  assert.deepEqual(h.audio.getState().favorites, []);
  assert.equal(h.values.get(h.sync.getScopedKey(STORAGE_KEY)), undefined, 'old native pause callback must not write into account B');
  h.fire('Play'); h.fire('TimeUpdate');
  assert.equal(h.audio.getState().status, 'idle');
  h.audio.toggleFavorite(SONGS[1].id); await h.audio.onPageShow();
  assert.deepEqual(h.server('account-b').entries[FAVORITES_KEY].value.favorites, [SONGS[1].id]);
  h.setUser('account-a'); await h.audio.onPageShow();
  assert.deepEqual(h.audio.getState().favorites, [SONGS[0].id]);
  assert.equal(h.audio.getState().currentTime, 17);
  assert.equal(h.audio.getState().mode, 'shuffle');
  assert.equal(h.values.get(accountAKey).recent.time, 17);
  h.close();
});

test('offline song additions and removals survive a player and sync restart then reach the same account', async () => {
  const h = await host({ user: 'account-a' });
  h.audio.toggleFavorite(SONGS[0].id); await h.sync.flush();
  h.setOffline(true);
  h.audio.toggleFavorite(SONGS[0].id); h.audio.toggleFavorite(SONGS[1].id);
  await h.audio.onPageHide();
  assert.equal(h.sync.getStatus().state, 'offline');
  const storage = [...h.values.entries()];
  h.close();
  const restored = await host({ user: 'account-a', storage, servers: h.servers });
  assert.deepEqual(restored.audio.getState().favorites, [SONGS[1].id]);
  assert.deepEqual(restored.server().entries[FAVORITES_KEY].value.favorites, [SONGS[1].id]);
  restored.close();
});

test('editing a known song preserves cloud favorites introduced by a newer song catalog', async () => {
  const h = await host({ user: 'account-a' }), futureSongId = '9999999999';
  const cloud = h.server(); cloud.revision++;
  cloud.entries[FAVORITES_KEY] = { value: { favorites: [futureSongId] }, updatedAt: BASE + 10 };
  await h.audio.onPageShow();
  assert.deepEqual(h.audio.getState().favorites, [], 'unknown songs do not appear playable');
  h.audio.toggleFavorite(SONGS[0].id); await h.sync.flush();
  assert.deepEqual(new Set(h.server().entries[FAVORITES_KEY].value.favorites), new Set([futureSongId, SONGS[0].id]));
  h.close();
});

test('a failed favorite write remains visible and reported while unrelated local progress writes succeed', async () => {
  let fail = false;
  const h = await host({ user: 'account-a', failWrite: key => fail && key.endsWith(':' + FAVORITES_KEY) });
  fail = true; h.audio.toggleFavorite(SONGS[0].id);
  h.audio.setMode('shuffle'); await h.sync.flush();
  assert.deepEqual(h.audio.getState().favorites, [SONGS[0].id]);
  assert.match(h.audio.getState().storageNotice, /收藏暂未保存/);
  fail = false; h.audio.toggleFavorite(SONGS[1].id); await h.sync.flush();
  assert.deepEqual(new Set(h.server().entries[FAVORITES_KEY].value.favorites), new Set([SONGS[0].id, SONGS[1].id]));
  assert.equal(h.audio.getState().storageNotice, '');
  h.close();
});
