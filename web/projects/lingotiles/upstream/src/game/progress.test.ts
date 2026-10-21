import assert from 'node:assert/strict';
import test from 'node:test';
import { LEVELS } from '../data/vocabulary.ts';
import { EMPTY_PROGRESS, PROGRESS_STORAGE_KEY, loadProgress, saveProgress, toggleSaved, markSeen, recordResult, getCurrentStreak } from './progress.ts';
import type { StorageLike } from './progress.ts';

function memoryStorage(initial?: string): StorageLike {
  const values = new Map(initial === undefined ? [] : [[PROGRESS_STORAGE_KEY, initial]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test('six levels contain 54 unique complete vocabulary entries', () => {
  assert.deepEqual(LEVELS.map((level) => level.words.length), [6, 8, 8, 10, 10, 12]);
  const words = LEVELS.flatMap((level) => level.words);
  assert.equal(new Set(words.map((word) => word.id)).size, 54);
  assert.equal(new Set(words.map((word) => word.word)).size, 54);
  for (const word of words) {
    assert.ok(['n.', 'v.', 'adj.', 'adv.'].includes(word.pos));
    assert.match(word.phonetic, /^\/.+\/$/);
    assert.ok(word.meaning && word.example && word.exampleZh);
  }
});

test('corrupt, null and unavailable storage recover without sharing mutable defaults', () => {
  assert.deepEqual(loadProgress(memoryStorage('{broken')), EMPTY_PROGRESS);
  assert.deepEqual(loadProgress(memoryStorage('null')), EMPTY_PROGRESS);
  assert.deepEqual(loadProgress(memoryStorage('[]')), EMPTY_PROGRESS);
  assert.deepEqual(loadProgress(null), EMPTY_PROGRESS);
  const first = loadProgress(null);
  first.saved.push('apple');
  assert.deepEqual(loadProgress(null).saved, []);
});

test('stored schema is validated, deduplicated and restricted to known words and levels', () => {
  const progress = loadProgress(memoryStorage(JSON.stringify({
    completed: {
      1: { stars: 99, bestScore: 12.9, bestTime: 3 },
      2: { stars: '3', bestScore: 10, bestTime: 20 },
      3: { stars: 2, bestScore: 10, bestTime: -3 },
      4: { stars: 0, bestScore: 10, bestTime: 20 },
      88: { stars: 3, bestScore: 10, bestTime: 20 },
    },
    seen: ['apple', 'apple', null, 'invented'],
    saved: ['leaf', 12, 'leaf'],
    sessions: -9,
    lastPlayed: '2026-02-30',
    streak: 200,
    extra: 'discard me',
  })));
  assert.deepEqual(progress, {
    completed: { 1: { stars: 3, bestScore: 12, bestTime: 3 } },
    seen: ['apple'], saved: ['leaf'], sessions: 0, lastPlayed: null, streak: 0,
  });
});

test('saving round-trips and storage errors remain nonfatal', () => {
  const storage = memoryStorage();
  const progress = markSeen(toggleSaved(EMPTY_PROGRESS, 'apple'), ['leaf']);
  assert.equal(saveProgress(progress, storage), true);
  assert.deepEqual(loadProgress(storage), progress);
  const blocked: StorageLike = {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('quota exceeded'); },
  };
  assert.deepEqual(loadProgress(blocked), EMPTY_PROGRESS);
  assert.equal(saveProgress(progress, blocked), false);
  assert.equal(saveProgress(progress, null), false);
});

test('saving and reviewing are immutable and reject unknown word ids', () => {
  const saved = toggleSaved(EMPTY_PROGRESS, 'apple');
  assert.deepEqual(saved.saved, ['apple']);
  assert.deepEqual(EMPTY_PROGRESS.saved, []);
  assert.deepEqual(toggleSaved(saved, 'apple').saved, []);
  assert.deepEqual(toggleSaved(saved, 'missing').saved, ['apple']);
  assert.deepEqual(markSeen(saved, ['apple', 'apple', 'missing']).seen, ['apple']);
  assert.deepEqual(saved.seen, []);
});

test('replays preserve independent best stars, score, and shortest time', () => {
  const playedAt = new Date(2026, 8, 27, 12);
  const first = recordResult(EMPTY_PROGRESS, { levelId: 1, stars: 3, score: 800, timeSeconds: 60, wordIds: ['apple', 'leaf'], playedAt });
  const replay = recordResult(first, { levelId: 1, stars: 2, score: 900, timeSeconds: 80, wordIds: ['water'], playedAt });
  assert.deepEqual(replay.completed['1'], { stars: 3, bestScore: 900, bestTime: 60 });
  assert.equal(replay.sessions, 2);
  assert.equal(replay.streak, 1);
  assert.equal(replay.lastPlayed, '2026-09-27');
  assert.deepEqual(replay.seen, ['apple', 'leaf', 'water']);
  assert.deepEqual(first.seen, ['apple', 'leaf']);
  assert.deepEqual(EMPTY_PROGRESS.completed, {});
});

test('streak advances once per local calendar day and resets after a gap', () => {
  const play = (progress: typeof EMPTY_PROGRESS, date: Date) => recordResult(progress, { levelId: 1, stars: 1, score: 100, timeSeconds: 20, wordIds: [], playedAt: date });
  let progress = play(EMPTY_PROGRESS, new Date(2026, 8, 30, 23, 59));
  progress = play(progress, new Date(2026, 9, 1, 0, 1));
  assert.equal(progress.streak, 2);
  progress = play(progress, new Date(2026, 9, 1, 23, 1));
  assert.equal(progress.streak, 2);
  progress = play(progress, new Date(2026, 9, 3, 12));
  assert.equal(progress.streak, 1);
});

test('current streak remains active today or yesterday and expires after a gap', () => {
  const now = new Date(2026, 8, 27, 12);
  const progress = { ...EMPTY_PROGRESS, streak: 7, lastPlayed: '2026-09-27' };
  assert.equal(getCurrentStreak(progress, now), 7);
  assert.equal(getCurrentStreak({ ...progress, lastPlayed: '2026-09-26' }, now), 7);
  assert.equal(getCurrentStreak({ ...progress, lastPlayed: '2026-09-25' }, now), 0);
  assert.equal(getCurrentStreak({ ...progress, lastPlayed: '2026-09-28' }, now), 0);
  assert.equal(getCurrentStreak(EMPTY_PROGRESS, now), 0);
  assert.equal(progress.streak, 7);
});

test('current streak follows local calendar days across month and year boundaries', () => {
  assert.equal(getCurrentStreak({ ...EMPTY_PROGRESS, streak: 4, lastPlayed: '2026-09-30' }, new Date(2026, 9, 1, 0, 1)), 4);
  assert.equal(getCurrentStreak({ ...EMPTY_PROGRESS, streak: 4, lastPlayed: '2026-12-31' }, new Date(2027, 0, 1, 23, 59)), 4);
  assert.equal(getCurrentStreak({ ...EMPTY_PROGRESS, streak: 4, lastPlayed: '2026-09-30' }, new Date(2026, 9, 2, 0, 1)), 0);
});

test('invalid results cannot manufacture completions or corrupt statistics', () => {
  const valid = { levelId: 1, stars: 2, score: 100, timeSeconds: 20, wordIds: ['apple'] };
  for (const patch of [{ levelId: 88 }, { stars: 0 }, { stars: NaN }, { score: -1 }, { score: Infinity }, { timeSeconds: -1 }]) {
    assert.deepEqual(recordResult(EMPTY_PROGRESS, { ...valid, ...patch }), EMPTY_PROGRESS);
  }
});

test('v1 progress preserves every legacy theme score and adds curriculum results', () => {
  const original = {
    completed: Object.fromEntries(LEVELS.map(level => [level.id, { stars: 3, bestScore: 500, bestTime: 61 }])),
    seen: LEVELS.flatMap(level => level.words.map(word => word.id)),
    saved: ['apple', 'future'], sessions: 23, lastPlayed: '2026-09-27', streak: 4,
  };
  const storage = memoryStorage(JSON.stringify(original));
  const loaded = loadProgress(storage);
  assert.equal(loaded.seen.length, 54);
  assert.equal(Object.keys(loaded.completed).length, 6);
  const next = recordResult(loaded, { id: 'new-round', levelId: 100001, stars: 3, score: 600, timeSeconds: 47, wordIds: ['dict:abandon'], playedAt: new Date(2026, 8, 27, 12) });
  assert.deepEqual(next.completed['1'], loaded.completed['1']);
  assert.deepEqual(next.completed['100001'], { stars: 3, bestScore: 600, bestTime: 47 });
  assert.equal(next.sessions, 24);
  assert.equal(next.seen.at(-1), 'dict:abandon');
  assert.equal(saveProgress(next, storage), true);
  assert.deepEqual(loadProgress(storage), next);
});

test('all 100000 external learned and saved ids survive without dictionary chunks loaded or truncation', () => {
  const ids = Array.from({ length: 100000 }, (_, i) => `dict:word-${i}`);
  const progress = { ...EMPTY_PROGRESS, seen: ids, saved: ids };
  const storage = memoryStorage();
  assert.equal(saveProgress(progress, storage), true);
  const loaded = loadProgress(storage);
  assert.deepEqual(loaded.seen, ids);
  assert.deepEqual(loaded.saved, ids);
  assert.equal(markSeen(loaded, ['dict:additional']).seen.length, 100001);
});

test('external ids are validated and optional per-round ids prevent duplicate summary increments', () => {
  const progress = markSeen(EMPTY_PROGRESS, ['dict:well-being', "dict:one's", 'dict:café', 'dict:', 'dict:<script>', 'dict:a\n', `dict:${'a'.repeat(201)}`]);
  assert.deepEqual(progress.seen, ['dict:well-being', "dict:one's", 'dict:café']);
  assert.deepEqual(toggleSaved(progress, 'dict:abandon').saved, ['dict:abandon']);
  const result = { id: 'unique-completed-round', levelId: 150002, stars: 2, score: 800, timeSeconds: 125, wordIds: ['dict:abandon'] };
  const first = recordResult(progress, result);
  assert.deepEqual(recordResult(first, result), first);
  const replay = recordResult(first, { ...result, id: 'different-round' });
  assert.equal(replay.sessions, 2);
});
