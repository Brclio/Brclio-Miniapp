'use strict';

const config = require('../config');
const STORAGE_KEY = 'brclio.miniapp-account.v1';
const REVOCATIONS_KEY = 'brclio.miniapp-account-revocations.v1';
const REQUEST_TIMEOUT = 45000;
const WECHAT_LOGIN_TIMEOUT = 15000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{3,23}$/;
const CODE_PATTERN = /^\d{6}$/;

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function expiryTime(value) {
  if (typeof value === 'number') return value < 1000000000000 ? value * 1000 : value;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}
function safeUser(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 128) return null;
  const user = { id: value.id };
  ['username', 'email', 'displayName'].forEach(key => {
    user[key] = typeof value[key] === 'string' ? value[key].slice(0, key === 'email' ? 254 : 128) : '';
  });
  user.createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : typeof value.createdAt === 'string' ? value.createdAt.slice(0, 128) : '';
  user.avatarUrl = typeof value.avatarUrl === 'string' && /^https:\/\/[^\s]+$/.test(value.avatarUrl) ? value.avatarUrl.slice(0, 2048) : '';
  user.providers = Array.isArray(value.providers) ? ['email', 'wechat'].filter(provider => value.providers.indexOf(provider) !== -1) : [];
  return user;
}
function accountError(code, message, extra) {
  const error = new Error(message);
  error.code = code;
  if (extra && Number.isFinite(Number(extra.retryAfter))) error.retryAfter = Math.max(0, Math.ceil(Number(extra.retryAfter)));
  return error;
}
function endpoint(settings) {
  const base = settings.accountBase || (settings.webOrigin ? settings.webOrigin + '/api/account' : '');
  // A public HTTPS origin and the fixed account path are the only permitted destination.
  return typeof base === 'string' && /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::443)?\/api\/account\/?$/i.test(base) ? base.replace(/\/$/, '') : '';
}

