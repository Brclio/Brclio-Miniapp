'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountSync, META_PREFIX, CLAIM_KEY } = require('../miniprogram/lib/account-sync');
const schema = require('../miniprogram/lib/account-sync-schema');
const copy = value => JSON.parse(JSON.stringify(value));
const BASE = Date.parse('2026-10-22T02:00:00Z');
const pause = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function host(options = {}) {
  let now = BASE, user = options.user || null, sequence = 0, offline = false, conflicts = 0, hook = null;
  const values = new Map(options.storage || []), listeners = new Set(), tasks = new Map(), calls = [], servers = new Map();
  const wx = {
    getStorageSync: key => values.has(key) ? copy(values.get(key)) : '',
    setStorageSync: (key, value) => { if (options.failWrite && options.failWrite(key, value)) throw new Error('storage unavailable'); values.set(key, copy(value)); },
    removeStorageSync: key => values.delete(key)
  };
  function server(id = user && user.id) { if (!servers.has(id)) servers.set(id, { revision: 0, entries: {} }); return servers.get(id); }
  const account = {
    getCachedUser: () => user,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async readSync() { const id = user && user.id; calls.push({ method: 'GET', id }); if (offline) throw Object.assign(new Error('连接失败。'), { code: 'network_error' }); if (hook) await hook('GET', id); return copy(server(id)); },
    async writeSync(payload) {
      const id = user && user.id; calls.push({ method: 'PUT', id, payload: copy(payload) });
      if (offline) throw Object.assign(new Error('连接失败。'), { code: 'network_error' });
      if (hook) await hook('PUT', id, payload);
      const target = server(id);
      if (conflicts-- > 0 || payload.revision !== target.revision) throw Object.assign(new Error('有新记录。'), { code: 'sync_conflict', status: 409 });
      let changed = false;
      for (const [key, value] of Object.entries(payload.entries)) {
        assert.ok(schema.SYNC_KEYS.includes(key));
        assert.ok(schema.byteLength(payload) <= schema.MAX_REQUEST_BYTES);
        if (!target.entries[key] || value.updatedAt >= target.entries[key].updatedAt) { target.entries[key] = copy(value); changed = true; }
      }
      if (changed) target.revision++;
      return copy(target);
    }
  };
  const configuration = { wx, account, now: () => now, throttleMs: 100,
    setTimeout(fn, delay) { const id = ++sequence; tasks.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { tasks.delete(id); } };
  const controller = createAccountSync(configuration);
  return { controller, configuration, wx, values, calls, tasks, account, server,
    setUser(id) { user = id ? { id } : null; for (const listener of listeners) listener({ user }); },
    setOffline(value) { offline = value; }, setConflicts(value) { conflicts = value; }, setHook(value) { hook = value; },
    advance(ms) { now += ms; for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.fn(); } }
  };
}
function progress(patch = {}) { return { completed: {}, seen: [], saved: [], sessions: 0, lastPlayed: null, streak: 0, ...patch }; }
function completion(id, offset = 0) { return { id, levelId: 1, levelTitle: '水果', mode: 'theme', wordCount: 10, gameSeconds: 12, studySeconds: 8, totalSeconds: 20, score: 900, stars: 3, assists: 0, completedAt: new Date(BASE + offset).toISOString() }; }

test('guest reads never claim or call a service; local writes remain synchronous and secrets never enter sync metadata', async () => {
  const h = host({ storage: [['RGD_MAX_WAIT', 8], ['RGD_CUSTOM_REWARDS', '["private"]']] }), c = h.controller;
  assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 8); assert.equal(c.getGuestOwner(), null);
  c.storage.setStorageSync('RGD_MAX_WAIT', 9); c.storage.setStorageSync('RGD_CUSTOM_REWARDS', '["new private"]');
  assert.equal(h.values.get('RGD_MAX_WAIT'), 9); assert.equal(h.calls.length, 0);
  await c.activate(); assert.equal(c.getScope(), 'guest'); assert.equal(h.calls.length, 0);
  assert.match(c.getStatus().message, /本机/);
  const metadata = JSON.stringify(h.values.get(META_PREFIX + 'guest'));
  assert.equal(metadata.includes('private'), false); assert.equal(h.tasks.size, 0); c.destroy();
});

