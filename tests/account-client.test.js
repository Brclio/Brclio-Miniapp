'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountClient, STORAGE_KEY, REVOCATIONS_KEY, REQUEST_TIMEOUT, WECHAT_LOGIN_TIMEOUT } = require('../miniprogram/lib/account');
const NOW = Date.parse('2026-10-22T02:00:00Z');
const user = { id: 'usr_001', username: 'brclio', email: 'hello@example.com', displayName: '悦创', avatarUrl: '', providers: ['email'], createdAt: '2026-10-22T01:00:00Z' };
function host(options = {}) {
  let now = NOW;
  const values = new Map(options.storage || []), calls = [], pending = [];
  const wx = {
    getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key),
    request(request) { calls.push(request); if (options.pending) pending.push(request); else request.success({ statusCode: 200, data: { user: { ...user, password: 'server-secret', openid: 'private-wechat-id' }, token: 'session-token', expiresAt: new Date(now + 3600000).toISOString() } }); },
    login(request) { calls.push({ method: 'wx.login', timeout: request.timeout }); request.success({ code: 'one-time-wechat-code' }); }
  };
  const client = createAccountClient({ wx, config: options.config || { webOrigin: 'https://miniapp.example.com' }, now: () => now });
  return { client, wx, calls, values, pending, advance(ms) { now += ms; } };
}
function complete(request, body, statusCode = 200) { request.success({ statusCode, data: body }); }

test('all native login and registration methods use the dedicated account API and persist only the safe session', async () => {
  const h = host();
  const result = await h.client.register({ email: ' Hello@Example.COM ', username: ' Brclio ', password: '  secret  ', code: '012345' });
  assert.equal(h.calls[0].url, 'https://miniapp.example.com/api/account/register');
  assert.deepEqual(h.calls[0].data, { email: 'hello@example.com', username: 'brclio', password: '  secret  ', code: '012345' });
  assert.equal(h.calls[0].timeout, REQUEST_TIMEOUT);
  assert.equal(h.calls[0].header.Authorization, undefined);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'user']);
  const stored = h.values.get(STORAGE_KEY);
  assert.deepEqual(Object.keys(stored).sort(), ['expiresAt', 'token', 'user']);
  assert.equal(JSON.stringify(stored).includes('server-secret'), false);
  assert.equal(JSON.stringify(stored).includes('private-wechat-id'), false);
  assert.equal(JSON.stringify(stored).includes('012345'), false);
  assert.equal(JSON.stringify(stored).includes('  secret  '), false);
  await h.client.loginPassword(' BRCLIO ', '  secret  ');
  assert.deepEqual(h.calls.at(-1).data, { identifier: 'brclio', password: '  secret  ' });
  await h.client.loginPassword('HELLO@EXAMPLE.COM', 'password');
  assert.equal(h.calls.at(-1).data.identifier, 'hello@example.com');
  await h.client.loginEmail('Hello@Example.com', '000123');
  assert.equal(h.calls.at(-1).url.endsWith('/login/email'), true);
  assert.deepEqual(h.calls.at(-1).data, { email: 'hello@example.com', code: '000123' });
  await h.client.loginWechat();
  assert.equal(h.calls.at(-2).method, 'wx.login');
  assert.equal(h.calls.at(-2).timeout, WECHAT_LOGIN_TIMEOUT);
  assert.equal(REQUEST_TIMEOUT, 45000);
  assert.deepEqual(h.calls.at(-1).data, { code: 'one-time-wechat-code' });
  assert.equal(h.calls.at(-1).url.endsWith('/login/wechat'), true);
});

test('email code purposes stay explicit and binding is authenticated', async () => {
  const h = host();
  for (const purpose of ['register', 'login']) {
    await h.client.sendEmailCode(' Hello@Example.com ', purpose);
    assert.deepEqual(h.calls.at(-1).data, { email: 'hello@example.com', purpose });
    assert.equal(h.calls.at(-1).header.Authorization, undefined);
  }
  await assert.rejects(h.client.sendEmailCode('hello@example.com', 'bind'), /先登录/);
  await h.client.loginPassword('brclio', 'password');
  await h.client.sendEmailCode('hello@example.com', 'bind');
  assert.equal(h.calls.at(-1).header.Authorization, 'Bearer session-token');
  await h.client.bindEmail({ email: 'hello@example.com', username: 'brclio', password: 'password', code: '123456' });
  assert.equal(h.calls.at(-1).url.endsWith('/bind/email'), true);
  assert.equal(h.calls.at(-1).header.Authorization, 'Bearer session-token');
});

test('session restoration uses bearer auth and old expiry dates do not end a permanent login', async () => {
  const old = { token: 'old-shared-token', user: { id: 'legacy' } };
  const h = host({ storage: [[STORAGE_KEY, { token: 'restored-token', user, expiresAt: new Date(NOW + 1000).toISOString() }], ['brclio.shared-account.v1', old], ['brclio.duel.v1', { local: true }]] });
  assert.equal(h.calls.length, 0);
  assert.equal(h.client.getCachedUser().id, user.id);
  await h.client.refreshSession();
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.calls[0].header.Authorization, 'Bearer restored-token');
  assert.equal(h.calls[0].url.endsWith('/session'), true);
  h.advance(3600001);
  assert.equal(h.client.getCachedUser().id, user.id);
  assert.equal(h.values.has(STORAGE_KEY), true);
  assert.deepEqual(h.values.get('brclio.shared-account.v1'), old);
  assert.deepEqual(h.values.get('brclio.duel.v1'), { local: true });
});

