'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loadHub = import('../realtime/duel-hub.mjs');
const loadTicket = import('../web/duel-ticket.mjs');
const SECRET = 'test-only-online-duel-secret-at-least-32-characters';
const user = (digit, name) => ({ id: digit.repeat(32), displayName: name, avatarUrl: 'https://pocket.bornforthis.cn/avatars/' + digit + '.jpg' });
const A = user('a', '小红'), B = user('b', '小蓝'), C = user('c', '围观者');
async function harness() {
  const { DuelHub, LIMITS } = await loadHub;
  let time = 100000, sequence = 0;
  const events = [];
  const options = { now: () => time, random: () => 0, id: () => 'id-' + ++sequence, send: (id, value) => events.push({ id, value }) };
  const hub = new DuelHub(options);
  const receive = (who, value) => hub.receive(who.id, value);
  const last = (who, type) => events.filter(event => event.id === who.id && event.value.type === type).at(-1)?.value;
  function probe(who) { receive(who, { type: 'ping', id: ++sequence, clientAt: time }); time += 100; receive(who, { type: 'probe_ack', probeId: last(who, 'pong').probeId }); }
  function invite() { receive(A, { type: 'invite', userId: B.id }); return hub.state(B.id).invitation; }
  function accept() { const invitation = invite(); receive(B, { type: 'accept', invitationId: invitation.id }); return hub.rooms.get(hub.users.get(A.id).roomId); }
  function ready(room) {
    probe(A); probe(B);
    receive(A, { type: 'ready', rtt: 100, uncertainty: 50 }); receive(B, { type: 'ready', rtt: 100, uncertainty: 50 });
    return room;
  }
  function scheduled() { const room = ready(accept()); receive(A, { type: 'armed', roundId: room.roundId }); receive(B, { type: 'armed', roundId: room.roundId }); return room; }
  function setTime(value) {
    while (time + 1000 < value) {
      time += 1000;
      for (const entry of hActiveUsers()) receive(entry.user, { type: 'ping', id: ++sequence, clientAt: time });
    }
    time = value;
  }
  function hActiveUsers() { return [...hub.users.values()].filter(entry => ['arming', 'scheduled'].includes(hub.rooms.get(entry.roomId)?.phase)); }
  hub.connect(A); hub.connect(B); hub.connect(C);
  return { hub, LIMITS, options, events, receive, last, probe, invite, accept, ready, scheduled, get time() { return time; }, setTime, silentSetTime(value) { time = value; }, advance(ms) { setTime(time + ms); hub.tick(); } };
}

test('online invitations are atomic, private, role checked, expiring and reject busy/self/offline users', async () => {
  const h = await harness();
  h.receive(A, { type: 'invite', userId: A.id }); assert.equal(h.last(A, 'error').code, 'user_unavailable');
  const invitation = h.invite();
  assert.equal(h.hub.state(C.id).invitation, null);
  assert.equal(h.last(C, 'lobby').users.find(entry => entry.id === A.id).status, 'busy');
  h.receive(B, { type: 'invite', userId: A.id }); assert.equal(h.last(B, 'error').code, 'user_busy');
  h.receive(C, { type: 'accept', invitationId: invitation.id }); assert.equal(h.last(C, 'error').code, 'invitation_expired');
  h.receive(A, { type: 'accept', invitationId: invitation.id }); assert.equal(h.last(A, 'error').code, 'invitation_forbidden');
  h.advance(30000); assert.equal(h.hub.state(A.id).invitation, null); assert.equal(h.hub.rooms.size, 0);
  h.receive(A, { type: 'invite', userId: 'd'.repeat(32) }); assert.equal(h.last(A, 'error').code, 'user_unavailable');
});

test('accepted users receive random opposite colors and only participants see their room', async () => {
  const h = await harness(), room = h.accept();
  assert.deepEqual(room.players.map(player => player.color), ['red', 'blue']);
  assert.equal(h.hub.state(A.id).room.id, h.hub.state(B.id).room.id);
  assert.equal(h.hub.state(C.id).room, null);
  const fields = Object.keys(h.last(C, 'lobby').users[0]);
  assert.deepEqual(fields.sort(), ['avatarUrl', 'displayName', 'id', 'status']);
});

