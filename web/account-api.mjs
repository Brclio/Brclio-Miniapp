import { createGitHubStore, AccountStoreError } from './account-store.mjs';
import { AvatarError, MAX_AVATAR_REQUEST_BYTES, validateAvatar, imageDimensions, hasAvatar, randomBuiltinId, avatarDirectory, publicAvatar } from './account-avatar.mjs';
import { sendAccountEmail } from './account-mail.mjs';
import { SyncDataError, MAX_SYNC_REQUEST_BYTES, validateSyncPatch, readSyncDocument, mergeSyncPatch } from './account-sync.mjs';
import { issueDuelTicket, duelSocketUrl } from './duel-ticket.mjs';
import { handleFriends, FriendsError } from './account-friends.mjs';

const encoder = new TextEncoder();
const CODE_TTL = 10 * 60000;
const PASSWORD_ITERATIONS = 100000; // Workers' native PBKDF2 ceiling; input is also peppered.
const USER_ID = /^[a-f0-9]{32}$/;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const ROUTES = new Map([
  ['/email/code', 'POST'], ['/register', 'POST'], ['/login/password', 'POST'],
  ['/login/email', 'POST'], ['/login/wechat', 'POST'], ['/session', 'GET'],
  ['/logout', 'POST'], ['/bind/email', 'POST'], ['/bind/wechat', 'POST'], ['/data', 'GET,PUT'], ['/sync', 'GET,PUT'], ['/avatar', 'PUT'], ['/duel-ticket', 'POST'],
  ['/friends', 'GET'], ['/friends/request', 'POST'], ['/friends/respond', 'POST'], ['/friends/remove', 'POST']
]);

