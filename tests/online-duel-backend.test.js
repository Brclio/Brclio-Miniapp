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
    receive(A, { type: 'ready', roomId: room.id, rtt: 100, uncertainty: 50, rewardRevision: room.rewardRevision }); receive(B, { type: 'ready', roomId: room.id, rtt: 100, uncertainty: 50, rewardRevision: room.rewardRevision });
    return room;
  }
  function scheduled(room = accept()) { ready(room); receive(A, { type: 'armed', roundId: room.roundId }); receive(B, { type: 'armed', roundId: room.roundId }); return room; }
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

test('each participant owns one visible reward slot with custom, categorized random and no-reward choices', async () => {
  const h = await harness(), room = h.accept();
  const original = require('../miniprogram/lib/ready-go-data');
  const catalogBefore = JSON.stringify(original);
  assert.equal(room.rewardRevision, 0);
  assert.deepEqual(room.rewards, { [A.id]: { text: '', mode: 'none', category: '' }, [B.id]: { text: '', mode: 'none', category: '' } });
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '  免洗碗券一张  ' });
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'random', category: 'FOOD' });
  assert.deepEqual(room.rewards[A.id], { text: '免洗碗券一张', mode: 'custom', category: '' });
  assert.deepEqual(room.rewards[B.id], { text: original.REWARD_POOLS.FOOD[0], mode: 'random', category: 'FOOD' });
  assert.equal(room.rewardRevision, 2);
  assert.deepEqual(h.hub.state(A.id).room.rewards, h.hub.state(B.id).room.rewards);
  assert.equal(h.hub.state(C.id).room, null);
  assert.equal(JSON.stringify(h.last(C, 'lobby')).includes('免洗碗券一张'), false);
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '擅改对手', userId: B.id });
  assert.equal(h.last(A, 'error').code, 'reward_forbidden'); assert.equal(room.rewardRevision, 2);
  h.receive(C, { type: 'set_reward', roomId: room.id, mode: 'none' }); assert.equal(h.last(C, 'error').code, 'room_missing');
  h.receive(A, { type: 'set_reward', roomId: 'another-room', mode: 'none' }); assert.equal(h.last(A, 'error').code, 'reward_room_changed');
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'none' });
  assert.equal(room.rewards[A.id].text, ''); assert.equal(room.rewardRevision, 3);
  assert.equal(JSON.stringify(original), catalogBefore, 'online random selection cannot change the original local game catalog');
});

test('reward input is bounded, normalized and rejects invalid controls, types and category prototypes', async () => {
  const h = await harness(), room = h.accept();
  for (const text of [null, [], {}, '', '   ', 'x'.repeat(81), '换行\n彩头', '\u0000', '\u202e伪装']) {
    h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text });
    assert.equal(h.last(A, 'error').code, 'reward_invalid'); assert.equal(room.rewardRevision, 0);
  }
  for (const category of ['__proto__', 'constructor', 'CUSTOM', 'INVALID', {}, null]) {
    h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'random', category });
    assert.equal(h.last(A, 'error').code, 'reward_category_invalid'); assert.equal(room.rewardRevision, 0);
  }
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: 'e\u0301' });
  assert.equal(room.rewards[A.id].text, 'é');
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '🙂'.repeat(80) });
  assert.equal([...room.rewards[B.id].text].length, 80);
});

