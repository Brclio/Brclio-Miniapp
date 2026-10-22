'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const { JSDOM } = require('jsdom');
const { createAccountSync } = require('../miniprogram/lib/account-sync');
const { createStorage } = require('../minigame/lib/storage');
const { validateCompletion, completionsToCsv } = require('../miniprogram/lib/lingotiles');
const { createHistorySnapshot } = require('../web/account-history-snapshot');
const { historyFactory } = require('./helpers/history-snapshot.cjs');
const root = path.resolve(__dirname, '..');
const code = buildSync({ entryPoints: [path.join(root, 'web/account-module.js')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const UID_A = 'a'.repeat(32), UID_B = 'b'.repeat(32);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function completion(index) { return { id: 'web-' + index, levelId: 1, levelTitle: '词汇花园', mode: 'theme', wordCount: 6, gameSeconds: index + 1, studySeconds: 3, totalSeconds: index + 4, score: 600, stars: 3, assists: 0, completedAt: new Date(Date.UTC(2026, 9, 22, 0, index)).toISOString() }; }

async function fixture(t, initial = UID_A, browser) {
  const raw = new Map(), webRaw = new Map(), documents = new Map(), writes = [], listeners = new Set(), events = new Map();
  let user = initial, starts = 0, bootReady = Promise.resolve();
  const account = {
    getCachedUser: () => user === 'guest' ? null : { id: user },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async readSync() { return clone(documents.get(user) || { revision: 0, entries: {} }); },
    async writeSync(patch) { const before = documents.get(user) || { revision: 0, entries: {} }; const next = { revision: before.revision + 1, entries: { ...before.entries, ...clone(patch.entries) } }; documents.set(user, next); writes.push({ user, patch: clone(patch) }); return clone(next); }
  };
  const sync = createAccountSync({ account, wx: {
    getStorageSync: key => clone(raw.get(key)), setStorageSync: (key, value) => raw.set(key, clone(value)), removeStorageSync: key => raw.delete(key)
  }, setTimeout: () => 1, clearTimeout() {} });
  t.after(() => sync.destroy());
  await sync.activate({ pull: true });
  const window = browser || {
    localStorage: { getItem: key => webRaw.has(key) ? webRaw.get(key) : null, setItem: (key, value) => webRaw.set(key, String(value)), removeItem: key => webRaw.delete(key) },
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    document: { hidden: false, addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); } }
  };
  window.BrclioAccount = { sync, storage: sync.storage, getScope: sync.getScope, getGuestOwner: sync.getGuestOwner,
    get ready() { return bootReady; }, startModule() { starts++; return bootReady; } };
  function load() { const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, window, TextEncoder, console }); return module.exports; }
  return { load, sync, raw, writes, documents, window, events, get starts() { return starts; }, setBoot(value) { bootReady = value; },
    async switchTo(value) { user = value; for (const listener of listeners) listener(); await sync.activate({ pull: true }); } };
}
function memoryHistory() {
  const databases = new Map(), calls = { pages: 0, append: 0 }, flags = {};
  class Store {
    constructor(_, name) { this.name = name; if (!databases.has(name)) databases.set(name, new Map()); }
    async append(record) { calls.append++; if (flags.delay && flags.id === record.id) await flags.delay; const db = databases.get(this.name), duplicate = db.has(record.id); if (!duplicate) db.set(record.id, clone(record)); return { persisted: true, duplicate }; }
    async page({ page = 1, pageSize = 20 } = {}) { calls.pages++; const records = [...databases.get(this.name).values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)); return { records: clone(records.slice((page - 1) * pageSize, page * pageSize)), total: records.length, persisted: true }; }
    async summary() { const view = await this.page({ pageSize: Number.MAX_SAFE_INTEGER }); return { total: view.total, latest: view.records[0] || null, persisted: true }; }
    async exportCsv() { const view = await this.page({ pageSize: Number.MAX_SAFE_INTEGER }); return { csv: completionsToCsv(view.records), persisted: true }; }
  }
  return { Store, databases, calls, flags };
}

test('module boot waits once and leaves lifecycle listeners to the account runtime', async t => {
  const f = await fixture(t); let release;
  f.setBoot(new Promise(resolve => { release = resolve; }));
  const module = f.load(); let ready = false;
  const first = module.moduleReady().then(() => { ready = true; });
  assert.equal(module.moduleReady(), module.moduleReady());
  await Promise.resolve(); assert.equal(ready, false); assert.equal(f.starts, 1);
  release(); await first;
  module.moduleStorage.setItem('RGD_P1_NAME', '玩家甲');
  assert.equal(f.sync.storage.getStorageSync('RGD_P1_NAME'), '玩家甲');
  assert.equal(f.events.size, 0, 'module imports add no duplicate browser lifecycle listeners');
});

