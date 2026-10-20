const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const nativeRoot = path.resolve(__dirname, '../miniprogram');
const templateRoot = path.resolve(__dirname, '../native/album');
const photoData = require('../miniprogram/data/photos');
const assetManifest = require('../miniprogram/data/photo-assets.json');
const sourceData = require('../web/projects/firstsight/original-data.json');
const galleryRoute = '/pages/gallery/index';
const clone = value => JSON.parse(JSON.stringify(value));
const event = dataset => ({ currentTarget: { dataset } });

function loadPage(name, options = {}) {
  const calls = [];
  const updates = [];
  let definition;
  let now = 1000;
  const data = clone(options.source || photoData);
  const filename = options.filename || (name === 'gallery' ? path.join(nativeRoot, 'pages/gallery/index.js') : path.join(templateRoot, 'index.js'));
  const wx = Object.fromEntries(['navigateTo', 'navigateBack', 'redirectTo', 'reLaunch', 'setNavigationBarTitle'].map(method => [method, parameters => calls.push({ method, parameters })]));
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(page) { definition = page; },
    require(id) {
      assert.equal(id, '../../data/photos');
      return data;
    },
    wx,
    getCurrentPages() { return options.pages || []; },
    Date: class extends Date { static now() { return now; } },
    encodeURIComponent
  }, { filename });
  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(update) {
      updates.push(clone(update));
      for (const [key, value] of Object.entries(update)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    }
  });
  return { page, calls, updates, source: data, advance(milliseconds) { now += milliseconds; } };
}

function loadAlbum(id, options) {
  if (arguments.length === 0) id = 'ws1';
  const fixture = loadPage('album', options);
  fixture.page.onLoad({ id });
  return fixture;
}

test('native FirstSight contains only the 9 real FirstSight_Online albums and all 169 available photos', () => {
  assert.equal(sourceData.source.repository, 'https://github.com/AndersonHJB/FirstSight_Online');
  assert.deepEqual(photoData.collections.map(item => item.id), ['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6', 'ws7', 'ws8', 'pregnancy']);
  assert.equal(photoData.inspirationCollection, undefined);
  const photos = photoData.collections.flatMap(collection => collection.photos);
  assert.equal(photos.length, 169);
  assert.equal(photos.filter(photo => photo.available).length, 169);
  assert.equal(photos.filter(photo => !photo.available).length, 0);
  assert.equal(photoData.collections.filter(item => item.category === 'wedding').reduce((sum, item) => sum + item.photos.length, 0), 128);
  assert.equal(photoData.collections.filter(item => item.category === 'pregnancy').reduce((sum, item) => sum + item.photos.length, 0), 41);
  photoData.collections.forEach((collection, index) => {
    const original = sourceData.collections[index];
    for (const key of ['id', 'category', 'title', 'subtitle', 'description']) assert.equal(collection[key], original[key]);
    assert.equal(collection.photos.length, original.photos.length);
    collection.photos.forEach((photo, photoIndex) => {
      const originalPhoto = original.photos[photoIndex];
      for (const key of ['id', 'title', 'description', 'available', 'date', 'location']) assert.equal(photo[key], originalPhoto[key]);
      assert.deepEqual(photo.tags, originalPhoto.tags);
    });
  });
});

