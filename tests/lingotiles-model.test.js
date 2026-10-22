'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const nativeFile = path.join(root, 'miniprogram/lib/lingotiles.js');
// Exercise the current adapter without changing the generated upload directory.
const source = require('../scripts/build-lingotiles-native').buildLingotilesNative({ write: false });
const upstream = path.join(root, 'web/projects/lingotiles/upstream/src/game');

// Exercise the pinned upstream's complete game/progress/preferences suite against
// the actual native bundle so geometry, generics, hints and validation cannot drift.
for (const unit of ['engine', 'progress', 'preferences']) {
  const filename = path.join(upstream, unit + '.test.ts');
  let original = fs.readFileSync(filename, 'utf8').replace(new RegExp("from '\\./" + unit + "\\.ts'", 'g'), 'from ' + JSON.stringify(nativeFile));
  // Browser default-storage lookup is replaced by the native persistence test below.
  if (unit === 'preferences') original = original.slice(0, original.indexOf("test('default storage lookup"));
  const compiled = esbuild.buildSync({
    stdin: { contents: original, loader: 'ts', resolveDir: upstream, sourcefile: filename },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node20', external: [nativeFile]
  }).outputFiles[0].text;
  const harness = new Module(filename, module);
  harness.filename = filename;
  harness.paths = Module._nodeModulePaths(path.dirname(filename));
  harness._compile(compiled, filename);
}

const normalize = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const files = new Map();
  const directories = new Set(['/data']);
  const storage = new Map();
  const requests = [];
  const state = { failWrite: false, failStorage: false, failStorageRead: false, failRequest: false, fileReads: 0, scope: 'guest', guestOwner: null };
  const fileSystem = {
    accessSync(name) { if (!files.has(name) && !directories.has(name)) throw new Error('ENOENT'); },
    mkdirSync(name) { directories.add(name); },
    readdirSync(directory) { return [...files.keys()].filter(name => path.dirname(name) === directory).map(name => path.basename(name)); },
    readFileSync(name) { state.fileReads++; if (!files.has(name)) throw new Error('ENOENT'); return files.get(name); },
    writeFileSync(name, text) { if (state.failWrite) throw new Error('QUOTA_EXCEEDED'); files.set(name, text); },
    renameSync(from, to) { if (!files.has(from)) throw new Error('ENOENT'); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync(name) { files.delete(name); }
  };
  const api = {
    env: { USER_DATA_PATH: '/data' },
    getFileSystemManager() { return fileSystem; },
    getStorageSync(key) { if (state.failStorageRead) throw new Error('STORAGE_UNAVAILABLE'); return storage.get(key); },
    setStorageSync(key, value) { if (state.failStorage) throw new Error('QUOTA_EXCEEDED'); storage.set(key, value); },
    request(options) {
      requests.push(options.url);
      if (state.failRequest) { options.fail(); return; }
      const pathname = new URL(options.url).pathname.replace('/projects/lingotiles/', '');
      const filename = path.join(root, 'web/projects/lingotiles/public', pathname);
      try { options.success({ statusCode: 200, data: JSON.parse(fs.readFileSync(filename, 'utf8')) }); }
      catch (_) { options.success({ statusCode: 404, data: {} }); }
    }
  };
  const native = { exports: {} };
  const scopedKey = key => state.scope === 'guest' ? key : 'scoped:' + state.scope + ':' + key;
  const syncListeners = new Set();
  const accountSync = {
    getScope: () => state.scope,
    getGuestOwner: () => state.guestOwner,
    getScopedKey: scopedKey,
    subscribe(listener) { syncListeners.add(listener); return () => syncListeners.delete(listener); },
    storage: {
      getStorageSync(key) { return api.getStorageSync(scopedKey(key)); },
      setStorageSync(key, value) { api.setStorageSync(scopedKey(key), value); },
      getItem(key) { const value = this.getStorageSync(key); return value === undefined || value === '' || value === null ? null : typeof value === 'string' ? value : JSON.stringify(value); },
      setItem(key, value) { this.setStorageSync(key, String(value)); }
    }
  };
  vm.runInNewContext(source, { module: native, exports: native.exports, wx: api, require: id => {
    if (id === './account-sync') return accountSync;
    assert.equal(id, '../config'); return { webOrigin: 'https://example.com' };
  }, setTimeout, clearTimeout, console });
  function claim(owner) {
    if (state.guestOwner === null) {
      state.guestOwner = owner;
      for (const [key, value] of [...storage]) if (key.startsWith('lingotiles.')) storage.set('scoped:' + owner + ':' + key, normalize(value));
    }
    state.scope = owner;
    for (const listener of syncListeners) listener();
  }
  return { model: native.exports, api, files, storage, requests, state, accountSync, scopedKey, claim };
}