test('a round needs fresh measured clocks and both acknowledgements before scheduled GO', async () => {
  const h = await harness(), room = h.accept();
  for (const probeId of ['__proto__', 'constructor', 'toString', null]) h.receive(A, { type: 'probe_ack', probeId });
  h.receive(A, { type: 'ready', rtt: 10, uncertainty: 5 }); assert.equal(h.last(A, 'error').code, 'clock_unsynced');
  h.ready(room);
  assert.equal(room.phase, 'arming'); assert.equal(room.signalAt - room.startAt, 2000); assert.equal(room.startAt - h.time, 2000);
  h.receive(A, { type: 'armed', roundId: 'stale' }); assert.equal(room.armed.length, 0);
  h.receive(A, { type: 'armed', roundId: room.roundId }); assert.equal(room.phase, 'arming');
  h.receive(B, { type: 'armed', roundId: room.roundId }); assert.equal(room.phase, 'scheduled');
  assert.equal(h.hub.state(A.id).room.signalAt, h.hub.state(B.id).room.signalAt);
});

test('a missing/late arm aborts without a winner and both users may prepare again', async () => {
  const h = await harness(), room = h.ready(h.accept());
  h.receive(A, { type: 'armed', roundId: room.roundId });
  h.advance(1700); assert.equal(room.phase, 'aborted'); assert.equal(room.result.winnerId, null);
  const previous = room.roundId;
  h.ready(room); assert.equal(room.phase, 'arming'); assert.notEqual(room.roundId, previous);
});

test('reaction winner uses reconciled reaction time, not network arrival, with immutable first taps', async () => {
  const h = await harness(), room = h.scheduled();
  h.setTime(room.signalAt + 170); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 120 });
  h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 0 }); assert.equal(room.taps[A.id], 120);
  h.setTime(room.signalAt + 180); h.receive(B, { type: 'tap', roundId: room.roundId, reactionMs: 90 });
  assert.equal(room.phase, 'finished'); assert.equal(room.result.winnerId, B.id);
  assert.deepEqual(room.result.reactions, { [A.id]: 120, [B.id]: 90 });
  assert.equal(Object.hasOwn(h.hub.state(A.id).room, 'taps'), false);
});

test('near simultaneous clicks tie; early click loses; timeout settles once', async () => {
  for (const mode of ['tie', 'false', 'timeout', 'one-tap']) {
    const h = await harness(), room = h.scheduled();
    if (mode === 'false') {
      h.setTime(room.signalAt - 20); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: -70 });
      assert.equal(room.result.reason, 'false_start'); assert.equal(room.result.winnerId, B.id);
    } else if (mode === 'tie') {
      h.setTime(room.signalAt + 250); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 200 });
      h.setTime(room.signalAt + 260); h.receive(B, { type: 'tap', roundId: room.roundId, reactionMs: 210 });
      assert.equal(room.result.reason, 'tie'); assert.equal(room.result.winnerId, null);
    } else {
      if (mode === 'one-tap') { h.setTime(room.signalAt + 200); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 150 }); }
      h.setTime(room.signalAt + 5500); h.hub.tick();
      assert.equal(room.result.reason, mode === 'timeout' ? 'timeout' : 'reaction');
      assert.equal(room.result.winnerId, mode === 'timeout' ? null : A.id);
    }
    const result = structuredClone(room.result); h.advance(100); assert.deepEqual(room.result, result);
  }
});

test('implausible latency, leave and disconnect abort without awarding an online win', async () => {
  for (const mode of ['forged', 'leave', 'disconnect']) {
    const h = await harness(), room = h.scheduled();
    if (mode === 'forged') { h.setTime(room.signalAt + 1000); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 0 }); }
    else if (mode === 'leave') h.receive(A, { type: 'leave' });
    else h.hub.disconnect(A.id);
    assert.equal(room.phase, 'aborted'); assert.equal(room.result.winnerId, null); assert.equal(room.result.reason, 'aborted');
    h.receive(B, { type: 'tap', roundId: room.roundId, reactionMs: 1 }); assert.equal(room.result.winnerId, null);
  }
});

test('hibernation attachments preserve active room/taps and arm/timeout alarms, missing peers abort', async () => {
  const h = await harness(), room = h.scheduled();
  h.setTime(room.signalAt + 200); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 150 });
  const attachments = [A, B, C].map(who => h.hub.attachment(who.id));
  const { DuelHub } = await loadHub, restored = new DuelHub(h.options);
  restored.restore(attachments);
  assert.equal(restored.nextDeadline(), Math.min(room.signalAt + 5500, ...attachments.filter(item => item.room).map(item => item.lastSeen + h.LIMITS.activeStaleMs)));
  h.setTime(room.signalAt + 220); restored.receive(B.id, { type: 'tap', roundId: room.roundId, reactionMs: 180 });
  assert.equal(restored.state(A.id).room.result.winnerId, A.id);
  const missing = new DuelHub(h.options); missing.restore(attachments.filter(item => item.user.id !== A.id));
  assert.equal(missing.state(B.id).room.phase, 'aborted'); assert.equal(missing.state(B.id).room.result.winnerId, null);
});