test('first login claims guest data exactly once and logout and account switches isolate all local business data', async () => {
  const h = host({ storage: [['RGD_MAX_WAIT', 8], ['RGD_CUSTOM_REWARDS', '["guest reward"]'], ['lingotiles.progress.v1', JSON.stringify(progress({ seen: ['apple'] }))]] }), c = h.controller;
  c.storage.setStorageSync(schema.HISTORY_KEY, [completion('guest-round')]);
  h.setUser('account-a'); await c.activate();
  assert.equal(c.getGuestOwner(), 'account-a'); assert.equal(c.getScope(), 'account-a');
  assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 8); assert.equal(c.storage.getStorageSync('RGD_CUSTOM_REWARDS'), '["guest reward"]');
  assert.equal(h.server('account-a').entries['RGD_MAX_WAIT'].value, 8);
  assert.equal(JSON.stringify(h.server('account-a')).includes('guest reward'), false);
  c.storage.setStorageSync('RGD_MAX_WAIT', 10); c.storage.setStorageSync('RGD_CUSTOM_REWARDS', '["a reward"]'); await c.flush();
  h.setUser(null); assert.equal(c.getScope(), 'guest'); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 8);
  c.storage.setStorageSync('RGD_MAX_WAIT', 6);
  h.setUser('account-b'); await c.activate(); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), ''); assert.equal(c.storage.getStorageSync('RGD_CUSTOM_REWARDS'), '');
  assert.deepEqual(h.server('account-b').entries, {});
  h.setUser('account-a'); await c.activate(); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 10); assert.equal(c.storage.getStorageSync('RGD_CUSTOM_REWARDS'), '["a reward"]'); c.destroy();
});

test('throttled writes and an offline durable queue resume after restart and connectivity recovery', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  await c.activate(); h.calls.length = 0;
  c.storage.setStorageSync('RGD_MAX_WAIT', 7); c.storage.setStorageSync('RGD_MAX_WAIT', 8);
  assert.equal(h.calls.length, 0); assert.equal(h.tasks.size, 1); assert.equal(c.getStatus().pending, 1);
  h.setOffline(true); h.advance(100); await pause(); assert.equal(c.getStatus().state, 'offline');
  assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 8); c.destroy();
  const restored = createAccountSync(h.configuration); await restored.activate(); assert.equal(restored.getStatus().pending, 1);
  h.setOffline(false); restored.networkChanged({ isConnected: true }); h.advance(0); await pause(); await restored.flush();
  assert.equal(h.server().entries['RGD_MAX_WAIT'].value, 8); assert.equal(restored.getStatus().pending, 0); assert.equal(restored.getStatus().state, 'idle'); restored.destroy();
});

test('409 conflicts merge keys and learning accomplishments while newer saved-word removals remain removed', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  c.storage.setItem('lingotiles.progress.v1', JSON.stringify(progress({ completed: { 1: { stars: 3, bestScore: 700, bestTime: 25 } }, seen: ['apple'], saved: [], sessions: 2, lastPlayed: '2026-10-22', streak: 1 })));
  const cloud = h.server(); cloud.revision++;
  cloud.entries['RGD_SOUND_ENABLED'] = { value: false, updatedAt: BASE };
  cloud.entries['lingotiles.progress.v1'] = { value: progress({ completed: { 1: { stars: 2, bestScore: 900, bestTime: 40 }, 2: { stars: 1, bestScore: 500, bestTime: 60 } }, seen: ['banana'], saved: ['banana'], sessions: 1 }), updatedAt: BASE - 1000 };
  await c.flush();
  const merged = cloud.entries['lingotiles.progress.v1'].value;
  assert.deepEqual(merged.completed['1'], { stars: 3, bestScore: 900, bestTime: 25 }); assert.ok(merged.completed['2']);
  assert.deepEqual(new Set(merged.seen), new Set(['apple', 'banana'])); assert.deepEqual(merged.saved, ['banana'], 'default empty local favorites are not a deletion intention');
  assert.equal(c.storage.getStorageSync('RGD_SOUND_ENABLED'), '', 'background conflict must not change a running game');
  await c.onShow(); assert.equal(c.storage.getStorageSync('RGD_SOUND_ENABLED'), false); c.destroy();
});

