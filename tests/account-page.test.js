'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
const user = { id: 'usr_test', username: 'brclio', email: 'hello@example.com', displayName: '悦创', providers: ['email'], avatarUrl: '' };
const event = values => ({ currentTarget: { dataset: values } });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function host(options = {}) {
  let definition, now = Date.parse('2026-10-22T02:00:00Z'), nextId = 0, cached = options.user || null;
  const calls = [], tasks = new Map(), navigations = [];
  const result = () => ({ user: cached || user, expiresAt: null });
  const sync = {
    getStatus() { return { state: 'idle', message: '已同步', pending: 0 }; },
    subscribe(listener) { listener({ state: 'idle', message: '已同步', pending: 0 }); return () => {}; },
    async onShow() {}, async onHide() {}, async flush() {}, async activate() {}
  };
  const account = {
    normalizeEmail: email => String(email || '').trim().toLowerCase(), expiryTime: Date.parse,
    getCachedUser() { return cached; },
    async refreshSession() { calls.push(['refreshSession']); if (options.expired) { cached = null; return null; } return result(); },
    async sendEmailCode(email, purpose) { calls.push(['sendEmailCode', email, purpose]); return { retryAfter: 60 }; },
    async register(input) { calls.push(['register', structuredClone(input)]); cached = user; return result(); },
    async loginPassword(identifier, password) { calls.push(['loginPassword', identifier, password]); cached = user; return result(); },
    async loginEmail(email, code) { calls.push(['loginEmail', email, code]); cached = user; return result(); },
    async loginWechat() { calls.push(['loginWechat']); cached = { ...user, email: '', username: '', displayName: '', providers: ['wechat'] }; return result(); },
    async bindEmail(input) { calls.push(['bindEmail', structuredClone(input)]); cached = { ...user, providers: ['email', 'wechat'] }; return result(); },
    async logout() { calls.push(['logout']); cached = null; return { ok: true }; },
    ...(options.account || {})
  };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const schedule = (callback, delay, repeat) => { const id = ++nextId; tasks.set(id, { callback, at: now + delay, repeat }); return id; };
  vm.runInNewContext(fs.readFileSync(path.join(root, options.home ? 'pages/home/index.js' : 'pages/account/index.js'), 'utf8'), {
    Page(value) { definition = value; }, Date: ClockDate,
    require(id) { return id === '../../data/catalog' ? require('../miniprogram/data/catalog') : id === '../../lib/account-sync' ? sync : account; },
    wx: { navigateTo(value) { navigations.push(['navigateTo', value.url]); }, reLaunch(value) { navigations.push(['reLaunch', value.url]); }, setNavigationBarTitle() {}, pageScrollTo() {} },
    setTimeout: (callback, delay) => schedule(callback, delay, 0), clearTimeout: id => tasks.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: id => tasks.delete(id)
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  page.onLoad(options.query || {});
  return { page, calls, tasks, account, navigations, setUser(value) { cached = value; },
    advance(ms) {
      const deadline = now + ms;
      for (;;) {
        const entry = Array.from(tasks.entries()).filter(([, task]) => task.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, task] = entry; now = task.at;
        if (task.repeat) task.at += task.repeat; else tasks.delete(id);
        task.callback();
      }
      now = deadline;
    }
  };
}
const fill = (page, fields) => { for (const [field, value] of Object.entries(fields)) page.inputField({ ...event({ field }), detail: { value } }); };
const consent = page => page.changeConsent({ detail: { value: ['agree'] } });

test('register, code login, password login and WeChat login require explicit consent', async () => {
  for (const operation of ['submitForm', 'wechatLogin', 'sendCode']) {
    const h = host(), p = h.page;
    await p[operation]();
    assert.equal(h.calls.length, 0);
    assert.match(p.data.error, /隐私/);
  }
  const h = host({ query: { mode: 'register' } }), p = h.page;
  fill(p, { email: 'hello@example.com', username: 'brclio', password: 'new-password', confirmPassword: 'different', code: '123456' });
  consent(p); await p.submitForm(); assert.match(p.data.error, /不一致/); assert.equal(h.calls.length, 0);
  fill(p, { confirmPassword: 'new-password' }); await p.submitForm();
  assert.equal(h.calls[0][0], 'register');
  assert.deepEqual(h.calls[0][1], { email: 'hello@example.com', username: 'brclio', password: 'new-password', code: '123456' });
  assert.equal(p.data.user.id, user.id); assert.equal(p.data.mode, 'login');
  assert.equal(p.data.password, ''); assert.equal(p.data.confirmPassword, ''); assert.equal(p.data.code, '');
  assert.equal(JSON.stringify(p.data).includes('token'), false);
  p.onUnload(); assert.equal(h.tasks.size, 0);
});

test('login mode routes a unified email-or-account identifier and preserves leading zero codes', async () => {
  const h = host(), p = h.page; consent(p);
  fill(p, { email: 'hello@example.com', code: '000123' }); await p.submitForm();
  assert.deepEqual(h.calls[0], ['loginEmail', 'hello@example.com', '000123']);
  await p.logout(); consent(p);
  p.switchLoginMethod(event({ method: 'password' }));
  fill(p, { identifier: 'BRCLIO', password: ' password ' }); await p.submitForm();
  assert.deepEqual(h.calls.at(-1), ['loginPassword', 'BRCLIO', ' password ']);
  assert.equal(p.data.password, ''); p.onUnload();
});

test('email cooldown follows normalized email and purpose, survives mode changes and stops on unload', async () => {
  const h = host(), p = h.page; consent(p);
  fill(p, { email: 'Hello@Example.com' }); await p.sendCode();
  assert.deepEqual(h.calls[0], ['sendEmailCode', 'Hello@Example.com', 'login']);
  assert.equal(p.data.codeSeconds, 60); await p.sendCode(); assert.equal(h.calls.length, 1);
  h.advance(1000); assert.equal(p.data.codeSeconds, 59);
  p.switchMode(event({ mode: 'register' })); assert.equal(p.data.codeSeconds, 0);
  await p.sendCode(); assert.equal(h.calls.at(-1)[2], 'register');
  fill(p, { email: 'other@example.com' }); assert.equal(p.data.codeSeconds, 0);
  fill(p, { email: ' hello@example.COM ' }); assert.equal(p.data.codeSeconds, 60);
  p.switchMode(event({ mode: 'login' })); assert.equal(p.data.codeSeconds, 59);
  h.advance(59000); assert.equal(p.data.codeSeconds, 0); assert.equal(h.tasks.size, 0);
  await p.sendCode(); assert.equal(p.data.codeSeconds, 60);
  p.onUnload(); assert.equal(h.tasks.size, 0);
  p.onLoad({}); p.updateCooldown(); assert.equal(p.data.codeSeconds, 60);
  p.onUnload();
});

test('server rate limits set cooldown and failures keep retry controls usable', async () => {
  const failure = Object.assign(new Error('请稍后再试。'), { retryAfter: 30 });
  const h = host({ account: { async sendEmailCode() { throw failure; }, async loginEmail() { throw new Error('验证码错误。'); } } }), p = h.page;
  consent(p); fill(p, { email: 'hello@example.com', code: '123456' }); await p.sendCode();
  assert.equal(p.data.codeSeconds, 30); assert.equal(p.data.sendingCode, false); assert.match(p.data.error, /稍后/);
  await p.submitForm(); assert.equal(p.data.busy, false); assert.match(p.data.error, /验证码错误/); assert.equal(p.data.user, null);
  p.onUnload(); assert.equal(h.tasks.size, 0);
});

test('WeChat creates a usable account and can bind email without leaving the account page', async () => {
  const h = host(), p = h.page; consent(p); await p.wechatLogin();
  assert.equal(h.calls[0][0], 'loginWechat'); assert.equal(p.data.userLabel, '微信用户'); assert.equal(p.data.wechatLinked, true);
  p.startBind(); assert.equal(p.data.mode, 'bind'); assert.equal(p.data.showBind, true);
  fill(p, { email: 'hello@example.com', username: 'brclio', password: 'password', confirmPassword: 'password', code: '123456' });
  await p.sendCode(); assert.equal(h.calls.at(-1)[2], 'bind');
  await p.submitForm(); assert.equal(h.calls.at(-1)[0], 'bindEmail'); assert.equal(p.data.showBind, false);
  assert.equal(p.data.user.email, 'hello@example.com'); assert.equal(p.data.wechatLinked, true);
  assert.equal(p.data.password, ''); assert.equal(p.data.code, ''); p.onUnload();
});

test('session restore handles revocation, keeps indefinite login and retains local state offline', async () => {
  const expired = host({ user, expired: true });
  await expired.page.onShow(); assert.equal(expired.calls[0][0], 'refreshSession'); assert.equal(expired.page.data.user, null); assert.match(expired.page.data.notice, /重新登录/);
  const offline = host({ user, account: { async refreshSession() { throw new Error('offline'); } } });
  await offline.page.onShow(); assert.equal(offline.page.data.user.id, user.id); assert.match(offline.page.data.notice, /稍后/); assert.equal(offline.page.data.refreshing, false);
  const h = host({ user }); await h.page.onShow(); assert.equal(h.tasks.size, 0);
  h.advance(5 * 365 * 86400000); assert.equal(h.page.data.user.id, user.id); assert.equal(h.tasks.size, 0);
  h.page.onUnload(); expired.page.onUnload(); offline.page.onUnload();
});

test('pending operations cannot update an unloaded page and unload clears sensitive fields', async () => {
  let finish;
  const h = host({ account: { loginEmail() { return new Promise(resolve => { finish = resolve; }); } } }), p = h.page;
  consent(p); fill(p, { email: 'hello@example.com', code: '123456', password: 'private', confirmPassword: 'private' });
  const submission = p.submitForm();
  assert.equal(p.data.busy, true);
  p.onUnload(); assert.equal(p.data.password, ''); assert.equal(p.data.confirmPassword, ''); assert.equal(p.data.code, '');
  const snapshot = structuredClone(p.data);
  finish({ user, expiresAt: new Date(Date.now() + 3600000).toISOString() }); await submission;
  assert.deepEqual(p.data, snapshot); assert.equal(h.tasks.size, 0);
});

test('guest home retains all local entries, and account navigation and member state follow login', async () => {
  const h = host({ home: true }), p = h.page;
  await p.onShow(); assert.equal(h.calls.length, 0); assert.equal(p.data.accountUser, null);
  for (const tab of ['photo', 'relax', 'learn', 'mine']) p.switchTab(event({ tab }));
  assert.equal(p.data.activeTab, 'mine');
  p.openAccount(event({ mode: 'register' })); assert.deepEqual(h.navigations.at(-1), ['navigateTo', '/pages/account/index?mode=register']);
  p.openAccount(); assert.deepEqual(h.navigations.at(-1), ['navigateTo', '/pages/account/index']);
  h.setUser(user); await p.onShow(); assert.equal(h.calls[0][0], 'refreshSession'); assert.equal(p.data.accountLabel, '悦创');
  h.setUser(null); await p.onShow(); assert.equal(p.data.accountUser, null); assert.equal(p.data.accountLabel, '');
  p.openFeature(event({ id: 'ready-go-duel' })); assert.equal(h.navigations.at(-1)[1], '/pages/duel/index'); p.onUnload();
});

test('templates expose implemented native handlers, masked password fields and working privacy/guest routes', () => {
  for (const home of [false, true]) {
    const h = host({ home }), p = h.page;
    const template = fs.readFileSync(path.join(root, home ? 'pages/home/index.wxml' : 'pages/account/index.wxml'), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?:tap|input|confirm|change|submit)="([^"]+)"/g)) assert.equal(typeof p[match[1]], 'function', match[1]);
    assert.doesNotMatch(template, /<web-view\b/);
    if (!home) {
      assert.equal((template.match(/password value=/g) || []).length, 2);
      p.openPrivacy(); assert.equal(h.navigations.at(-1)[1], '/pages/privacy/index');
      p.continueBrowsing(); assert.deepEqual(h.navigations.at(-1), ['reLaunch', '/pages/home/index?tab=mine']);
      assert.doesNotMatch(template, /明文|未加密|GitHub|token|private-key|5422366/);
    }
    p.onUnload();
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.ok(config.pages.includes('pages/account/index'));
});
