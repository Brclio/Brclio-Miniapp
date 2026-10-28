'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const ROOT = path.resolve(__dirname, '..');
const SECRET = 'test-only-online-duel-secret-at-least-32-characters';
const A = { id: 'a'.repeat(32), displayName: '发起者', avatarUrl: '' };
const B = { id: 'b'.repeat(32), displayName: '受邀者', avatarUrl: '' };
const C = { id: 'c'.repeat(32), displayName: '第三人', avatarUrl: '' };

async function harness() {
  const { DuelHub } = await import('../realtime/duel-hub.mjs');
  let at = 100000, next = 0;
  const events = [], options = { now: () => at, random: () => 0, code: () => 'ABCD2345', id: () => 'id-' + ++next, send(id, value) { events.push({ id, value }); } };
  const hub = new DuelHub(options);
  for (const user of [A, B, C]) hub.connect(user);
  const receive = (user, value) => hub.receive(user.id, value);
  const lastError = user => events.filter(event => event.id === user.id && event.value.type === 'error').at(-1)?.value.code;
  function probe(user) { receive(user, { type: 'ping', id: ++next, clientAt: at }); const pong = events.filter(event => event.id === user.id && event.value.type === 'pong').at(-1).value; receive(user, { type: 'probe_ack', probeId: pong.probeId }); }
  return { hub, options, receive, lastError, probe, events, get at() { return at; }, advance(ms) { at += ms; hub.tick(); } };
}

test('share codes are private, busy-aware and consumed only when both reserved players start', async () => {
  const h = await harness();
  h.receive(A, { type: 'create_code' });
  const invite = h.hub.state(A.id).shareInvite;
  assert.equal(invite.code, 'ABCD2345'); assert.equal(invite.expiresAt, h.at + 600000);
  assert.equal(invite.ownerOnline, true); assert.equal(invite.guestOnline, false);
  assert.equal(h.hub.state(C.id).shareInvite, null);
  h.receive(A, { type: 'invite', userId: B.id }); assert.equal(h.lastError(A), 'user_busy');
  h.receive(A, { type: 'join_code', code: invite.code }); assert.equal(h.lastError(A), 'code_self');
  h.receive(B, { type: 'join_code', code: invite.code });
  const room = h.hub.state(B.id).room;
  assert.equal(room.phase, 'ready'); assert.deepEqual(new Set(room.players.map(value => value.color)), new Set(['red', 'blue']));
  assert.equal(h.hub.state(A.id).shareInvite.status, 'paired');
  h.receive(C, { type: 'join_code', code: invite.code }); assert.equal(h.lastError(C), 'code_full');
  h.probe(A); h.probe(B);
  h.receive(A, { type: 'ready', rtt: 10, uncertainty: 5 }); assert.equal(h.hub.state(A.id).shareInvite.code, invite.code);
  h.receive(B, { type: 'ready', rtt: 10, uncertainty: 5 });
  assert.equal(h.hub.state(A.id).room.phase, 'arming'); assert.equal(h.hub.state(A.id).shareInvite, null);
  assert.equal(h.hub.codeInvites.size, 0); assert.equal(h.hub.codeChanges.get(invite.code), null);
});

test('sharing can hide the host and reserve a guest offline; reconnect pairs the same two users', async () => {
  const h = await harness(); h.receive(A, { type: 'create_code' });
  h.hub.disconnect(A.id); h.receive(B, { type: 'join_code', code: 'ABCD2345' });
  assert.equal(h.hub.state(B.id).room, null); assert.equal(h.hub.state(B.id).shareInvite.ownerOnline, false);
  h.hub.connect(A);
  const roomId = h.hub.state(A.id).room.id;
  assert.equal(h.hub.state(B.id).room.id, roomId);
  h.hub.disconnect(A.id);
  assert.equal(h.hub.state(B.id).room, null); assert.equal(h.hub.state(B.id).shareInvite.guest.id, B.id);
  h.receive(C, { type: 'join_code', code: 'ABCD2345' }); assert.equal(h.lastError(C), 'code_full');
  h.hub.connect(A); assert.notEqual(h.hub.state(A.id).room.id, roomId);
  assert.equal(h.hub.state(B.id).room.players.find(player => player.id === A.id).displayName, A.displayName);
  h.receive(B, { type: 'cancel_code' }); assert.equal(h.hub.codeInvites.size, 0);
  assert.equal(h.hub.state(A.id).room.phase, 'aborted'); assert.equal(h.hub.state(A.id).room.result.winnerId, null);
});

