'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { verifyNativeContract, collectBehaviorFiles, REVIEW_CODE, DEFAULT_CONTRACT, DEFAULT_SOURCE } = require('../scripts/check-lingotiles-contract');
const root = path.resolve(__dirname, '..');
const readContract = () => JSON.parse(fs.readFileSync(DEFAULT_CONTRACT, 'utf8'));

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingotiles-contract-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'upstream');
  fs.cpSync(DEFAULT_SOURCE, source, { recursive: true });
  return { temporary, source,
    write(filename, text) { const file = path.join(source, filename); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); },
    contract(value) { const file = path.join(temporary, 'NATIVE_CONTRACT.json'); fs.writeFileSync(file, JSON.stringify(value)); return file; } };
}

function reviewFailure(action, expected) {
  assert.throws(action, error => {
    assert.equal(error.code, REVIEW_CODE);
    assert.match(error.message, /审查|复审/);
    for (const [kind, names] of Object.entries(expected)) assert.deepEqual(error.changes[kind], names);
    return true;
  });
}

test('current functional sources match the explicit native review baseline without claiming full parity', () => {
  const contract = readContract();
  const result = verifyNativeContract(DEFAULT_SOURCE);
  assert.equal(result.ok, true);
  assert.equal(result.reviewedCommit, contract.reviewedCommit);
  assert.equal(result.sourceCommit, JSON.parse(fs.readFileSync(path.join(DEFAULT_SOURCE, '../SNAPSHOT.json'), 'utf8')).commit);
  assert.equal(result.checkedFiles, Object.keys(contract.files).length);
  assert.equal(result.parityClaim, 'reviewed-baseline-only');
  assert.ok(result.knownDifferences.some(value => value.feature === 'match-fusion-motion'));
  assert.ok(result.knownDifferences.some(value => value.feature === 'victory-celebration'));
  assert.equal(Object.hasOwn(collectBehaviorFiles(DEFAULT_SOURCE), 'PRODUCT.md'), true);
});

test('a newly added feature component blocks sync/build even before it appears in SNAPSHOT.json', t => {
  const f = fixture(t);
  f.write('src/components/SpacedReview.tsx', 'export default function SpacedReview() { return <button>Review</button>; }\n');
  reviewFailure(() => verifyNativeContract(f.source), { added: ['src/components/SpacedReview.tsx'], removed: [], modified: [] });
});

test('changed existing behavior, exported APIs, or PRODUCT instructions require a new native review', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.source, 'src/game/engine.ts'), '\nexport function scheduleReview() { return true; }\n');
  fs.appendFileSync(path.join(f.source, 'PRODUCT.md'), '\n新增每日复习队列，记录复习间隔。\n');
  reviewFailure(() => verifyNativeContract(f.source), { added: [], removed: [], modified: ['PRODUCT.md', 'src/game/engine.ts'] });
  try { verifyNativeContract(f.source); } catch (error) { assert.ok(error.affectedFeatures.includes('stacked-matching-and-tools')); }
});

test('removing a feature source is blocked and identifies its native review area', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.source, 'src/components/HistoryPanel.tsx'));
  reviewFailure(() => verifyNativeContract(f.source), { added: [], removed: ['src/components/HistoryPanel.tsx'], modified: [] });
  try { verifyNativeContract(f.source); } catch (error) { assert.ok(error.affectedFeatures.includes('completion-history-and-csv')); }
});

test('new executable extensions and production JSON cannot silently evade the feature inventory', t => {
  const f = fixture(t);
  f.write('src/review/schedule.json', '{"enabled":true}\n');
  f.write('src/review/lesson.mjs', 'export const interval = 7;\n');
  reviewFailure(() => verifyNativeContract(f.source), {
    added: ['src/review/lesson.mjs', 'src/review/schedule.json'], removed: [], modified: []
  });
});