function completion(index, changes = {}) {
  return { id: 'run-' + index, levelId: 1, levelTitle: '词汇花园', mode: 'theme', wordCount: 6,
    gameSeconds: 20 + index, studySeconds: 45, totalSeconds: 65 + index,
    score: 600, stars: 3, assists: 0, completedAt: new Date(Date.UTC(2026, 9, 21, 0, index)).toISOString(), ...changes };
}

test('native history keeps every completion across reopen, deduplicates and exports all CSV rows', async () => {
  const f = fixture();
  const history = new f.model.CompletionHistoryStore(f.api);
  const writes = await Promise.all(Array.from({ length: 260 }, (_, index) => history.append(completion(index))));
  assert.ok(writes.every(value => value.persisted && !value.duplicate));
  assert.equal((await history.append(completion(12))).duplicate, true);
  const reopened = new f.model.CompletionHistoryStore(f.api);
  const summary = await reopened.summary();
  assert.equal(summary.total, 260);
  assert.equal(summary.fastest.id, 'run-0');
  assert.equal(summary.latest.id, 'run-259');
  const page = await reopened.page({ page: 3, pageSize: 100 });
  assert.equal(page.records.length, 60);
  assert.equal(page.total, 260);
  const exported = await reopened.exportCsv();
  assert.equal(exported.csv.split('\r\n').length, 262);
  assert.ok(exported.csv.startsWith('\uFEFF'));
  assert.equal([...f.files.keys()].filter(name => name.endsWith('.json')).length, 260);
  // Opening reads the complete log once; paging, summary and export reuse immutable bodies.
  assert.equal(f.state.fileReads, 260);
});

test('history quota errors preserve temporary records and permit retry without truncating saved history', async () => {
  const f = fixture();
  const history = new f.model.CompletionHistoryStore(f.api);
  await history.append(completion(1));
  f.state.failWrite = true;
  const failed = await history.append(completion(2));
  assert.equal(failed.persisted, false);
  assert.match(failed.error, /CSV/);
  const page = await history.page();
  assert.equal(page.total, 2);
  assert.equal(page.persisted, false);
  assert.match((await history.exportCsv()).csv, /run-1/);
  assert.match((await history.exportCsv()).csv, /run-2/);
  f.state.failWrite = false;
  const retried = await history.append(completion(2));
  assert.equal(retried.persisted, true);
  assert.equal(retried.duplicate, true);
  assert.equal((await new f.model.CompletionHistoryStore(f.api).summary()).total, 2);
});

test('invalid or damaged history is surfaced and valid rows remain available', async () => {
  const f = fixture();
  const history = new f.model.CompletionHistoryStore(f.api);
  assert.equal((await history.append(completion(1, { totalSeconds: 2 }))).persisted, false);
  assert.equal((await history.page()).total, 0);
  await history.append(completion(2));
  f.files.set('/data/lingotiles-history-v1/round-bad-0.json', '{bad');
  const page = await history.page();
  assert.equal(page.total, 1);
  assert.equal(page.persisted, false);
  assert.ok(page.error);
});

test('native CSV export writes a shareable file and neutralizes spreadsheet formulas', async () => {
  const f = fixture();
  await f.model.appendCompletion(completion(1, { levelTitle: ' =DANGEROUS()' }));
  const exported = await f.model.exportCsvFile();
  assert.ok(exported.filePath.endsWith('.csv'));
  assert.match(f.files.get(exported.filePath), /"' =DANGEROUS\(\)"/);
  f.state.failWrite = true;
  await assert.rejects(() => f.model.exportCsvFile(), /导出失败/);
});