test('background remote metadata cannot be mistaken for a newer local edit after restart', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  c.storage.setStorageSync('RGD_MAX_WAIT', 7);
  h.setHook((method, id) => { if (method === 'PUT') { h.server(id).entries['RGD_SOUND_ENABLED'] = { value: false, updatedAt: BASE + 100 }; h.setHook(null); } });
  await c.flush(); assert.equal(c.storage.getStorageSync('RGD_SOUND_ENABLED'), ''); c.destroy();
  const restored = createAccountSync(h.configuration); await restored.activate();
  assert.equal(restored.storage.getStorageSync('RGD_SOUND_ENABLED'), false);
  assert.equal(h.server().entries['RGD_SOUND_ENABLED'].value, false);
  assert.notEqual(h.server().entries['RGD_SOUND_ENABLED'].value, null); restored.destroy();
});

test('late in-flight responses cannot hydrate or send account A data into account B', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  let release; h.setHook(method => method === 'GET' ? new Promise(resolve => { release = resolve; }) : undefined);
  const activation = c.activate(); await pause();
  h.setUser('account-b'); h.setHook(null);
  c.storage.setStorageSync('RGD_MAX_WAIT', 5); await c.activate();
  release(); await activation;
  assert.equal(c.getScope(), 'account-b'); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 5);
  assert.equal(h.server('account-b').entries['RGD_MAX_WAIT'].value, 5);
  assert.equal(h.server('account-a').entries['RGD_MAX_WAIT'], undefined); c.destroy();
});

test('deletions persist as tombstones and clearing duel history is not undone by conflict merges', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  const duel = { targetScore: 3, haptics: true, soundEnabled: true, names: ['红方', '蓝方'], matches: [{ id: 'old', at: BASE, winner: 0, scores: [3, 1], bestMs: 200, names: ['红方', '蓝方'] }] };
  c.storage.setStorageSync('brclio.duel.v1', duel); c.storage.setStorageSync('RGD_MAX_WAIT', 7); await c.flush();
  h.advance(100); c.storage.removeStorageSync('RGD_MAX_WAIT'); c.storage.setStorageSync('brclio.duel.v1', { ...duel, matches: [] });
  h.setConflicts(1); await c.flush(); await c.onShow();
  assert.equal(h.server().entries['RGD_MAX_WAIT'].value, null); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), '');
  assert.deepEqual(h.server().entries['brclio.duel.v1'].value.matches, []); assert.deepEqual(c.storage.getStorageSync('brclio.duel.v1').matches, []); c.destroy();
});

test('history sync keeps a bounded recent window without truncating the adapter complete local history', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  const all = Array.from({ length: 250 }, (_, i) => completion('round-' + i, i));
  c.storage.setStorageSync(schema.HISTORY_KEY, all);
  assert.equal(c.storage.getStorageSync(schema.HISTORY_KEY).length, 250); await c.flush();
  assert.equal(h.server().entries[schema.HISTORY_KEY].value.length, 200);
  assert.equal(h.server().entries[schema.HISTORY_KEY].value[0].id, 'round-249');
  assert.equal(c.storage.getStorageSync(schema.HISTORY_KEY).length, 250, 'a background upload must not shrink local history'); c.destroy();
});

