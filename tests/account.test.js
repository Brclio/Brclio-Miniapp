const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountClient, SESSION_KEY, HISTORY_KEY, RESTORE_KEY, API_ORIGIN } = require('../miniprogram/lib/account');
const token = 'fixture-shared-account-token-native';
const user = { id: 'user-a', username: 'fixture' };
const duel = { preferences: { targetScore: 3, haptics: true, names: ['红方', '蓝方'] }, matches: [
  { id: 'fixture:match-1', at: 1792500000000, names: ['红方', '蓝方'], winner: 0, scores: [3, 1], bestMs: 210 }
] };
const cloudValue = (data = {}) => ({ userId: user.id, appId: 'miniapp', version: 1, revision: 4, data, updatedAt: null });
function fixture(options = {}) {
  const storage = new Map([[SESSION_KEY, { token, user }], [HISTORY_KEY, { ...duel.preferences, matches: duel.matches, futureLocal: { preserved: true } }]]);
  const calls = [];
  const api = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (key === options.failKey) throw Error('storage full'); storage.set(key, structuredClone(value)); }, removeStorageSync: key => storage.delete(key),
    request(input) { calls.push(input); const result = options.handle ? options.handle(input) : { statusCode: 200, data: cloudValue() };
      if (result instanceof Promise) result.then(input.success); else input.success(result); } };
  return { storage, calls, api, client: createAccountClient(api) };
}
test('native shared login persists only its own session, sends no GitHub credential and restricts destinations', async () => {
  const f = fixture({ handle: () => ({ statusCode: 200, data: { token, user } }) });
  assert.equal((await f.client.login({ identifier: 'fixture', password: 'fixture-password' })).id, user.id);
  assert.equal(f.storage.get(SESSION_KEY).token, token);
  assert.equal(f.calls[0].url, API_ORIGIN + '/api/account/login');
  assert.equal(f.calls[0].header['X-Brclio-Client'], 'native');
  assert.equal(f.calls[0].header.Cookie, undefined);
  await assert.rejects(f.client.request('../anything', 'GET'));
  await assert.rejects(f.client.request('apps/other/data', 'GET'));
  assert.equal(f.calls.length, 1);
});
test('logout clears account session even offline and preserves all offline challenge data', async () => {
  const f = fixture({ handle: () => ({ statusCode: 503, data: { error: 'offline' } }) });
  const before = structuredClone(f.storage.get(HISTORY_KEY));
  await assert.rejects(f.client.logout(), /offline/);
  assert.equal(f.client.currentUser(), null); assert.equal(f.storage.get(SESSION_KEY).token, null);
  assert.equal(f.storage.get(SESSION_KEY).generation, 1);
  assert.deepEqual(f.storage.get(HISTORY_KEY), before);
});
test('manual backup sends revision and preserves unknown cloud fields and account isolation', async () => {
  const f = fixture({ handle: input => ({ statusCode: 200, data: { ...cloudValue(input.data.data), revision: input.data.revision + 1 } }) });
  const cloud = cloudValue({ futureApp: { keep: true }, duel: { futureDuel: 'keep', preferences: { futurePreference: 42 }, matches: [] } });
  await f.client.backup(cloud, f.client.localSnapshot());
  const sent = f.calls[0].data;
  assert.equal(sent.revision, 4); assert.deepEqual(sent.data.futureApp, { keep: true });
  assert.equal(sent.data.duel.futureDuel, 'keep'); assert.equal(sent.data.duel.preferences.futurePreference, 42);
  assert.deepEqual(sent.data.duel.matches, duel.matches);
  assert.equal(f.calls[0].header.Authorization, 'Bearer ' + token);
  await assert.rejects(f.client.backup({ ...cloud, userId: 'other-user' }, f.client.localSnapshot()), /账号.*已变化/);
  assert.equal(f.calls.length, 1);
});
test('revision conflicts never retry a write or overwrite local records', async () => {
  const f = fixture({ handle: () => ({ statusCode: 409, data: { error: 'revision conflict' } }) });
  const before = structuredClone(f.storage.get(HISTORY_KEY));
  await assert.rejects(f.client.backup(cloudValue(), f.client.localSnapshot()), error => error.status === 409);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.storage.get(HISTORY_KEY), before);
});
test('restore rechecks cloud and local versions, saves recovery copy, and preserves unknown local fields', async () => {
  const remote = { preferences: { ...duel.preferences, haptics: false }, matches: [] };
  const cloud = cloudValue({ duel: remote });
  const f = fixture({ handle: () => ({ statusCode: 200, data: cloud }) });
  const before = structuredClone(f.storage.get(HISTORY_KEY));
  await f.client.restore(cloud, f.client.localSnapshot());
  assert.deepEqual(f.storage.get(RESTORE_KEY).data, before);
  assert.deepEqual(f.storage.get(HISTORY_KEY).futureLocal, { preserved: true });
  assert.equal(f.storage.get(HISTORY_KEY).haptics, false); assert.deepEqual(f.storage.get(HISTORY_KEY).matches, []);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
});
test('restored 16-character names and future local fields survive shared and built-native gameplay saves and backup', async t => {
  const previousWx = Object.getOwnPropertyDescriptor(globalThis, 'wx');
  t.after(() => { if (previousWx) Object.defineProperty(globalThis, 'wx', previousWx); else delete globalThis.wx; });
  const factories = [require('../minigame/lib/game-app').createGameApp, require('../miniprogram/lib/duel').createGameApp];
  for (const createGameApp of factories) {
    const remote = { ...duel, preferences: { ...duel.preferences, names: ['ABCDEFGHIJKLMNOP', '蓝方'] } };
    const cloud = cloudValue({ duel: remote });
    const f = fixture({ handle: input => ({ statusCode: 200, data: input.method === 'PUT' ? { ...cloud, revision: cloud.revision + 1, data: input.data.data } : cloud }) });
    const before = structuredClone(f.storage.get(HISTORY_KEY));
    await f.client.restore(cloud, f.client.localSnapshot());
    const drawn = [];
    let touch;
    const ctx = new Proxy({ fillText: text => drawn.push(text) }, { get: (target, key) => key in target ? target[key] : () => {} });
    Object.assign(f.api, { createCanvas: () => ({ getContext: () => ctx }), getWindowInfo: () => ({ windowWidth: 390, windowHeight: 740, pixelRatio: 1 }), onTouchStart: callback => { touch = callback; } });
    globalThis.wx = f.api;
    const game = createGameApp(f.api, { initialScreen: 'duel' });
    try {
      assert.ok(drawn.includes(remote.preferences.names[0]), 'the game renders the complete restored name');
      touch({ changedTouches: [{ clientX: 278, clientY: 31 }] }); // Actual sound setting control persists a game patch.
      const stored = f.storage.get(HISTORY_KEY);
      assert.equal(stored.soundEnabled, false);
      assert.deepEqual(stored.names, remote.preferences.names);
      assert.deepEqual(stored.futureLocal, before.futureLocal);
      assert.deepEqual(f.storage.get(RESTORE_KEY).data, before);
      await f.client.backup(cloud, f.client.localSnapshot());
      assert.deepEqual(f.calls.at(-1).data.data.duel.preferences.names, remote.preferences.names);
    } finally { game.dispose(); }
  }
});
test('no restore mutation occurs after remote conflict, malformed data, local change or failed recovery save', async () => {
  for (const mode of ['conflict', 'malformed', 'local-change', 'storage-failure', 'foreign-user']) {
    const cloud = cloudValue({ duel });
    const f = fixture({ failKey: mode === 'storage-failure' ? RESTORE_KEY : undefined,
      handle: () => ({ statusCode: 200, data: mode === 'conflict' ? { ...cloud, revision: 5 } : mode === 'foreign-user' ? { ...cloud, userId: 'user-b' } : cloud }) });
    const snapshot = f.client.localSnapshot();
    if (mode === 'local-change') f.storage.set(HISTORY_KEY, { ...f.storage.get(HISTORY_KEY), haptics: false });
    if (mode === 'malformed') cloud.data.duel = { preferences: {}, matches: [] };
    const before = structuredClone(f.storage.get(HISTORY_KEY));
    await assert.rejects(f.client.restore(cloud, snapshot));
    assert.deepEqual(f.storage.get(HISTORY_KEY), before, mode);
  }
});
test('failed password verification keeps the current session and malformed local records cannot be silently dropped', async () => {
  const f = fixture({ handle: () => ({ statusCode: 401, data: { error: '当前密码不正确' } }) });
  await assert.rejects(f.client.request('password', 'POST', { currentPassword: 'wrong', newPassword: 'fixture-new-password' }));
  assert.equal(f.client.currentUser().id, user.id);
  f.storage.set(HISTORY_KEY, { matches: [null] });
  assert.throws(() => f.client.localSnapshot(), /不兼容/);
});
test('expired data-session and late cross-account responses cannot write another account data', async () => {
  const finishes = [];
  const f = fixture({ handle: () => new Promise(resolve => { finishes.push(resolve); }) });
  const pending = f.client.loadCloud();
  // Local logout wins while an earlier read is still in flight.
  const logout = f.client.logout();
  finishes[1]({ statusCode: 200, data: { ok: true } }); await logout;
  finishes[0]({ statusCode: 200, data: cloudValue({ duel }) });
  await assert.rejects(pending, /账号已变化/);
  const expired = fixture({ handle: () => ({ statusCode: 401, data: { error: 'expired' } }) });
  await assert.rejects(expired.client.loadCloud());
  assert.equal(expired.client.currentUser(), null);
});

