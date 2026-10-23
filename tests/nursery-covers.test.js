'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyNurseryCovers, jpegDimensions } = require('../scripts/check-nursery-covers');
const { SONGS } = require('../miniprogram/data/nursery-songs');

test('all 47 songs have distinct generated art, correct mappings and a bounded local payload', () => {
  const report = verifyNurseryCovers({ web: false });
  assert.equal(report.count, 47);
  assert.ok(report.totalBytes <= 1000 * 1024);
  for (const song of SONGS) {
    assert.equal(new URL(song.coverUrl).pathname, '/assets/nursery-covers/' + song.id + '.jpg');
    assert.equal(new URL(song.coverUrl).origin, 'https://pocket.bornforthis.cn');
    assert.equal(song.cover, '/nursery/assets/covers/' + song.id + '.jpg');
  }
});

test('art inspection rejects truncated or mislabeled payloads', () => {
  assert.throws(() => jpegDimensions(Buffer.from('<html>404</html>')));
  assert.throws(() => jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])));
});

test('photography rebuilds preserve the nursery package and unrelated preload rules', () => {
  const { registerPhotoPackages } = require('../scripts/prepare-native-photos');
  const nursery = { root: 'nursery', name: 'nursery', pages: ['pages/player/index'] };
  const preload = { network: 'wifi', packages: ['nursery'] };
  const config = { subPackages: [{ root: 'photo-9', pages: ['old'] }, nursery], preloadRule: { 'pages/home/index': preload } };
  registerPhotoPackages(config, [{ root: 'photo-1' }, { root: 'photo-2' }]);
  assert.deepEqual(config.subPackages, [
    { root: 'photo-1', pages: ['pages/album/index'] }, { root: 'photo-2', pages: ['pages/album/index'] }, nursery
  ]);
  assert.equal(config.preloadRule['pages/home/index'], preload);
  assert.deepEqual(config.preloadRule['pages/gallery/index'].packages, ['photo-1']);
});