function createAccountClient(options) {
  const settings = options || {};
  const base = endpoint(settings.config || config);
  const now = settings.now || Date.now;
  let memorySession, generation = 0, pendingRefresh = null;
  const subscribers = new Set();
  let revocations, pendingRevocations = null;
  const platform = () => settings.wx || (typeof wx !== 'undefined' ? wx : null);

  function emit(reason) {
    const value = memorySession;
    const snapshot = value ? { user: safeUser(value.user), expiresAt: value.expiresAt, reason } : { user: null, expiresAt: null, reason };
    subscribers.forEach(listener => { try { listener(snapshot); } catch (_) {} });
  }
  function validExpiry(value) { return value === null || Number.isFinite(expiryTime(value)); }
  function clearSession(reason) {
    memorySession = null;
    generation += 1;
    const api = platform();
    try { if (api && api.removeStorageSync) api.removeStorageSync(STORAGE_KEY); } catch (_) {}
    emit(reason || 'logout');
  }
  function readSession() {
    let value = memorySession;
    if (value === undefined) {
      try { const api = platform(); value = api && api.getStorageSync ? api.getStorageSync(STORAGE_KEY) : null; } catch (_) { value = null; }
    }
    const user = value && safeUser(value.user);
    if (!value || !user || typeof value.token !== 'string' || !value.token || !validExpiry(value.expiresAt)) {
      if (value) clearSession();
      else memorySession = null;
      return null;
    }
    try {
      if (loadRevocations().some(item => item.token === value.token)) { clearSession('logout'); return null; }
    } catch (_) {}
    memorySession = { token: value.token, expiresAt: value.expiresAt, user };
    return memorySession;
  }
  function saveSession(value, reason) {
    const user = value && safeUser(value.user);
    if (!user || typeof value.token !== 'string' || !value.token || !validExpiry(value.expiresAt)) {
      throw accountError('invalid_response', '登录结果暂时无法读取，请重试。');
    }
    const session = { token: value.token, expiresAt: value.expiresAt, user };
    const changed = !memorySession || memorySession.token !== session.token || memorySession.user.id !== session.user.id;
    memorySession = session;
    if (changed) generation += 1;
    try { const api = platform(); if (api && api.setStorageSync) api.setStorageSync(STORAGE_KEY, session); } catch (_) {}
    emit(reason || 'login');
    return { user: safeUser(user), expiresAt: session.expiresAt };
  }
  function request(path, method, data, token) {
    const requestGeneration = generation;
    return new Promise((resolve, reject) => {
      const api = platform();
      if (!base || !api || typeof api.request !== 'function') return reject(accountError('service_unavailable', '账号服务暂时不可用，请稍后重试。'));
      const header = { 'Content-Type': 'application/json' };
      if (token) header.Authorization = 'Bearer ' + token;
      if (path === '/sync') header['X-Brclio-Sync-Version'] = '2';
      try {
        api.request({ url: base + path, method, header, timeout: REQUEST_TIMEOUT,
          ...(data === undefined ? {} : { data }),
          success(response) {
            const body = response.data;
            if (response.statusCode >= 200 && response.statusCode < 300 && body && typeof body === 'object' && !body.error) return resolve(body);
            const code = body && typeof body.error === 'string' ? body.error : 'request_failed';
            const message = body && typeof body.message === 'string' && body.message.length <= 180 ? body.message : '操作未完成，请稍后重试。';
            const error = accountError(code, message, body);
            error.status = response.statusCode;
            if (response.statusCode === 401 && token && path !== '/logout' && code !== 'wechat_login_failed') {
              const current = readSession();
              if (current && current.token === token && generation === requestGeneration) clearSession('unauthorized');
            }
            reject(error);
          },
          fail() { reject(accountError('network_error', '连接失败，请检查网络后重试。')); }
        });
      } catch (_) { reject(accountError('network_error', '连接失败，请检查网络后重试。')); }
    });
  }
  function loadRevocations() {
    if (revocations) return revocations;
    const api = platform();
    const value = api && api.getStorageSync ? api.getStorageSync(REVOCATIONS_KEY) : [];
    revocations = Array.isArray(value) ? value.filter(item => item && typeof item.token === 'string' && item.token && item.token.length <= 512).map(item => ({ token: item.token, queuedAt: Number.isFinite(item.queuedAt) ? item.queuedAt : now() })) : [];
    return revocations;
  }
  function persistRevocations() {
    const api = platform();
    if (!api || !api.setStorageSync) throw accountError('storage_unavailable', '本机存储暂不可用。');
    api.setStorageSync(REVOCATIONS_KEY, loadRevocations());
  }
  function enqueueRevocation(token) {
    const queue = loadRevocations();
    if (!queue.some(item => item.token === token)) queue.push({ token, queuedAt: now() });
    persistRevocations();
  }
  async function revoke(token) {
    try { await request('/logout', 'POST', {}, token); }
    catch (error) { if (error.status !== 401) throw error; }
    revocations = loadRevocations().filter(item => item.token !== token);
    try { persistRevocations(); } catch (_) {}
  }
  function flushRevocations() {
    if (pendingRevocations) return pendingRevocations;
    const promise = (async () => {
      let queue; try { queue = loadRevocations().slice(); } catch (_) { return { pending: null }; }
      for (const item of queue) { try { await revoke(item.token); } catch (_) { break; } }
      return { pending: loadRevocations().length };
    })().finally(() => { if (pendingRevocations === promise) pendingRevocations = null; });
    pendingRevocations = promise;
    return promise;
  }
  async function authenticate(path, data, expectedGeneration) {
    const currentGeneration = expectedGeneration === undefined ? generation : expectedGeneration;
    if (currentGeneration !== generation) throw accountError('operation_canceled', '登录状态已变化，请重试。');
    const result = await request(path, 'POST', data);
    if (currentGeneration !== generation) throw accountError('operation_canceled', '登录状态已变化，请重试。');
    return saveSession(result);
  }
  function requireEmail(email) {
    const value = normalizeEmail(email);
    if (value.length > 254 || !EMAIL_PATTERN.test(value)) throw accountError('invalid_email', '请输入正确的邮箱地址。');
    return value;
  }
  function registrationFields(input) {
    const value = input || {};
    const email = requireEmail(value.email);
    const username = String(value.username || '').trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) throw accountError('invalid_username', '账号需为 4–24 位字母、数字或下划线，且以字母开头。');
    const password = typeof value.password === 'string' ? value.password : '';
    if (password.length < 8 || password.length > 128 || /[\x00-\x1f\x7f]/.test(password)) throw accountError('invalid_password', '密码需为 8–128 位。');
    const code = String(value.code || '').trim();
    if (!CODE_PATTERN.test(code)) throw accountError('invalid_code', '请输入 6 位邮箱验证码。');
    return { email, username, password, code };
  }
  async function authedRequest(path, method, data) {
    const session = readSession();
    if (!session) throw accountError('session_expired', '请先登录。');
    const expected = generation;
    const result = await request(path, method, data, session.token);
    if (expected !== generation || !memorySession || memorySession.token !== session.token) throw accountError('operation_canceled', '账号已变化，本次同步已取消。');
    return result;
  }
  async function wechatAuthentication(session) {
    const currentGeneration = generation;
    const api = platform();
    if (!api || typeof api.login !== 'function') throw accountError('wechat_unavailable', '微信登录暂时不可用，请选择其他方式。');
    const code = await new Promise((resolve, reject) => {
      api.login({ timeout: WECHAT_LOGIN_TIMEOUT, success(result) { result && result.code ? resolve(result.code) : reject(accountError('wechat_login_failed', '未能完成微信登录，请重试。')); },
        fail() { reject(accountError('wechat_login_failed', '未能完成微信登录，请重试。')); } });
    });
    if (currentGeneration !== generation) throw accountError('operation_canceled', '登录状态已变化，请重试。');
    if (!session) return authenticate('/login/wechat', { code }, currentGeneration);
    const result = await request('/bind/wechat', 'POST', { code }, session.token);
    if (currentGeneration !== generation) throw accountError('operation_canceled', '登录状态已变化，请重试。');
    if (!result.user || result.user.id !== session.user.id) throw accountError('invalid_response', '绑定结果暂时无法读取，请重试。');
    return saveSession({ ...result, token: session.token, expiresAt: result.expiresAt === undefined ? session.expiresAt : result.expiresAt }, 'bind');
  }
  const client = {
    flushRevocations,
    getSessionSnapshot() { const session = readSession(); return session ? { user: safeUser(session.user), expiresAt: session.expiresAt } : { user: null, expiresAt: null }; },
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; subscribers.add(listener); return () => subscribers.delete(listener); },
    readSync() { return authedRequest('/sync', 'GET'); },
    writeSync(payload) { return authedRequest('/sync', 'PUT', payload); },
    getCachedUser() { const session = readSession(); return session ? safeUser(session.user) : null; },
    async refreshSession() {
      const session = readSession();
      if (!session) return null;
      if (pendingRefresh && pendingRefresh.token === session.token) return pendingRefresh.promise;
      const token = session.token, currentGeneration = generation;
      const promise = request('/session', 'GET', undefined, token).then(result => {
        if (currentGeneration !== generation) return null;
        return saveSession({ ...result, token }, 'refresh');
      }).catch(error => {
        if (error.status === 401) return null;
        throw error;
      }).finally(() => { if (pendingRefresh && pendingRefresh.promise === promise) pendingRefresh = null; });
      pendingRefresh = { token, promise };
      return promise;
    },
    async sendEmailCode(email, purpose) {
      const normalized = requireEmail(email);
      if (['register', 'login', 'bind'].indexOf(purpose) === -1) throw accountError('invalid_purpose', '请选择正确的验证码用途。');
      const session = purpose === 'bind' ? readSession() : null;
      if (purpose === 'bind' && !session) throw accountError('session_expired', '请先登录后再绑定邮箱。');
      return request('/email/code', 'POST', { email: normalized, purpose }, session && session.token);
    },
    async register(input) { return authenticate('/register', registrationFields(input)); },
    async loginPassword(identifier, password) {
      let value = String(identifier || '').trim();
      if (value.indexOf('@') !== -1) value = requireEmail(value);
      else if (!USERNAME_PATTERN.test(value)) throw accountError('invalid_identifier', '请输入邮箱或 4–24 位账号。');
      else value = value.toLowerCase();
      if (typeof password !== 'string' || !password || password.length > 128) throw accountError('invalid_password', '请输入密码。');
      return authenticate('/login/password', { identifier: value, password });
    },
    async loginEmail(email, code) {
      const value = String(code || '').trim();
      if (!CODE_PATTERN.test(value)) throw accountError('invalid_code', '请输入 6 位邮箱验证码。');
      return authenticate('/login/email', { email: requireEmail(email), code: value });
    },
    async loginWechat() { return wechatAuthentication(readSession()); },
    async bindWechat() {
      const session = readSession();
      if (!session) throw accountError('session_expired', '请先登录后再绑定微信。');
      return wechatAuthentication(session);
    },
    async bindEmail(input) {
      const data = registrationFields(input), session = readSession();
      if (!session) throw accountError('session_expired', '登录已过期，请重新登录。');
      const currentGeneration = generation;
      const result = await request('/bind/email', 'POST', data, session.token);
      if (currentGeneration !== generation) throw accountError('operation_canceled', '登录状态已变化，请重试。');
      return saveSession({ ...result, token: result.token || session.token, expiresAt: result.expiresAt === undefined ? session.expiresAt : result.expiresAt });
    },
    async logout() {
      const session = readSession();
      // Queue revocation before ending this device's session. Retrying an old
      // token never changes a newer login, and tokens never enter UI snapshots.
      let queueError;
      if (session) { try { enqueueRevocation(session.token); } catch (error) { queueError = error; } }
      clearSession();
      if (session) { await revoke(session.token); if (queueError) throw queueError; }
      return { ok: true };
    }
  };
  return client;
}

module.exports = Object.assign(createAccountClient(), { createAccountClient, STORAGE_KEY, REVOCATIONS_KEY, REQUEST_TIMEOUT, WECHAT_LOGIN_TIMEOUT, normalizeEmail, expiryTime });
