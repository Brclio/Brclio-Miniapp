'use strict';

// Browser-only bridge around the same account and sync controllers as native.
const { createAccountClient, STORAGE_KEY, REVOCATIONS_KEY, REQUEST_TIMEOUT } = require('../miniprogram/lib/account');
const { createAccountSync, DATA_PREFIX, META_PREFIX, CLAIM_KEY } = require('../miniprogram/lib/account-sync');
const { createHistorySnapshot } = require('./account-history-snapshot');
const avatars = require('./avatar-browser');
const schema = require('../miniprogram/lib/account-sync-schema');
const API_ROUTES = new Set(['/email/code', '/register', '/login/password', '/login/email', '/login/wechat', '/session', '/logout', '/bind/email', '/data', '/sync', '/avatar']);
const BOOT_WAIT = 1800;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const logicalStringKeys = new Set(['RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME', 'RGD_CUSTOM_REWARDS', ...schema.JSON_KEYS]);
const booleanKeys = new Set(['RGD_SOUND_ENABLED', 'lingotiles.native.reduce-motion.v1']);
const numberKeys = new Set(['RGD_MAX_WAIT', 'RGD_TITLE_TS', 'RGD_CUSTOM_TS', 'RGD_LOCAL_VISITS']);
const safeMessages = {
  rate_limited: '操作较频繁，请稍后再试。', code_cooldown: '验证码已发送，请稍后再试。',
  code_invalid: '验证码错误或已过期，请重新获取。', invalid_credentials: '账号或密码不正确。',
  email_taken: '该邮箱已注册，请直接登录。', username_taken: '该账号已被使用，请更换。',
  email_already_bound: '当前账号已绑定邮箱。', unauthorized: '登录已失效，请重新登录。',
  sync_conflict: '云端数据已更新，请重新读取后同步。', data_conflict: '云端数据已更新，请重新读取。',
  invalid_email: '请输入有效的邮箱地址。', invalid_username: '请输入正确的账号。',
  invalid_password: '请输入有效的密码。', invalid_code: '请输入 6 位邮箱验证码。',
  body_too_large: '请求内容较大，请减少单次内容。', sync_data_too_large: '同步数据较大，请减少单次同步内容。',
  invalid_avatar: '头像图片无效，请重新选择。', avatar_too_large: '原图须不超过 10 MB，展示图须不超过 128 KB。'
};
function storageError() { const error = new Error('本机记录暂不可读取或保存，原有数据已保留。'); error.code = 'storage_unavailable'; return error; }
function logicalKey(key) {
  if (!key.startsWith(DATA_PREFIX)) return key;
  const separator = key.indexOf(':', DATA_PREFIX.length);
  return separator < 0 ? key : key.slice(separator + 1);
}
function physicalKey(key) { return key === 'brclio.duel.v1' ? 'brclio-minigame:' + key : key; }
function samePrincipal(first, second) {
  function principal(raw) {
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      if (value && typeof value.token === 'string' && typeof value.user?.id === 'string') return { token: value.token, id: value.user.id };
    } catch (_) {}
    return undefined;
  }
  const a = principal(first), b = principal(second);
  return a !== undefined && b !== undefined && (a === null && b === null || a && b && a.id === b.id && a.token === b.token);
}
function errorBody(value, status) {
  const error = value && /^[a-z][a-z0-9_]{0,79}$/.test(value.error || '') ? value.error : 'request_failed';
  const message = safeMessages[error] || (status === 401 ? '登录已失效，请重新登录。' : status === 400 ? '请求内容格式错误，请检查后重试。' : '账号服务暂不可用，请稍后重试。');
  const retryAfter = Number(value?.retryAfter);
  return { error, message, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter: Math.min(86400, Math.ceil(retryAfter)) } : {}) };
}

