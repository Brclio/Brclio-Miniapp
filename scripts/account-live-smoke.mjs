#!/usr/bin/env node
// Explicitly invoked production verification. Creates synthetic accounts and
// removes their current documents; Git history and abuse counters are retained.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createGitHubStore } from '../web/account-store.mjs';
import { accountInternals } from '../web/account-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'artifacts/account-verification/live-api-smoke.json');
const allowedBases = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
const report = { startedAt: new Date().toISOString(), passed: false, routes: [], checks: [], users: [], cleanup: [] };
const accounts = [];
let env, users, data, base;
const idPattern = /^[a-f0-9]{32}$/;

function ensure(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { safeCode: code });
}
function safeError(error) {
  return /^[a-z_]{1,80}$/.test(error?.safeCode || '') ? error.safeCode : 'smoke_operation_failed';
}
function checked(name, condition) { ensure(condition, name); report.checks.push(name); }
function phase(name) { console.log('[account smoke] ' + name); }
function noPasswords(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    ensure(!/password|credential|secret|session_key|openid/i.test(key), 'response_contains_private_fields');
    noPasswords(item);
  }
}
async function loadEnvironment() {
  const result = Object.create(null);
  const source = await fs.readFile(path.join(root, '.dev.vars'), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    ensure(match, 'configuration_format_invalid');
    try { result[match[1]] = JSON.parse(match[2]); }
    catch { throw Object.assign(new Error(), { safeCode: 'configuration_format_invalid' }); }
  }
  ensure(result.ACCOUNT_ENABLED === 'true' && result.ACCOUNT_HMAC_SECRET?.length >= 32, 'account_configuration_missing');
  ensure(typeof result.SMTP_APP_PASSWORD === 'string' && result.SMTP_APP_PASSWORD.replace(/\s/g, ''), 'mail_configuration_missing');
  ensure(/^[A-Za-z0-9._%+-]+@(?:gmail\.com|googlemail\.com)$/i.test(result.SMTP_USERNAME || ''), 'gmail_mailbox_required');
  return result;
}

// Python receives credentials only over stdin. EXAMINE, UID SEARCH HEADER To,
// and BODY.PEEK[] leave the mailbox untouched and never return other messages.
const imapProgram = String.raw`
import sys, json, time, imaplib, email, re
from email.header import decode_header, make_header
from email.utils import getaddresses
cfg = json.load(sys.stdin)
deadline = time.monotonic() + 55
mail = None
try:
    mail = imaplib.IMAP4_SSL('imap.gmail.com', 993, timeout=10)
    mail.login(cfg['username'], re.sub(r'\s', '', cfg['password']))
    kind, _ = mail.select('INBOX', readonly=True)
    if kind != 'OK': raise ValueError()
    while time.monotonic() < deadline:
        kind, found = mail.uid('search', None, 'HEADER', 'To', '"' + cfg['alias'] + '"')
        if kind != 'OK': raise ValueError()
        for uid in reversed((found[0] or b'').split()[-10:]):
            kind, pieces = mail.uid('fetch', uid, '(BODY.PEEK[])')
            if kind != 'OK': continue
            raw = next((item[1] for item in pieces if isinstance(item, tuple)), None)
            if not raw or len(raw) > 262144: continue
            message = email.message_from_bytes(raw)
            recipients = [addr.lower() for _, addr in getaddresses(message.get_all('To', []))]
            if cfg['alias'].lower() not in recipients: continue
            subject = str(make_header(decode_header(message.get('Subject', ''))))
            if 'Brclio' not in subject or cfg['purpose'] + '验证码' not in subject: continue
            for part in message.walk():
                if part.get_content_type() != 'text/plain': continue
                payload = part.get_payload(decode=True)
                if payload is None: continue
                text = payload.decode(part.get_content_charset() or 'utf-8', errors='strict')
                code = re.search(re.escape('你的' + cfg['purpose'] + '验证码是：') + r'([0-9]{6})(?![0-9])', text)
                if code:
                    print(json.dumps({'code': code.group(1)}))
                    sys.exit(0)
        remaining = deadline - time.monotonic()
        if remaining > 0: time.sleep(min(5, remaining))
    print(json.dumps({'error': 'mail_delivery_not_observed'}))
    sys.exit(2)
except Exception:
    print(json.dumps({'error': 'mailbox_unavailable'}))
    sys.exit(2)
finally:
    if mail is not None:
        try: mail.logout()
        except Exception: pass
`;
async function receiveCode(account, purpose) {
  const response = await new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', imapProgram], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(Object.assign(new Error(), { safeCode: 'mailbox_timeout' }));
    }, 60000);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 4096) { child.kill('SIGKILL'); finish(Object.assign(new Error(), { safeCode: 'mailbox_response_invalid' })); }
    });
    child.stderr.on('data', () => {}); // Provider/Python diagnostics must never reach logs.
    child.on('error', () => finish(Object.assign(new Error(), { safeCode: 'mailbox_process_failed' })));
    child.stdin.on('error', () => finish(Object.assign(new Error(), { safeCode: 'mailbox_process_failed' })));
    child.on('close', () => {
      let parsed;
      try { parsed = JSON.parse(output); } catch { return finish(Object.assign(new Error(), { safeCode: 'mailbox_response_invalid' })); }
      if (/^[0-9]{6}$/.test(parsed.code || '')) finish(null, parsed.code);
      else finish(Object.assign(new Error(), { safeCode: ['mail_delivery_not_observed', 'mailbox_unavailable'].includes(parsed.error) ? parsed.error : 'mailbox_response_invalid' }));
    });
    child.stdin.end(JSON.stringify({ username: env.SMTP_USERNAME, password: env.SMTP_APP_PASSWORD, alias: account.email, purpose }));
  });
  ensure(/^[0-9]{6}$/.test(response), 'mailbox_code_invalid');
  return response;
}

