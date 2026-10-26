#!/usr/bin/env node
// Explicit production avatar verification. Creates exactly two marked synthetic
// accounts in the existing private repositories; never sends mail or uses a
// real WeChat identity. Current fixture files are removed; Git history remains.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitHubStore } from '../web/account-store.mjs';
import { accountInternals } from '../web/account-api.mjs';
import { BUILTIN_AVATAR_VERSION } from '../web/account-avatar.mjs';
import { readSyncDocument } from '../web/account-sync.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomBytes(6).toString('hex'), startedAt = new Date().toISOString();
const relativeDirectory = 'artifacts/account-avatars/live-' + startedAt.replace(/[:.]/g, '-') + '-' + runId;
const directory = path.join(root, relativeDirectory), reportPath = path.join(directory, 'report.json'), manifestPath = path.join(directory, 'fixtures.json');
const allowedBases = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
const repositories = Object.freeze({ users: 'Brclio-Miniapp-UserData', data: 'Brclio-Miniapp-Data' });
const extensions = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' });
const fixtureKind = 'avatar-live-smoke-v1', SONG_KEY = 'brclio.nursery-favorites.v1', SONG_A = '1451390672', SONG_B = '1451390674';
const fixtures = [], report = { schemaVersion: 1, runId, startedAt, passed: false, checks: [], routes: [], fixtures: [], cleanup: [] };
let env, users, data, base, outputReady = false, imageFixtures;

