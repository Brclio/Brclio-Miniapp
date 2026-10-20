#!/usr/bin/env node
// Explicit, authenticated import. Offline builds consume these committed files.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'web/projects/firstsight');
const snapshot = path.join(destination, 'upstream');
const assetDirectory = path.join(destination, 'assets/original');
const output = path.join(destination, 'original-data.json');
const repositoryName = 'AndersonHJB/FirstSight_Online';
const repository = `https://github.com/${repositoryName}`;
const commit = '988cc8d0208ac2cae87b0e36b072007a856356ab';
const sourceFiles = ['types.ts', 'data/wedding.ts', 'data/baby.ts', 'data/photoAlbums.ts', 'utils/image.ts'];
const download = process.argv.slice(2).includes('--download');
if (process.argv.slice(2).some(value => value !== '--download')) throw new Error('Usage: node scripts/sync-firstsight.mjs [--download]');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blobSha = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

async function writeData(value) {
  const temporary = output + '.' + process.pid + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, output);
}

async function ghJson(endpoint) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { stdout } = await run('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
      return JSON.parse(stdout);
    } catch (error) { failure = error; }
  }
  throw new Error(`GitHub read failed for ${endpoint}: ${failure.code || 'request_failed'}`);
}

async function readBlob(entry) {
  const response = await ghJson(`repos/${repositoryName}/git/blobs/${entry.sha}`);
  if (response.encoding !== 'base64' || typeof response.content !== 'string') throw new Error(`Unsupported blob encoding: ${entry.path}`);
  const bytes = Buffer.from(response.content.replace(/\s/g, ''), 'base64');
  if (bytes.length !== entry.size || blobSha(bytes) !== entry.sha || response.sha !== entry.sha) throw new Error(`Git blob verification failed: ${entry.path}`);
  return bytes;
}

let manifest;
let index;
let tree;
await fs.mkdir(snapshot, { recursive: true });
await fs.mkdir(assetDirectory, { recursive: true });
if (download) {
  const response = await ghJson(`repos/${repositoryName}/git/trees/${commit}?recursive=1`);
  if (response.truncated || response.sha !== commit || !Array.isArray(response.tree)) throw new Error('Pinned source tree is incomplete or has changed.');
  tree = new Map(response.tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry]));
  const files = {};
  const sourceBlobs = {};
  for (const file of sourceFiles) {
    const entry = tree.get(file);
    if (!entry) throw new Error(`Missing pinned source file: ${file}`);
    let bytes;
    try { bytes = await fs.readFile(path.join(snapshot, file)); } catch {}
    if (!bytes || blobSha(bytes) !== entry.sha) bytes = await readBlob(entry);
    await fs.mkdir(path.dirname(path.join(snapshot, file)), { recursive: true });
    await fs.writeFile(path.join(snapshot, file), bytes);
    files[file] = sha256(bytes);
    sourceBlobs[file] = { blobSha: entry.sha, bytes: bytes.length, sha256: files[file] };
  }
  manifest = { repository, commit, sourceFiles, files, sourceBlobs, excludes: ['Unsplash images', 'gallery/family/travel examples', 'baby growth examples', 'duplicate pa-wedding aggregate', 'video entries', 'EXIF'] };
} else {
  manifest = JSON.parse(await fs.readFile(path.join(snapshot, 'SNAPSHOT.json'), 'utf8'));
  if (manifest.repository !== repository || manifest.commit !== commit || JSON.stringify(manifest.sourceFiles) !== JSON.stringify(sourceFiles)) throw new Error('Source snapshot is not the pinned FirstSight_Online import. Run --download explicitly.');
  for (const file of sourceFiles) {
    const bytes = await fs.readFile(path.join(snapshot, file));
    if (sha256(bytes) !== manifest.files[file] || blobSha(bytes) !== manifest.sourceBlobs[file].blobSha) throw new Error(`Source snapshot checksum mismatch: ${file}`);
  }
  const indexBytes = await fs.readFile(path.join(snapshot, 'BLOBS.json'));
  if (sha256(indexBytes) !== manifest.files['BLOBS.json']) throw new Error('Pinned asset index checksum mismatch.');
  index = JSON.parse(indexBytes);
  if (index.repository !== repository || index.commit !== commit) throw new Error('Asset index belongs to another source.');
}