test('offline code reservations survive reconstruction and expire lazily without empty-lobby alarms', async () => {
  const h = await harness(); h.receive(A, { type: 'create_code' });
  for (const user of [A, B, C]) h.hub.disconnect(user.id);
  assert.equal(h.hub.nextDeadline(), null);
  const records = [...h.hub.codeInvites.values()];
  const { DuelHub } = await import('../realtime/duel-hub.mjs');
  const restored = new DuelHub(h.options); restored.restoreCodes(records);
  assert.equal(restored.nextDeadline(), null); assert.equal(restored.codeInvites.size, 1);
  restored.connect(B); restored.receive(B.id, { type: 'join_code', code: 'ABCD2345' });
  assert.equal(restored.state(B.id).shareInvite.owner.id, A.id);
  h.advance(600001);
  const expired = new DuelHub(h.options); expired.restoreCodes(records);
  assert.equal(expired.codeInvites.size, 0); assert.equal(expired.codeChanges.get('ABCD2345'), null); assert.equal(expired.nextDeadline(), null);
});

test('a missing pre-game peer at hibernation resumes as a code wait rather than a stranded aborted room', async () => {
  const h = await harness(); h.receive(A, { type: 'create_code' }); h.receive(B, { type: 'join_code', code: 'ABCD2345' });
  const { DuelHub } = await import('../realtime/duel-hub.mjs');
  const restored = new DuelHub(h.options);
  restored.restore([h.hub.attachment(B.id)]); restored.restoreCodes([...h.hub.codeInvites.values()]);
  assert.equal(restored.state(B.id).room, null); assert.equal(restored.state(B.id).shareInvite.status, 'waiting');
  restored.connect(A); assert.equal(restored.state(A.id).room.phase, 'ready');
  assert.equal(restored.state(A.id).room.id, restored.state(B.id).room.id);
});

test('code validation, guessing cooldown, explicit leave and bounded capacity are enforced', async () => {
  const h = await harness(); h.receive(A, { type: 'create_code' });
  h.receive(B, { type: 'join_code', code: 'IIII0000' }); assert.equal(h.lastError(B), 'code_invalid');
  h.receive(B, { type: 'join_code', code: 'ABCD2345' }); assert.equal(h.lastError(B), 'code_cooldown');
  h.advance(2001); h.receive(B, { type: 'join_code', code: 'ABCD2345' });
  h.receive(A, { type: 'leave' }); assert.equal(h.hub.state(B.id).shareInvite, null);
  h.advance(2001); h.receive(C, { type: 'join_code', code: 'ABCD2345' }); assert.equal(h.lastError(C), 'code_expired');
  for (let index = 0; index < 500; index++) h.hub.codeInvites.set('fake-' + index, { owner: { id: 'owner-' + index }, expiresAt: h.at + 10000 });
  h.receive(C, { type: 'create_code' }); assert.equal(h.lastError(C), 'code_capacity');
});

