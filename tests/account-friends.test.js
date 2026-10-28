'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountClient, STORAGE_KEY } = require('../miniprogram/lib/account');
const SECRET = 'test-only-friend-service-secret-at-least32chars';
const clone = value => structuredClone(value);
const loaded = import('../web/account-api.mjs');
const friends = import('../web/account-friends.mjs');

async function host() {
  const { createAccountApi, accountInternals } = await loaded;
  const { friendsPath } = await friends;
  const state = { users: new Map(), data: new Map() }, commits = [], factories = [];
  let at = 1800000000000, queue = Promise.resolve();
  const storeFactory = (_env, { repository }) => {
    factories.push(repository);
    assert.ok(repository === 'users' || repository === 'data');
    return {
      async read(path) { return clone(state[repository].get(path) ?? null); },
      transaction(callback) {
        assert.equal(repository, 'data', 'friend operations must never mutate account credentials/profile records');
        const task = queue.then(async () => {
          const draft = clone(state.data), writes = [];
          const result = await callback({ get: async path => clone(draft.get(path) ?? null), put(path, value) { draft.set(path, clone(value)); writes.push(path); } });
          state.data = draft; if (writes.length) commits.push(writes); return result;
        });
        queue = task.catch(() => {}); return task;
      }
    };
  };
  const api = createAccountApi({ storeFactory, now: () => at });
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: SECRET };
  async function seed(number, username = 'player_' + number) {
    const id = number.toString(16).padStart(32, '0');
    const token = 'm1.' + id + '.' + (number % 16).toString(16).repeat(64);
    const prefix = 'users/v1/' + id.slice(0, 2) + '/' + id + '/';
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
    const profile = { schemaVersion: 1, id, username, displayName: '玩家' + number, email: 'private' + number + '@example.test', status: 'active', providers: ['wechat'], avatar: { type: 'builtin', id: 1 }, createdAt: at };
    state.users.set(prefix + 'profile.json', profile); state.users.set(prefix + 'sessions.json', { items: [{ hash, expiresAt: null }] });
    state.users.set(await accountInternals.indexPath(SECRET, 'username', username), { userId: id });
    return { id, token, profilePath: prefix + 'profile.json', profile };
  }
  async function call(who, route = '/friends', body) {
    const response = await api(new Request('https://pocket.bornforthis.cn/api/account' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(who ? { Authorization: 'Bearer ' + who.token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { status: response.status, value: await response.json() };
  }
  const [a, b, c] = await Promise.all([seed(1), seed(2), seed(3)]);
  return { a, b, c, call, state, commits, factories, seed, path: friendsPath, advance(ms) { at += ms; }, get at() { return at; } };
}
const failed = (result, status, code) => { assert.equal(result.status, status, JSON.stringify(result.value)); assert.equal(result.value.error, code); };
const request = (h, from = h.a, to = h.b) => h.call(from, '/friends/request', { userId: to.id });

test('friends require existing login and use only two per-user business documents for mutually accepted relationships', async () => {
  const h = await host(); failed(await h.call(null), 401, 'unauthorized');
  assert.deepEqual((await h.call(h.a)).value, { friends: [], incoming: [], outgoing: [], limits: { friends: 100, pending: 50 } });
  const sent = await request(h); assert.equal(sent.status, 200); assert.equal(sent.value.friends.length, 0);
  assert.equal(sent.value.outgoing[0].to.id, h.b.id); const id = sent.value.outgoing[0].id;
  const inbox = (await h.call(h.b)).value; assert.equal(inbox.incoming[0].id, id); assert.equal(inbox.incoming[0].from.id, h.a.id);
  assert.equal((await h.call(h.c)).value.incoming.length, 0);
  assert.deepEqual(h.commits[0].sort(), [h.path(h.a.id), h.path(h.b.id)].sort());
  const accepted = await h.call(h.b, '/friends/respond', { requestId: id, accept: true });
  assert.equal(accepted.status, 200); assert.equal(accepted.value.friends[0].user.id, h.a.id); assert.equal(accepted.value.incoming.length, 0);
  const a = (await h.call(h.a)).value; assert.equal(a.friends[0].user.id, h.b.id); assert.equal(a.outgoing.length, 0);
  assert.equal(h.state.data.size, 2); assert.ok(h.factories.includes('data'));
  const serialized = JSON.stringify([...h.state.data.values()]);
  for (const secret of ['private1@example.test', 'providers', 'password', 'sessions', h.a.token, 'openid']) assert.equal(serialized.includes(secret), false, secret);
  assert.deepEqual(Object.keys(a.friends[0].user).sort(), ['avatarUrl', 'displayName', 'id', 'username']);
});

test('only recipient can accept, repeated sends and accepted responses are idempotent, reverse requests do not silently accept', async () => {
  const h = await host(); const sent = await request(h), id = sent.value.outgoing[0].id;
  assert.equal((await request(h)).value.outgoing[0].id, id); assert.equal(h.commits.length, 1);
  failed(await h.call(h.a, '/friends/respond', { requestId: id, accept: true }), 404, 'friend_request_missing');
  failed(await h.call(h.c, '/friends/respond', { requestId: id, accept: true }), 404, 'friend_request_missing');
  failed(await request(h, h.b, h.a), 409, 'friend_request_received');
  await h.call(h.b, '/friends/respond', { requestId: id, accept: true }); const count = h.commits.length;
  assert.equal((await h.call(h.b, '/friends/respond', { requestId: id, accept: true })).status, 200); assert.equal(h.commits.length, count);
  failed(await h.call(h.b, '/friends/respond', { requestId: id, accept: false }), 409, 'friend_request_handled');
  assert.equal((await request(h)).value.outgoing.length, 0); assert.equal(h.commits.length, count);
});

test('decline, withdraw and remove update both participants without touching other friends or sync data', async () => {
  const h = await host(); const sync = { revision: 7, entries: { sound: false } }; h.state.data.set('existing-sync.json', sync);
  let sent = await request(h); await h.call(h.b, '/friends/respond', { requestId: sent.value.outgoing[0].id, accept: false });
  assert.equal((await h.call(h.a)).value.outgoing.length, 0); assert.equal((await h.call(h.b)).value.friends.length, 0);
  sent = await request(h); await h.call(h.a, '/friends/remove', { userId: h.b.id });
  assert.equal((await h.call(h.b)).value.incoming.length, 0);
  failed(await h.call(h.b, '/friends/respond', { requestId: sent.value.outgoing[0].id, accept: true }), 404, 'friend_request_missing');
  for (const peer of [h.b, h.c]) {
    sent = await request(h, h.a, peer); await h.call(peer, '/friends/respond', { requestId: sent.value.outgoing[0].id, accept: true });
  }
  await h.call(h.a, '/friends/remove', { userId: h.b.id });
  assert.deepEqual((await h.call(h.a)).value.friends.map(item => item.user.id), [h.c.id]);
  assert.equal((await h.call(h.b)).value.friends.length, 0); assert.equal((await h.call(h.c)).value.friends[0].user.id, h.a.id);
  const before = h.commits.length; await h.call(h.a, '/friends/remove', { userId: h.b.id }); assert.equal(h.commits.length, before);
  assert.deepEqual(h.state.data.get('existing-sync.json'), sync);
});

test('exact public username resolves case-insensitively; email, self, unknown, disabled and extra fields are refused', async () => {
  const h = await host();
  const found = await h.call(h.a, '/friends/request', { username: ' PLAYER_2 ' }); assert.equal(found.status, 200); assert.equal(found.value.outgoing[0].to.id, h.b.id);
  failed(await h.call(h.a, '/friends/request', { username: 'private2@example.test' }), 400, 'friend_user_invalid');
  failed(await h.call(h.a, '/friends/request', { email: 'private2@example.test' }), 400, 'invalid_fields');
  failed(await h.call(h.a, '/friends/request', { userId: h.a.id }), 400, 'friend_self');
  failed(await h.call(h.a, '/friends/request', { username: 'unknown_user' }), 404, 'friend_user_unavailable');
  failed(await h.call(h.a, '/friends/request', { userId: h.b.id, username: 'player_2' }), 400, 'friend_user_invalid');
  failed(await h.call(h.a, '/friends/request', { userId: '../private' }), 404, 'friend_user_unavailable');
  h.state.users.get(h.c.profilePath).status = 'disabled';
  failed(await request(h, h.a, h.c), 404, 'friend_user_unavailable');
  failed(await h.call(h.b, '/friends/respond', { requestId: crypto.randomUUID(), accept: 'yes' }), 400, 'friend_request_invalid');
});

test('seven-day pending expiry is enforced and public identity refreshes when the recipient accepts', async () => {
  const h = await host(); let sent = await request(h), id = sent.value.outgoing[0].id;
  h.state.users.get(h.b.profilePath).displayName = '已改昵称';
  await h.call(h.b, '/friends/respond', { requestId: id, accept: true });
  assert.equal((await h.call(h.a)).value.friends[0].user.displayName, '已改昵称');
  await h.call(h.a, '/friends/remove', { userId: h.b.id }); sent = await request(h); id = sent.value.outgoing[0].id;
  h.advance(7 * 86400000); assert.equal((await h.call(h.a)).value.outgoing.length, 0);
  failed(await h.call(h.b, '/friends/respond', { requestId: id, accept: true }), 404, 'friend_request_missing');
  assert.equal((await request(h)).status, 200);
});

test('successful new requests are bounded daily and concurrent requests serialize without losing either pair update', async () => {
  const h = await host(); const peers = await Promise.all(Array.from({ length: 21 }, (_, i) => h.seed(i + 10)));
  const first = await Promise.all(peers.slice(0, 2).map(peer => request(h, h.a, peer))); assert.ok(first.every(result => result.status === 200));
  for (const peer of peers.slice(2, 20)) assert.equal((await request(h, h.a, peer)).status, 200);
  failed(await request(h, h.a, peers[20]), 429, 'friend_rate_limited');
  assert.equal((await h.call(h.a)).value.outgoing.length, 20);
  for (const peer of peers.slice(0, 20)) assert.equal((await h.call(peer)).value.incoming[0].from.id, h.a.id);
  h.advance(86400000); assert.equal((await request(h, h.a, peers[20])).status, 200);
});

test('bounded documents fail closed on corruption and full friend or pending capacity does not partially write', async () => {
  const h = await host(); await request(h); const own = h.state.data.get(h.path(h.a.id));
  own.friends = Array.from({ length: 100 }, (_, i) => ({ user: { id: (i + 100).toString(16).padStart(32, '0'), displayName: '好友', avatarUrl: '', username: '' }, since: h.at }));
  const count = h.commits.length; failed(await request(h, h.a, h.c), 409, 'friends_full'); assert.equal(h.commits.length, count);
  own.friends = []; own.incoming = Array.from({ length: 49 }, (_, i) => ({ id: crypto.randomUUID(), from: { id: (i + 100).toString(16).padStart(32, '0'), displayName: '申请', avatarUrl: '', username: '' }, createdAt: h.at }));
  failed(await request(h, h.a, h.c), 409, 'friend_requests_full'); assert.equal(h.commits.length, count);
  own.schemaVersion = 99; failed(await h.call(h.a), 503, 'friends_data_invalid');
});

test('native friend methods keep bearer private and reject old-account results after account changes', async () => {
  const values = new Map([[STORAGE_KEY, { token: 'private-session', expiresAt: null, user: { id: 'me' } }]]), calls = [];
  const api = { getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value), removeStorageSync: key => values.delete(key), request: value => calls.push(value) };
  const client = createAccountClient({ wx: api });
  const actions = [() => client.readFriends(), () => client.requestFriend({ userId: 'peer' }), () => client.respondFriend('request', true), () => client.removeFriend('peer')];
  for (const action of actions) { const pending = action(), call = calls.at(-1); assert.equal(call.header.Authorization, 'Bearer private-session'); assert.equal(String(JSON.stringify(call.data)).includes('private-session'), false); call.success({ statusCode: 200, data: { friends: [], incoming: [], outgoing: [] } }); await pending; }
  assert.deepEqual(calls.map(value => value.url.split('/api/account')[1]), ['/friends', '/friends/request', '/friends/respond', '/friends/remove']);
  const read = client.readFriends(), logout = client.logout(); calls.at(-1).success({ statusCode: 200, data: { ok: true } }); await logout;
  calls.at(-2).success({ statusCode: 200, data: { friends: [{ id: 'stale-private-result' }] } });
  await assert.rejects(read, error => error.code === 'operation_canceled');
});