test('controlled DOM storage uses shared native types and keeps reward imports local to one account', async t => {
  const f = await fixture(t), module = f.load(); await module.moduleReady();
  module.moduleStorage.setItem('RGD_CUSTOM_TITLE', '周末对决');
  module.moduleStorage.setItem('RGD_MAX_WAIT', '8');
  module.moduleStorage.setItem('RGD_SOUND_ENABLED', 'false');
  module.moduleStorage.setItem('RGD_CUSTOM_REWARDS', JSON.stringify(['仅本机彩头']));
  module.moduleStorage.setItem('RGD_CUSTOM_TS', '1792670000000');
  module.moduleStorage.setItem('lingotiles.preferences.v1', JSON.stringify({ matchAnimation: true }));
  await f.sync.flush();
  const entries = f.documents.get(UID_A).entries;
  assert.equal(entries.RGD_MAX_WAIT.value, 8);
  assert.equal(entries.RGD_SOUND_ENABLED.value, false);
  assert.equal(entries['lingotiles.preferences.v1'].value.matchAnimation, true);
  assert.equal(Object.hasOwn(entries, 'RGD_CUSTOM_REWARDS'), false);
  assert.equal(Object.hasOwn(entries, 'RGD_CUSTOM_TS'), false);
  await f.switchTo(UID_B);
  assert.throws(() => module.moduleStorage.setItem('RGD_CUSTOM_TITLE', '迟到旧页面'), /账号已变化/);
  const next = f.load(); await next.moduleReady();
  assert.equal(next.moduleStorage.getItem('RGD_CUSTOM_TITLE'), null);
  assert.equal(next.moduleStorage.getItem('RGD_CUSTOM_REWARDS'), null);
});

test('shared manual motion reduction is honored without persisting the system preference', async t => {
  const f = await fixture(t), module = f.load(); await module.moduleReady();
  const system = { matches: false, addEventListener() {}, removeEventListener() {} };
  f.window.matchMedia = query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return system; };
  assert.equal(module.moduleMotionPreference(), system);
  assert.equal(f.sync.storage.getStorageSync('lingotiles.native.reduce-motion.v1'), undefined);
  module.moduleStorage.setStorageSync('lingotiles.native.reduce-motion.v1', true);
  assert.equal(module.moduleMotionPreference().matches, true);
  module.moduleStorage.setStorageSync('lingotiles.native.reduce-motion.v1', false);
  system.matches = true;
  assert.equal(module.moduleMotionPreference(), system, 'system accessibility remains available without a manual reduction');
});

test('web history restores cloud rounds into a per-user database and exports all local rounds', async t => {
  const f = await fixture(t), module = f.load(), core = memoryHistory(); await module.moduleReady();
  const name = 'lingotiles.history.v1:user:' + UID_A;
  core.databases.set(name, new Map(Array.from({ length: 260 }, (_, index) => [completion(index).id, completion(index)])));
  module.moduleStorage.setStorageSync('lingotiles.history.v1', [completion(300)]);
  const history = module.createModuleHistory(core.Store, validateCompletion);
  await history.prepare();
  assert.equal((await history.summary()).total, 261);
  assert.equal((await history.exportCsv()).csv.split('\r\n').length, 263);
  assert.equal(module.moduleStorage.getStorageSync('lingotiles.history.v1').length, 200);
  const appends = core.calls.append, writes = f.writes.length;
  await history.page(); await history.summary(); await history.exportCsv();
  assert.equal(core.calls.append, appends, 'read-only views do not replay cloud append work');
  assert.equal(f.writes.length, writes, 'read-only views do not write cloud documents');
  await f.switchTo(UID_B);
  await assert.rejects(() => history.summary(), /账号已变化/);
  const next = f.load(); await next.moduleReady();
  assert.equal((await next.createModuleHistory(core.Store, validateCompletion).summary()).total, 0);
});