test('invalid or oversized local data stays local and is protected from a later cloud pull', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  const longTitle = 'x'.repeat(201); c.storage.setStorageSync('RGD_CUSTOM_TITLE', longTitle);
  h.server().entries['RGD_CUSTOM_TITLE'] = { value: 'cloud title', updatedAt: BASE + 1 };
  await c.onShow(); assert.equal(c.storage.getStorageSync('RGD_CUSTOM_TITLE'), longTitle);
  assert.equal(h.server().entries['RGD_CUSTOM_TITLE'].value, 'cloud title'); assert.equal(c.getStatus().state, 'error'); c.destroy();
});

test('guest claim retries only unfinished copies for the same owner and never picks up later guest activity', async () => {
  let fail = true;
  const h = host({ user: { id: 'account-a' }, storage: [['RGD_MAX_WAIT', 7]], failWrite: key => key.includes('miniapp-data.v1:account-a:') && fail }), c = h.controller;
  await c.activate(); assert.equal(c.getGuestOwner(), 'account-a'); assert.equal(h.values.get(CLAIM_KEY).copyComplete, false);
  fail = false; await c.activate(); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 7); assert.equal(h.values.get(CLAIM_KEY).copyComplete, true);
  h.setUser(null); c.storage.setStorageSync('RGD_MAX_WAIT', 9); h.setUser('account-a'); await c.activate(); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 7); c.destroy();
});

test('sync state subscribers receive safe status and no storage or credentials', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller, statuses = [];
  const unsubscribe = c.subscribe(status => statuses.push(status)); await c.activate(); c.storage.setStorageSync('RGD_SOUND_ENABLED', false); await c.flush();
  assert.ok(statuses.some(status => status.state === 'syncing'));
  assert.ok(statuses.every(status => status.message && !('token' in status) && !('entries' in status)));
  const count = statuses.length; unsubscribe(); c.storage.setStorageSync('RGD_SOUND_ENABLED', true); assert.equal(statuses.length, count); c.destroy();
});


test('leaving a safe page invalidates both in-flight and queued pulls before a game can be hydrated', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  h.server().entries['RGD_MAX_WAIT'] = { value: 9, updatedAt: BASE + 100 };
  let release; h.setHook(method => method === 'GET' ? new Promise(resolve => { release = resolve; }) : undefined);
  const pull = c.onShow(), queued = c.onShow(); await pause();
  const background = c.onHide(); h.setHook(null); release(); await pull; await queued; await background;
  assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), '', 'game snapshot must stay unchanged after home onHide');
  const requests = h.calls.length; await c.onShow(); assert.ok(h.calls.length > requests); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 9); c.destroy();
});

test('a local write during upload remains dirty until its exact newer value is acknowledged', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate();
  c.storage.setStorageSync('RGD_MAX_WAIT', 6);
  let release, delayed = false;
  h.setHook(method => { if (method === 'PUT' && !delayed) { delayed = true; return new Promise(resolve => { release = resolve; }); } });
  const flushing = c.flush(); await pause(); c.storage.setStorageSync('RGD_MAX_WAIT', 10); release(); await flushing;
  assert.equal(h.server().entries['RGD_MAX_WAIT'].value, 10); assert.equal(c.getStatus().pending, 0); c.destroy();
});

test('large independent progress and history entries upload in bounded batches', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller; await c.activate(); h.calls.length = 0;
  const ids = Array.from({ length: 1300 }, (_, i) => 'dict:word' + i + 'x'.repeat(100));
  const largeProgress = progress({ seen: ids, saved: ids.slice(0, 350) });
  const history = Array.from({ length: 200 }, (_, i) => ({ ...completion('round-' + i, i), levelTitle: '中'.repeat(150) }));
  c.storage.setItem('lingotiles.progress.v1', JSON.stringify(largeProgress)); c.storage.setStorageSync(schema.HISTORY_KEY, history); await c.flush();
  const writes = h.calls.filter(call => call.method === 'PUT'); assert.ok(writes.length >= 2);
  assert.ok(writes.every(call => schema.byteLength(call.payload) < schema.MAX_REQUEST_BYTES));
  assert.equal(h.server().entries['lingotiles.progress.v1'].value.seen.length, 1300); assert.equal(h.server().entries[schema.HISTORY_KEY].value.length, 200); c.destroy();
});