test('test-only, styles, seed pictures and public-resource updates do not block unchanged native behavior', t => {
  const f = fixture(t);
  f.write('src/game/new-rule.test.ts', 'import {test} from "node:test"; test("upstream coverage",()=>{});\n');
  f.write('src/game/extra-rule.spec.tsx', 'export const testOnly = true;\n');
  f.write('src/__tests__/helper.ts', 'export function testFixture() {}\n');
  f.write('src/styles.css', '.new-picture { object-fit: contain; }\n');
  f.write('src/data/illustrations.seed.json', '[{"word":"new","src":"./images/words/new.webp"}]\n');
  f.write('public/images/words/new.webp', 'new image bytes');
  f.write('public/images/words/index/manifest.json', '{"ready":1084}\n');
  f.write('public/vocabulary/primary-001.json', '[{"word":"new"}]\n');
  const result = verifyNativeContract(f.source, { commit: 'b'.repeat(40) });
  assert.equal(result.ok, true);
  assert.equal(result.sourceCommit, 'b'.repeat(40));
  assert.equal(result.reviewedCommit, readContract().reviewedCommit);
  assert.notEqual(result.sourceCommit, result.reviewedCommit);
});

test('the checker never rewrites the review baseline when an update requires adaptation', t => {
  const f = fixture(t);
  const file = f.contract(readContract());
  const before = fs.readFileSync(file, 'utf8');
  f.write('src/new-mode.ts', 'export const mode = "listening";\n');
  reviewFailure(() => verifyNativeContract(f.source, { contractPath: file }), { added: ['src/new-mode.ts'] });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('custom review files must map every source and document partial native support explicitly', t => {
  const f = fixture(t);
  const unassigned = readContract();
  unassigned.features = unassigned.features.filter(feature => feature.id !== 'word-illustration-index-and-fallback');
  assert.throws(() => verifyNativeContract(f.source, { contractPath: f.contract(unassigned) }), /未分配原生适配审查/);
  const hiddenGap = readContract();
  hiddenGap.knownDifferences = hiddenGap.knownDifferences.filter(value => value.feature !== 'victory-celebration');
  assert.throws(() => verifyNativeContract(f.source, { contractPath: f.contract(hiddenGap) }), /不能宣称完整对齐/);
  const malformed = readContract(); malformed.reviewedCommit = 'main';
  assert.throws(() => verifyNativeContract(f.source, { contractPath: f.contract(malformed) }), /契约格式/);
});

test('feature inventory rejects source symlinks rather than reading unreviewed external files', t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(DEFAULT_SOURCE, 'src/App.tsx'), path.join(f.source, 'src/linked-feature.tsx'));
  assert.throws(() => verifyNativeContract(f.source), /符号链接/);
});

test('the native bundle exposes the reviewed API and every mapped native handler remains callable', () => {
  const contract = readContract();
  const runtime = require('../miniprogram/lib/lingotiles');
  const exports = Object.fromEntries(Object.keys(runtime).sort().map(key => [key, Array.isArray(runtime[key]) ? 'array' : typeof runtime[key]]));
  assert.deepEqual(exports, contract.runtimeExports, 'Native model API changed: review caller behavior and update the explicit contract.');
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/pages/lingotiles/index.js'), 'utf8'), {
    Page(value) { page = value; },
    require(id) { if (id === '../../lib/lingotiles') return runtime; if (id === '../../config') return { webOrigin: 'https://example.test' }; throw new Error(id); }
  });
  for (const handler of contract.requiredPageHandlers) assert.equal(typeof page[handler], 'function', handler);
  for (const feature of contract.features) {
    for (const filename of feature.nativeFiles.concat(feature.regressionTests)) assert.ok(fs.existsSync(path.join(root, filename)), feature.id + ': ' + filename);
  }
  for (const filename of contract.requiredRegressionTests) assert.ok(fs.existsSync(path.join(root, filename)), filename);
});

test('CLI is reusable by build/update tooling and exits nonzero on unreviewed functional changes', t => {
  const f = fixture(t);
  const checker = path.join(root, 'scripts/check-lingotiles-contract.js');
  const valid = spawnSync(process.execPath, [checker, '--source', f.source, '--json'], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).parityClaim, 'reviewed-baseline-only');
  f.write('src/new-dictation.ts', 'export const dictation = true;\n');
  const invalid = spawnSync(process.execPath, [checker, '--source', f.source], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /新增功能源：src\/new-dictation.ts/);
  assert.match(invalid.stderr, /同步程序不得自动更新/);
});
