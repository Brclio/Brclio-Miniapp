'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const { createBrowserAccount, BOOT_WAIT } = require('../web/account-browser');
const { STORAGE_KEY, REVOCATIONS_KEY } = require('../miniprogram/lib/account');
const { CLAIM_KEY } = require('../miniprogram/lib/account-sync');
const { SNAPSHOT_KEY } = require('../web/account-history-snapshot');
const { historyFactory } = require('./helpers/history-snapshot.cjs');
const A = 'a'.repeat(32), B = 'b'.repeat(32), NOW = Date.parse('2026-10-22T12:00:00Z');
const user = id => ({ id, username: id === A ? 'alice' : 'bob', email: id === A ? 'alice@example.test' : 'bob@example.test', displayName: 'Brclio 用户', providers: ['email'], createdAt: NOW });
const token = (id, count = 1) => 'm1.' + id + '.' + String(count).padStart(64, '0');
const session = (id, count = 1) => ({ user: user(id), token: token(id, count), expiresAt: null });
const pause = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function host(options = {}) {
  const dom = new JSDOM(options.html || '<!doctype html><html><body><main>Original content</main></body></html>', { url: options.url || 'https://pocket.bornforthis.cn/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const window = dom.window, calls = [], servers = new Map(), tasks = new Map();
  if (options.indexedDB) Object.defineProperty(window, 'indexedDB', { configurable: true, value: options.indexedDB });
  let now = NOW, serial = 1, sequence = 0, reloads = 0, fetchHook = options.fetchHook;
  for (const [key, value] of options.initial || []) window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  if (options.session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options.session));
  function server(id) { if (!servers.has(id)) servers.set(id, { revision: 0, entries: {} }); return servers.get(id); }
  const fetchImpl = async (input, init) => {
    calls.push({ url: input, ...init });
    if (fetchHook) { const value = await fetchHook(input, init); if (value) return value; }
    const route = new URL(input).pathname.slice('/api/account'.length), data = init.body && JSON.parse(init.body);
    const id = init.headers.Authorization?.split('.')[1];
    if (route.startsWith('/login/') || route === '/register') {
      const accountId = data?.identifier === 'bobby' || data?.email === 'bob@example.test' ? B : A;
      return Response.json(session(accountId, ++serial), { status: route === '/register' ? 201 : 200 });
    }
    if (route === '/session') return Response.json({ user: user(id), expiresAt: null });
    if (route === '/logout' || route === '/email/code') return Response.json({ ok: true });
    if (route === '/sync') {
      const state = server(id);
      if (init.method === 'PUT') {
        if (data.revision !== state.revision) return Response.json({ error: 'sync_conflict' }, { status: 409 });
        state.revision++;
        for (const [key, value] of Object.entries(data.entries)) if (!state.entries[key] || value.updatedAt >= state.entries[key].updatedAt) state.entries[key] = structuredClone(value);
      }
      return Response.json(state);
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  };
  const runtime = createBrowserAccount(window, {
    now: () => now, fetchImpl, ...(options.portal === undefined ? {} : { portal: options.portal }),
    ...(options.rawStorage ? { localStorage: options.rawStorage } : {}),
    reload() { reloads++; },
    setTimeout(fn, delay) { const id = ++sequence; tasks.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { tasks.delete(id); }
  });
  return { dom, window, runtime, calls, tasks, server, get reloads() { return reloads; }, setHook(value) { fetchHook = value; },
    advance(ms) { now += ms; for (const [id, value] of [...tasks]) if (value.at <= now) { tasks.delete(id); value.fn(); } },
    close() { runtime.destroy(); dom.window.close(); } };
}

test('browser guest storage preserves the existing duel prefix, raw ReadyGo strings and Lingotiles JSON', async () => {
  const duel = { targetScore: 5, names: ['红方', '蓝方'], matches: [] };
  const progress = JSON.stringify({ completed: {}, saved: ['apple'], seen: [], sessions: 0, lastPlayed: null, streak: 0 });
  const h = host({ initial: [['brclio-minigame:brclio.duel.v1', JSON.stringify(duel)], ['RGD_CUSTOM_TITLE', '你好, "world"'], ['RGD_MAX_WAIT', '7'], ['lingotiles.progress.v1', progress], ['lingotiles.cache.v1', 'cached text']] });
  await h.runtime.ready;
  assert.deepEqual(h.runtime.storage.getStorageSync('brclio.duel.v1'), duel);
  assert.equal(h.runtime.storage.getStorageSync('RGD_CUSTOM_TITLE'), '你好, "world"');
  assert.equal(h.runtime.storage.getStorageSync('RGD_MAX_WAIT'), 7);
  assert.equal(h.runtime.storage.getItem('lingotiles.progress.v1'), progress);
  assert.equal(h.runtime.storage.getItem('lingotiles.cache.v1'), 'cached text');
  h.runtime.storage.setStorageSync('brclio.duel.v1', { ...duel, targetScore: 1 });
  assert.equal(JSON.parse(h.window.localStorage.getItem('brclio-minigame:brclio.duel.v1')).targetScore, 1);
  assert.equal(h.window.localStorage.getItem('brclio.duel.v1'), null);
  h.runtime.storage.setItem('RGD_CUSTOM_TITLE', 'new title');
  assert.equal(h.window.localStorage.getItem('RGD_CUSTOM_TITLE'), 'new title');
  assert.equal(h.calls.length, 0); h.close();
});

test('all first-login methods freeze legacy history before sending authentication and guest boot never freezes early', async () => {
  const methods = [
    ['register', [{ email: 'alice@example.test', username: 'alice', password: 'test password', code: '123456' }]],
    ['loginPassword', ['alice', 'test password']],
    ['loginEmail', ['alice@example.test', '123456']]
  ];
  for (const [method, args] of methods) {
    const idb = historyFactory(['old-session'], { delay: true }), h = host({ indexedDB: idb.factory });
    await h.runtime.ready;
    assert.equal(idb.calls.length, 0);
    const pending = h.runtime.client[method](...args); await pause();
    assert.equal(h.calls.length, 0); assert.equal(h.window.localStorage.getItem(CLAIM_KEY), null);
    idb.release(); const result = await pending;
    assert.equal(result.user.id, A); assert.equal(result.expiresAt, null);
    assert.deepEqual(JSON.parse(h.window.localStorage.getItem(SNAPSHOT_KEY)), { version: 1, owner: null, ids: ['old-session'], complete: false });
    assert.equal(JSON.parse(h.window.localStorage.getItem(CLAIM_KEY)).userId, A);
    assert.ok(idb.calls.filter(call => call.operation === 'transaction').every(call => call.mode === 'readonly'));
    assert.equal(idb.calls.filter(call => call.operation === 'open').length, 1);
    h.close();
  }
});

test('cached first-user history snapshot shares the total 1.8 second module boot budget and blocks lifecycle claims', async () => {
  const idb = historyFactory(['old-session'], { delay: true }); let release;
  const h = host({ indexedDB: idb.factory, session: session(A), url: 'https://pocket.bornforthis.cn/projects/lingotiles/', fetchHook: input => input.endsWith('/sync') ? new Promise(resolve => { release = () => resolve(Response.json({ revision: 1, entries: { RGD_MAX_WAIT: { value: 9, updatedAt: NOW - 100 } } })); }) : undefined });
  const early = h.runtime.sync.flush(); h.window.dispatchEvent(new h.window.Event('online'));
  await pause(); assert.equal(h.window.localStorage.getItem(CLAIM_KEY), null); assert.equal(h.calls.length, 0);
  h.advance(900); await pause();
  assert.equal(typeof release, 'function'); assert.equal(JSON.parse(h.window.localStorage.getItem(CLAIM_KEY)).userId, A);
  h.advance(900); await h.runtime.ready;
  assert.equal(h.runtime.getScope(), A); assert.equal(h.runtime.storage.getStorageSync('RGD_MAX_WAIT'), undefined);
  idb.release(); release(); await early; await pause();
  assert.equal(h.window.localStorage.getItem(SNAPSHOT_KEY), null);
  assert.equal(h.runtime.storage.getStorageSync('RGD_MAX_WAIT'), undefined);
  h.close();
});

test('history timeout and unavailable history storage never prevent login or write a late snapshot', async () => {
  const idb = historyFactory(['old-session'], { delay: true }), h = host({ indexedDB: idb.factory });
  await h.runtime.ready;
  const pending = h.runtime.client.loginPassword('alice', 'test password'); await pause();
  h.advance(900); const result = await pending;
  assert.equal(result.user.id, A); assert.equal(h.window.localStorage.getItem(SNAPSHOT_KEY), null);
  idb.release(); await pause(); assert.equal(h.window.localStorage.getItem(SNAPSHOT_KEY), null); h.close();
  const values = new Map(), rawStorage = { getItem(key) { if (key === SNAPSHOT_KEY) throw new Error('denied'); return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
  const denied = host({ rawStorage }); await denied.runtime.ready;
  assert.equal((await denied.runtime.client.loginPassword('alice', 'test password')).user.id, A);
  assert.ok(values.has(STORAGE_KEY)); denied.close();
});

test('logout during a first-login snapshot cancels the delayed authentication and leaves guest history unfrozen', async () => {
  const idb = historyFactory(['old-session'], { delay: true }), h = host({ indexedDB: idb.factory });
  await h.runtime.ready;
  const pending = h.runtime.client.loginPassword('alice', 'test password'); await pause();
  await h.runtime.client.logout(); idb.release();
  await assert.rejects(pending, error => error.code === 'operation_canceled');
  assert.equal(h.calls.length, 0); assert.equal(h.window.localStorage.getItem(SNAPSHOT_KEY), null); h.close();
});

test('email authentication shares permanent native sessions and only sends credentials to the fixed same-origin API', async () => {
  const h = host(); await h.runtime.ready;
  const events = []; h.runtime.onAccountChange(value => events.push(value));
  const loggedIn = await h.runtime.client.loginPassword(' ALICE ', 'test password');
  assert.equal(loggedIn.expiresAt, null); assert.equal(loggedIn.user.id, A);
  const request = h.calls.find(call => call.url.endsWith('/login/password'));
  assert.equal(request.url, 'https://pocket.bornforthis.cn/api/account/login/password');
  assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
  assert.equal(request.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(request.body), { identifier: 'alice', password: 'test password' });
  assert.equal(h.runtime.getScope(), A);
  assert.equal(JSON.stringify(events).includes(token(A, 2)), false);
  assert.equal(h.window.document.body.innerHTML.includes(token(A, 2)), false);
  assert.equal(JSON.stringify(loggedIn).includes(token(A, 2)), false);
  await h.runtime.client.refreshSession();
  assert.equal(h.calls.find(call => call.url.endsWith('/session')).headers.Authorization, 'Bearer ' + token(A, 2));
  await assert.rejects(h.runtime.client.loginWechat(), error => error.code === 'wechat_unavailable');
  h.close();
});

test('browser bridge forwards sync version 2 on real GET and PUT requests while keeping other routes unchanged', async () => {
  const h = host({ session: session(A) });
  await h.runtime.ready;
  await h.runtime.client.readSync();
  const read = h.calls.at(-1);
  assert.equal(read.method, 'GET'); assert.equal(new URL(read.url).pathname, '/api/account/sync');
  assert.equal(read.headers['X-Brclio-Sync-Version'], '2');
  assert.equal(read.headers.Authorization, 'Bearer ' + token(A));
  assert.equal(read.headers['Content-Type'], 'application/json');
  h.runtime.storage.setStorageSync('brclio.nursery-favorites.v1', { favorites: ['1451390672'] });
  await h.runtime.sync.flush();
  const write = h.calls.findLast(call => call.url.endsWith('/sync') && call.method === 'PUT');
  assert.equal(write.headers['X-Brclio-Sync-Version'], '2');
  assert.deepEqual(JSON.parse(write.body).entries['brclio.nursery-favorites.v1'].value, { favorites: ['1451390672'] });
  await h.runtime.client.refreshSession();
  const profile = h.calls.findLast(call => call.url.endsWith('/session'));
  assert.equal(profile.headers['X-Brclio-Sync-Version'], undefined);
  assert.ok(h.calls.every(call => new URL(call.url).search === ''));
  h.close();
});

test('registered browser sessions restore without TTL and hydrate typed sync entries before a fast module boot', async () => {
  const h = host({ url: 'https://pocket.bornforthis.cn/projects/ready-go-duel/', session: { ...session(A), expiresAt: '2020-01-01T00:00:00.000Z' } });
  h.server(A).entries.RGD_SOUND_ENABLED = { value: false, updatedAt: NOW - 100 };
  await h.runtime.ready;
  assert.equal(h.runtime.client.getCachedUser().id, A);
  assert.equal(h.runtime.storage.getStorageSync('RGD_SOUND_ENABLED'), false);
  assert.equal(h.runtime.getScope(), A);
  const prior = h.calls.length;
  assert.equal(h.runtime.startModule(), h.runtime.prepareModule());
  await h.runtime.prepareModule(); assert.equal(h.calls.length, prior);
  h.close();
});

test('module boot waits at most 1.8 seconds and a late cloud pull cannot hydrate an active game', async () => {
  let release;
  const h = host({ url: 'https://pocket.bornforthis.cn/projects/lingotiles/', session: session(A), fetchHook: input => input.endsWith('/sync') ? new Promise(resolve => { release = () => resolve(Response.json({ revision: 1, entries: { RGD_MAX_WAIT: { value: 9, updatedAt: NOW - 100 } } })); }) : undefined });
  await pause(); assert.equal(typeof release, 'function');
  h.advance(BOOT_WAIT); await h.runtime.ready;
  assert.equal(h.runtime.storage.getStorageSync('RGD_MAX_WAIT'), undefined);
  release(); await pause();
  assert.equal(h.runtime.storage.getStorageSync('RGD_MAX_WAIT'), undefined);
  assert.equal(h.runtime.sync.getStatus().pending, 0);
  h.close();
});

test('hidden portal responses are never materialized and lifecycle events flush without starting game hydration', async () => {
  const h = host({ session: session(A) }); await h.runtime.ready;
  let release; h.setHook(input => input.endsWith('/sync') ? new Promise(resolve => { release = () => resolve(Response.json({ revision: 1, entries: { RGD_CUSTOM_TITLE: { value: 'cloud title', updatedAt: NOW - 100 } } })); }) : undefined);
  const pull = h.runtime.prepare({ safe: true }); await pause();
  Object.defineProperty(h.window.document, 'hidden', { configurable: true, value: true });
  Object.defineProperty(h.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
  h.window.document.dispatchEvent(new h.window.Event('visibilitychange'));
  release(); await pull;
  assert.equal(h.runtime.storage.getStorageSync('RGD_CUSTOM_TITLE'), undefined);
  h.window.dispatchEvent(new h.window.Event('offline'));
  h.runtime.storage.setStorageSync('RGD_SOUND_ENABLED', true);
  assert.equal(h.runtime.sync.getStatus().state, 'offline');
  h.setHook(null); h.window.dispatchEvent(new h.window.Event('online')); h.advance(0); await pause(); await h.runtime.sync.flush();
  assert.equal(h.server(A).entries.RGD_SOUND_ENABLED.value, true);
  h.window.dispatchEvent(new h.window.Event('pagehide')); h.close();
});

test('cross-tab login/logout replaces the entire module instead of letting old memory write into another user', async () => {
  const h = host({ url: 'https://pocket.bornforthis.cn/projects/ready-go-duel/', session: session(A) }); await h.runtime.ready;
  const oldValue = h.window.localStorage.getItem(STORAGE_KEY), newValue = JSON.stringify(session(B));
  h.window.localStorage.setItem(STORAGE_KEY, newValue);
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: STORAGE_KEY, oldValue, newValue, storageArea: h.window.localStorage }));
  assert.equal(h.reloads, 1);
  assert.throws(() => h.runtime.storage.setStorageSync('RGD_CUSTOM_TITLE', 'old game snapshot'), { code: 'storage_unavailable' });
  assert.equal(h.window.localStorage.getItem(STORAGE_KEY), newValue);
  assert.equal(h.window.document.body.innerHTML.includes(token(B)), false);
  h.close();
});

test('profile-only cross-tab refreshes and resource changes do not reload, while clear/logout does', async () => {
  const h = host({ session: session(A) }); await h.runtime.ready;
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: STORAGE_KEY, oldValue: JSON.stringify(session(A)), newValue: JSON.stringify({ ...session(A), user: { ...user(A), displayName: 'Updated' } }) }));
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: 'lingotiles.cache.v1', oldValue: 'a', newValue: 'b' }));
  assert.equal(h.reloads, 0);
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: null }));
  assert.equal(h.reloads, 1); h.close();
});

