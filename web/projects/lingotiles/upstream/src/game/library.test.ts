import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  STAGE_PROFILES, courseLevelId, loadCourseLevel, loadManifest, readVocabularyPage,
  searchVocabulary, stageProfile, totalRounds, wordsByIds,
  type StageId, type VocabularyManifest,
} from '../data/library.ts';
import { LEVELS, type Word } from '../data/vocabulary.ts';

// Entirely local fixtures: these tests work before the downloadable dictionary
// exists and never need a network connection or depend on a source dictionary.
const stageCounts = [13, 19, 23, 25, 29, 99891];
const chunkCounts = [[5, 8], [10, 9], [23], [25], [29], [37, 99854]];
const calls = new Map<string, number>();
const sourceFetch = globalThis.fetch;
const manifest: VocabularyManifest = {
  version: 1, total: 100000, curatedWordCount: 54,
  stages: STAGE_PROFILES.map((profile, stageIndex) => ({
    id: profile.id, title: profile.title, count: stageCounts[stageIndex],
    chunks: chunkCounts[stageIndex].map((count, chunkIndex) => ({
      path: `/vocabulary/${profile.id}-${chunkIndex}.json`, count,
      start: chunkCounts[stageIndex].slice(0, chunkIndex).reduce((sum, value) => sum + value, 0),
    })),
  })),
  lookupFiles: { p: '/vocabulary/lookup-p.json', j: '/vocabulary/lookup-j.json', other: '/vocabulary/lookup-other.json' },
  source: { name: 'test fixture', url: 'https://example.invalid/dictionary', revision: 'fixture', csvSha256: 'fixture', license: 'fixture' },
};

