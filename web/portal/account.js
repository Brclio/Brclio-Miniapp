(function bootAccount() {
  'use strict';
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', bootAccount, { once: true }); return; }
  const root = document.querySelector('[data-account-root]');
  const one = selector => root && root.querySelector(selector);
  const all = selector => root ? Array.from(root.querySelectorAll(selector)) : [];
  const form = one('[data-account-form]');
  const field = name => form && form.elements.namedItem(name);
  const deadlines = new Map();
  let runtime = null, currentUser = null, mode = 'login', method = 'code';
  let busy = false, sending = false, syncing = false, stopped = false, visible = false;
  let timer = null, operation = 0, logoutSerial = 0, initialized = false;
  let unsubscribeClient = () => {}, unsubscribeSync = () => {};
  let widget = null;
  if (!root && document.body) {
    widget = document.createElement('aside'); widget.className = 'brclio-account-widget'; if (/^\/projects\/lingotiles(?:\/|$)/.test(window.location.pathname)) widget.classList.add('brclio-account-widget--learning'); widget.setAttribute('aria-label', '账号与同步');
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'brclio-widget-toggle'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'brclio-widget-panel');
    const mark = document.createElement('span'); mark.className = 'brclio-widget-mark'; mark.textContent = 'b.'; mark.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.dataset.accountWidgetTitle = ''; title.textContent = '账号';
    const status = document.createElement('span'); status.dataset.accountWidgetStatus = ''; status.textContent = '访客';
    toggle.append(mark, title, status);
    const panel = document.createElement('div'); panel.id = 'brclio-widget-panel'; panel.className = 'brclio-widget-panel'; panel.hidden = true;
    const caption = document.createElement('p'); caption.className = 'brclio-widget-caption'; caption.textContent = 'Brclio / 悦创';
    const accountLink = document.createElement('a'); accountLink.href = '/?category=mine'; accountLink.dataset.accountEntry = ''; accountLink.className = 'brclio-widget-account'; accountLink.textContent = '登录 / 注册 ↗';
    const syncStatus = document.createElement('p'); syncStatus.dataset.accountWidgetDetail = ''; syncStatus.className = 'brclio-widget-detail'; syncStatus.setAttribute('role', 'status'); syncStatus.setAttribute('aria-live', 'polite'); syncStatus.textContent = '访客记录保存在本机。';
    const syncButton = document.createElement('button'); syncButton.type = 'button'; syncButton.className = 'brclio-widget-sync'; syncButton.textContent = '立即同步'; syncButton.hidden = true; syncButton.dataset.accountWidgetSync = '';
    panel.append(caption, accountLink, syncStatus, syncButton); widget.append(panel, toggle); document.body.appendChild(widget);
    toggle.addEventListener('click', () => { const expanded = toggle.getAttribute('aria-expanded') === 'true'; toggle.setAttribute('aria-expanded', String(!expanded)); panel.hidden = expanded; });
    syncButton.addEventListener('click', async () => { if (!runtime || !currentUser || syncButton.disabled) return; syncButton.disabled = true; try { const value = await runtime.sync.flush(); if (!stopped) renderStatus(value || runtime.sync.getStatus()); } catch (_) { if (!stopped) renderStatus(runtime.sync.getStatus()); } finally { syncButton.disabled = false; } });
    widget.addEventListener('keydown', event => { if (event.key === 'Escape') { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
  }
  const query = new URLSearchParams(window.location.search);
  if (query.get('mode') === 'register') mode = 'register';
  function inMine() { return !!root && new URLSearchParams(window.location.search).get('category') === 'mine' && document.visibilityState !== 'hidden'; }
  function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
  function purpose() { return mode === 'register' ? 'register' : 'login'; }
  function codeKey() { return purpose() + ':' + normalizeEmail(field('email') && field('email').value); }
  function setText(element, value) { if (element) element.textContent = value || ''; }
  function feedback(text, error) {
    if (!root) return;
    const selector = currentUser ? error ? '[data-account-session-error]' : '[data-account-session-notice]' : error ? '[data-account-error]' : '[data-account-notice]';
    const element = one(selector); setText(element, text); if (element) element.hidden = !text;
  }
  function clearFeedback() { all('[data-account-error],[data-account-notice],[data-account-session-error],[data-account-session-notice]').forEach(element => { element.hidden = true; element.textContent = ''; }); }
  function clearCredentials() { ['password', 'confirmPassword', 'code'].forEach(name => { if (field(name)) field(name).value = ''; }); }
  function updateCooldown() {
    if (timer !== null) window.clearInterval(timer); timer = null;
    if (!form) return;
    const remaining = Math.max(0, Math.ceil(((deadlines.get(codeKey()) || 0) - Date.now()) / 1000));
    const button = one('[data-account-action="code"]');
    if (button) { button.disabled = busy || sending || remaining > 0; button.textContent = remaining ? remaining + ' 秒后重发' : sending ? '正在发送…' : '获取验证码'; }
    if (remaining && !stopped) timer = window.setInterval(updateCooldown, 1000);
  }
  function controls() {
    all('[data-account-mode],[data-account-method],input,[data-account-submit],[data-account-action="logout"]').forEach(element => { element.disabled = busy || sending; });
    const sync = one('[data-account-action="sync"]'); if (sync) sync.disabled = busy || syncing;
    setText(one('[data-account-submit-label]'), busy ? '正在处理…' : mode === 'register' ? '注册并登录' : '登录');
    if (form) form.setAttribute('aria-busy', String(busy));
    updateCooldown();
  }
  function renderMode() {
    if (!root) return;
    all('[data-account-mode]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.accountMode === mode)); button.tabIndex = button.dataset.accountMode === mode ? 0 : -1; });
    all('[data-account-method]').forEach(button => { const active = button.dataset.accountMethod === method; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    one('#account-form-region').setAttribute('aria-labelledby', 'account-tab-' + mode);
    one('[data-account-login-methods]').hidden = mode === 'register';
    all('[data-account-register-field]').forEach(element => { element.hidden = mode !== 'register'; });
    one('[data-account-email-field]').hidden = mode === 'login' && method === 'password';
    one('[data-account-code-field]').hidden = mode === 'login' && method === 'password';
    one('[data-account-identifier-field]').hidden = mode !== 'login' || method !== 'password';
    one('[data-account-password-field]').hidden = mode !== 'register' && method !== 'password';
    if (field('password')) { field('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password'; field('password').placeholder = mode === 'register' ? '设置 8–128 位密码' : '请输入密码'; }
    controls();
  }
  function renderUser(user) {
    currentUser = user || null;
    const label = currentUser ? currentUser.displayName || currentUser.username || (currentUser.email ? currentUser.email.split('@')[0] : 'Brclio 用户') : '';
    document.querySelectorAll('[data-account-entry]').forEach(entry => {
      setText(entry, currentUser ? '我的账号' : '登录 / 注册');
      entry.setAttribute('aria-label', currentUser ? '打开我的账号，' + label : '登录或注册账号');
      const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); entry.appendChild(arrow);
    });
    if (widget) { const title = widget.querySelector('[data-account-widget-title]'); title.textContent = currentUser ? '我的账号' : '账号'; widget.querySelector('[data-account-widget-sync]').hidden = !currentUser; }
    if (!root) return;
    one('[data-account-member]').hidden = !currentUser;
    one('[data-account-guest]').hidden = !!currentUser;
    setText(one('[data-account-name]'), currentUser ? '你好，' + label + '。' : '');
    setText(one('[data-account-initial]'), label.slice(0, 1).toUpperCase());
    setText(one('[data-account-email]'), currentUser && currentUser.email || '可在小程序绑定邮箱后使用更多登录方式');
    setText(one('[data-account-username]'), currentUser && currentUser.username || '在小程序绑定邮箱后设置');
    controls();
  }
  function renderStatus(status) {
    if (widget) {
      widget.querySelector('[data-account-widget-status]').textContent = ({ idle: '已同步', syncing: '同步中', pending: '待同步', offline: '离线保留', error: '待重试', guest: '访客' }[status && status.state] || '本机保存');
      widget.querySelector('[data-account-widget-detail]').textContent = status && status.message || '记录先保存在本机。';
      widget.querySelector('[data-account-widget-sync]').disabled = !!status && status.state === 'syncing';
    }
    if (!root) return;
    syncing = !!status && status.state === 'syncing';
    setText(one('[data-account-sync-status]'), status && status.message || '进度先保存在本机，联网后自动同步。');
    controls();
  }
  function consent() {
    if (field('consent') && field('consent').checked) return true;
    feedback('请先阅读并同意《隐私与服务说明》。', true); return false;
  }
  function available() {
    if (runtime && runtime.client && runtime.sync) return true;
    feedback('账号服务暂时无法连接，请稍后重试。', true); return false;
  }
  function safeSync() {
    if (!runtime || !root) return Promise.resolve();
    const next = inMine();
    if (next) { visible = true; return Promise.resolve(runtime.sync.onShow({ pull: true })).then(status => { if (!stopped && inMine()) renderStatus(status || runtime.sync.getStatus()); }).catch(() => { if (!stopped) renderStatus(runtime.sync.getStatus()); }); }
    if (visible) { visible = false; return Promise.resolve(runtime.sync.onHide()).catch(() => {}); }
    return Promise.resolve();
  }
  async function sendCode() {
    if (busy || sending || !available() || !consent() || (deadlines.get(codeKey()) || 0) > Date.now()) return;
    const email = field('email').value, action = purpose(), key = action + ':' + normalizeEmail(email);
    clearFeedback(); sending = true; controls();
    try {
      const result = await runtime.client.sendEmailCode(email, action);
      const seconds = Number(result && (result.retryAfter || result.cooldown)) || 60;
      deadlines.set(key, Date.now() + Math.max(1, seconds) * 1000);
      if (!stopped) feedback('验证码已发送，请查看邮箱，留意垃圾邮件。', false);
    } catch (error) {
      if (error && error.retryAfter > 0) deadlines.set(key, Date.now() + error.retryAfter * 1000);
      if (!stopped) feedback(error && error.message || '验证码发送失败，请稍后重试。', true);
    } finally { sending = false; if (!stopped) controls(); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || sending || !available() || !consent()) return;
    if (mode === 'register' && field('password').value !== field('confirmPassword').value) { feedback('两次输入的密码不一致。', true); return; }
    const input = { email: field('email').value, username: field('username').value, password: field('password').value, code: field('code').value, identifier: field('identifier').value };
    const action = mode, loginMethod = method, id = ++operation, serial = logoutSerial;
    clearFeedback(); busy = true; controls();
    try {
      const session = action === 'register' ? await runtime.client.register({ email: input.email, username: input.username, password: input.password, code: input.code }) : loginMethod === 'code' ? await runtime.client.loginEmail(input.email, input.code) : await runtime.client.loginPassword(input.identifier, input.password);
      if (stopped || id !== operation || serial !== logoutSerial) return;
      renderUser(runtime.client.getCachedUser() || session.user);
      clearCredentials(); feedback(action === 'register' ? '注册成功，欢迎来到悦创。' : '登录成功，欢迎回来。', false);
      void safeSync();
    } catch (error) {
      if (!stopped && id === operation && serial === logoutSerial) { renderUser(runtime.client.getCachedUser()); feedback(error && error.message || '操作未完成，请稍后重试。', true); clearCredentials(); }
    } finally { if (id === operation) busy = false; if (!stopped) controls(); }
  }
  async function logout() {
    if (busy || !available()) return;
    ++operation; ++logoutSerial; clearFeedback(); clearCredentials(); busy = true; controls();
    let notice = '已退出登录。', expected = operation;
    try { const result = runtime.client.logout(); expected = operation; await result; } catch (_) { notice = '已退出本机登录，联网后会继续完成退出。'; }
    if (stopped || expected !== operation) return;
    const latest = runtime.client.getCachedUser();
    if (latest) { renderUser(latest); busy = false; controls(); return; }
    renderUser(null); ['email', 'username', 'identifier'].forEach(name => { if (field(name)) field(name).value = ''; });
    if (field('consent')) field('consent').checked = false;
    busy = false; controls(); feedback(notice, false);
  }
  async function synchronize() {
    if (busy || syncing || !available() || !currentUser) return;
    clearFeedback(); syncing = true; controls();
    try { const status = await runtime.sync.onShow({ pull: true }); if (!stopped) renderStatus(status || runtime.sync.getStatus()); }
    catch (_) { if (!stopped) renderStatus(runtime.sync.getStatus()); }
    finally { syncing = false; if (!stopped) controls(); }
  }
  async function initialize() {
    runtime = window.BrclioAccount || null;
    if (!runtime || !runtime.client || !runtime.sync) { if (root) one('[data-account-service-state]').hidden = false; return; }
    if (root) one('[data-account-service-state]').hidden = true;
    if (!initialized) {
      initialized = true;
      unsubscribeClient = typeof runtime.client.subscribe === 'function' ? runtime.client.subscribe(snapshot => {
        if (stopped) return;
        const next = snapshot && snapshot.user || null;
        if (!next) { logoutSerial += 1; operation += 1; busy = false; }
        clearFeedback(); clearCredentials(); renderUser(next);
      }) : () => {};
      unsubscribeSync = typeof runtime.sync.subscribe === 'function' ? runtime.sync.subscribe(status => { if (!stopped) renderStatus(status); }) : () => {};
    }
    renderUser(runtime.client.getCachedUser()); renderStatus(runtime.sync.getStatus());
    try {
      await Promise.resolve(runtime.ready);
      if (stopped) return;
      const before = runtime.client.getCachedUser();
      if (before) {
        try { await runtime.client.refreshSession(); if (!stopped) renderUser(runtime.client.getCachedUser()); }
        catch (_) { if (!stopped && runtime.client.getCachedUser()) feedback('账号状态暂时无法更新，进度仍保存在本机。', false); }
      }
      if (!stopped) void safeSync();
    } catch (_) { if (!stopped && root) one('[data-account-service-state]').hidden = false; }
  }
  if (root) {
    renderMode();
    all('[data-account-mode]').forEach(button => button.addEventListener('click', () => { if (busy || sending) return; mode = button.dataset.accountMode; clearFeedback(); clearCredentials(); renderMode(); }));
    all('[data-account-method]').forEach(button => button.addEventListener('click', () => { if (busy || sending) return; method = button.dataset.accountMethod; clearFeedback(); clearCredentials(); renderMode(); }));
    all('[data-account-mode]').forEach(button => button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = one('[data-account-mode="' + (mode === 'login' ? 'register' : 'login') + '"]'); next.click(); next.focus(); }));
    form.addEventListener('submit', submit);
    form.addEventListener('input', event => { clearFeedback(); if (event.target === field('email')) updateCooldown(); });
    one('[data-account-action="code"]').addEventListener('click', sendCode);
    one('[data-account-action="logout"]').addEventListener('click', logout);
    one('[data-account-action="sync"]').addEventListener('click', synchronize);
    one('[data-account-action="retry"]').addEventListener('click', initialize);
    all('a[href="#privacy"]').forEach(link => link.addEventListener('click', () => { const privacy = document.getElementById('privacy'); if (privacy) privacy.open = true; }));
  }
  document.addEventListener('click', event => { if (event.target.closest && event.target.closest('[data-view]') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { void Promise.resolve().then(safeSync); } });
  window.addEventListener('popstate', () => { void safeSync(); });
  document.addEventListener('visibilitychange', () => { void safeSync(); });
  window.addEventListener('pagehide', () => {
    stopped = true; clearCredentials(); if (timer !== null) window.clearInterval(timer); timer = null;
    unsubscribeClient(); unsubscribeSync();
    if (runtime) void Promise.resolve(runtime.sync.onHide()).catch(() => {});
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; initialized = false; void initialize(); } });
  void initialize();
}());