test('same-tab account replacement also freezes an already booted module', async () => {
  const h = host({ url: 'https://pocket.bornforthis.cn/projects/lingotiles/', session: session(A) }); await h.runtime.ready;
  await h.runtime.client.loginPassword('bobby', 'test password');
  assert.equal(h.reloads, 1);
  assert.throws(() => h.runtime.storage.setStorageSync('RGD_SOUND_ENABLED', false), { code: 'storage_unavailable' });
  assert.equal(JSON.parse(h.window.localStorage.getItem(STORAGE_KEY)).user.id, B); h.close();
});

test('corrupt or denied local reads protect unknown existing business data from default overwrites', async () => {
  const h = host({ initial: [['brclio-minigame:brclio.duel.v1', '{broken-json'], ['lingotiles.progress.v1', '{unknown-progress']] }); await h.runtime.ready;
  for (const key of ['brclio.duel.v1', 'lingotiles.progress.v1']) {
    assert.throws(() => h.runtime.storage.getStorageSync(key), { code: 'storage_unavailable' });
    assert.throws(() => h.runtime.storage.setStorageSync(key, {}), { code: 'storage_unavailable' });
    assert.throws(() => h.runtime.storage.removeStorageSync(key), { code: 'storage_unavailable' });
  }
  assert.equal(h.window.localStorage.getItem('brclio-minigame:brclio.duel.v1'), '{broken-json');
  assert.equal(h.window.localStorage.getItem('lingotiles.progress.v1'), '{unknown-progress');
  assert.equal(h.calls.length, 0); h.close();
});