test('changing either reward revokes both ready states and stale or legacy ready cannot accept the new agreement', async () => {
  const h = await harness(), room = h.accept(); h.probe(A); h.probe(B);
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '一杯奶茶' });
  h.receive(A, { type: 'ready', roomId: room.id, rtt: 100, uncertainty: 50, rewardRevision: 1 });
  assert.deepEqual(room.ready, [A.id]);
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '免洗碗一次' });
  assert.deepEqual(room.ready, []); assert.equal(room.rewardRevision, 2);
  for (const rewardRevision of [undefined, 0, 1, '2', -1]) {
    h.receive(A, { type: 'ready', roomId: room.id, rtt: 100, uncertainty: 50, rewardRevision });
    assert.equal(h.last(A, 'error').code, 'reward_changed'); assert.deepEqual(room.ready, []);
    assert.equal(h.last(A, 'state').room.rewardRevision, 2);
  }
  h.receive(A, { type: 'ready', roomId: room.id, rtt: 100, uncertainty: 50, rewardRevision: 2 });
  h.receive(B, { type: 'ready', roomId: room.id, rtt: 100, uncertainty: 50, rewardRevision: 2 });
  assert.equal(room.phase, 'arming'); assert.deepEqual(room.roundRewards, room.rewards);
  assert.notEqual(room.roundRewards, room.rewards);
  const frozen = structuredClone(room.roundRewards);
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'none' });
  assert.equal(h.last(A, 'error').code, 'reward_locked'); assert.deepEqual(room.roundRewards, frozen);
});

test('an unchanged reward save acknowledges without revoking preparation; legacy untouched rooms still start', async () => {
  const h = await harness(), room = h.accept(); h.probe(A); h.probe(B);
  h.receive(A, { type: 'ready', rtt: 100, uncertainty: 50 }); assert.deepEqual(room.ready, [A.id]);
  const before = h.events.length;
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'none' });
  assert.equal(room.rewardRevision, 0); assert.deepEqual(room.ready, [A.id]);
  assert.equal(h.events.slice(before).filter(event => event.value.type === 'state').length, 2);
  h.receive(B, { type: 'ready', rtt: 100, uncertainty: 50 }); assert.equal(room.phase, 'arming');
});

test('reward save acknowledgements are sender-only, follow state and still confirm no-op saves', async () => {
  const h = await harness(), room = h.accept();
  let before = h.events.length;
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '一杯奶茶', requestId: 'a_save-1' });
  const events = h.events.slice(before);
  assert.deepEqual(events.filter(event => event.id === A.id).map(event => event.value.type), ['state', 'reward_saved']);
  assert.equal(events.some(event => event.id !== A.id && event.value.type === 'reward_saved'), false);
  assert.deepEqual(h.last(A, 'reward_saved'), { type: 'reward_saved', roomId: room.id, requestId: 'a_save-1', rewardRevision: 1, serverAt: h.time });
  before = h.events.length;
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: ' 一杯奶茶 ', requestId: 'a_save-2' });
  assert.equal(room.rewardRevision, 1); assert.equal(h.last(A, 'reward_saved').requestId, 'a_save-2');
  assert.deepEqual(h.events.slice(before).filter(event => event.id === A.id).map(event => event.value.type), ['state', 'reward_saved']);
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'none', requestId: 'unsafe request' });
  assert.equal(h.last(A, 'error').code, 'reward_request_invalid'); assert.equal(room.rewardRevision, 1);
});

test('server random selection can be rerolled and ready packets must identify the current agreed room', async () => {
  const h = await harness(), room = h.accept(); h.probe(A); h.probe(B);
  h.receive(A, { type: 'ready', roomId: 'old-room', rewardRevision: 0, rtt: 100, uncertainty: 50 });
  assert.equal(h.last(A, 'error').code, 'reward_room_changed'); assert.deepEqual(room.ready, []);
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'random', category: 'FOOD' });
  const first = room.rewards[A.id].text;
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'random', category: 'FOOD' });
  assert.notEqual(room.rewards[A.id].text, first); assert.equal(room.rewardRevision, 2);
  h.receive(A, { type: 'ready', rewardRevision: 2, rtt: 100, uncertainty: 50 });
  assert.equal(h.last(A, 'error').code, 'reward_room_changed'); assert.deepEqual(room.ready, []);
  h.receive(A, { type: 'ready', roomId: room.id, rewardRevision: 2, rtt: 100, uncertainty: 50 }); assert.deepEqual(room.ready, [A.id]);
});