test('native progress and animation preferences survive relaunch and report temporary quota failures', () => {
  const f = fixture();
  let progress = f.model.recordResult(f.model.loadProgress(), { id: 'result-1', levelId: 1, score: 600, stars: 3, timeSeconds: 12, wordIds: ['apple'] });
  progress = f.model.toggleSaved(progress, 'apple');
  assert.equal(f.model.saveProgress(progress), true);
  assert.equal(f.model.loadProgress().sessions, 1);
  assert.deepEqual(normalize(f.model.loadProgress().saved), ['apple']);
  assert.equal(f.model.saveMatchAnimation(true), true);
  assert.equal(f.model.loadMatchAnimation(), true);
  f.state.failStorage = true;
  progress = f.model.markSeen(progress, ['dict:melodious']);
  assert.equal(f.model.saveProgress(progress), false);
  assert.ok(f.model.loadProgress().seen.includes('dict:melodious'));
  assert.equal(f.model.saveMatchAnimation(false), false);
  assert.equal(f.model.loadMatchAnimation(), false);
});

test('a failed native progress read cannot replace the existing save with empty defaults', () => {
  const f = fixture();
  const original = f.model.toggleSaved(f.model.loadProgress(), 'apple');
  assert.equal(f.model.saveProgress(original), true);
  const bytes = f.storage.get(f.model.PROGRESS_STORAGE_KEY);
  f.state.failStorageRead = true;
  const fallback = f.model.loadProgress();
  assert.equal(fallback.saved.length, 0);
  f.state.failStorageRead = false;
  assert.equal(f.model.saveProgress(f.model.markSeen(fallback, ['leaf'])), false);
  assert.equal(f.storage.get(f.model.PROGRESS_STORAGE_KEY), bytes);
  assert.ok(f.model.loadProgress().seen.includes('leaf'));
});

test('native dictionary loads real manifest and only requested chunks, with retry after failure', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  assert.equal(f.model.LEVELS.flatMap(level => level.words).length, 54);
  f.state.failRequest = true;
  await assert.rejects(() => f.model.loadManifest(), /网络/);
  f.state.failRequest = false;
  const manifest = await f.model.loadManifest();
  assert.equal(manifest.total, 100000);
  assert.equal(manifest.stages.length, 6);
  const level = await f.model.loadCourseLevel('primary', 1);
  assert.equal(level.words.length, 6);
  assert.equal(level.id, 100001);
  assert.equal(f.requests.filter(url => url.includes('/vocabulary/primary-')).length, 1);
  await f.model.loadCourseLevel('primary', 2);
  assert.equal(f.requests.filter(url => url.includes('/vocabulary/primary-')).length, 1);
  assert.ok(f.requests.every(url => url.startsWith('https://example.com/projects/lingotiles/')));
  const resolved = await f.model.wordsByIds(level.words.map(word => word.id));
  assert.equal(resolved.length, 6);
  assert.equal(source.includes('globalThis.fetch ='), false);
});

test('theme images use hosted absolute URLs and missing senses stay exportable', () => {
  const f = fixture();
  const image = f.model.getWordIllustration(f.model.LEVELS[0].words[0]);
  assert.equal(image.src, 'https://example.com/projects/lingotiles/images/words/apple.webp');
  const word = { word: 'test-novel-sense', pos: 'n.', meaning: '没有插图的测试词义' };
  assert.equal(f.model.recordIllustrationPractice(word), true);
  assert.equal(f.model.getMissingIllustrations().length, 1);
  const exported = f.model.exportMissingIllustrationsFile();
  assert.equal(JSON.parse(f.files.get(exported)).words[0].meaning, word.meaning);
  assert.equal(f.requests.length, 0);
});

test('saved theme vocabulary resolves offline without requesting the dictionary', async () => {
  const f = fixture();
  f.state.failRequest = true;
  const words = await f.model.wordsByIds(['apple', 'leaf', 'dict:water']);
  assert.deepEqual(normalize(words.map(word => word.word)), ['apple', 'leaf', 'water']);
  assert.equal(f.requests.length, 0);
});

test('empty saved or seen searches need no full-library scan even when offline', async () => {
  const f = fixture();
  f.state.failRequest = true;
  const result = await f.model.searchVocabulary('apple', { stageId: 'primary', allowedIds: [] });
  assert.equal(result.total, 0);
  assert.equal(result.words.length, 0);
  assert.equal(f.requests.length, 0);
});

