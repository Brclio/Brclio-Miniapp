'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.resolve(__dirname, '../web/portal/index.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '../web/portal/account.js'), 'utf8');
const profile = { id: 'account-a', username: 'brclio', email: 'hello@example.com', displayName: '悦创', providers: ['email'] };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
async function host(options = {}) {
  let user = options.user || null, status = { userId: user && user.id, state: user ? 'idle' : 'guest', pending: 0, message: user ? '已同步。' : '访客记录保存在本机。' }, now = 1800000000000, next = 0;
  const calls = [], subscribers = new Set(), syncSubscribers = new Set(), timers = new Map();
  const dom = new JSDOM(options.module ? '<!DOCTYPE html><html><head></head><body><main>游戏画面</main></body></html>' : html, { url: options.url || 'https://miniapp.example/?category=mine', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.Date.now = () => now;
  window.setInterval = fn => { const id = ++next; timers.set(id, fn); return id; };
  window.clearInterval = id => timers.delete(id);
  function emitUser(value, reason = 'login') { user = value; for (const callback of subscribers) callback({ user, expiresAt: null, reason }); }
  function emitStatus(value) { status = { ...status, ...value }; for (const callback of syncSubscribers) callback(status); }
  async function auth(action, args) { calls.push([action, ...args]); emitUser(profile); return { user: profile, expiresAt: null }; }
  const client = {
    getCachedUser: () => user,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    async refreshSession() { calls.push(['refreshSession']); return user ? { user, expiresAt: null } : null; },
    register: input => auth('register', [JSON.parse(JSON.stringify(input))]),
    loginEmail: (email, code) => auth('loginEmail', [email, code]),
    loginPassword: (identifier, password) => auth('loginPassword', [identifier, password]),
    async sendEmailCode(email, purpose) { calls.push(['sendEmailCode', email, purpose]); return { retryAfter: 60 }; },
    async logout() { calls.push(['logout']); emitUser(null, 'logout'); },
    ...(options.client || {})
  };
  const sync = {
    getStatus: () => status,
    subscribe(callback) { syncSubscribers.add(callback); return () => syncSubscribers.delete(callback); },
    async onShow(value) { calls.push(['onShow', JSON.parse(JSON.stringify(value))]); return status; },
    async onHide() { calls.push(['onHide']); return status; },
    async flush() { calls.push(['flush']); return status; },
    ...(options.sync || {})
  };
  if (!options.unavailable) window.BrclioAccount = { client, sync, ready: Promise.resolve() };
  window.eval(script); window.document.dispatchEvent(new window.Event('DOMContentLoaded')); await flush();
  const document = window.document;
  const get = selector => document.querySelector(selector);
  const field = name => get('[data-account-form]').elements.namedItem(name);
  const input = (name, value) => { const element = field(name); element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = selector => get(selector).click();
  const submit = async () => { get('[data-account-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await flush(); };
  return { dom, window, document, client, sync, calls, timers, get, field, input, click, submit, emitUser, emitStatus,
    consent() { field('consent').checked = true; }, advance(ms) { now += ms; for (const fn of [...timers.values()]) fn(); }, close() { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); } };
}

test('registration requires consent, verifies matching passwords and clears transient credentials after success', async () => {
  const h = await host({ url: 'https://miniapp.example/?category=mine&mode=register' });
  h.input('email', 'hello@example.com'); h.input('username', 'brclio'); h.input('password', 'password'); h.input('confirmPassword', 'different'); h.input('code', '000123');
  await h.submit(); assert.match(h.get('[data-account-error]').textContent, /隐私/); assert.equal(h.calls.some(call => call[0] === 'register'), false);
  h.consent(); await h.submit(); assert.match(h.get('[data-account-error]').textContent, /不一致/);
  h.input('confirmPassword', 'password'); await h.submit();
  const call = h.calls.find(value => value[0] === 'register'); assert.deepEqual(call[1], { email: 'hello@example.com', username: 'brclio', password: 'password', code: '000123' });
  assert.equal(h.get('[data-account-member]').hidden, false); assert.equal(h.field('password').value, ''); assert.equal(h.field('confirmPassword').value, ''); assert.equal(h.field('code').value, '');
  assert.equal(h.get('[data-account-form]').getAttribute('aria-busy'), 'false'); assert.match(h.get('[data-account-session-notice]').textContent, /注册成功/); h.close();
});

test('email code, email password and account password login call their real client methods', async () => {
  for (const [method, identifier] of [['code', 'hello@example.com'], ['password', 'hello@example.com'], ['password', 'brclio']]) {
    const h = await host(); h.consent();
    if (method === 'password') { h.click('[data-account-method="password"]'); h.input('identifier', identifier); h.input('password', ' secret password '); }
    else { h.input('email', identifier); h.input('code', '000123'); }
    await h.submit();
    assert.deepEqual(h.calls.find(value => value[0] === (method === 'code' ? 'loginEmail' : 'loginPassword')), method === 'code' ? ['loginEmail', identifier, '000123'] : ['loginPassword', identifier, ' secret password ']);
    assert.equal(h.get('[data-account-member]').hidden, false); h.close();
  }
});

test('email OTP cooldown is scoped to normalized email and purpose and server retry-after is honored', async () => {
  const h = await host(); h.consent(); h.input('email', 'Hello@Example.com'); h.click('[data-account-action="code"]'); await flush();
  assert.deepEqual(h.calls.find(call => call[0] === 'sendEmailCode'), ['sendEmailCode', 'Hello@Example.com', 'login']);
  assert.equal(h.get('[data-account-action="code"]').disabled, true); assert.match(h.get('[data-account-action="code"]').textContent, /60/);
  h.advance(1000); assert.match(h.get('[data-account-action="code"]').textContent, /59/);
  h.click('[data-account-mode="register"]'); assert.equal(h.get('[data-account-action="code"]').disabled, false);
  h.click('[data-account-action="code"]'); await flush(); assert.equal(h.calls.filter(call => call[0] === 'sendEmailCode').at(-1)[2], 'register');
  h.input('email', 'other@example.com'); assert.equal(h.get('[data-account-action="code"]').disabled, false);
  h.input('email', ' hello@example.COM '); assert.equal(h.get('[data-account-action="code"]').disabled, true);
  h.close(); assert.equal(h.timers.size, 0);
  const throttled = await host({ client: { async sendEmailCode() { throw Object.assign(new Error('请稍后再试。'), { retryAfter: 30 }); } } });
  throttled.consent(); throttled.input('email', 'hello@example.com'); throttled.click('[data-account-action="code"]'); await flush(); assert.match(throttled.get('[data-account-action="code"]').textContent, /30/); assert.match(throttled.get('[data-account-error]').textContent, /稍后/); throttled.close();
});

test('failed authentication enables retry and safely renders server messages using text content', async () => {
  let attempts = 0;
  const h = await host({ client: { async loginEmail() { attempts++; throw new Error('<img src=x onerror=alert(1)>'); } } });
  h.consent(); h.input('email', 'hello@example.com'); h.input('code', '123456'); await h.submit();
  assert.equal(h.get('[data-account-submit]').disabled, false); assert.equal(h.get('[data-account-error] img'), null); assert.match(h.get('[data-account-error]').textContent, /<img/);
  h.input('code', '123456'); await h.submit(); assert.equal(attempts, 2); h.close();
});

test('persistent login restores a safe profile, supports synchronization and displays offline status', async () => {
  const h = await host({ user: { ...profile, displayName: '<script>unsafe</script>' } });
  assert.equal(h.get('[data-account-member]').hidden, false); assert.equal(h.get('[data-account-name] script'), null); assert.match(h.get('[data-account-name]').textContent, /<script>/);
  assert.ok(h.calls.some(call => call[0] === 'refreshSession')); assert.ok(h.calls.some(call => call[0] === 'onShow'));
  h.emitStatus({ state: 'offline', message: '网络恢复后会自动继续同步。' }); assert.match(h.get('[data-account-sync-status]').textContent, /网络恢复/);
  h.click('[data-account-action="sync"]'); await flush(); assert.ok(h.calls.filter(call => call[0] === 'onShow').length >= 2);
  h.emitStatus({ state: 'syncing', message: '正在同步。' }); assert.equal(h.get('[data-account-action="sync"]').disabled, true);
  h.emitStatus({ state: 'idle', message: '已同步。' }); assert.equal(h.get('[data-account-action="sync"]').disabled, false); h.close();
});

test('logout clears session UI and sensitive fields even when server revocation is temporarily offline', async () => {
  const h = await host({ user: profile });
  h.client.logout = async () => { h.emitUser(null, 'logout'); throw new Error('offline'); };
  h.click('[data-account-action="logout"]'); await flush();
  assert.equal(h.get('[data-account-member]').hidden, true); assert.equal(h.get('[data-account-guest]').hidden, false); assert.match(h.get('[data-account-notice]').textContent, /联网后/);
  assert.equal(h.field('consent').checked, false); assert.match(h.get('[data-account-entry]').textContent, /登录/); h.close();
});

test('a late login result after an external logout cannot restore an old profile or erase newer typed credentials', async () => {
  let finish;
  const h = await host({ client: { loginEmail() { return new Promise(resolve => { finish = resolve; }); } } });
  h.consent(); h.input('email', 'hello@example.com'); h.input('code', '123456');
  h.get('[data-account-form]').dispatchEvent(new h.window.Event('submit', { cancelable: true })); await flush(); assert.equal(h.get('[data-account-submit]').disabled, true);
  h.emitUser(null, 'logout'); h.click('[data-account-method="password"]'); h.input('password', 'new typed password');
  finish({ user: profile, expiresAt: null }); await flush(); assert.equal(h.get('[data-account-member]').hidden, true); assert.equal(h.field('password').value, 'new typed password'); h.close();
});

test('safe sync pulls only in the mine view and is invalidated on navigation and page hide', async () => {
  const h = await host({ url: 'https://miniapp.example/?category=photography', user: profile });
  assert.equal(h.calls.some(call => call[0] === 'onShow'), false);
  h.window.history.pushState({}, '', '/?category=mine'); h.window.dispatchEvent(new h.window.PopStateEvent('popstate')); await flush(); assert.ok(h.calls.some(call => call[0] === 'onShow'));
  h.window.history.pushState({}, '', '/?category=learn'); h.window.dispatchEvent(new h.window.PopStateEvent('popstate')); await flush(); assert.ok(h.calls.some(call => call[0] === 'onHide')); h.close();
});

test('unavailable runtime offers retry while privacy and visitor content remain accessible', async () => {
  const h = await host({ unavailable: true }); assert.equal(h.get('[data-account-service-state]').hidden, false);
  h.click('.account-consent a'); assert.equal(h.get('#privacy').open, true);
  h.consent(); await h.submit(); assert.match(h.get('[data-account-error]').textContent, /无法连接/); assert.ok(h.get('.account-links a[href="/projects/lingotiles/"]')); h.close();
});

test('project pages get an isolated collapsible account chip and manual sync never hydrates an active game', async () => {
  const h = await host({ module: true, url: 'https://miniapp.example/projects/ready-go-duel/', user: profile });
  const chip = h.get('.brclio-account-widget'); assert.ok(chip); assert.equal(h.get('#brclio-widget-panel').hidden, true);
  h.click('.brclio-widget-toggle'); assert.equal(h.get('#brclio-widget-panel').hidden, false); assert.equal(h.get('.brclio-widget-account').getAttribute('href'), '/?category=mine');
  h.click('[data-account-widget-sync]'); await flush(); assert.ok(h.calls.some(call => call[0] === 'flush')); assert.equal(h.calls.some(call => call[0] === 'onShow'), false);
  h.emitStatus({ state: 'offline', message: '网络恢复后会自动同步。' }); assert.equal(h.get('[data-account-widget-status]').textContent, '离线保留');
  h.get('.brclio-widget-toggle').dispatchEvent(new h.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })); assert.equal(h.get('#brclio-widget-panel').hidden, true); h.close();
});

test('portal loads runtime before UI and catalog renderer and preserves accessible credential metadata', () => {
  const document = new JSDOM(html).window.document;
  const scripts = Array.from(document.scripts).map(element => element.getAttribute('src'));
  assert.ok(scripts.indexOf('/account-runtime.js') < scripts.indexOf('/account.js')); assert.ok(scripts.indexOf('/account.js') < scripts.indexOf('/main.js'));
  for (const id of ['web-account-email', 'web-account-username', 'web-account-identifier', 'web-account-password', 'web-account-confirm', 'web-account-code']) assert.ok(document.querySelector('label[for="' + id + '"]'));
  assert.equal(document.getElementById('web-account-password').type, 'password'); assert.equal(document.getElementById('web-account-code').getAttribute('autocomplete'), 'one-time-code');
  assert.doesNotMatch(html, /不提供账号登录|没有跨设备同步|学习记录不上传云端|明文存储|密码未加密/);
});


test('a delayed logout response never replaces a newer account delivered by the runtime subscription', async () => {
  const h = await host({ user: profile }); let finish;
  h.client.logout = () => { h.emitUser(null, 'logout'); return new Promise(resolve => { finish = resolve; }); };
  h.click('[data-account-action="logout"]'); await flush();
  h.emitUser({ ...profile, id: 'account-b', displayName: '第二个账号' });
  finish(); await flush(); assert.equal(h.get('[data-account-member]').hidden, false); assert.match(h.get('[data-account-name]').textContent, /第二个账号/); h.close();
});

test('a browser back-forward cache return reattaches account state and clears credentials on leaving', async () => {
  const h = await host(); h.input('password', 'private'); h.input('code', '123456');
  h.window.dispatchEvent(new h.window.Event('pagehide')); assert.equal(h.field('password').value, ''); assert.equal(h.field('code').value, '');
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true })); await flush();
  h.emitUser(profile); assert.equal(h.get('[data-account-member]').hidden, false); h.close();
});