test('guest restoration does not call the network and invalid sessions are discarded', async () => {
  const h = host();
  assert.equal(await h.client.refreshSession(), null);
  assert.equal(h.calls.length, 0);
  const invalid = host({ storage: [[STORAGE_KEY, { token: 'bad-token', user, expiresAt: 'not-a-date' }]] });
  assert.equal(invalid.client.getCachedUser(), null);
  assert.equal(invalid.values.has(STORAGE_KEY), false);
});

test('401 expires the active session; offline errors retain it and logout always clears it', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'restored-token', user, expiresAt: new Date(NOW + 3600000).toISOString() }]] });
  const refresh = h.client.refreshSession();
  h.pending[0].fail({ errMsg: 'network contains private diagnostics' });
  await assert.rejects(refresh, /连接失败/);
  assert.equal(h.client.getCachedUser().id, user.id);
  const revoked = h.client.refreshSession();
  complete(h.pending[1], { error: 'session_expired', message: '登录已过期。' }, 401);
  assert.equal(await revoked, null);
  assert.equal(h.client.getCachedUser(), null);
  const login = h.client.loginPassword('brclio', 'password');
  complete(h.pending[2], { user, token: 'new-token', expiresAt: new Date(NOW + 3600000).toISOString() }); await login;
  const logout = h.client.logout();
  assert.equal(h.client.getCachedUser(), null);
  assert.equal(h.values.has(STORAGE_KEY), false);
  h.pending[3].fail({}); await assert.rejects(logout, /连接失败/);
  assert.equal(h.pending[3].header.Authorization, 'Bearer new-token');
});

test('late session refresh cannot restore an account after logout', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'restored-token', user, expiresAt: new Date(NOW + 3600000).toISOString() }]] });
  const refresh = h.client.refreshSession(), duplicate = h.client.refreshSession();
  assert.equal(h.pending.length, 1);
  const logout = h.client.logout();
  complete(h.pending[1], { ok: true }); await logout;
  complete(h.pending[0], { user, expiresAt: new Date(NOW + 3600000).toISOString() });
  assert.equal(await refresh, null); assert.equal(await duplicate, null);
  assert.equal(h.client.getCachedUser(), null);
});

test('invalid registration fields and destination URLs never send credentials', async () => {
  const h = host();
  const valid = { email: 'hello@example.com', username: 'brclio', password: 'password', code: '123456' };
  for (const change of [{ email: 'invalid' }, { username: '1name' }, { username: 'abc' }, { username: 'a'.repeat(25) }, { password: 'short' }, { password: '1234567\n' }, { code: '12345' }]) await assert.rejects(h.client.register({ ...valid, ...change }));
  await assert.rejects(h.client.sendEmailCode('hello@example.com', 'password-reset'));
  assert.equal(h.calls.length, 0);
  for (const accountBase of ['http://miniapp.example.com/api/account', 'https://user:pass@miniapp.example.com/api/account', 'https://miniapp.example.com/api/account?redirect=other', 'https://miniapp.example.com/api/account/../other', 'https://miniapp.example.com\\@evil.test/api/account']) {
    const unsafe = host({ config: { accountBase } });
    await assert.rejects(unsafe.client.register(valid), /暂时不可用/);
    assert.equal(unsafe.calls.length, 0);
  }
});

test('safe server errors preserve cooldown and malformed authentication never replaces the active account', async () => {
  const h = host({ pending: true });
  const sending = h.client.sendEmailCode('hello@example.com', 'login');
  complete(h.pending[0], { error: 'too_many_requests', message: '请稍后再试。', retryAfter: 45 }, 429);
  await assert.rejects(sending, error => error.code === 'too_many_requests' && error.retryAfter === 45);
  const login = h.client.loginEmail('hello@example.com', '123456');
  complete(h.pending[1], { user, token: 'invalid-expiry', expiresAt: 'not-a-date' });
  await assert.rejects(login, /登录结果/);
  assert.equal(h.client.getCachedUser(), null);
});

test('numeric creation dates and millisecond expiries returned by the account service survive restoration', async () => {
  const h = host({ pending: true });
  const login = h.client.loginEmail('hello@example.com', '123456');
  complete(h.pending[0], { user: { ...user, createdAt: NOW }, token: 'numeric-session', expiresAt: NOW + 30 * 86400000 });
  const result = await login;
  assert.equal(result.user.createdAt, NOW);
  assert.equal(result.expiresAt, NOW + 30 * 86400000);
  assert.equal(h.client.getCachedUser().createdAt, NOW);
});