function fixtureWord(stageIndex: number, index: number): Word {
  const stageId = STAGE_PROFILES[stageIndex].id;
  const original = LEVELS[stageIndex].words[index];
  const word = original?.word.toUpperCase() ?? `${stageId}-word-${String(index).padStart(5, '0')}`;
  return {
    id: `dict:${word.toLowerCase()}`, word, pos: 'n.', meaning: original ? '待覆盖的辞典含义' : `测试词义 ${stageId} ${index}`,
    phonetic: '/fixture/', example: '', exampleZh: '', stageId, rank: index,
    definition: `fixture definition ${stageId} ${index}`,
  };
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const path = new URL(input instanceof Request ? input.url : String(input), 'https://fixture.invalid').pathname;
  calls.set(path, (calls.get(path) ?? 0) + 1);
  let payload: unknown;
  if (path === '/vocabulary/manifest.json') payload = manifest;
  else if (path === '/vocabulary/lookup-p.json') payload = { 'primary-word-00012': [0, 1, 7] };
  else if (path === '/vocabulary/lookup-j.json') payload = { 'junior-word-00018': [1, 1, 8] };
  else if (path === '/vocabulary/lookup-other.json') payload = {};
  else {
    for (let stageIndex = 0; stageIndex < manifest.stages.length; stageIndex++) {
      const chunk = manifest.stages[stageIndex].chunks.find(item => item.path === path);
      if (chunk) { payload = Array.from({ length: chunk.count }, (_, index) => fixtureWord(stageIndex, chunk.start + index)); break; }
    }
  }
  return new Response(payload === undefined ? 'missing fixture' : JSON.stringify(payload), { status: payload === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
after(() => { globalThis.fetch = sourceFetch; });

test('six course stages steadily increase cards and decrease memory time per word', () => {
  assert.deepEqual(STAGE_PROFILES.map(stage => stage.id), ['primary', 'junior', 'senior', 'cet4', 'cet6', 'advanced']);
  for (let index = 1; index < STAGE_PROFILES.length; index++) {
    const previous = STAGE_PROFILES[index - 1];
    const current = STAGE_PROFILES[index];
    assert.ok(current.wordCount > previous.wordCount);
    assert.ok(current.memorySeconds / current.wordCount < previous.memorySeconds / previous.wordCount);
  }
  assert.equal(stageProfile('unknown').id, 'primary');
});

test('course IDs are stable, unique across all stages, and preserve the original six IDs', () => {
  const ids = new Set(LEVELS.map(level => level.id));
  for (const [index, profile] of STAGE_PROFILES.entries()) {
    assert.equal(courseLevelId(profile.id, 1), 100001 + index * 10000);
    for (let round = 1; round < 10000; round++) {
      const id = courseLevelId(profile.id, round);
      assert.equal(id, courseLevelId(profile.id, round));
      assert.equal(ids.has(id), false);
      ids.add(id);
    }
  }
  for (const round of [0, -1, 1.5, 10000, NaN]) assert.throws(() => courseLevelId('primary', round));
  assert.throws(() => courseLevelId('invalid' as StageId, 1));
});

test('manifest is shared and pages read continuously across chunk and stage boundaries', async () => {
  const [first, second] = await Promise.all([loadManifest(), loadManifest()]);
  assert.equal(first, second);
  assert.equal(calls.get('/vocabulary/manifest.json'), 1);
  const withinStage = await readVocabularyPage({ stageId: 'primary', page: 1, pageSize: 3 });
  assert.equal(withinStage.total, 13);
  assert.deepEqual(withinStage.words.map(word => word.word), ['grow', 'fresh', 'slowly']);
  const acrossStages = await readVocabularyPage({ page: 6, pageSize: 2 });
  assert.equal(acrossStages.total, 100000);
  assert.deepEqual(acrossStages.words.map(word => word.word), ['primary-word-00012', 'morning']);
  assert.deepEqual((await readVocabularyPage({ stageId: 'primary', page: 99 })).words, []);
});

test('every old vocabulary entry keeps its ID, meaning, pronunciation and bilingual examples', async () => {
  let seen = 0;
  for (let stageIndex = 0; stageIndex < LEVELS.length; stageIndex++) {
    const originals = LEVELS[stageIndex].words;
    const page = await readVocabularyPage({ stageId: STAGE_PROFILES[stageIndex].id, pageSize: originals.length });
    for (const [index, original] of originals.entries()) {
      assert.deepEqual(page.words[index], { ...fixtureWord(stageIndex, index), ...original });
      seen++;
    }
  }
  assert.equal(seen, 54);
  assert.deepEqual(LEVELS.map(level => level.title), ['词汇花园', '日常小事', '城市漫游', '心情调色盘', '灵感工作室', '探索远方']);
});

test('course pages span chunks and the last round uses only the remaining words', async () => {
  const first = await loadCourseLevel('primary', 1);
  assert.equal(first.words.length, 6);
  assert.equal(first.memorySeconds, STAGE_PROFILES[0].memorySeconds);
  assert.deepEqual(first.words.map(word => word.id), LEVELS[0].words.map(word => word.id));
  assert.equal(first.roundCount, 3);
  const last = await loadCourseLevel('primary', 3);
  assert.equal(last.round, 3);
  assert.equal(last.id, courseLevelId('primary', 3));
  assert.deepEqual(last.words.map(word => word.id), ['dict:primary-word-00012']);
  for (const profile of STAGE_PROFILES) {
    const stage = manifest.stages.find(item => item.id === profile.id)!;
    const roundCount = totalRounds(stage);
    const tail = await loadCourseLevel(profile.id, roundCount);
    assert.equal(tail.words.length, stage.count % profile.wordCount || profile.wordCount);
    assert.equal(tail.roundCount, roundCount);
    await assert.rejects(loadCourseLevel(profile.id, roundCount + 1), /超出/);
  }
  await assert.rejects(loadCourseLevel('primary', 0), /超出/);
  await assert.rejects(loadCourseLevel('primary', 1.5), /超出/);
});

test('ID lookup preserves requested order and legacy words while omitting missing entries', async () => {
  const found = await wordsByIds(['dict:junior-word-00018', 'apple', 'dict:primary-word-00012', 'dict:APPLE', 'dict:missing', 'dict:42-missing']);
  assert.deepEqual(found.map(word => word.id), ['dict:junior-word-00018', 'apple', 'dict:primary-word-00012', 'apple']);
  assert.deepEqual(found[1], LEVELS[0].words[0]);
  assert.deepEqual(await wordsByIds([]), []);
});

test('dictionary searches use the preserved Chinese meanings and paginate filtered results', async () => {
  const chinese = await searchVocabulary('苹果', { stageId: 'primary' });
  assert.deepEqual(chinese.words.map(word => word.id), ['apple']);
  const exact = await searchVocabulary(' APPLE ', { stageId: 'primary' });
  assert.deepEqual(exact.words.map(word => word.id), ['apple']);
  const progress: [number, number][] = [];
  const first = await searchVocabulary('primary-word', { stageId: 'primary', pageSize: 2, onProgress: (done, total) => progress.push([done, total]) });
  const second = await searchVocabulary('primary-word', { stageId: 'primary', pageSize: 2, page: 1 });
  assert.equal(first.total, 7);
  assert.equal(second.total, 7);
  assert.deepEqual(first.words.map(word => word.id), ['dict:primary-word-00006', 'dict:primary-word-00007']);
  assert.deepEqual(second.words.map(word => word.id), ['dict:primary-word-00008', 'dict:primary-word-00009']);
  assert.deepEqual(progress, [[5, 13], [13, 13]]);
  const allowed = await searchVocabulary('', { stageId: 'primary', allowedIds: ['apple', 'dict:primary-word-00012'] });
  assert.deepEqual(allowed.words.map(word => word.id), ['apple', 'dict:primary-word-00012']);
  assert.deepEqual((await searchVocabulary('', { stageId: 'primary', allowedIds: [] })).words, []);
});

test('search respects abort before searching, during scanning, and when serving cached matches', async () => {
  const early = new AbortController();
  early.abort();
  await assert.rejects(searchVocabulary('early-cancellation', { stageId: 'junior', signal: early.signal }), { name: 'AbortError' });

  const midway = new AbortController();
  let chunksScanned = 0;
  await assert.rejects(searchVocabulary('junior-word', {
    stageId: 'junior', signal: midway.signal,
    onProgress: () => { chunksScanned++; midway.abort(); },
  }), { name: 'AbortError' });
  assert.equal(chunksScanned, 1);
  // Cancellation must never publish a partial cached result.
  const complete = await searchVocabulary('junior-word', { stageId: 'junior' });
  assert.equal(complete.total, 11);
  const cached = new AbortController();
  cached.abort();
  await assert.rejects(searchVocabulary('junior-word', { stageId: 'junior', signal: cached.signal }), { name: 'AbortError' });
});

test('a corrected manifest can be loaded after a validation failure', async () => {
  const moduleUrl = new URL('../data/library.ts', import.meta.url);
  moduleUrl.searchParams.set('fixture', 'manifest-recovery');
  const isolated = await import(moduleUrl.href) as typeof import('../data/library.ts');
  const fixtureFetch = globalThis.fetch;
  let manifestRequests = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/vocabulary/manifest.json') && manifestRequests++ === 0) return new Response(JSON.stringify({ ...manifest, total: 99 }));
    return fixtureFetch(input, init);
  }) as typeof fetch;
  try {
    await assert.rejects(isolated.loadManifest(), /清单不完整/);
    assert.equal((await isolated.loadManifest()).total, 100000);
    assert.equal(manifestRequests, 2);
  } finally { globalThis.fetch = fixtureFetch; }
});

test('a corrected chunk can be loaded after a validation failure', async () => {
  const moduleUrl = new URL('../data/library.ts', import.meta.url);
  moduleUrl.searchParams.set('fixture', 'chunk-recovery');
  const isolated = await import(moduleUrl.href) as typeof import('../data/library.ts');
  const fixtureFetch = globalThis.fetch;
  let chunkRequests = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/vocabulary/primary-0.json') && chunkRequests++ === 0) return new Response('{}');
    return fixtureFetch(input, init);
  }) as typeof fetch;
  try {
    await assert.rejects(isolated.readVocabularyPage({ stageId: 'primary', pageSize: 3 }), /分片格式异常/);
    assert.equal((await isolated.readVocabularyPage({ stageId: 'primary', pageSize: 3 })).words.length, 3);
    assert.equal(chunkRequests, 2);
  } finally { globalThis.fetch = fixtureFetch; }
});
