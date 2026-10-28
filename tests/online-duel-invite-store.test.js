'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { duelGitHubFixture } = require('./helpers/duel-github.cjs');
const ROOT = path.resolve(__dirname, '..');
const A = { id: 'a'.repeat(32), displayName: '房主', avatarUrl: '' }, B = { id: 'b'.repeat(32), displayName: '对手', avatarUrl: '' };
const make = (at = Date.now()) => ({ schemaVersion: 1, code: 'ABCD2345', owner: A, guest: null, expiresAt: at + 600000, roomId: null });
function adapterClass() {
  const source = fs.readFileSync(path.join(ROOT, 'realtime/worker.mjs'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default {', 'const worker = {').replace('export class DuelLobby', 'class DuelLobby');
  const context = { DurableObject: class {}, module: { exports: {} }, Date, structuredClone, LIMITS: { codeCapacity: 500 } };
  vm.runInNewContext(source + '\nmodule.exports = { DuelLobby };', context); return context.module.exports.DuelLobby;
}

test('private GitHub invitation commits record and indexes atomically, restores exact identities and deletes on cancel', async () => {
  const { createInviteStore, invitePaths } = await import('../realtime/invite-store.mjs');
  const { createGitHubStore } = await import('../web/account-store.mjs');
  const fixture = duelGitHubFixture({ 'preserve.json': { keep: true } });
  const store = createInviteStore(fixture.bindings, { storeFactory: (env, options) => createGitHubStore(env, { ...options, fetchImpl: fixture.fetchImpl }) });
  const invitation = make();
  await store.apply([[invitation.code, invitation]]);
  assert.deepEqual(await store.readUser(A.id), invitation);
  assert.equal(fixture.files[invitePaths.userPath(A.id)].code, invitation.code);
  assert.equal(fixture.calls.filter(call => call.method === 'PATCH').length, 1);
  invitation.guest = B; await store.apply([[invitation.code, invitation]]);
  assert.equal((await store.readUser(B.id)).owner.id, A.id);
  await store.apply([[invitation.code, null]]);
  assert.equal(await store.readCode(invitation.code), null); assert.equal(await store.readUser(A.id), null); assert.equal(await store.readUser(B.id), null);
  assert.deepEqual(fixture.files, { 'preserve.json': { keep: true } });
  assert.equal(fixture.calls.every(call => !call.path.startsWith('/repos/') || call.path.startsWith('/repos/BrclioData/Brclio-Miniapp-Data')), true);
});

test('explicit expired reads remove only matching expired code and indexes; malformed private metadata never reaches sockets', async () => {
  const { createInviteStore, invitePaths } = await import('../realtime/invite-store.mjs');
  const { createGitHubStore } = await import('../web/account-store.mjs');
  let at = Date.now(); const invitation = make(at), fixture = duelGitHubFixture();
  const store = createInviteStore(fixture.bindings, { now: () => at, storeFactory: (env, options) => createGitHubStore(env, { ...options, fetchImpl: fixture.fetchImpl }) });
  await store.apply([[invitation.code, invitation]]); at += 600001;
  assert.equal(await store.readUser(A.id), null); assert.equal(fixture.files[invitePaths.codePath(invitation.code)], undefined);
  assert.equal(fixture.files[invitePaths.userPath(A.id)], undefined);
  const bad = { ...make(at), owner: { ...A, email: 'private@example.test', token: 'secret' } };
  await assert.rejects(store.apply([[bad.code, bad]]), { safeCode: 'invite_record_invalid' });
});

test('legacy Cloudflare records move to private GitHub before deletion; a failed migration retains the original copy', async () => {
  const Class = adapterClass(), invitation = make(), events = [];
  for (const fail of [false, true]) {
    const instance = Object.create(Class.prototype);
    instance.ctx = { storage: { async list() { return new Map([['invite-code:' + invitation.code, invitation]]); }, async delete(keys) { events.push(['delete', keys]); } } };
    instance.invites = { async apply(changes) { events.push(['commit', changes]); if (fail) throw Error('upstream unavailable'); } };
    const before = events.length;
    if (fail) { await assert.rejects(instance.migrateLegacy()); assert.equal(events.slice(before).some(event => event[0] === 'delete'), false); }
    else { await instance.migrateLegacy(); assert.deepEqual(events.slice(before).map(event => event[0]), ['commit', 'delete']); }
  }
});

async function workerHarness() {
  const Class = adapterClass(), { DuelHub } = await import('../realtime/duel-hub.mjs');
  const instance = Object.create(Class.prototype), outbound = [], attachments = [], writes = [];
  let at = Date.now(), serial = 0;
  instance.buffers = new Map(); instance.pendingLobby = false; instance.nextAlarmAt = null;
  instance.ctx = { storage: { async setAlarm() {}, async deleteAlarm() {} } };
  instance.sockets = new Map([A, B].map(user => [user.id, { send(data) { outbound.push({ id: user.id, value: JSON.parse(data) }); }, serializeAttachment(value) { attachments.push({ id: user.id, value }); }, deserializeAttachment() { return instance.hub.attachment(user.id); } }]));
  instance.hub = new DuelHub({ now: () => at, id: () => 'id-' + ++serial, code: () => 'ABCD2345', send(id, value) {
    if (value.type === 'lobby' && instance.buffers.size) { instance.pendingLobby = true; return; }
    if (instance.buffers.has(id) && value.type !== 'pong') instance.buffers.get(id).push(value);
    else instance.sockets.get(id)?.send(JSON.stringify(value));
  } });
  instance.invites = { async readUser() { return null; }, async readCode() { return null; }, async apply(changes) { writes.push(changes); } };
  instance.hub.connect(A); instance.hub.connect(B); outbound.length = 0;
  return { instance, outbound, attachments, writes, get at() { return at; }, advance(ms) { at += ms; },
    probe(user) { instance.hub.receive(user.id, { type: 'ping', id: 'p-' + ++serial, clientAt: at }); const pong = outbound.filter(event => event.id === user.id && event.value.type === 'pong').at(-1).value; instance.hub.receive(user.id, { type: 'probe_ack', probeId: pong.probeId }); } };
}

test('uncommitted code is neither acknowledged nor attached, but heartbeat pongs remain immediate while GitHub waits', async () => {
  const h = await workerHarness(); let finish, started;
  const entered = new Promise(resolve => { started = resolve; });
  h.instance.invites.apply = () => new Promise(resolve => { finish = resolve; started(); });
  const pending = h.instance.shareAction(A.id, { type: 'create_code' }); await entered;
  assert.equal(h.outbound.some(event => event.value.shareInvite), false);
  h.probe(A); await h.instance.persist();
  assert.equal(h.outbound.some(event => event.id === A.id && event.value.type === 'pong'), true);
  assert.equal(h.attachments.some(event => event.id === A.id && event.value.shareReservation), false);
  finish(); await pending;
  assert.equal(h.outbound.some(event => event.id === A.id && event.value.shareInvite?.code === 'ABCD2345'), true);
  assert.equal(h.attachments.some(event => event.id === A.id && event.value.shareReservation?.code === 'ABCD2345'), true);
});

test('occupied plaza heartbeats survive lease checks without GitHub IO and the final departure clears its only alarm', async () => {
  const h = await workerHarness(), alarms = [], githubCalls = [];
  h.instance.ctx.storage = { async setAlarm(at) { alarms.push(['set', at]); }, async deleteAlarm() { alarms.push(['delete']); } };
  for (const method of ['readUser', 'readCode', 'apply']) h.instance.invites[method] = async () => { githubCalls.push(method); throw Error('Heartbeats must not access GitHub'); };
  for (let index = 0; index < 36; index++) {
    h.advance(5000);
    for (const user of [A, B]) {
      const socket = h.instance.sockets.get(user.id);
      await h.instance.webSocketMessage(socket, JSON.stringify({ type: 'ping', id: 'heartbeat-' + index, clientAt: h.at }));
    }
    if (h.instance.nextAlarmAt <= h.at) await h.instance.alarm();
    assert.equal(h.instance.hub.users.size, 2);
    assert.ok(h.instance.nextAlarmAt > h.at);
  }
  assert.equal(h.outbound.filter(event => event.value.type === 'pong').length, 72);
  assert.deepEqual(githubCalls, []); assert.equal(h.writes.length, 0);
  assert.ok(alarms.filter(call => call[0] === 'set').length <= 4, 'heartbeats do not postpone the alarm on every message');
  const a = h.instance.sockets.get(A.id), b = h.instance.sockets.get(B.id);
  await h.instance.drop(a, A.id);
  assert.equal(h.instance.hub.users.size, 1); assert.notEqual(h.instance.nextAlarmAt, null);
  await h.instance.drop(b, B.id);
  assert.equal(h.instance.hub.users.size, 0); assert.equal(h.instance.nextAlarmAt, null);
  assert.deepEqual(alarms.at(-1), ['delete']);
});

test('GitHub failure rolls a new share invitation back without broadcasting a phantom code', async () => {
  const h = await workerHarness(); h.instance.invites.apply = async () => { throw Error('private diagnostics'); };
  await h.instance.shareAction(A.id, { type: 'create_code' });
  assert.equal(h.instance.hub.codeInvites.size, 0); assert.equal(h.outbound.some(event => event.value.shareInvite), false);
  assert.equal(h.outbound.some(event => event.value.code === 'invite_store_unavailable'), true);
  assert.doesNotMatch(JSON.stringify(h.outbound), /private diagnostics/);
});

test('second ready consumes the GitHub invitation before computing a new future arming deadline', async () => {
  const h = await workerHarness(), hub = h.instance.hub;
  hub.receive(A.id, { type: 'create_code' }); hub.receive(B.id, { type: 'join_code', code: 'ABCD2345' });
  h.instance.invites.readCode = async () => structuredClone(hub.codeInvites.get('ABCD2345'));
  h.probe(A); h.probe(B); hub.receive(A.id, { type: 'ready', rtt: 10, uncertainty: 5 });
  h.instance.invites.apply = async changes => {
    assert.equal(hub.state(A.id).room.phase, 'ready'); assert.equal(changes[0][1], null); h.advance(8000);
  };
  await h.instance.shareAction(B.id, { type: 'ready', rtt: 10, uncertainty: 5 });
  const room = hub.state(A.id).room;
  assert.equal(room.phase, 'arming'); assert.equal(room.startAt - h.at, 2000); assert.equal(hub.state(A.id).shareInvite, null);
});

test('a stale reward agreement or wrong room ready never reads or consumes its private invitation', async () => {
  const h = await workerHarness(), hub = h.instance.hub, githubCalls = [];
  hub.receive(A.id, { type: 'create_code' }); hub.receive(B.id, { type: 'join_code', code: 'ABCD2345' });
  const room = hub.rooms.get(hub.users.get(A.id).roomId);
  hub.receive(A.id, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '一杯奶茶' });
  hub.receive(B.id, { type: 'set_reward', roomId: room.id, mode: 'custom', text: '免洗碗一次' });
  h.probe(A); h.probe(B);
  hub.receive(A.id, { type: 'ready', roomId: room.id, rewardRevision: room.rewardRevision, rtt: 10, uncertainty: 5 });
  assert.deepEqual(room.ready, [A.id]);
  for (const method of ['readUser', 'readCode', 'apply']) h.instance.invites[method] = async () => {
    githubCalls.push(method); throw Error('Obsolete agreements must be rejected before GitHub IO');
  };
  for (const [agreement, code] of [
    [{ roomId: room.id, rewardRevision: 1 }, 'reward_changed'],
    [{ roomId: 'old-room', rewardRevision: 2 }, 'reward_room_changed'],
    [{ roomId: room.id }, 'reward_changed'],
    [{ rewardRevision: 2 }, 'reward_room_changed']
  ]) {
    h.outbound.length = 0;
    await h.instance.shareAction(B.id, { type: 'ready', ...agreement, rtt: 10, uncertainty: 5 });
    assert.equal(h.outbound.find(event => event.id === B.id && event.value.type === 'error')?.value.code, code);
    assert.equal(room.phase, 'ready'); assert.deepEqual(room.ready, [A.id]);
    assert.equal(hub.codeFor(B.id)?.code, 'ABCD2345'); assert.equal(h.instance.buffers.size, 0);
  }
  assert.deepEqual(githubCalls, []); assert.deepEqual(h.writes, []);
});

test('buffered reward acknowledgements follow the authoritative state, including no-op saves, without GitHub IO', async () => {
  const h = await workerHarness(), hub = h.instance.hub, githubCalls = [];
  hub.receive(A.id, { type: 'invite', userId: B.id });
  hub.receive(B.id, { type: 'accept', invitationId: hub.state(B.id).invitation.id });
  const room = hub.rooms.get(hub.users.get(A.id).roomId);
  for (const method of ['readUser', 'readCode', 'apply']) h.instance.invites[method] = async () => {
    githubCalls.push(method); throw Error('A transient room reward must not create a business document');
  };
  for (const requestId of ['save-reward', 'save-same-reward']) {
    h.outbound.length = 0;
    await h.instance.shareAction(A.id, { type: 'set_reward', roomId: room.id, requestId, mode: 'custom', text: '请喝一杯咖啡' });
    const own = h.outbound.filter(event => event.id === A.id).map(event => event.value);
    const stateAt = own.findIndex(value => value.type === 'state' && value.room?.rewardRevision === 1);
    const ackAt = own.findIndex(value => value.type === 'reward_saved' && value.requestId === requestId);
    assert.ok(stateAt >= 0); assert.ok(ackAt > stateAt, 'the client must receive the agreed reward before its save promise resolves');
    assert.equal(own[stateAt].room.rewards[A.id].text, '请喝一杯咖啡');
    assert.equal(own[ackAt].roomId, room.id); assert.equal(own[ackAt].rewardRevision, 1);
    assert.equal(h.outbound.some(event => event.id === B.id && event.value.type === 'reward_saved'), false);
    assert.equal(hub.state(B.id).room.rewards[A.id].text, '请喝一杯咖啡');
  }
  assert.deepEqual(githubCalls, []); assert.deepEqual(h.writes, []);
});
