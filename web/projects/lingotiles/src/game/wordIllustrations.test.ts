import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { getWordIllustration, IllustrationQueue, loadWordIllustrations, WORD_ILLUSTRATIONS } from './wordIllustrations.ts';
import { illustrationBucket } from '../data/illustrationSchema.ts';

const KEY = 'lingotiles.illustrations.pending.v1';
const apple = { word: 'apple', pos: 'n.', meaning: '苹果' };
const unseen = { word: 'unillustrated-test-word', pos: 'n.', meaning: '仅供测试的义项' };
function storage(initial = '[]') {
  const values = new Map([[KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('images match exact senses, independent of word IDs, without guessing other meanings', () => {
  assert.equal(getWordIllustration(apple)?.src, './images/words/apple.webp');
  assert.equal(getWordIllustration({ word: ' APPLE ', pos: ' n. ', meaning: ' 苹果 ' })?.src, './images/words/apple.webp');
  assert.equal(getWordIllustration({ ...apple, meaning: '苹果公司' }), null);
  assert.equal(getWordIllustration({ word: 'water', pos: 'v.', meaning: '浇水' }), null);
  assert.equal(getWordIllustration({ word: 'grow', pos: 'v.', meaning: '种植' }), null);
  assert.equal(getWordIllustration(unseen), null);
});

test('every approved illustration has a distinct project asset and meaningful alternative text', () => {
  assert.ok(WORD_ILLUSTRATIONS.length >= 6);
  assert.equal(new Set(WORD_ILLUSTRATIONS.map(item => item.src)).size, WORD_ILLUSTRATIONS.length);
  for (const item of WORD_ILLUSTRATIONS) {
    assert.ok(existsSync(new URL(`../../public/${item.src.slice(2)}`, import.meta.url)), item.src);
    assert.ok(item.alt.length > 5);
  }
});

test('actual-play queue survives reload, deduplicates and keeps distinct senses', () => {
  const store = storage();
  const queue = new IllustrationQueue(store);
  assert.equal(queue.add(unseen, '2026-09-27T00:00:00.000Z'), true);
  assert.equal(queue.add(unseen, '2026-09-27T01:00:00.000Z'), true);
  assert.equal(queue.add({ word: 'water', pos: 'v.', meaning: '浇水' }), true);
  assert.equal(queue.add(apple), true);
  const reloaded = new IllustrationQueue(store).list();
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].word, unseen.word);
  assert.equal(reloaded[0].firstPlayedAt, '2026-09-27T00:00:00.000Z');
});

test('a new approved image removes its sense from old pending batches', () => {
  const queue = new IllustrationQueue(storage(JSON.stringify([
    { ...apple, firstPlayedAt: '2026-09-27T00:00:00.000Z' },
    { ...unseen, firstPlayedAt: '2026-09-27T00:00:01.000Z' },
  ])));
  assert.deepEqual(queue.list().map(item => item.word), [unseen.word]);
});

test('malformed or denied storage cannot interrupt matching or lose in-session export data', () => {
  for (const raw of ['{broken', 'null', '{}', '[null,{},12]']) {
    const queue = new IllustrationQueue(storage(raw));
    assert.deepEqual(queue.list(), []);
    assert.equal(queue.add(unseen), true);
    assert.equal(queue.list().length, 1);
  }
  for (const store of [null, { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('quota'); } }]) {
    const queue = new IllustrationQueue(store);
    assert.equal(queue.add(unseen), false);
    assert.equal(queue.add(unseen), false);
    assert.equal(queue.list().length, 1);
    assert.equal(queue.add(apple), true);
  }
});

test('queue validates untrusted saved records and exports only the defined data fields', () => {
  const queue = new IllustrationQueue(storage(JSON.stringify([
    { ...unseen, firstPlayedAt: 'bad date' },
    { ...apple, word: '', firstPlayedAt: '2026-09-27' },
    { ...unseen, firstPlayedAt: '2026-09-27', unexpected: 'discard' },
  ])));
  assert.deepEqual(queue.list(), [{ ...unseen, firstPlayedAt: '2026-09-27' }]);
  assert.equal(queue.add({ ...unseen, meaning: '' }), false);
  assert.equal(queue.list().length, 1);
});

test('full-library pictures load only requested buckets, recover failed reads and reject unsafe paths', async () => {
  const originalFetch = globalThis.fetch;
  const remote = { word: 'test-remote-picture', pos: 'n.', meaning: '远程词义' };
  const other = { word: 'test-other-picture', pos: 'n.', meaning: '另一义项' };
  const delayed = { word: 'test-delayed-picture', pos: 'n.', meaning: '稍后加载的义项' };
  const first = illustrationBucket(remote);
  const second = illustrationBucket(other);
  const third = illustrationBucket(delayed);
  assert.equal(new Set([first, second, third]).size, 3);
  const calls: string[] = [];
  let fail = true;
  globalThis.fetch = (async input => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify({ version: 1, total: 100000, ready: 3, pending: 99997, revision: 'test', buckets: {
      [first]: { path: `images/words/index/${first}.json`, count: 1, sha256: 'fixture' },
      [second]: { path: `images/words/index/${second}.json`, count: 1, sha256: 'fixture' },
      [third]: { path: `images/words/index/${third}.json`, count: 1, sha256: 'fixture' },
    } }));
    if (url.includes(`/${first}.json`)) {
      if (fail) { fail = false; return new Response('', { status: 503 }); }
      return new Response(JSON.stringify([{ ...remote, src: './images/words/test.webp', alt: '测试词义的画面' }]));
    }
    if (url.includes(`/${third}.json`)) {
      await new Promise(resolve => setTimeout(resolve, 20));
      return new Response(JSON.stringify([{ ...delayed, src: './images/words/delayed.webp', alt: '较慢返回的正确词义画面' }]));
    }
    return new Response(JSON.stringify([{ ...other, src: 'https://invalid.example/image.webp', alt: '非本地图片' }]));
  }) as typeof fetch;
  try {
    await loadWordIllustrations([remote]);
    assert.equal(getWordIllustration(remote), null);
    await loadWordIllustrations([remote]);
    assert.equal(getWordIllustration(remote)?.src, './images/words/test.webp');
    assert.equal(calls.filter(url => url.includes(`/${second}.json`)).length, 0);
    const loadedCalls = calls.length;
    await loadWordIllustrations([remote, apple]);
    assert.equal(calls.length, loadedCalls);
    await loadWordIllustrations([other, delayed]);
    assert.equal(getWordIllustration(other), null);
    assert.equal(getWordIllustration(delayed)?.src, './images/words/delayed.webp', 'one rejected bucket must not finish a level before another valid bucket settles');
  } finally { globalThis.fetch = originalFetch; }
});
