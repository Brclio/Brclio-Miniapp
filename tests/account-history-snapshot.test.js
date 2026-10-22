'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistorySnapshot, SNAPSHOT_KEY, HISTORY_DB } = require('../web/account-history-snapshot');
const { historyFactory } = require('./helpers/history-snapshot.cjs');
const pause = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function setup(idb, options = {}) {
  const values = new Map(); let owner = null, principal = null;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  const snapshot = createHistorySnapshot({ window: { indexedDB: idb.factory, setTimeout, clearTimeout }, storage,
    getGuestOwner: () => owner, getPrincipal: () => principal, ...options });
  return { snapshot, values, setOwner(value) { owner = value; }, setPrincipal(value) { principal = value; } };
}
test('legacy guest snapshot only enumerates readonly keys and deduplicates concurrent preclaim work', async () => {
  const idb = historyFactory(['round-a', 'round-b', 'round-a', 2, '\u0000bad']), h = setup(idb);
  const first = h.snapshot(); assert.equal(first, h.snapshot()); assert.equal(await first, true);
  assert.deepEqual(JSON.parse(h.values.get(SNAPSHOT_KEY)), { version: 1, owner: null, ids: ['round-a', 'round-b'], complete: false });
  assert.deepEqual(idb.calls[0], { operation: 'open', args: [HISTORY_DB] });
  assert.deepEqual(idb.calls.find(value => value.operation === 'transaction'), { operation: 'transaction', name: 'completions', mode: 'readonly' });
  assert.equal(idb.closed, 1);
  assert.equal(await h.snapshot(), true); assert.equal(idb.calls.filter(value => value.operation === 'open').length, 1);
});
test('a missing guest database is aborted without creating a database', async () => {
  const idb = historyFactory([], { missing: true }), h = setup(idb);
  assert.equal(await h.snapshot(), true); assert.equal(idb.aborted, 1); assert.equal(idb.created, 0);
  assert.deepEqual(JSON.parse(h.values.get(SNAPSHOT_KEY)).ids, []);
});
for (const change of ['owner', 'principal']) test('a changed ' + change + ' invalidates an in-flight guest snapshot', async () => {
  const idb = historyFactory(['old-round'], { delay: true }), h = setup(idb);
  const pending = h.snapshot(); await pause();
  if (change === 'owner') h.setOwner('a'.repeat(32)); else h.setPrincipal('new session');
  idb.release(); assert.equal(await pending, false); assert.equal(h.values.has(SNAPSHOT_KEY), false); assert.equal(idb.closed, 1);
});
test('timeout closes the database and prevents its late result from writing a snapshot', async () => {
  const idb = historyFactory(['old-round'], { delay: true }); let expire;
  const h = setup(idb, { setTimeout: callback => { expire = callback; return 1; }, clearTimeout() {} });
  const pending = h.snapshot(); await pause(); expire(); assert.equal(await pending, false);
  idb.release(); assert.equal(h.values.has(SNAPSHOT_KEY), false); assert.equal(idb.closed, 1);
});
test('unknown snapshot bytes and denied storage are preserved without opening IndexedDB', async () => {
  const idb = historyFactory(['old-round']), h = setup(idb); h.values.set(SNAPSHOT_KEY, '{unknown bytes');
  assert.equal(await h.snapshot(), false); assert.equal(h.values.get(SNAPSHOT_KEY), '{unknown bytes');
  const denied = setup(idb, { storage: { getItem() { throw new Error('denied'); } } });
  assert.equal(await denied.snapshot(), false); assert.equal(idb.calls.length, 0);
});
