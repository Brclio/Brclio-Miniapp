#!/usr/bin/env node
// Read-only production verification. Sends no credentials and never creates,
// signs into, changes or deletes an account. Invoke only after deploying dist/web.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'dist/web');
const output = path.join(root, 'artifacts/avatar-release');
const ORIGINS = Object.freeze(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
const EXPECTED_VERSION = '0.1.6';
const EXCLUDED = new Set(['_worker.js', '_routes.json', '_headers']);
const CONCURRENCY = 12;
const ATTEMPTS = 3;
const TIMEOUT_MS = 20000;
const MAX_ERRORS_PER_ORIGIN = 40;
const MAX_PROBE_BYTES = 256 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);

function fail(code) { throw Object.assign(new Error(code), { safeCode: code }); }
function safeCode(error) { return /^[a-z][a-z0-9_]{0,79}$/.test(error?.safeCode || '') ? error.safeCode : 'verification_operation_failed'; }
function canonicalPath(file) {
  if (file.endsWith('/index.html')) return file.slice(0, -'index.html'.length);
  return file.endsWith('.html') ? file.slice(0, -'.html'.length) : file;
}
async function writeJson(filename, value) {
  await fs.mkdir(output, { recursive: true });
  const target = path.join(output, filename);
  await fs.writeFile(target + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await fs.rename(target + '.tmp', target);
}
async function createManifest() {
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) fail('build_contains_symlink');
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile() && !EXCLUDED.has(relative)) {
        if (/(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.dev\.vars(?:\.|$)|(?:^|\/)\.git(?:\/|$)|\.(?:pem|key)$/i.test(relative)) fail('build_contains_private_file');
        const bytes = await fs.readFile(path.join(directory, entry.name));
        const publicPath = '/' + relative.split('/').map(encodeURIComponent).join('/');
        files.push({ path: publicPath, canonicalPath: canonicalPath(publicPath), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit(build);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const avatars = files.filter(file => /^\/avatars\/[0-9]{4}\.png$/.test(file.path));
  if (avatars.length !== 1000 || avatars.some((file, index) => file.path !== '/avatars/' + String(index + 1).padStart(4, '0') + '.png')) fail('builtin_avatar_manifest_incomplete');
  if (!files.some(file => file.path === '/index.html') || !files.some(file => file.path === '/account-runtime.js')) fail('public_build_incomplete');
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (packageJson.version !== EXPECTED_VERSION) fail('release_version_mismatch');
  const manifest = {
    schemaVersion: 1, createdAt: new Date().toISOString(), version: EXPECTED_VERSION,
    buildDirectory: 'dist/web', origins: ORIGINS, excluded: [...EXCLUDED], fileCount: files.length,
    builtinAvatarCount: avatars.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files
  };
  await writeJson('public-manifest.json', manifest);
  return manifest;
}

async function readBounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); fail('response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail('response_too_large'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { reader.releaseLock(); }
}
async function fetchBounded(origin, requestPath, { method = 'GET', body, limit = MAX_PROBE_BYTES, allowedPaths = [requestPath] } = {}) {
  const permitted = new Set(allowedPaths);
  let url = new URL(requestPath, origin), redirects = 0;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  while (true) {
    if (!ORIGINS.includes(url.origin) || url.origin !== origin || url.username || url.password || url.search || url.hash || !permitted.has(url.pathname)) fail('redirect_not_allowed');
    let response;
    try {
      response = await fetch(url, {
        method, body, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
        headers: { 'Cache-Control': 'no-cache', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }
      });
    } catch { fail(signal.aborted ? 'request_timed_out' : 'network_unavailable'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (method !== 'GET' || !location || ++redirects > 3) fail('redirect_not_allowed');
      try { url = new URL(location, url); } catch { fail('redirect_not_allowed'); }
      continue;
    }
    let bytes;
    try { bytes = await readBounded(response, limit); }
    catch (error) { if (error?.safeCode) throw error; fail(signal.aborted ? 'request_timed_out' : 'response_read_failed'); }
    return { status: response.status, bytes, finalPath: url.pathname, redirects };
  }
}
async function retry(callback) {
  let last, observed;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try { return { ...(await callback()), attempts: attempt }; }
    catch (error) {
      last = safeCode(error);
      if (error?.observed) observed = error.observed;
      if (attempt < ATTEMPTS) await new Promise(resolve => setTimeout(resolve, attempt * 200));
    }
  }
  return { passed: false, error: last, attempts: ATTEMPTS, ...(observed || {}) };
}
async function pool(tasks, callback) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    while (next < tasks.length) { const task = tasks[next++]; await callback(task); }
  }));
}
function addError(originReport, item) {
  originReport.errorCount++;
  if (originReport.errors.length < MAX_ERRORS_PER_ORIGIN) originReport.errors.push(item);
}
async function verifyPublicFile(origin, file) {
  const result = await retry(async () => {
    const response = await fetchBounded(origin, file.path, {
      allowedPaths: [file.path, file.canonicalPath],
      // Wrong HTML/error responses should be recorded safely even for tiny files.
      limit: Math.max(file.bytes + 65536, MAX_PROBE_BYTES)
    });
    const observed = { status: response.status, bytes: response.bytes.length, sha256: sha256(response.bytes), finalPath: response.finalPath, redirects: response.redirects };
    const statusMatches = response.status === 200 || file.path === '/404.html' && response.status === 404;
    if (!statusMatches || observed.bytes !== file.bytes || observed.sha256 !== file.sha256) {
      // Retry boundedly for transient deploy/CDN propagation; retain only safe metadata.
      throw Object.assign(new Error(), { safeCode: !statusMatches ? 'public_status_mismatch' : 'public_bytes_mismatch', observed });
    }
    return { passed: true, ...observed };
  });
  return { path: file.path, ...result };
}
const forbiddenContent = /BEGIN (?:RSA )?PRIVATE KEY|GITHUB_APP_PRIVATE_KEY\s*[:=]|ACCOUNT_HMAC_SECRET\s*[:=]|SMTP_APP_PASSWORD\s*[:=]|createAccountApi|function accountApi|store_configuration_invalid/i;
function probes() {
  const missingAvatar = '/api/account/avatar/' + '0'.repeat(32) + '/' + '0'.repeat(32);
  return [
    { path: '/api/health', status: 200, health: true },
    { path: '/api/account/session', status: 401 },
    { path: '/api/account/sync', status: 401 },
    { path: '/api/account/avatar', method: 'PUT', body: '{"builtinId":1}', status: 401 },
    { path: missingAvatar, status: 404 },
    { path: missingAvatar + '/original.png', status: 404 },
    { path: '/api/account/avatar/users/v1/' + '0'.repeat(32) + '/original.jpg', status: 404 },
    { path: '/.dev.vars', status: 404, protected: true },
    { path: '/_worker.js', status: 404, protected: true }
  ];
}
async function verifyProbe(origin, probe) {
  const result = await retry(async () => {
    const response = await fetchBounded(origin, probe.path, { method: probe.method || 'GET', body: probe.body });
    if (response.status !== probe.status) fail('probe_status_mismatch');
    if (probe.health) {
      let body;
      try { body = JSON.parse(response.bytes.toString('utf8')); } catch { fail('health_json_invalid'); }
      if (body.ok !== true || body.service !== 'brclio-pocket' || body.version !== EXPECTED_VERSION) fail('health_version_mismatch');
    }
    if (probe.protected && forbiddenContent.test(response.bytes.toString('utf8'))) fail('private_source_exposed');
    return { passed: true, status: response.status, bytes: response.bytes.length, sha256: sha256(response.bytes), ...(probe.health ? { version: EXPECTED_VERSION } : {}) };
  });
  return { path: probe.path, method: probe.method || 'GET', expectedStatus: probe.status, ...result };
}