test('format 2 metadata resolves 9 main-package covers and 169 distinct local photo derivatives', () => {
  assert.equal(assetManifest.format, 2);
  assert.equal(assetManifest.sourceRepository, sourceData.source.repository);
  assert.equal(assetManifest.sourceCommit, sourceData.source.commit);
  assert.equal(assetManifest.assets.length, 169);
  assert.equal(assetManifest.covers.length, 9);
  const photos = photoData.collections.flatMap(collection => collection.photos);
  const photoUrls = new Set(photos.map(photo => photo.url));
  assert.equal(photoUrls.size, 169);
  assert.deepEqual(new Set(assetManifest.assets.map(asset => asset.url)), photoUrls);
  assert.deepEqual(new Set(assetManifest.covers.map(cover => cover.id)), new Set(photoData.collections.map(collection => collection.id)));
  const roots = new Set(assetManifest.packages.map(pack => pack.root));
  const sourceAssets = new Map(sourceData.assets.map(asset => [asset.url, asset]));
  const displayAssets = new Map(assetManifest.assets.map(asset => [asset.url, asset]));
  for (const asset of assetManifest.assets) {
    assert.ok(roots.has(asset.pack));
    assert.equal(asset.url, '/' + asset.pack + '/assets/photos/' + asset.filename);
    assert.equal(asset.sourceSha256, sourceAssets.get(asset.sourceUrl).sha256, 'The display derivative must point to the imported real source image');
    assert.ok(asset.width > 0 && asset.height > 0 && Math.max(asset.width, asset.height) <= 1024);
  }
  for (const collection of photoData.collections) {
    const cover = assetManifest.covers.find(item => item.id === collection.id);
    assert.equal(collection.cover, cover.url);
    assert.equal(cover.url, '/assets/photo-covers/' + collection.id + '.jpg');
    assert.ok(Math.max(cover.width, cover.height) <= 640);
    for (const photo of collection.photos) {
      const display = displayAssets.get(photo.url);
      const source = sourceAssets.get(display.sourceUrl);
      assert.equal(photo.sha256, display.sha256, photo.id + ' hashes its displayed JPEG');
      assert.equal(photo.sourceSha256, source.sha256, photo.id + ' retains its optimized WebP source hash separately');
      assert.equal(photo.sourceBlobSha, source.sourceBlobSha, photo.id + ' retains its upstream optimized Git blob');
    }
  }
  for (const asset of assetManifest.assets.concat(assetManifest.covers)) {
    assert.match(asset.url, /^\/(?!\/)[a-zA-Z0-9_/-]+\.jpg$/);
    assert.ok(!asset.url.includes('..'));
    const bytes = fs.readFileSync(path.join(nativeRoot, asset.url.slice(1)));
    assert.equal(bytes.length, asset.bytes);
    assert.deepEqual(Array.from(bytes.subarray(0, 3)), [255, 216, 255]);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
});

test('generated album packages cover all 9 albums and 169 photos once, with no cross-package image references', () => {
  const ids = [];
  const photoIds = [];
  const urls = [];
  const app = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'app.json'), 'utf8'));
  for (const pack of assetManifest.packages) {
    assert.match(pack.root, /^[a-zA-Z0-9_-]+$/);
    const packageRoot = path.join(nativeRoot, pack.root);
    const packageData = require(path.join(packageRoot, 'data/photos.js'));
    assert.deepEqual(packageData.collections.map(collection => collection.id), pack.ids);
    const registration = app.subPackages.find(item => item.root === pack.root);
    assert.ok(registration && registration.pages.includes('pages/album/index'));
    for (const collection of packageData.collections) {
      ids.push(collection.id);
      const metadata = photoData.collections.find(item => item.id === collection.id);
      const route = metadata.nativePath.split('?');
      assert.equal(route[0], '/' + pack.root + '/pages/album/index');
      assert.equal(route[1], 'id=' + encodeURIComponent(collection.id));
      assert.equal(collection.nativePath, metadata.nativePath);
      assert.ok(collection.cover.startsWith('/' + pack.root + '/assets/photos/'));
      for (const photo of collection.photos) {
        photoIds.push(photo.id);
        urls.push(photo.url);
        assert.equal(photo.available, true);
        assert.ok(photo.url.startsWith('/' + pack.root + '/assets/photos/'), photo.url);
        assert.ok(fs.existsSync(path.join(nativeRoot, photo.url.slice(1))));
        const mainPhoto = metadata.photos.find(item => item.id === photo.id);
        for (const key of ['sha256', 'sourceSha256', 'sourceBlobSha']) assert.equal(photo[key], mainPhoto[key], photo.id + ' package ' + key);
      }
      const generated = loadAlbum(collection.id, { source: packageData, filename: path.join(packageRoot, 'pages/album/index.js') });
      assert.equal(generated.page.data.photos.length, metadata.photos.length);
      assert.equal(generated.page.onShareAppMessage().path, metadata.nativePath);
    }
  }
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, 9);
  assert.deepEqual(new Set(ids), new Set(photoData.collections.map(collection => collection.id)));
  assert.equal(photoIds.length, 169);
  assert.equal(new Set(photoIds).size, 169);
  assert.equal(new Set(urls).size, 169);
});

