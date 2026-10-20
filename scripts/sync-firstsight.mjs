#!/usr/bin/env node
// Explicit source/asset import. Normal builds only consume the committed output.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'web/projects/firstsight');
const snapshot = path.join(destination, 'upstream');
const output = path.join(destination, 'original-data.json');
const repository = 'https://github.com/AndersonHJB/FirstSight';
const commit = '6fafcfd4371b00d8c956e58cb5bf689911b5fb2c';
const sourceFiles = ['types.ts', ...['gallery', 'wedding', 'family', 'baby', 'travel'].map(name => `data/${name}.ts`)];
const seed = 0x46534947;
const arguments_ = process.argv.slice(2);
const download = arguments_.includes('--download');
const sourceFlag = arguments_.indexOf('--source');
const source = sourceFlag < 0 ? null : arguments_[sourceFlag + 1];
const knownArguments = arguments_.filter((argument, index) => argument !== '--download' && argument !== '--source' && !(sourceFlag >= 0 && index === sourceFlag + 1));
if (knownArguments.length || (sourceFlag >= 0 && !source)) throw new Error('Usage: node scripts/sync-firstsight.mjs [--source /path/to/FirstSight] [--download]');

if (source) {
  const actual = execFileSync('git', ['-C', path.resolve(source), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== commit) throw new Error(`Source must be pinned to ${commit}`);
  for (const file of sourceFiles) {
    // Read committed bytes, not potentially modified working files.
    const bytes = execFileSync('git', ['-C', path.resolve(source), 'show', `${commit}:${file}`]);
    await fs.mkdir(path.dirname(path.join(snapshot, file)), { recursive: true });
    await fs.writeFile(path.join(snapshot, file), bytes);
  }
}

const checksums = {};
for (const file of sourceFiles) checksums[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(snapshot, file))).digest('hex');
if (!source) {
  const recorded = JSON.parse(await fs.readFile(path.join(snapshot, 'SNAPSHOT.json'), 'utf8'));
  if (recorded.commit !== commit || sourceFiles.some(file => recorded.files[file] !== checksums[file])) throw new Error('Upstream snapshot differs from its pinned manifest; reimport the pinned Git source explicitly.');
}
await fs.writeFile(path.join(snapshot, 'SNAPSHOT.json'), JSON.stringify({ repository, commit, files: checksums, randomSeed: seed, excludes: ['letters', 'essays', 'comments', 'video entries'] }, null, 2) + '\n');

