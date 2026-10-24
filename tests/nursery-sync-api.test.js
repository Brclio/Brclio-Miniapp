'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../miniprogram/lib/account-sync-schema');
const key = native.NURSERY_FAVORITES_KEY;
const now = Date.parse('2026-10-24T02:00:00Z');
const patch = value => ({ revision: 0, entries: { [key]: { value, updatedAt: now } } });

test('nursery favorites round trip through the backend sync document with only song identifiers', async () => {
  const backend = await import('../web/account-sync.mjs');
  const value = { favorites: ['1451390672', '2079653665'] };
  assert.deepEqual([...native.SYNC_KEYS].sort(), [...backend.SYNC_KEYS].sort());
  assert.deepEqual(backend.validateSyncPatch(patch(value), now), patch(value));
  const document = backend.mergeSyncPatch({ revision: 0, entries: {} }, patch(value), now);
  assert.deepEqual(backend.readSyncDocument(document), { revision: 1, entries: patch(value).entries });
  const removed = { revision: 1, entries: { [key]: { value: { favorites: [] }, updatedAt: now + 1 } } };
  const empty = backend.mergeSyncPatch(backend.readSyncDocument(document), backend.validateSyncPatch(removed, now + 1), now + 1);
  assert.deepEqual(empty.entries[key].value, { favorites: [] });
  assert.equal(backend.SYNC_KEYS.includes(native.NURSERY_LOCAL_KEY), false);
});

test('backend rejects malformed, excessive, duplicate or private nursery fields and keeps playback local', async () => {
  const { validateSyncPatch } = await import('../web/account-sync.mjs');
  for (const value of [[], {}, { favorites: '1451390672' }, { favorites: [1451390672] }, { favorites: ['../credentials'] }, { favorites: ['1451390672', '1451390672'] },
    { favorites: Array.from({ length: 1001 }, (_, i) => String(i)) }, { favorites: [], recent: { id: '1451390672', time: 12 } }, { favorites: [], password: 'private' }]) {
    assert.throws(() => validateSyncPatch(patch(value), now), error => error.status === 400);
  }
  assert.throws(() => validateSyncPatch({ revision: 0, entries: { [native.NURSERY_LOCAL_KEY]: { value: { mode: 'shuffle', recent: null }, updatedAt: now } } }, now), error => error.code === 'sync_key_forbidden');
  assert.equal(native.normalizeValue(key, { favorites: ['bad'] }), undefined);
  assert.deepEqual(native.normalizeValue(key, { favorites: ['1451390672', '1451390672'] }), { favorites: ['1451390672'] });
  assert.equal(native.scopedKey(native.NURSERY_LOCAL_KEY), true);
});