async function main() {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/verify-avatar-production.mjs [--local-manifest]\n\nDefault: verify the deployed dist/web on both fixed production origins, with 12 concurrent requests and at most 3 attempts per check. No credentials or account writes are used.\n--local-manifest: write only artifacts/avatar-release/public-manifest.json; send no requests.\nReports: artifacts/avatar-release/production-verification.json');
    return;
  }
  if (args.some(arg => arg !== '--local-manifest') || args.length > 1) fail('unsupported_argument');
  const manifest = await createManifest();
  console.log('[avatar verification] Local manifest: ' + manifest.fileCount + ' files, ' + manifest.builtinAvatarCount + ' avatars.');
  if (args[0] === '--local-manifest') return;
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), completedAt: null, passed: false,
    version: EXPECTED_VERSION, concurrency: CONCURRENCY, maximumAttempts: ATTEMPTS,
    manifestCreatedAt: manifest.createdAt, fileCountPerOrigin: manifest.fileCount,
    origins: ORIGINS.map(origin => ({ origin, passed: false, checkedFiles: 0, matchedFiles: 0, checkedBuiltinAvatars: 0, errorCount: 0, errors: [], assets: [], probes: [] }))
  };
  await writeJson('production-verification.json', report);
  const indexed = new Map(report.origins.map(item => [item.origin, item]));
  const tasks = manifest.files.flatMap(file => ORIGINS.map(origin => ({ origin, file })));
  console.log('[avatar verification] Checking both official origins; public files only.');
  await pool(tasks, async ({ origin, file }) => {
    const current = indexed.get(origin), result = await verifyPublicFile(origin, file);
    current.assets.push(result); current.checkedFiles++;
    if (result.passed) {
      current.matchedFiles++;
      if (/^\/avatars\/[0-9]{4}\.png$/.test(file.path)) current.checkedBuiltinAvatars++;
    } else addError(current, { path: file.path, error: result.error });
    if (current.checkedFiles % 250 === 0 || current.checkedFiles === manifest.fileCount) console.log('[avatar verification] ' + origin + ': ' + current.checkedFiles + '/' + manifest.fileCount + ' checked; ' + current.errorCount + ' failures.');
  });
  await pool(ORIGINS.flatMap(origin => probes().map(probe => ({ origin, probe }))), async ({ origin, probe }) => {
    const current = indexed.get(origin), result = await verifyProbe(origin, probe);
    current.probes.push(result);
    if (!result.passed) addError(current, { path: probe.path, method: probe.method || 'GET', error: result.error });
  });
  for (const current of report.origins) {
    current.assets.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    current.probes.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    current.passed = current.checkedFiles === manifest.fileCount && current.matchedFiles === manifest.fileCount && current.checkedBuiltinAvatars === 1000 && current.errorCount === 0;
    current.errorsTruncated = current.errorCount > current.errors.length;
  }
  report.completedAt = new Date().toISOString(); report.passed = report.origins.every(item => item.passed);
  await writeJson('production-verification.json', report);
  console.log(JSON.stringify({ passed: report.passed, version: EXPECTED_VERSION, origins: report.origins.map(({ origin, passed, checkedFiles, matchedFiles, checkedBuiltinAvatars, errorCount, errors }) => ({ origin, passed, checkedFiles, matchedFiles, checkedBuiltinAvatars, errorCount, errors })), report: 'artifacts/avatar-release/production-verification.json' }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch(async error => {
  const code = safeCode(error);
  console.error('[avatar verification] ' + code);
  process.exitCode = 1;
});