test('late IndexedDB completion writes stay in the original database and never upload into the next account', async t => {
  const f = await fixture(t), module = f.load(), core = memoryHistory(); await module.moduleReady();
  const history = module.createModuleHistory(core.Store, validateCompletion); await history.prepare();
  let release; core.flags.id = 'web-8'; core.flags.delay = new Promise(resolve => { release = resolve; });
  const pending = history.append(completion(8));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await f.switchTo(UID_B); release(); await pending;
  assert.equal(core.databases.get('lingotiles.history.v1:user:' + UID_A).has('web-8'), true);
  assert.equal(f.sync.storage.getStorageSync('lingotiles.history.v1'), undefined);
});

test('first-owner web migration freezes guest rounds before later guest play and keeps the originals', async t => {
  const f = await fixture(t, 'guest'), guestModule = f.load(), core = memoryHistory(); await guestModule.moduleReady();
  const guest = guestModule.createModuleHistory(core.Store, validateCompletion);
  await guest.append(completion(1));
  await f.switchTo(UID_A);
  // A later guest session must not add to the first owner's candidate snapshot.
  await f.switchTo('guest');
  const laterModule = f.load(); await laterModule.moduleReady();
  await laterModule.createModuleHistory(core.Store, validateCompletion).append(completion(2));
  await f.switchTo(UID_A);
  const ownerModule = f.load(); await ownerModule.moduleReady();
  const owner = ownerModule.createModuleHistory(core.Store, validateCompletion);
  assert.equal((await owner.summary()).total, 1);
  assert.equal(core.databases.get('lingotiles.history.v1').size, 2);
  await f.switchTo(UID_B);
  const otherModule = f.load(); await otherModule.moduleReady();
  assert.equal((await otherModule.createModuleHistory(core.Store, validateCompletion).summary()).total, 0);
});

test('preclaim snapshot preserves legacy guest history through portal login, logout and later guest play', async t => {
  const f = await fixture(t, 'guest'), core = memoryHistory();
  // Legacy records predate the module bridge and have never created its marker.
  core.databases.set('lingotiles.history.v1', new Map([1, 2].map(index => [completion(index).id, completion(index)])));
  f.window.indexedDB = historyFactory(() => [...core.databases.get('lingotiles.history.v1').keys()]).factory;
  const snapshot = createHistorySnapshot({ window: f.window, storage: f.window.localStorage,
    getGuestOwner: f.sync.getGuestOwner, getPrincipal: f.sync.getScope, setTimeout, clearTimeout });
  assert.equal(await snapshot(), true);
  await f.switchTo(UID_A); // The portal authenticates without opening Lingo.
  await f.switchTo('guest');
  const guestModule = f.load(); await guestModule.moduleReady();
  await guestModule.createModuleHistory(core.Store, validateCompletion).append(completion(3));
  await f.switchTo(UID_A);
  const ownerModule = f.load(); await ownerModule.moduleReady();
  assert.equal((await ownerModule.createModuleHistory(core.Store, validateCompletion).summary()).total, 2);
  assert.equal(core.databases.get('lingotiles.history.v1:user:' + UID_A).has(completion(3).id), false);
  assert.equal(core.databases.get('lingotiles.history.v1').size, 3, 'guest originals remain complete');
});

test('legacy Canvas uses the real sync core and preserves changedKeys intent', async t => {
  const ids = ['game-viewport', 'game-canvas', 'runtime-status', 'modal', 'safe-area-probe', 'toast', 'modal-title', 'modal-copy', 'modal-cancel', 'modal-confirm', 'reload', 'runtime-error', 'error-message'];
  const dom = new JSDOM('<div class="app-content">' + ids.map(id => id === 'game-canvas' ? '<canvas id="' + id + '"></canvas>' : '<div id="' + id + '"></div>').join('') + '</div>', { url: 'https://pocket.bornforthis.cn/projects/ready-go-duel/match/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const f = await fixture(t, UID_A, dom.window), options = [];
  const original = f.sync.storage.setStorageSync;
  f.sync.storage.setStorageSync = function (key, value, intent) { options.push(intent); return original.call(this, key, value, intent); };
  dom.window.eval(fs.readFileSync(path.join(root, 'web/runtime.js'), 'utf8'));
  await dom.window.__brclioBootstrap;
  const shared = createStorage(dom.window.wx);
  assert.equal(shared.save({ soundEnabled: false }), true);
  assert.deepEqual(options.at(-1), { changedKeys: ['soundEnabled'] });
  assert.equal(dom.window.wx.accountSyncSupported, true);
  await f.sync.flush();
  assert.equal(f.documents.get(UID_A).entries['brclio.duel.v1'].value.soundEnabled, false);
  await f.switchTo(UID_B);
  assert.equal(shared.save({ soundEnabled: true }), false);
});
