'use strict';
// Shared Brclio accounts. Brclio · CC BY-NC-SA 4.0.
const API_ORIGIN = 'https://pocket.bornforthis.cn';
const SESSION_KEY = 'brclio.shared-account.v1';
const HISTORY_KEY = 'brclio.duel.v1';
const RESTORE_KEY = 'brclio.duel.before-restore.v1';
const ROUTES = { session: ['GET'], code: ['POST'], register: ['POST'], login: ['POST'], logout: ['POST'],
  profile: ['PUT'], password: ['POST'], 'apps/miniapp/data': ['GET', 'PUT'] };
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const tokenValid = token => typeof token === 'string' && /^[\x21-\x7e]{16,4096}$/.test(token);
function failure(message, status) { const error = new Error(message); error.status = status; return error; }
function validateDuel(value) {
  if (!object(value) || !object(value.preferences) || !Array.isArray(value.matches) || value.matches.length > 20) throw failure('挑战数据格式不兼容，已保留原数据。');
  const preferences = value.preferences;
  if (![1, 3, 5].includes(preferences.targetScore) || typeof preferences.haptics !== 'boolean' || !Array.isArray(preferences.names) || preferences.names.length !== 2 ||
    !preferences.names.every(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 16 && !/[\u0000-\u001f\u007f]/.test(name))) throw failure('挑战偏好格式不兼容，已保留原数据。');
  const ids = new Set();
  for (const match of value.matches) {
    if (!object(match) || typeof match.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(match.id) || ids.has(match.id) ||
      !Number.isSafeInteger(match.at) || match.at < 1577836800000 || ![0, 1].includes(match.winner) || !Array.isArray(match.scores) || match.scores.length !== 2 ||
      !match.scores.every(score => Number.isInteger(score) && score >= 0 && score <= 5) || ![1, 3, 5].includes(match.scores[match.winner]) || match.scores[1 - match.winner] >= match.scores[match.winner] ||
      !(match.bestMs === null || Number.isFinite(match.bestMs) && match.bestMs >= 0 && match.bestMs <= 5000) || !Array.isArray(match.names) || match.names.length !== 2 ||
      !match.names.every(name => typeof name === 'string' && name.length > 0 && name.length <= 16)) throw failure('对局记录格式不兼容，已保留原数据。');
    ids.add(match.id);
  }
  return clone(value);
}
function createAccountClient(api) {
  const pending = new Set();
  let disposed = false, invalidated = false, version = 0, state;
  function readState() {
    const stored = api.getStorageSync(SESSION_KEY);
    const generation = object(stored) && Number.isSafeInteger(stored.generation) && stored.generation >= 0 ? stored.generation : 0;
    const session = object(stored) && tokenValid(stored.token) && object(stored.user) && typeof stored.user.id === 'string' ? { token: stored.token, user: clone(stored.user) } : null;
    return { generation, session };
  }
  try { state = readState(); } catch (_) { state = null; }
  function signature(value) { return value && JSON.stringify([value.generation, value.session && value.session.token, value.session && value.session.user.id]); }
  function changed() { return failure('账号已变化或页面已关闭，请重新打开账号页面。'); }
  function assertCurrent(expected = state, expectedVersion = version) {
    if (disposed || invalidated || expectedVersion !== version) throw changed();
    if (!expected) throw failure('无法读取本机账号缓存，请稍后重试。');
    if (signature(readState()) !== signature(expected)) { invalidated = true; version += 1; throw changed(); }
    return expected;
  }
  function currentUser() {
    try { assertCurrent(); return state.session ? clone(state.session.user) : null; } catch (_) { return null; }
  }
  function persist(session, expected, expectedVersion) {
    assertCurrent(expected, expectedVersion);
    if (expected.generation >= Number.MAX_SAFE_INTEGER) throw failure('账号缓存版本已满，请联系维护者。');
    // Keep the generation tombstone after logout so a late anonymous login
    // cannot mistake login-then-logout for the original empty storage state.
    const next = { version: 1, generation: expected.generation + 1, token: session ? session.token : null, user: session ? clone(session.user) : null };
    api.setStorageSync(SESSION_KEY, next);
    state = { generation: next.generation, session: session ? { token: next.token, user: next.user } : null }; version += 1;
  }
  async function request(route, method = 'GET', body) {
    const expected = assertCurrent(), started = version;
    if (!Object.prototype.hasOwnProperty.call(ROUTES, route) || !ROUTES[route].includes(method)) throw failure('账号请求无效');
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    if (bodyText.length > 32000) throw failure('同步数据过大，已保留本机数据。');
    return new Promise((resolve, reject) => {
      const operation = { task: null, settled: false };
      function finish(error, value) { if (operation.settled) return; operation.settled = true; pending.delete(operation); if (error) reject(error); else resolve(value); }
      operation.cancel = () => finish(changed()); pending.add(operation);
      try { operation.task = api.request({ url: API_ORIGIN + '/api/account/' + route, method, data: body,
        timeout: 30000, enableCache: false, header: { Accept: 'application/json', 'X-Brclio-Client': 'native',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(expected.session ? { Authorization: 'Bearer ' + expected.session.token } : {}) },
        success(response) {
          if (operation.settled) return;
          try { assertCurrent(expected, started); } catch (error) { finish(error); return; }
          const value = response.data;
          if (!object(value) || JSON.stringify(value).length > 131072) return finish(failure('账号服务响应无效。'));
          if (response.statusCode < 200 || response.statusCode >= 300) {
            if (response.statusCode === 401 && route === 'apps/miniapp/data' && expected.session) { try { persist(null, expected, started); } catch (_) {} }
            return finish(failure(typeof value.error === 'string' ? value.error.slice(0, 300) : '账号操作失败，请重试。', response.statusCode));
          }
          finish(null, value);
        },
        fail() { finish(failure('暂时无法连接账号服务，本机记录已保留。')); }
      }); } catch (_) { finish(failure('账号请求未完成，本机记录已保留。')); }
    });
  }
  async function signIn(route, input) {
    const expected = assertCurrent(), started = version;
    const value = await request(route, 'POST', input);
    if (!tokenValid(value.token) || !object(value.user) || typeof value.user.id !== 'string') throw failure('账号会话响应无效。');
    persist({ token: value.token, user: value.user }, expected, started);
    return currentUser();
  }
  async function refresh() {
    const expected = assertCurrent(), started = version;
    const value = await request('session');
    assertCurrent(expected, started);
    if (!value.user) { if (expected.session) persist(null, expected, started); return value; }
    if (!object(value.user) || !expected.session || value.user.id !== expected.session.user.id) throw failure('账号会话不一致，请重新登录。');
    persist({ token: expected.session.token, user: value.user }, expected, started); return value;
  }
  async function logout() {
    const expected = assertCurrent(), started = version;
    try { if (expected.session) await request('logout', 'POST', {}); }
    finally {
      // A closed page or another client's new login must win over this finally.
      if (!disposed && !invalidated) {
        let current = false;
        try { assertCurrent(expected, started); current = true; } catch (_) {}
        if (current) persist(null, expected, started);
      }
    }
  }
  async function loadCloud() {
    const expected = assertCurrent(), started = version, owner = currentUser(); if (!owner) throw failure('请先登录账号。');
    const value = await request('apps/miniapp/data');
    assertCurrent(expected, started);
    if (value.userId !== owner.id || value.appId !== 'miniapp' || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !object(value.data)) throw failure('云端数据不兼容，已保留本机数据。');
    return value;
  }
  function rawLocal() {
    const value = api.getStorageSync(HISTORY_KEY);
    if (value !== '' && value !== null && value !== undefined && !object(value)) throw failure('本机数据格式不兼容，已保留原数据。');
    return value || {};
  }
  function localSnapshot() {
    const raw = rawLocal();
    return validateDuel({ preferences: { targetScore: raw.targetScore === undefined ? 3 : raw.targetScore, haptics: raw.haptics === undefined ? true : raw.haptics,
      names: raw.names === undefined ? ['红方', '蓝方'] : raw.names }, matches: raw.matches === undefined ? [] : raw.matches });
  }
  async function backup(cloud, local) {
    const expected = assertCurrent(), started = version;
    if (!expected.session || cloud.userId !== expected.session.user.id || cloud.appId !== 'miniapp' || cloud.version !== 1 || !Number.isSafeInteger(cloud.revision) || cloud.revision < 0 || !object(cloud.data)) throw failure('账号或云端版本已变化，请重新读取云端。');
    if (JSON.stringify(localSnapshot()) !== JSON.stringify(local)) throw failure('本机记录已变化，请重新预览再备份。');
    const existing = object(cloud.data.duel) ? cloud.data.duel : {};
    const duel = { ...existing, preferences: { ...(object(existing.preferences) ? existing.preferences : {}), ...local.preferences }, matches: local.matches };
    const data = { ...cloud.data, duel };
    // The shared API measures UTF-8 bytes, including Chinese player names.
    let bytes = 0;
    for (const char of JSON.stringify(data)) { const point = char.codePointAt(0); bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; }
    if (bytes > 12000) throw failure('备份超过 12000 字节，本机与云端数据均已保留。');
    const saved = await request('apps/miniapp/data', 'PUT', { revision: cloud.revision, data });
    assertCurrent(expected, started);
    if (saved.userId !== expected.session.user.id || saved.appId !== 'miniapp' || saved.version !== 1 || saved.revision !== cloud.revision + 1 || !object(saved.data)) throw failure('备份响应不兼容，请重新读取云端核对；本机数据已保留。');
    return saved;
  }
  async function restore(cloud, local) {
    const expected = assertCurrent(), started = version;
    const latest = await loadCloud();
    assertCurrent(expected, started);
    if (latest.userId !== cloud.userId || latest.revision !== cloud.revision) throw failure('云端已更新，请重新读取和预览。', 409);
    if (JSON.stringify(localSnapshot()) !== JSON.stringify(local)) throw failure('本机记录已变化，请重新预览再恢复。');
    const duel = validateDuel(cloud.data.duel), previous = clone(rawLocal());
    const next = { ...previous, targetScore: duel.preferences.targetScore, haptics: duel.preferences.haptics, names: duel.preferences.names, matches: duel.matches };
    // Preserve a complete local recovery copy before replacing only known game fields.
    api.setStorageSync(RESTORE_KEY, { userId: cloud.userId, savedAt: Date.now(), data: previous });
    api.setStorageSync(HISTORY_KEY, next);
    return duel;
  }
  function dispose() {
    if (disposed) return; disposed = true; version += 1;
    for (const operation of Array.from(pending)) { operation.cancel(); try { if (operation.task && typeof operation.task.abort === 'function') operation.task.abort(); } catch (_) {} }
  }
  return { currentUser, request, refresh, login: input => signIn('login', input), register: input => signIn('register', input), logout, loadCloud, localSnapshot, backup, restore, dispose };
}
module.exports = { createAccountClient, validateDuel, SESSION_KEY, HISTORY_KEY, RESTORE_KEY, API_ORIGIN };
