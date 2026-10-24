const test = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'test-only-account-hmac-secret-with-at-least-32-characters';
const PASSWORD = 'Test-only password 123!';
const MINUTE = 60000;
const DAY = 86400000;
const BASE = 'https://pocket.bornforthis.cn/api/account';
const modulePromise = import('../web/account-api.mjs');
const copy = value => structuredClone(value);

async function harness(overrides = {}) {
  const { createAccountApi, accountInternals } = await modulePromise;
  const state = { users: new Map(), data: new Map() };
  const queues = { users: Promise.resolve(), data: Promise.resolve() };
  const factoryCalls = [], deliveries = [], exchanges = [];
  let time = Date.UTC(2026, 9, 22, 1);
  let deliveryFailure = false;
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: SECRET, WECHAT_APP_ID: 'wx' + 'a'.repeat(16), WECHAT_APP_SECRET: 'test-only-wechat-secret' };
  const storeFactory = (_env, { repository }) => {
    assert.ok(Object.hasOwn(state, repository), 'repository boundary must be explicit');
    factoryCalls.push(repository);
    return {
      async read(path) { return state[repository].has(path) ? copy(state[repository].get(path)) : null; },
      transaction(callback) {
        const work = queues[repository].then(async () => {
          const draft = copy(state[repository]);
          const value = await callback({
            async get(path) { return draft.has(path) ? copy(draft.get(path)) : null; },
            put(path, data) { draft.set(path, copy(data)); },
            delete(path) { draft.delete(path); }
          });
          state[repository] = draft;
          return value;
        });
        queues[repository] = work.catch(() => {});
        return work;
      }
    };
  };
  const handler = createAccountApi({
    storeFactory,
    now: () => time,
    fetchImpl: async () => { throw new Error('tests must not use live providers'); },
    sendEmail: async value => {
      deliveries.push(copy(value));
      if (deliveryFailure) throw new Error('mail-provider-private-diagnostic');
    },
    exchangeWeChat: async code => {
      exchanges.push(code);
      return code.startsWith('same-') ? 'openid-same-user' : 'openid-' + code;
    },
    ...overrides
  });
  async function call(route, body, options = {}) {
    const { token, method = body === undefined ? 'GET' : 'POST', headers = {}, environment = env, rawBody, url = BASE + route } = options;
    const request = new Request(url, {
      method,
      headers: { 'CF-Connecting-IP': '203.0.113.1', ...(body === undefined && rawBody === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: rawBody === undefined ? JSON.stringify(body) : rawBody })
    });
    const response = await handler(request, environment);
    const value = response.status === 204 ? null : await response.json();
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { status: response.status, value, headers: response.headers };
  }
  async function code(email, purpose = 'register', token) {
    const result = await call('/email/code', { email, purpose }, { token });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(Object.hasOwn(result.value, 'code'), false);
    return deliveries.at(-1).code;
  }
  async function register(email = 'alice@example.test', username = 'Alice_1', password = PASSWORD) {
    const value = await code(email);
    const result = await call('/register', { email, username, password, code: value });
    assert.equal(result.status, 201, JSON.stringify(result.value));
    return result.value;
  }
  async function wechat(code = 'same-code') {
    const result = await call('/login/wechat', { code });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    return result.value;
  }
  return { call, code, register, wechat, state, env, deliveries, exchanges, factoryCalls, storeFactory, internals: accountInternals,
    advance(milliseconds) { time += milliseconds; }, get time() { return time; },
    failDelivery(value = true) { deliveryFailure = value; } };
}
function profiles(h) { return [...h.state.users.entries()].filter(([path]) => path.endsWith('/profile.json')); }
function assertFailure(result, status, error) { assert.equal(result.status, status, JSON.stringify(result.value)); assert.equal(result.value.error, error); }

test('real WeChat adapter uses Worker-compatible manual redirects and refuses upstream redirection', async () => {
  let requests = 0;
  for (const redirect of [false, true]) {
    const h = await harness({ exchangeWeChat: undefined, fetchImpl: async (input, options) => {
      requests += 1;
      const url = new URL(input);
      assert.equal(url.origin + url.pathname, 'https://api.weixin.qq.com/sns/jscode2session');
      assert.equal(options.redirect, 'manual', 'workerd does not implement redirect:error');
      return redirect ? new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } }) : Response.json({ openid: 'openid_worker_runtime_verified', session_key: 'server_only_test_session_key' });
    } });
    const result = await h.call('/login/wechat', { code: 'worker-runtime-test-code' });
    assert.equal(result.status, redirect ? 503 : 200);
    if (!redirect) {
      assert.deepEqual(result.value.user.providers, ['wechat']);
      assert.equal(JSON.stringify([...h.state.users]).includes('server_only_test_session_key'), false);
    }
  }
  assert.equal(requests, 2, 'neither response may trigger a second provider request');
});

