'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'web/projects/firstsight');
const data = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'original-data.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('FirstSight import retains the pinned photography collections and source snapshot', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'upstream/SNAPSHOT.json'), 'utf8'));
  assert.equal(snapshot.commit, '6fafcfd4371b00d8c956e58cb5bf689911b5fb2c');
  assert.equal(data.source.commit, snapshot.commit);
  for (const [file, checksum] of Object.entries(snapshot.files)) {
    assert.equal(hash(fs.readFileSync(path.join(moduleRoot, 'upstream', file))), checksum, file);
  }
  assert.deepEqual(data.collections.map(collection => collection.id), ['gallery', 'ws1', 'ws2', 'ws3', 'family', 'baby-1', 'baby-2', 'baby-3', 't1', 't2', 't3', 't4', 't5', 't6']);
  assert.equal(data.collections.flatMap(collection => collection.photos).length, 101);
  assert.equal(data.counts.sourcePhotoRecords, 97);
});

test('every available FirstSight image is an intact original file served from its own module', () => {
  const assets = new Map(data.assets.map(asset => [asset.originalUrl, asset]));
  assert.equal(data.assets.filter(asset => asset.available).length, 34);
  for (const asset of data.assets.filter(asset => asset.available)) {
    assert.match(asset.url, /^\/projects\/firstsight\/assets\/original\/[a-f0-9]{20}\.(jpg|png|webp|gif)$/);
    const bytes = fs.readFileSync(path.join(root, 'web', asset.url.slice(1)));
    assert.equal(bytes.length, asset.bytes, asset.originalUrl);
    assert.equal(hash(bytes), asset.sha256, asset.originalUrl);
    assert.ok(asset.width > 0 && asset.height > 0);
  }
  for (const collection of data.collections) {
    const availableUrls = collection.photos.filter(photo => photo.available).map(photo => photo.url);
    if (collection.coverFallbackUsed) {
      assert.ok(availableUrls.includes(collection.cover), collection.id + ' fallback comes from this original collection');
    } else {
      assert.equal(collection.cover, assets.get(collection.coverOriginalUrl).url, collection.id + ' preserves its original cover');
    }
    for (const photo of collection.photos) {
      const asset = assets.get(photo.originalUrl);
      assert.ok(asset, photo.id);
      assert.equal(photo.url, asset.url, photo.id);
      assert.equal(photo.available, asset.available, photo.id);
      assert.ok(photo.title && Array.isArray(photo.tags), photo.id);
    }
  }
});

test('unavailable upstream photos keep their source and error instead of replacement imagery', () => {
  const missing = data.collections.flatMap(collection => collection.photos).filter(photo => !photo.available);
  assert.equal(missing.length, 21);
  for (const photo of missing) {
    assert.equal(photo.url, '');
    assert.equal(photo.loadError, true);
    assert.ok(photo.originalUrl && photo.error);
  }
  assert.ok(data.assets.some(asset => asset.originalUrl.startsWith('/photos/family/') && asset.error === 'source_local_file_missing'));
  assert.equal(data.assets.filter(asset => asset.httpStatus === 404).length, 9);
});