test('native illustration indexes load only the current senses and recover from unavailable requests', async () => {
  const f = fixture();
  f.state.failRequest = true;
  await assert.rejects(() => f.model.loadIllustrationManifest(), /网络/);
  f.state.failRequest = false;
  const manifest = await f.model.loadIllustrationManifest();
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'web/projects/lingotiles/public/images/words/index/manifest.json'), 'utf8'));
  assert.deepEqual([manifest.total, manifest.ready, manifest.pending], [expected.total, expected.ready, expected.pending]);
  const part = Object.values(manifest.buckets)[0];
  const words = JSON.parse(fs.readFileSync(path.join(root, 'web/projects/lingotiles/public', part.path), 'utf8'));
  const word = words.find(value => !f.model.getWordIllustration(value));
  assert.ok(word);
  await f.model.loadWordIllustrations([word]);
  const image = f.model.getWordIllustration(word);
  assert.equal(image.src, 'https://example.com/projects/lingotiles/' + word.src.replace(/^\.\//, ''));
  assert.equal(f.requests.filter(url => /index\/[a-f0-9]{2}\.json/.test(url)).length, 1);
});

const USER_A = 'a'.repeat(32);
const USER_B = 'b'.repeat(32);
const HISTORY_KEY = 'lingotiles.history.v1';

test('progress fallbacks and unreadable-save guards remain in their original account scope', () => {
  const f = fixture();
  f.state.scope = USER_A;
  const a = f.model.toggleSaved(f.model.loadProgress(), 'apple');
  assert.equal(f.model.saveProgress(a), true);
  const aKey = f.scopedKey(f.model.PROGRESS_STORAGE_KEY), original = f.storage.get(aKey);
  f.state.failStorageRead = true;
  const denied = f.model.loadProgress();
  assert.equal(denied.saved.length, 0);
  f.state.failStorageRead = false;
  f.state.scope = USER_B;
  assert.equal(f.model.saveProgress(f.model.toggleSaved(f.model.loadProgress(), 'leaf')), true);
  assert.deepEqual(normalize(f.model.loadProgress().saved), ['leaf']);
  f.state.scope = USER_A;
  assert.equal(f.model.saveProgress(f.model.markSeen(denied, ['dict:melodious'])), false);
  assert.equal(f.storage.get(aKey), original);
  assert.ok(f.model.loadProgress().seen.includes('dict:melodious'));
  f.state.scope = USER_B;
  assert.deepEqual(normalize(f.model.loadProgress().saved), ['leaf']);
  assert.equal(f.model.loadProgress().seen.includes('dict:melodious'), false);
  f.state.failStorage = true;
  assert.equal(f.model.saveMatchAnimation(true), false);
  assert.equal(f.model.loadMatchAnimation(), true);
  f.state.scope = USER_A;
  f.state.failStorage = false;
  assert.equal(f.model.loadMatchAnimation(), false);
  assert.equal(f.model.saveMatchAnimation(false), true);
  f.state.scope = USER_B;
  assert.equal(f.model.loadMatchAnimation(), true);
});

test('late history queues write only their captured account and cannot publish into the next account', async () => {
  const f = fixture();
  f.state.scope = USER_A;
  const a = f.model.appendCompletion(completion(1));
  f.state.scope = USER_B;
  const b = f.model.appendCompletion(completion(2));
  assert.equal((await a).persisted, true);
  assert.equal((await b).persisted, true);
  assert.deepEqual(normalize((await f.model.getCompletionPage()).records.map(record => record.id)), ['run-2']);
  assert.deepEqual(normalize(f.storage.get(f.scopedKey(HISTORY_KEY)).map(record => record.id)), ['run-2']);
  assert.equal(f.storage.has('scoped:' + USER_A + ':' + HISTORY_KEY), false);
  f.state.scope = USER_A;
  assert.deepEqual(normalize((await f.model.getCompletionPage()).records.map(record => record.id)), ['run-1']);
  assert.deepEqual(normalize(f.storage.get(f.scopedKey(HISTORY_KEY)).map(record => record.id)), ['run-1']);
  assert.ok([...f.files.keys()].some(name => name.includes('/users/' + USER_A + '/round-')));
  assert.ok([...f.files.keys()].some(name => name.includes('/users/' + USER_B + '/round-')));
  assert.match((await f.model.exportCompletionsCsv()).csv, /run-1/);
  assert.doesNotMatch((await f.model.exportCompletionsCsv()).csv, /run-2/);
});

