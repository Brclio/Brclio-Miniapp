'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('a maximum-size avatar request validates and stages original bytes with a bounded JavaScript heap', () => {
  // Run separately so a regression cannot exhaust the test runner. The upload
  // path must fit well below Workers' 128 MiB budget; iterating a base64-decoded
  // string through Uint8Array.from previously needed about 300 MiB of JS heap.
  const result = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=64', '--input-type=module', '-e', `
    import fs from 'node:fs';
    import { createHash } from 'node:crypto';
    import { createAccountApi } from './web/account-api.mjs';
    const images = JSON.parse(fs.readFileSync('tests/helpers/avatar-images.json', 'utf8'));
    const id = 'a'.repeat(32), token = 'm1.' + id + '.' + 'b'.repeat(64);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    let original = Buffer.alloc(10 * 1024 * 1024, 65);
    const png = Buffer.from(images['image/png'], 'base64');
    // Keep the actual image, inserting one valid ancillary text chunk before
    // IEND to reach exactly 10 MiB without changing the decoded dimensions.
    original.set(png.subarray(0, png.length - 12));
    const offset = png.length - 12, textLength = original.length - png.length - 12;
    original.writeUInt32BE(textLength, offset); original.write('tEXt', offset + 4);
    original.write('Comment', offset + 8); original[offset + 15] = 0;
    let crc = 0xffffffff;
    for (let i = offset + 4; i < offset + 8 + textLength; i++) {
      crc ^= original[i];
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    original.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + textLength);
    original.set(png.subarray(png.length - 12), original.length - 12);
    const expectedHash = createHash('sha256').update(original).digest('hex');
    let body = JSON.stringify({ original: { mimeType: 'image/png', data: original.toString('base64') }, compressed: { mimeType: 'image/jpeg', data: images['image/jpeg'] } });
    original = null; global.gc();
    let originalBytes = 0, originalHash = '', peakHeap = 0;
    const api = createAccountApi({ storeFactory: () => ({ transaction: async fn => fn({
      get: async path => path.endsWith('/sessions.json') ? { items: [{ hash: tokenHash, expiresAt: null }] } : path.endsWith('/profile.json') ? { id, status: 'active', avatar: { type: 'builtin', id: 1 } } : null,
      put() {},
      putBinary(path, bytes) {
        peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
        if (path.includes('/original.')) { originalBytes = bytes.length; originalHash = createHash('sha256').update(bytes).digest('hex'); }
      }
    }) }) });
    const request = new Request('https://pocket.bornforthis.cn/api/account/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body });
    body = null;
    const response = await api(request, { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: 'only-a-test-secret-with-at-least-32-characters' });
    console.log(JSON.stringify({ status: response.status, originalBytes, preserved: originalHash === expectedHash, peakHeap }));
  `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.status, 200);
  assert.equal(value.originalBytes, 10 * 1024 * 1024);
  assert.equal(value.preserved, true);
  assert.ok(value.peakHeap < 64 * 1024 * 1024);
});