class AccountError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
function fail(status, code, message, retryAfter) { return new AccountError(status, code, message, retryAfter); }
function rejected(status, error, message, retryAfter) { return { failure: { status, error, message, retryAfter } }; }
function json(value, status = 200, headers = {}) { return Response.json(value, { status, headers: { ...HEADERS, ...headers } }); }
function syncResponse(document, request) {
  if (request.headers.get('X-Brclio-Sync-Version') === '2') return document;
  // Released clients reject unknown keys. Keep the shared revision and stored
  // document intact while returning the business keys that those clients know.
  return { revision: document.revision, entries: Object.fromEntries(Object.entries(document.entries).filter(([key]) => key !== 'brclio.nursery-favorites.v1')) };
}
function hex(bytes) { return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
function bytesFromHex(value) { return Uint8Array.from(value.match(/.{2}/g), part => parseInt(part, 16)); }
function randomHex(length) { return hex(crypto.getRandomValues(new Uint8Array(length))); }
function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return different === 0;
}
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function normalizeEmail(value) {
  if (typeof value !== 'string') throw fail(400, 'invalid_email', '请输入有效的邮箱地址。');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.startsWith('.') || email.includes('..') || email.includes('.@')) {
    throw fail(400, 'invalid_email', '请输入有效的邮箱地址。');
  }
  return email;
}
function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{3,23}$/.test(value.trim())) throw fail(400, 'invalid_username', '账号须为 4–24 位字母、数字或下划线，并以字母开头。');
  return value.trim().toLowerCase();
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw fail(400, 'invalid_password', '密码须为 8–128 位，且不含控制字符。');
  return value;
}
function validateCode(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw fail(400, 'invalid_code', '请输入 6 位邮箱验证码。');
  return value;
}
function newCode() {
  // Rejection sampling avoids modulo bias.
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
  return String(value % 1000000).padStart(6, '0');
}
async function passwordHash(password, secret, salt = randomHex(16)) {
  const peppered = await hmac(secret, 'password:v1:' + password);
  const key = await crypto.subtle.importKey('raw', encoder.encode(peppered), 'PBKDF2', false, ['deriveBits']);
  const hash = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytesFromHex(salt), iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' }, key, 256));
  return { algorithm: 'pbkdf2-sha256-hmac-v1', iterations: PASSWORD_ITERATIONS, salt, hash };
}
async function passwordMatches(password, record, secret) {
  if (!record || record.algorithm !== 'pbkdf2-sha256-hmac-v1' || record.iterations !== PASSWORD_ITERATIONS || !/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.hash)) return false;
  return constantEqual((await passwordHash(password, secret, record.salt)).hash, record.hash);
}
function userPath(id, file) {
  if (!USER_ID.test(id)) throw fail(401, 'unauthorized', '登录已失效，请重新登录。');
  return 'users/v1/' + id.slice(0, 2) + '/' + id + '/' + file + '.json';
}
function ensureAvatar(tx, profile, at) {
  if (hasAvatar(profile)) return profile;
  const updated = { ...profile, avatar: { type: 'builtin', id: randomBuiltinId() }, updatedAt: at };
  tx.put(userPath(profile.id, 'profile'), updated);
  return updated;
}
function safeUser(profile, origin = '') {
  return { id: profile.id, username: profile.username || '', email: profile.email || '', displayName: profile.displayName || 'Brclio 用户', ...publicAvatar(profile, origin), providers: [...(profile.providers || [])], createdAt: profile.createdAt };
}
async function indexPath(secret, type, value) {
  const key = await hmac(secret, 'identity:v1:' + type + ':' + value);
  return 'indexes/v1/' + type + '/' + key.slice(0, 2) + '/' + key + '.json';
}
async function challengePath(secret, email, purpose, userId = '') {
  const key = await hmac(secret, 'challenge:v1:' + purpose + ':' + userId + ':' + email);
  return 'challenges/v1/' + purpose + '/' + key.slice(0, 2) + '/' + key + '.json';
}
async function ratePath(secret, category, value) {
  const key = await hmac(secret, 'abuse:v1:' + category + ':' + value);
  return 'abuse/v1/' + category + '/' + key.slice(0, 2) + '/' + key + '.json';
}
async function takeRate(tx, path, at, limit, period) {
  let rate = await tx.get(path);
  if (!rate || at >= rate.resetAt) rate = { count: 0, resetAt: at + period };
  if (rate.count >= limit) return rejected(429, 'rate_limited', '操作较频繁，请稍后再试。', Math.max(1, Math.ceil((rate.resetAt - at) / 1000)));
  tx.put(path, { count: rate.count + 1, resetAt: rate.resetAt });
  return null;
}
function parseBearer(request) {
  const match = /^Bearer (m1\.([a-f0-9]{32})\.[a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!match) throw fail(401, 'unauthorized', '请先登录。');
  return { token: match[1], id: match[2] };
}
async function authenticate(tx, request, at, { migrate = true } = {}) {
  const { token, id } = parseBearer(request);
  const tokenHash = await digest(token);
  let sessions = await tx.get(userPath(id, 'sessions'));
  let session = sessions?.items?.find(item => constantEqual(item.hash, tokenHash));
  if (!session) throw fail(401, 'unauthorized', '登录已失效，请重新登录。');
  const profile = await tx.get(userPath(id, 'profile'));
  if (!profile || profile.status !== 'active') throw fail(401, 'unauthorized', '登录已失效，请重新登录。');
  // Legacy session timestamps are metadata, never a reason to log out.
  // Migrate once without removing any other device's known session.
  if (migrate && sessions.items.some(item => item.expiresAt !== null)) {
    sessions = { ...sessions, items: sessions.items.map(item => ({ ...item, expiresAt: null })) };
    tx.put(userPath(id, 'sessions'), sessions);
    session = sessions.items.find(item => constantEqual(item.hash, tokenHash));
  }
  return { profile: migrate ? ensureAvatar(tx, profile, at) : profile, session, sessions, tokenHash };
}
// Server modules can share account authentication without exposing sessions,
// credentials, or creating a second login protocol. This check is read-only.
export async function authenticateAccountUser(store, request, at = Date.now(), origin = '') {
  const { profile } = await authenticate({ get: path => store.read(path) }, request, at, { migrate: false });
  return safeUser(profile, origin);
}
async function issueSession(tx, profile, at, token, origin) {
  profile = ensureAvatar(tx, profile, at);
  const path = userPath(profile.id, 'sessions');
  const current = await tx.get(path);
  const items = (current?.items || []).map(item => ({ ...item, expiresAt: null }));
  items.push({ hash: await digest(token), createdAt: at, expiresAt: null });
  tx.put(path, { schemaVersion: 1, items });
  return { user: safeUser(profile, origin), token, expiresAt: null };
}
async function consumeCode(tx, path, code, secret, at) {
  const challenge = await tx.get(path);
  if (!challenge || !challenge.delivered || challenge.expiresAt <= at || challenge.attempts >= 5 || challenge.usedAt) return rejected(400, 'code_invalid', '验证码错误或已过期，请重新获取。');
  if (!constantEqual(challenge.hash, await hmac(secret, 'code:v1:' + challenge.nonce + ':' + code))) {
    tx.put(path, { ...challenge, attempts: challenge.attempts + 1 });
    return rejected(400, 'code_invalid', '验证码错误或已过期，请重新获取。');
  }
  tx.put(path, { ...challenge, usedAt: at, hash: null });
  return null;
}
async function readBody(request, limit = 8192) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw fail(415, 'json_required', '请求格式错误。');
  if (Number(request.headers.get('Content-Length')) > limit) throw fail(413, 'body_too_large', '请求内容过大。');
  const reader = request.body?.getReader();
  if (!reader) throw fail(400, 'invalid_json', '请求内容错误。');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw fail(413, 'body_too_large', '请求内容过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail(400, 'invalid_json', '请求内容错误。'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw fail(400, 'invalid_json', '请求内容错误。');
  return value;
}
function exactFields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw fail(400, 'invalid_fields', '请求字段错误。');
}
async function exchangeWeChatCode(code, env, fetchImpl) {
  if (!/^wx[a-zA-Z0-9]{16}$/.test(env.WECHAT_APP_ID || '') || !env.WECHAT_APP_SECRET) throw fail(503, 'wechat_unavailable', '微信登录暂不可用，请稍后重试。');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid: env.WECHAT_APP_ID, secret: env.WECHAT_APP_SECRET, js_code: code, grant_type: 'authorization_code' });
  let data;
  try {
    const response = await fetchImpl(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch { throw fail(503, 'wechat_unavailable', '微信登录暂不可用，请稍后重试。'); }
  if (data.errcode || typeof data.openid !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(data.openid)) throw fail(401, 'wechat_login_failed', '微信登录凭证已失效，请重新尝试。');
  // session_key and unionid are intentionally neither persisted nor returned.
  return data.openid;
}

export function createAccountApi({ storeFactory = createGitHubStore, fetchImpl = (...args) => fetch(...args), now = Date.now, sendEmail = sendAccountEmail, exchangeWeChat = exchangeWeChatCode } = {}) {
  return async function accountApi(request, env = {}) {
    let originHeaders = {};
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      const allowed = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
      if (origin) {
        if (!allowed.has(origin) || !allowed.has(url.origin)) throw fail(403, 'origin_forbidden', '请求来源不受支持。');
        originHeaders = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      }
      const route = url.pathname.slice('/api/account'.length);
      const avatarMatch = /^\/avatar\/([a-f0-9]{32})\/([a-f0-9]{32})$/.exec(route);
      const method = avatarMatch ? 'GET' : ROUTES.get(route);
      if (!method || url.search) throw fail(404, 'not_found', '接口不存在。');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...HEADERS, ...originHeaders, 'Access-Control-Allow-Methods': method, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Brclio-Sync-Version', 'Access-Control-Max-Age': '600' } });
      if (!method.split(',').includes(request.method)) return json({ error: 'method_not_allowed', message: '请求方式不受支持。' }, 405, { ...originHeaders, Allow: method });
      const enabled = env.ACCOUNT_ENABLED === 'true';
      const hmacReady = typeof env.ACCOUNT_HMAC_SECRET === 'string' && env.ACCOUNT_HMAC_SECRET.length >= 32;
      if (!enabled || !hmacReady) {
        console.warn(JSON.stringify({ service: 'miniapp-account', code: 'configuration_missing', enabled, hmacReady }));
        throw fail(503, 'account_unavailable', '账号服务暂不可用，请稍后重试。');
      }
      const at = now(), secret = env.ACCOUNT_HMAC_SECRET;
      const store = storeFactory(env, { repository: 'users', fetchImpl });
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (route === '/avatar') {
        // Large uploads must not be buffered or decoded for a bogus session or
        // an already exhausted budget. This read-only check reserves no write
        // and performs no legacy migrations; the commit authenticates and
        // consumes the budget again atomically after the body is validated.
        parseBearer(request);
        await store.transaction(async tx => {
          const { profile } = await authenticate(tx, request, at, { migrate: false });
          const rate = await tx.get(await ratePath(secret, 'avatar-user', profile.id));
          if (rate && at < rate.resetAt && rate.count >= 30) {
            throw fail(429, 'rate_limited', '操作较频繁，请稍后再试。', Math.max(1, Math.ceil((rate.resetAt - at) / 1000)));
          }
        });
      }
      const body = request.method === 'POST' || request.method === 'PUT' ? await readBody(request, route === '/sync' ? MAX_SYNC_REQUEST_BYTES : route === '/data' ? 32768 : route === '/avatar' ? MAX_AVATAR_REQUEST_BYTES : 8192) : {};
      let result;

      if (avatarMatch) {
        const [, userId, assetId] = avatarMatch;
        const profile = await store.read(userPath(userId, 'profile'));
        if (!profile || profile.status !== 'active') throw fail(404, 'not_found', '头像不存在。');
        const bytes = await store.readBinary(avatarDirectory(userId, assetId) + 'display.jpg');
        if (!bytes) throw fail(404, 'not_found', '头像不存在。');
        try {
          const dimensions = imageDimensions(bytes, 'image/jpeg');
          if (dimensions.width > 256 || dimensions.height > 256) throw new Error();
        } catch { throw fail(503, 'avatar_unavailable', '头像暂不可用。'); }
        return new Response(bytes, { headers: { ...originHeaders, 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length), 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
      } else if (route === '/avatar') {
        const avatar = validateAvatar(body), assetId = randomHex(16);
        const metadata = avatar.original ? {
          type: 'custom', assetId,
          original: { mimeType: avatar.original.mimeType, bytes: avatar.original.bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', avatar.original.bytes)) },
          compressed: { mimeType: 'image/jpeg', bytes: avatar.compressed.bytes.length, width: avatar.compressed.width, height: avatar.compressed.height }
        } : { type: 'builtin', id: avatar.builtinId };
        result = await store.transaction(async tx => {
          const { profile } = await authenticate(tx, request, at);
          const blocked = await takeRate(tx, await ratePath(secret, 'avatar-user', profile.id), at, 30, 3600000);
          if (blocked) return blocked;
          if (avatar.original) {
            const directory = avatarDirectory(profile.id, assetId);
            tx.putBinary(directory + 'original.' + avatar.original.extension, avatar.original.bytes);
            tx.putBinary(directory + 'display.jpg', avatar.compressed.bytes);
          }
          const updated = { ...profile, avatar: metadata, updatedAt: at };
          tx.put(userPath(profile.id, 'profile'), updated);
          return { user: safeUser(updated, url.origin) };
        });
      } else if (route === '/email/code') {
        exactFields(body, ['email', 'purpose']);
        const email = normalizeEmail(body.email), purpose = body.purpose;
        if (!['register', 'login', 'bind'].includes(purpose)) throw fail(400, 'invalid_purpose', '验证码用途错误。');
        const gmail = env.EMAIL_PROVIDER === 'gmail' || env.SMTP_USERNAME;
        if (sendEmail === sendAccountEmail && (gmail ? !env.SMTP_USERNAME || !env.SMTP_APP_PASSWORD : !env.RESEND_API_KEY || !env.EMAIL_FROM)) throw fail(503, 'email_unavailable', '邮件服务暂不可用，请稍后重试。');
        const bindId = purpose === 'bind' ? parseBearer(request).id : '';
        const path = await challengePath(secret, email, purpose, bindId);
        const code = newCode(), nonce = randomHex(16);
        result = await store.transaction(async tx => {
          if (purpose === 'bind') await authenticate(tx, request, at);
          const challenge = await tx.get(path);
          if (challenge && at - challenge.sentAt < 60000) return rejected(429, 'code_cooldown', '验证码已发送，请稍后再试。', Math.ceil((60000 - (at - challenge.sentAt)) / 1000));
          const reset = !challenge || at >= challenge.windowResetAt;
          if (!reset && challenge.sendCount >= 6) return rejected(429, 'rate_limited', '验证码发送较频繁，请稍后再试。', Math.ceil((challenge.windowResetAt - at) / 1000));
          const blocked = await takeRate(tx, await ratePath(secret, 'email-ip', ip), at, 20, 3600000);
          if (blocked) return blocked;
          tx.put(path, { schemaVersion: 1, nonce, hash: await hmac(secret, 'code:v1:' + nonce + ':' + code), sentAt: at, expiresAt: at + CODE_TTL, attempts: 0, delivered: false, usedAt: null, sendCount: reset ? 1 : challenge.sendCount + 1, windowResetAt: reset ? at + 3600000 : challenge.windowResetAt });
          return { ok: true, retryAfter: 60, expiresIn: CODE_TTL / 1000 };
        });
        if (!result.failure) {
          try { await sendEmail({ email, code, purpose, nonce }, env, fetchImpl); }
          catch {
            // A failed/uncertain delivery must not leave an accepted code.
            throw fail(503, 'email_unavailable', '邮件服务暂不可用，请稍后重试。');
          }
          await store.transaction(async tx => {
            const current = await tx.get(path);
            if (!current || current.nonce !== nonce) throw fail(409, 'code_superseded', '验证码已更新，请重新获取。');
            tx.put(path, { ...current, delivered: true });
          });
        }
      } else if (route === '/register' || route === '/bind/email') {
        exactFields(body, ['email', 'username', 'password', 'code']);
        const email = normalizeEmail(body.email), username = normalizeUsername(body.username), password = validatePassword(body.password), code = validateCode(body.code);
        const binding = route === '/bind/email';
        const id = binding ? parseBearer(request).id : randomHex(16);
        const token = 'm1.' + id + '.' + randomHex(32);
        const passwordRecord = await passwordHash(password, secret);
        const emailIndex = await indexPath(secret, 'email', email), usernameIndex = await indexPath(secret, 'username', username);
        result = await store.transaction(async tx => {
          const blocked = await takeRate(tx, await ratePath(secret, 'register-ip', ip), at, 20, 900000);
          if (blocked) return blocked;
          const current = binding ? (await authenticate(tx, request, at)).profile : null;
          if (current?.email) return rejected(409, 'email_already_bound', '当前账号已绑定邮箱。');
          if (await tx.get(emailIndex)) return rejected(409, 'email_taken', '该邮箱已注册，请直接登录。');
          if (await tx.get(usernameIndex)) return rejected(409, 'username_taken', '该账号已被使用，请更换。');
          const invalid = await consumeCode(tx, await challengePath(secret, email, binding ? 'bind' : 'register', binding ? id : ''), code, secret, at);
          if (invalid) return invalid;
          const profile = { ...(current || { schemaVersion: 1, id, createdAt: at, status: 'active' }), email, username, displayName: username, providers: binding ? [...new Set([...current.providers, 'email'])] : ['email'], updatedAt: at };
          tx.put(userPath(id, 'profile'), profile);
          // The owner explicitly requires a readable administrative copy in
          // this private repository. It never enters a public profile/response.
          tx.put(userPath(id, 'credentials'), { schemaVersion: 1, password: passwordRecord, passwordPlaintext: password, updatedAt: at });
          tx.put(emailIndex, { userId: id }); tx.put(usernameIndex, { userId: id });
          return issueSession(tx, profile, at, token, url.origin);
        });
      } else if (route === '/login/password') {
        exactFields(body, ['identifier', 'password']);
        if (typeof body.identifier !== 'string') throw fail(400, 'invalid_identifier', '请输入邮箱或账号。');
        const type = body.identifier.includes('@') ? 'email' : 'username';
        const identifier = type === 'email' ? normalizeEmail(body.identifier) : normalizeUsername(body.identifier);
        const password = validatePassword(body.password);
        result = await store.transaction(async tx => {
          for (const [category, value, limit] of [['login-ip', ip, 30], ['login-identity', type + ':' + identifier, 10]]) {
            const blocked = await takeRate(tx, await ratePath(secret, category, value), at, limit, 900000);
            if (blocked) return blocked;
          }
          const index = await tx.get(await indexPath(secret, type, identifier));
          const credentials = index ? await tx.get(userPath(index.userId, 'credentials')) : null;
          // Use the same KDF even for a missing identity.
          const record = credentials?.password || { algorithm: 'pbkdf2-sha256-hmac-v1', iterations: PASSWORD_ITERATIONS, salt: '0'.repeat(32), hash: '0'.repeat(64) };
          const valid = await passwordMatches(password, record, secret);
          const profile = index ? await tx.get(userPath(index.userId, 'profile')) : null;
          if (!valid || !profile || profile.status !== 'active') return rejected(401, 'invalid_credentials', '账号或密码不正确。');
          return issueSession(tx, profile, at, 'm1.' + profile.id + '.' + randomHex(32), url.origin);
        });
      } else if (route === '/login/email') {
        exactFields(body, ['email', 'code']);
        const email = normalizeEmail(body.email), code = validateCode(body.code);
        result = await store.transaction(async tx => {
          const blocked = await takeRate(tx, await ratePath(secret, 'login-ip', ip), at, 30, 900000);
          if (blocked) return blocked;
          const invalid = await consumeCode(tx, await challengePath(secret, email, 'login'), code, secret, at);
          if (invalid) return invalid;
          const index = await tx.get(await indexPath(secret, 'email', email));
          const profile = index ? await tx.get(userPath(index.userId, 'profile')) : null;
          if (!profile || profile.status !== 'active') return rejected(401, 'invalid_credentials', '登录失败，请确认邮箱已注册。');
          return issueSession(tx, profile, at, 'm1.' + profile.id + '.' + randomHex(32), url.origin);
        });
      } else if (route === '/login/wechat' || route === '/bind/wechat') {
        exactFields(body, ['code']);
        if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(body.code)) throw fail(400, 'invalid_wechat_code', '请重新发起微信登录。');
        const binding = route === '/bind/wechat';
        // Rate reservation precedes the external code exchange, never inside a retried transaction.
        if (exchangeWeChat === exchangeWeChatCode && (!/^wx[a-zA-Z0-9]{16}$/.test(env.WECHAT_APP_ID || '') || !env.WECHAT_APP_SECRET)) throw fail(503, 'wechat_unavailable', '微信登录暂不可用，请稍后重试。');
        const ipRatePath = await ratePath(secret, 'wechat-ip', ip);
        const blocked = await store.transaction(async tx => {
          // Authenticate before consuming the one-use WeChat code, then again
          // in the atomic identity update in case this session was revoked.
          if (binding) await authenticate(tx, request, at);
          return takeRate(tx, ipRatePath, at, 30, 900000);
        });
        if (blocked) result = blocked;
        else {
          const openid = await exchangeWeChat(body.code, env, fetchImpl);
          const path = await indexPath(secret, 'wechat', env.WECHAT_APP_ID + ':' + openid);
          const newId = randomHex(16);
          result = await store.transaction(async tx => {
            const index = await tx.get(path);
            if (binding) {
              const { profile } = await authenticate(tx, request, at);
              if (index && index.userId !== profile.id) return rejected(409, 'wechat_taken', '此微信已绑定其他账号，请使用对应账号登录。');
              if (!index && profile.providers?.includes('wechat')) return rejected(409, 'wechat_already_bound', '当前账号已绑定其他微信。');
              const bound = profile.providers?.includes('wechat') ? profile : { ...profile, providers: [...new Set([...(profile.providers || []), 'wechat'])], updatedAt: at };
              if (bound !== profile) tx.put(userPath(profile.id, 'profile'), bound);
              if (!index) tx.put(path, { userId: profile.id });
              return { user: safeUser(bound, url.origin), expiresAt: null };
            }
            let profile = index ? await tx.get(userPath(index.userId, 'profile')) : null;
            if (index && (!profile || profile.status !== 'active')) return rejected(401, 'unauthorized', '账号暂不可用。');
            if (!profile) {
              profile = { schemaVersion: 1, id: newId, username: '', email: '', displayName: 'Brclio 用户', providers: ['wechat'], status: 'active', createdAt: at, updatedAt: at };
              tx.put(userPath(newId, 'profile'), profile);
              tx.put(userPath(newId, 'credentials'), { schemaVersion: 1, password: null, passwordPlaintext: null, updatedAt: at });
              tx.put(path, { userId: newId });
            }
            return issueSession(tx, profile, at, 'm1.' + profile.id + '.' + randomHex(32), url.origin);
          });
        }
      } else if (route === '/friends' || route.startsWith('/friends/')) {
        const user = await authenticateAccountUser(store, request, at, url.origin);
        const dataStore = storeFactory(env, { repository: 'data', fetchImpl });
        result = await handleFriends({ route, body, user, store: dataStore, at, origin: url.origin,
          resolveUsername: async username => (await store.read(await indexPath(secret, 'username', username)))?.userId,
          resolveUser: async id => { const profile = await store.read(userPath(id, 'profile')); return profile?.status === 'active' ? profile : null; }
        });
      } else if (route === '/duel-ticket') {
        exactFields(body, []);
        // Read-only authentication avoids a GitHub commit for every lobby visit.
        const user = await authenticateAccountUser(store, request, at, url.origin);
        if (typeof env.DUEL_TICKET_SECRET !== 'string' || env.DUEL_TICKET_SECRET.length < 32 || !duelSocketUrl(env.DUEL_SOCKET_URL)) {
          throw fail(503, 'duel_unavailable', '在线 PK 尚未开放，请先体验同屏对决。');
        }
        result = await issueDuelTicket(user, env.DUEL_TICKET_SECRET, env.DUEL_SOCKET_URL, at);
      } else if (route === '/session') {
        result = await store.transaction(async tx => {
          const { profile } = await authenticate(tx, request, at);
          return { user: safeUser(profile, url.origin), expiresAt: null };
        });
      } else if (route === '/logout') {
        exactFields(body, []);
        result = await store.transaction(async tx => {
          const { profile, sessions, tokenHash } = await authenticate(tx, request, at);
          tx.put(userPath(profile.id, 'sessions'), { schemaVersion: 1, items: sessions.items.filter(item => !constantEqual(item.hash, tokenHash)) });
          return { ok: true };
        });
      } else if (route === '/sync') {
        const auth = await store.transaction(tx => authenticate(tx, request, at));
        const dataStore = storeFactory(env, { repository: 'data', fetchImpl });
        const path = userPath(auth.profile.id, 'sync');
        if (request.method === 'GET') result = readSyncDocument(await dataStore.read(path));
        else {
          const patch = validateSyncPatch(body, at);
          result = await dataStore.transaction(async tx => {
            const current = readSyncDocument(await tx.get(path));
            if (current.revision !== patch.revision) return rejected(409, 'sync_conflict', '云端数据已更新，请重新读取后同步。');
            const document = mergeSyncPatch(current, patch, at);
            if (!document) return current;
            tx.put(path, document);
            return { revision: document.revision, entries: document.entries };
          });
        }
        if (!result?.failure) result = syncResponse(result, request);
      } else if (route === '/data') {
        const auth = await store.transaction(tx => authenticate(tx, request, at));
        const dataStore = storeFactory(env, { repository: 'data', fetchImpl });
        const path = userPath(auth.profile.id, 'preferences');
        if (request.method === 'GET') result = { preferences: await dataStore.read(path) };
        else {
          // Only app preferences cross into the business repository, never identity or credentials.
          exactFields(body, ['revision', 'preferences']);
          if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !body.preferences || Array.isArray(body.preferences) || typeof body.preferences !== 'object') throw fail(400, 'invalid_data', '数据格式错误。');
          exactFields(body.preferences, ['soundEnabled', 'haptics']);
          if (Object.values(body.preferences).some(value => typeof value !== 'boolean')) throw fail(400, 'invalid_data', '数据格式错误。');
          result = await dataStore.transaction(async tx => {
            const current = await tx.get(path);
            if ((current?.revision || 0) !== body.revision) return rejected(409, 'data_conflict', '云端数据已更新，请重新读取。');
            const preferences = { schemaVersion: 1, revision: body.revision + 1, updatedAt: at, values: body.preferences };
            tx.put(path, preferences); return { preferences };
          });
        }
      }
      if (result?.failure) {
        const { status, error, message, retryAfter } = result.failure;
        return json({ error, message, ...(retryAfter ? { retryAfter } : {}) }, status, { ...originHeaders, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) });
      }
      return json(result || { ok: true }, route === '/register' ? 201 : 200, originHeaders);
    } catch (error) {
      if (error instanceof FriendsError) return json({ error: error.code, message: error.message }, error.status, originHeaders);
      if (error instanceof AvatarError) return json({ error: error.code, message: error.message }, error.status, originHeaders);
      if (error instanceof SyncDataError) return json({ error: error.code, message: error.status === 503 ? '云端同步暂不可用，请稍后重试。' : error.status === 413 ? '同步数据较大，请减少单次同步内容。' : '同步数据格式错误或包含不支持的字段。' }, error.status, originHeaders);
      if (error instanceof AccountError) return json({ error: error.code, message: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, error.status, originHeaders);
      console.warn(JSON.stringify({ service: 'miniapp-account', code: error instanceof AccountStoreError ? error.safeCode : 'runtime_failure' }));
      // Never relay provider bodies, GitHub paths, identifiers, secrets or stack traces.
      return json({ error: 'account_unavailable', message: '账号服务暂不可用，请稍后重试。' }, 503, originHeaders);
    }
  };
}

export const accountInternals = { normalizeEmail, normalizeUsername, passwordHash, passwordMatches, indexPath, challengePath, userPath };