test('a durable local write survives a failed queue-metadata write and is recovered on restart', async () => {
  let rejectMetadata = false;
  const h = host({ user: { id: 'account-a' }, failWrite: key => rejectMetadata && key === META_PREFIX + 'account-a' }), c = h.controller;
  await c.activate(); rejectMetadata = true;
  assert.doesNotThrow(() => c.storage.setStorageSync('RGD_MAX_WAIT', 9)); assert.equal(c.storage.getStorageSync('RGD_MAX_WAIT'), 9); assert.equal(c.getStatus().state, 'error'); c.destroy();
  rejectMetadata = false; const restored = createAccountSync(h.configuration); await restored.activate();
  assert.equal(restored.storage.getStorageSync('RGD_MAX_WAIT'), 9); assert.equal(h.server().entries['RGD_MAX_WAIT'].value, 9); restored.destroy();
});


test('practice before an initial safe pull completes cannot erase unseen cloud favorites', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  h.server().entries['lingotiles.progress.v1'] = { value: progress({ saved: ['banana'], seen: ['banana'] }), updatedAt: BASE - 100 };
  let release; h.setHook(method => method === 'GET' ? new Promise(resolve => { release = resolve; }) : undefined);
  const initial = c.activate(); await pause(); const hidden = c.onHide();
  c.storage.setItem('lingotiles.progress.v1', JSON.stringify(progress({ seen: ['apple'], sessions: 1, completed: { 1: { stars: 3, bestScore: 100, bestTime: 20 } } })));
  h.setHook(null); release(); await initial; await hidden;
  assert.deepEqual(h.server().entries['lingotiles.progress.v1'].value.saved, ['banana']);
  assert.deepEqual(JSON.parse(c.storage.getItem('lingotiles.progress.v1')).saved, [], 'no hot hydration during the game');
  await c.onShow(); assert.deepEqual(JSON.parse(c.storage.getItem('lingotiles.progress.v1')).saved, ['banana']); c.destroy();
});

test('observed favorite removal survives an offline queue and a conflicting newer practice snapshot', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  h.server().entries['lingotiles.progress.v1'] = { value: progress({ saved: ['banana'], seen: ['banana'] }), updatedAt: BASE - 100 };
  await c.activate();
  c.storage.setItem('lingotiles.progress.v1', JSON.stringify(progress({ saved: [], seen: ['banana'] })));
  h.setOffline(true); await c.flush(); c.destroy();
  h.server().revision++; h.server().entries['lingotiles.progress.v1'] = { value: progress({ saved: ['banana'], seen: ['banana', 'apple'] }), updatedAt: BASE + 1000 };
  h.setOffline(false); const restored = createAccountSync(h.configuration); await restored.activate();
  assert.deepEqual(h.server().entries['lingotiles.progress.v1'].value.saved, []);
  assert.ok(h.server().entries['lingotiles.progress.v1'].value.seen.includes('apple')); restored.destroy();
});


test('practice from an unhydrated older physical snapshot cannot revive a cloud favorite removal', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  h.server().entries['lingotiles.progress.v1'] = { value: progress({ saved: ['apple'], seen: ['apple'] }), updatedAt: BASE - 100 };
  await c.activate();
  h.server().revision++; h.server().entries['lingotiles.progress.v1'] = { value: progress({ saved: [], seen: ['apple'] }), updatedAt: BASE + 1 };
  c.storage.setStorageSync('RGD_MAX_WAIT', 7); await c.flush();
  assert.deepEqual(JSON.parse(c.storage.getItem('lingotiles.progress.v1')).saved, ['apple']);
  c.storage.setItem('lingotiles.progress.v1', JSON.stringify(progress({ saved: ['apple'], seen: ['apple', 'banana'], sessions: 1 })));
  await c.flush(); assert.deepEqual(h.server().entries['lingotiles.progress.v1'].value.saved, []);
  assert.ok(h.server().entries['lingotiles.progress.v1'].value.seen.includes('banana')); c.destroy();
});

