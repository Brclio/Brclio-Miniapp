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
  instance.sockets = new Map([A, B].map(user => [user.id, { send(data) { outbound.push({ id: user.id, value: JSON.parse(data) }); }, serializeAttachment(value) { attachments.push({ id: user.id, value }); } }]));
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
