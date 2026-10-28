'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnlineDuel } = require('../miniprogram/lib/online-duel');
const { createAccountClient, STORAGE_KEY } = require('../miniprogram/lib/account');

function host(options = {}) {
  let time = 1800000000000, next = 0, listener, autoPong = false;
  const tasks = new Map(), sent = [], sounds = [], changes = [], sockets = [];
  let user = options.guest ? null : { id: 'me', displayName: '自己', avatarUrl: '' };
  const auth = { getCachedUser: () => user, subscribe(fn) { listener = fn; return () => { listener = null; }; },
    createDuelTicket: options.ticket || (async () => ({ ticket: 'temporary-ticket', socketUrl: 'wss://duel.example.com/connect', expiresAt: time + 60000 })) };
  const wx = { connectSocket(request) {
    const handlers = {};
    const socket = { request, handlers, onMessage(fn) { handlers.message = fn; }, onError(fn) { handlers.error = fn; }, onClose(fn) { handlers.close = fn; }, send({ data }) {
      const value = JSON.parse(data); sent.push(value);
      if (autoPong && value.type === 'ping') handlers.message({ data: JSON.stringify({ ...value, type: 'pong', serverAt: value.clientAt + 9000, probeId: 'keepalive-' + next }) });
    }, close() { socket.closed = true; } };
    sockets.push(socket); return socket;
  } };
  const client = createOnlineDuel({ wx, account: auth, now: () => time, monotonicNow: () => time,
    setTimeout(fn, delay) { const id = ++next; tasks.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { tasks.delete(id); },
    onChange(state) { changes.push(state); }, onSound(type) { sounds.push({ type, at: time }); } });
  function advance(ms) {
    const target = time + ms;
    for (let n = 0; n < 10000; n++) {
      const entry = [...tasks.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      tasks.delete(entry[0]); time = entry[1].at; entry[1].fn();
    }
    time = target;
  }
  function receive(message, index = sockets.length - 1) { sockets[index].handlers.message({ data: JSON.stringify(message) }); }
  async function online(rtt = 40, skew = 9000) {
    await client.connect(); receive({ type: 'hello', user, serverAt: time + skew });
    for (let i = 0; i < 5; i++) {
      const ping = sent.filter(item => item.type === 'ping').at(-1);
      advance(rtt); receive({ type: 'pong', ...ping, type: 'pong', serverAt: ping.clientAt + rtt / 2 + skew, probeId: 'probe-' + i });
      advance(100);
    }
    autoPong = true;
  }
  const room = (phase = 'ready') => ({ id: 'room-1', players: [{ id: 'me', displayName: '自己', color: 'blue' }, { id: 'other', displayName: '对手', color: 'red' }], ready: [], phase, roundId: 'round-1', startAt: time + 9000 + 2000, signalAt: time + 9000 + 4000, result: null });
  return { client, auth, wx, tasks, sent, sounds, sockets, changes, advance, receive, online, room, get time() { return time; },
    stall(ms) { time += ms; for (const [id, value] of [...tasks]) if (value.at <= time) { tasks.delete(id); value.fn(); } },
    silence() { autoPong = false; },
    changeUser(value) { user = value; listener({ user }); } };
}

test('guest never requests a ticket or opens a socket; online ticket uses existing private account auth', async () => {
  const h = host({ guest: true }); await h.client.connect();
  assert.equal(h.client.snapshot().connection, 'login'); assert.equal(h.sockets.length, 0);
  const requests = [], values = new Map([[STORAGE_KEY, { token: 'private-token', user: { id: 'me' }, expiresAt: null }]]);
  const auth = createAccountClient({ wx: { getStorageSync: key => values.get(key), request(value) { requests.push(value); value.success({ statusCode: 200, data: { ticket: 'short-ticket', socketUrl: 'wss://duel.example.com/connect' } }); } } });
  await auth.createDuelTicket();
  assert.equal(requests[0].url.endsWith('/api/account/duel-ticket'), true);
  assert.equal(requests[0].header.Authorization, 'Bearer private-token');
  assert.equal(requests[0].method, 'POST');
  assert.equal(JSON.stringify(requests[0].data).includes('private-token'), false);
  h.client.dispose();
});

test('late ticket after leaving or changing account cannot create an online identity', async () => {
  let resolve;
  const h = host({ ticket: () => new Promise(done => { resolve = done; }) });
  const connecting = h.client.connect(); h.client.disconnect();
  resolve({ ticket: 'stale', socketUrl: 'wss://duel.example.com/connect', expiresAt: h.time + 10000 }); await connecting;
  assert.equal(h.sockets.length, 0); assert.equal(h.tasks.size, 0); h.client.dispose();
});

test('clock calibration corrects device skew and acknowledges server latency probes', async () => {
  const h = host(); await h.online();
  const state = h.client.snapshot(); assert.equal(state.connection, 'online'); assert.equal(state.syncReady, true);
  assert.equal(state.rtt, 40); assert.equal(state.uncertainty, 20);
  assert.equal(h.sent.filter(item => item.type === 'probe_ack').length, 5);
  h.receive({ type: 'lobby', users: [{ id: 'me', status: 'available' }, { id: 'other', displayName: '对手', status: 'busy' }] });
  assert.equal(h.client.snapshot().users.length, 1); assert.equal(h.client.snapshot().users[0].busy, true);
  h.client.dispose();
});

test('delayed schedule messages do not play GO on receipt; clock schedules both sounds and records first local tap', async () => {
  const h = host(); await h.online();
  const room = h.room('arming'), start = h.time + 2000, signal = h.time + 4000;
  h.receive({ type: 'state', room }); assert.equal(h.sent.at(-1).type, 'armed');
  h.advance(600); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  assert.equal(h.sounds.filter(item => item.type === 'go').length, 0);
  h.advance(start - h.time); assert.deepEqual(h.sounds.filter(item => item.type === 'start'), [{ type: 'start', at: start }]);
  h.advance(signal - h.time); assert.equal(h.client.snapshot().room.phase, 'go');
  assert.deepEqual(h.sounds.filter(item => item.type === 'go'), [{ type: 'go', at: signal }]);
  h.advance(173); assert.equal(h.client.tap(), true); h.advance(50); assert.equal(h.client.tap(), false);
  assert.deepEqual(h.sent.filter(item => item.type === 'tap'), [{ type: 'tap', roundId: 'round-1', reactionMs: 173 }]);
  assert.equal(h.client.snapshot().tapped, true); h.client.dispose();
});

test('tap before GO sends negative reaction for server false-start adjudication', async () => {
  const h = host(); await h.online(); const room = h.room('arming');
  h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  assert.equal(h.client.tap(), false); h.advance(2500); assert.equal(h.client.tap(), true);
  assert.equal(h.sent.at(-1).reactionMs, -1500); h.client.dispose();
});

test('minor timer jitter is excluded from reaction time and a substantially late cue aborts the round', async () => {
  for (const stall of [40, 140]) {
    const h = host(); await h.online(); const room = h.room('arming');
    h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
    h.advance(3990); h.stall(stall);
    if (stall === 40) { h.advance(173); h.client.tap(); assert.equal(h.sent.at(-1).reactionMs, 173); }
    else { assert.equal(h.client.snapshot().room, null); assert.equal(h.sent.some(value => value.type === 'leave'), true); assert.equal(h.sounds.some(value => value.type === 'go'), false); }
    h.client.dispose();
  }
});

test('silent active connection loss cancels a scheduled cue without requiring a socket close event', async () => {
  const h = host(); await h.online(); const room = h.room('arming');
  h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  h.silence(); h.advance(5000);
  assert.equal(h.client.snapshot().connection, 'error'); assert.equal(h.client.snapshot().room, null);
  assert.equal(h.sounds.some(value => value.type === 'go'), false); h.client.dispose();
});

test('invitation clock uses corrected server time and expires without resurrecting after disconnect', async () => {
  const h = host(); await h.online();
  h.receive({ type: 'state', room: null, invitation: { id: 'invite', from: { id: 'other' }, to: { id: 'me' }, expiresAt: h.time + 9000 + 30000 } });
  assert.equal(h.client.snapshot().invitation.direction, 'incoming'); assert.equal(h.client.snapshot().remainingSeconds, 30);
  h.advance(30000); assert.equal(h.client.snapshot().invitation, null);
  h.client.disconnect(); assert.equal(h.tasks.size, 0); h.client.dispose();
});

test('both-ready stays gated on acceptable synchronization; high-latency connections can still browse lobby', async () => {
  const h = host(); await h.online(500); h.receive({ type: 'state', room: h.room() });
  assert.equal(h.client.snapshot().syncReady, false); assert.equal(h.client.ready(), false);
  assert.equal(h.sent.some(item => item.type === 'ready'), false); h.client.dispose();
});

test('hide, dispose, account switch and connection loss cancel the scheduled signal and all timers', async () => {
  for (const action of ['disconnect', 'dispose', 'account', 'error']) {
    const h = host(); await h.online(); const room = h.room('arming');
    h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
    if (action === 'account') h.changeUser({ id: 'new-user' });
    else if (action === 'error') h.sockets[0].handlers.error({});
    else h.client[action]();
    h.advance(10000); assert.equal(h.sounds.some(item => item.type === 'go'), false, action);
    assert.equal(h.tasks.size, 0, action); assert.equal(h.sockets[0].closed, true);
    if (action !== 'dispose') h.client.dispose();
  }
});

test('a late arm schedule aborts safely and a completed round cancels all old signal timers', async () => {
  const h = host(); await h.online(); const late = { ...h.room('arming'), startAt: h.time + 9000 + 100 };
  h.receive({ type: 'state', room: late }); assert.equal(h.sent.at(-1).type, 'leave'); assert.equal(h.client.snapshot().room, null);
  const room = h.room('arming'); h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  h.receive({ type: 'state', room: { ...room, phase: 'finished', result: { reason: 'false_start', winnerId: 'other', reactions: { me: -1000 } } } });
  h.advance(5000); assert.equal(h.sounds.some(item => item.type === 'go'), false);
  assert.equal(h.client.snapshot().room.phase, 'result'); assert.equal(h.client.snapshot().room.players[0].reactionMs, -1000);
  h.client.dispose();
});

test('new connection rejects callbacks from a previous socket', async () => {
  const h = host(); await h.online(); const previous = h.sockets[0];
  await h.client.connect(); previous.handlers.close({});
  h.receive({ type: 'hello', user: { id: 'me' }, serverAt: h.time + 9000 }, 0);
  assert.equal(h.client.snapshot().connection, 'connecting'); h.client.dispose();
});

test('a send failure delivered by an old socket cannot close a newer connection', async () => {
  const h = host(); await h.online(); let fail;
  h.sockets[0].send = value => { fail = value.fail; };
  h.client.invite('other'); await h.client.connect(); fail();
  assert.equal(h.client.snapshot().connection, 'connecting'); assert.equal(h.sockets[1].closed, undefined);
  h.client.dispose();
});