async function call(route, method, body, token, expected) {
  const started = performance.now();
  const entry = { route, method, expected, status: null, durationMs: null };
  report.routes.push(entry);
  try {
    const response = await fetch(base + '/api/account' + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    entry.status = response.status;
    let value;
    try { value = await response.json(); } catch { ensure(false, 'api_response_invalid'); }
    noPasswords(value);
    for (const account of accounts) ensure(!JSON.stringify(value).includes(account.password), 'response_contains_password');
    ensure(response.headers.get('Cache-Control')?.includes('no-store'), 'api_cache_policy_invalid');
    ensure(response.status === expected, 'api_status_unexpected');
    return value;
  } finally { entry.durationMs = Math.round(performance.now() - started); }
}
function sameUser(result, account) { ensure(result?.user?.id === account.id, 'identity_changed'); }
function validSession(result, account) {
  sameUser(result, account);
  ensure(new RegExp('^m1\\.' + account.id + '\\.[a-f0-9]{64}$').test(result.token || ''), 'session_token_invalid');
  ensure(result.expiresAt === null, 'session_expiry_invalid');
  return result.token;
}
function assertGenerated(account) {
  ensure(/^[a-f0-9]{12}$/.test(account.tag), 'cleanup_scope_invalid');
  const [local, domain] = env.SMTP_USERNAME.toLowerCase().split('@');
  ensure(account.email === local.split('+')[0] + '+brclio-smoke-' + account.tag + '-' + account.label + '@' + domain, 'cleanup_scope_invalid');
  ensure(account.username === 'qa_' + account.tag + account.label && ['a', 'b'].includes(account.label), 'cleanup_scope_invalid');
  if (account.id) ensure(idPattern.test(account.id), 'cleanup_scope_invalid');
}
async function pathsFor(account) {
  assertGenerated(account);
  const secret = env.ACCOUNT_HMAC_SECRET;
  return {
    email: await accountInternals.indexPath(secret, 'email', account.email),
    username: await accountInternals.indexPath(secret, 'username', account.username),
    register: await accountInternals.challengePath(secret, account.email, 'register'),
    login: await accountInternals.challengePath(secret, account.email, 'login'),
    ...(account.id ? Object.fromEntries(['profile', 'credentials', 'sessions', 'preferences', 'sync'].map(name => [name, accountInternals.userPath(account.id, name)])) : {})
  };
}
async function verifyStored(account) {
  const paths = await pathsFor(account);
  const [profile, credentials, sessions, emailIndex, usernameIndex] = await Promise.all([
    users.read(paths.profile), users.read(paths.credentials), users.read(paths.sessions), users.read(paths.email), users.read(paths.username)
  ]);
  checked('stored_profile_' + account.label, profile?.id === account.id && profile.email === account.email && profile.username === account.username);
  checked('stored_credentials_' + account.label, credentials?.passwordPlaintext === account.password && credentials.password?.algorithm === 'pbkdf2-sha256-hmac-v1' && credentials.password?.hash !== account.password);
  checked('stored_sessions_' + account.label, Array.isArray(sessions?.items) && sessions.items.length > 0 && sessions.items.every(item => /^[a-f0-9]{64}$/.test(item.hash) && !item.token && item.expiresAt === null));
  checked('stored_identity_indexes_' + account.label, emailIndex?.userId === account.id && usernameIndex?.userId === account.id);
  checked('plaintext_only_in_credentials_' + account.label, [profile, sessions, emailIndex, usernameIndex].every(value => !JSON.stringify(value).includes(account.password)));
  report.users.push({ label: account.label, userId: account.id, accountPaths: [paths.profile, paths.credentials, paths.sessions], indexPaths: [paths.email, paths.username], challengePaths: [paths.register, paths.login] });
}

async function cleanupAccount(account) {
  const entry = { label: account.label, passed: false, userId: account.id || null, accountPaths: [], dataPaths: [] };
  report.cleanup.push(entry);
  try {
    let paths = await pathsFor(account);
    // Recover a committed registration if the HTTP response was interrupted.
    const [emailIndex, usernameIndex] = await Promise.all([users.read(paths.email), users.read(paths.username)]);
    if (!account.id && (emailIndex || usernameIndex)) {
      ensure(emailIndex?.userId === usernameIndex?.userId && idPattern.test(emailIndex?.userId || ''), 'cleanup_ownership_unverified');
      account.id = emailIndex.userId; paths = await pathsFor(account); entry.userId = account.id;
    }
    if (account.id) {
      const [profile, credentials] = await Promise.all([users.read(paths.profile), users.read(paths.credentials)]);
      ensure(profile?.id === account.id && profile.email === account.email && profile.username === account.username && credentials?.passwordPlaintext === account.password, 'cleanup_ownership_unverified');
      ensure((!emailIndex || emailIndex.userId === account.id) && (!usernameIndex || usernameIndex.userId === account.id), 'cleanup_ownership_unverified');
      await data.transaction(tx => { tx.delete(paths.preferences); tx.delete(paths.sync); });
      entry.dataPaths.push(paths.preferences, paths.sync);
    } else ensure(!emailIndex && !usernameIndex, 'cleanup_ownership_unverified');
    await users.transaction(async tx => {
      if (account.id) {
        const profile = await tx.get(paths.profile), credentials = await tx.get(paths.credentials);
        ensure(profile?.id === account.id && profile.email === account.email && profile.username === account.username && credentials?.passwordPlaintext === account.password, 'cleanup_ownership_unverified');
        for (const key of ['email', 'username']) {
          const current = await tx.get(paths[key]);
          ensure(!current || current.userId === account.id, 'cleanup_ownership_unverified');
        }
        for (const key of ['profile', 'credentials', 'sessions', 'email', 'username']) tx.delete(paths[key]);
      }
      for (const key of ['register', 'login']) tx.delete(paths[key]);
    });
    entry.accountPaths = (account.id ? ['profile', 'credentials', 'sessions', 'email', 'username', 'register', 'login'] : ['register', 'login']).map(key => paths[key]);
    const remaining = await Promise.all([...entry.accountPaths.map(value => users.read(value)), ...entry.dataPaths.map(value => data.read(value))]);
    ensure(remaining.every(value => value === null), 'cleanup_records_remaining');
    entry.passed = true;
  } catch (error) { entry.error = safeError(error); }
}

async function main() {
  try {
    ensure(process.argv.length <= 3, 'base_url_invalid');
    base = process.argv[2] || 'https://pocket.bornforthis.cn';
    ensure(allowedBases.has(base), 'base_url_invalid');
    report.base = base;
    env = await loadEnvironment();
    users = createGitHubStore(env, { repository: 'users' });
    data = createGitHubStore(env, { repository: 'data' });
    const tag = randomBytes(6).toString('hex');
    const [local, domain] = env.SMTP_USERNAME.toLowerCase().split('@');
    for (const label of ['a', 'b']) accounts.push({ label, tag, email: local.split('+')[0] + '+brclio-smoke-' + tag + '-' + label + '@' + domain, username: 'qa_' + tag + label, password: 'Smoke!' + randomBytes(24).toString('hex') });

    phase('register two synthetic accounts and verify delivered email');
    for (const account of accounts) {
      await call('/email/code', 'POST', { email: account.email, purpose: 'register' }, null, 200);
      const code = await receiveCode(account, '注册');
      const result = await call('/register', 'POST', { email: account.email, username: account.username, password: account.password, code }, null, 201);
      ensure(idPattern.test(result?.user?.id || ''), 'registration_user_invalid');
      account.id = result.user.id;
      account.token = validSession(result, account);
      await call('/register', 'POST', { email: account.email, username: account.username, password: account.password, code }, null, 409);
    }
    const [a, b] = accounts;
    checked('separate_user_ids', a.id !== b.id);

    phase('verify email and username password login');
    const emailLogin = await call('/login/password', 'POST', { identifier: a.email, password: a.password }, null, 200);
    const emailToken = validSession(emailLogin, a);
    const usernameLogin = await call('/login/password', 'POST', { identifier: a.username, password: a.password }, null, 200);
    const usernameToken = validSession(usernameLogin, a);
    await call('/login/password', 'POST', { identifier: a.username, password: 'Wrong!' + randomBytes(24).toString('hex') }, null, 401);

    phase('verify delivered login code and one-time consumption');
    await call('/email/code', 'POST', { email: a.email, purpose: 'login' }, null, 200);
    const loginCode = await receiveCode(a, '登录');
    const codeLogin = await call('/login/email', 'POST', { email: a.email, code: loginCode }, null, 200);
    a.token = validSession(codeLogin, a);
    await call('/login/email', 'POST', { email: a.email, code: loginCode }, null, 400);

    phase('verify session revocation and independent sessions');
    const permanent = await call('/session', 'GET', undefined, emailToken, 200);
    sameUser(permanent, a);
    checked('session_has_no_expiry', permanent.expiresAt === null);
    await call('/logout', 'POST', {}, emailToken, 200);
    await call('/session', 'GET', undefined, emailToken, 401);
    sameUser(await call('/session', 'GET', undefined, usernameToken, 200), a);
    sameUser(await call('/session', 'GET', undefined, a.token, 200), a);

    phase('verify business repository isolation and optimistic revisions');
    const initial = await call('/data', 'GET', undefined, a.token, 200);
    checked('new_user_preferences_empty', initial.preferences === null);
    const saved = await call('/data', 'PUT', { revision: 0, preferences: { soundEnabled: false, haptics: true } }, a.token, 200);
    checked('preferences_saved', saved.preferences?.revision === 1 && saved.preferences.values.soundEnabled === false && saved.preferences.values.haptics === true);
    const own = await call('/data', 'GET', undefined, a.token, 200);
    checked('preferences_read_back', JSON.stringify(own.preferences) === JSON.stringify(saved.preferences));
    const other = await call('/data', 'GET', undefined, b.token, 200);
    checked('other_user_preferences_isolated', other.preferences === null);
    await call('/data', 'PUT', { revision: 0, preferences: { soundEnabled: true, haptics: false } }, a.token, 409);

    phase('verify allowlisted business sync, compare-and-swap and user isolation');
    const syncInitial = await call('/sync', 'GET', undefined, a.token, 200);
    checked('new_user_sync_empty', syncInitial.revision === 0 && Object.keys(syncInitial.entries || {}).length === 0);
    const syncAt = Date.now();
    const syncPreferences = { 'lingotiles.preferences.v1': { value: { matchAnimation: false }, updatedAt: syncAt } };
    const syncSaved = await call('/sync', 'PUT', { revision: 0, entries: syncPreferences }, a.token, 200);
    checked('sync_preferences_saved', syncSaved.revision === 1 && JSON.stringify(syncSaved.entries) === JSON.stringify(syncPreferences));
    const syncOwn = await call('/sync', 'GET', undefined, a.token, 200);
    checked('sync_read_back', JSON.stringify(syncOwn) === JSON.stringify(syncSaved));
    const syncOther = await call('/sync', 'GET', undefined, b.token, 200);
    checked('other_user_sync_isolated', syncOther.revision === 0 && Object.keys(syncOther.entries || {}).length === 0);
    await call('/sync', 'PUT', { revision: 0, entries: { RGD_SOUND_ENABLED: { value: true, updatedAt: syncAt } } }, a.token, 409);
    const progress = { completed: { '1': { stars: 3, bestScore: 42, bestTime: 12 } }, seen: ['apple'], saved: [], sessions: 1, lastPlayed: null, streak: 0 };
    const syncMerged = await call('/sync', 'PUT', { revision: 1, entries: { 'lingotiles.progress.v1': { value: progress, updatedAt: syncAt + 1 } } }, a.token, 200);
    checked('sync_patch_preserves_previous_key', syncMerged.revision === 2 && syncMerged.entries?.['lingotiles.preferences.v1']?.value?.matchAnimation === false);
    checked('sync_progress_saved', JSON.stringify(syncMerged.entries?.['lingotiles.progress.v1']?.value) === JSON.stringify(progress));
    await call('/sync', 'PUT', { revision: 2, entries: { RGD_CUSTOM_REWARDS: { value: ['do not store'], updatedAt: syncAt + 2 } } }, a.token, 400);
    await call('/sync', 'PUT', { revision: 2, entries: { 'lingotiles.preferences.v1': { value: { matchAnimation: false, passwordPlaintext: a.password }, updatedAt: syncAt + 2 } } }, a.token, 400);
    const syncAfterRejected = await call('/sync', 'GET', undefined, a.token, 200);
    checked('sync_invalid_writes_preserve_revision', JSON.stringify(syncAfterRejected) === JSON.stringify(syncMerged));
    for (const account of accounts) {
      const encoded = JSON.stringify(syncAfterRejected);
      checked('sync_response_no_identity_' + account.label, ![account.password, account.token, account.email, account.username].some(value => encoded.includes(value)));
    }

    phase('verify actual per-user repository documents');
    for (const account of accounts) await verifyStored(account);
    const aPaths = await pathsFor(a), bPaths = await pathsFor(b);
    const preference = await data.read(aPaths.preferences);
    checked('business_repository_preferences', preference?.revision === 1 && preference.values?.soundEnabled === false && preference.values?.haptics === true);
    checked('business_repository_no_identity', Object.keys(preference).sort().join(',') === 'revision,schemaVersion,updatedAt,values' && Object.keys(preference.values).sort().join(',') === 'haptics,soundEnabled');
    checked('account_repository_no_preferences', await users.read(aPaths.preferences) === null);
    for (const accountPaths of [aPaths, bPaths]) {
      for (const key of ['profile', 'credentials', 'sessions', 'email', 'username']) checked('no_business_' + key + '_' + (accountPaths === aPaths ? 'a' : 'b'), await data.read(accountPaths[key]) === null);
    }
    checked('other_user_no_stored_preferences', await data.read(bPaths.preferences) === null);
    const syncDocument = await data.read(aPaths.sync);
    checked('business_repository_sync_document', syncDocument?.schemaVersion === 1 && syncDocument.revision === 2 && JSON.stringify(syncDocument.entries) === JSON.stringify(syncMerged.entries));
    checked('business_repository_sync_shape', Object.keys(syncDocument).sort().join(',') === 'entries,revision,schemaVersion,updatedAt');
    noPasswords(syncDocument);
    for (const account of accounts) checked('sync_document_no_identity_' + account.label, ![account.password, account.token, account.email, account.username].some(value => JSON.stringify(syncDocument).includes(value)));
    checked('account_repository_no_sync', await users.read(aPaths.sync) === null);
    checked('other_user_no_stored_sync', await data.read(bPaths.sync) === null);
    report.dataPaths = [aPaths.preferences, aPaths.sync];
    report.passed = true;
  } catch (error) { report.error = safeError(error); }
  finally {
    if (users && data && accounts.length) {
      phase('remove only generated current documents');
      for (const account of accounts) await cleanupAccount(account);
      if (report.cleanup.some(value => !value.passed)) report.passed = false;
    }
    report.finishedAt = new Date().toISOString();
    report.note = 'Synthetic test documents removed when cleanup passed; abuse counters and immutable Git history remain. WeChat wx.login must be verified in a real miniapp runtime.';
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log('[account smoke] ' + (report.passed ? 'PASS' : 'FAIL') + ' · artifacts/account-verification/live-api-smoke.json');
    process.exitCode = report.passed ? 0 : 1;
  }
}
await main();
