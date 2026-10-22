'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../web/projects/lingotiles');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const snapshot = read('SNAPSHOT.json');

test('all imported source and resource files retain their pinned upstream Git blob bytes', () => {
  assert.equal(snapshot.repository, 'https://github.com/Brclio/brclio-lingotiles');
  assert.match(snapshot.commit, /^[a-f0-9]{40}$/);
  assert.ok(snapshot.files.length > 0);
  const paths = new Set();
  for (const item of snapshot.files) {
    assert.equal(paths.has(item.path), false, item.path);
    paths.add(item.path);
    assert.match(item.path, /^(?:src\/|public\/|PRODUCT\.md$|DESIGN\.md$)/);
    assert.ok(!item.path.split('/').includes('..'));
    const local = item.path.startsWith('public/') ? item.path : 'upstream/' + item.path;
    const bytes = fs.readFileSync(path.join(root, local));
    const hash = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(bytes.length, item.bytes, item.path);
    assert.equal(hash, item.gitBlobSha, item.path);
  }
});

test('the complete dictionary matches its manifest with unique records, intact stages and lookup indexes', () => {
  const manifest = read('public/vocabulary/manifest.json');
  assert.ok(manifest.total > 0);
  assert.equal(manifest.stages.reduce((sum, stage) => sum + stage.count, 0), manifest.total);
  assert.equal(new Set(manifest.stages.map(stage => stage.id)).size, manifest.stages.length);
  const words = new Map();
  for (const stage of manifest.stages) {
    let count = 0;
    for (const chunk of stage.chunks) {
      const file = path.join(root, 'public', chunk.path.replace(/^\//, ''));
      const bytes = fs.readFileSync(file);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), chunk.sha256);
      const rows = JSON.parse(bytes);
      assert.equal(rows.length, chunk.count);
      assert.equal(chunk.start, count);
      rows.forEach(word => { assert.equal(words.has(word.word.toLowerCase()), false, word.word); words.set(word.word.toLowerCase(), word); assert.equal(word.stageId, stage.id); assert.ok(word.meaning && word.pos && word.definition); });
      count += rows.length;
    }
    assert.equal(count, stage.count);
  }
  assert.equal(words.size, manifest.total);
  const indexed = new Set();
  for (const [letter, file] of Object.entries(manifest.lookupFiles)) {
    const lookup = read('public/' + file.replace(/^\//, ''));
    for (const spelling of Object.keys(lookup)) { assert.ok(words.has(spelling), letter + ':' + spelling); indexed.add(spelling); }
  }
  assert.equal(indexed.size, words.size);
});

test('every available illustration resolves to an imported image and keeps exact word/POS/meaning identity', () => {
  const manifest = read('public/images/words/index/manifest.json');
  assert.equal(manifest.total, read('public/vocabulary/manifest.json').total);
  assert.equal(manifest.ready + manifest.pending, manifest.total);
  const seen = new Set();
  for (const bucket of Object.values(manifest.buckets)) {
    const entries = read('public/' + bucket.path);
    assert.equal(entries.length, bucket.count);
    for (const entry of entries) {
      assert.ok(entry.word && entry.pos && entry.meaning && entry.alt);
      const key = JSON.stringify([entry.word, entry.pos, entry.meaning]);
      assert.equal(seen.has(key), false);
      seen.add(key);
      assert.match(entry.src, /^\.\/images\/words\/[a-zA-Z0-9/_-]+\.webp$/);
      assert.ok(fs.existsSync(path.join(root, 'public', entry.src)));
    }
  }
  assert.equal(seen.size, manifest.ready);
  assert.equal(snapshot.files.filter(file => /^public\/images\/words\/.*\.webp$/.test(file.path)).length, manifest.ready);
});

test('web rules and persistence retain upstream behavior while resources stay under the learning module', () => {
  for (const file of ['game/engine.ts', 'game/progress.ts', 'game/preferences.ts', 'game/history.ts', 'game/wordIllustrations.ts', 'data/vocabulary.ts']) assert.equal(fs.readFileSync(path.join(root, 'src', file), 'utf8'), fs.readFileSync(path.join(root, 'upstream/src', file), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'src/data/library.ts'), 'utf8'), /\/projects\/lingotiles\//);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /fonts\.googleapis|https?:\/\/.*\.js/);
});
