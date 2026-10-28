'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnlineDuel } = require('../miniprogram/lib/online-duel');
const { createAccountClient, STORAGE_KEY } = require('../miniprogram/lib/account');

function host(options = {}) {
  let time = 1800000000000, next = 0, listener, networkListener, autoPong = false;
  const tasks = new Map(), sent = [], sounds = [], changes = [], sockets = [];
  let user = options.guest ? null : { id: 'me', displayName: '自己', avatarUrl: '' };
  const auth = { getCachedUser: () => user, subscribe(fn) { listener = fn; return () => { listener = null; }; },
    createDuelTicket: options.ticket || (async () => ({ ticket: 'temporary-ticket', socketUrl: 'wss://duel.example.com/connect', expiresAt: time + 60000 })) };
  const wx = { onNetworkStatusChange(fn) { networkListener = fn; }, offNetworkStatusChange(fn) { if (networkListener === fn) networkListener = null; }, connectSocket(request) {
    const handlers = {};
    const socket = { request, handlers, onMessage(fn) { handlers.message = fn; }, onError(fn) { handlers.error = fn; }, onClose(fn) { handlers.close = fn; }, send({ data }) {
      const value = JSON.parse(data); sent.push(value);
      if (autoPong && value.type === 'ping') handlers.message({ data: JSON.stringify({ ...value, type: 'pong', serverAt: value.clientAt + 9000, probeId: 'keepalive-' + next }) });
    }, close() { socket.closed = true; } };
    sockets.push(socket); return socket;
  } };
  const client = createOnlineDuel({ wx, account: auth, now: () => time, monotonicNow: () => time,
    setTimeout(fn, delay) { const id = ++next; tasks.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { tasks.delete(id); },
    onChange(state) { changes.push(state); }, onSound(type) { sounds.push({ type, at: time }); if (options.onSound) return options.onSound(type); } });
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
    network(connected) { if (networkListener) networkListener({ isConnected: connected }); },
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

test('silent active connection loss cancels a scheduled cue while preserving the lobby connection for recovery', async () => {
  const h = host(); await h.online(); const room = { ...h.room('arming'), signalAt: h.time + 9000 + 7000 };
  h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  h.silence(); h.advance(5000);
  assert.equal(h.client.snapshot().connection, 'online'); assert.equal(h.client.snapshot().room, null);
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
    assert.equal(h.tasks.size, action === 'error' ? 1 : 0, action); assert.equal(h.sockets[0].closed, true);
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

test('native websocket failures distinguish domain, certificate and rejected handshakes without exposing tickets', async () => {
  const cases = [
    [{ errMsg: 'connectSocket:fail url not in domain list' }, 'socket_domain_not_allowed', /socket 合法域名.*PK-DOMAIN/],
    [{ errMsg: 'createSocketTask:fail SSL certificate verify failed' }, 'socket_tls_failed', /安全连接验证失败.*PK-TLS/],
    [{ errMsg: 'WebSocket connection failed: net::ERR_CERT_AUTHORITY_INVALID' }, 'socket_tls_failed', /PK-TLS/],
    [{ errMsg: 'WebSocket handshake: Unexpected server response: 401' }, 'socket_http_401', /凭证已失效.*PK-401/],
    [{ errMsg: 'WebSocket handshake: Unexpected response code: 403' }, 'socket_http_403', /拒绝了连接.*PK-403/],
    [{ errMsg: 'WebSocket handshake failed: HTTP/1.1 503' }, 'socket_http_503', /暂时不可用.*PK-503/],
    [{ statusCode: 403, errMsg: 'WebSocket handshake failed' }, 'socket_http_403', /PK-403/],
    [{ errMsg: 'connectSocket:fail net::ERR_CONNECTION_RESET' }, 'socket_connection_failed', /PK-SOCKET/],
    [{}, 'socket_connection_failed', /^实时连接失败，请检查网络后重试。$/]
  ];
  for (const callback of ['fail', 'error']) {
    for (const [error, code, text] of cases) {
      const h = host(); await h.client.connect(); const socket = h.sockets[0];
      const privateUrl = socket.request.url;
      const event = { ...error, ...(error.errMsg ? { errMsg: error.errMsg + ' ' + privateUrl } : {}) };
      if (callback === 'fail') socket.request.fail(event); else socket.handlers.error(event);
      const state = h.client.snapshot();
      const terminal = ['socket_domain_not_allowed', 'socket_tls_failed', 'socket_http_403'].includes(code);
      assert.equal(state.connection, terminal ? 'error' : 'reconnecting'); assert.equal(state.errorCode, code, callback + ': ' + error.errMsg);
      if (terminal) assert.match(state.error, text); else assert.match(state.notice, /自动重连/);
      assert.equal(socket.closed, true); assert.equal(h.tasks.size, terminal ? 0 : 1);
      assert.equal(JSON.stringify(h.changes).includes('temporary-ticket'), false);
      assert.equal(JSON.stringify(h.changes).includes(privateUrl), false);
      h.client.dispose();
    }
  }
});

test('unknown native errors cannot turn numbers or words in signed URLs into a false diagnosis', async () => {
  const h = host(); await h.client.connect();
  h.sockets[0].handlers.error({ errMsg: 'connectSocket:fail wss://duel.example.com/certificate/status403?ticket=secret-value' });
  assert.equal(h.client.snapshot().errorCode, 'socket_connection_failed');
  assert.equal(JSON.stringify(h.changes).includes('secret-value'), false);
  await h.client.connect();
  assert.equal(h.client.snapshot().errorCode, ''); assert.equal(h.client.snapshot().error, '');
  h.sockets[0].handlers.error({ errMsg: 'HTTP 403' });
  assert.equal(h.client.snapshot().connection, 'connecting'); assert.equal(h.client.snapshot().errorCode, '');
  h.client.dispose();
});

test('synchronous native socket throws and immediate failure callbacks do not expose tickets or retain tasks', async () => {
  const thrown = host();
  thrown.wx.connectSocket = request => { throw new Error('WebSocket failed: ' + request.url); };
  await thrown.client.connect();
  assert.equal(thrown.client.snapshot().errorCode, 'socket_connection_failed');
  assert.equal(JSON.stringify(thrown.changes).includes('temporary-ticket'), false);
  assert.equal(thrown.tasks.size, 1); thrown.client.dispose(); assert.equal(thrown.tasks.size, 0);

  const immediate = host(); let closed = false;
  immediate.wx.connectSocket = request => {
    request.fail({ errMsg: 'connectSocket:fail url not in domain list ' + request.url });
    return { close() { closed = true; }, onMessage() { assert.fail('failed task must not receive handlers'); } };
  };
  await immediate.client.connect();
  assert.equal(immediate.client.snapshot().errorCode, 'socket_domain_not_allowed');
  assert.equal(closed, true); assert.equal(immediate.tasks.size, 0);
  assert.equal(JSON.stringify(immediate.changes).includes('temporary-ticket'), false);
  immediate.client.dispose();
});

test('a send failure delivered by an old socket cannot close a newer connection', async () => {
  const h = host(); await h.online(); let fail;
  h.sockets[0].send = value => { fail = value.fail; };
  h.client.invite('other'); await h.client.connect(); fail();
  assert.equal(h.client.snapshot().connection, 'connecting'); assert.equal(h.sockets[1].closed, undefined);
  h.client.dispose();
});

test('one lost calibration reply cannot suppress the ongoing lobby heartbeat', async () => {
  const h = host(); await h.client.connect(); h.receive({ type: 'hello', user: { id: 'me' }, serverAt: h.time + 9000 });
  assert.equal(h.sent.filter(value => value.type === 'ping').length, 1);
  h.advance(5000);
  assert.equal(h.sent.filter(value => value.type === 'ping').length, 2);
  let probe = h.sent.filter(value => value.type === 'ping').at(-1);
  h.receive({ type: 'pong', id: probe.id, clientAt: probe.clientAt, serverAt: h.time + 9000 });
  for (let i = 0; i < 4; i++) {
    h.advance(100); probe = h.sent.filter(value => value.type === 'ping').at(-1);
    h.receive({ type: 'pong', id: probe.id, clientAt: probe.clientAt, serverAt: h.time + 9000 });
  }
  assert.equal(h.client.snapshot().syncReady, true); assert.equal(h.client.snapshot().connection, 'online'); h.client.dispose();
});

test('busy state updates cannot postpone heartbeat and one remaining player stays connected for ten minutes', async () => {
  const h = host(); await h.online();
  const before = h.sent.filter(value => value.type === 'ping').length;
  for (let n = 0; n < 600; n++) {
    h.advance(1000); h.receive({ type: 'state', room: null, invitation: null });
    if (n === 100) h.receive({ type: 'lobby', users: [{ id: 'me', status: 'available' }] });
  }
  assert.ok(h.sent.filter(value => value.type === 'ping').length - before >= 119);
  assert.equal(h.client.snapshot().connection, 'online'); assert.equal(h.sockets.length, 1);
  h.client.disconnect(); assert.equal(h.tasks.size, 0); h.advance(600000); assert.equal(h.sockets.length, 1); h.client.dispose();
});

test('temporary close obtains a fresh ticket and reconnects; old callbacks and explicit exit cannot revive it', async () => {
  const h = host(); await h.online();
  h.sockets[0].handlers.close({ code: 1006 });
  assert.equal(h.client.snapshot().connection, 'reconnecting');
  h.advance(999); assert.equal(h.sockets.length, 1);
  h.advance(1); await Promise.resolve(); await Promise.resolve(); assert.equal(h.sockets.length, 2);
  h.receive({ type: 'hello', user: { id: 'me' }, serverAt: h.time + 9000 }); h.advance(500);
  assert.equal(h.client.snapshot().connection, 'online'); assert.equal(h.client.snapshot().syncReady, true);
  h.sockets[0].handlers.close({ code: 1006 }); assert.equal(h.client.snapshot().connection, 'online');
  h.sockets[1].handlers.close({ code: 1006 }); h.client.disconnect();
  h.advance(60000); await Promise.resolve(); assert.equal(h.sockets.length, 2); assert.equal(h.tasks.size, 0); h.client.dispose();
});

test('network recovery retries immediately while duplicate-account closures never fight another device', async () => {
  const h = host(); await h.online(); h.network(false);
  assert.equal(h.client.snapshot().connection, 'reconnecting');
  h.advance(1000); await Promise.resolve(); assert.equal(h.sockets.length, 1, 'offline retries must not issue sockets');
  h.network(true); await Promise.resolve(); await Promise.resolve(); assert.equal(h.sockets.length, 2);
  h.sockets[1].handlers.close({ code: 4001 }); assert.equal(h.client.snapshot().connection, 'error'); assert.equal(h.tasks.size, 0);
  h.advance(60000); await Promise.resolve(); assert.equal(h.sockets.length, 2);
  h.client.dispose(); h.network(true); assert.equal(h.tasks.size, 0);
});

test('a missing audio cue aborts the round instead of recording a silent match', async () => {
  for (const failedCue of ['start', 'go']) {
    const h = host({ onSound: type => type !== failedCue }); await h.online(); const room = h.room('arming');
    h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
    h.advance(4000);
    assert.equal(h.client.snapshot().room, null); assert.match(h.client.snapshot().notice, /提示音未能播放/);
    assert.equal(h.sent.some(value => value.type === 'leave'), true); assert.equal(h.client.tap(), false); h.client.dispose();
  }
});

test('active liveness starts fresh instead of applying the game timeout to an older lobby pong', async () => {
  const h = host(); await h.online(); h.silence(); h.advance(4400);
  const room = h.room('arming'); h.receive({ type: 'state', room }); h.receive({ type: 'state', room: { ...room, phase: 'scheduled' } });
  h.advance(1000); assert.ok(h.client.snapshot().room, 'a delayed first active pong still has the new round grace');
  const probe = h.sent.filter(value => value.type === 'ping').at(-1);
  h.receive({ type: 'pong', id: probe.id, clientAt: probe.clientAt, serverAt: h.time + 9000 });
  h.advance(1000); assert.equal(h.client.snapshot().room.phase, 'waiting'); h.client.dispose();
});

test('reward commands await their own acknowledgement and block readiness until the shared revision arrives', async () => {
  const h = host(); await h.online(); const room = { ...h.room(), rewardRevision: 0, rewards: {} };
  h.receive({ type: 'state', room });
  const saved = h.client.setReward('  一杯奶茶  '), request = h.sent.at(-1); let settled = false;
  saved.then(() => { settled = true; });
  assert.deepEqual({ ...request, requestId: 'request' }, { type: 'set_reward', mode: 'custom', roomId: room.id, text: '一杯奶茶', requestId: 'request' });
  assert.equal(h.client.ready(0), false); assert.equal(h.sent.some(value => value.type === 'ready'), false);
  h.receive({ type: 'reward_saved', roomId: room.id, requestId: request.requestId, rewardRevision: 1 });
  await Promise.resolve(); assert.equal(settled, false, 'an early ack cannot consent to unseen shared terms');
  h.receive({ type: 'state', room: { ...room, rewardRevision: 1, rewards: { me: { text: '一杯奶茶', mode: 'custom', category: '' } } } });
  assert.equal(await saved, true); assert.equal(h.client.ready(0), false); assert.equal(h.client.ready(1), true);
  assert.equal(h.sent.at(-1).roomId, room.id); assert.equal(h.sent.at(-1).rewardRevision, 1);
  const same = h.client.setReward('一杯奶茶'), sameRequest = h.sent.at(-1);
  h.receive({ type: 'reward_saved', roomId: room.id, requestId: sameRequest.requestId, rewardRevision: 1 });
  assert.equal(await same, true, 'a no-op save is acknowledged without inventing a new revision'); h.client.dispose();
});

test('random, clear and invalid reward input remain scoped to the current pre-game room', async () => {
  const h = host(); await h.online(); const room = { ...h.room(), rewardRevision: 2, rewards: {} }; h.receive({ type: 'state', room });
  for (const value of ['x'.repeat(81), '含\n换行', {}, null]) assert.equal(h.client.setReward(value), false);
  assert.equal(h.client.randomReward('__proto__'), false);
  const random = h.client.randomReward('FOOD'), request = h.sent.at(-1);
  assert.equal(request.mode, 'random'); assert.equal(request.category, 'FOOD'); assert.equal(Object.hasOwn(request, 'text'), false); assert.equal(Object.hasOwn(request, 'userId'), false);
  h.receive({ type: 'state', room: { ...room, rewardRevision: 3 } }); h.receive({ type: 'reward_saved', roomId: room.id, requestId: request.requestId, rewardRevision: 3 }); assert.equal(await random, true);
  const cleared = h.client.setReward(' '), clearing = h.sent.at(-1); assert.equal(clearing.mode, 'none');
  h.receive({ type: 'error', code: 'reward_stale', message: '彩头已更新，请重试。' }); assert.equal(await cleared, false);
  h.receive({ type: 'state', room: { ...room, phase: 'arming' } }); assert.equal(h.client.setReward('不能改'), false);
  h.client.dispose();
});

test('reward acknowledgement timeout, a different room and explicit exit safely release pending saves', async () => {
  for (const action of ['timeout', 'room', 'exit']) {
    const h = host(); await h.online(); const room = { ...h.room(), rewardRevision: 0 }; h.receive({ type: 'state', room });
    const saved = h.client.setReward('请吃冰淇淋');
    if (action === 'timeout') h.advance(10000);
    else if (action === 'room') h.receive({ type: 'state', room: { ...room, id: 'other-room' } });
    else h.client.disconnect();
    assert.equal(await saved, false); h.client.dispose(); assert.equal(h.tasks.size, 0);
  }
});

test('a reward change during clock calibration cancels deferred consent to the old terms', async () => {
  const h = host(); await h.online(); const room = { ...h.room(), rewardRevision: 3 };
  h.receive({ type: 'state', room }); h.silence(); h.advance(11000);
  assert.equal(h.client.ready(3), false);
  h.receive({ type: 'state', room: { ...room, rewardRevision: 4 } });
  for (let i = 0; i < 5; i++) {
    const probe = h.sent.filter(value => value.type === 'ping').at(-1);
    h.receive({ type: 'pong', id: probe.id, clientAt: probe.clientAt, serverAt: h.time + 9000 }); h.advance(100);
  }
  assert.equal(h.sent.some(value => value.type === 'ready'), false);
  assert.equal(h.client.ready(3), false); assert.equal(h.client.ready(4), true); h.client.dispose();
});