function deferredFixture(authenticated = true) {
  const storage = new Map([[HISTORY_KEY, { ...duel.preferences, matches: duel.matches }]]);
  if (authenticated) storage.set(SESSION_KEY, { token, user });
  const requests = [];
  const api = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key),
    request(input) { const operation = { input, aborted: false }; requests.push(operation); return { abort() { operation.aborted = true; input.fail(); } }; } };
  const answer = (index, data, statusCode = 200) => requests[index].input.success({statusCode, data});
  return { storage, requests, api, answer, client: createAccountClient(api) };
}
const signedB = {token: 'fixture-second-account-native-token', user: {id: 'user-b', username: 'second-account'}};

test('a late login from an old client cannot overwrite the new client login persisted with a generation', async () => {
  const f = deferredFixture(false);
  const oldLogin = f.client.login({identifier: 'fixture-a', password: 'fixture-password'});
  const newClient = createAccountClient(f.api), newLogin = newClient.login({identifier: 'fixture-b', password: 'fixture-password'});
  f.answer(1, signedB); await newLogin;
  f.answer(0, {token, user}); await assert.rejects(oldLogin, /账号已变化/);
  assert.equal(f.storage.get(SESSION_KEY).user.id, 'user-b'); assert.equal(f.storage.get(SESSION_KEY).generation, 1);
  assert.equal(newClient.currentUser().id, 'user-b'); assert.equal(f.client.currentUser(), null);
});