test('presence heartbeats do not rewrite invitation records or postpone the existing alarm per message', async () => {
  const h = await harness(); h.receive(A, { type: 'create_code' }); h.hub.codeChanges.clear();
  h.probe(A); assert.equal(h.hub.codeChanges.size, 0);
  // Load the real adapter against a fake Cloudflare base to count its storage
  // effects, without invoking a deployed service or changing its production API.
  const source = fs.readFileSync(path.join(ROOT, 'realtime/worker.mjs'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default {', 'const worker = {').replace('export class DuelLobby', 'class DuelLobby');
  const context = { DurableObject: class {}, module: { exports: {} }, Date };
  vm.runInNewContext(source + '\nmodule.exports = { DuelLobby };', context);
  const instance = Object.create(context.module.exports.DuelLobby.prototype);
  const calls = [];
  instance.ctx = { storage: { async setAlarm(at) { calls.push(['set', at]); }, async deleteAlarm() { calls.push(['delete']); } } };
  let deadline = Date.now() + 30000;
  instance.hub = { codeChanges: new Map(), nextDeadline: () => deadline };
  instance.sockets = new Map(); instance.nextAlarmAt = null;
  await instance.persist();
  for (let index = 0; index < 100; index++) { deadline += 100; await instance.persist(); }
  assert.equal(calls.length, 1, '100 liveness messages must not create 100 alarm writes');
  deadline = calls[0][1] - 1000; await instance.persist(); assert.equal(calls.length, 2);
  deadline = null; await instance.persist(); await instance.persist(); assert.deepEqual(calls.at(-1), ['delete']); assert.equal(calls.length, 3);
});

test('real workerd retains a share code after all sockets close and a cold isolate, then resumes its reserved guest', { timeout: 15000 }, async () => {
  const { issueDuelTicket } = await import('../web/duel-ticket.mjs');
  const modules = ['realtime/worker.mjs', 'realtime/duel-hub.mjs', 'web/duel-ticket.mjs'].map(file => ({ type: 'ESModule', path: path.join(ROOT, file) }));
  const runtime = new Miniflare(convertV4MiniflareOptions({ name: 'brclio-share-test', modules, modulesRoot: ROOT, compatibilityDate: '2026-10-01', durableObjects: { DUEL_HUB: { className: 'DuelLobby', useSQLite: true } }, bindings: { DUEL_TICKET_SECRET: SECRET } }));
  const sockets = [];
  try {
    async function open(user) {
      const { ticket } = await issueDuelTicket(user, SECRET, 'wss://duel.example/connect');
      const response = await runtime.dispatchFetch('https://duel.example/connect?ticket=' + encodeURIComponent(ticket), { headers: { Upgrade: 'websocket', Origin: 'https://servicewechat.com' } });
      assert.equal(response.status, 101);
      const socket = response.webSocket, events = [], waiters = new Set(); sockets.push(socket);
      const client = { socket, send(value) { socket.send(JSON.stringify(value)); }, wait(predicate) {
        const past = events.find(predicate); if (past) return Promise.resolve(past);
        return new Promise((resolve, reject) => { const timer = setTimeout(() => { waiters.delete(check); reject(Error('Expected share websocket event')); }, 3000);
          const check = value => { if (predicate(value)) { clearTimeout(timer); waiters.delete(check); resolve(value); } }; waiters.add(check); });
      } };
      socket.addEventListener('message', event => { const value = JSON.parse(event.data); events.push(value); for (const check of waiters) check(value); });
      socket.accept(); await client.wait(value => value.type === 'hello'); return client;
    }
    const host = await open(A); host.send({ type: 'create_code' });
    const { shareInvite } = await host.wait(value => value.type === 'state' && value.shareInvite);
    assert.match(shareInvite.code, /^[A-HJ-NP-Z2-9]{8}$/);
    // Close to mimic WeChat opening the share sheet, then remove the isolate's
    // memory. The next user must recover the code from bounded storage alone.
    host.socket.close(1000, 'sharing');
    await runtime.unsafeEvictDurableObject('brclio-share-test', 'DuelLobby', { name: 'lobby-v1', webSockets: 'close' });
    const guest = await open(B); guest.send({ type: 'join_code', code: shareInvite.code });
    const waiting = await guest.wait(value => value.type === 'state' && value.shareInvite?.guest?.id === B.id);
    assert.equal(waiting.shareInvite.ownerOnline, false); assert.equal(waiting.room, null);
    await runtime.unsafeEvictDurableObject('brclio-share-test', 'DuelLobby', { name: 'lobby-v1', webSockets: 'hibernate' });
    const returned = await open(A);
    const paired = await returned.wait(value => value.type === 'state' && value.room);
    assert.equal(paired.room.phase, 'ready'); assert.equal(paired.shareInvite.status, 'paired');
    assert.deepEqual(new Set(paired.room.players.map(player => player.id)), new Set([A.id, B.id]));
    const guestPair = await guest.wait(value => value.type === 'state' && value.room);
    assert.equal(guestPair.room.id, paired.room.id);
  } finally { for (const socket of sockets) try { socket.close(); } catch {} await runtime.dispose(); }
});
