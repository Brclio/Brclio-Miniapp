'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { COUNT, PAGE_SIZE, MOTIFS, validId, avatarPath, avatarLabel, pageItems } = require('../miniprogram/lib/avatar-catalog');
const root = path.resolve(__dirname, '..');

test('1,000 built-in IDs have stable paths and pagination reaches every image once', () => {
  assert.equal(COUNT, 1000);
  assert.equal(PAGE_SIZE, 40);
  assert.equal(MOTIFS.length, 10);
  for (const value of [0, 1001, '1', 1.2, NaN, null, undefined]) { assert.equal(validId(value), false); assert.equal(avatarPath(value), ''); }
  assert.equal(avatarPath(1), '/avatars/0001.png');
  assert.equal(avatarPath(1000), '/avatars/1000.png');
  assert.equal(avatarLabel(101), '小狐狸 0101');
  const items = Array.from({ length: 25 }, (_, page) => pageItems(page)).flat();
  assert.deepEqual(items.map(item => item.id), Array.from({ length: COUNT }, (_, index) => index + 1));
  assert.equal(pageItems(24, 40, 'https://pocket.bornforthis.cn/')[39].url, 'https://pocket.bornforthis.cn/avatars/1000.png');
  assert.deepEqual(pageItems(25), []);
  assert.deepEqual(pageItems(-1), []);
  assert.deepEqual(pageItems(0, 1001), []);
});

test('built-in art contains 1,000 distinct, decompressible 160px PNGs within 5 MiB', () => {
  const folder = path.join(root, 'web/avatars');
  const files = fs.readdirSync(folder);
  assert.equal(files.length, COUNT);
  const hashes = new Set();
  let totalBytes = 0;
  for (let id = 1; id <= COUNT; id++) {
    const bytes = fs.readFileSync(path.join(folder, String(id).padStart(4, '0') + '.png'));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 160);
    assert.equal(bytes.readUInt32BE(20), 160);
    const chunks = [];
    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    const pixels = zlib.inflateSync(Buffer.concat(chunks));
    assert.ok(pixels.length >= 160 * 80, 'PNG must contain a full raster');
    hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));
    totalBytes += bytes.length;
  }
  assert.equal(hashes.size, COUNT);
  assert.ok(totalBytes < 5 * 1024 * 1024);
  assert.match(fs.readFileSync(path.join(root, 'scripts/build-web.js'), 'utf8'), /web\/avatars/);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/assets/avatars')), false);
});
