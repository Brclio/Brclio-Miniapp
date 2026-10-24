#!/usr/bin/env node
// Explicit production verification. Seeds two owned, synthetic fixtures directly
// in the existing private repositories; never sends email or binds real WeChat.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitHubStore } from '../web/account-store.mjs';
import { accountInternals } from '../web/account-api.mjs';
import { readSyncDocument } from '../web/account-sync.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomBytes(6).toString('hex');
const startedAt = new Date().toISOString();
const relativeDirectory = 'artifacts/account-song-sync/live-' + startedAt.replace(/[:.]/g, '-') + '-' + runId;
const directory = path.join(root, relativeDirectory);
const reportPath = path.join(directory, 'report.json');
const manifestPath = path.join(directory, 'fixtures.json');
const allowedBases = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
const SONG_KEY = 'brclio.nursery-favorites.v1';
const SONG_A = '1451390672', SONG_B = '1451390674';
const fixtureKind = 'nursery-live-smoke-v1';
const fixtures = [];
const report = { schemaVersion: 1, runId, startedAt, passed: false, checks: [], routes: [], fixtures: [], cleanup: [] };
let env, users, data, base, outputReady = false;

function ensure(condition, code) { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); }
function safeError(error) { return /^[a-z_]{1,80}$/.test(error?.safeCode || '') ? error.safeCode : 'smoke_operation_failed'; }
function checked(name, condition) { ensure(condition, name); report.checks.push(name); }
function phase(name) { console.log('[nursery smoke] ' + name); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sameUser(value, fixture) { ensure(value?.user?.id === fixture.id, 'fixture_identity_changed'); }
function validSession(value, fixture) {
  sameUser(value, fixture);
  ensure(new RegExp('^m1\\.' + fixture.id + '\\.[a-f0-9]{64}$').test(value.token || ''), 'session_token_invalid');
  ensure(value.expiresAt === null, 'session_expiry_invalid');
  return value.token;
}
function noPrivateFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    ensure(!/password|credential|secret|session_key|openid|unionid/i.test(key), 'response_contains_private_fields');
    noPrivateFields(item);
  }
}
async function loadEnvironment() {
  // Refuse tracked/local-public inputs and outputs before reading credentials.
  for (const entry of ['.dev.vars', 'artifacts/account-song-sync/']) {
    try { await promisify(execFile)('git', ['check-ignore', '--quiet', '--', entry], { cwd: root }); }
    catch { ensure(false, 'private_paths_not_ignored'); }
  }
  const result = Object.create(null);
  const source = await fs.readFile(path.join(root, '.dev.vars'), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    ensure(match, 'configuration_format_invalid');
    try { result[match[1]] = JSON.parse(match[2]); }
    catch { ensure(false, 'configuration_format_invalid'); }
  }
  ensure(result.ACCOUNT_ENABLED === 'true' && result.ACCOUNT_HMAC_SECRET?.length >= 32, 'account_configuration_missing');
  return result;
}
function assertFixture(fixture) {
  ensure(/^[a-f0-9]{32}$/.test(fixture.id) && ['a', 'b'].includes(fixture.label), 'fixture_scope_invalid');
  ensure(fixture.username === 'qans_' + runId + fixture.label, 'fixture_scope_invalid');
  ensure(fixture.email === 'nursery-' + runId + '-' + fixture.label + '@brclio-smoke.invalid', 'fixture_scope_invalid');
  ensure(fixture.marker?.kind === fixtureKind && fixture.marker.runId === runId && fixture.marker.label === fixture.label && /^[a-f0-9]{32}$/.test(fixture.marker.nonce || ''), 'fixture_scope_invalid');
}
async function pathsFor(fixture) {
  assertFixture(fixture);
  return {
    profile: accountInternals.userPath(fixture.id, 'profile'),
    credentials: accountInternals.userPath(fixture.id, 'credentials'),
    sessions: accountInternals.userPath(fixture.id, 'sessions'),
    email: await accountInternals.indexPath(env.ACCOUNT_HMAC_SECRET, 'email', fixture.email),
    username: await accountInternals.indexPath(env.ACCOUNT_HMAC_SECRET, 'username', fixture.username),
    sync: accountInternals.userPath(fixture.id, 'sync')
  };
}
async function writeManifest() {
  const value = {
    schemaVersion: 1, kind: fixtureKind, runId, startedAt, base,
    note: 'Recovery inventory contains no passwords, tokens or secrets. Only delete exact listed paths after verifying the profile marker, synthetic identity and matching index owners. Do not delete abuse counters or Git history.',
    fixtures: fixtures.map(fixture => ({
      label: fixture.label, userId: fixture.id, username: fixture.username, email: fixture.email,
      createdAt: fixture.createdAt, ownershipMarker: fixture.marker,
      accountPaths: fixture.paths ? ['profile', 'credentials', 'sessions', 'email', 'username'].map(key => fixture.paths[key]) : [],
      dataPaths: fixture.paths ? [fixture.paths.sync] : [],
      seedAttempted: !!fixture.seedAttempted, seeded: !!fixture.seeded,
      cleanup: fixture.cleanup || null
    }))
  };
  await fs.writeFile(manifestPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
function ownsProfile(profile, fixture) {
  return profile?.id === fixture.id && profile.username === fixture.username && profile.email === fixture.email &&
    profile.createdAt === fixture.createdAt && profile.status === 'active' && equal(profile.providers, ['email']) && equal(profile.smokeFixture, fixture.marker);
}
function ownsCredentials(credentials, fixture) {
  return credentials?.schemaVersion === 1 && credentials.passwordPlaintext === fixture.password && equal(credentials.password, fixture.passwordRecord);
}
async function seedFixtures() {
  for (const fixture of fixtures) {
    fixture.paths = await pathsFor(fixture);
    fixture.passwordRecord = await accountInternals.passwordHash(fixture.password, env.ACCOUNT_HMAC_SECRET);
    // A colliding business file must not be claimed even if user paths are free.
    ensure(await data.read(fixture.paths.sync) === null, 'fixture_data_path_occupied');
  }
  await writeManifest();
  for (const fixture of fixtures) fixture.seedAttempted = true;
  await writeManifest(); // Persist the exact recovery inventory before mutation.
  await users.transaction(async tx => {
    // Validate every destination before writing either account. Store commits
    // all profile/credential/session/index records in one atomic Git update.
    for (const fixture of fixtures) for (const key of ['profile', 'credentials', 'sessions', 'email', 'username']) {
      ensure(await tx.get(fixture.paths[key]) === null, 'fixture_account_path_occupied');
    }
    for (const fixture of fixtures) {
      const at = fixture.createdAt;
      tx.put(fixture.paths.profile, { schemaVersion: 1, id: fixture.id, username: fixture.username, email: fixture.email,
        displayName: 'Nursery smoke ' + fixture.label, providers: ['email'], status: 'active', createdAt: at, updatedAt: at, smokeFixture: fixture.marker });
      tx.put(fixture.paths.credentials, { schemaVersion: 1, password: fixture.passwordRecord, passwordPlaintext: fixture.password, updatedAt: at });
      tx.put(fixture.paths.sessions, { schemaVersion: 1, items: [{ hash: hash(fixture.seedToken), createdAt: at, expiresAt: null }] });
      tx.put(fixture.paths.email, { userId: fixture.id });
      tx.put(fixture.paths.username, { userId: fixture.id });
    }
  });
  for (const fixture of fixtures) fixture.seeded = true;
  await writeManifest();
}
async function call(route, method, body, token, expected, options = {}) {
  const started = performance.now();
  const entry = { route, method, expected, status: null, durationMs: null, ...(route === '/sync' ? { syncVersion: options.legacy ? 1 : 2 } : {}) };
  report.routes.push(entry);
  try {
    const response = await fetch(base + '/api/account' + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(route === '/sync' && !options.legacy ? { 'X-Brclio-Sync-Version': '2' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    entry.status = response.status;
    let value;
    try { value = await response.json(); } catch { ensure(false, 'api_response_invalid'); }
    noPrivateFields(value);
    const encoded = JSON.stringify(value);
    for (const fixture of fixtures) ensure(!encoded.includes(fixture.password), 'response_contains_password');
    ensure(response.headers.get('Cache-Control')?.includes('no-store'), 'api_cache_policy_invalid');
    ensure(response.status === expected, 'api_status_unexpected');
    return value;
  } finally { entry.durationMs = Math.round(performance.now() - started); }
}
function favoriteEntry(favorites, updatedAt) { return { value: { favorites }, updatedAt }; }
function favoriteIds(document) { return document?.entries?.[SONG_KEY]?.value?.favorites; }
async function verifyStored(fixture, expectedSync) {
  const p = fixture.paths;
  const [profile, credentials, sessions, email, username, business] = await Promise.all([
    users.read(p.profile), users.read(p.credentials), users.read(p.sessions), users.read(p.email), users.read(p.username), data.read(p.sync)
  ]);
  checked('fixture_profile_owned_' + fixture.label, ownsProfile(profile, fixture));
  checked('fixture_credentials_unchanged_' + fixture.label, ownsCredentials(credentials, fixture));
  checked('fixture_indexes_owned_' + fixture.label, email?.userId === fixture.id && username?.userId === fixture.id);
  checked('fixture_sessions_hashed_' + fixture.label, Array.isArray(sessions?.items) && sessions.items.length >= 2 && sessions.items.every(item => /^[a-f0-9]{64}$/.test(item.hash || '') && item.expiresAt === null && !item.token));
  checked('business_sync_matches_api_' + fixture.label, equal(readSyncDocument(business), expectedSync));
  noPrivateFields(business);
  for (const account of fixtures) checked('business_no_identity_' + fixture.label + '_' + account.label,
    ![account.password, account.seedToken, account.token, account.email, account.username].some(value => JSON.stringify(business).includes(value)));
  checked('account_repo_no_business_sync_' + fixture.label, await users.read(p.sync) === null);
}
async function cleanupFixture(fixture) {
  const entry = { label: fixture.label, userId: fixture.id, passed: false, removedAccountPaths: [], removedDataPaths: [] };
  report.cleanup.push(entry);
  try {
    assertFixture(fixture);
    const p = fixture.paths;
    ensure(p, 'cleanup_inventory_missing');
    const values = await Promise.all(['profile', 'credentials', 'sessions', 'email', 'username'].map(key => users.read(p[key])));
    if (values.every(value => value === null)) {
      ensure(await data.read(p.sync) === null, 'cleanup_ownership_unverified');
      entry.passed = true;
      entry.note = 'No fixture documents committed or documents already absent.';
      return;
    }
    const [profile, credentials, , email, username] = values;
    ensure(ownsProfile(profile, fixture) && ownsCredentials(credentials, fixture), 'cleanup_ownership_unverified');
    ensure(email?.userId === fixture.id && username?.userId === fixture.id, 'cleanup_ownership_unverified');
    await data.transaction(async tx => {
      const current = await tx.get(p.sync);
      if (current !== null) {
        const document = readSyncDocument(current);
        ensure(Object.keys(document.entries).every(key => [SONG_KEY, 'RGD_SOUND_ENABLED'].includes(key)), 'cleanup_data_scope_unverified');
        tx.delete(p.sync);
      }
    });
    entry.removedDataPaths.push(p.sync);
    await users.transaction(async tx => {
      const currentProfile = await tx.get(p.profile), currentCredentials = await tx.get(p.credentials);
      ensure(ownsProfile(currentProfile, fixture) && ownsCredentials(currentCredentials, fixture), 'cleanup_ownership_unverified');
      for (const key of ['email', 'username']) ensure((await tx.get(p[key]))?.userId === fixture.id, 'cleanup_ownership_unverified');
      for (const key of ['profile', 'credentials', 'sessions', 'email', 'username']) tx.delete(p[key]);
    });
    entry.removedAccountPaths = ['profile', 'credentials', 'sessions', 'email', 'username'].map(key => p[key]);
    const remaining = await Promise.all([...entry.removedAccountPaths.map(value => users.read(value)), data.read(p.sync)]);
    ensure(remaining.every(value => value === null), 'cleanup_records_remaining');
    entry.passed = true;
  } catch (error) { entry.error = safeError(error); }
  finally {
    fixture.cleanup = entry;
    // Local disk failures must not prevent cleanup of the second owned fixture.
    try { await writeManifest(); }
    catch { report.passed = false; report.error = report.error || 'artifact_write_failed'; }
  }
}

async function main() {
  try {
    ensure(process.argv.length <= 3, 'base_url_invalid');
    base = process.argv[2] || 'https://pocket.bornforthis.cn';
    ensure(allowedBases.has(base), 'base_url_invalid');
    report.base = base;
    env = await loadEnvironment();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    outputReady = true;
    users = createGitHubStore(env, { repository: 'users' });
    data = createGitHubStore(env, { repository: 'data' });
    for (const label of ['a', 'b']) {
      const id = randomBytes(16).toString('hex');
      fixtures.push({ label, id, username: 'qans_' + runId + label,
        email: 'nursery-' + runId + '-' + label + '@brclio-smoke.invalid',
        password: 'NurserySmoke!' + randomBytes(24).toString('hex'), createdAt: Date.now(),
        seedToken: 'm1.' + id + '.' + randomBytes(32).toString('hex'),
        marker: { kind: fixtureKind, runId, label, nonce: randomBytes(16).toString('hex') } });
    }
    phase('seed two isolated synthetic fixtures without email');
    await seedFixtures();
    report.fixtures = fixtures.map(({ label, id }) => ({ label, userId: id }));
    const [a, b] = fixtures;
    checked('synthetic_users_distinct', a.id !== b.id);

    phase('verify production password login and permanent sessions');
    for (const fixture of fixtures) {
      const result = await call('/login/password', 'POST', { identifier: fixture.username, password: fixture.password }, null, 200);
      fixture.token = validSession(result, fixture);
      sameUser(await call('/session', 'GET', undefined, fixture.seedToken, 200), fixture);
    }
    validSession(await call('/login/password', 'POST', { identifier: a.email, password: a.password }, null, 200), a);

    phase('verify favorite storage, reads, account isolation and revision conflicts');
    for (const fixture of fixtures) {
      const empty = await call('/sync', 'GET', undefined, fixture.token, 200);
      checked('fixture_sync_empty_' + fixture.label, empty.revision === 0 && equal(empty.entries, {}));
    }
    const at = Date.now();
    let aSync = await call('/sync', 'PUT', { revision: 0, entries: { [SONG_KEY]: favoriteEntry([SONG_A, SONG_B], at) } }, a.token, 200);
    checked('favorites_added', aSync.revision === 1 && equal(favoriteIds(aSync), [SONG_A, SONG_B]));
    checked('favorites_read_back', equal(await call('/sync', 'GET', undefined, a.token, 200), aSync));
    const untouched = await call('/sync', 'GET', undefined, b.token, 200);
    checked('second_account_did_not_inherit_favorites', untouched.revision === 0 && equal(untouched.entries, {}));
    const bSync = await call('/sync', 'PUT', { revision: 0, entries: { [SONG_KEY]: favoriteEntry([SONG_B], at) } }, b.token, 200);
    checked('second_account_own_favorites', bSync.revision === 1 && equal(favoriteIds(bSync), [SONG_B]));
    const stale = await call('/sync', 'PUT', { revision: 0, entries: { [SONG_KEY]: favoriteEntry([], at + 1) } }, a.token, 409);
    checked('revision_conflict_reported', stale.error === 'sync_conflict');
    checked('conflict_preserves_favorites', equal(await call('/sync', 'GET', undefined, a.token, 200), aSync));

    phase('verify older clients can sync without erasing song favorites');
    const legacy = await call('/sync', 'GET', undefined, a.token, 200, { legacy: true });
    checked('legacy_response_hides_song_key', legacy.revision === aSync.revision && !Object.hasOwn(legacy.entries || {}, SONG_KEY));
    const legacyWritten = await call('/sync', 'PUT', { revision: legacy.revision, entries: { RGD_SOUND_ENABLED: { value: false, updatedAt: at + 2 } } }, a.token, 200, { legacy: true });
    checked('legacy_write_hides_song_key', legacyWritten.revision === 2 && !Object.hasOwn(legacyWritten.entries || {}, SONG_KEY));
    aSync = await call('/sync', 'GET', undefined, a.token, 200);
    checked('legacy_write_preserves_song_favorites', aSync.revision === 2 && equal(favoriteIds(aSync), [SONG_A, SONG_B]) && aSync.entries?.RGD_SOUND_ENABLED?.value === false);
    aSync = await call('/sync', 'PUT', { revision: aSync.revision, entries: { [SONG_KEY]: favoriteEntry([SONG_B], at + 3) } }, a.token, 200);
    checked('favorite_removed', aSync.revision === 3 && equal(favoriteIds(aSync), [SONG_B]));
    aSync = await call('/sync', 'PUT', { revision: aSync.revision, entries: { [SONG_KEY]: favoriteEntry([], at + 4) } }, a.token, 200);
    checked('all_favorites_removed', aSync.revision === 4 && equal(favoriteIds(aSync), []));
    checked('cancellations_read_back', equal(await call('/sync', 'GET', undefined, a.token, 200), aSync));
    checked('second_account_favorites_unchanged', equal(await call('/sync', 'GET', undefined, b.token, 200), bSync));

    phase('verify WeChat binding refusal without any real WeChat identity');
    const denied = await call('/bind/wechat', 'POST', { code: 'nursery-smoke-' + runId }, null, 401);
    checked('wechat_binding_requires_session', denied.error === 'unauthorized');
    const malformed = await call('/bind/wechat', 'POST', { code: 'invalid code' }, a.token, 400);
    checked('wechat_binding_validates_code', malformed.error === 'invalid_wechat_code');
    const invalid = await call('/bind/wechat', 'POST', { code: 'nursery-smoke-invalid-' + runId }, a.token, 401);
    checked('synthetic_wechat_code_rejected', invalid.error === 'wechat_login_failed');
    for (const fixture of fixtures) {
      const session = await call('/session', 'GET', undefined, fixture.token, 200);
      sameUser(session, fixture);
      checked('failed_binding_preserves_session_' + fixture.label, session.expiresAt === null && equal(session.user.providers, ['email']));
    }

    phase('verify exact synthetic repository records');
    await verifyStored(a, aSync);
    await verifyStored(b, bSync);
    report.passed = true;
  } catch (error) { report.error = safeError(error); }
  finally {
    if (users && data && fixtures.some(fixture => fixture.seedAttempted)) {
      phase('remove only ownership-verified fixture documents');
      for (const fixture of fixtures.filter(item => item.seedAttempted)) await cleanupFixture(fixture);
      if (report.cleanup.length !== fixtures.length || report.cleanup.some(entry => !entry.passed)) report.passed = false;
    }
    report.finishedAt = new Date().toISOString();
    report.note = 'Only listed, ownership-verified synthetic current documents are removed. Git history and abuse counters remain. No email was sent or read; no real WeChat identity was bound. Successful wx.login binding still needs miniapp verification.';
    if (outputReady) {
      try {
        await writeManifest();
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        console.log('[nursery smoke] ' + (report.passed ? 'PASS' : 'FAIL') + ' · ' + relativeDirectory + '/report.json');
      } catch {
        report.passed = false;
        console.log('[nursery smoke] FAIL · artifact_write_failed');
      }
    } else console.log('[nursery smoke] FAIL · ' + (report.error || 'configuration_unavailable'));
    process.exitCode = report.passed ? 0 : 1;
  }
}
await main();