test('logout during the WeChat code exchange cancels the pending authentication before credential transmission', async () => {
  const h = host(); let finish;
  h.wx.login = request => { finish = request.success; };
  const login = h.client.loginWechat();
  await h.client.logout();
  finish({ code: 'pending-code' });
  await assert.rejects(login, error => error.code === 'operation_canceled');
  assert.equal(h.calls.length, 0);
  assert.equal(h.client.getCachedUser(), null);
});


test('permanent sessions accept null expiry and legacy timestamps without exposing bearer tokens in lifecycle events', async () => {
  const h = host({ pending: true }); const events = [];
  const unsubscribe = h.client.subscribe(value => events.push(value));
  const login = h.client.loginPassword('brclio', 'password');
  complete(h.pending[0], { user, token: 'permanent-token', expiresAt: null }); await login;
  h.advance(365 * 86400000); assert.equal(h.client.getCachedUser().id, user.id);
  assert.deepEqual(h.client.getSessionSnapshot(), { user, expiresAt: null });
  assert.equal(JSON.stringify(events).includes('permanent-token'), false);
  assert.equal(events[0].reason, 'login'); unsubscribe();
  const refresh = h.client.refreshSession(); complete(h.pending[1], { user, expiresAt: null }); await refresh;
  assert.equal(events.length, 1);
});

test('authed sync methods attach the current session and reject stale account responses', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'a-token', user, expiresAt: null }]] });
  const read = h.client.readSync(); assert.equal(h.pending[0].url.endsWith('/sync'), true); assert.equal(h.pending[0].header.Authorization, 'Bearer a-token');
  const payload = { revision: 0, entries: { RGD_MAX_WAIT: { value: 8, updatedAt: NOW } } };
  const write = h.client.writeSync(payload); assert.equal(h.pending[1].method, 'PUT'); assert.deepEqual(h.pending[1].data, payload);
  complete(h.pending[1], { revision: 1, entries: payload.entries }); assert.equal((await write).revision, 1);
  const replacement = h.client.loginPassword('brclio', 'password');
  complete(h.pending[2], { user: { ...user, id: 'usr_other' }, token: 'b-token', expiresAt: null }); await replacement;
  complete(h.pending[0], { revision: 5, entries: {} }); await assert.rejects(read, error => error.code === 'operation_canceled');
  assert.equal(h.client.getCachedUser().id, 'usr_other');
});

test('offline logout queues durable revocation; retry on a new login cannot let an old 401 clear the new account', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'a-token', user, expiresAt: null }]] });
  const logout = h.client.logout(); assert.equal(h.client.getCachedUser(), null);
  h.pending[0].fail({}); await assert.rejects(logout, /连接失败/);
  assert.equal(h.values.get(REVOCATIONS_KEY)[0].token, 'a-token');
  const restored = host({ pending: true, storage: [...h.values] });
  const login = restored.client.loginPassword('brclio', 'password');
  complete(restored.pending[0], { user: { ...user, id: 'usr_other' }, token: 'b-token', expiresAt: null }); await login;
  const flushing = restored.client.flushRevocations();
  assert.equal(restored.pending[1].header.Authorization, 'Bearer a-token');
  complete(restored.pending[1], { error: 'unauthorized', message: '已退出。' }, 401);
  assert.deepEqual(await flushing, { pending: 0 }); assert.equal(restored.client.getCachedUser().id, 'usr_other');
  assert.deepEqual(restored.values.get(REVOCATIONS_KEY), []);
});

test('successful logout revokes the bearer session and removes its durable queue entry', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'a-token', user, expiresAt: null }]] });
  const events = []; h.client.subscribe(event => events.push(event));
  const logout = h.client.logout(); assert.equal(h.client.getCachedUser(), null); assert.equal(h.values.get(REVOCATIONS_KEY).length, 1);
  complete(h.pending[0], { ok: true }); await logout;
  assert.deepEqual(h.values.get(REVOCATIONS_KEY), []); assert.equal(JSON.stringify(events).includes('a-token'), false);
  assert.deepEqual(await h.client.flushRevocations(), { pending: 0 }); assert.equal(h.pending.length, 1);
});


test('a queued logout remains logged out across restart even if removing the old storage key failed', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'a-token', user, expiresAt: null }]] });
  h.wx.removeStorageSync = () => { throw new Error('remove denied'); };
  const logout = h.client.logout(); h.pending[0].fail({}); await assert.rejects(logout);
  assert.equal(h.values.has(STORAGE_KEY), true);
  const restored = host({ storage: [...h.values] }); assert.equal(restored.client.getCachedUser(), null);
});


test('binding email upgrades an older dated session to a null permanent expiry', async () => {
  const h = host({ pending: true, storage: [[STORAGE_KEY, { token: 'wechat-token', user: { ...user, email: '', username: '', providers: ['wechat'] }, expiresAt: NOW - 1000 }]] });
  const binding = h.client.bindEmail({ email: 'hello@example.com', username: 'brclio', password: 'password', code: '123456' });
  complete(h.pending[0], { user: { ...user, providers: ['email', 'wechat'] }, expiresAt: null });
  const result = await binding; assert.equal(result.expiresAt, null); assert.equal(h.values.get(STORAGE_KEY).expiresAt, null); assert.equal(h.values.get(STORAGE_KEY).token, 'wechat-token');
});
