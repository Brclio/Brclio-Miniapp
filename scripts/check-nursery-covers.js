'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SONGS } = require('../miniprogram/data/nursery-songs');
const root = path.resolve(__dirname, '..');

function jpegDimensions(buffer) {
  if (buffer.readUInt16BE(0) !== 0xffd8) throw new Error('Not a JPEG');
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error('Invalid JPEG segment');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    offset += length;
  }
  throw new Error('Missing JPEG dimensions');
}

function verifyNurseryCovers({ web = true } = {}) {
  const file = path.join(root, 'design/nursery-covers/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = manifest.covers;
  if (!Array.isArray(entries) || entries.length !== SONGS.length) throw new Error('Every song needs a cover manifest entry');
  const ids = new Set(), hashes = new Set();
  let totalBytes = 0;
  for (const song of SONGS) {
    const item = entries.find(cover => cover.id === song.id);
    const expectedPath = 'miniprogram' + song.cover;
    if (!item || ids.has(item.id) || item.title !== song.title || item.finalPath !== expectedPath) throw new Error('Cover mapping differs for ' + song.id);
    if (item.generator !== 'built-in image_gen' || typeof item.prompt !== 'string' || item.prompt.length < 60) throw new Error('Missing generation provenance for ' + song.id);
    const bytes = fs.readFileSync(path.join(root, expectedPath));
    const dimensions = jpegDimensions(bytes);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (dimensions.width !== 256 || dimensions.height !== 256 || item.width !== 256 || item.height !== 256) throw new Error('Cover must be 256 square: ' + song.id);
    if (bytes.length > 24 * 1024 || item.bytes !== bytes.length || item.sha256 !== hash || hashes.has(hash)) throw new Error('Invalid cover size/hash or reused cover: ' + song.id);
    if (web) {
      const relative = new URL(song.coverUrl).pathname.slice(1);
      if (new URL(song.coverUrl).origin !== 'https://pocket.bornforthis.cn' || relative !== 'assets/nursery-covers/' + song.id + '.jpg') throw new Error('Unexpected remote art location');
      if (!bytes.equals(fs.readFileSync(path.join(root, 'dist/web', relative)))) throw new Error('Web/native cover bytes differ: ' + song.id);
    }
    ids.add(song.id); hashes.add(hash); totalBytes += bytes.length;
  }
  const actual = fs.readdirSync(path.join(root, 'miniprogram/nursery/assets/covers'));
  if (actual.length !== SONGS.length || actual.some(name => !ids.has(name.replace(/\.jpg$/, '')))) throw new Error('Unexpected or missing cover files');
  if (totalBytes > 1000 * 1024) throw new Error('Cover set exceeds the 1000 KiB nursery art budget');
  return { count: ids.size, totalBytes, width: 256, height: 256 };
}

if (require.main === module) {
  try { console.log(JSON.stringify(verifyNurseryCovers(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { jpegDimensions, verifyNurseryCovers };