function createBrowserAccount(host, options = {}) {
  if (!host || !host.document || !host.location) throw new Error('Browser environment required');
  const page = host.document;
  const origin = host.location.origin;
  const setTimer = options.setTimeout || host.setTimeout.bind(host);
  const clearTimer = options.clearTimeout || host.clearTimeout.bind(host);
  const fetchImpl = options.fetchImpl || (host.fetch && host.fetch.bind(host));
  const unreadable = new Set(), controllers = new Map(), waits = new Set(), listeners = new Set();
  let destroyed = false, changingAccount = false, moduleStarted = false, modulePromise;
  const local = () => options.localStorage || host.localStorage;
  const visible = () => !page.hidden && page.visibilityState !== 'hidden';
  const isPortal = options.portal === undefined ? /^\/(?:index\.html)?$/.test(host.location.pathname) : !!options.portal;
  const now = options.now || Date.now;
  let account, sync, currentUserId, knownSessionRaw, preparationGeneration = 0;
  try { knownSessionRaw = local().getItem(STORAGE_KEY); } catch (_) { knownSessionRaw = undefined; }

  const shim = {
    getStorageSync(key) {
      if (changingAccount || destroyed) throw storageError();
      key = String(key);
      try {
        const raw = local().getItem(physicalKey(key));
        if (raw === null) { unreadable.delete(key); return undefined; }
        const logical = logicalKey(key);
        let value;
        if (schema.JSON_KEYS.includes(logical)) {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw storageError();
          value = raw;
        } else if (logicalStringKeys.has(logical)) value = raw;
        else if (booleanKeys.has(logical)) {
          value = JSON.parse(raw);
          if (typeof value !== 'boolean') throw storageError();
        } else if (numberKeys.has(logical)) {
          value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || logical === 'RGD_MAX_WAIT' && (value < 3 || value > 10)) throw storageError();
        } else if (logical === 'brclio.duel.v1' || logical === schema.HISTORY_KEY || key === STORAGE_KEY || key === REVOCATIONS_KEY || key.startsWith(META_PREFIX) || key.endsWith('guest-owner.v1')) {
          value = JSON.parse(raw);
          if (logical === schema.HISTORY_KEY || key === REVOCATIONS_KEY) { if (!Array.isArray(value)) throw storageError(); }
          else if (!value || typeof value !== 'object' || Array.isArray(value)) throw storageError();
          if (key.startsWith(META_PREFIX) && value.schemaVersion !== 1) throw storageError();
          if (key.endsWith('guest-owner.v1') && typeof value.userId !== 'string') throw storageError();
        }
        else {
          try { value = JSON.parse(raw); } catch (_) { value = raw; }
        }
        unreadable.delete(key);
        return value;
      } catch (_) { unreadable.add(key); throw storageError(); }
    },
    setStorageSync(key, value) {
      key = String(key);
      if (unreadable.has(key) || changingAccount || destroyed) throw storageError();
      try {
        const encoded = typeof value === 'string' ? value : JSON.stringify(value);
        if (encoded === undefined) throw storageError();
        local().setItem(physicalKey(key), encoded);
        if (key === STORAGE_KEY) knownSessionRaw = encoded;
      } catch (_) { throw storageError(); }
    },
    removeStorageSync(key) {
      key = String(key);
      if (unreadable.has(key) || changingAccount || destroyed) throw storageError();
      try { local().removeItem(physicalKey(key)); if (key === STORAGE_KEY) knownSessionRaw = null; } catch (_) { throw storageError(); }
    },
    request(settings) {
      const request = settings || {};
      let url;
      try {
        url = new URL(request.url, origin);
        const route = url.pathname.slice('/api/account'.length);
        if (url.origin !== origin || url.protocol !== 'https:' || !url.pathname.startsWith('/api/account/') || !API_ROUTES.has(route) || url.search || url.hash || url.username || url.password || !fetchImpl || destroyed || changingAccount) throw new Error();
      } catch (_) { request.fail?.({ errMsg: 'request:fail' }); return { abort() {} }; }
      const controller = new (options.AbortController || host.AbortController || AbortController)();
      const timeout = Math.min(REQUEST_TIMEOUT, Math.max(1, Number(request.timeout) || REQUEST_TIMEOUT));
      let completed = false;
      const finish = (type, value) => {
        if (completed) return;
        completed = true; clearTimer(timer); controllers.delete(controller);
        request[type]?.(value);
        request.complete?.(value);
      };
      const timer = setTimer(() => { controller.abort(); finish('fail', { errMsg: 'request:fail' }); }, timeout);
      controllers.set(controller, () => { controller.abort(); finish('fail', { errMsg: 'request:fail' }); });
      const headers = { 'Content-Type': 'application/json' };
      if (url.pathname === '/api/account/sync' && request.header?.['X-Brclio-Sync-Version'] === '2') headers['X-Brclio-Sync-Version'] = '2';
      const authorization = request.header?.Authorization;
      if (authorization) {
        if (typeof authorization !== 'string' || authorization.length > 600 || /[\r\n]/.test(authorization)) { finish('fail', { errMsg: 'request:fail' }); return { abort() {} }; }
        headers.Authorization = authorization;
      }
      Promise.resolve().then(() => fetchImpl(url.href, {
        method: request.method || 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers, ...(request.data === undefined ? {} : { body: JSON.stringify(request.data) })
      })).then(async response => {
        if (response.redirected || response.status < 100 || response.status > 599 || Number(response.headers?.get('Content-Length')) > MAX_RESPONSE_BYTES) throw new Error();
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) throw new Error();
        let data;
        try { data = JSON.parse(text); } catch (_) { throw new Error(); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
        finish('success', { statusCode: response.status, data: response.status >= 200 && response.status < 300 ? data : errorBody(data, response.status) });
      }).catch(() => finish('fail', { errMsg: 'request:fail' }));
      return { abort() { controller.abort(); finish('fail', { errMsg: 'request:fail' }); } };
    }
  };
  account = createAccountClient({ wx: shim, config: { accountBase: origin + '/api/account' }, now });
  sync = createAccountSync({ wx: shim, account, now, setTimeout: setTimer, clearTimeout: clearTimer, ...(options.throttleMs === undefined ? {} : { throttleMs: options.throttleMs }) });
  currentUserId = account.getCachedUser()?.id || null;
  const snapshotHistory = createHistorySnapshot({
    window: host, storage: { getItem: key => local().getItem(key), setItem: (key, value) => local().setItem(key, value) },
    getGuestOwner() {
      if (destroyed || changingAccount) throw storageError();
      const raw = local().getItem(CLAIM_KEY);
      if (raw === null) return null;
      const value = JSON.parse(raw);
      if (!value || typeof value.userId !== 'string' || !value.userId) throw storageError();
      return value.userId;
    },
    getPrincipal() { if (destroyed || changingAccount) throw storageError(); return JSON.stringify([preparationGeneration, local().getItem(STORAGE_KEY)]); },
    timeoutMs: 900, setTimeout: setTimer, clearTimeout: clearTimer
  });
  // Cached first logins must freeze the old guest IDs before any lifecycle
  // entry activates the native claim. This delay shares the module boot budget.
  let historyPending = !!currentUserId, hydrationBarrier = 0;
  const historyReady = historyPending ? Promise.resolve(snapshotHistory()).catch(() => false).finally(() => { historyPending = false; }) : Promise.resolve(false);
  for (const name of ['activate', 'onShow', 'onHide', 'flush']) {
    const original = sync[name];
    sync[name] = function (...args) {
      if (name === 'onHide') hydrationBarrier += 1;
      if (!historyPending) return original.apply(sync, args);
      const barrier = hydrationBarrier;
      return historyReady.then(() => {
        if (destroyed || changingAccount) return sync.getStatus();
        if ((name === 'activate' || name === 'onShow') && (barrier !== hydrationBarrier || !visible())) args[0] = { ...args[0], pull: false };
        return original.apply(sync, args);
      });
    };
  }
  const networkChanged = sync.networkChanged;
  sync.networkChanged = function (value) {
    const connected = typeof value === 'boolean' ? value : !!value?.isConnected;
    if (!historyPending || !connected) return networkChanged.call(sync, value);
    void historyReady.then(() => { if (!destroyed && !changingAccount) networkChanged.call(sync, value); });
    return sync.getStatus();
  };
  for (const name of ['register', 'loginPassword', 'loginEmail']) {
    const original = account[name];
    account[name] = async function (...args) {
      const generation = preparationGeneration;
      let principal, readable = false;
      try { principal = local().getItem(STORAGE_KEY); readable = true; } catch (_) {}
      try { await snapshotHistory(); } catch (_) { /* History access never prevents authentication. */ }
      let unchanged = true;
      if (readable) { try { unchanged = samePrincipal(principal, local().getItem(STORAGE_KEY)); } catch (_) {} }
      if (destroyed || changingAccount || generation !== preparationGeneration || !unchanged) {
        const error = new Error('登录状态已变化，请重试。'); error.code = 'operation_canceled'; throw error;
      }
      return original.apply(account, args);
    };
  }

  function stopAndReload() {
    if (changingAccount || destroyed) return;
    changingAccount = true;
    sync.destroy();
    for (const stop of [...controllers.values()]) stop();
    if (options.reload) options.reload();
    else host.location.reload();
  }
  const unsubscribeAccount = account.subscribe(snapshot => {
    if (snapshot.reason !== 'refresh') preparationGeneration += 1;
    const next = snapshot.user?.id || null;
    const changed = next !== currentUserId;
    currentUserId = next;
    for (const listener of listeners) { try { listener(snapshot); } catch (_) {} }
    if (moduleStarted && changed) stopAndReload();
  });
  function bounded(promise, timeoutMs) {
    const delay = Math.min(BOOT_WAIT, Math.max(0, Number(timeoutMs) || BOOT_WAIT));
    return new Promise(resolve => {
      const item = { timer: null, finish: null };
      let done = false;
      item.finish = () => { if (done) return; done = true; clearTimer(item.timer); waits.delete(item); resolve(sync.getStatus()); };
      item.timer = setTimer(item.finish, delay); waits.add(item);
      Promise.resolve(promise).then(item.finish, item.finish);
    });
  }
  function prepare(settings = {}) {
    if (destroyed || changingAccount) return Promise.resolve(sync.getStatus());
    if (moduleStarted) return bounded(sync.flush(), settings.timeoutMs);
    const safe = settings.safe !== false && visible();
    return bounded(safe ? sync.onShow({ pull: true }) : sync.activate({ pull: false }), settings.timeoutMs);
  }
  function startModule(settings = {}) {
    if (modulePromise) return modulePromise;
    const safe = visible();
    modulePromise = bounded(safe ? sync.onShow({ pull: true }) : sync.activate({ pull: false }), settings.timeoutMs).then(() => {
      sync.onHide(); moduleStarted = true;
      return { storage: sync.storage, status: sync.getStatus() };
    });
    return modulePromise;
  }
  function hidden() { if (!visible()) sync.onHide(); else if (!changingAccount && !destroyed) sync.flush(); }
  function online() { sync.networkChanged(true); }
  function offline() { sync.networkChanged(false); }
  function pageHide() { sync.onHide(); }
  function pageShow(event) {
    if (!event.persisted || destroyed || changingAccount) return;
    try { if (!samePrincipal(knownSessionRaw, local().getItem(STORAGE_KEY))) { stopAndReload(); return; } }
    catch (_) { stopAndReload(); return; }
    // Restoring a running game never becomes a new hydration point.
    sync.flush();
  }
  function storageChanged(event) {
    try { if (event.storageArea && event.storageArea !== local()) return; } catch (_) { stopAndReload(); return; }
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    if (event.key === STORAGE_KEY && samePrincipal(event.oldValue, event.newValue)) return;
    stopAndReload();
  }
  host.addEventListener('online', online); host.addEventListener('offline', offline);
  host.addEventListener('pagehide', pageHide); host.addEventListener('pageshow', pageShow); host.addEventListener('storage', storageChanged);
  page.addEventListener('visibilitychange', hidden);
  function destroy() {
    if (destroyed) return;
    sync.destroy(); destroyed = true;
    unsubscribeAccount(); listeners.clear();
    for (const stop of [...controllers.values()]) stop(); controllers.clear();
    for (const item of waits) item.finish();
    host.removeEventListener('online', online); host.removeEventListener('offline', offline);
    host.removeEventListener('pagehide', pageHide); host.removeEventListener('pageshow', pageShow); host.removeEventListener('storage', storageChanged);
    page.removeEventListener('visibilitychange', hidden);
  }
  const runtime = {
    client: account, sync, storage: sync.storage, avatars,
    ready: null, prepare, startModule, prepareModule: startModule,
    getScope: () => sync.getScope(), getGuestOwner: () => sync.getGuestOwner(),
    subscribe: listener => sync.subscribe(listener),
    onAccountChange(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy
  };
  if (host.navigator && host.navigator.onLine === false) sync.networkChanged(false);
  runtime.ready = isPortal ? prepare({ safe: visible(), timeoutMs: options.bootWaitMs }) : startModule({ timeoutMs: options.bootWaitMs });
  return runtime;
}
function installBrowserAccount(host, options) {
  if (host.BrclioAccount) return host.BrclioAccount;
  const runtime = createBrowserAccount(host, options);
  host.BrclioAccount = runtime;
  return runtime;
}
module.exports = { createBrowserAccount, installBrowserAccount, BOOT_WAIT };
if (typeof window !== 'undefined' && window.document) installBrowserAccount(window);
