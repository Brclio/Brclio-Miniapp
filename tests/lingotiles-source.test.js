'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../web/projects/lingotiles');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const snapshot = read('SNAPSHOT.json');

test('all 1454 imported source and resource files retain the fixed upstream Git blob bytes', () => {
  assert.equal(snapshot.commit, 'a6a3841b846d72932301d43ddb9c30e756a22c7b');
  assert.equal(snapshot.files.length, 1454);
  for (const item of snapshot.files) {
    const local = item.path.startsWith('public/') ? item.path : 'upstream/' + item.path;
    const bytes = fs.readFileSync(path.join(root, local));
    const hash = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(bytes.length, item.bytes, item.path);
    assert.equal(hash, item.gitBlobSha, item.path);
  }
});

test('the complete dictionary has 100000 unique records with six intact stage profiles and lookup indexes', () => {
  const manifest = read('public/vocabulary/manifest.json');
  assert.equal(manifest.total, 100000);
  assert.deepEqual(manifest.stages.map(stage => stage.count), [662, 958, 3109, 5716, 8625, 80930]);
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
  assert.equal(words.size, 100000);
  for (const [letter, file] of Object.entries(manifest.lookupFiles)) {
    const lookup = read('public/' + file.replace(/^\//, ''));
    for (const spelling of Object.keys(lookup)) assert.ok(words.has(spelling), letter + ':' + spelling);
  }
});

test('every available illustration resolves to an imported image and keeps exact word/POS/meaning identity', () => {
  const manifest = read('public/images/words/index/manifest.json');
  assert.deepEqual([manifest.total, manifest.ready, manifest.pending], [100000, 1083, 98917]);
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
  assert.equal(snapshot.files.filter(file => file.path.endsWith('.webp')).length, 1083);
});

test('web rules and persistence retain upstream behavior while resources stay under the learning module', () => {
  for (const file of ['game/engine.ts', 'game/progress.ts', 'game/preferences.ts', 'game/history.ts', 'game/wordIllustrations.ts', 'data/vocabulary.ts']) assert.equal(fs.readFileSync(path.join(root, 'src', file), 'utf8'), fs.readFileSync(path.join(root, 'upstream/src', file), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'src/data/library.ts'), 'utf8'), /\/projects\/lingotiles\//);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /fonts\.googleapis|https?:\/\/.*\.js/);
});