test('heartbeat expiry removes online presence and ends pending invitations without a win', async () => {
  const h = await harness(); h.invite(); h.advance(35000);
  assert.equal(h.hub.users.size, 0); assert.equal(h.hub.invitations.size, 0); assert.equal(h.hub.nextDeadline(), null);
});

test('silent active peer expires before one-tap timeout settlement and awards no win', async () => {
  const h = await harness(), room = h.scheduled();
  h.setTime(room.signalAt + 150); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 100 });
  const peerLastSeen = h.hub.users.get(B.id).lastSeen;
  assert.equal(h.hub.nextDeadline(), peerLastSeen + h.LIMITS.activeStaleMs);
  // A keeps sending real messages; B silently loses its network without a
  // websocket close event. Check liveness before the later result deadline.
  for (let at = h.time + 1000; at < peerLastSeen + 3000; at += 1000) {
    h.silentSetTime(at); h.receive(A, { type: 'ping', id: at, clientAt: at });
  }
  h.silentSetTime(peerLastSeen + 3000); h.hub.tick();
  assert.equal(room.phase, 'aborted'); assert.equal(room.result.winnerId, null);
  assert.equal(h.hub.users.has(B.id), false);
  assert.ok(h.time < room.signalAt + 5500);
  h.silentSetTime(room.signalAt + 5500); h.hub.tick(); assert.equal(room.result.winnerId, null);
});

test('signed tickets are private-purpose, short-lived and reject tampering, wrong secret and invalid URL', async () => {
  const { issueDuelTicket, verifyDuelTicket, duelSocketUrl } = await loadTicket;
  const issued = await issueDuelTicket({ ...A, email: 'private@example.test', token: 'private-session' }, SECRET, 'wss://duel.example.test/connect', 100000);
  const verified = await verifyDuelTicket(issued.ticket, SECRET, 100100);
  assert.deepEqual(verified.user, A); assert.equal(issued.expiresAt, 160000);
  assert.equal(JSON.stringify(verified).includes('private'), false);
  for (const [ticket, secret, at] of [[issued.ticket + 'a', SECRET, 100100], [issued.ticket, SECRET + '-wrong', 100100], [issued.ticket, SECRET, 160000], [issued.ticket, SECRET, 90000]]) assert.equal(await verifyDuelTicket(ticket, secret, at), null);
  for (const url of ['https://duel.example/connect', 'wss://user:pass@duel.example/connect', 'wss://duel.example/connect?ticket=x', 'wss://duel.example/other']) assert.equal(duelSocketUrl(url), '');
});

test('account ticket endpoint authenticates existing sessions read-only and fails closed when unconfigured', async () => {
  const { createAccountApi } = await import('../web/account-api.mjs');
  const token = 'm1.' + A.id + '.' + '1'.repeat(64), prefix = 'users/v1/aa/' + A.id + '/';
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  const records = new Map([[prefix + 'profile.json', { ...A, email: 'private@example.test', status: 'active', avatar: { type: 'builtin', id: 1 } }], [prefix + 'sessions.json', { items: [{ hash: digest, expiresAt: null }] }]]);
  const handler = createAccountApi({ storeFactory: () => ({ read: async path => records.get(path), transaction: () => { throw Error('ticket must not write accounts'); } }), now: () => 100000 });
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: SECRET, DUEL_TICKET_SECRET: SECRET, DUEL_SOCKET_URL: 'wss://duel.example.test/connect' };
  const request = (auth = token) => new Request('https://pocket.bornforthis.cn/api/account/duel-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: '{}' });
  const result = await handler(request(), env); assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'no-store');
  const value = await result.json(); assert.ok(value.ticket); assert.equal(value.socketUrl, env.DUEL_SOCKET_URL);
  assert.equal((await handler(request(''), env)).status, 401);
  assert.equal((await handler(request(), { ...env, DUEL_TICKET_SECRET: '' })).status, 503);
  records.set(prefix + 'sessions.json', { items: [] }); assert.equal((await handler(request(), env)).status, 401);
});