test('registration creates an independent user directory and keeps credentials, codes and tokens out of public profiles', async () => {
  const h = await harness();
  const session = await h.register(' Alice@Example.test ', ' Alice_1 ');
  assert.equal(session.user.email, 'alice@example.test');
  assert.equal(session.user.username, 'alice_1');
  assert.match(session.user.id, /^[a-f0-9]{32}$/);
  assert.match(session.token, new RegExp('^m1\\.' + session.user.id + '\\.[a-f0-9]{64}$'));
  assert.equal(session.expiresAt, null);
  const prefix = 'users/v1/' + session.user.id.slice(0, 2) + '/' + session.user.id + '/';
  assert.ok(h.state.users.has(prefix + 'profile.json'));
  const credentials = h.state.users.get(prefix + 'credentials.json');
  assert.equal(credentials.password.algorithm, 'pbkdf2-sha256-hmac-v1');
  assert.match(credentials.password.salt, /^[a-f0-9]{32}$/);
  assert.match(credentials.password.hash, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify([...h.state.users]);
  assert.equal(credentials.passwordPlaintext, PASSWORD);
  for (const [path, value] of h.state.users) {
    if (!path.endsWith('/credentials.json')) assert.equal(JSON.stringify(value).includes(PASSWORD), false);
  }
  assert.equal(JSON.stringify(session).includes(PASSWORD), false);
  assert.equal(serialized.includes(session.token), false);
  assert.equal(JSON.stringify(session.user).includes(credentials.password.hash), false);
  assert.equal(h.state.data.size, 0);
});

test('email+password and username+password login normalize identifiers and return the same account', async () => {
  const h = await harness();
  const registered = await h.register();
  for (const identifier of [' ALICE@EXAMPLE.TEST ', ' ALICE_1 ']) {
    const result = await h.call('/login/password', { identifier, password: PASSWORD });
    assert.equal(result.status, 200);
    assert.equal(result.value.user.id, registered.user.id);
    assert.notEqual(result.value.token, registered.token);
  }
  const wrong = await h.call('/login/password', { identifier: 'alice_1', password: 'Wrong password 123' });
  const missing = await h.call('/login/password', { identifier: 'nobody_1', password: 'Wrong password 123' });
  assertFailure(wrong, 401, 'invalid_credentials');
  assert.deepEqual(missing.value, wrong.value);
  assert.equal(profiles(h).length, 1);
});

test('concurrent normalized registrations cannot create duplicate emails or usernames', async () => {
  const h = await harness();
  const code = await h.code('alice@example.test');
  const requests = [
    { email: 'alice@example.test', username: 'Alice_1', password: PASSWORD, code },
    { email: ' ALICE@EXAMPLE.TEST ', username: 'alice_1', password: PASSWORD, code }
  ];
  const results = await Promise.all(requests.map(body => h.call('/register', body)));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(profiles(h).length, 1);
  const other = await h.code('other@example.test');
  assertFailure(await h.call('/register', { email: 'other@example.test', username: 'ALICE_1', password: PASSWORD, code: other }), 409, 'username_taken');
  assert.equal(profiles(h).length, 1);
});

test('email verification codes are purpose-specific, single-use and work for email login', async () => {
  const h = await harness();
  const code = await h.code('alice@example.test', 'register');
  assertFailure(await h.call('/login/email', { email: 'alice@example.test', code }), 400, 'code_invalid');
  const registered = await h.call('/register', { email: 'alice@example.test', username: 'alice_1', password: PASSWORD, code });
  assert.equal(registered.status, 201);
  const loginCode = await h.code('alice@example.test', 'login');
  const loggedIn = await h.call('/login/email', { email: 'ALICE@example.test', code: loginCode });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.value.user.id, registered.value.user.id);
  assertFailure(await h.call('/login/email', { email: 'alice@example.test', code: loginCode }), 400, 'code_invalid');
});

test('codes expire at ten minutes and a newly sent code supersedes the prior challenge', async () => {
  const h = await harness();
  await h.register();
  const expired = await h.code('alice@example.test', 'login');
  h.advance(10 * MINUTE);
  assertFailure(await h.call('/login/email', { email: 'alice@example.test', code: expired }), 400, 'code_invalid');
  const fresh = await h.code('alice@example.test', 'login');
  const path = await h.internals.challengePath(SECRET, 'alice@example.test', 'login');
  assert.equal(h.state.users.get(path).attempts, 0);
  assert.equal(h.state.users.get(path).expiresAt, h.time + 10 * MINUTE);
  assert.equal((await h.call('/login/email', { email: 'alice@example.test', code: fresh })).status, 200);
});

test('five failed code attempts persist and block the correct code afterwards', async () => {
  const h = await harness();
  await h.register();
  const code = await h.code('alice@example.test', 'login');
  const wrong = code === '000000' ? '000001' : '000000';
  const path = await h.internals.challengePath(SECRET, 'alice@example.test', 'login');
  for (let count = 1; count <= 5; count += 1) {
    assertFailure(await h.call('/login/email', { email: 'alice@example.test', code: wrong }), 400, 'code_invalid');
    assert.equal(h.state.users.get(path).attempts, count);
  }
  assertFailure(await h.call('/login/email', { email: 'alice@example.test', code }), 400, 'code_invalid');
  assert.equal(h.state.users.get(path).attempts, 5);
});

