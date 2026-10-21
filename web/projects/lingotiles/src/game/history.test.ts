import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { CompletionHistoryStore, completionsToCsv, csvCell, validateCompletion, type CompletionRecord } from './history.ts';

function completion(id = 'round-one', patch: Partial<CompletionRecord> = {}): CompletionRecord {
  return { id, levelId: 1, levelTitle: '词汇花园', mode: 'theme', wordCount: 6, gameSeconds: 60, studySeconds: 30, totalSeconds: 90, score: 600, stars: 3, assists: 0, completedAt: '2026-09-27T08:00:00.000Z', ...patch };
}

test('history validates complete per-round timing without manufacturing missing history', () => {
  assert.equal(validateCompletion(completion()), true);
  for (const patch of [{ id: '' }, { stars: 0 }, { gameSeconds: Infinity }, { studySeconds: -1 }, { totalSeconds: 80 }, { completedAt: 'invalid' }, { round: 0 }, { wordCount: 0 }]) {
    assert.equal(validateCompletion(completion('invalid', patch)), false, JSON.stringify(patch));
  }
});

test('IndexedDB retains replays and rejects duplicate ids, including concurrent StrictMode writes', async () => {
  const factory = new IDBFactory();
  const store = new CompletionHistoryStore(factory, 'deduplicate');
  const statuses = await Promise.all([store.append(completion()), store.append(completion()), store.append(completion('second-run', { gameSeconds: 45, totalSeconds: 75 }))]);
  assert.deepEqual(statuses.map(value => [value.persisted, value.duplicate]), [[true, false], [true, true], [true, false]]);
  const summary = await store.summary();
  assert.equal(summary.total, 2);
  assert.equal(summary.fastest?.gameSeconds, 45);
  assert.equal(summary.persisted, true);
  await store.close();
  const reopened = new CompletionHistoryStore(factory, 'deduplicate');
  assert.equal((await reopened.summary()).total, 2);
  assert.equal((await reopened.append(completion('second-run', { score: 999 }))).duplicate, true);
  assert.equal((await reopened.page()).records.find(row => row.id === 'second-run')?.score, 600, 'duplicate cannot overwrite original history');
  await reopened.close();
});

test('two tabs sharing one database cannot duplicate the same completed round', async () => {
  const factory = new IDBFactory();
  const first = new CompletionHistoryStore(factory, 'multi-tab');
  const second = new CompletionHistoryStore(factory, 'multi-tab');
  const results = await Promise.all([first.append(completion()), second.append(completion())]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal((await first.summary()).total, 1);
  await first.close();
  await second.close();
});

test('history pagination and summary read all completed rounds without silent truncation', async () => {
  const store = new CompletionHistoryStore(new IDBFactory(), 'pages');
  const records = Array.from({ length: 35 }, (_, index) => completion(`run-${String(index).padStart(2, '0')}`, { completedAt: new Date(Date.UTC(2026, 8, 27, 8, index)).toISOString(), gameSeconds: 100 - index, totalSeconds: 130 - index }));
  await Promise.all(records.map(record => store.append(record)));
  const first = await store.page({ page: 1, pageSize: 12 });
  const second = await store.page({ page: 2, pageSize: 12 });
  const third = await store.page({ page: 3, pageSize: 12 });
  assert.equal(first.total, 35);
  assert.deepEqual([first.records.length, second.records.length, third.records.length], [12, 12, 11]);
  assert.equal(new Set([...first.records, ...second.records, ...third.records].map(record => record.id)).size, 35);
  assert.equal(first.records[0].id, 'run-34');
  assert.equal((await store.page({ page: 4, pageSize: 12 })).records.length, 0);
  const summary = await store.summary();
  assert.equal(summary.latest?.id, 'run-34');
  assert.equal(summary.fastest?.id, 'run-34');
  const exported = await store.exportCsv();
  assert.equal(exported.csv.trim().split('\r\n').length, 36);
  assert.equal(exported.persisted, true);
  await store.close();
});

test('unavailable storage keeps all session records while explicitly reporting persistence failure', async () => {
  const store = new CompletionHistoryStore(null);
  const first = await store.append(completion());
  assert.equal(first.persisted, false);
  assert.match(first.error ?? '', /刷新.*丢失/);
  assert.equal((await store.append(completion())).duplicate, true);
  await store.append(completion('replay', { mode: 'curriculum', levelId: 100001, stageId: 'primary', stageTitle: '小学', round: 1 }));
  assert.equal((await store.summary()).total, 2);
  assert.equal((await store.page()).persisted, false);
  const csv = await store.exportCsv();
  assert.equal(csv.persisted, false);
  assert.ok(csv.csv.includes('replay'));
  assert.equal((await store.append(completion('invalid', { stars: 0 }))).persisted, false);
  assert.equal((await store.summary()).total, 2);
  const emptyAfterRefresh = new CompletionHistoryStore(null);
  assert.equal((await emptyAfterRefresh.summary()).total, 0);
});

test('aborted transactions never claim persistence and can be retried without losing the original', async t => {
  const originalTransaction = IDBDatabase.prototype.transaction;
  const transactionMock = t.mock.method(IDBDatabase.prototype, 'transaction', function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    const transaction = originalTransaction.apply(this, args);
    if (args[1] === 'readwrite') queueMicrotask(() => transaction.abort());
    return transaction;
  });
  const store = new CompletionHistoryStore(new IDBFactory(), 'abort');
  const failed = await store.append(completion());
  assert.equal(failed.persisted, false);
  assert.equal((await store.summary()).total, 1);
  transactionMock.mock.restore();
  const retry = await store.append(completion('round-one', { score: 999 }));
  assert.equal(retry.persisted, true);
  assert.equal((await store.page()).records[0].score, 600);
  assert.equal((await store.summary()).total, 1);
  await store.close();
});

test('CSV escapes punctuation and guards formulas before exporting arbitrary stage names', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.test")'), '"\'=HYPERLINK(""https://example.test"")"');
  for (const value of ['+SUM(1,2)', '-1+2', '@command', '  =command', '\t=command', '\r=command']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('词汇, "花园"'), '"词汇, ""花园"""');
  const csv = completionsToCsv([completion('csv', { levelTitle: '=BAD()', stageTitle: '+BAD()' })]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=BAD()"'));
  assert.ok(csv.includes('"\'+BAD()"'));
  assert.ok(csv.includes('"60","30","90"'));
});