test('old refresh, logout and unauthorized data replies cannot rewrite or clear a newer client session', async () => {
  for (const operation of ['refresh', 'logout', 'data-401', 'logout-offline']) {
    const f = deferredFixture();
    const oldRequest = operation === 'data-401' ? f.client.loadCloud() : operation === 'logout-offline' ? f.client.logout() : f.client[operation]();
    const newClient = createAccountClient(f.api), next = newClient.login({identifier: 'fixture-b', password: 'fixture-password'});
    f.answer(1, signedB); await next;
    const persisted = structuredClone(f.storage.get(SESSION_KEY));
    if (operation === 'logout-offline') f.requests[0].input.fail();
    else f.answer(0, operation === 'refresh' ? {user} : operation === 'data-401' ? {error: 'expired'} : {ok: true}, operation === 'data-401' ? 401 : 200);
    await assert.rejects(oldRequest);
    assert.deepEqual(f.storage.get(SESSION_KEY), persisted, operation);
    assert.equal(newClient.currentUser().id, 'user-b');
  }
});

test('a persisted logout tombstone prevents an old anonymous login from reviving after login and logout', async () => {
  const f = deferredFixture(false), oldLogin = f.client.login({identifier: 'fixture-a', password: 'fixture-password'});
  const current = createAccountClient(f.api), login = current.login({identifier: 'fixture-b', password: 'fixture-password'});
  f.answer(1, signedB); await login;
  const logout = current.logout(); f.answer(2, {ok: true}); await logout;
  const tombstone = structuredClone(f.storage.get(SESSION_KEY));
  assert.equal(tombstone.generation, 2); assert.equal(tombstone.token, null);
  f.answer(0, {token, user}); await assert.rejects(oldLogin, /账号已变化/);
  assert.deepEqual(f.storage.get(SESSION_KEY), tombstone);
});

test('dispose aborts native requests and late login or refresh results cannot persist a session', async () => {
  for (const operation of ['login', 'refresh']) {
    const f = deferredFixture(), before = structuredClone(f.storage.get(SESSION_KEY));
    const request = operation === 'login' ? f.client.login({identifier: 'fixture-b', password: 'fixture-password'}) : f.client.refresh();
    const rejected = assert.rejects(request, /页面已关闭/);
    f.client.dispose(); f.client.dispose(); await rejected;
    assert.equal(f.requests[0].aborted, true);
    f.answer(0, operation === 'login' ? signedB : {user});
    await Promise.resolve(); assert.deepEqual(f.storage.get(SESSION_KEY), before);
    await assert.rejects(f.client.loadCloud(), /页面已关闭/);
    assert.equal(f.requests.length, 1);
  }
});

test('dispose during restore verification prevents recovery-copy and local-history writes even if the GET escapes abort', async () => {
  const f = deferredFixture(), before = structuredClone(f.storage.get(HISTORY_KEY));
  const restore = f.client.restore(cloudValue({duel}), f.client.localSnapshot());
  const rejected = assert.rejects(restore, /页面已关闭/); f.client.dispose(); await rejected;
  f.answer(0, cloudValue({duel})); await Promise.resolve();
  assert.equal(f.storage.has(RESTORE_KEY), false); assert.deepEqual(f.storage.get(HISTORY_KEY), before);
});

test('successful HTTP backup replies require the expected owner, application, version and next revision', async () => {
  for (const invalid of [{userId: 'user-b'}, {appId: 'other'}, {version: 2}, {revision: 4}]) {
    const f = fixture({handle: input => ({statusCode: 200, data: {...cloudValue(input.data.data), revision: 5, ...invalid}})});
    const before = structuredClone(f.storage.get(HISTORY_KEY));
    await assert.rejects(f.client.backup(cloudValue(), f.client.localSnapshot()), /备份响应不兼容/);
    assert.deepEqual(f.storage.get(HISTORY_KEY), before);
  }
});