test('the winner earns their own frozen reward and editing next-round choices cannot rewrite the result', async () => {
  const h = await harness(), room = h.accept();
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: 'A 赢想要奶茶' });
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'custom', text: 'B 赢想要甜点' });
  h.scheduled(room);
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'none' }); assert.equal(h.last(B, 'error').code, 'reward_locked');
  h.setTime(room.signalAt + 170); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 120 });
  h.setTime(room.signalAt + 180); h.receive(B, { type: 'tap', roundId: room.roundId, reactionMs: 90 });
  assert.equal(room.result.reward, 'B 赢想要甜点'); assert.equal(room.result.rewardOwnerId, B.id);
  const result = structuredClone(room.result);
  h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '下一局换咖啡' });
  assert.equal(room.rewards[B.id].text, '下一局换咖啡'); assert.deepEqual(room.result, result);
  h.ready(room); assert.equal(room.roundRewards[B.id].text, '下一局换咖啡'); assert.equal(room.result, null);
});

test('ties, empty timeouts and aborted rounds award no reward while false starts award the other player own choice', async () => {
  for (const mode of ['tie', 'timeout', 'abort', 'false']) {
    const h = await harness(), room = h.accept();
    h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: 'A 的约定' });
    h.receive(B, { type: 'set_reward', roomId: room.id, mode: 'custom', text: 'B 的约定' }); h.scheduled(room);
    if (mode === 'false') { h.setTime(room.signalAt - 20); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: -70 }); }
    else if (mode === 'abort') h.hub.disconnect(A.id);
    else if (mode === 'timeout') { h.setTime(room.signalAt + 5500); h.hub.tick(); }
    else {
      h.setTime(room.signalAt + 250); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 200 });
      h.setTime(room.signalAt + 260); h.receive(B, { type: 'tap', roundId: room.roundId, reactionMs: 210 });
    }
    assert.equal(room.result.reward, mode === 'false' ? 'B 的约定' : '');
    assert.equal(room.result.rewardOwnerId, mode === 'false' ? B.id : null);
  }
});