test('mail challenges enforce a sixty-second cooldown and six sends per hour', async () => {
  const h = await harness();
  await h.code('alice@example.test');
  const cooldown = await h.call('/email/code', { email: 'alice@example.test', purpose: 'register' });
  assertFailure(cooldown, 429, 'code_cooldown');
  assert.equal(cooldown.headers.get('Retry-After'), '60');
  for (let count = 2; count <= 6; count += 1) { h.advance(MINUTE); await h.code('alice@example.test'); }
  h.advance(MINUTE);
  assertFailure(await h.call('/email/code', { email: 'alice@example.test', purpose: 'register' }), 429, 'rate_limited');
  assert.equal(h.deliveries.length, 6);
  h.advance(60 * MINUTE);
  await h.code('alice@example.test');
  assert.equal(h.deliveries.length, 7);
});

test('delivery failures leave no usable code and never expose provider diagnostics', async () => {
  const h = await harness();
  h.failDelivery();
  const result = await h.call('/email/code', { email: 'alice@example.test', purpose: 'register' });
  assertFailure(result, 503, 'email_unavailable');
  assert.equal(JSON.stringify(result.value).includes('mail-provider-private-diagnostic'), false);
  const code = h.deliveries.at(-1).code;
  const path = await h.internals.challengePath(SECRET, 'alice@example.test', 'register');
  assert.equal(h.state.users.get(path).delivered, false);
  assertFailure(await h.call('/register', { email: 'alice@example.test', username: 'alice_1', password: PASSWORD, code }), 400, 'code_invalid');
  assert.equal(profiles(h).length, 0);
});

test('more than ten permanent sessions remain valid and logout revokes just that session', async () => {
  const h = await harness();
  const sessions = [];
  for (let count = 0; count < 11; count += 1) sessions.push(await h.wechat('same-' + count));
  assert.equal(new Set(sessions.map(session => session.user.id)).size, 1);
  assert.equal((await h.call('/session', undefined, { token: sessions[0].token })).status, 200);
  assert.equal((await h.call('/session', undefined, { token: sessions[1].token })).status, 200);
  const path = h.internals.userPath(sessions[0].user.id, 'sessions');
  const stored = h.state.users.get(path);
  assert.equal(stored.items.length, 11);
  assert.ok(stored.items.every(item => item.expiresAt === null));
  assert.ok(stored.items.every(item => /^[a-f0-9]{64}$/.test(item.hash)));
  assert.equal(JSON.stringify(stored).includes(sessions[10].token), false);
  assert.equal((await h.call('/logout', {}, { token: sessions[10].token })).status, 200);
  assertFailure(await h.call('/session', undefined, { token: sessions[10].token }), 401, 'unauthorized');
  assert.equal((await h.call('/session', undefined, { token: sessions[1].token })).status, 200);
});

test('permanent sessions work years later while absent, unknown and malformed bearer tokens remain denied', async () => {
  const h = await harness();
  const session = await h.wechat();
  h.advance(5 * 366 * DAY);
  for (const token of [undefined, 'old-native-session', session.token.replace(/.$/, session.token.endsWith('0') ? '1' : '0')]) {
    assertFailure(await h.call('/session', undefined, { token }), 401, 'unauthorized');
    assertFailure(await h.call('/data', undefined, { token }), 401, 'unauthorized');
  }
  assert.equal(h.factoryCalls.includes('data'), false);
  const restored = await h.call('/session', undefined, { token: session.token });
  assert.equal(restored.status, 200);
  assert.equal(restored.value.expiresAt, null);
  assert.equal((await h.call('/data', undefined, { token: session.token })).status, 200);
  assert.equal((await h.call('/sync', undefined, { token: session.token })).status, 200);
});

test('WeChat automatic registration reuses one independent account for concurrent identical openids', async () => {
  const h = await harness();
  const sessions = await Promise.all([h.wechat('same-one'), h.wechat('same-two')]);
  assert.equal(sessions[0].user.id, sessions[1].user.id);
  assert.notEqual(sessions[0].token, sessions[1].token);
  assert.deepEqual(sessions[0].user.providers, ['wechat']);
  assert.equal(profiles(h).length, 1);
  assert.deepEqual(h.exchanges.sort(), ['same-one', 'same-two']);
  const serialized = JSON.stringify([...h.state.users]);
  assert.equal(serialized.includes('openid-same-user'), false);
  assert.equal(serialized.includes('same-one'), false);
  assert.equal(serialized.includes('test-only-wechat-secret'), false);
});

test('binding WeChat preserves password credentials, sessions and account data; later WeChat login reuses the account', async () => {
  const h = await harness();
  const owner = await h.register();
  const credentialsPath = h.internals.userPath(owner.user.id, 'credentials');
  const sessionsPath = h.internals.userPath(owner.user.id, 'sessions');
  const credentials = copy(h.state.users.get(credentialsPath)), sessions = copy(h.state.users.get(sessionsPath));
  const dataPath = h.internals.userPath(owner.user.id, 'sync');
  h.state.data.set(dataPath, { schemaVersion: 1, revision: 1, entries: {} });
  const data = copy(h.state.data);
  for (const code of ['same-bind-one', 'same-bind-two']) {
    const result = await h.call('/bind/wechat', { code }, { token: owner.token });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.user.id, owner.user.id);
    assert.deepEqual(result.value.user.providers, ['email', 'wechat']);
    assert.equal(result.value.user.email, owner.user.email);
    assert.equal(result.value.expiresAt, null);
    assert.equal(Object.hasOwn(result.value, 'token'), false);
    assert.equal(JSON.stringify(result.value).includes('openid'), false);
  }
  assert.deepEqual(h.state.users.get(credentialsPath), credentials);
  assert.deepEqual(h.state.users.get(sessionsPath), sessions);
  assert.deepEqual(h.state.data, data);
  assert.equal((await h.call('/session', undefined, { token: owner.token })).value.user.id, owner.user.id);
  const password = await h.call('/login/password', { identifier: owner.user.username, password: PASSWORD });
  assert.equal(password.status, 200);
  assert.equal(password.value.user.id, owner.user.id);
  const wechat = await h.wechat('same-later-login');
  assert.equal(wechat.user.id, owner.user.id);
  assert.equal(profiles(h).length, 1);
  const serialized = JSON.stringify([...h.state.users]);
  assert.equal(serialized.includes('openid-same-user'), false);
  assert.equal(serialized.includes('same-bind-one'), false);
});