test('account forms provide narrow-screen layout rules and the same username limits as the shared client', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../web/portal/style.css'), 'utf8');
  const widgetCss = fs.readFileSync(path.resolve(__dirname, '../web/portal/account-widget.css'), 'utf8');
  const document = new JSDOM(html).window.document;
  const username = document.getElementById('web-account-username');
  assert.equal(username.maxLength, 24); assert.match(username.placeholder, /字母开头，4–24/);
  assert.match(css, /@media\(max-width:700px\)\{\.account-guest\{grid-template-columns:1fr/);
  assert.match(css, /@media\(max-width:350px\)/); assert.match(css, /\.account-code-row input\{flex:1;width:0\}/);
  assert.match(widgetCss, /max-width:calc\(100vw - 16px\)/); assert.match(widgetCss, /\.brclio-widget-panel/);
  assert.doesNotMatch(document.querySelector('.account-links').textContent, /本机战绩/);
});


test('mobile LingoTiles account chip is positioned above the fixed learning navigation only', async () => {
  const learning = await host({ module: true, url: 'https://miniapp.example/projects/lingotiles/' });
  assert.ok(learning.get('.brclio-account-widget').classList.contains('brclio-account-widget--learning'));
  const game = await host({ module: true, url: 'https://miniapp.example/projects/ready-go-duel/' });
  assert.equal(game.get('.brclio-account-widget').classList.contains('brclio-account-widget--learning'), false);
  const css = fs.readFileSync(path.resolve(__dirname, '../web/portal/account-widget.css'), 'utf8');
  assert.match(css, /@media\(max-width:760px\)\{\.brclio-account-widget\.brclio-account-widget--learning\{bottom:calc\(70px \+ env\(safe-area-inset-bottom,0px\)\)\}/);
  learning.close(); game.close();
});