// Imports are limited to the reviewed, committed data snapshots and their enum.
const bundled = await build({
  stdin: {
    contents: `export {GALLERY_PHOTOS} from './data/gallery'; export {WEDDING_COLLECTIONS} from './data/wedding'; export {FAMILY_PHOTOS} from './data/family'; export {BABY_PHOTOS_1,BABY_PHOTOS_2,BABY_PHOTOS_3} from './data/baby'; export {TRAVEL_TRIPS} from './data/travel';`,
    resolveDir: snapshot, sourcefile: 'firstsight-photo-entry.ts', loader: 'ts'
  },
  bundle: true, format: 'cjs', platform: 'neutral', target: ['es2020'], write: false, logLevel: 'silent'
});
let state = seed;
const seededMath = Object.create(Math);
seededMath.random = () => {
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  return state / 0x100000000;
};
const sandbox = { module: { exports: {} }, Math: seededMath };
vm.runInNewContext(bundled.outputFiles[0].text, sandbox, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
const data = sandbox.module.exports;
const raw = [
  { id: 'gallery', category: 'gallery', title: '摄影画廊', subtitle: 'FirstSight · 摄影画廊', sourceFile: 'data/gallery.ts', photos: data.GALLERY_PHOTOS },
  ...data.WEDDING_COLLECTIONS.map(collection => ({ ...collection, category: 'wedding', sourceFile: 'data/wedding.ts' })),
  { id: 'family', category: 'family', title: '家庭影像', subtitle: 'FirstSight · 家庭影像', sourceFile: 'data/family.ts', photos: data.FAMILY_PHOTOS },
  ...[data.BABY_PHOTOS_1, data.BABY_PHOTOS_2, data.BABY_PHOTOS_3].map((photos, index) => ({ id: `baby-${index + 1}`, category: 'baby', title: `成长影像 ${index + 1}`, subtitle: 'FirstSight · 原项目分组', sourceFile: 'data/baby.ts', photos })),
  ...data.TRAVEL_TRIPS.map(collection => ({ ...collection, category: 'travel', sourceFile: 'data/travel.ts' }))
];
let excludedVideoEntries = 0;
for (const collection of raw) {
  collection.photos = collection.photos.filter(photo => {
    if (photo.mediaType === 'video') { excludedVideoEntries += 1; return false; }
    return true;
  }).flatMap(photo => photo.url.map((originalUrl, imageIndex) => ({
    id: photo.url.length === 1 ? photo.id : `${photo.id}-image-${imageIndex + 1}`,
    sourceId: photo.id, imageIndex, originalUrl,
    title: photo.title, description: photo.description || '', date: photo.date || '',
    tags: [...photo.tags], ...(photo.location ? { location: photo.location } : {})
  })));
}

let previous = { assets: [] };
try { previous = JSON.parse(await fs.readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const cache = new Map(previous.assets.map(asset => [asset.originalUrl, asset]));
const urls = [...new Set(raw.flatMap(collection => [collection.cover, ...collection.photos.map(photo => photo.originalUrl)]).filter(Boolean))].sort();
const assetDirectory = path.join(destination, 'assets/original');
await fs.mkdir(assetDirectory, { recursive: true });

function dimensions(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.subarray(0, 3).toString() === 'GIF' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x00 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    const format = bytes.subarray(12, 16).toString();
    if (format === 'VP8X' && bytes.length >= 30) return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (format === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (format === 'VP8L' && bytes.length >= 25) { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  }
  throw new Error('unrecognized_image_dimensions');
}

async function importAsset(originalUrl) {
  const empty = { originalUrl, url: '', available: false };
  if (!originalUrl.startsWith('https://')) return { ...empty, loadError: true, error: 'source_local_file_missing' };
  const prior = cache.get(originalUrl);
  if (prior?.available) {
    const absolute = path.join(root, 'web', prior.url.replace(/^\//, ''));
    try {
      const bytes = await fs.readFile(absolute);
      if (crypto.createHash('sha256').update(bytes).digest('hex') === prior.sha256) return prior;
    } catch {}
  }
  if (!download) return prior?.available === false ? prior : { ...empty, loadError: true, error: 'not_downloaded' };
  try {
    const response = await fetch(originalUrl, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Brclio-FirstSight-source-import/1.0' } });
    if (!response.ok) { await response.body?.cancel(); return { ...empty, loadError: true, httpStatus: response.status, error: `http_${response.status}` }; }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType];
    if (!extension) { await response.body?.cancel(); return { ...empty, loadError: true, httpStatus: response.status, error: 'unexpected_content_type' }; }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('image_exceeds_20_mib'); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const size = dimensions(bytes);
    if (!size.width || !size.height) throw new Error('invalid_image_dimensions');
    const filename = `${crypto.createHash('sha256').update(originalUrl).digest('hex').slice(0, 20)}.${extension}`;
    await fs.writeFile(path.join(assetDirectory, filename), bytes);
    return { originalUrl, url: `/projects/firstsight/assets/original/${filename}`, available: true, loadError: false, httpStatus: response.status, contentType, bytes: bytes.length, ...size, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    return { ...empty, loadError: true, error: error.name === 'TimeoutError' ? 'request_timeout' : (['image_exceeds_20_mib', 'unrecognized_image_dimensions', 'invalid_image_dimensions'].includes(error.message) ? error.message : 'request_failed') };
  }
}

const assets = new Array(urls.length);
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const index = cursor++;
    if (index >= urls.length) return;
    assets[index] = await importAsset(urls[index]);
  }
}));
const imported = new Map(assets.map(asset => [asset.originalUrl, asset]));
const collections = raw.map(collection => {
  const photos = collection.photos.map(photo => {
    const asset = imported.get(photo.originalUrl);
    return { ...photo, url: asset.url, available: asset.available, loadError: !asset.available, ...(asset.available ? { width: asset.width, height: asset.height } : { error: asset.error }) };
  });
  const requestedCover = collection.cover || photos[0]?.originalUrl || '';
  const exact = imported.get(requestedCover);
  const fallback = photos.find(photo => photo.available);
  const cover = exact?.available ? exact.url : (fallback?.url || '');
  return {
    id: collection.id, category: collection.category, title: collection.title,
    subtitle: collection.subtitle || [collection.country, collection.place].filter(Boolean).join(' · '),
    description: collection.description || '', date: collection.date || '', sourceFile: collection.sourceFile,
    ...(collection.photographer ? { photographer: collection.photographer } : {}),
    coverOriginalUrl: requestedCover, cover, coverFallbackUsed: !exact?.available && Boolean(fallback),
    ...(cover && !exact?.available ? { coverFallbackOriginalUrl: fallback.originalUrl } : {}), photos
  };
});
const photos = collections.flatMap(collection => collection.photos);
const result = {
  schemaVersion: 1,
  source: { repository, commit, snapshotDirectory: 'upstream', randomSeed: seed },
  collections, assets,
  counts: {
    collections: collections.length, photoEntries: photos.length,
    sourcePhotoRecords: new Set(photos.map(photo => photo.sourceId)).size,
    availablePhotoEntries: photos.filter(photo => photo.available).length,
    unavailablePhotoEntries: photos.filter(photo => !photo.available).length,
    uniqueAssets: assets.length, availableAssets: assets.filter(asset => asset.available).length,
    unavailableAssets: assets.filter(asset => !asset.available).length, excludedVideoEntries,
    downloadedBytes: assets.reduce((total, asset) => total + (asset.bytes || 0), 0)
  }
};
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ sourceCommit: commit, ...result.counts }, null, 2));
for (const asset of assets.filter(asset => !asset.available)) console.log(`${asset.error}: ${asset.originalUrl}`);