test('WeChat binding authenticates before code exchange and rejects revoked sessions after exchange', async () => {
  const h = await harness();
  assertFailure(await h.call('/bind/wechat', { code: 'same-bind' }), 401, 'unauthorized');
  assert.equal(h.exchanges.length, 0);
  const owner = await h.register();
  await h.call('/logout', {}, { token: owner.token });
  assertFailure(await h.call('/bind/wechat', { code: 'same-bind' }, { token: owner.token }), 401, 'unauthorized');
  assert.equal(h.exchanges.length, 0);

  let release, started;
  const exchanging = new Promise(resolve => { started = resolve; });
  const racing = await harness({ exchangeWeChat: async () => { started(); await new Promise(resolve => { release = resolve; }); return 'openid-racing-bind'; } });
  const active = await racing.register();
  const binding = racing.call('/bind/wechat', { code: 'same-bind' }, { token: active.token });
  await exchanging;
  assert.equal((await racing.call('/logout', {}, { token: active.token })).status, 200);
  release();
  assertFailure(await binding, 401, 'unauthorized');
  assert.deepEqual(profiles(racing)[0][1].providers, ['email']);
  assert.equal([...racing.state.users.keys()].some(path => path.startsWith('indexes/v1/wechat/')), false);
});

test('binding cannot take over another WeChat identity or replace an existing binding', async () => {
  const h = await harness();
  const wechat = await h.wechat('same-original');
  const owner = await h.register();
  assertFailure(await h.call('/bind/wechat', { code: 'same-attempt' }, { token: owner.token }), 409, 'wechat_taken');
  assert.deepEqual((await h.call('/session', undefined, { token: owner.token })).value.user.providers, ['email']);
  assert.equal((await h.wechat('same-confirm')).user.id, wechat.user.id);
  const bound = await h.call('/bind/wechat', { code: 'unused-wechat' }, { token: owner.token });
  assert.equal(bound.status, 200);
  assertFailure(await h.call('/bind/wechat', { code: 'different-wechat' }, { token: owner.token }), 409, 'wechat_already_bound');
  assert.equal((await h.wechat('unused-wechat')).user.id, owner.user.id);
  assert.equal(profiles(h).length, 2);
});