function ensure(condition, code) { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); }
function safeError(error) { return /^[a-z][a-z0-9_]{0,79}$/.test(error?.safeCode || '') ? error.safeCode : 'smoke_operation_failed'; }
function checked(name, condition) { ensure(condition, name); report.checks.push(name); }
function phase(name) { console.log('[avatar smoke] ' + name); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sha(value) { ensure(/^[a-f0-9]{40,64}$/.test(value || ''), 'github_sha_invalid'); return value; }
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
    ensure(!/password|credential|secret|session_key|openid|unionid|original|sha256|base64/i.test(key), 'response_contains_private_fields');
    noPrivateFields(item);
  }
}
function assertFixture(fixture) {
  ensure(/^[a-f0-9]{32}$/.test(fixture.id) && ['a', 'b'].includes(fixture.label), 'fixture_scope_invalid');
  ensure(fixture.username === 'qaav_' + runId + fixture.label && fixture.email === 'avatar-' + runId + '-' + fixture.label + '@brclio-smoke.invalid', 'fixture_scope_invalid');
  ensure(fixture.marker?.kind === fixtureKind && fixture.marker.runId === runId && fixture.marker.label === fixture.label && /^[a-f0-9]{32}$/.test(fixture.marker.nonce || ''), 'fixture_scope_invalid');
}
async function loadEnvironment() {
  for (const entry of ['.dev.vars', 'artifacts/account-avatars/']) {
    try { await promisify(execFile)('git', ['check-ignore', '--quiet', '--', entry], { cwd: root }); }
    catch { ensure(false, 'private_paths_not_ignored'); }
  }
  const stat = await fs.stat(path.join(root, '.dev.vars'));
  ensure((stat.mode & 0o077) === 0, 'configuration_permissions_unsafe');
  const result = Object.create(null), source = await fs.readFile(path.join(root, '.dev.vars'), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    ensure(match, 'configuration_format_invalid');
    try { result[match[1]] = JSON.parse(match[2]); } catch { ensure(false, 'configuration_format_invalid'); }
  }
  ensure(result.ACCOUNT_ENABLED === 'true' && result.ACCOUNT_HMAC_SECRET?.length >= 32, 'account_configuration_missing');
  // Cleanup is deliberately restricted to the existing production branches.
  ensure((result.GITHUB_USERDATA_BRANCH || 'main') === 'main' && (result.GITHUB_DATA_BRANCH || 'main') === 'main', 'repository_branch_unexpected');
  return result;
}
async function pathsFor(fixture) {
  assertFixture(fixture);
  return {
    profile: accountInternals.userPath(fixture.id, 'profile'), credentials: accountInternals.userPath(fixture.id, 'credentials'), sessions: accountInternals.userPath(fixture.id, 'sessions'),
    email: await accountInternals.indexPath(env.ACCOUNT_HMAC_SECRET, 'email', fixture.email), username: await accountInternals.indexPath(env.ACCOUNT_HMAC_SECRET, 'username', fixture.username), sync: accountInternals.userPath(fixture.id, 'sync')
  };
}
function ownsProfile(profile, fixture) {
  return profile?.id === fixture.id && profile.username === fixture.username && profile.email === fixture.email && profile.createdAt === fixture.createdAt && profile.status === 'active' && equal(profile.providers, ['email']) && equal(profile.smokeFixture, fixture.marker);
}
function ownsCredentials(credentials, fixture) { return credentials?.schemaVersion === 1 && credentials.passwordPlaintext === fixture.password && equal(credentials.password, fixture.passwordRecord); }
async function writeManifest() {
  await fs.writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1, kind: fixtureKind, runId, startedAt, base,
    note: 'No passwords, bearer tokens or secrets. Delete only listed current fixture files after validating ownership marker, synthetic identity, createdAt, credentials and index owners. Recover a current unrecorded custom version from the marked profile only if its hash matches a listed planned upload. Git history, dangling Git objects, CDN caches and abuse counters are not erased.',
    fixtures: fixtures.map(f => ({ label: f.label, userId: f.id, username: f.username, email: f.email, createdAt: f.createdAt, ownershipMarker: f.marker,
      accountPaths: f.paths ? ['profile', 'credentials', 'sessions', 'email', 'username'].map(key => f.paths[key]) : [], dataPaths: f.paths ? [f.paths.sync] : [],
      seedAttempted: !!f.seedAttempted, seeded: !!f.seeded, uploadAttempts: f.uploadAttempts, versions: f.versions, cleanup: f.cleanup || null }))
  }, null, 2) + '\n', { mode: 0o600 });
}
async function seedFixtures() {
  for (const fixture of fixtures) {
    fixture.paths = await pathsFor(fixture);
    fixture.passwordRecord = await accountInternals.passwordHash(fixture.password, env.ACCOUNT_HMAC_SECRET);
    ensure(await data.read(fixture.paths.sync) === null, 'fixture_data_path_occupied');
  }
  await writeManifest();
  for (const fixture of fixtures) fixture.seedAttempted = true;
  await writeManifest();
  await users.transaction(async tx => {
    for (const fixture of fixtures) for (const key of ['profile', 'credentials', 'sessions', 'email', 'username']) ensure(await tx.get(fixture.paths[key]) === null, 'fixture_account_path_occupied');
    for (const f of fixtures) {
      const at = f.createdAt;
      tx.put(f.paths.profile, { schemaVersion: 1, id: f.id, username: f.username, email: f.email, displayName: 'Avatar smoke ' + f.label, providers: ['email'], status: 'active', createdAt: at, updatedAt: at, smokeFixture: f.marker });
      tx.put(f.paths.credentials, { schemaVersion: 1, password: f.passwordRecord, passwordPlaintext: f.password, updatedAt: at });
      tx.put(f.paths.sessions, { schemaVersion: 1, items: [{ hash: hash(f.seedToken), createdAt: at, expiresAt: null }] });
      tx.put(f.paths.email, { userId: f.id }); tx.put(f.paths.username, { userId: f.id });
    }
  });
  for (const f of fixtures) f.seeded = true;
  await writeManifest();
}
// gh's current authenticated owner has read/write access to these private repos.
// Credentials and private file bodies never enter arguments, reports or logs.
async function gh(repo, endpoint, { method = 'GET', body, missing = false } = {}) {
  ensure(Object.hasOwn(repositories, repo) && (endpoint === '' || endpoint.startsWith('/')), 'github_scope_invalid');
  const args = ['api', '--method', method, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2026-03-10', '/repos/BrclioData/' + repositories[repo] + endpoint];
  if (body !== undefined) args.push('--input', '-');
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GH_PAGER: 'cat', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }, (error, stdout, stderr) => {
      if (error) {
        const status = Number(/HTTP (\d{3})/.exec(stderr || '')?.[1]);
        if (missing && status === 404) return resolve(null);
        return reject(Object.assign(new Error('github_operation_failed'), { safeCode: 'github_operation_failed', httpStatus: status || null }));
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(Object.assign(new Error('github_response_invalid'), { safeCode: 'github_response_invalid' })); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function headFor(repo) { const ref = await gh(repo, '/git/ref/heads/main'); ensure(ref?.object?.type === 'commit', 'github_ref_invalid'); return sha(ref.object.sha); }
async function privateFile(repo, filePath, head, maxBytes = 1024 * 1024) {
  const entry = await gh(repo, '/contents/' + filePath.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha(head), { missing: true });
  if (entry === null) return null;
  ensure(entry.type === 'file' && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= maxBytes, 'github_file_invalid');
  sha(entry.sha);
  let data = entry;
  if (entry.encoding !== 'base64' || !entry.content || entry.size > 1024 * 1024) data = await gh(repo, '/git/blobs/' + entry.sha);
  ensure(data?.encoding === 'base64' && typeof data.content === 'string' && data.content.length <= Math.ceil(maxBytes / 3) * 4 + Math.ceil(maxBytes / 40) + 1024, 'github_file_invalid');
  const bytes = Buffer.from(data.content.replace(/\s/g, ''), 'base64');
  ensure(bytes.length === entry.size, 'github_file_invalid');
  return { bytes, size: entry.size, sha: entry.sha };
}
async function privateJson(repo, filePath, head) {
  const file = await privateFile(repo, filePath, head);
  if (!file) return null;
  try { return JSON.parse(file.bytes.toString('utf8')); } catch { ensure(false, 'github_json_invalid'); }
}
async function call(route, method, body, token, expected, options = {}) {
  const started = performance.now(), origin = options.base || base;
  ensure(allowedBases.has(origin), 'base_url_invalid');
  const entry = { route, method, expected, origin, status: null, durationMs: null, ...(route === '/sync' ? { syncVersion: options.legacy ? 1 : 2 } : {}) };
  report.routes.push(entry);
  try {
    const response = await fetch(origin + '/api/account' + route, { method, redirect: 'error', signal: AbortSignal.timeout(90000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(route === '/sync' && !options.legacy ? { 'X-Brclio-Sync-Version': '2' } : {}), ...(options.origin ? { Origin: options.origin } : {}) },
      ...(body === undefined ? {} : { body: options.raw ? body : JSON.stringify(body) }) });
    entry.status = response.status;
    let value; try { value = await response.json(); } catch { ensure(false, 'api_response_invalid'); }
    noPrivateFields(value);
    const encoded = JSON.stringify(value);
    for (const f of fixtures) ensure(!encoded.includes(f.password), 'response_contains_password');
    ensure(response.headers.get('Cache-Control')?.includes('no-store'), 'api_cache_policy_invalid');
    if (options.origin) ensure(response.headers.get('Access-Control-Allow-Origin') === options.origin, 'cors_origin_invalid');
    ensure(response.status === expected, 'api_status_unexpected');
    return value;
  } finally { entry.durationMs = Math.round(performance.now() - started); }
}
async function publicImage(url, mimeType, expectedBytes) {
  const parsed = new URL(url), builtin = /^\/avatars\/([0-9]{4})\.png$/.exec(parsed.pathname);
  const validBuiltin = builtin && Number(builtin[1]) >= 1 && Number(builtin[1]) <= 1000;
  ensure(allowedBases.has(parsed.origin) && !parsed.hash && (validBuiltin ? parsed.search === '?v=' + BUILTIN_AVATAR_VERSION : !parsed.search), 'avatar_url_unexpected');
  const started = performance.now(), entry = { route: parsed.pathname, method: 'GET', expected: 200, origin: parsed.origin, status: null, durationMs: null }; report.routes.push(entry);
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) }); entry.status = response.status;
    ensure(response.status === 200 && response.headers.get('Content-Type')?.startsWith(mimeType), 'avatar_image_invalid');
    const bytes = Buffer.from(await response.arrayBuffer());
    ensure(bytes.length > 0 && bytes.length <= (validBuiltin ? 1024 * 1024 : 128 * 1024) && (!expectedBytes || bytes.equals(expectedBytes)), 'avatar_image_invalid');
    ensure(response.headers.get('X-Content-Type-Options') === 'nosniff', 'avatar_image_headers_invalid');
    return bytes;
  } finally { entry.durationMs = Math.round(performance.now() - started); }
}
function builtinUser(value, fixture, expectedId) {
  sameUser(value, fixture); const id = value.user.avatarId;
  ensure(value.user.avatarType === 'builtin' && Number.isInteger(id) && id >= 1 && id <= 1000 && (expectedId === undefined || id === expectedId), 'builtin_avatar_invalid');
  ensure(value.user.avatarUrl === base + '/avatars/' + String(id).padStart(4, '0') + '.png?v=' + BUILTIN_AVATAR_VERSION, 'builtin_avatar_url_invalid');
  return id;
}
function versionPaths(fixture, version) {
  assertFixture(fixture); ensure(/^[a-f0-9]{32}$/.test(version.assetId || '') && Object.hasOwn(extensions, version.mimeType), 'avatar_version_scope_invalid');
  const directory = 'users/v1/' + fixture.id.slice(0, 2) + '/' + fixture.id + '/avatars/' + version.assetId + '/';
  return { original: directory + 'original.' + extensions[version.mimeType], compressed: directory + 'display.jpg' };
}
function recoverVersion(fixture, profile) {
  if (profile?.avatar?.type !== 'custom') return;
  const assetId = profile.avatar.assetId;
  ensure(/^[a-f0-9]{32}$/.test(assetId || ''), 'cleanup_avatar_version_invalid');
  if (fixture.versions.some(v => v.assetId === assetId)) return;
  const attempt = fixture.uploadAttempts.find(v => v.sha256 === profile.avatar.original?.sha256 && v.bytes === profile.avatar.original?.bytes && v.mimeType === profile.avatar.original?.mimeType);
  ensure(attempt, 'cleanup_avatar_ownership_unverified');
  fixture.versions.push({ assetId, mimeType: attempt.mimeType, bytes: attempt.bytes, sha256: attempt.sha256, displaySha256: attempt.displaySha256, recovered: true });
}
async function verifyVersion(fixture, version) {
  const paths = versionPaths(fixture, version), head = await headFor('users');
  const original = await privateFile('users', paths.original, head, 10 * 1024 * 1024);
  checked('github_original_exact_' + fixture.label + '_' + fixture.versions.indexOf(version), original && original.size === version.bytes && hash(original.bytes) === version.sha256);
  const compressed = await privateFile('users', paths.compressed, head, 128 * 1024);
  checked('github_compressed_exact_' + fixture.label + '_' + fixture.versions.indexOf(version), compressed && hash(compressed.bytes) === version.displaySha256);
}
async function uploadAndRecord(fixture, original) {
  const compressed = Buffer.from(imageFixtures['image/jpeg'], 'base64');
  const attempt = { mimeType: 'image/png', bytes: original.length, sha256: hash(original), displaySha256: hash(compressed), attemptedAt: new Date().toISOString() };
  fixture.uploadAttempts.push(attempt); await writeManifest(); // Recovery intent precedes the request.
  const response = await call('/avatar', 'PUT', { original: { mimeType: attempt.mimeType, data: original.toString('base64') }, compressed: { mimeType: 'image/jpeg', data: compressed.toString('base64') } }, fixture.token, 200);
  sameUser(response, fixture);
  ensure(response.user.avatarType === 'custom' && response.user.avatarId === null, 'custom_avatar_invalid');
  const prefix = base + '/api/account/avatar/' + fixture.id + '/', assetId = response.user.avatarUrl?.slice(prefix.length);
  ensure(response.user.avatarUrl?.startsWith(prefix) && /^[a-f0-9]{32}$/.test(assetId || ''), 'custom_avatar_url_invalid');
  const version = { assetId, mimeType: attempt.mimeType, bytes: attempt.bytes, sha256: attempt.sha256, displaySha256: attempt.displaySha256 };
  fixture.versions.push(version); await writeManifest(); // Record before any later avatar can supersede it.
  const profile = await users.read(fixture.paths.profile);
  checked('profile_original_hash_matches_' + fixture.versions.length, ownsProfile(profile, fixture) && profile.avatar.assetId === assetId && profile.avatar.original?.sha256 === attempt.sha256 && profile.avatar.original?.bytes === original.length);
  await verifyVersion(fixture, version);
  await publicImage(response.user.avatarUrl, 'image/jpeg', compressed);
  checked('custom_display_stored_and_public_' + fixture.versions.length, true);
  return response.user.avatarUrl;
}
function maximumPng() {
  const png = Buffer.from(imageFixtures['image/png'], 'base64'), result = Buffer.alloc(10 * 1024 * 1024, 65), offset = png.length - 12;
  result.set(png.subarray(0, offset)); const textLength = result.length - png.length - 12;
  result.writeUInt32BE(textLength, offset); result.write('tEXt', offset + 4); result.write('Comment', offset + 8); result[offset + 15] = 0;
  const table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff; for (let i = offset + 4; i < offset + 8 + textLength; i++) crc = table[(crc ^ result[i]) & 255] ^ (crc >>> 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + textLength); result.set(png.subarray(png.length - 12), result.length - 12);
  return result;
}
async function verifyFixture(fixture, expectedSync) {
  const p = fixture.paths, [profile, credentials, sessions, email, username, business] = await Promise.all([users.read(p.profile), users.read(p.credentials), users.read(p.sessions), users.read(p.email), users.read(p.username), data.read(p.sync)]);
  checked('fixture_profile_owned_' + fixture.label, ownsProfile(profile, fixture));
  checked('fixture_credentials_unchanged_' + fixture.label, ownsCredentials(credentials, fixture));
  checked('fixture_indexes_owned_' + fixture.label, email?.userId === fixture.id && username?.userId === fixture.id);
  checked('fixture_sessions_hashed_' + fixture.label, Array.isArray(sessions?.items) && sessions.items.every(item => /^[a-f0-9]{64}$/.test(item.hash || '') && item.expiresAt === null && !item.token));
  checked('song_sync_preserved_' + fixture.label, equal(readSyncDocument(business), expectedSync));
  checked('account_repo_no_business_sync_' + fixture.label, await users.read(p.sync) === null);
  for (const f of fixtures) checked('business_has_no_identity_' + fixture.label + '_' + f.label, ![f.password, f.seedToken, f.token, f.email, f.username].some(v => JSON.stringify(business).includes(v)));
}
async function deleteOwnedFiles(repo, selectPaths) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const repository = await gh(repo, '');
    ensure(repository?.private === true && repository.full_name === 'BrclioData/' + repositories[repo], 'cleanup_repository_unverified');
    const head = await headFor(repo), paths = await selectPaths(head);
    if (!paths.length) return [];
    const baseCommit = await gh(repo, '/git/commits/' + head), baseTree = sha(baseCommit?.tree?.sha);
    const tree = await gh(repo, '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: paths.map(p => ({ path: p, mode: '100644', type: 'blob', sha: null })) } });
    const commit = await gh(repo, '/git/commits', { method: 'POST', body: { message: 'Remove owned Brclio avatar smoke fixtures ' + runId, tree: sha(tree?.sha), parents: [head] } });
    try { await gh(repo, '/git/refs/heads/main', { method: 'PATCH', body: { sha: sha(commit?.sha), force: false } }); return paths; }
    catch (error) { if (![409, 422].includes(error.httpStatus)) throw error; }
  }
  ensure(false, 'cleanup_conflict');
}
async function cleanupFixtures() {
  const entry = { passed: false, removedAccountPaths: [], removedDataPaths: [] }; report.cleanup.push(entry);
  try {
    // Validate all seeded account ownership first. No business deletion occurs
    // unless every present fixture has its exact marker and index ownership.
    async function ownedUsers(head, includeFiles) {
      const targets = [];
      for (const f of fixtures.filter(f => f.seedAttempted)) {
        assertFixture(f); const p = f.paths;
        const values = await Promise.all(['profile', 'credentials', 'sessions', 'email', 'username'].map(k => privateJson('users', p[k], head)));
        if (values.every(v => v === null)) { ensure(!f.seeded && f.versions.length === 0, 'cleanup_ownership_unverified'); continue; }
        const [profile, credentials, sessions, email, username] = values;
        ensure(ownsProfile(profile, f) && ownsCredentials(credentials, f) && email?.userId === f.id && username?.userId === f.id, 'cleanup_ownership_unverified');
        ensure(sessions?.schemaVersion === 1 && Array.isArray(sessions.items) && sessions.items.every(v => /^[a-f0-9]{64}$/.test(v.hash || '') && v.expiresAt === null), 'cleanup_sessions_unverified');
        recoverVersion(f, profile);
        if (includeFiles) {
          targets.push(...['profile', 'credentials', 'sessions', 'email', 'username'].map(k => p[k]));
          for (const version of f.versions) {
            const paths = versionPaths(f, version);
            for (const [kind, filePath] of Object.entries(paths)) {
              const file = await privateFile('users', filePath, head, kind === 'original' ? 10 * 1024 * 1024 : 128 * 1024);
              ensure(file && hash(file.bytes) === (kind === 'original' ? version.sha256 : version.displaySha256), 'cleanup_avatar_ownership_unverified');
              targets.push(filePath);
            }
          }
        }
      }
      await writeManifest(); return targets;
    }
    await ownedUsers(await headFor('users'), false);
    entry.removedDataPaths = await deleteOwnedFiles('data', async head => {
      const targets = [];
      for (const f of fixtures.filter(f => f.seedAttempted)) {
        const current = await privateJson('data', f.paths.sync, head);
        if (current !== null) { const document = readSyncDocument(current); ensure(Object.keys(document.entries).every(k => [SONG_KEY, 'RGD_SOUND_ENABLED'].includes(k)), 'cleanup_data_scope_unverified'); targets.push(f.paths.sync); }
      }
      return targets;
    });
    entry.removedAccountPaths = await deleteOwnedFiles('users', head => ownedUsers(head, true));
    const [userHead, dataHead] = await Promise.all([headFor('users'), headFor('data')]);
    for (const f of fixtures.filter(f => f.seedAttempted)) {
      for (const filePath of ['profile', 'credentials', 'sessions', 'email', 'username'].map(k => f.paths[k])) ensure(await privateFile('users', filePath, userHead) === null, 'cleanup_records_remaining');
      ensure(await privateFile('data', f.paths.sync, dataHead) === null, 'cleanup_records_remaining');
      const userDirectory = 'users/v1/' + f.id.slice(0, 2) + '/' + f.id;
      ensure(await gh('users', '/contents/' + userDirectory + '?ref=' + userHead, { missing: true }) === null, 'cleanup_avatar_files_remaining');
    }
    entry.passed = true;
  } catch (error) { entry.error = safeError(error); }
  finally { for (const f of fixtures) f.cleanup = entry.passed ? 'current_files_removed' : 'cleanup_needs_attention'; try { await writeManifest(); } catch { entry.passed = false; entry.error = 'artifact_write_failed'; } }
}
async function main() {
  try {
    ensure(process.argv.length <= 3, 'base_url_invalid'); base = process.argv[2] || 'https://pocket.bornforthis.cn'; ensure(allowedBases.has(base), 'base_url_invalid'); report.base = base;
    env = await loadEnvironment(); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); outputReady = true;
    imageFixtures = JSON.parse(await fs.readFile(path.join(root, 'tests/helpers/avatar-images.json'), 'utf8'));
    users = createGitHubStore(env, { repository: 'users' }); data = createGitHubStore(env, { repository: 'data' });
    // Read-only gh check before creating any fixture, so cleanup capability is
    // known in advance. The App store separately checks private visibility.
    for (const repo of ['users', 'data']) { const value = await gh(repo, ''); ensure(value?.private === true && value.full_name === 'BrclioData/' + repositories[repo], 'github_repository_unverified'); }
    for (const label of ['a', 'b']) {
      const id = randomBytes(16).toString('hex'); fixtures.push({ label, id, username: 'qaav_' + runId + label, email: 'avatar-' + runId + '-' + label + '@brclio-smoke.invalid',
        password: 'AvatarSmoke!' + randomBytes(24).toString('hex'), createdAt: Date.now(), seedToken: 'm1.' + id + '.' + randomBytes(32).toString('hex'),
        marker: { kind: fixtureKind, runId, label, nonce: randomBytes(16).toString('hex') }, uploadAttempts: [], versions: [] });
    }
    phase('seed exactly two synthetic accounts without email or WeChat'); await seedFixtures(); report.fixtures = fixtures.map(({ label, id }) => ({ label, userId: id })); const [a, b] = fixtures;
    phase('verify persistent random assignment and password login');
    for (const f of fixtures) { const value = await call('/login/password', 'POST', { identifier: f.username, password: f.password }, null, 200); f.token = validSession(value, f); f.initialAvatar = builtinUser(value, f); checked('random_builtin_assigned_' + f.label, true); }
    let relogin = await call('/login/password', 'POST', { identifier: a.email, password: a.password }, null, 200); validSession(relogin, a); checked('random_avatar_persists_on_relogin', builtinUser(relogin, a) === a.initialAvatar);
    for (const builtinId of [1, 1000]) { const value = await call('/avatar', 'PUT', { builtinId }, a.token, 200); builtinUser(value, a, builtinId); await publicImage(value.user.avatarUrl, 'image/png'); checked('builtin_boundary_' + builtinId, true); }
    checked('second_user_avatar_unchanged', builtinUser(await call('/session', 'GET', undefined, b.token, 200), b) === b.initialAvatar);
    phase('upload and verify exact originals, including a valid maximum-size10MiB PNG');
    const firstUrl = await uploadAndRecord(a, Buffer.from(imageFixtures['image/png'], 'base64'));
    const currentUrl = await uploadAndRecord(a, maximumPng());
    checked('distinct_custom_versions', firstUrl !== currentUrl); await publicImage(firstUrl, 'image/jpeg', Buffer.from(imageFixtures['image/jpeg'], 'base64'));
    for (const suffix of ['/original.png', '/display.jpg']) await call('/avatar/' + a.id + '/' + a.versions.at(-1).assetId + suffix, 'GET', undefined, null, 404);
    const alias = [...allowedBases].find(origin => origin !== base), aliased = await call('/session', 'GET', undefined, a.token, 200, { base: alias, origin: base }); sameUser(aliased, a);
    checked('alias_avatar_origin', aliased.user.avatarUrl === currentUrl.replace(base, alias)); await publicImage(aliased.user.avatarUrl, 'image/jpeg', Buffer.from(imageFixtures['image/jpeg'], 'base64'));
    const refreshed = await call('/session', 'GET', undefined, a.token, 200); checked('custom_avatar_persists_refresh', refreshed.user.avatarUrl === currentUrl);
    relogin = await call('/login/password', 'POST', { identifier: a.username, password: a.password }, null, 200); validSession(relogin, a); checked('custom_avatar_persists_relogin', relogin.user.avatarUrl === currentUrl);
    phase('verify isolation, revoked sessions, malformed media and size limits');
    await call('/avatar', 'PUT', { builtinId: 1, userId: a.id }, b.token, 400);
    await call('/avatar', 'PUT', { builtinId: 1 }, null, 401);
    for (const builtinId of [0, 1001, 1.5, '1']) await call('/avatar', 'PUT', { builtinId }, a.token, 400);
    await call('/avatar', 'PUT', '{', a.token, 400, { raw: true });
    await call('/avatar', 'PUT', { original: { mimeType: 'image/svg+xml', data: 'PHN2Zy8+' }, compressed: { mimeType: 'image/jpeg', data: imageFixtures['image/jpeg'] } }, a.token, 400);
    await call('/avatar', 'PUT', { original: { mimeType: 'image/png', data: imageFixtures['image/png'] }, compressed: { mimeType: 'image/jpeg', data: 'A'.repeat(Math.ceil((128 * 1024 + 3) / 3) * 4) } }, a.token, 413);
    await call('/avatar', 'PUT', { original: { mimeType: 'image/png', data: 'A'.repeat(Math.ceil((10 * 1024 * 1024 + 3) / 3) * 4) }, compressed: { mimeType: 'image/jpeg', data: imageFixtures['image/jpeg'] } }, a.token, 413);
    checked('invalid_updates_preserve_custom_avatar', (await call('/session', 'GET', undefined, a.token, 200)).user.avatarUrl === currentUrl);
    checked('other_user_remains_isolated', builtinUser(await call('/session', 'GET', undefined, b.token, 200), b) === b.initialAvatar);
    await call('/logout', 'POST', {}, a.token, 200); await call('/avatar', 'PUT', { builtinId: 1 }, a.token, 401);
    relogin = await call('/login/password', 'POST', { identifier: a.username, password: a.password }, null, 200); a.token = validSession(relogin, a); checked('relogin_after_revocation_preserves_avatar', relogin.user.avatarUrl === currentUrl);
    phase('verify song favorites and legacy sync regression');
    for (const f of fixtures) { const empty = await call('/sync', 'GET', undefined, f.token, 200); checked('song_fixture_initially_empty_' + f.label, empty.revision === 0 && equal(empty.entries, {})); }
    const at = Date.now();
    let aSync = await call('/sync', 'PUT', { revision: 0, entries: { [SONG_KEY]: { value: { favorites: [SONG_A, SONG_B] }, updatedAt: at } } }, a.token, 200);
    const bSync = await call('/sync', 'PUT', { revision: 0, entries: { [SONG_KEY]: { value: { favorites: [SONG_B] }, updatedAt: at } } }, b.token, 200);
    const legacy = await call('/sync', 'GET', undefined, a.token, 200, { legacy: true }); checked('legacy_hides_song_key', !Object.hasOwn(legacy.entries || {}, SONG_KEY));
    await call('/sync', 'PUT', { revision: legacy.revision, entries: { RGD_SOUND_ENABLED: { value: false, updatedAt: at + 1 } } }, a.token, 200, { legacy: true });
    aSync = await call('/sync', 'GET', undefined, a.token, 200); checked('legacy_preserves_song_favorites', equal(aSync.entries?.[SONG_KEY]?.value?.favorites, [SONG_A, SONG_B]));
    aSync = await call('/sync', 'PUT', { revision: aSync.revision, entries: { [SONG_KEY]: { value: { favorites: [SONG_B] }, updatedAt: at + 2 } } }, a.token, 200);
    checked('song_favorite_removal_saved', equal(aSync.entries?.[SONG_KEY]?.value?.favorites, [SONG_B]));
    checked('song_accounts_isolated', equal(await call('/sync', 'GET', undefined, b.token, 200), bSync));
    await verifyFixture(a, aSync); await verifyFixture(b, bSync); report.passed = true;
  } catch (error) { report.error = safeError(error); }
  finally {
    if (users && data && fixtures.some(f => f.seedAttempted)) { phase('atomically remove only ownership-verified synthetic current files'); await cleanupFixtures(); if (report.cleanup.some(item => !item.passed)) report.passed = false; }
    report.finishedAt = new Date().toISOString(); report.note = 'Only two marked synthetic accounts and their current account/binary/business files were used. No email sent/read, no real WeChat identity used. Git history, dangling objects, abuse counters and any CDN image caches remain; current-file removal is not history erasure.';
    if (outputReady) { try { await writeManifest(); await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); console.log('[avatar smoke] ' + (report.passed ? 'PASS' : 'FAIL') + ' · ' + relativeDirectory + '/report.json'); } catch { report.passed = false; console.log('[avatar smoke] FAIL · artifact_write_failed'); } }
    else console.log('[avatar smoke] FAIL · ' + (report.error || 'configuration_unavailable'));
    process.exitCode = report.passed ? 0 : 1;
  }
}
await main();