test('recording a match before initial hydration preserves unknown cloud duel preferences', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  h.server().entries['brclio.duel.v1'] = { value: { targetScore: 5, haptics: false, soundEnabled: false, names: ['Alice', 'Bob'], matches: [] }, updatedAt: BASE - 100 };
  let release; h.setHook(method => method === 'GET' ? new Promise(resolve => { release = resolve; }) : undefined);
  const initial = c.activate(); await pause(); const hidden = c.onHide();
  const store = require('../minigame/lib/storage').createStorage(c.storage);
  assert.equal(store.read().targetScore, 3);
  store.recordMatch({ id: 'first', at: BASE, winner: 0, scores: [3, 1], bestMs: 210, names: ['红方', '蓝方'] });
  h.setHook(null); release(); await initial; await hidden;
  const value = h.server().entries['brclio.duel.v1'].value;
  assert.equal(value.targetScore, 5); assert.equal(value.haptics, false); assert.equal(value.soundEnabled, false); assert.deepEqual(value.names, ['Alice', 'Bob']); assert.equal(value.matches[0].id, 'first');
  assert.equal(store.read().targetScore, 3, 'a game already in progress is not hydrated');
  assert.equal(store.save({ targetScore: 1, haptics: true, soundEnabled: true, names: ['新红', '新蓝'] }), true);
  await c.flush(); assert.equal(h.server().entries['brclio.duel.v1'].value.targetScore, 1); assert.equal(h.server().entries['brclio.duel.v1'].value.haptics, true); c.destroy();
});

test('a new local match does not revive cleared cloud history from a stale physical snapshot', async () => {
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  const old = { id: 'old', at: BASE - 1000, winner: 0, scores: [3, 1], bestMs: 210, names: ['红方', '蓝方'] };
  h.server().entries['brclio.duel.v1'] = { value: { targetScore: 5, matches: [old] }, updatedAt: BASE - 100 };
  await c.activate(); h.server().revision++; h.server().entries['brclio.duel.v1'] = { value: { targetScore: 5, matches: [] }, updatedAt: BASE + 1 };
  c.storage.setStorageSync('RGD_MAX_WAIT', 7); await c.flush();
  const store = require('../minigame/lib/storage').createStorage(c.storage); assert.equal(store.read().matches.length, 1);
  store.recordMatch({ ...old, id: 'new', at: BASE + 10 }); await c.flush();
  assert.deepEqual(h.server().entries['brclio.duel.v1'].value.matches.map(item => item.id), ['new']);
  assert.equal(h.server().entries['brclio.duel.v1'].value.targetScore, 5); c.destroy();
});

test('nursery favorites merge only observed song edits across an offline restart and a newer cloud snapshot', async () => {
  const key = schema.NURSERY_FAVORITES_KEY;
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  h.server().entries[key] = { value: { favorites: ['1451390672', '2079653665'] }, updatedAt: BASE - 100 };
  await c.activate();
  c.storage.setStorageSync(key, { favorites: ['2079653665', '2114146440'] });
  h.setOffline(true); await c.flush(); c.destroy();
  h.server().revision++;
  h.server().entries[key] = { value: { favorites: ['1451390672', '2079653665', '1451390674'] }, updatedAt: BASE + 1000 };
  h.setOffline(false); const restored = createAccountSync(h.configuration); await restored.activate();
  assert.deepEqual(new Set(h.server().entries[key].value.favorites), new Set(['2079653665', '2114146440', '1451390674']));
  assert.deepEqual(restored.storage.getStorageSync(key), h.server().entries[key].value);
  assert.equal(restored.getStatus().pending, 0); restored.destroy();
});