test('concurrent WeChat binds select one account atomically and duplicate binds are idempotent', async () => {
  const h = await harness();
  const first = await h.register('first@example.test', 'first_1');
  const second = await h.register('second@example.test', 'second_1');
  const results = await Promise.all([
    h.call('/bind/wechat', { code: 'same-first' }, { token: first.token }),
    h.call('/bind/wechat', { code: 'same-second' }, { token: second.token })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200).value.user;
  assert.equal(results.find(result => result.status === 409).value.error, 'wechat_taken');
  assert.equal((await h.wechat('same-followup')).user.id, winner.id);
  const token = winner.id === first.user.id ? first.token : second.token;
  const duplicate = await Promise.all(['same-repeat-one', 'same-repeat-two'].map(code => h.call('/bind/wechat', { code }, { token })));
  assert.ok(duplicate.every(result => result.status === 200 && result.value.user.id === winner.id));
  assert.equal(profiles(h).length, 2);
});

test('email-binding challenges belong to their requesting WeChat user and preserve that identity', async () => {
  const h = await harness();
  const owner = await h.wechat('owner-code');
  const other = await h.wechat('other-code');
  assertFailure(await h.call('/email/code', { email: 'bound@example.test', purpose: 'bind' }), 401, 'unauthorized');
  const code = await h.code('bound@example.test', 'bind', owner.token);
  const body = { email: 'bound@example.test', username: 'Bound_1', password: PASSWORD, code };
  assertFailure(await h.call('/bind/email', body, { token: other.token }), 400, 'code_invalid');
  const bound = await h.call('/bind/email', body, { token: owner.token });
  assert.equal(bound.status, 200);
  assert.equal(bound.value.user.id, owner.user.id);
  assert.deepEqual(bound.value.user.providers, ['wechat', 'email']);
  const password = await h.call('/login/password', { identifier: 'bound_1', password: PASSWORD });
  assert.equal(password.status, 200);
  assert.equal(password.value.user.id, owner.user.id);
  assert.equal((await h.call('/session', undefined, { token: other.token })).value.user.email, '');
  assert.equal(profiles(h).length, 2);
});

test('binding an existing email cannot merge, replace or take over another account', async () => {
  const h = await harness();
  const existing = await h.register();
  const wechat = await h.wechat('different-user');
  const code = await h.code(existing.user.email, 'bind', wechat.token);
  assertFailure(await h.call('/bind/email', { email: existing.user.email, username: 'new_name', password: PASSWORD, code }, { token: wechat.token }), 409, 'email_taken');
  const unchanged = await h.call('/session', undefined, { token: wechat.token });
  assert.equal(unchanged.value.user.id, wechat.user.id);
  assert.equal(unchanged.value.user.email, '');
  const login = await h.call('/login/password', { identifier: existing.user.email, password: PASSWORD });
  assert.equal(login.value.user.id, existing.user.id);
  assert.equal(profiles(h).length, 2);
});

test('preferences use the business repository, enforce revisions and stay isolated between users', async () => {
  const h = await harness();
  const alice = await h.wechat('alice-code'), bob = await h.wechat('bob-code');
  assert.deepEqual((await h.call('/data', undefined, { token: alice.token })).value, { preferences: null });
  const written = await h.call('/data', { revision: 0, preferences: { soundEnabled: false, haptics: true } }, { method: 'PUT', token: alice.token });
  assert.equal(written.status, 200);
  assert.equal(written.value.preferences.revision, 1);
  assertFailure(await h.call('/data', { revision: 0, preferences: { soundEnabled: true } }, { method: 'PUT', token: alice.token }), 409, 'data_conflict');
  const read = await h.call('/data', undefined, { token: alice.token });
  assert.deepEqual(read.value, written.value);
  assert.deepEqual((await h.call('/data', undefined, { token: bob.token })).value, { preferences: null });
  assert.equal(h.state.data.size, 1);
  assert.equal([...h.state.users.keys()].some(path => path.endsWith('/preferences.json')), false);
  assert.ok([...h.state.data.keys()].every(path => path.endsWith('/' + alice.user.id + '/preferences.json')));
  const data = JSON.stringify([...h.state.data]);
  assert.equal(data.includes('credentials'), false);
  assert.equal(data.includes(alice.token), false);
  assert.equal(data.includes(bob.user.id), false);
});

test('preferences reject identity fields, foreign user selectors and invalid values without writing', async () => {
  const h = await harness();
  const user = await h.wechat();
  const bodies = [
    { revision: 0, preferences: { email: 'attacker@example.test' } },
    { revision: 0, preferences: { soundEnabled: 'true' } },
    { revision: -1, preferences: { soundEnabled: true } },
    { revision: 0, preferences: [] },
    { revision: 0, preferences: { soundEnabled: true }, userId: 'victim' },
    { revision: 0, preferences: { soundEnabled: true }, path: '../credentials.json' }
  ];
  for (const body of bodies) assert.equal((await h.call('/data', body, { method: 'PUT', token: user.token })).status, 400);
  assert.equal(h.state.data.size, 0);
});

test('registration validates email, username, password, code and unexpected fields before account writes', async () => {
  const h = await harness();
  const valid = { email: 'alice@example.test', username: 'alice_1', password: PASSWORD, code: '123456' };
  for (const changed of [
    { email: 'bad-address' }, { email: '.alice@example.test' }, { email: 'alice..x@example.test' },
    { username: '../admin' }, { username: '1234' }, { username: 'abc' },
    { password: 'short' }, { password: 'long\u0000password' }, { password: 'x'.repeat(129) },
    { code: '12345' }, { code: 123456 }, { isAdmin: true }
  ]) assert.equal((await h.call('/register', { ...valid, ...changed })).status, 400);
  assert.equal(profiles(h).length, 0);
  assert.equal(h.state.users.size, 0);
});

test('origin checks, method routing, preflight and malformed request bodies block unwanted requests', async () => {
  const h = await harness();
  assertFailure(await h.call('/session', undefined, { headers: { Origin: 'https://attacker.example' } }), 403, 'origin_forbidden');
  assertFailure(await h.call('/session', undefined, { url: 'https://attacker.example/api/account/session', headers: { Origin: 'https://pocket.bornforthis.cn' } }), 403, 'origin_forbidden');
  assertFailure(await h.call('/login', {}), 404, 'not_found');
  assertFailure(await h.call('/session?token=secret'), 404, 'not_found');
  assertFailure(await h.call('/session', {}, { method: 'POST' }), 405, 'method_not_allowed');
  const preflight = await h.call('/login/password', undefined, { method: 'OPTIONS', headers: { Origin: 'https://pocket.bornforthis.cn' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://pocket.bornforthis.cn');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST');
  for (const rawBody of ['{not-json', 'null', '[]', '"value"']) {
    assertFailure(await h.call('/register', undefined, { method: 'POST', rawBody }), 400, 'invalid_json');
  }
  assertFailure(await h.call('/register', undefined, { method: 'POST', rawBody: '{}', headers: { 'Content-Type': 'text/plain' } }), 415, 'json_required');
  assertFailure(await h.call('/register', undefined, { method: 'POST', rawBody: 'x'.repeat(8193) }), 413, 'body_too_large');
  assert.equal(h.state.users.size, 0);
});

test('disabled or incomplete environment stops before storage and internal failures are redacted', async () => {
  const h = await harness();
  for (const environment of [{}, { ACCOUNT_ENABLED: 'false', ACCOUNT_HMAC_SECRET: SECRET }, { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: 'short' }]) {
    assertFailure(await h.call('/session', undefined, { environment }), 503, 'account_unavailable');
  }
  assert.equal(h.factoryCalls.length, 0);
  const diagnostic = 'SECRET-PRIVATE-KEY-password-victim@example.test';
  const broken = await harness({ storeFactory() { throw new Error(diagnostic); } });
  const response = await broken.call('/session');
  assertFailure(response, 503, 'account_unavailable');
  assert.equal(JSON.stringify(response.value).includes(diagnostic), false);
  const exchange = await harness({ exchangeWeChat: async () => { throw new Error(diagnostic); } });
  const wx = await exchange.call('/login/wechat', { code: 'valid-test-code' });
  assertFailure(wx, 503, 'account_unavailable');
  assert.equal(JSON.stringify(wx.value).includes(diagnostic), false);
});

test('failed password attempts persist a per-identity limit and reset after fifteen minutes', async () => {
  const h = await harness();
  await h.register();
  for (let count = 0; count < 10; count += 1) {
    assertFailure(await h.call('/login/password', { identifier: 'alice_1', password: 'Wrong password 123' }), 401, 'invalid_credentials');
  }
  const blocked = await h.call('/login/password', { identifier: 'alice_1', password: PASSWORD });
  assertFailure(blocked, 429, 'rate_limited');
  assert.equal(blocked.headers.get('Retry-After'), '900');
  h.advance(15 * MINUTE);
  assert.equal((await h.call('/login/password', { identifier: 'alice_1', password: PASSWORD })).status, 200);
});


test('legacy dated sessions migrate without expiry or device eviction, and logout preserves other dated sessions', async () => {
  const h = await harness();
  const first = await h.wechat('same-legacy-first');
  const other = await h.wechat('same-legacy-other');
  const path = h.internals.userPath(first.user.id, 'sessions');
  const original = h.state.users.get(path);
  original.items[0].expiresAt = h.time - DAY;
  original.items[1].expiresAt = new Date(h.time - 2 * DAY).toISOString();
  h.state.users.set(path, original);
  h.advance(3 * 366 * DAY);
  const migrated = await h.call('/session', undefined, { token: first.token });
  assert.equal(migrated.status, 200);
  assert.equal(migrated.value.expiresAt, null);
  assert.equal(h.state.users.get(path).items.length, 2);
  assert.ok(h.state.users.get(path).items.every(item => item.expiresAt === null));
  const fresh = await h.wechat('same-legacy-fresh');
  assert.equal(fresh.expiresAt, null);
  assert.equal(h.state.users.get(path).items.length, 3);
  assert.equal((await h.call('/logout', {}, { token: first.token })).status, 200);
  assertFailure(await h.call('/session', undefined, { token: first.token }), 401, 'unauthorized');
  assert.equal((await h.call('/session', undefined, { token: other.token })).status, 200);
  assert.equal((await h.call('/session', undefined, { token: fresh.token })).status, 200);
  assert.equal(h.state.users.get(path).items.length, 2);
});

function sampleProgress() {
  return { completed: { '1': { stars: 3, bestScore: 100, bestTime: 12 } }, seen: ['apple', 'dict:example'], saved: ['apple'], sessions: 1, lastPlayed: '2026-10-22', streak: 1, lastResultId: 'round-one' };
}
function sampleCompletion(id = 'round-one') {
  return { id, levelId: 1, levelTitle: 'Words', mode: 'theme', wordCount: 6, gameSeconds: 12.5, studySeconds: 5, totalSeconds: 17.5, score: 100, stars: 3, assists: 0, completedAt: '2026-10-22T01:00:00.000Z' };
}
function sampleDuel(at) {
  return { targetScore: 3, haptics: true, soundEnabled: false, names: ['红方', '蓝方'], matches: [{ id: 'match-one', at, winner: 0, scores: [3, 2], bestMs: 123.5, names: ['红方', '蓝方'] }] };
}
function entry(value, updatedAt) { return { value, updatedAt }; }
async function putSync(h, token, revision, entries) { return h.call('/sync', { revision, entries }, { method: 'PUT', token }); }

test('sync stores typed allowlisted business entries in the independent Data user folder and preserves old preferences', async () => {
  const h = await harness();
  const session = await h.wechat();
  assert.deepEqual((await h.call('/sync', undefined, { token: session.token })).value, { revision: 0, entries: {} });
  const entries = {
    'brclio.duel.v1': entry(sampleDuel(h.time), h.time),
    RGD_CUSTOM_TITLE: entry('双人对决', h.time), RGD_P1_NAME: entry('Alice', h.time), RGD_P2_NAME: entry('Bob', h.time),
    RGD_MAX_WAIT: entry(6, h.time), RGD_TITLE_TS: entry(h.time, h.time), RGD_SOUND_ENABLED: entry(false, h.time),
    'lingotiles.progress.v1': entry(sampleProgress(), h.time),
    'lingotiles.preferences.v1': entry({ matchAnimation: true }, h.time),
    'lingotiles.native.reduce-motion.v1': entry(false, h.time),
    'lingotiles.history.v1': entry([sampleCompletion()], h.time)
  };
  const saved = await putSync(h, session.token, 0, entries);
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  assert.deepEqual(saved.value, { revision: 1, entries });
  assert.deepEqual((await h.call('/sync', undefined, { token: session.token })).value, saved.value);
  assert.ok(h.state.data.has(h.internals.userPath(session.user.id, 'sync')));
  assert.equal([...h.state.users.keys()].some(path => path.endsWith('/sync.json')), false);
  assert.deepEqual((await h.call('/data', undefined, { token: session.token })).value, { preferences: null });
  const legacy = await h.call('/data', { revision: 0, preferences: { haptics: false } }, { method: 'PUT', token: session.token });
  assert.equal(legacy.status, 200);
  assert.deepEqual((await h.call('/sync', undefined, { token: session.token })).value, saved.value);
  assert.equal(h.state.data.size, 2);
  const rawData = JSON.stringify([...h.state.data]);
  assert.equal(rawData.includes(session.token), false);
  assert.equal(rawData.includes('passwordPlaintext'), false);
});

test('sync CAS rejects a concurrent stale revision and later patches preserve existing keys', async () => {
  const h = await harness();
  const session = await h.wechat();
  const updates = await Promise.all([
    putSync(h, session.token, 0, { RGD_P1_NAME: entry('Alice', h.time) }),
    putSync(h, session.token, 0, { RGD_P2_NAME: entry('Bob', h.time) })
  ]);
  assert.deepEqual(updates.map(result => result.status).sort(), [200, 409]);
  assert.equal(updates.find(result => result.status === 409).value.error, 'sync_conflict');
  const current = await h.call('/sync', undefined, { token: session.token });
  const missing = Object.hasOwn(current.value.entries, 'RGD_P1_NAME') ? { RGD_P2_NAME: entry('Bob', h.time) } : { RGD_P1_NAME: entry('Alice', h.time) };
  const merged = await putSync(h, session.token, 1, missing);
  assert.equal(merged.status, 200);
  assert.equal(merged.value.revision, 2);
  assert.equal(merged.value.entries.RGD_P1_NAME.value, 'Alice');
  assert.equal(merged.value.entries.RGD_P2_NAME.value, 'Bob');
});

test('sync uses timestamps, retains deletion tombstones and does not write for an empty or older patch', async () => {
  const h = await harness();
  const session = await h.wechat();
  const saved = await putSync(h, session.token, 0, { RGD_CUSTOM_TITLE: entry('Keep newest', h.time) });
  assert.equal(saved.value.revision, 1);
  const older = await putSync(h, session.token, 1, { RGD_CUSTOM_TITLE: entry('Old device', h.time - 1) });
  assert.deepEqual(older.value, saved.value);
  assert.deepEqual((await putSync(h, session.token, 1, {})).value, saved.value);
  h.advance(1);
  const deleted = await putSync(h, session.token, 1, { RGD_CUSTOM_TITLE: entry(null, h.time) });
  assert.equal(deleted.value.revision, 2);
  assert.deepEqual(deleted.value.entries.RGD_CUSTOM_TITLE, { value: null, updatedAt: h.time });
  const stale = await putSync(h, session.token, 2, { RGD_CUSTOM_TITLE: entry('Resurrect old setting', h.time - 1) });
  assert.deepEqual(stale.value, deleted.value);
});

test('sync authenticates the session owner, isolates users and rejects caller-selected paths or identities', async () => {
  const h = await harness();
  const alice = await h.wechat('alice-sync'), bob = await h.wechat('bob-sync');
  assert.equal((await putSync(h, alice.token, 0, { RGD_P1_NAME: entry('Alice only', h.time) })).status, 200);
  assert.deepEqual((await h.call('/sync', undefined, { token: bob.token })).value, { revision: 0, entries: {} });
  assertFailure(await h.call('/sync'), 401, 'unauthorized');
  assert.equal((await h.call('/sync', { revision: 0, entries: {}, userId: alice.user.id }, { method: 'PUT', token: bob.token })).status, 400);
  assert.equal((await h.call('/sync', { revision: 0, entries: {}, path: '../credentials.json' }, { method: 'PUT', token: bob.token })).status, 400);
  assertFailure(await h.call('/sync?userId=' + alice.user.id, undefined, { token: bob.token }), 404, 'not_found');
  assert.equal(h.state.data.size, 1);
  assert.ok(h.state.data.has(h.internals.userPath(alice.user.id, 'sync')));
  assert.equal(h.state.data.has(h.internals.userPath(bob.user.id, 'sync')), false);
});

test('sync rejects account keys, rewards, password fields, unexpected nesting and invalid typed values', async () => {
  const h = await harness();
  const session = await h.wechat();
  const cases = [
    { 'brclio.miniapp-account.v1': entry({ token: session.token }, h.time) },
    { RGD_CUSTOM_REWARDS: entry(['private reward'], h.time) }, { RGD_CUSTOM_TS: entry(h.time, h.time) },
    { 'lingotiles.illustrations.pending.v1': entry([], h.time) },
    { 'brclio.duel.v1': entry({ ...sampleDuel(h.time), token: session.token }, h.time) },
    { 'brclio.duel.v1': entry({ ...sampleDuel(h.time), p1Password: 'private password' }, h.time) },
    { 'lingotiles.preferences.v1': entry({ matchAnimation: true, passwordPlaintext: PASSWORD }, h.time) },
    { RGD_CUSTOM_TITLE: entry({ nested: { token: 'private token' } }, h.time) },
    { 'lingotiles.progress.v1': entry(JSON.stringify(sampleProgress()), h.time) },
    { RGD_MAX_WAIT: entry(100, h.time) }, { RGD_SOUND_ENABLED: entry('true', h.time) },
    { 'lingotiles.history.v1': entry([sampleCompletion(), sampleCompletion()], h.time) },
    { 'lingotiles.history.v1': entry([{ ...sampleCompletion(), totalSeconds: 999 }], h.time) }
  ];
  for (const entries of cases) {
    const response = await putSync(h, session.token, 0, entries);
    assert.equal(response.status, 400, JSON.stringify(response.value));
    assert.equal(JSON.stringify(response.value).includes(session.token), false);
    assert.equal(JSON.stringify(response.value).includes(PASSWORD), false);
  }
  assert.equal(h.state.data.size, 0);
});

test('sync limits body and individual entry sizes, tree depth, timestamps and history window', async () => {
  const h = await harness();
  const session = await h.wechat();
  const tooLarge = await h.call('/sync', undefined, { method: 'PUT', token: session.token, rawBody: JSON.stringify({ revision: 0, entries: { RGD_CUSTOM_TITLE: entry('x'.repeat(256 * 1024), h.time) } }) });
  assertFailure(tooLarge, 413, 'body_too_large');
  const words = Array.from({ length: 4000 }, (_, index) => 'dict:word' + index + 'abcdefghij');
  const progress = { ...sampleProgress(), seen: words, saved: words };
  const encodedSize = Buffer.byteLength(JSON.stringify(progress));
  assert.ok(encodedSize > 200 * 1024 && encodedSize < 256 * 1024, 'fixture exercises per-entry limit below body limit');
  assertFailure(await putSync(h, session.token, 0, { 'lingotiles.progress.v1': entry(progress, h.time) }), 413, 'sync_data_too_large');
  for (const updatedAt of [-1, 1.5, h.time + 2 * DAY]) {
    assert.equal((await putSync(h, session.token, 0, { RGD_SOUND_ENABLED: entry(true, updatedAt) })).status, 400);
  }
  let nested = true;
  for (let depth = 0; depth < 12; depth += 1) nested = { nested };
  assert.equal((await putSync(h, session.token, 0, { 'lingotiles.preferences.v1': entry(nested, h.time) })).status, 400);
  const history = Array.from({ length: 201 }, (_, index) => sampleCompletion('round-' + index));
  assert.equal((await putSync(h, session.token, 0, { 'lingotiles.history.v1': entry(history, h.time) })).status, 400);
  assert.equal(h.state.data.size, 0);
});

test('corrupted or private fields already in a sync document never leak in GET responses', async () => {
  const h = await harness();
  const session = await h.wechat();
  const secret = 'private-storage-diagnostic-do-not-return';
  h.state.data.set(h.internals.userPath(session.user.id, 'sync'), { schemaVersion: 1, revision: 1, entries: { 'brclio.miniapp-account.v1': entry({ token: secret }, h.time) } });
  const response = await h.call('/sync', undefined, { token: session.token });
  assertFailure(response, 503, 'sync_unavailable');
  assert.equal(JSON.stringify(response.value).includes(secret), false);
  assert.equal(JSON.stringify(response.value).includes('brclio.miniapp-account.v1'), false);
});

test('native normalized business values match the backend contract, including older partial score settings', async () => {
  const h = await harness();
  const session = await h.wechat();
  const native = require('../miniprogram/lib/account-sync-schema');
  const backend = await import('../web/account-sync.mjs');
  assert.deepEqual([...native.SYNC_KEYS].sort(), [...backend.SYNC_KEYS].sort());
  assert.equal(native.MAX_REQUEST_BYTES, backend.MAX_SYNC_REQUEST_BYTES);
  const raw = {
    'brclio.duel.v1': { names: ['Alice', 'Bob'], futureLocalOnly: { privateValue: 'retained only on device' } },
    RGD_MAX_WAIT: '6', RGD_TITLE_TS: String(h.time), RGD_SOUND_ENABLED: true,
    'lingotiles.progress.v1': JSON.stringify(sampleProgress()),
    'lingotiles.preferences.v1': JSON.stringify({ matchAnimation: false, futureLocalOnly: true }),
    'lingotiles.history.v1': [sampleCompletion()]
  };
  const entries = {};
  for (const [key, value] of Object.entries(raw)) {
    const typed = native.normalizeValue(key, value);
    assert.notEqual(typed, undefined, key);
    entries[key] = entry(typed, h.time);
  }
  const result = await putSync(h, session.token, 0, entries);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.deepEqual(result.value.entries['brclio.duel.v1'].value, { names: ['Alice', 'Bob'] });
  assert.equal(JSON.stringify(result.value).includes('retained only on device'), false);
});
