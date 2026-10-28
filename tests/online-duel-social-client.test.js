'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnlineDuel } = require('../miniprogram/lib/online-duel');

const USER = { id: 'a'.repeat(32), displayName: '自己', username: 'me_public', avatarUrl: '' };
const PEER = { id: 'b'.repeat(32), displayName: '上次的昵称', username: 'friend_public', avatarUrl: 'https://pocket.example/old.png' };
const THIRD = { id: 'c'.repeat(32), displayName: '另一位好友', avatarUrl: '' };
const EMPTY = { friends: [], incoming: [], outgoing: [] };
const response = (...peers) => ({ friends: peers.map(user => ({ user, since: 1700000000000 })), incoming: [], outgoing: [] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function host() {
  let serverAt = 1800000000000, phoneSkew = 300000, next = 0, currentUser = USER, subscriber;
  const tasks = new Map(), sent = [], sockets = [], apiCalls = [], responses = [];
  const auth = {
    getCachedUser: () => currentUser,
    subscribe(fn) { subscriber = fn; return () => { subscriber = null; }; },
    createDuelTicket: async () => ({ ticket: 'short-lived-connect-only', socketUrl: 'wss://duel.example/connect', expiresAt: serverAt + 60000 })
  };
  for (const method of ['readFriends', 'requestFriend', 'respondFriend', 'removeFriend']) auth[method] = (...args) => {
    apiCalls.push({ method, args });
    return new Promise((resolve, reject) => responses.push({ method, resolve, reject }));
  };
  const client = createOnlineDuel({
    wx: { connectSocket(request) {
      const socket = { request, onMessage(fn) { this.message = fn; }, onError(fn) { this.error = fn; }, onClose(fn) { this.closeEvent = fn; },
        send({ data }) {
          const value = JSON.parse(data); sent.push(value);
          // The fake network has no transit delay. Both clocks nevertheless
          // differ by five minutes, including during the first hello/state.
          if (value.type === 'ping') this.message({ data: JSON.stringify({ ...value, type: 'pong', serverAt, probeId: 'probe-' + next }) });
        }, close() { this.closed = true; }
      };
      sockets.push(socket); return socket;
    } }, account: auth, now: () => serverAt + phoneSkew, monotonicNow: () => serverAt + phoneSkew,
    setTimeout(fn, delay) { const id = ++next; tasks.set(id, { fn, at: serverAt + delay }); return id; }, clearTimeout(id) { tasks.delete(id); }
  });
  function advance(ms) {
    const end = serverAt + ms;
    for (let n = 0; n < 10000; n++) {
      const entry = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      tasks.delete(entry[0]); serverAt = entry[1].at; entry[1].fn();
    }
    serverAt = end;
  }
  function receive(value, index = sockets.length - 1) { sockets[index].message({ data: JSON.stringify(value) }); }
  async function connect() {
    await client.connect(); receive({ type: 'hello', user: { id: currentUser.id, displayName: currentUser.displayName, avatarUrl: '' }, serverAt });
    advance(500); await flush();
  }
  return { client, auth, apiCalls, responses, sent, sockets, advance, receive, connect, get serverAt() { return serverAt; },
    changeUser(user) { currentUser = user; subscriber({ user }); }, setSkew(value) { phoneSkew = value; }
  };
}

test('friends load through the private account API once per connection and remain current through websocket presence without polling', async () => {
  const h = host(); await h.connect(); assert.deepEqual(h.apiCalls, [{ method: 'readFriends', args: [] }]);
  h.responses[0].resolve(response(PEER, THIRD)); await flush();
  let friends = h.client.snapshot().friends;
  assert.deepEqual(friends.map(friend => [friend.id, friend.online, friend.busy]), [[PEER.id, false, false], [THIRD.id, false, false]]);
  h.receive({ type: 'lobby', users: [{ ...USER, status: 'available' }, { ...PEER, displayName: '最新昵称', avatarUrl: 'https://pocket.example/new.png', status: 'busy' }] });
  friends = h.client.snapshot().friends;
  assert.equal(friends[0].displayName, '最新昵称'); assert.equal(friends[0].avatarUrl, 'https://pocket.example/new.png');
  assert.equal(friends[0].online, true); assert.equal(friends[0].busy, true); assert.equal(friends[1].online, false);
  h.advance(120000); await flush(); assert.equal(h.apiCalls.length, 1, 'heartbeats must not poll the GitHub-backed friend API');
  h.receive({ type: 'lobby', users: [USER] }); assert.equal(h.client.snapshot().friends[0].online, false); assert.equal(h.client.snapshot().friends[0].busy, false);
  h.client.dispose();
});

test('friend mutations use account payload contracts and update only from the latest complete snapshot', async () => {
  const h = host(); await h.connect(); h.responses[0].resolve(EMPTY); await flush();
  let action = h.client.requestFriend(PEER.id);
  assert.deepEqual(h.apiCalls.at(-1), { method: 'requestFriend', args: [{ userId: PEER.id }] });
  const incoming = { id: 'incoming-request', from: PEER, createdAt: h.serverAt };
  h.responses.at(-1).resolve({ ...EMPTY, incoming: [incoming] }); await action;
  assert.deepEqual(h.client.snapshot().friendRequests.incoming, [incoming]);
  action = h.client.respondFriend(incoming.id, true);
  assert.deepEqual(h.apiCalls.at(-1), { method: 'respondFriend', args: ['incoming-request', true] });
  h.responses.at(-1).resolve(response(PEER)); await action; assert.equal(h.client.snapshot().friends[0].id, PEER.id);
  action = h.client.respondFriend({ requestId: 'another-request', accept: false });
  assert.deepEqual(h.apiCalls.at(-1), { method: 'respondFriend', args: ['another-request', false] });
  h.responses.at(-1).resolve(response(PEER)); await action;
  action = h.client.removeFriend(PEER.id); assert.deepEqual(h.apiCalls.at(-1), { method: 'removeFriend', args: [PEER.id] });
  h.responses.at(-1).resolve(EMPTY); await action; assert.deepEqual(h.client.snapshot().friends, []);
  action = h.client.requestFriend({ username: 'friend_public' }); assert.deepEqual(h.apiCalls.at(-1), { method: 'requestFriend', args: [{ username: 'friend_public' }] });
  h.responses.at(-1).resolve(EMPTY); await action;
  assert.equal(h.sent.some(value => /friend/.test(value.type)), false, 'private relationship data does not go into the lobby protocol');
  h.client.dispose();
});

test('late initial friend GET cannot overwrite a newer mutation or its loading state', async () => {
  const h = host(); await h.connect(); const initial = h.responses[0];
  const action = h.client.requestFriend(PEER.id); assert.equal(h.client.snapshot().friendsLoading, true);
  h.responses[1].resolve(response(PEER)); await action;
  initial.resolve(response(THIRD)); await flush();
  assert.deepEqual(h.client.snapshot().friends.map(friend => friend.id), [PEER.id]);
  assert.equal(h.client.snapshot().friendsLoading, false); assert.equal(h.client.snapshot().friendError, '');
  h.client.dispose();
});

test('old-account friend data and errors are discarded after switch, logout, disconnect and dispose', async () => {
  for (const action of ['switch', 'logout', 'disconnect', 'dispose']) {
    const h = host(); await h.connect();
    const pending = h.client.refreshFriends(), request = h.responses.at(-1);
    if (action === 'switch') h.changeUser({ id: THIRD.id, displayName: THIRD.displayName });
    else if (action === 'logout') h.changeUser(null);
    else h.client[action]();
    request.resolve(response(PEER)); await pending;
    h.responses[0].reject(new Error('old account request error')); await flush();
    assert.deepEqual(h.client.snapshot().friends, [], action); assert.equal(h.client.snapshot().friendError, '', action);
    if (action !== 'dispose') h.client.dispose();
  }
});

test('friend request failures remain separate from the live game and can be explicitly refreshed', async () => {
  const h = host(); await h.connect(); h.responses[0].resolve(EMPTY); await flush();
  const action = h.client.requestFriend(PEER.id); h.responses.at(-1).reject(new Error('申请已满')); await action;
  assert.equal(h.client.snapshot().connection, 'online'); assert.equal(h.client.snapshot().friendError, '申请已满');
  const refreshed = h.client.refreshFriends(); assert.equal(h.apiCalls.at(-1).method, 'readFriends');
  h.responses.at(-1).resolve(response(PEER)); await refreshed; assert.equal(h.client.snapshot().friendError, '');
  h.client.dispose();
});

test('code creation, normalization and cancellation use the authenticated socket without transmitting account credentials', async () => {
  const h = host();
  assert.equal(h.client.createCode(), false); assert.equal(h.sent.length, 0);
  await h.connect(); h.responses[0].resolve(EMPTY); await flush();
  assert.equal(h.client.createCode(), true); assert.deepEqual(h.sent.at(-1), { type: 'create_code' });
  assert.equal(h.client.joinCode(' abcd2345 '), true); assert.deepEqual(h.sent.at(-1), { type: 'join_code', code: 'ABCD2345' });
  for (const invalid of ['ABCD1234', 'ABCDO234', 'ABC', 'ABCDEFGH123', '<script>']) {
    const before = h.sent.length; assert.equal(h.client.joinCode(invalid), false); assert.equal(h.sent.length, before);
  }
  assert.match(h.client.snapshot().error, /8 位/);
  assert.equal(h.client.cancelCode(), true); assert.deepEqual(h.sent.at(-1), { type: 'cancel_code' });
  assert.equal(JSON.stringify(h.sent).includes('short-lived-connect-only'), false); h.client.dispose();
});

test('server-owned code invitation restores after sharing reconnect even when the phone clock is ahead', async () => {
  const h = host(); await h.connect(); h.responses[0].resolve(EMPTY); await flush();
  const shareInvite = { code: 'ABCD2345', owner: USER, guest: null, expiresAt: h.serverAt + 600000, status: 'waiting' };
  h.receive({ type: 'state', room: null, invitation: null, shareInvite });
  assert.equal(h.client.snapshot().shareInvite.code, shareInvite.code); assert.equal(h.client.snapshot().shareRemainingSeconds, 600);
  h.client.disconnect(); h.advance(30000); assert.equal(h.client.snapshot().shareInvite, null);
  await h.connect(); h.responses.at(-1).resolve(EMPTY); await flush();
  h.receive({ type: 'state', room: null, invitation: null, shareInvite });
  assert.equal(h.client.snapshot().shareInvite.code, shareInvite.code); assert.ok(h.client.snapshot().shareRemainingSeconds >= 569 && h.client.snapshot().shareRemainingSeconds <= 570);
  const room = { id: 'paired-room', players: [{ ...USER, color: 'blue' }, { ...PEER, color: 'red' }], ready: [], phase: 'ready', result: null };
  h.receive({ type: 'state', room, invitation: null, shareInvite: null });
  assert.equal(h.client.snapshot().shareInvite, null); assert.equal(h.client.snapshot().room.id, room.id); assert.equal(h.client.snapshot().myColor, 'blue');
  h.client.dispose();
});

test('expired code and old socket states cannot restore a cancelled or replaced connection', async () => {
  const h = host(); await h.connect(); h.responses[0].resolve(EMPTY); await flush();
  h.receive({ type: 'state', room: null, shareInvite: { code: 'ABCD2345', owner: USER, expiresAt: h.serverAt + 1000 } });
  h.advance(1000); assert.equal(h.client.snapshot().shareInvite, null);
  await h.connect();
  h.receive({ type: 'state', room: null, shareInvite: { code: 'ABCD2345', owner: USER, expiresAt: h.serverAt + 600000 } }, 0);
  assert.equal(h.client.snapshot().shareInvite, null); assert.equal(h.client.snapshot().connection, 'online');
  h.responses.at(-1).resolve(EMPTY); await flush(); h.client.dispose();
});
