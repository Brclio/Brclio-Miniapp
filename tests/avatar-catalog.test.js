'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { COUNT, PAGE_SIZE, VERSION, THEMES, validId, avatarPath, avatarLabel, pageItems } = require('../miniprogram/lib/avatar-catalog');
const { NAMES } = require('../miniprogram/lib/avatar-names');
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readDesign = name => JSON.parse(fs.readFileSync(path.join(root, 'design/builtin-avatars-v2', name), 'utf8'));

test('1,000 built-in IDs retain their selection contract and use the new cache version', async () => {
  assert.equal(COUNT, 1000);
  assert.equal(PAGE_SIZE, 40);
  assert.equal(VERSION, '20261026');
  assert.equal(THEMES.length, 20);
  for (const value of [0, 1001, '1', 1.2, NaN, null, undefined]) { assert.equal(validId(value), false); assert.equal(avatarPath(value), ''); }
  assert.equal(avatarPath(1), '/avatars/0001.png?v=20261026');
  assert.equal(avatarPath(1000), '/avatars/1000.png?v=20261026');
  const { BUILTIN_AVATAR_COUNT, BUILTIN_AVATAR_VERSION, publicAvatar } = await import('../web/account-avatar.mjs');
  assert.equal(BUILTIN_AVATAR_COUNT, COUNT);
  assert.equal(BUILTIN_AVATAR_VERSION, VERSION);
  for (const id of [1, 20, 21, 1000]) {
    assert.equal(publicAvatar({ avatar: { type: 'builtin', id } }, 'https://miniapp.example').avatarUrl, 'https://miniapp.example' + avatarPath(id));
  }
  const items = Array.from({ length: 25 }, (_, page) => pageItems(page)).flat();
  assert.deepEqual(items.map(item => item.id), Array.from({ length: COUNT }, (_, index) => index + 1));
  assert.equal(pageItems(24, 40, 'https://pocket.bornforthis.cn/')[39].url, 'https://pocket.bornforthis.cn/avatars/1000.png?v=20261026');
  assert.deepEqual(pageItems(25), []);
  assert.deepEqual(pageItems(-1), []);
  assert.deepEqual(pageItems(0, 1001), []);
});

test('every page mixes all 20 themes and uses unique names from individual image_gen prompts', () => {
  const plan = readDesign('prompts.json');
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.version, VERSION);
  assert.equal(plan.mode, 'builtin-imagegen');
  assert.deepEqual(plan.themes, THEMES);
  assert.equal(plan.avatars.length, COUNT);
  assert.equal(NAMES.length, COUNT);
  assert.equal(new Set(NAMES).size, COUNT);
  assert.equal(new Set(plan.avatars.map(item => item.prompt)).size, COUNT);
  const themeTotals = Array(THEMES.length).fill(0);
  for (const [index, item] of plan.avatars.entries()) {
    assert.equal(item.id, index + 1);
    assert.equal(item.title, NAMES[index]);
    assert.equal(item.themeIndex, index % 20);
    assert.equal(item.theme, THEMES[index % 20]);
    assert.ok(item.prompt.length >= 120);
    assert.equal(avatarLabel(item.id), item.title + ' · ' + item.theme);
    themeTotals[item.themeIndex] += 1;
  }
  assert.deepEqual(themeTotals, Array(20).fill(50));
  for (let page = 0; page < 25; page++) {
    const ids = pageItems(page).map(item => item.id);
    assert.equal(new Set(ids.map(id => THEMES[(id - 1) % 20])).size, 20);
  }
  const clientSource = fs.readFileSync(path.join(root, 'miniprogram/lib/avatar-names.js'), 'utf8');
  assert.ok(Buffer.byteLength(clientSource) < 64 * 1024, 'native labels stay compact');
  assert.ok(plan.avatars.every(item => !clientSource.includes(item.prompt)), 'generation prompts stay outside client bundles');
});

test('published art contains exactly 1,000 distinct 256px image_gen PNGs with matching provenance', () => {
  const folder = path.join(root, 'web/avatars');
  assert.equal(fs.readdirSync(folder).length, COUNT);
  const assets = readDesign('assets.json');
  const plan = readDesign('prompts.json');
  assert.equal(assets.schemaVersion, 2);
  assert.equal(assets.version, VERSION);
  assert.equal(assets.mode, 'builtin-imagegen');
  assert.equal(assets.count, COUNT);
  assert.equal(assets.assets.length, COUNT);
  const displayHashes = new Set(), originalHashes = new Set();
  let totalBytes = 0;
  for (let id = 1; id <= COUNT; id++) {
    const item = assets.assets[id - 1], prompt = plan.avatars[id - 1];
    const relative = 'web/avatars/' + String(id).padStart(4, '0') + '.png';
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 256);
    assert.equal(bytes.readUInt32BE(20), 256);
    assert.equal(bytes[24], 8);
    assert.ok([2, 6].includes(bytes[25]), 'use full-color RGB or RGBA to retain the generated art');
    const chunks = [];
    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      assert.ok(offset + length + 12 <= bytes.length, 'PNG chunks are not truncated');
      if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert.equal(offset, bytes.length);
    const pixels = zlib.inflateSync(Buffer.concat(chunks));
    assert.equal(pixels.length, 256 * (1 + 256 * (bytes[25] === 6 ? 4 : 3)));
    assert.equal(item.id, id);
    assert.equal(item.path, relative);
    assert.equal(item.title, prompt.title);
    assert.equal(item.theme, prompt.theme);
    assert.equal(item.themeIndex, prompt.themeIndex);
    assert.equal(item.width, 256); assert.equal(item.height, 256);
    assert.equal(item.bytes, bytes.length);
    assert.equal(item.sha256, hash(bytes));
    assert.equal(item.generator, 'built-in image_gen');
    assert.equal(item.promptSha256, hash(prompt.prompt));
    assert.match(item.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(item.generatedAt)));
    assert.ok(item.sourceWidth >= 256 && item.sourceWidth === item.sourceHeight);
    displayHashes.add(item.sha256); originalHashes.add(item.sourceSha256);
    // Raw originals are intentionally local artifacts, and can be checked when present.
    const original = path.resolve(root, item.sourcePath);
    if (fs.existsSync(original)) assert.equal(hash(fs.readFileSync(original)), item.sourceSha256);
    totalBytes += bytes.length;
  }
  assert.equal(displayHashes.size, COUNT);
  assert.equal(originalHashes.size, COUNT);
  assert.equal(assets.totalBytes, totalBytes);
  assert.ok(totalBytes < 128 * 1024 * 1024);
  assert.match(fs.readFileSync(path.join(root, 'scripts/build-web.js'), 'utf8'), /web\/avatars/);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/assets/avatars')), false);
});
