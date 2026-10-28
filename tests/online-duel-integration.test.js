'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnlineDuel } = require('../miniprogram/lib/online-duel');

async function world() {
  const { DuelHub } = await import('../realtime/duel-hub.mjs');
  let at = 1800000000000, sequence = 0, alarm;
  const events = new Map(), phones = new Map();
  const later = (fn, delay) => { const id = ++sequence; events.set(id, { at: at + delay, fn }); return id; };
  const hub = new DuelHub({ now: () => at, random: () => .2, id: () => 'id-' + ++sequence, send(id, value) {
    const phone = phones.get(id); if (phone) later(() => { if (!phone.closed && phone.message) phone.message({ data: JSON.stringify(value) }); }, phone.latency);
  } });
  function scheduleAlarm() {
    events.delete(alarm); const next = hub.nextDeadline();
    if (next !== null) alarm = later(() => { hub.tick(); scheduleAlarm(); }, Math.max(1, next - at));
  }
  function advance(ms) {
    const end = at + ms;
    for (let i = 0; i < 10000; i++) {
      const entry = [...events.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      events.delete(entry[0]); at = entry[1].at; entry[1].fn();
    }
    at = end;
  }
  async function phone(id, skew, latency) {
    const user = { id, displayName: id, avatarUrl: '' }, sounds = [];
    const record = { latency, closed: false, sounds };
    phones.set(id, record);
    const client = createOnlineDuel({
      wx: { connectSocket() {
        later(() => { hub.connect(user); scheduleAlarm(); }, latency);
        return { onMessage(fn) { record.message = fn; }, onError() {}, onClose() {},
          send({ data }) { later(() => { if (!record.closed) { hub.receive(id, JSON.parse(data)); scheduleAlarm(); } }, latency); },
          close() { record.closed = true; later(() => { hub.disconnect(id); scheduleAlarm(); }, latency); }
        };
      } },
      account: { getCachedUser: () => user, subscribe: () => () => {}, createDuelTicket: async () => ({ ticket: 'temporary', socketUrl: 'wss://duel.example.com/connect', expiresAt: at + 60000 }) },
      now: () => at + skew, monotonicNow: () => at + skew,
      setTimeout: later, clearTimeout: id => events.delete(id),
      onSound(type) { if (type !== 'stop') sounds.push({ type, at }); }
    });
    record.client = client; await client.connect(); return record;
  }
  const a = await phone('alice', 300000, 120), b = await phone('bob', -420000, 15);
  advance(2200);
  return { a, b, hub, advance, get at() { return at; },
    match(readyDelay = 0) {
      assert.equal(a.client.snapshot().syncReady, true); assert.equal(b.client.snapshot().syncReady, true);
      a.client.invite('bob'); advance(500);
      const invitation = b.client.snapshot().invitation; assert.equal(invitation.direction, 'incoming');
      b.client.accept(invitation.id); advance(500);
      a.client.ready(); if (readyDelay) advance(readyDelay); b.client.ready(); advance(500);
      assert.equal(a.client.snapshot().room.phase, 'arming'); assert.equal(b.client.snapshot().room.phase, 'arming');
      return a.client.snapshot().room;
    }, dispose() { a.client.dispose(); b.client.dispose(); }
  };
}

test('two phones with different epochs and network delays play at the same future time; reaction wins despite later packet arrival', async () => {
  const w = await world(), room = w.match();
  assert.notEqual(w.a.client.snapshot().myColor, w.b.client.snapshot().myColor);
  w.advance(room.signalAt - w.at);
  assert.deepEqual(w.a.sounds.filter(value => value.type === 'start'), [{ type: 'start', at: room.startAt }]);
  assert.deepEqual(w.b.sounds.filter(value => value.type === 'start'), [{ type: 'start', at: room.startAt }]);
  assert.deepEqual(w.a.sounds.filter(value => value.type === 'go'), [{ type: 'go', at: room.signalAt }]);
  assert.deepEqual(w.b.sounds.filter(value => value.type === 'go'), [{ type: 'go', at: room.signalAt }]);
  w.advance(170); w.a.client.tap(); w.advance(60); w.b.client.tap(); w.advance(500);
  const a = w.a.client.snapshot().room, b = w.b.client.snapshot().room;
  assert.equal(a.phase, 'result'); assert.equal(a.result.winnerId, 'alice'); assert.deepEqual(a.result.reactions, { bob: 230, alice: 170 });
  assert.deepEqual(a.result, b.result);
  w.hub.receive('bob', { type: 'tap', roundId: room.roundId, reactionMs: 1 });
  assert.equal(w.hub.rooms.get(room.id).result.winnerId, 'alice');
  w.a.client.ready(); w.b.client.ready(); w.advance(500);
  assert.notEqual(w.a.client.snapshot().room.roundId, room.roundId);
  w.dispose();
});

test('a player waiting eight seconds for the second ready keeps their connection and both future sound cues', async () => {
  const w = await world(); w.advance(120000);
  const room = w.match(8000);
  w.advance(room.signalAt - w.at);
  for (const phone of [w.a, w.b]) {
    assert.equal(phone.client.snapshot().connection, 'online');
    assert.deepEqual(phone.sounds.filter(value => value.type === 'start'), [{ type: 'start', at: room.startAt }]);
    assert.deepEqual(phone.sounds.filter(value => value.type === 'go'), [{ type: 'go', at: room.signalAt }]);
  }
  w.dispose();
});

test('leaving during arming prevents either device from hearing an obsolete GO and awards no win', async () => {
  const w = await world();
  w.a.client.invite('bob'); w.advance(500); w.b.client.accept(w.b.client.snapshot().invitation.id); w.advance(500);
  w.a.client.ready(); w.b.client.ready();
  w.advance(140); w.b.client.disconnect(); w.advance(7000);
  const room = w.a.client.snapshot().room;
  assert.equal(room.phase, 'aborted'); assert.equal(room.result.winnerId, null);
  assert.equal(w.a.sounds.some(value => value.type === 'go'), false);
  assert.equal(w.b.sounds.some(value => value.type === 'go'), false); w.dispose();
});
