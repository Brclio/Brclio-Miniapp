#!/usr/bin/env node
// Explicit production verification using only marker-owned synthetic accounts.
// No owner account, password/credentials file, email delivery, or real user's
// business record is accessed. Signed tickets and bearer tokens stay in memory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetch as undiciFetch, WebSocket, EnvHttpProxyAgent } from 'undici';
import { createGitHubStore } from '../web/account-store.mjs';
import { accountInternals } from '../web/account-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINS = ['https://pocket.bornforthis.cn', 'https://pocket.brclio.com'];
const SOCKET_URL = 'wss://pk.brclio-miniapp.bornforthis.cn/connect';
const VERSION = '0.1.11';
const KIND = 'online-duel-live-smoke-v1';
const REPOS = { users: 'Brclio-Miniapp-UserData', data: 'Brclio-Miniapp-Data' };
const runId = randomBytes(6).toString('hex'), startedAt = new Date().toISOString();
const relativeDirectory = 'artifacts/online-duel/' + VERSION + '/live-' + runId;
const directory = path.join(ROOT, relativeDirectory);
const marker = { kind: KIND, runId, nonce: randomBytes(16).toString('hex') };
const fixtures = [], sockets = [], timers = new Set();
const knownInvites = new Map();
const report = { schemaVersion: 1, kind: KIND, runId, version: VERSION, startedAt, passed: false, checks: [], requests: [], storage: [], storageProof: [], cleanup: [], rounds: [] };
const dispatcher = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy ? new EnvHttpProxyAgent() : undefined;
const networkFetch = (input, init = {}) => undiciFetch(input, { ...init, ...(dispatcher ? { dispatcher } : {}) });
let env, users, dataStore, outputReady = false, seedAttempted = false, failedRound = false;