test('storage write failures retain the last durable value and never claim a successful queue update', async () => {
  let raw = 'old title';
  const rawStorage = { getItem(key) { return key === 'RGD_CUSTOM_TITLE' ? raw : null; }, setItem() { throw new Error('disk private details'); }, removeItem() { throw new Error('disk private details'); } };
  const h = host({ rawStorage }); await h.runtime.ready;
  assert.equal(h.runtime.storage.getStorageSync('RGD_CUSTOM_TITLE'), 'old title');
  const originalPending = h.runtime.sync.getStatus().pending;
  assert.throws(() => h.runtime.storage.setStorageSync('RGD_CUSTOM_TITLE', 'new title'), error => error.code === 'storage_unavailable' && !error.message.includes('private details'));
  assert.equal(raw, 'old title'); assert.equal(h.runtime.sync.getStatus().pending, originalPending); h.close();
});

test('provider errors are replaced with safe messages, and requests abort at the shared 45 second deadline', async () => {
  const h = host({ fetchHook: async () => Response.json({ error: 'invalid_credentials', message: 'SECRET-RAW-PROVIDER-PASSWORD', retryAfter: 2 }, { status: 401 }) }); await h.runtime.ready;
  await assert.rejects(h.runtime.client.loginPassword('alice', 'test password'), error => error.code === 'invalid_credentials' && !error.message.includes('SECRET-RAW'));
  h.setHook((_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private network diagnostics')), { once: true })));
  const request = h.runtime.client.loginPassword('alice', 'test password'); await pause();
  const call = h.calls.at(-1); h.advance(45000);
  await assert.rejects(request, error => error.code === 'network_error' && !error.message.includes('private network'));
  assert.equal(call.signal.aborted, true); h.close();
});

test('plain HTTP previews stay usable as guests and never transmit account credentials', async () => {
  const h = host({ url: 'http://localhost:8788/projects/ready-go-duel/' }); await h.runtime.ready;
  h.runtime.storage.setItem('RGD_CUSTOM_TITLE', 'Local preview');
  assert.equal(h.runtime.storage.getItem('RGD_CUSTOM_TITLE'), 'Local preview');
  await assert.rejects(h.runtime.client.loginPassword('alice', 'test password'), error => error.code === 'service_unavailable');
  assert.equal(h.calls.length, 0); h.close();
});

test('a browser IIFE installs the synchronous global and idempotent module promise without exposing Node APIs', async () => {
  const bundled = esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../web/account-browser.js')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2018' }).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><body>Game</body>', { url: 'https://pocket.bornforthis.cn/projects/ready-go-duel/', pretendToBeVisual: true, runScripts: 'outside-only' });
  dom.window.eval(bundled);
  const runtime = dom.window.BrclioAccount;
  assert.ok(runtime && runtime.client && runtime.sync && runtime.storage && runtime.ready);
  await runtime.ready;
  assert.equal(runtime.getScope(), 'guest');
  assert.equal(runtime.prepareModule(), runtime.startModule());
  assert.equal(typeof dom.window.require, 'undefined');
  assert.equal(dom.window.document.body.textContent, 'Game');
  runtime.destroy(); dom.window.close();
});