test('an initial empty nursery snapshot cannot erase unseen cloud favorites and song edits stay separate from saved words', async () => {
  const key = schema.NURSERY_FAVORITES_KEY;
  const h = host({ user: { id: 'account-a' } }), c = h.controller;
  h.server().entries[key] = { value: { favorites: ['1451390672'] }, updatedAt: BASE - 100 };
  h.server().entries['lingotiles.progress.v1'] = { value: progress({ saved: ['apple'] }), updatedAt: BASE - 100 };
  let release; h.setHook(method => method === 'GET' ? new Promise(resolve => { release = resolve; }) : undefined);
  const initial = c.activate(); await pause();
  c.storage.setStorageSync(key, { favorites: [] });
  c.storage.setItem('lingotiles.progress.v1', JSON.stringify(progress({ saved: ['banana'] })));
  h.setHook(null); release(); await initial;
  assert.deepEqual(h.server().entries[key].value.favorites, ['1451390672']);
  assert.deepEqual(new Set(h.server().entries['lingotiles.progress.v1'].value.saved), new Set(['apple', 'banana']));
  c.storage.setStorageSync(key, { favorites: [] }); await c.flush();
  assert.deepEqual(h.server().entries[key].value.favorites, []);
  assert.deepEqual(new Set(h.server().entries['lingotiles.progress.v1'].value.saved), new Set(['apple', 'banana'])); c.destroy();
});

test('legacy nursery data upgrades only its original guest owner using a frozen snapshot', async () => {
  const key = schema.NURSERY_FAVORITES_KEY, local = schema.NURSERY_LOCAL_KEY;
  const legacy = { version: 1, favorites: ['1451390672'], mode: 'shuffle', recent: { id: '1451390672', time: 12 } };
  const h = host({ user: { id: 'account-b' }, storage: [[CLAIM_KEY, { userId: 'account-a', claimedAt: BASE - 1000, copyComplete: true }], [local, legacy]] }), c = h.controller;
  await c.activate();
  assert.equal(c.storage.getStorageSync(local), ''); assert.equal(c.storage.getStorageSync(key), '');
  assert.deepEqual(h.server().entries, {});
  h.setUser(null); await c.activate();
  assert.deepEqual(c.storage.getStorageSync(key), { favorites: ['1451390672'] });
  c.storage.setStorageSync(key, { favorites: ['2079653665'] });
  c.storage.setStorageSync(local, { ...legacy, favorites: [], recent: null });
  h.setUser('account-a'); await c.activate();
  assert.deepEqual(c.storage.getStorageSync(local), legacy);
  assert.deepEqual(h.server().entries[key].value, { favorites: ['1451390672'] });
  assert.equal(h.server().entries[local], undefined);
  assert.equal(h.values.get(CLAIM_KEY).nurseryCopyComplete, true);
  h.setUser(null); c.storage.setStorageSync(key, { favorites: [] });
  h.setUser('account-a'); await c.activate();
  assert.deepEqual(c.storage.getStorageSync(key), { favorites: ['1451390672'] }); c.destroy();
});

test('an interrupted legacy nursery upgrade retries its frozen data without overwriting existing scoped favorites', async () => {
  const key = schema.NURSERY_FAVORITES_KEY, local = schema.NURSERY_LOCAL_KEY;
  let rejectCopy = true;
  const h = host({ user: { id: 'account-a' }, storage: [[CLAIM_KEY, { userId: 'account-a', copyComplete: true }], [local, { version: 1, favorites: ['1451390672'], mode: 'shuffle' }]],
    failWrite: name => rejectCopy && name.includes('miniapp-data.v1:account-a:') }), c = h.controller;
  await c.activate(); assert.equal(h.values.get(CLAIM_KEY).nurseryCopyComplete, false);
  h.values.set(local, { version: 1, favorites: ['2079653665'], mode: 'sequence' });
  rejectCopy = false; await c.activate();
  assert.deepEqual(h.server().entries[key].value.favorites, ['1451390672']);
  c.storage.setStorageSync(key, { favorites: ['2114146440'] }); await c.flush();
  h.values.set(CLAIM_KEY, { userId: 'account-a', copyComplete: true }); c.destroy();
  const restored = createAccountSync(h.configuration); await restored.activate();
  assert.deepEqual(restored.storage.getStorageSync(key).favorites, ['2114146440']); restored.destroy();
});