test('hibernation retains reward agreements and their frozen snapshot, and old attachments get empty defaults', async () => {
  const h = await harness(), room = h.accept();
  h.receive(A, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '保存约定' }); h.scheduled(room);
  const attachments = [A, B, C].map(who => h.hub.attachment(who.id));
  const { DuelHub } = await loadHub, restored = new DuelHub(h.options); restored.restore(attachments);
  assert.deepEqual(restored.state(A.id).room.rewards, room.rewards);
  assert.deepEqual(restored.state(A.id).room.roundRewards, room.roundRewards); assert.equal(restored.state(A.id).room.rewardRevision, 1);
  for (const attachment of attachments) if (attachment.room) { delete attachment.room.rewards; delete attachment.room.rewardRevision; delete attachment.room.roundRewards; }
  const legacy = new DuelHub(h.options); legacy.restore(attachments);
  assert.equal(legacy.state(A.id).room.rewards[A.id].text, ''); assert.equal(legacy.state(A.id).room.rewardRevision, 0);
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

test('a later second ready starts a fresh active lease for both phones instead of expiring the first player', async () => {
  const h = await harness(), room = h.accept();
  h.probe(A); h.probe(B);
  h.receive(A, { type: 'ready', rtt: 100, uncertainty: 50 });
  const firstSeen = h.hub.users.get(A.id).lastSeen;
  h.silentSetTime(h.time + 8000);
  h.receive(B, { type: 'ready', rtt: 100, uncertainty: 50 });
  assert.equal(room.phase, 'arming'); assert.ok(h.time - firstSeen > h.LIMITS.activeStaleMs);
  assert.equal(h.hub.users.has(A.id), true);
  h.hub.tick(); assert.equal(room.phase, 'arming');
  assert.equal(h.hub.roundLivenessDeadline(room, h.hub.users.get(A.id)), h.time + h.LIMITS.activeStaleMs);
  h.receive(A, { type: 'armed', roundId: room.roundId });
  h.receive(B, { type: 'armed', roundId: room.roundId });
  assert.equal(room.phase, 'scheduled'); assert.equal(h.hub.users.size, 3);
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
  const h = await harness(); h.invite(); h.advance(h.LIMITS.staleMs);
  assert.equal(h.hub.users.size, 0); assert.equal(h.hub.invitations.size, 0); assert.equal(h.hub.nextDeadline(), null);
});

test('silent active peer aborts before one-tap timeout settlement while retaining lobby presence', async () => {
  const h = await harness(), room = h.scheduled();
  h.setTime(room.signalAt + 150); h.receive(A, { type: 'tap', roundId: room.roundId, reactionMs: 100 });
  const peerLastSeen = h.hub.users.get(B.id).lastSeen;
  assert.equal(h.hub.nextDeadline(), peerLastSeen + h.LIMITS.activeStaleMs);
  // A keeps sending real messages; B silently loses its network without a
  // websocket close event. Check liveness before the later result deadline.
  for (let at = h.time + 1000; at < peerLastSeen + h.LIMITS.activeStaleMs; at += 1000) {
    h.silentSetTime(at); h.receive(A, { type: 'ping', id: at, clientAt: at });
  }
  h.silentSetTime(peerLastSeen + h.LIMITS.activeStaleMs); h.hub.tick();
  assert.equal(room.phase, 'aborted'); assert.equal(room.result.winnerId, null);
  assert.equal(h.hub.users.has(B.id), true, 'short round silence must not disconnect the player from the plaza');
  assert.ok(h.time < room.signalAt + 5500);
  h.silentSetTime(room.signalAt + 5500); h.hub.tick(); assert.equal(room.result.winnerId, null);
});

test('brief active jitter keeps both users and the round, while actual lobby silence still expires', async () => {
  const h = await harness(), room = h.scheduled();
  const beganAt = h.time;
  h.silentSetTime(beganAt + 3500); h.hub.tick();
  assert.equal(room.phase, 'scheduled'); assert.equal(h.hub.users.size, 3);
  h.receive(A, { type: 'ping', id: 'recover-a', clientAt: h.time });
  h.receive(B, { type: 'ping', id: 'recover-b', clientAt: h.time });
  assert.equal(h.last(A, 'pong').id, 'recover-a'); assert.equal(room.phase, 'scheduled');
  h.silentSetTime(h.time + h.LIMITS.staleMs); h.hub.tick();
  assert.equal(h.hub.users.size, 0); assert.equal(room.result.winnerId, null); assert.equal(h.hub.nextDeadline(), null);
});

test('one remaining plaza user keeps a live lease with regular heartbeats until the final departure', async () => {
  const h = await harness(); h.hub.disconnect(B.id); h.hub.disconnect(C.id);
  for (let index = 0; index < 36; index++) {
    h.silentSetTime(h.time + 5000); h.receive(A, { type: 'ping', id: index, clientAt: h.time }); h.hub.tick();
    assert.equal(h.hub.users.size, 1); assert.equal(h.hub.nextDeadline(), h.time + h.LIMITS.staleMs);
    assert.equal(h.last(A, 'pong').id, index);
  }
  h.hub.disconnect(A.id); assert.equal(h.hub.nextDeadline(), null);
});

test('restored active rounds preserve their new lease and tolerate attachments from the previous server version', async () => {
  const h = await harness(), room = h.scheduled(), { DuelHub } = await loadHub;
  const attachments = [A, B, C].map(who => h.hub.attachment(who.id));
  for (const legacy of [false, true]) {
    const values = structuredClone(attachments);
    if (legacy) for (const value of values) if (value.room) delete value.room.activeSince;
    const restored = new DuelHub(h.options); restored.restore(values);
    const active = restored.rooms.get(room.id), entry = restored.users.get(A.id);
    assert.equal(restored.roundLivenessDeadline(active, entry), Math.max(entry.lastSeen, room.startAt - h.LIMITS.startBufferMs) + h.LIMITS.activeStaleMs);
    h.silentSetTime(h.time + 1000); restored.tick(); assert.equal(restored.users.size, 3); assert.equal(active.phase, 'scheduled');
  }
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