test('BFcache restoration rechecks the principal even when the frozen page missed a cross-tab storage event', async () => {
  const h = host({ url: 'https://pocket.bornforthis.cn/projects/ready-go-duel/', session: session(A) }); await h.runtime.ready;
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pagehide', { persisted: true }));
  h.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session(B)));
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(h.reloads, 1);
  assert.throws(() => h.runtime.storage.getStorageSync('RGD_SOUND_ENABLED'), { code: 'storage_unavailable' });
  assert.throws(() => h.runtime.storage.setStorageSync('RGD_SOUND_ENABLED', true), { code: 'storage_unavailable' }); h.close();
});

test('BFcache restoration for the same principal flushes pending work without hydrating the running module', async () => {
  const h = host({ url: 'https://pocket.bornforthis.cn/projects/lingotiles/', session: session(A) }); await h.runtime.ready;
  h.server(A).entries.RGD_SOUND_ENABLED = { value: false, updatedAt: NOW + 100 };
  h.server(A).revision++;
  h.runtime.storage.setStorageSync('RGD_MAX_WAIT', 7);
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pagehide', { persisted: true }));
  await h.runtime.sync.flush();
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true }));
  await h.runtime.sync.flush();
  assert.equal(h.reloads, 0);
  assert.equal(h.runtime.storage.getStorageSync('RGD_SOUND_ENABLED'), undefined);
  assert.equal(h.server(A).entries.RGD_MAX_WAIT.value, 7); h.close();
});


