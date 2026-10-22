'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareWebSources, validateNativeSources, replaceOnce, readTree } = require('../scripts/lingotiles-adapters');
const project = path.resolve(__dirname, '../web/projects/lingotiles');

test('mobile web source is entirely reproducible from pristine upstream plus explicit integration patches', () => {
  const expected = prepareWebSources(path.join(project, 'upstream/src'));
  const actual = readTree(path.join(project, 'src'));
  assert.deepEqual([...expected.keys()].sort(), [...actual.keys()].sort());
  for (const [file, bytes] of expected) assert.ok(bytes.equals(actual.get(file)), file);
  assert.equal(validateNativeSources(path.join(project, 'upstream/src')), true);
});

test('missing or ambiguous patch contexts stop an upstream update instead of silently dropping integration', () => {
  for (const source of ['changed', 'target target']) assert.throws(() => replaceOnce(source, 'target', 'adapted', 'test'), { code: 'LINGOTILES_ADAPTER_CONFLICT' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingotiles-patch-conflict-'));
  try {
    fs.cpSync(path.join(project, 'upstream/src'), temporary, { recursive: true });
    const library = path.join(temporary, 'data/library.ts');
    fs.writeFileSync(library, fs.readFileSync(library, 'utf8').replace('import.meta.env?.BASE_URL', 'import.meta.env.NEW_BASE_URL'));
    assert.throws(() => prepareWebSources(temporary), { code: 'LINGOTILES_ADAPTER_CONFLICT' });
    assert.throws(() => validateNativeSources(temporary), { code: 'LINGOTILES_ADAPTER_CONFLICT' });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