test('temporary history and missing-illustration queues are isolated when accounts change', async () => {
  const f = fixture();
  f.state.scope = USER_A;
  f.state.failWrite = true;
  const pending = f.model.appendCompletion(completion(1));
  f.state.scope = USER_B;
  assert.equal((await pending).persisted, false);
  assert.equal((await f.model.getCompletionSummary()).total, 0);
  f.state.scope = USER_A;
  assert.equal((await f.model.getCompletionSummary()).total, 1);
  f.state.failWrite = false;
  assert.equal((await f.model.appendCompletion(completion(1))).persisted, true);
  f.state.failStorage = true;
  const aWord = { word: 'account-a-missing', pos: 'n.', meaning: '甲账号缺图' };
  assert.equal(f.model.recordIllustrationPractice(aWord), false);
  assert.equal(f.model.getMissingIllustrations().length, 1);
  f.state.scope = USER_B;
  f.state.failStorage = false;
  assert.equal(f.model.getMissingIllustrations().length, 0);
  assert.equal(f.model.recordIllustrationPractice({ word: 'account-b-missing', pos: 'n.', meaning: '乙账号缺图' }), true);
  f.state.scope = USER_A;
  assert.deepEqual(normalize(f.model.getMissingIllustrations().map(word => word.word)), [aWord.word]);
  f.state.scope = USER_B;
  assert.deepEqual(normalize(f.model.getMissingIllustrations().map(word => word.word)), ['account-b-missing']);
});

test('cloud history restores missing files while full local history and CSV remain uncapped', async () => {
  const f = fixture();
  f.state.scope = USER_A;
  await Promise.all(Array.from({ length: 260 }, (_, index) => f.model.appendCompletion(completion(index))));
  const key = f.scopedKey(HISTORY_KEY);
  assert.equal(f.storage.get(key).length, 200);
  assert.equal(f.storage.get(key)[0].id, 'run-259');
  assert.equal(f.storage.get(key).at(-1).id, 'run-60');
  f.storage.set(key, [completion(270), ...f.storage.get(key).slice(0, 199)]);
  const summary = await f.model.getCompletionSummary();
  assert.equal(summary.total, 261);
  assert.equal(summary.latest.id, 'run-270');
  const csv = (await f.model.exportCompletionsCsv()).csv;
  assert.equal(csv.split('\r\n').length, 263);
  assert.match(csv, /"run-0"/);
  assert.match(csv, /"run-270"/);
  assert.equal([...f.files.keys()].filter(name => name.includes('/users/' + USER_A + '/round-') && name.endsWith('.json')).length, 261);
  assert.equal(f.storage.get(key).length, 200);
  f.state.scope = USER_B;
  assert.equal((await f.model.getCompletionSummary()).total, 0);
  assert.doesNotMatch((await f.model.exportCompletionsCsv()).csv, /run-270/);
});

test('prepareHistorySync aggregates old guest files before activation and copies them to only the first owner once', async () => {
  const f = fixture();
  for (let index = 0; index < 260; index++) f.files.set('/data/lingotiles-history-v1/round-' + index.toString(16) + '-0.json', JSON.stringify(completion(index)));
  assert.equal(f.storage.has(HISTORY_KEY), false);
  assert.equal(f.model.prepareHistorySync().records.length, 260);
  assert.equal(f.storage.get(HISTORY_KEY).length, 200);
  f.claim(USER_A);
  assert.equal((await f.model.getCompletionSummary()).total, 260);
  const marker = '/data/lingotiles-history-v1/users/' + USER_A + '/guest-imported-v1.json';
  assert.equal(JSON.parse(f.files.get(marker)).owner, USER_A);
  assert.equal([...f.files.keys()].filter(name => path.dirname(name) === '/data/lingotiles-history-v1').length, 260);
  f.state.scope = 'guest';
  await f.model.appendCompletion(completion(270));
  f.state.scope = USER_A;
  assert.equal((await f.model.getCompletionSummary()).total, 260);
  assert.equal((await new f.model.CompletionHistoryStore(f.api).summary()).total, 260);
  f.claim(USER_B);
  assert.equal((await f.model.getCompletionSummary()).total, 0);
  assert.equal(f.state.guestOwner, USER_A);
  assert.equal([...f.files.keys()].filter(name => path.dirname(name) === '/data/lingotiles-history-v1').length, 261);
});