test('the real portal form works with the real browser bridge and shared native client, without token DOM exposure', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../web/portal/index.html'), 'utf8');
  const ui = fs.readFileSync(path.resolve(__dirname, '../web/portal/account.js'), 'utf8');
  const h = host({ html, url: 'https://pocket.bornforthis.cn/?category=mine' });
  h.window.BrclioAccount = h.runtime;
  h.window.eval(ui);
  h.window.document.dispatchEvent(new h.window.Event('DOMContentLoaded'));
  await h.runtime.ready; await pause();
  const form = h.window.document.querySelector('[data-account-form]');
  form.elements.namedItem('email').value = 'alice@example.test';
  form.elements.namedItem('code').value = '123456';
  form.elements.namedItem('consent').checked = true;
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await pause();
  assert.equal(h.runtime.client.getCachedUser().id, A);
  assert.equal(h.window.document.querySelector('[data-account-member]').hidden, false);
  assert.equal(form.elements.namedItem('code').value, '');
  const stored = JSON.parse(h.window.localStorage.getItem(STORAGE_KEY));
  assert.equal(stored.expiresAt, null);
  assert.equal(h.window.document.body.innerHTML.includes(stored.token), false);
  h.window.document.querySelector('[data-account-action="logout"]').click();
  await pause();
  assert.equal(h.runtime.client.getCachedUser(), null);
  assert.equal(h.window.document.querySelector('[data-account-member]').hidden, true);
  assert.equal(h.window.localStorage.getItem(STORAGE_KEY), null);
  assert.ok(h.calls.some(call => call.url.endsWith('/logout')));
  assert.equal(h.window.document.body.innerHTML.includes(stored.token), false); h.close();
});
