'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'web/projects/firstsight');
const data = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'original-data.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'upstream/SNAPSHOT.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'upstream/BLOBS.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blobSha = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const commit = '988cc8d0208ac2cae87b0e36b072007a856356ab';

test('FirstSight import keeps the pinned private source and only the nine real photograph collections', () => {
  assert.equal(snapshot.repository, 'https://github.com/AndersonHJB/FirstSight_Online');
  assert.equal(snapshot.commit, commit);
  assert.equal(index.commit, commit);
  assert.equal(data.source.commit, commit);
  assert.equal(data.source.imageVariant, 'upstream-optimized-webp');
  assert.equal(data.source.originalFilesDownloaded, false);
  assert.deepEqual(snapshot.sourceFiles, ['types.ts', 'data/wedding.ts', 'data/baby.ts', 'data/photoAlbums.ts', 'utils/image.ts']);
  for (const [file, checksum] of Object.entries(snapshot.files)) {
    const bytes = fs.readFileSync(path.join(moduleRoot, 'upstream', file));
    assert.equal(hash(bytes), checksum, file);
    if (snapshot.sourceBlobs[file]) {
      assert.equal(blobSha(bytes), snapshot.sourceBlobs[file].blobSha, file);
      assert.equal(bytes.length, snapshot.sourceBlobs[file].bytes, file);
    }
  }
  assert.deepEqual(data.collections.map(collection => collection.id), ['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6', 'ws7', 'ws8', 'pregnancy']);
  assert.deepEqual(data.collections.map(collection => collection.photos.length), [13, 16, 9, 8, 14, 34, 12, 22, 41]);
  assert.deepEqual([...new Set(data.collections.map(collection => collection.category))], ['wedding', 'pregnancy']);
  assert.equal(data.counts.photoEntries, 169);
  assert.equal(data.counts.sourcePhotoRecords, 169);
  assert.equal(data.counts.availablePhotoEntries, 169);
  assert.equal(data.counts.unavailablePhotoEntries, 0);
  assert.equal(data.counts.uniqueAssets, 169);
  assert.equal(data.counts.availableAssets, 169);
  assert.equal(data.counts.unavailableAssets, 0);
  assert.equal(data.counts.downloadedBytes, 20325346);
  assert.equal(data.collections.at(-1).sourceFile, 'data/photoAlbums.ts');
  assert.equal(data.collections.at(-1).sourcePhotoSetFile, 'data/baby.ts');
  assert.equal(data.collections.at(-1).date, '2024.11.17');
  assert.equal(data.collections.at(-1).title, '倾听你的心跳');
});

test('every served WebP matches the pinned optimized Git blob bytes and SHA-256', () => {
  assert.equal(data.assets.length, 169);
  const indexed = new Map(index.assets.map(asset => [asset.originalUrl, asset]));
  let total = 0;
  for (const asset of data.assets) {
    assert.equal(asset.available, true, asset.originalUrl);
    assert.equal(asset.loadError, false, asset.originalUrl);
    assert.equal(asset.contentType, 'image/webp');
    assert.match(asset.originalUrl, /^\/(婚纱照|孕妇照)\/.+\.(jpe?g|png)$/i);
    assert.equal(asset.sourceOriginalPath, 'public' + asset.originalUrl);
    assert.equal(asset.sourceOptimizedPath, 'public/optimized' + asset.originalUrl.replace(/\.[^./]+$/, '.webp'));
    assert.match(asset.url, /^\/projects\/firstsight\/assets\/original\/[a-f0-9]{20}\.webp$/);
    assert.match(asset.sourceOriginalBlobSha, /^[a-f0-9]{40}$/);
    assert.ok(asset.sourceOriginalBytes > 0);
    assert.equal(asset.sourceBlobSha, indexed.get(asset.originalUrl).sourceBlobSha);
    assert.equal(asset.sourceBytes, indexed.get(asset.originalUrl).sourceBytes);
    assert.equal(asset.sourceOriginalBlobSha, indexed.get(asset.originalUrl).sourceOriginalBlobSha);
    const bytes = fs.readFileSync(path.join(root, 'web', asset.url.slice(1)));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    assert.equal(bytes.length, asset.bytes, asset.originalUrl);
    assert.equal(bytes.length, asset.sourceBytes, asset.originalUrl);
    assert.equal(hash(bytes), asset.sha256, asset.originalUrl);
    assert.equal(blobSha(bytes), asset.sourceBlobSha, asset.originalUrl);
    assert.ok(asset.width > 0 && asset.height > 0);
    total += bytes.length;
  }
  assert.equal(total, 20325346);
  const retained = data.assets.map(asset => path.basename(asset.url)).sort();
  assert.deepEqual(fs.readdirSync(path.join(moduleRoot, 'assets/original')).sort(), retained, 'old generated examples and unused assets are removed');
});

test('photograph titles, dates, original covers and descriptions are preserved without EXIF or external sample images', () => {
  const assets = new Map(data.assets.map(asset => [asset.originalUrl, asset]));
  const allPhotos = data.collections.flatMap(collection => collection.photos);
  assert.equal(new Set(allPhotos.map(photo => photo.originalUrl)).size, 169, 'no duplicate aggregate');
  for (const collection of data.collections) {
    assert.equal(collection.coverFallbackUsed, false);
    assert.equal(collection.cover, assets.get(collection.coverOriginalUrl).url);
    assert.ok(collection.photos.some(photo => photo.originalUrl === collection.coverOriginalUrl), collection.id);
    assert.ok(collection.title && collection.subtitle && collection.description && collection.date);
    for (const photo of collection.photos) {
      const asset = assets.get(photo.originalUrl);
      assert.ok(asset, photo.id);
      assert.equal(photo.url, asset.url, photo.id);
      assert.equal(photo.sourceOriginalPath, asset.sourceOriginalPath);
      assert.equal(photo.sourceOptimizedPath, asset.sourceOptimizedPath);
      assert.equal(photo.sourceBlobSha, asset.sourceBlobSha);
      assert.equal(photo.sha256, asset.sha256);
      assert.equal(photo.available, true);
      assert.equal(photo.loadError, false);
      assert.equal(photo.exif, undefined);
      assert.ok(photo.title && photo.description && photo.date && Array.isArray(photo.tags), photo.id);
      assert.ok(!photo.originalUrl.includes('unsplash'));
    }
  }
  assert.equal(fs.existsSync(path.join(moduleRoot, 'upstream/data/gallery.ts')), false);
  assert.equal(fs.existsSync(path.join(moduleRoot, 'upstream/data/family.ts')), false);
  assert.equal(fs.existsSync(path.join(moduleRoot, 'upstream/data/travel.ts')), false);
});

test('the default importer rebuilds deterministically without network or GitHub access', () => {
  const before = fs.readFileSync(path.join(moduleRoot, 'original-data.json'));
  const env = { ...process.env, PATH: '', GH_TOKEN: '', GITHUB_TOKEN: '' };
  execFileSync(process.execPath, [path.join(root, 'scripts/sync-firstsight.mjs')], { cwd: root, env, stdio: 'pipe', timeout: 20000 });
  assert.deepEqual(fs.readFileSync(path.join(moduleRoot, 'original-data.json')), before);
});
