const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
function catalogFor(webOrigin) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/catalog.js'), 'utf8'), { module, require(id) { return id === './photos' ? require('../miniprogram/data/photos') : { webOrigin }; } });
  return module.exports;
}
function loadPage(file, extra) {
  let definition;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Page(value) { definition = value; },
    require(id) { return id === '../../lib/account-sync' ? { flush() {}, getStatus() { return { message: '' }; }, subscribe() { return () => {}; } } : catalogFor('https://pocket.example.com'); },
    wx: { navigateTo(data) { calls.push({ method: 'navigateTo', data }); }, redirectTo(data) { calls.push({ method: 'redirectTo', data }); }, reLaunch(data) { calls.push({ method: 'reLaunch', data }); }, pageScrollTo() {} },
    ...extra
  });
  const page = Object.assign({}, definition, { data: Object.assign({}, definition.data), setData(value) { Object.assign(this.data, value); } });
  return { page, calls };
}
const routes = [
  ['content-hub', '/pages/home/index'],
  ['blog', '/blog/pages/list/index'],
  ['firstsight', '/pages/gallery/index'],
  ['relax', '/pages/home/index?tab=relax'],
  ['learn', '/pages/home/index?tab=learn'],
  ['lingotiles', '/pages/lingotiles/index'],
  ['nursery-music', '/nursery/pages/player/index'],
  ['parenting-guide', '/parenting/pages/list/index'],
  ['ready-go-duel', '/pages/duel/index'],
  ['wedding-inspiration', require('../miniprogram/data/photos').collections.find(item => item.id === 'pregnancy').nativePath]
];
test('all product features resolve to registered native pages, including old shared links', () => {
  const c = catalogFor('');
  assert.equal(c.features.length, routes.length);
  for (const [id, route] of routes) {
    assert.equal(c.getFeatureRoute(id), route);
    const { page, calls } = loadPage('pages/web/index.js');
    page.onLoad({ id, url: 'https://attacker.example/' });
    assert.equal(calls[0].method, 'redirectTo');
    assert.equal(calls[0].data.url, route);
    assert.equal(page.onShareAppMessage().path, route);
  }
});
test('unknown and prototype IDs cannot open a route or leak arbitrary URLs', () => {
  const c = catalogFor('https://pocket.example.com');
  for (const id of ['unknown', '__proto__', 'constructor', 'toString', '', null, undefined, {}, 'ready-go-duel&url=https://evil.example']) {
    assert.equal(c.getFeature(id), null);
    assert.equal(c.getFeatureRoute(id), '');
    assert.equal(c.getFeatureUrl(id), '');
    const { page, calls } = loadPage('pages/web/index.js');
    page.onLoad({ id, url: 'https://attacker.example/' });
    assert.equal(calls.length, 0);
    assert.ok(page.data.errorTitle);
    assert.equal(page.onShareAppMessage().path, '/pages/home/index');
  }
});
test('homepage opens photography, games, learning and parenting locally and validates selected tabs', () => {
  const { page, calls } = loadPage('pages/home/index.js');
  for (const [id, route] of routes) {
    page.openFeature({ currentTarget: { dataset: { id } } });
    assert.equal(calls.at(-1).data.url, route);
  }
  const count = calls.length;
  page.openFeature({ currentTarget: { dataset: { id: 'https://evil.example' } } });
  assert.equal(calls.length, count);
  for (const tab of ['relax', 'learn', 'parenting', 'mine', 'photo']) {
    page.switchTab({ currentTarget: { dataset: { tab } } });
    assert.equal(page.data.activeTab, tab);
  }
  page.switchTab({ currentTarget: { dataset: { tab: 'unknown' } } });
  assert.equal(page.data.activeTab, 'photo');
  page.onLoad({ tab: 'relax' });
  assert.equal(page.data.activeTab, 'relax');
  page.onLoad({ tab: 'learn' });
  assert.equal(page.data.activeTab, 'learn');
  page.onLoad({ tab: 'parenting' });
  assert.equal(page.data.activeTab, 'parenting');
  assert.equal(page.onShareAppMessage().path, '/pages/home/index?tab=parenting');
  assert.equal(page.onShareTimeline().query, 'tab=parenting');
});
test('parenting scenes use a native player and do not expose a broken public website URL', () => {
  const c = catalogFor('https://pocket.example.com');
  assert.equal(c.getFeature('nursery-music').category, 'parenting');
  assert.equal(c.getFeatureUrl('nursery-music'), '');
  assert.equal(c.getFeatureUrl('firstsight'), 'https://pocket.example.com/projects/firstsight/?entry=wechat');
  const { page, calls } = loadPage('pages/home/index.js');
  page.openFeature({ currentTarget: { dataset: { id: 'nursery-music', scene: 'sleep' } } });
  assert.equal(calls.at(-1).data.url, '/nursery/pages/player/index?scene=sleep');
  for (const scene of ['https://evil.example', 'sleep&url=https://evil.example', 'unknown']) {
    page.openFeature({ currentTarget: { dataset: { id: 'nursery-music', scene } } });
    assert.equal(calls.at(-1).data.url, '/nursery/pages/player/index');
  }
});
test('native compatibility route offers retry on a navigation failure without using web-view', () => {
  const { page, calls } = loadPage('pages/web/index.js');
  page.onLoad({ id: 'firstsight' });
  calls[0].data.fail();
  assert.equal(page.data.canRetry, true);
  page.openEntry();
  assert.equal(calls[1].data.url, '/pages/gallery/index');
  assert.equal(page.data.canRetry, false);
  assert.ok(!fs.readFileSync(path.join(root, 'pages/web/index.wxml'), 'utf8').includes('<web-view'));
});
test('public website URL helper rejects insecure or non-origin configuration', () => {
  for (const origin of ['', undefined, null, {}, 'http://pocket.example.com', 'javascript:alert(1)', 'https://pocket.example.com/', 'https://pocket.example.com/path', 'https://pocket.example.com?redirect=other', 'https://pocket.example.com#fragment', 'https://user:pass@pocket.example.com', 'https://pocket.example.com:8080', 'https://pocket.example.com\\@other.example.com', 'https://pocket..example.com', 'https://-pocket.example.com', ' https://pocket.example.com', 'https://pocket.example.com\n']) {
    const c = catalogFor(origin);
    for (const feature of c.features) {
      assert.equal(c.getFeatureUrl(feature.id), '');
      assert.ok(c.getFeatureRoute(feature.id).startsWith('/'));
    }
  }
});
test('each native route exists in the main or photography code package', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  const pages = config.pages.concat((config.subPackages || []).flatMap(pack => pack.pages.map(page => pack.root + '/' + page)));
  for (const [, route] of routes) assert.ok(pages.includes(route.slice(1).split('?')[0]));
  for (const page of pages) for (const ext of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(root, page + ext)));
});

test('old parenting shares move to the package while preserving only known scenes and songs', () => {
  const songs = require('../miniprogram/data/nursery-songs');
  for (const query of [{ scene: 'sleep', song: songs.SONGS[0].id }, { scene: 'https://evil.test', song: '__proto__' }]) {
    let definition;
    const calls = [];
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/parenting/index.js'), 'utf8'), {
      Page: value => { definition = value; }, require: () => songs,
      wx: { redirectTo: value => calls.push(value) }
    });
    const page = { ...definition, data: {}, setData(value) { Object.assign(this.data, value); } };
    page.onLoad(query);
    assert.equal(calls[0].url, query.scene === 'sleep'
      ? '/nursery/pages/player/index?scene=sleep&song=' + songs.SONGS[0].id
      : '/nursery/pages/player/index');
    calls[0].fail(); assert.equal(page.data.failed, true);
    page.openPlayer(); assert.equal(page.data.failed, false);
  }
});
