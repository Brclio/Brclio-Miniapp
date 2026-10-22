'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fingerprintAssets, verifyFingerprintedAssets } = require('../scripts/fingerprint-assets');

const template = '<!doctype html><link rel="stylesheet" href="./main.css"><div id="root"></div><script type="module" src="./main.js"></script><a href="./match/">计分扩展</a><img src="./assets/ReadyGoDuel.png">';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const references = html => ({ js: html.match(/src="\.\/(main-[a-f0-9]{16}\.js)"/)[1], css: html.match(/href="\.\/(main-[a-f0-9]{16}\.css)"/)[1] });

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'readygo-fingerprint-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'match'));
  fs.mkdirSync(path.join(folder, 'assets'));
  fs.writeFileSync(path.join(folder, 'main.js'), 'console.log("开始 🎵");\n');
  fs.writeFileSync(path.join(folder, 'main.css'), 'html{height:100dvh}\n');
  fs.writeFileSync(path.join(folder, 'index.html'), template);
  fs.writeFileSync(path.join(folder, 'match/index.html'), '<script src="./bundle.js"></script>');
  fs.writeFileSync(path.join(folder, 'match/bundle.js'), 'console.log("score extension");');
  fs.writeFileSync(path.join(folder, 'assets/ReadyGoDuel.png'), Buffer.from([137, 80, 78, 71]));
  return folder;
}

test('final file bytes determine stable URLs and compatibility aliases remain intact', t => {
  const folder = fixture(t);
  const originalJs = fs.readFileSync(path.join(folder, 'main.js'));
  const originalCss = fs.readFileSync(path.join(folder, 'main.css'));
  const first = fingerprintAssets(folder, template);
  const second = fingerprintAssets(folder, template);
  assert.equal(first, second);
  const names = references(first);
  assert.equal(names.js, 'main-' + hash(originalJs) + '.js');
  assert.equal(names.css, 'main-' + hash(originalCss) + '.css');
  assert.deepEqual(fs.readFileSync(path.join(folder, names.js)), originalJs);
  assert.deepEqual(fs.readFileSync(path.join(folder, names.css)), originalCss);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'main.js')), originalJs);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'main.css')), originalCss);
  assert.equal(verifyFingerprintedAssets(folder, first), true);
});

test('changing JavaScript or CSS changes only the corresponding content URL', t => {
  const folder = fixture(t);
  const first = references(fingerprintAssets(folder, template));
  fs.appendFileSync(path.join(folder, 'main.js'), 'console.log("next release");');
  const changedJs = references(fingerprintAssets(folder, template));
  assert.notEqual(changedJs.js, first.js);
  assert.equal(changedJs.css, first.css);
  fs.appendFileSync(path.join(folder, 'main.css'), 'body{margin:0}');
  const changedCss = references(fingerprintAssets(folder, template));
  assert.equal(changedCss.js, changedJs.js);
  assert.notEqual(changedCss.css, changedJs.css);
});

test('missing or duplicate HTML references fail before creating fingerprint files', t => {
  const folder = fixture(t);
  const originalFiles = fs.readdirSync(folder);
  for (const invalid of [
    template.replace('src="./main.js"', 'src="./other.js"'),
    template.replace('href="./main.css"', 'href="./other.css"'),
    template + '<script src="./main.js"></script>',
    template + '<link href="./main.css">',
    template.replace('src="./main.js"', 'data-src="./main.js"')
  ]) {
    assert.throws(() => fingerprintAssets(folder, invalid), /Expected exactly one/);
    assert.deepEqual(fs.readdirSync(folder), originalFiles);
  }
});

test('fingerprinting leaves source HTML, navigation, QR and extension files unchanged', t => {
  const folder = fixture(t);
  const untouched = ['index.html', 'main.js', 'main.css', 'match/index.html', 'match/bundle.js', 'assets/ReadyGoDuel.png'];
  const before = new Map(untouched.map(file => [file, fs.readFileSync(path.join(folder, file))]));
  const html = fingerprintAssets(folder, template);
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(folder, file)), bytes, file);
  assert.equal(html, template.replace('src="./main.js"', 'src="./' + references(html).js + '"').replace('href="./main.css"', 'href="./' + references(html).css + '"'));
  assert.equal(fs.readdirSync(folder).filter(file => /^main-[a-f0-9]{16}\.(?:js|css)$/.test(file)).length, 2);
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../projects.config.json'), 'utf8'));
  assert.deepEqual(registry.projects.filter(project => project.fingerprintAssets).map(project => project.id), ['ready-go-duel']);
});

test('release verification rejects stale references, missing files and incorrect content hashes', t => {
  const folder = fixture(t);
  const html = fingerprintAssets(folder, template);
  const names = references(html);
  assert.throws(() => verifyFingerprintedAssets(folder, template), /unversioned/);
  assert.throws(() => verifyFingerprintedAssets(folder, html + '<script src="./' + names.js + '"></script>'), /Expected exactly one/);
  fs.appendFileSync(path.join(folder, names.js), 'corrupt');
  assert.throws(() => verifyFingerprintedAssets(folder, html), /fingerprint differs/);
  fs.copyFileSync(path.join(folder, 'main.js'), path.join(folder, names.js));
  fs.appendFileSync(path.join(folder, 'main.js'), 'alias differs');
  assert.throws(() => verifyFingerprintedAssets(folder, html), /compatibility alias/);
  fs.copyFileSync(path.join(folder, names.js), path.join(folder, 'main.js'));
  fs.unlinkSync(path.join(folder, names.css));
  assert.throws(() => verifyFingerprintedAssets(folder, html), /ENOENT/);
});
