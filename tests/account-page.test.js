const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const account = require('../miniprogram/lib/account');
function fixture(options = {}) {
  let definition;
  const storage = new Map([[account.SESSION_KEY, { token: 'fixture-native-session-token', user: { id: 'a', username: 'fixture' } }], [account.HISTORY_KEY, { targetScore: 3, haptics: true, names: ['红方', '蓝方'], matches: [] }]]);
  const requests = [], modals = [];
  const cloud = { userId: 'a', appId: 'miniapp', version: 1, revision: 1, data: { duel: { preferences: { targetScore: 5, haptics: false, names: ['红方', '蓝方'] }, matches: [] } }, updatedAt: null };
  const api = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key),
    request(input) { requests.push(input); if (!(options.deferSecondRead && requests.length === 2)) input.success({ statusCode: 200, data: cloud }); return {abort() { input.fail(); }}; }, showModal(input) { modals.push(input); } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/account/index.js'), 'utf8'), {
    Page(value) { definition = value; }, require() { return account; }, wx: api, setInterval, clearInterval
  });
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  page.onLoad();
  return { page, storage, requests, modals, cloud };
}
async function preview(f) { await new Promise(resolve => setImmediate(resolve)); assert.equal(f.modals.length, 1); }
test('cancelled backup and restore previews send no write and never touch local challenge data', async () => {
  for (const operation of ['backup', 'restore']) {
    const f = fixture(), before = structuredClone(f.storage.get(account.HISTORY_KEY));
    const pending = f.page[operation](); await preview(f);
    assert.match(f.modals[0].content, /本机/); assert.match(f.modals[0].content, /云端/);
    f.modals[0].success({ confirm: false }); await pending;
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].method, 'GET');
    assert.deepEqual(f.storage.get(account.HISTORY_KEY), before);
  }
});
test('closing the page while an overwrite preview is open cannot commit a backup or restore', async () => {
  for (const operation of ['backup', 'restore']) {
    const f = fixture(); const pending = f.page[operation](); await preview(f);
    f.page.onUnload(); f.modals[0].success({ confirm: true }); await pending;
    assert.equal(f.requests.length, 1); assert.equal(f.storage.has(account.RESTORE_KEY), false);
  }
});
test('local challenge changes during preview invalidate the pending backup instead of writing stale data', async () => {
  const f = fixture(); const pending = f.page.backup(); await preview(f);
  f.storage.set(account.HISTORY_KEY, { ...f.storage.get(account.HISTORY_KEY), targetScore: 1 });
  f.modals[0].success({ confirm: true }); await pending;
  assert.equal(f.requests.length, 1); assert.match(f.page.data.message, /本机记录已变化/);
  assert.equal(f.storage.get(account.HISTORY_KEY).targetScore, 1);
});
test('unloading after restore confirmation aborts its second cloud read and preserves local data', async () => {
  const f = fixture({deferSecondRead: true}), before = structuredClone(f.storage.get(account.HISTORY_KEY));
  const restore = f.page.restore(); await preview(f); f.modals[0].success({confirm: true});
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 2);
  f.page.onUnload(); await restore;
  f.requests[1].success({statusCode: 200, data: f.cloud}); await Promise.resolve();
  assert.deepEqual(f.storage.get(account.HISTORY_KEY), before); assert.equal(f.storage.has(account.RESTORE_KEY), false);
});