// Only the pinned source is evaluated; the VM has no filesystem/network APIs.
const bundled = await build({
  stdin: { contents: "export {WEDDING_COLLECTIONS} from './data/wedding'; export {BABY_PHOTOS_PREGNANCY} from './data/baby'; export {PHOTO_ALBUM_COLLECTIONS} from './data/photoAlbums'; export {getOptimizedLocalImageUrl} from './utils/image';", resolveDir: snapshot, sourcefile: 'photo-import.ts', loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'neutral', target: ['es2020'], write: false, logLevel: 'silent'
});
const sandbox = { module: { exports: {} } };
vm.runInNewContext(bundled.outputFiles[0].text, sandbox, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
const data = sandbox.module.exports;
const pregnancy = data.PHOTO_ALBUM_COLLECTIONS.find(collection => collection.id === 'pa-pregnancy');
if (!pregnancy || pregnancy.photos.length !== 41 || data.BABY_PHOTOS_PREGNANCY.length !== 41 || data.WEDDING_COLLECTIONS.length !== 8) throw new Error('Pinned source collection structure changed.');
const paths = photos => photos.flatMap(photo => photo.url).sort();
if (JSON.stringify(paths(pregnancy.photos)) !== JSON.stringify(paths(data.BABY_PHOTOS_PREGNANCY))) throw new Error('Pregnancy aggregate differs from the source pregnancy photographs.');
const raw = [
  ...data.WEDDING_COLLECTIONS.map(collection => ({ ...collection, category: 'wedding', sourceFile: 'data/wedding.ts' })),
  { ...pregnancy, id: 'pregnancy', category: 'pregnancy', sourceId: pregnancy.id, sourceFile: 'data/photoAlbums.ts', sourcePhotoSetFile: 'data/baby.ts' }
];
const requestedUrls = raw.flatMap(collection => collection.photos.flatMap(photo => photo.url));
if (requestedUrls.length !== 169 || new Set(requestedUrls).size !== 169 || requestedUrls.some(url => !/^\/(婚纱照|孕妇照)\/.+\.(jpe?g|png)$/i.test(url))) throw new Error('Only the 169 unique local wedding/pregnancy photographs may be imported.');

function assetEntry(originalUrl) {
  const sourceOriginalPath = `public${originalUrl}`;
  // Match the pinned utils/image.ts mapping, including URL encoding semantics.
  const sourceOptimizedPath = `public${decodeURI(data.getOptimizedLocalImageUrl(originalUrl))}`;
  const source = download ? tree.get(sourceOptimizedPath) : index.assets.find(asset => asset.sourceOriginalPath === sourceOriginalPath);
  const original = download ? tree.get(sourceOriginalPath) : null;
  if (!source || (download && !original)) throw new Error(`Pinned source asset missing: ${sourceOptimizedPath}`);
  const sourceBlobSha = download ? source.sha : source.sourceBlobSha;
  return {
    originalUrl, sourceOriginalPath, sourceOptimizedPath, sourceBlobSha,
    sourceOriginalBlobSha: download ? original.sha : source.sourceOriginalBlobSha,
    sourceOriginalBytes: download ? original.size : source.sourceOriginalBytes,
    sourceBytes: download ? source.size : source.sourceBytes,
    url: `/projects/firstsight/assets/original/${sha256(sourceOptimizedPath).slice(0, 20)}.webp`,
    available: false, loadError: true, contentType: 'image/webp', bytes: download ? source.size : source.sourceBytes
  };
}
let assets = requestedUrls.map(assetEntry);
if (assets.reduce((total, asset) => total + asset.sourceBytes, 0) !== 20325346) throw new Error('Pinned optimized image byte total changed.');
if (download) {
  index = { repository, commit, assets: assets.map(({ originalUrl, sourceOriginalPath, sourceOptimizedPath, sourceBlobSha, sourceOriginalBlobSha, sourceOriginalBytes, sourceBytes }) => ({ originalUrl, sourceOriginalPath, sourceOptimizedPath, sourceBlobSha, sourceOriginalBlobSha, sourceOriginalBytes, sourceBytes })) };
  const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
  await fs.writeFile(path.join(snapshot, 'BLOBS.json'), bytes);
  manifest.files['BLOBS.json'] = sha256(bytes);
  await fs.writeFile(path.join(snapshot, 'SNAPSHOT.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function dimensions(bytes) {
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw new Error('optimized_blob_is_not_webp');
  const format = bytes.subarray(12, 16).toString();
  if (format === 'VP8X' && bytes.length >= 30) return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (format === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (format === 'VP8L' && bytes.length >= 25) { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  throw new Error('unrecognized_webp_dimensions');
}

function serialize() {
  const imported = new Map(assets.map(asset => [asset.originalUrl, asset]));
  const collections = raw.map(collection => {
    const photos = collection.photos.flatMap(photo => photo.url.map((originalUrl, imageIndex) => {
      const asset = imported.get(originalUrl);
      return {
        id: photo.url.length === 1 ? photo.id : `${photo.id}-image-${imageIndex + 1}`,
        sourceId: photo.id, imageIndex, originalUrl,
        sourceOriginalPath: asset.sourceOriginalPath, sourceOptimizedPath: asset.sourceOptimizedPath, sourceBlobSha: asset.sourceBlobSha,
        title: photo.title, description: photo.description || '', date: photo.date || '', tags: [...photo.tags],
        ...(photo.location ? { location: photo.location } : {}), ...(photo.photographer ? { photographer: photo.photographer } : {}),
        url: asset.url, available: asset.available, loadError: !asset.available,
        ...(asset.available ? { width: asset.width, height: asset.height, sha256: asset.sha256 } : { error: asset.error || 'not_downloaded' })
      };
    }));
    const coverOriginalUrl = collection.cover || photos[0].originalUrl;
    const cover = imported.get(coverOriginalUrl);
    if (!cover) throw new Error(`Collection cover is outside its source set: ${collection.id}`);
    return {
      id: collection.id, category: collection.category, title: collection.title, subtitle: collection.subtitle || '',
      description: collection.description || '', date: collection.date || '', sourceFile: collection.sourceFile,
      ...(collection.sourceId ? { sourceId: collection.sourceId } : {}), ...(collection.sourcePhotoSetFile ? { sourcePhotoSetFile: collection.sourcePhotoSetFile } : {}),
      ...(collection.location ? { location: collection.location } : {}), ...(collection.photographer ? { photographer: collection.photographer } : {}),
      coverOriginalUrl, cover: cover.url, coverFallbackUsed: false, photos
    };
  });
  const photos = collections.flatMap(collection => collection.photos);
  return {
    schemaVersion: 1, source: { repository, commit, snapshotDirectory: 'upstream', imageVariant: 'upstream-optimized-webp', originalFilesDownloaded: false }, collections, assets,
    counts: { collections: collections.length, photoEntries: photos.length, sourcePhotoRecords: new Set(photos.map(photo => photo.sourceId)).size,
      availablePhotoEntries: photos.filter(photo => photo.available).length, unavailablePhotoEntries: photos.filter(photo => !photo.available).length,
      uniqueAssets: assets.length, availableAssets: assets.filter(asset => asset.available).length, unavailableAssets: assets.filter(asset => !asset.available).length,
      excludedVideoEntries: 0, downloadedBytes: assets.filter(asset => asset.available).reduce((total, asset) => total + asset.bytes, 0) }
  };
}

// Publish metadata first so other local build work can consume the new IDs.
if (download) {
  await writeData(serialize());
  console.log('Pinned metadata ready: 9 collections / 169 photographs. Importing optimized WebP blobs.');
}
async function importAsset(asset) {
  const local = path.join(assetDirectory, path.basename(asset.url));
  let bytes;
  try {
    bytes = await fs.readFile(local);
    if (bytes.length !== asset.sourceBytes || blobSha(bytes) !== asset.sourceBlobSha) bytes = null;
  } catch {}
  if (!bytes && download) bytes = await readBlob({ path: asset.sourceOptimizedPath, sha: asset.sourceBlobSha, size: asset.sourceBytes });
  if (!bytes) throw new Error(`Missing or modified optimized asset: ${asset.sourceOptimizedPath}. Run --download explicitly.`);
  const size = dimensions(bytes);
  if (!size.width || !size.height) throw new Error(`Invalid image size: ${asset.sourceOptimizedPath}`);
  if (download) await fs.writeFile(local, bytes);
  return { ...asset, available: true, loadError: false, ...size, sha256: sha256(bytes) };
}
let cursor = 0;
let complete = 0;
const failures = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const position = cursor++;
    if (position >= assets.length) return;
    try { assets[position] = await importAsset(assets[position]); }
    catch (error) { assets[position] = { ...assets[position], error: 'optimized_blob_unavailable' }; failures.push(error.message); }
    complete += 1;
    if (download && (complete % 20 === 0 || complete === assets.length)) console.log(`Optimized assets verified: ${complete}/${assets.length}`);
  }
}));
if (!download && failures.length) throw new Error(failures.join('\n'));
const result = serialize();
await writeData(result);
if (download && !failures.length) {
  // These directories are importer-owned. Never clean any other asset folder.
  const retained = new Set(assets.map(asset => path.basename(asset.url)));
  for (const file of await fs.readdir(assetDirectory)) if (!retained.has(file)) await fs.rm(path.join(assetDirectory, file), { recursive: true });
  const retainedSnapshots = new Set([...sourceFiles, 'SNAPSHOT.json', 'BLOBS.json']);
  async function cleanSnapshots(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await cleanSnapshots(absolute, relative + '/');
        if (!(await fs.readdir(absolute)).length) await fs.rmdir(absolute);
      } else if (!retainedSnapshots.has(relative)) await fs.rm(absolute);
    }
  }
  await cleanSnapshots(snapshot);
}
console.log(JSON.stringify({ sourceCommit: commit, ...result.counts }, null, 2));
if (failures.length) throw new Error(failures.join('\n'));