test('an interrupted first-owner history copy retries safely without deleting guest originals or duplicating records', async () => {
  const f = fixture();
  await f.model.appendCompletion(completion(1));
  await f.model.appendCompletion(completion(2));
  f.claim(USER_A);
  f.state.failWrite = true;
  const partial = await f.model.getCompletionSummary();
  assert.equal(partial.total, 2);
  assert.equal(partial.persisted, false);
  const marker = '/data/lingotiles-history-v1/users/' + USER_A + '/guest-imported-v1.json';
  assert.equal(f.files.has(marker), false);
  f.state.failWrite = false;
  const retried = await f.model.getCompletionSummary();
  assert.equal(retried.total, 2);
  assert.equal(retried.persisted, true);
  assert.equal(f.files.has(marker), true);
  assert.equal([...f.files.keys()].filter(name => name.includes('/users/' + USER_A + '/round-')).length, 2);
  assert.equal([...f.files.keys()].filter(name => path.dirname(name) === '/data/lingotiles-history-v1').length, 2);
});

test('cloud restoration remains exportable after file quota failure and retries without replacing damaged aggregates', async () => {
  const f = fixture();
  f.state.scope = USER_A;
  const key = f.scopedKey(HISTORY_KEY);
  f.storage.set(key, [completion(9)]);
  f.state.failWrite = true;
  assert.equal((await f.model.getCompletionSummary()).persisted, false);
  assert.match((await f.model.exportCompletionsCsv()).csv, /run-9/);
  f.state.failWrite = false;
  assert.equal((await f.model.getCompletionSummary()).persisted, true);
  assert.equal((await f.model.getCompletionSummary()).total, 1);
  f.storage.set(key, '{unreadable');
  await f.model.appendCompletion(completion(10));
  assert.equal(f.storage.get(key), '{unreadable');
  assert.equal((await f.model.getCompletionSummary()).total, 2);
});

test('history aggregation respects the cloud byte budget without deleting full local records', async () => {
  const f = fixture();
  f.state.scope = USER_A;
  await Promise.all(Array.from({ length: 200 }, (_, index) => f.model.appendCompletion(completion(index, { levelTitle: '词'.repeat(200), stageTitle: '阶'.repeat(200), stageId: 'stage'.repeat(40), levelId: 'level'.repeat(40) }))));
  const aggregate = f.storage.get(f.scopedKey(HISTORY_KEY));
  assert.ok(aggregate.length > 0 && aggregate.length < 200);
  assert.ok(Buffer.byteLength(JSON.stringify(aggregate)) <= 200 * 1024 - 1024);
  assert.equal(aggregate[0].id, 'run-199');
  assert.equal((await f.model.getCompletionSummary()).total, 200);
  assert.equal((await f.model.exportCompletionsCsv()).csv.split('\r\n').length, 202);
});

test('an unreadable completed migration marker cannot claim later guest records again', async () => {
  const f = fixture();
  await f.model.appendCompletion(completion(1));
  f.claim(USER_A);
  assert.equal((await f.model.getCompletionSummary()).total, 1);
  f.state.scope = 'guest';
  await f.model.appendCompletion(completion(2));
  const marker = '/data/lingotiles-history-v1/users/' + USER_A + '/guest-imported-v1.json';
  f.files.set(marker, '{unreadable');
  f.state.scope = USER_A;
  const view = await new f.model.CompletionHistoryStore(f.api).page();
  assert.equal(view.total, 1);
  assert.equal(view.persisted, false);
  assert.equal(view.records[0].id, 'run-1');
});

test('first ownership freezes guest files even when the owner opens history only after a later guest session', async () => {
  const f = fixture();
  await f.model.appendCompletion(completion(1));
  f.claim(USER_A);
  // No history method runs while the first owner is active.
  f.state.scope = 'guest';
  await f.model.appendCompletion(completion(2));
  f.state.scope = USER_A;
  const first = await f.model.getCompletionPage();
  assert.equal(first.total, 1);
  assert.equal(first.records[0].id, 'run-1');
  f.claim(USER_B);
  assert.equal((await f.model.getCompletionSummary()).total, 0);
  f.state.scope = 'guest';
  assert.equal((await f.model.getCompletionSummary()).total, 2);
});

test('a quota-failed first-owner copy retries only its frozen files after later guest play', async () => {
  const f = fixture();
  await f.model.appendCompletion(completion(1));
  f.claim(USER_A);
  f.state.failWrite = true;
  assert.equal((await f.model.getCompletionSummary()).persisted, false);
  f.state.scope = 'guest';
  f.state.failWrite = false;
  await f.model.appendCompletion(completion(2));
  f.state.scope = USER_A;
  const restored = await f.model.getCompletionPage();
  assert.equal(restored.persisted, true);
  assert.equal(restored.total, 1);
  assert.equal(restored.records[0].id, 'run-1');
});