test('gallery filters expose the expected groups and ignore an unknown category', () => {
  const { page } = loadPage('gallery');
  page.onLoad();
  assert.equal(page.data.albumCount, 9);
  assert.equal(page.data.photoCount, 169);
  assert.equal(page.data.featured.id, 'ws1');
  assert.equal(page.data.hasUnavailable, false);
  assert.deepEqual(clone(page.data.categories).map(item => [item.id, item.count]), [['all', 9], ['wedding', 8], ['pregnancy', 1]]);
  const expected = {
    wedding: ['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6', 'ws7', 'ws8'],
    pregnancy: ['pregnancy'],
    all: photoData.collections.map(item => item.id)
  };
  for (const [category, ids] of Object.entries(expected)) {
    page.selectCategory(event({ id: category }));
    assert.equal(page.data.category, category);
    assert.deepEqual(Array.from(page.data.collections, item => item.id), ids);
  }
  page.selectCategory(event({ id: 'constructor' }));
  assert.equal(page.data.category, 'all');
  assert.equal(page.data.collections.length, 9);
});

test('classification follows category rather than ID prefixes and ws1 stays featured after reordering', () => {
  const source = clone(photoData);
  source.collections.find(collection => collection.id === 'ws2').id = 'arbitrary-wedding-id';
  source.collections.find(collection => collection.id === 'pregnancy').id = 'arbitrary-pregnancy-id';
  source.collections.reverse();
  const { page } = loadPage('gallery', { source });
  page.onLoad();
  assert.equal(page.data.featured.id, 'ws1');
  page.selectCategory(event({ id: 'wedding' }));
  assert.equal(page.data.collections.length, 8);
  assert.ok(page.data.collections.some(collection => collection.id === 'arbitrary-wedding-id'));
  page.selectCategory(event({ id: 'pregnancy' }));
  assert.equal(page.data.collections.length, 1);
  assert.equal(page.data.collections[0].id, 'arbitrary-pregnancy-id');
});

test('gallery navigation accepts registered album IDs and cannot navigate to a supplied URL', () => {
  const { page, calls } = loadPage('gallery');
  page.onLoad();
  for (const collection of photoData.collections) {
    page.openAlbum(event({ id: collection.id, url: 'https://other.example/' }));
    assert.equal(calls.at(-1).parameters.url, collection.nativePath);
  }
  const before = calls.length;
  for (const id of ['unknown', '__proto__', 'constructor', '', undefined, 'gallery', 'family', 't1', 'inspiration', 'ws1&url=https://other.example/', 'https://other.example/']) page.openAlbum(event({ id }));
  assert.equal(calls.length, before);
  page.returnHome();
  assert.deepEqual(clone(calls.at(-1)), { method: 'reLaunch', parameters: { url: '/pages/home/index' } });
  const source = clone(photoData);
  source.collections[0].nativePath = '/another-package/pages/album/index?id=' + source.collections[0].id;
  const dynamic = loadPage('gallery', { source });
  dynamic.page.onLoad();
  dynamic.page.openAlbum(event({ id: source.collections[0].id }));
  assert.equal(dynamic.calls[0].parameters.url, source.collections[0].nativePath, 'Navigation must use metadata rather than a fixed package name');
});

test('cover load failures survive filtering without changing the source catalog', () => {
  const { page, source } = loadPage('gallery');
  page.onLoad();
  page.selectCategory(event({ id: 'wedding' }));
  page.onCoverError(event({ id: 'ws1' }));
  assert.equal(page.data.category, 'wedding');
  assert.equal(page.data.collections.length, 8);
  assert.equal(page.data.collections[0].coverFailed, true);
  assert.equal(page.data.featured.coverFailed, true);
  page.selectCategory(event({ id: 'pregnancy' }));
  page.onCoverError(event({ id: 'pregnancy' }));
  assert.equal(page.data.collections.length, 1);
  assert.equal(page.data.collections[0].coverFailed, true);
  assert.equal(source.collections[0].coverFailed, undefined);
  assert.equal(source.collections.find(item => item.id === 'pregnancy').coverFailed, undefined);
});

test('each source album opens with its own records and a safe share path', () => {
  for (const collection of photoData.collections) {
    const { page, calls } = loadAlbum(collection.id);
    assert.equal(page.data.notFound, false);
    assert.equal(page.data.album.id, collection.id);
    assert.equal(page.data.photos.length, collection.photos.length);
    assert.deepEqual(Array.from(page.data.photos, photo => photo.id), collection.photos.map(photo => photo.id));
    assert.equal(calls[0].parameters.title, collection.title);
    assert.equal(page.onShareAppMessage({ webViewUrl: 'https://other.example/' }).path, collection.nativePath);
    assert.equal(page.onShareTimeline().query, 'id=' + collection.id);
  }
});

