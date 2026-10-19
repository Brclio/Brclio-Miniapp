(function () {
  'use strict';
  const HISTORY_KEY = 'brclio.duel.v1';
  const SETTINGS_KEY = 'brclio-pocket:cloud-backup-v1';
  const SESSION_KEY = 'brclio-pocket:cloud-session-v1';
  const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
  const API_ORIGIN = window.BrclioConfig && window.BrclioConfig.apiOrigin === 'https://pocket.brclio.com' ? window.BrclioConfig.apiOrigin : '';
  const panel = document.getElementById('cloud-panel');
  const app = document.querySelector('.app-content');
  const button = function (name) { return document.getElementById('cloud-' + name); };
  let settings = readSettings();
  let token = readToken();
  let available = null;
  let busy = false;
  let confirmingDelete = false;
  let pendingUpload = false;
  let uploadTimer = null;
  let cooldownTimer = null;
  let nextWriteAt = settings.updatedAt ? settings.updatedAt + 10000 : 0;
  let remoteCount = null;
  let notice = '';
  let localVersion = 0;
  let observedIds = new Set(localMatches().map(function (match) { return match.id; }));

  function readSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { enabled: value.enabled === true, updatedAt: Number.isSafeInteger(value.updatedAt) && value.updatedAt > 0 ? value.updatedAt : null };
    } catch (_) { return { enabled: false, updatedAt: null }; }
  }
  function readToken() {
    try { const value = localStorage.getItem(SESSION_KEY) || ''; return TOKEN_PATTERN.test(value) ? value : ''; }
    catch (_) { return ''; }
  }
  function saveSettings(patch) {
    const next = Object.assign({}, settings, patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); }
    catch (_) { throw new Error('storage_unavailable'); }
    settings = next;
  }

  // Restrict outgoing data to the backend's saved-match schema.
  function validMatches(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const now = Date.now();
    return input.filter(function (match) {
      if (!match || typeof match.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(match.id) || seen.has(match.id) ||
        !Number.isSafeInteger(match.at) || match.at < 1577836800000 || match.at > now + 300000 ||
        ![0, 1].includes(match.winner) || !Array.isArray(match.scores) || match.scores.length !== 2 ||
        !match.scores.every(function (score) { return Number.isInteger(score) && score >= 0 && score <= 5; }) ||
        ![1, 3, 5].includes(match.scores[match.winner]) || match.scores[1 - match.winner] >= match.scores[match.winner] ||
        !(match.bestMs === null || Number.isFinite(match.bestMs) && match.bestMs >= 0 && match.bestMs <= 5000) ||
        !Array.isArray(match.names) || match.names.length !== 2 ||
        !match.names.every(function (name) { return typeof name === 'string' && name.trim().length > 0 && name.length <= 16 && !/[\u0000-\u001f\u007f]/.test(name); })) return false;
      seen.add(match.id);
      return true;
    }).map(function (match) {
      return { id: match.id, at: match.at, names: match.names.map(function (name) { return name.trim(); }), winner: match.winner, scores: match.scores.slice(), bestMs: match.bestMs };
    }).sort(function (a, b) { return b.at - a.at || a.id.localeCompare(b.id); }).slice(0, 20);
  }
  function localValue() { const value = window.BrclioStorage.read(HISTORY_KEY); return value && typeof value === 'object' ? value : {}; }
  function localMatches() { return validMatches(localValue().matches); }
  function mergeMatches(local, remote) {
    const byId = new Map(local.map(function (match) { return [match.id, match]; }));
    // Saved IDs are immutable; the existing server record takes precedence.
    remote.forEach(function (match) { byId.set(match.id, match); });
    return validMatches(Array.from(byId.values()));
  }
  function dateLabel(value) {
    return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function setNotice(message) { notice = message; render(); }

  function render() {
    const cooling = Date.now() < nextWriteAt;
    button('open').textContent = settings.enabled ? '云备份 ●' : '云备份 ○';
    document.getElementById('cloud-toolbar-status').textContent = settings.enabled ? pendingUpload ? '新记录待备份' : '云备份已开启' : '记录仅存本机';
    document.getElementById('cloud-state').textContent = notice || (settings.enabled ? '云备份已开启，新增对决将自动备份。' : '默认关闭，记录只保存在本机。');
    document.getElementById('cloud-summary').textContent = settings.updatedAt
      ? '最近备份 ' + dateLabel(settings.updatedAt) + (remoteCount === null ? '' : ' · 云端 ' + remoteCount + ' 场') + ' · 最多保留 20 场'
      : '备份最近 20 场完整对决，不上传赛制和触感设置。';
    document.getElementById('cloud-consent-row').hidden = settings.enabled;
    button('enable').hidden = settings.enabled;
    button('enable').disabled = busy || confirmingDelete || !button('consent').checked || available === false;
    button('disable').hidden = !settings.enabled;
    button('disable').disabled = busy || confirmingDelete;
    button('now').hidden = !settings.enabled;
    button('now').disabled = busy || confirmingDelete || cooling;
    button('now').textContent = cooling ? '稍后可备份' : '立即备份';
    button('recheck').disabled = busy || confirmingDelete;
    button('delete').hidden = !token;
    button('delete').disabled = busy || confirmingDelete;
    button('delete-confirm').hidden = !confirmingDelete;
    button('delete-cancel').disabled = busy;
    button('delete-accept').disabled = busy;
    button('consent').disabled = busy;
    clearTimeout(cooldownTimer);
    if (cooling) cooldownTimer = setTimeout(render, Math.min(nextWriteAt - Date.now() + 20, 300000));
  }

  async function request(path, options, timeout) {
    const opts = options || {};
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeout || 3000);
    const headers = { Accept: 'application/json' };
    if (opts.auth) headers.Authorization = 'Bearer ' + token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(API_ORIGIN + path, { method: opts.method || 'GET', headers: headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'same-origin' });
      if (!response.ok) {
        const error = new Error('cloud_request_failed');
        error.status = response.status;
        const seconds = Number(response.headers.get('Retry-After'));
        error.retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) * 1000 : 60000;
        throw error;
      }
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  function handleError(error) {
    if (error && error.status === 401) {
      try { saveSettings({ enabled: false }); localStorage.removeItem(SESSION_KEY); } catch (_) { settings.enabled = false; }
      token = '';
      pendingUpload = false;
      clearTimeout(uploadTimer);
      setNotice('设备凭据已失效。重新开启会建立新的匿名备份。');
    } else if (error && error.status === 429) {
      nextWriteAt = Date.now() + error.retryAfter;
      setNotice('请求较频繁，请稍后再试；本机记录已保留。');
      if (settings.enabled && pendingUpload) queueUpload();
    } else if (error && error.message === 'storage_unavailable') {
      setNotice('无法保存设备凭据，请检查浏览器存储设置后重试。');
    } else if (error && error.status === 503) {
      available = false;
      setNotice('云备份暂未开放，可以继续使用本机记录。');
    } else {
      setNotice('暂时无法连接云端，本机记录不受影响。可稍后重试。');
    }
  }

  function run(action) {
    if (busy) return;
    busy = true;
    render();
    let failed = false;
    Promise.resolve().then(action).catch(function (error) { failed = true; handleError(error); }).finally(function () { busy = false; render(); if (!failed && settings.enabled && pendingUpload && Date.now() >= nextWriteAt) queueUpload(); });
  }

  async function checkAvailability() {
    const result = await request('/api/health');
    available = result.syncAvailable === true;
    if (!available) setNotice('云备份暂未开放，可以继续使用本机记录。');
    else if (!settings.enabled) setNotice('云端连接正常；勾选说明后，可开启匿名备份。');
    else setNotice('云端连接正常，云备份已开启。');
    return available;
  }

  async function ensureSession() {
    if (token) return;
    const result = await request('/api/v1/session', { method: 'POST', body: {} });
    if (!TOKEN_PATTERN.test(result.token || '')) throw new Error('invalid_session_response');
    try { localStorage.setItem(SESSION_KEY, result.token); }
    catch (_) { throw new Error('storage_unavailable'); }
    token = result.token;
  }

  async function restore(timeout) {
    const version = localVersion;
    const result = await request('/api/v1/history', { auth: true }, timeout);
    if (!settings.enabled || version !== localVersion) return;
    const remote = validMatches(result.matches);
    const current = localValue();
    const local = validMatches(current.matches);
    const matches = mergeMatches(local, remote);
    window.BrclioStorage.hydrate(HISTORY_KEY, Object.assign({}, current, { matches: matches }));
    observedIds = new Set(matches.map(function (match) { return match.id; }));
    remoteCount = remote.length;
    const remoteIds = new Set(remote.map(function (match) { return match.id; }));
    pendingUpload = matches.some(function (match) { return !remoteIds.has(match.id); });
    saveSettings({ updatedAt: Number.isSafeInteger(result.updatedAt) && result.updatedAt > 0 ? result.updatedAt : null });
    if (settings.updatedAt) nextWriteAt = Math.max(nextWriteAt, settings.updatedAt + 10000);
    setNotice(remote.length ? '已合并云端记录，新增对决将自动备份。' : '云备份已开启，云端还没有当前记录。');
  }

  async function upload() {
    if (!settings.enabled || confirmingDelete || !token) return;
    if (Date.now() < nextWriteAt) { pendingUpload = true; queueUpload(); return; }
    const matches = localMatches();
    if (!matches.length) { pendingUpload = false; setNotice('本机暂无完整对决，完成一场后即可备份。'); return; }
    const version = localVersion;
    const result = await request('/api/v1/history', { method: 'POST', auth: true, body: { matches: matches } });
    // An upload response must never repopulate history the user just cleared.
    if (!settings.enabled) return;
    pendingUpload = version !== localVersion && localMatches().length > 0;
    remoteCount = validMatches(result.matches).length;
    const updatedAt = Number.isSafeInteger(result.updatedAt) && result.updatedAt > 0 ? result.updatedAt : Date.now();
    saveSettings({ updatedAt: updatedAt });
    nextWriteAt = Date.now() + 10000;
    setNotice('备份完成，云端保留最近 ' + remoteCount + ' 场完整对决。');
  }

  function queueUpload() {
    clearTimeout(uploadTimer);
    if (!settings.enabled || !pendingUpload || confirmingDelete) return;
    uploadTimer = setTimeout(function () {
      uploadTimer = null;
      if (!settings.enabled || !pendingUpload || confirmingDelete) return;
      if (busy) { queueUpload(); return; }
      run(upload);
    }, Math.max(1200, nextWriteAt - Date.now()));
    render();
  }

  async function enable() {
    if (!button('consent').checked) return;
    setNotice('正在检查云端连接…');
    if (!await checkAvailability()) return;
    await ensureSession();
    saveSettings({ enabled: true });
    await restore();
    if (pendingUpload) await upload();
  }

  function disable() {
    saveSettings({ enabled: false });
    clearTimeout(uploadTimer);
    pendingUpload = false;
    button('consent').checked = false;
    setNotice('已关闭云备份，后续记录仅保存在本机。已有云端记录仍保留。');
  }

  async function removeCurrent() {
    if (!confirmingDelete || !token) return;
    setNotice('正在移除云端当前记录…');
    const result = await request('/api/v1/history', { method: 'DELETE', auth: true });
    if (result.deleted !== true) throw new Error('invalid_delete_response');
    // Retain the device capability so no new identity is silently created.
    saveSettings({ enabled: false, updatedAt: null });
    confirmingDelete = false;
    pendingUpload = false;
    remoteCount = 0;
    nextWriteAt = 0;
    clearTimeout(uploadTimer);
    button('consent').checked = false;
    setNotice('云端当前记录已移除，云备份已关闭；本机战绩与 Git 提交历史仍保留。');
  }

  function changed(value) {
    const matches = validMatches(value && value.matches);
    const ids = new Set(matches.map(function (match) { return match.id; }));
    const added = matches.some(function (match) { return !observedIds.has(match.id); });
    const altered = ids.size !== observedIds.size || added;
    observedIds = ids;
    if (!altered) return; // Preferences and repeat writes never trigger a backup.
    localVersion += 1;
    if (!matches.length) {
      pendingUpload = false;
      clearTimeout(uploadTimer);
      if (settings.enabled) setNotice('本机战绩已清除；已有云端记录仍保留，可在下方单独移除。');
      return;
    }
    if (settings.enabled && added) { pendingUpload = true; queueUpload(); }
  }

  function openPanel() {
    panel.hidden = false;
    app.inert = true;
    button('open').setAttribute('aria-expanded', 'true');
    window.BrclioRuntime.suspend();
    render();
    button('close').focus();
    if (!busy) run(checkAvailability);
  }
  function closePanel() {
    if (busy) { setNotice('正在处理，请稍等片刻再关闭。'); return; }
    confirmingDelete = false;
    panel.hidden = true;
    app.inert = false;
    button('open').setAttribute('aria-expanded', 'false');
    window.BrclioRuntime.resume();
    button('open').focus({ preventScroll: true });
    if (pendingUpload) queueUpload();
  }

  button('open').addEventListener('click', openPanel);
  button('close').addEventListener('click', closePanel);
  button('consent').addEventListener('change', render);
  button('enable').addEventListener('click', function () { run(enable); });
  button('disable').addEventListener('click', function () { run(disable); });
  button('now').addEventListener('click', function () { run(upload); });
  button('recheck').addEventListener('click', function () { run(checkAvailability); });
  button('delete').addEventListener('click', function () { confirmingDelete = true; clearTimeout(uploadTimer); render(); button('delete-accept').focus(); });
  button('delete-cancel').addEventListener('click', function () { confirmingDelete = false; render(); if (pendingUpload) queueUpload(); button('delete').focus(); });
  button('delete-accept').addEventListener('click', function () { run(removeCurrent); });
  document.addEventListener('keydown', function (event) {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
    if (event.key === 'Tab') {
      const focusable = Array.from(panel.querySelectorAll('button,input')).filter(function (node) { return !node.disabled && node.getClientRects().length; });
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('brclio:storage-write', function (event) { if (event.detail && event.detail.key === HISTORY_KEY) changed(event.detail.value); });
  window.addEventListener('storage', function (event) {
    if (event.key === 'brclio-minigame:' + HISTORY_KEY) changed(localValue());
    if (event.key === SETTINGS_KEY || event.key === SESSION_KEY) {
      settings = readSettings(); token = readToken();
      if (!settings.enabled) { pendingUpload = false; clearTimeout(uploadTimer); }
      render();
    }
  });
  window.addEventListener('online', function () { if (settings.enabled && pendingUpload) queueUpload(); });

  render();
  // Default OFF makes no session or history request. Existing opt-in restores
  // within 2.8 seconds before the shared core boots, never during a live round.
  window.__brclioBootstrap = (async function () {
    if (!settings.enabled) return;
    if (!token) {
      try { saveSettings({ enabled: false }); } catch (_) { settings.enabled = false; }
      setNotice('本机设备凭据已丢失，无法找回原有匿名备份。');
      return;
    }
    try { await restore(2800); if (pendingUpload) queueUpload(); }
    catch (error) { handleError(error); }
  })();
})();