function ensure(ok, safeCode) { if (!ok) throw Object.assign(new Error(safeCode), { safeCode }); }
function checked(name, condition) { ensure(condition, name); report.checks.push(name); }
function safeError(error) { return /^[a-z][a-z0-9_]{0,100}$/.test(error?.safeCode || '') ? error.safeCode : 'smoke_operation_failed'; }
function phase(name) { console.log('[online PK smoke] ' + name); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function later(fn, ms) { const id = setTimeout(() => { timers.delete(id); fn(); }, Math.max(0, ms)); timers.add(id); return id; }
function delay(ms) { return new Promise(resolve => later(resolve, ms)); }
function publicFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    ensure(!/password|credential|secret|session_key|openid|unionid|^token$|^email$/i.test(key), 'public_response_contains_private_fields');
    publicFields(item);
  }
}
function ownsProfile(value, fixture) {
  return value?.id === fixture.id && value.username === fixture.username && value.email === '' && value.status === 'active' &&
    same(value.providers, []) && same(value.smokeFixture, fixture.marker);
}
function ownsSessions(value, fixture) {
  return value?.schemaVersion === 1 && Array.isArray(value.items) && value.items.length === 1 &&
    value.items[0].hash === fixture.sessionHash && value.items[0].createdAt === fixture.createdAt &&
    value.items[0].expiresAt === null && same(value.items[0].smokeFixture, fixture.marker);
}
function ownsFriendDocument(value) {
  if (!value || value.schemaVersion !== 1) return false;
  const ids = new Set(fixtures.map(fixture => fixture.id));
  return Array.isArray(value.friends) && value.friends.every(item => ids.has(item?.user?.id)) &&
    Array.isArray(value.incoming) && value.incoming.every(item => ids.has(item?.from?.id)) &&
    Array.isArray(value.outgoing) && value.outgoing.every(item => ids.has(item?.to?.id)) &&
    Array.isArray(value.handled) && value.handled.every(item => ids.has(item?.userId));
}
function codePath(code) {
  ensure(/^[A-HJ-NP-Z2-9]{8}$/.test(code), 'invite_code_invalid');
  return 'realtime/v1/invites/' + code + '.json';
}
function ownsInvite(value, code) {
  const known = knownInvites.get(code), ids = new Set(fixtures.map(fixture => fixture.id));
  return !!known && value?.schemaVersion === 1 && value.code === code && ids.has(value.owner?.id) &&
    (!known.ownerId || value.owner.id === known.ownerId) && (value.guest === null || ids.has(value.guest?.id)) &&
    (value.guest === null || value.guest.id !== value.owner.id) && Number.isSafeInteger(value.expiresAt) && value.roomId === null;
}
async function rememberInvite(invitation, owner, guest = null) {
  ensure(/^[A-HJ-NP-Z2-9]{8}$/.test(invitation?.code || ''), 'invite_code_invalid');
  knownInvites.set(invitation.code, { code: invitation.code, path: codePath(invitation.code), ownerId: owner.id, guestId: guest?.id || null, expiresAt: invitation.expiresAt, learnedFrom: 'authenticated_websocket_state' });
  await recovery();
}
async function proveInvite(stage, code, owner, guest = null) {
  const known = knownInvites.get(code), record = await readCurrent(dataStore, codePath(code));
  ensure(ownsInvite(record, code), 'invite_storage_ownership_unverified'); publicFields(record);
  checked(stage + '_private_record', record.owner.id === owner.id && (guest ? record.guest?.id === guest.id : record.guest === null) && record.expiresAt === known.expiresAt);
  const ownerIndex = await readCurrent(dataStore, owner.duelInvitePath);
  checked(stage + '_owner_index', ownerIndex?.schemaVersion === 1 && ownerIndex.code === code && ownerIndex.expiresAt === record.expiresAt);
  if (guest) {
    const guestIndex = await readCurrent(dataStore, guest.duelInvitePath);
    checked(stage + '_guest_index', guestIndex?.schemaVersion === 1 && guestIndex.code === code && guestIndex.expiresAt === record.expiresAt);
    known.guestId = guest.id;
  }
  report.storageProof.push({ stage, repository: REPOS.data, codePath: known.path, ownerIndex: owner.duelInvitePath, guestIndex: guest?.duelInvitePath || null, codePresent: true });
  return record;
}
async function proveInviteRemoved(stage, code, owner, guest) {
  checked(stage + '_record_removed', await readCurrent(dataStore, codePath(code)) === null);
  for (const fixture of [owner, guest].filter(Boolean)) checked(stage + '_index_removed_' + fixture.label, await readCurrent(dataStore, fixture.duelInvitePath) === null);
  report.storageProof.push({ stage, repository: REPOS.data, codePath: codePath(code), ownerIndex: owner.duelInvitePath, guestIndex: guest?.duelInvitePath || null, codePresent: false });
}
// Retry only this verifier's read-only GitHub observations. Application writes
// and their status checks are never retried or reclassified as successful.
async function readCurrent(backend, target) {
  for (let attempt = 0; ; attempt++) {
    try { return await backend.read(target); }
    catch (error) {
      if (error?.safeCode !== 'store_upstream_unavailable' || attempt >= 2) throw error;
      (report.verifierReadRetries ||= []).push({ path: target, attempt: attempt + 1, code: error.safeCode });
      await delay(500 * (attempt + 1));
    }
  }
}
async function loadEnvironment() {
  for (const item of ['.dev.vars', relativeDirectory + '/report.json']) {
    try { await promisify(execFile)('git', ['check-ignore', '--quiet', '--', item], { cwd: ROOT }); }
    catch { ensure(false, 'private_paths_not_ignored'); }
  }
  const values = Object.create(null);
  for (const line of (await fs.readFile(path.join(ROOT, '.dev.vars'), 'utf8')).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    ensure(match, 'configuration_format_invalid');
    try { values[match[1]] = JSON.parse(match[2]); } catch { ensure(false, 'configuration_format_invalid'); }
  }
  ensure(values.ACCOUNT_ENABLED === 'true' && values.ACCOUNT_HMAC_SECRET?.length >= 32, 'account_configuration_missing');
  return values;
}
async function recovery() {
  if (!outputReady) return;
  const value = { schemaVersion: 1, kind: KIND, runId, startedAt, origins: ORIGINS, socketUrl: SOCKET_URL,
    note: 'No bearer, websocket ticket, password, or ordinary account details are recorded. Remove only exact smokeFixture marker-owned profile/session/index records below; friend and invite records may be deleted only while all referenced user IDs belong to this fixture set. Known short-lived invitation codes are inventoried for exact recovery. No full registry is read. Shared Git history remains.',
    seedAttempted, fixtures: fixtures.map(fixture => ({ userId: fixture.id, username: fixture.username, marker: fixture.marker,
      profilePath: fixture.profilePath, sessionsPath: fixture.sessionsPath, usernameIndexPath: fixture.usernameIndexPath,
      friendsPath: fixture.friendsPath, duelInvitePath: fixture.duelInvitePath, temporarySessionHash: fixture.sessionHash, createdAt: fixture.createdAt })),
    invitations: [...knownInvites.values()] };
  await fs.writeFile(path.join(directory, 'recovery.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function observedFetch(input, init = {}) {
  const url = new URL(input), method = init.method || 'GET';
  ensure(url.origin === 'https://api.github.com', 'storage_origin_invalid');
  const match = /^\/repos\/BrclioData\/([^/]+)(?:\/|$)/.exec(url.pathname);
  if (match) {
    ensure(Object.values(REPOS).includes(match[1]), 'storage_repository_invalid');
    const allowed = new Set(fixtures.flatMap(fixture => match[1] === REPOS.users ? [fixture.profilePath, fixture.sessionsPath, fixture.usernameIndexPath] : [fixture.friendsPath, fixture.duelInvitePath]));
    if (match[1] === REPOS.data) for (const invitation of knownInvites.values()) allowed.add(invitation.path);
    const content = /\/contents\/(.+)$/.exec(url.pathname);
    if (content) ensure(allowed.has(content[1].split('/').map(decodeURIComponent).join('/')), 'storage_read_scope_invalid');
    if (method === 'POST' && url.pathname.endsWith('/git/trees')) {
      const value = JSON.parse(init.body);
      ensure(Array.isArray(value.tree) && value.tree.every(entry => allowed.has(entry.path)), 'storage_write_scope_invalid');
    }
    ensure(!/credentials\.json/.test(url.pathname), 'credentials_access_forbidden');
  } else {
    ensure(/^\/app\/installations\/[1-9][0-9]*\/access_tokens$/.test(url.pathname) && method === 'POST', 'storage_endpoint_invalid');
    const value = JSON.parse(init.body);
    ensure(Array.isArray(value.repositories) && value.repositories.length === 1 && Object.values(REPOS).includes(value.repositories[0]), 'token_repository_scope_invalid');
  }
  const observation = { repository: match?.[1] || 'github-app', method, path: url.pathname, status: null };
  report.storage.push(observation);
  const begin = performance.now();
  try {
    const response = await networkFetch(input, init); observation.status = response.status; return response;
  } catch (error) { observation.failure = 'transport_failed'; throw error; }
  finally { observation.durationMs = Math.round(performance.now() - begin); }
}
async function call(origin, route, { fixture, data, expected = 200, method = data === undefined ? 'GET' : 'POST' } = {}) {
  ensure(ORIGINS.includes(origin), 'request_origin_invalid');
  const record = { origin, route, method, expected, status: null }, begin = performance.now(); report.requests.push(record);
  try {
    const response = await networkFetch(origin + '/api/account' + route, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(fixture ? { Authorization: 'Bearer ' + fixture.token } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    record.status = response.status;
    const value = await response.json(); publicFields(value);
    ensure(response.headers.get('Cache-Control')?.includes('no-store'), 'api_cache_policy_invalid');
    if (response.status !== expected) { record.errorCode = /^[a-z][a-z0-9_]{0,79}$/.test(value?.error || '') ? value.error : 'unexpected_status'; ensure(false, 'api_status_unexpected'); }
    return value;
  } finally { record.durationMs = Math.round(performance.now() - begin); }
}
async function publicPreflight() {
  for (const origin of ORIGINS) {
    const health = await networkFetch(origin + '/api/health', { signal: AbortSignal.timeout(60000) });
    checked('health_version_' + new URL(origin).hostname, health.ok && (await health.json()).version === VERSION);
    const page = await networkFetch(origin + '/', { signal: AbortSignal.timeout(60000) });
    checked('portal_reachable_' + new URL(origin).hostname, page.ok && (await page.text()).includes('Brclio'));
    await call(origin, '/friends', { expected: 401 });
    await call(origin, '/duel-ticket', { data: {}, expected: 401 });
  }
  const health = await networkFetch(SOCKET_URL.replace('wss:', 'https:').replace('/connect', '/health'), { signal: AbortSignal.timeout(60000) });
  checked('realtime_health', health.ok && (await health.json()).service === 'brclio-online-duel');
}
async function seedFixtures() {
  for (const label of ['a', 'b', 'c']) {
    const id = randomBytes(16).toString('hex'), token = 'm1.' + id + '.' + randomBytes(32).toString('hex');
    fixtures.push({ label, id, token, sessionHash: hash(token), username: 'qapk_' + runId + label, createdAt: Date.now(), marker: { ...marker, label },
      profilePath: accountInternals.userPath(id, 'profile'), sessionsPath: accountInternals.userPath(id, 'sessions'),
      usernameIndexPath: await accountInternals.indexPath(env.ACCOUNT_HMAC_SECRET, 'username', 'qapk_' + runId + label),
      friendsPath: 'users/v1/' + id.slice(0, 2) + '/' + id + '/friends.json',
      duelInvitePath: 'users/v1/' + id.slice(0, 2) + '/' + id + '/duel-invite.json' });
  }
  seedAttempted = true; await recovery();
  await users.transaction(async tx => {
    for (const fixture of fixtures) for (const key of ['profilePath', 'sessionsPath', 'usernameIndexPath']) ensure(await tx.get(fixture[key]) === null, 'fixture_path_occupied');
    for (const fixture of fixtures) {
      tx.put(fixture.profilePath, { schemaVersion: 1, id: fixture.id, username: fixture.username, email: '', displayName: 'PK smoke ' + runId + fixture.label,
        status: 'active', providers: [], avatar: { type: 'builtin', id: 1 }, createdAt: fixture.createdAt, updatedAt: fixture.createdAt, smokeFixture: fixture.marker });
      tx.put(fixture.sessionsPath, { schemaVersion: 1, items: [{ hash: fixture.sessionHash, createdAt: fixture.createdAt, expiresAt: null, smokeFixture: fixture.marker }] });
      tx.put(fixture.usernameIndexPath, { userId: fixture.id, smokeFixture: fixture.marker });
    }
  });
  for (const fixture of fixtures) checked('fixture_seed_readback_' + fixture.label, ownsProfile(await readCurrent(users, fixture.profilePath), fixture) && ownsSessions(await readCurrent(users, fixture.sessionsPath), fixture));
}
async function verifyFriends() {
  const [a, b, c] = fixtures;
  checked('friend_list_starts_empty', (await call(ORIGINS[0], '/friends', { fixture: a })).friends.length === 0);
  const sent = await call(ORIGINS[0], '/friends/request', { fixture: a, data: { username: b.username } });
  const invitation = sent.outgoing.find(value => value.to.id === b.id); checked('friend_exact_username_request', !!invitation);
  checked('friend_incoming_cross_alias', (await call(ORIGINS[1], '/friends', { fixture: b })).incoming.some(value => value.id === invitation.id && value.from.id === a.id));
  await call(ORIGINS[0], '/friends/respond', { fixture: c, data: { requestId: invitation.id, accept: true }, expected: 404 });
  checked('friend_third_party_cannot_accept', (await call(ORIGINS[0], '/friends', { fixture: c })).friends.length === 0);
  const accepted = await call(ORIGINS[1], '/friends/respond', { fixture: b, data: { requestId: invitation.id, accept: true } });
  checked('friend_recipient_accepts', accepted.friends.some(value => value.user.id === a.id));
  checked('friend_accept_is_mutual', (await call(ORIGINS[0], '/friends', { fixture: a })).friends.some(value => value.user.id === b.id));
  checked('friend_remove_self_side', (await call(ORIGINS[1], '/friends/remove', { fixture: a, data: { userId: b.id } })).friends.length === 0);
  checked('friend_remove_peer_side', (await call(ORIGINS[0], '/friends', { fixture: b })).friends.length === 0);
}
async function ticket(fixture) {
  const value = await call(ORIGINS[fixture.label === 'b' ? 1 : 0], '/duel-ticket', { fixture, data: {} });
  checked('ticket_socket_' + fixture.label, value.socketUrl === SOCKET_URL && typeof value.ticket === 'string' && Number.isSafeInteger(value.expiresAt));
  return value.ticket;
}
async function open(fixture) {
  const value = await ticket(fixture);
  const ws = new WebSocket(SOCKET_URL + '?ticket=' + encodeURIComponent(value), { ...(dispatcher ? { dispatcher } : {}), headers: { Origin: 'https://servicewechat.com' } });
  const events = [], waiters = new Set(), pending = new Map(); let serial = 0, pingId = 0, receivedProbes = 0, heartbeat, closed = false;
  const connection = { fixture, ws, samples: [], state: null, offset: 0, closed: false, mark: () => serial,
    send(message) { ensure(ws.readyState === WebSocket.OPEN, 'socket_not_open'); ws.send(JSON.stringify(message)); },
    wait(predicate, after = 0, timeout = 60000) {
      const found = events.find(event => event.serial > after && predicate(event.value)); if (found) return Promise.resolve(found.value);
      return new Promise((resolve, reject) => {
        const id = later(() => { waiters.delete(check); reject(Object.assign(new Error('socket_event_timeout'), { safeCode: 'socket_event_timeout' })); }, timeout);
        const check = event => { if (event.serial > after && predicate(event.value)) { clearTimeout(id); timers.delete(id); waiters.delete(check); resolve(event.value); } };
        waiters.add(check);
      });
    },
    ping() { const id = String(++pingId), clientAt = Date.now(); pending.set(id, clientAt); this.send({ type: 'ping', id, clientAt }); },
    async calibrate() {
      const before = receivedProbes;
      for (let n = 0; n < 5; n++) { this.ping(); await delay(130); }
      const until = Date.now() + 10000; while (receivedProbes < before + 3 && Date.now() < until && !closed) await delay(100);
      ensure(receivedProbes >= before + 3, 'clock_probe_timeout');
      const sample = this.samples.slice(-8).reduce((a, b) => a.rtt <= b.rtt ? a : b); this.offset = sample.offset;
      return { rtt: Math.round(sample.rtt), uncertainty: Math.ceil(sample.rtt / 2) };
    },
    async close() {
      if (closed) return;
      clearInterval(heartbeat);
      const done = new Promise(resolve => { ws.addEventListener('close', resolve, { once: true }); later(resolve, 3000); });
      try { ws.close(1000, 'production_smoke_done'); } catch {}
      await done; this.closed = true;
    }
  };
  sockets.push(connection);
  ws.addEventListener('message', event => {
    let message; try { message = JSON.parse(String(event.data)); } catch { return; }
    const item = { serial: ++serial, value: message }; events.push(item); if (events.length > 500) events.shift();
    if (message.type === 'hello' && Number.isFinite(message.serverAt)) connection.offset = message.serverAt - Date.now();
    if (message.type === 'pong') {
      const clientAt = pending.get(message.id); pending.delete(message.id);
      if (clientAt !== undefined) { receivedProbes += 1; const at = Date.now(); connection.samples.push({ rtt: at - clientAt, offset: message.serverAt - (at + clientAt) / 2 }); if (connection.samples.length > 30) connection.samples.shift(); }
      if (message.probeId && ws.readyState === WebSocket.OPEN) connection.send({ type: 'probe_ack', probeId: message.probeId });
    }
    if (message.type === 'state') {
      connection.state = message;
      if (message.room?.phase === 'arming' && ws.readyState === WebSocket.OPEN) connection.send({ type: 'armed', roundId: message.room.roundId });
    }
    for (const check of [...waiters]) check(item);
  });
  ws.addEventListener('close', () => { closed = true; connection.closed = true; clearInterval(heartbeat); });
  // Never log event.error: it may contain the signed ticket URL.
  ws.addEventListener('error', () => { connection.socketError = 'socket_transport_error'; });
  const hello = await connection.wait(message => message.type === 'hello'); checked('socket_authenticated_' + fixture.label, hello.user?.id === fixture.id);
  heartbeat = setInterval(() => {
    if (!closed && ws.readyState === WebSocket.OPEN) {
      try { connection.ping(); } catch { connection.socketError = 'socket_transport_error'; clearInterval(heartbeat); }
    }
  }, 1000);
  await connection.calibrate(); return connection;
}
async function round(a, b, mode = 'reaction') {
  const measurements = await Promise.all([a.calibrate(), b.calibrate()]);
  const result = { mode, status: 'pending', rtt: measurements.map((value, i) => ({ player: i === 0 ? 'a' : 'b', ...value })) }; report.rounds.push(result);
  if (measurements.some(value => value.rtt > 300 || value.uncertainty > 150)) { result.status = 'blocked_by_live_latency'; failedRound = true; return false; }
  const marks = [a.mark(), b.mark()]; a.send({ type: 'ready', ...measurements[0] }); b.send({ type: 'ready', ...measurements[1] });
  const scheduled = await a.wait(message => message.type === 'state' && message.room?.phase === 'scheduled', marks[0]);
  const peer = await b.wait(message => message.type === 'state' && message.room?.phase === 'scheduled' && message.room.roundId === scheduled.room.roundId, marks[1]);
  checked('common_signal_time_' + mode, scheduled.room.signalAt === peer.room.signalAt);
  const room = scheduled.room;
  if (mode === 'disconnect') {
    const mark = b.mark(); await a.close(); const state = await b.wait(message => message.type === 'state' && message.room?.phase === 'aborted', mark);
    checked('disconnect_aborts_no_winner', state.room.result?.winnerId === null); result.status = 'passed'; return true;
  }
  const completion = a.wait(message => message.type === 'state' && message.room?.roundId === room.roundId && ['finished', 'aborted'].includes(message.room.phase), marks[0], 18000);
  if (mode === 'false_start') {
    const target = room.signalAt - a.offset - 500;
    later(() => { if (!a.closed) a.send({ type: 'tap', roundId: room.roundId, reactionMs: Math.min(-1, Math.round(Date.now() - (room.signalAt - a.offset))) }); }, target - Date.now());
  } else {
    result.cueCallbacks = [];
    for (const [connection, reaction] of [[a, 180], [b, 340]]) {
      const target = room.signalAt - connection.offset;
      later(() => {
        if (connection.closed) return;
        const cueAt = Date.now(), lateMs = Math.round(cueAt - target); result.cueCallbacks.push({ player: connection.fixture.label, lateMs });
        if (lateMs > 120) { result.status = 'blocked_by_local_timer_delay'; failedRound = true; connection.send({ type: 'leave' }); return; }
        later(() => { if (!connection.closed) connection.send({ type: 'tap', roundId: room.roundId, reactionMs: Date.now() - cueAt }); }, reaction);
      }, target - Date.now());
    }
  }
  const finished = await completion;
  if (finished.room.phase === 'aborted') { result.status = 'aborted_by_live_timing_or_disconnect'; result.reason = finished.room.result?.reason; failedRound = true; return false; }
  const expectedWinner = mode === 'false_start' ? b.fixture.id : a.fixture.id;
  checked('result_' + mode, finished.room.result?.reason === mode && finished.room.result?.winnerId === expectedWinner);
  const other = await b.wait(message => message.type === 'state' && message.room?.phase === 'finished' && message.room.roundId === room.roundId, marks[1]);
  checked('same_result_' + mode, same(finished.room.result, other.room.result));
  result.status = 'passed'; result.reason = finished.room.result.reason;
  result.reactions = Object.entries(finished.room.result.reactions).map(([id, ms]) => ({ player: id === a.fixture.id ? 'a' : 'b', ms }));
  return true;
}
async function verifyRealtime() {
  const [af, bf, cf] = fixtures; let a = await open(af); const b = await open(bf), c = await open(cf);
  let mark = a.mark(); a.send({ type: 'create_code' });
  const invitation = (await a.wait(message => message.type === 'state' && message.shareInvite, mark)).shareInvite;
  checked('share_code_created', /^[A-HJ-NP-Z2-9]{8}$/.test(invitation.code));
  await rememberInvite(invitation, af);
  const createdRecord = await proveInvite('share_created', invitation.code, af);
  await a.close(); await delay(200);
  checked('host_close_preserves_private_invitation', same(await proveInvite('host_closed', invitation.code, af), createdRecord));
  mark = b.mark(); b.send({ type: 'join_code', code: invitation.code });
  const waiting = await b.wait(message => message.type === 'state' && message.shareInvite?.guest?.id === bf.id, mark);
  checked('guest_waits_for_shared_host_return', waiting.shareInvite.ownerOnline === false && waiting.shareInvite.status === 'waiting' && waiting.room === null);
  await proveInvite('guest_reserved', invitation.code, af, bf); await recovery();
  mark = c.mark(); c.send({ type: 'join_code', code: invitation.code });
  checked('third_cannot_take_reserved_code', (await c.wait(message => message.type === 'error', mark)).code === 'code_full');
  const bmark = b.mark(); a = await open(af);
  const paired = await a.wait(message => message.type === 'state' && message.room?.phase === 'ready');
  const bpaired = await b.wait(message => message.type === 'state' && message.room?.phase === 'ready', bmark);
  checked('shared_host_reconnect_pairs_same_room', paired.room.id === bpaired.room.id);
  checked('random_opposite_colors', new Set(paired.room.players.map(player => player.color)).size === 2);
  await proveInvite('host_reconnected', invitation.code, af, bf);
  mark = a.mark(); a.send({ type: 'leave' }); await a.wait(message => message.type === 'state' && !message.room && !message.shareInvite, mark);
  mark = b.mark(); b.send({ type: 'leave' }); await b.wait(message => message.type === 'state' && !message.room && !message.shareInvite, mark);
  await proveInviteRemoved('share_cancelled', invitation.code, af, bf);
  await delay(2100); mark = c.mark(); c.send({ type: 'join_code', code: invitation.code });
  checked('cancelled_share_code_rejected', (await c.wait(message => message.type === 'error', mark)).code === 'code_expired');
  mark = a.mark(); const mb = b.mark(); a.send({ type: 'invite', userId: bf.id });
  const invite = (await b.wait(message => message.type === 'state' && message.invitation, mb)).invitation;
  const thirdMark = c.mark(); c.send({ type: 'accept', invitationId: invite.id });
  checked('third_cannot_accept_direct_invitation', (await c.wait(message => message.type === 'error', thirdMark)).code === 'invitation_expired');
  a.send({ type: 'cancel', invitationId: invite.id });
  checked('direct_invitation_cancelled', !(await a.wait(message => message.type === 'state' && !message.invitation, mark)).invitation);
  // The timed round uses a fresh share code so successful play also proves
  // consumption of the exact GitHub record and both per-user indices.
  mark = b.mark(); b.send({ type: 'create_code' });
  const nextCode = (await b.wait(message => message.type === 'state' && message.shareInvite, mark)).shareInvite;
  await rememberInvite(nextCode, bf); await proveInvite('timed_code_created', nextCode.code, bf);
  const roomMark = a.mark(); a.send({ type: 'join_code', code: nextCode.code });
  await a.wait(message => message.type === 'state' && message.room?.phase === 'ready', roomMark);
  await proveInvite('timed_code_reserved', nextCode.code, bf, af); await recovery();
  if (await round(a, b, 'reaction')) {
    // Storage reads deliberately happen after the round. GitHub traffic is
    // never placed between scheduled GO and tap timers in this verifier.
    await proveInviteRemoved('both_ready_consumed', nextCode.code, bf, af);
    await round(a, b, 'false_start');
    if (!a.closed && a.state?.room?.phase === 'finished') await round(a, b, 'disconnect');
  }
  // A pre-game room still provides an honest transport-abort check when RTT
  // gates prevent timed play. Never manufacture a successful timed result.
  if (!a.closed) { mark = b.mark(); await a.close(); const state = await b.wait(message => message.type === 'state' && message.room?.phase === 'aborted', mark); checked('transport_close_aborts_without_win', state.room.result?.winnerId === null); }
  if (!b.closed) {
    mark = b.mark(); b.send({ type: 'leave' });
    await b.wait(message => message.type === 'state' && !message.room && !message.shareInvite, mark);
    await proveInviteRemoved('timed_invitation_finally_cleared', nextCode.code, bf, af);
  }
}
async function cleanup() {
  for (const timer of timers) clearTimeout(timer); timers.clear();
  for (const connection of sockets) { try { await connection.close(); } catch {} }
  if (!seedAttempted || !users || !dataStore) return;
  let graphSafe = true;
  const invitations = { scope: 'owned_invite_records_and_indices', passed: false }; report.cleanup.push(invitations);
  try {
    // An acknowledged code is normally known already. If the process lost a
    // websocket acknowledgement after a successful commit, an exact owned
    // fixture index can reveal its code without scanning a shared registry.
    for (const fixture of fixtures) {
      const index = await readCurrent(dataStore, fixture.duelInvitePath);
      if (index === null) continue;
      ensure(ownsProfile(await readCurrent(users, fixture.profilePath), fixture), 'invite_cleanup_profile_unverified');
      ensure(index.schemaVersion === 1 && /^[A-HJ-NP-Z2-9]{8}$/.test(index.code) && Number.isSafeInteger(index.expiresAt), 'invite_cleanup_index_invalid');
      if (!knownInvites.has(index.code)) knownInvites.set(index.code, { code: index.code, path: codePath(index.code), ownerId: null, guestId: null, expiresAt: index.expiresAt, learnedFrom: 'exact_marker_owned_fixture_index' });
    }
    await recovery();
    await dataStore.transaction(async tx => {
      for (const fixture of fixtures) {
        const index = await tx.get(fixture.duelInvitePath);
        if (index !== null) {
          ensure(ownsProfile(await readCurrent(users, fixture.profilePath), fixture), 'invite_cleanup_profile_unverified');
          ensure(index.schemaVersion === 1 && knownInvites.has(index.code), 'invite_cleanup_index_unowned');
        }
      }
      for (const known of knownInvites.values()) {
        const value = await tx.get(known.path);
        if (value !== null) {
          ensure(ownsInvite(value, known.code), 'invite_cleanup_ownership_unverified');
          for (const user of [value.owner, value.guest].filter(Boolean)) {
            const fixture = fixtures.find(item => item.id === user.id);
            ensure(fixture && ownsProfile(await readCurrent(users, fixture.profilePath), fixture), 'invite_cleanup_peer_profile_unverified');
          }
          tx.delete(known.path);
        }
      }
      for (const fixture of fixtures) {
        const index = await tx.get(fixture.duelInvitePath);
        if (index !== null) tx.delete(fixture.duelInvitePath);
      }
    });
    for (const known of knownInvites.values()) ensure(await readCurrent(dataStore, known.path) === null, 'invite_cleanup_record_remaining');
    for (const fixture of fixtures) ensure(await readCurrent(dataStore, fixture.duelInvitePath) === null, 'invite_cleanup_index_remaining');
    invitations.passed = true;
  } catch (error) { invitations.error = safeError(error); graphSafe = false; }
  const graph = { scope: 'owned_friend_documents', passed: false }; report.cleanup.push(graph);
  try {
    await dataStore.transaction(async tx => {
      for (const fixture of fixtures) {
        const profile = await readCurrent(users, fixture.profilePath), value = await tx.get(fixture.friendsPath);
        if (value === null) continue;
        ensure(ownsProfile(profile, fixture) && ownsFriendDocument(value), 'friend_cleanup_ownership_unverified'); tx.delete(fixture.friendsPath);
      }
    });
    for (const fixture of fixtures) ensure(await readCurrent(dataStore, fixture.friendsPath) === null, 'friend_cleanup_readback_failed');
    graph.passed = true;
  } catch (error) { graph.error = safeError(error); graphSafe = false; }
  const accounts = { scope: 'owned_profile_session_username_indexes', passed: false }; report.cleanup.push(accounts);
  if (!graphSafe) { accounts.error = 'data_cleanup_requires_recovery'; return; }
  try {
    await users.transaction(async tx => {
      for (const fixture of fixtures) {
        const profile = await tx.get(fixture.profilePath), sessions = await tx.get(fixture.sessionsPath), index = await tx.get(fixture.usernameIndexPath);
        if (profile !== null) ensure(ownsProfile(profile, fixture), 'profile_cleanup_ownership_unverified');
        if (sessions !== null) ensure(ownsSessions(sessions, fixture), 'session_cleanup_ownership_unverified');
        if (index !== null) ensure(index.userId === fixture.id && same(index.smokeFixture, fixture.marker), 'index_cleanup_ownership_unverified');
        for (const key of ['profilePath', 'sessionsPath', 'usernameIndexPath']) tx.delete(fixture[key]);
      }
    });
    for (const fixture of fixtures) for (const key of ['profilePath', 'sessionsPath', 'usernameIndexPath']) ensure(await readCurrent(users, fixture[key]) === null, 'account_cleanup_readback_failed');
    for (const fixture of fixtures) await call(ORIGINS[0], '/friends', { fixture, expected: 401 });
    accounts.passed = true;
  } catch (error) { accounts.error = safeError(error); }
}
async function main() {
  try {
    ensure(process.argv.length === 3 && process.argv[2] === '--run', 'explicit_run_flag_required');
    env = await loadEnvironment(); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); outputReady = true; await recovery();
    users = createGitHubStore(env, { repository: 'users', fetchImpl: observedFetch });
    dataStore = createGitHubStore(env, { repository: 'data', fetchImpl: observedFetch });
    phase('check both production domains and the realtime endpoint'); await publicPreflight();
    phase('seed three isolated disposable accounts'); await seedFixtures();
    phase('verify mutual friends and account isolation'); await verifyFriends();
    phase('verify real websocket sharing, joining, rejoining and round timing'); await verifyRealtime();
    report.passed = !failedRound;
  } catch (error) { report.error = safeError(error); }
  finally {
    phase('clean only this run marker-owned current records');
    try { await cleanup(); } catch (error) { report.cleanup.push({ scope: 'cleanup_runtime', passed: false, error: safeError(error) }); }
    if (seedAttempted && (report.cleanup.length !== 3 || report.cleanup.some(value => !value.passed))) report.passed = false;
    report.finishedAt = new Date().toISOString();
    report.note = 'Synthetic production API/WebSocket verification only. No owner password, owner session, email delivery, or real profile writes. Exact known invitation records and per-fixture indices are verified in the existing private GitHub Data repository; no full invite registry is read. Current fixture records are removed only after marker, participant and graph ownership checks; Git history remains. Timed results are reported only when live latency gates and actual timer callbacks pass. This does not prove physical two-phone sound synchronization or WeChat domain configuration.';
    if (outputReady) {
      try { await recovery(); await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); console.log('[online PK smoke] ' + (report.passed ? 'PASS' : 'FAIL') + ' · ' + relativeDirectory + '/report.json'); }
      catch { report.passed = false; console.log('[online PK smoke] FAIL · artifact_write_failed'); }
    } else console.log('[online PK smoke] FAIL · ' + (report.error || 'configuration_unavailable'));
    await dispatcher?.close(); process.exitCode = report.passed ? 0 : 1;
  }
}
if (process.argv.length === 2 || process.argv[2] === '--help') {
  console.log('Usage: node scripts/online-duel-live-smoke.mjs --run');
  console.log('Explicitly verifies production friends and online PK on both pocket domains and pk.brclio-miniapp.bornforthis.cn. Creates three synthetic marker-owned accounts and exact username indexes, verifies their exact private GitHub invitation records/indices, then cleans only their current account/friend/invite files. Never reads credentials or emails users, and never scans an invitation registry. Ignored evidence: artifacts/online-duel/0.1.11/live-*/. A failed/unstable timed round is recorded as incomplete, never a pass.');
} else await main();