test('pregnancy loads all 41 real records and the final image opens as 41 of 41', () => {
  const original = sourceData.collections.find(collection => collection.id === 'pregnancy');
  const metadata = photoData.collections.find(collection => collection.id === 'pregnancy');
  const { page } = loadAlbum('pregnancy');
  assert.equal(page.data.album.category, 'pregnancy');
  assert.equal(page.data.photos.length, 41);
  assert.deepEqual(Array.from(page.data.photos, photo => photo.id), original.photos.map(photo => photo.id));
  assert.ok(page.data.photos.every(photo => photo.available && photo.url));
  assert.equal(page.data.hasUnavailable, false);
  page.openPhoto(event({ index: 40 }));
  assert.equal(page.data.previewPosition, 41);
  assert.equal(page.data.previewPhoto.id, original.photos[40].id);
  page.nextPhoto();
  assert.equal(page.data.previewIndex, 40);
  assert.equal(page.onShareAppMessage().path, metadata.nativePath);
});

test('unknown album IDs show the missing state and share only the native gallery', () => {
  for (const id of ['unknown', '__proto__', 'constructor', '', undefined, 'gallery', 'family', 't1', 'baby-1', 'inspiration', 'ws1&url=https://other.example/', '../gallery/index', 'https://other.example/']) {
    const { page, calls } = loadAlbum(id);
    assert.equal(page.data.notFound, true);
    assert.equal(page.data.album, null);
    assert.equal(page.data.photos.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(page.onShareAppMessage().path, galleryRoute);
    page.openPhoto(event({ index: 0 }));
    assert.equal(page.data.previewOpen, false);
  }
});

test('native swiper opens real records and respects first and last boundaries', () => {
  const { page } = loadAlbum();
  const photos = photoData.collections.find(collection => collection.id === 'ws1').photos;
  page.openPhoto(event({ index: 0 }));
  assert.equal(page.data.previewOpen, true);
  assert.equal(page.data.previewPosition, 1);
  page.previousPhoto();
  assert.equal(page.data.previewIndex, 0);
  page.onPreviewChange({ detail: { current: 1 } });
  assert.equal(page.data.previewPosition, 2);
  assert.equal(page.data.previewPhoto.available, true);
  assert.equal(page.data.previewPhoto.id, photos[1].id);
  for (let step = 0; step < photos.length + 2; step++) page.nextPhoto();
  assert.equal(page.data.previewIndex, photos.length - 1);
  assert.equal(page.data.previewPosition, photos.length);
  assert.equal(page.data.previewPhoto.id, photos.at(-1).id);
  for (const index of [-1, photos.length, 2.5, 'invalid', undefined]) {
    page.onPreviewChange({ detail: { current: index } });
    assert.equal(page.data.previewIndex, photos.length - 1);
  }
});

test('zoom supports pinch updates and dragging, blocks stale swiper changes, and resets before navigation', () => {
  const { page } = loadAlbum();
  page.openPhoto(event({ index: 0 }));
  page.toggleZoom();
  assert.equal(page.data.previewScale, 2);
  assert.equal(page.data.previewZoomed, true);
  page.onPreviewScale(Object.assign(event({ index: 0 }), { detail: { scale: 3.25 } }));
  assert.equal(page.data.previewScale, 3.25);
  for (const scale of [NaN, 0.5, 5]) page.onPreviewScale(Object.assign(event({ index: 0 }), { detail: { scale } }));
  page.onPreviewScale(Object.assign(event({ index: 2 }), { detail: { scale: 4 } }));
  assert.equal(page.data.previewScale, 3.25);
  page.onPreviewChange({ detail: { current: 2 } });
  assert.equal(page.data.previewIndex, 0);
  page.onPreviewMove(Object.assign(event({ index: 0 }), { detail: { source: 'touch', x: -120, y: -60 } }));
  assert.equal(page.data.previewX, -120);
  assert.equal(page.data.previewY, -60);
  page.toggleZoom();
  assert.equal(page.data.previewZoomed, false);
  assert.equal(page.data.previewScale, 1);
  assert.equal(page.data.previewX, 0);
  assert.equal(page.data.previewY, 0);
  page.toggleZoom();
  page.nextPhoto();
  assert.equal(page.data.previewIndex, 1);
  assert.equal(page.data.previewZoomed, false);
  assert.equal(page.data.previewScale, 1);
  page.onPhotoError(event({ index: 1 }));
  page.toggleZoom();
  assert.equal(page.data.previewZoomed, false, 'Unavailable records cannot enter the image zoom mode');
});

test('double tap toggles zoom only for the active photo within the tap interval', () => {
  const { page, advance } = loadAlbum();
  page.openPhoto(event({ index: 0 }));
  page.onPreviewTap(event({ index: 0 }));
  assert.equal(page.data.previewZoomed, false);
  advance(150);
  page.onPreviewTap(event({ index: 0 }));
  assert.equal(page.data.previewZoomed, true);
  page.onPreviewTap(event({ index: 2 }));
  assert.equal(page.data.previewZoomed, true);
  page.nextPhoto();
  page.nextPhoto();
  page.onPreviewTap(event({ index: 2 }));
  advance(350);
  page.onPreviewTap(event({ index: 2 }));
  assert.equal(page.data.previewZoomed, false);
  advance(100);
  page.onPreviewTap(event({ index: 2 }));
  assert.equal(page.data.previewZoomed, true);
});

test('runtime image failure updates the list and active record, exits zoom, and retains the caption', () => {
  const { page, source } = loadAlbum();
  page.openPhoto(event({ index: 0 }));
  page.toggleZoom();
  const description = page.data.previewPhoto.description;
  page.onPhotoError(event({ index: 0 }));
  assert.equal(page.data.photos[0].available, false);
  assert.equal(page.data.previewPhoto.available, false);
  assert.equal(page.data.previewPhoto.description, description);
  assert.equal(page.data.hasUnavailable, true);
  assert.equal(page.data.previewZoomed, false);
  assert.equal(page.data.previewScale, 1);
  page.toggleZoom();
  assert.equal(page.data.previewZoomed, false);
  assert.equal(source.collections[0].photos[0].available, true, 'A load failure does not mutate the bundled source record');
  page.closePreview();
  page.openPhoto(event({ index: 2 }));
  page.onPhotoError(event({ index: 3 }));
  assert.equal(page.data.previewPhoto.id, photoData.collections[0].photos[2].id);
  assert.equal(page.data.previewPhoto.available, true, 'A neighboring image failure must not replace the active image');
});

test('closing a preview resets movement and leaves the album and records available to reopen', () => {
  const { page, calls } = loadAlbum();
  page.openPhoto(event({ index: 2 }));
  page.toggleZoom();
  page.onPreviewMove(Object.assign(event({ index: 2 }), { detail: { source: 'touch', x: -80, y: -30 } }));
  page.closePreview();
  assert.equal(page.data.previewOpen, false);
  assert.equal(page.data.previewZoomed, false);
  assert.equal(page.data.previewScale, 1);
  assert.equal(page.data.previewX, 0);
  assert.equal(page.data.previewY, 0);
  assert.equal(page.data.album.id, 'ws1');
  assert.equal(page.data.photos.length, photoData.collections[0].photos.length);
  page.nextPhoto();
  assert.equal(page.data.previewIndex, 2);
  page.openPhoto(event({ index: 3 }));
  assert.equal(page.data.previewOpen, true);
  assert.equal(page.data.previewPhoto.id, photoData.collections[0].photos[3].id);
  assert.equal(calls.filter(call => call.method !== 'setNavigationBarTitle').length, 0);
});

test('returning to an existing gallery preserves that page while a shared album has a native fallback', () => {
  const albumPath = photoData.collections[0].nativePath.split('?')[0];
  const existing = loadAlbum('ws1', { pages: [{ route: 'pages/home/index' }, { route: galleryRoute.slice(1) }, { route: albumPath.slice(1) }] });
  existing.page.returnToAlbums();
  assert.deepEqual(clone(existing.calls.at(-1)), { method: 'navigateBack', parameters: { delta: 1 } });
  const shared = loadAlbum('ws1');
  shared.page.returnToAlbums();
  assert.deepEqual(clone(shared.calls.at(-1)), { method: 'redirectTo', parameters: { url: galleryRoute } });
  const { page } = loadPage('gallery');
  page.onLoad();
  assert.equal(page.onShareAppMessage().path, galleryRoute);
  assert.equal(page.onShareTimeline().query, undefined);
});
