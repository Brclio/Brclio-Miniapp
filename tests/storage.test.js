'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../minigame/lib/storage.js'), 'utf8');

function fixture(value, options = {}) {
  let stored = structuredClone(value), reads = 0;
  const writes = [], module = { exports: {} };
  vm.runInNewContext(source, { module, wx: {
    getStorageSync() { reads += 1; if (options.failRead === reads) throw new Error('fixture read unavailable'); return structuredClone(stored); },
    setStorageSync(key, next) { stored = structuredClone(next); writes.push(stored); }
  } });
  return { storage: module.exports, writes, get stored() { return stored; } };
}
const match = { id: 'fixture:match-1', at: 1792500000000, names: ['红方', '蓝方'], winner: 0, scores: [3, 1], bestMs: 210 };

test('a failed storage read cannot turn a setting save or new match into a destructive default write', () => {
  const original = { targetScore: 5, haptics: false, names: ['Existing', 'Player'], matches: [match], futureLocal: { keep: true } };
  for (const operation of ['save', 'recordMatch']) {
    const f = fixture(original, { failRead: 1 });
    const success = operation === 'save' ? f.storage.save({ soundEnabled: false }) : f.storage.recordMatch({ ...match, id: 'fixture:new-match' });
    assert.equal(success, false, operation);
    assert.equal(f.writes.length, 0, operation);
    assert.deepEqual(f.stored, original);
  }
});

test('unreadable display fallback remains playable while malformed stored roots are never replaced', () => {
  const unreadable = fixture({ matches: [match] }, { failRead: 1 });
  assert.equal(unreadable.storage.read().targetScore, 3);
  assert.equal(unreadable.writes.length, 0);
  for (const value of ['incompatible fixture data', [], 42, false]) {
    const f = fixture(value);
    assert.equal(f.storage.save({ haptics: true }), false);
    assert.equal(f.storage.recordMatch(match), false);
    assert.deepEqual(f.stored, value);
    assert.equal(f.writes.length, 0);
  }
});

test('a first local game write still initializes an absent cache', () => {
  const f = fixture(undefined);
  assert.equal(f.storage.save({ soundEnabled: false }), true);
  assert.equal(f.stored.targetScore, 3);
  assert.equal(f.stored.soundEnabled, false);
  assert.deepEqual(f.stored.names, ['红方', '蓝方']);
  assert.deepEqual(f.stored.matches, []);
});

test('local settings preserve previously restored long names, history and unknown fields', () => {
  const original = { targetScore: 5, haptics: false, names: ['ABCDEFGHIJKLMNOP', '蓝方'], matches: [match], futureLocal: { keep: true } };
  const f = fixture(original);
  assert.equal(f.storage.save({ soundEnabled: false }), true);
  assert.deepEqual(f.stored.names, original.names);
  assert.deepEqual(f.stored.matches, original.matches);
  assert.deepEqual(f.stored.futureLocal, original.futureLocal);
  assert.equal(f.stored.soundEnabled, false);
});

test('native game storage uses its injected account cache without touching another account or guest', () => {
  const f = fixture({ names: ['访客', '记录'], matches: [match] });
  const values = new Map();
  const member = f.storage.createStorage({ getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, structuredClone(value)) });
  assert.equal(member.save({ soundEnabled: false }), true);
  assert.equal(member.recordMatch({ ...match, id: 'member:match' }), true);
  assert.equal(member.read().matches[0].id, 'member:match');
  assert.equal(f.storage.read().matches[0].id, match.id);
  assert.equal(f.writes.length, 0);
});
