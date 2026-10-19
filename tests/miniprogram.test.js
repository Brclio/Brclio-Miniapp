const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const nativeRoot = path.resolve(__dirname, '../miniprogram');
const featureId = 'wedding-inspiration';
const origin = 'https://pocket.example.com';

function loadCatalog(webOrigin) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(nativeRoot, 'data/catalog.js'), 'utf8'), {
    module,
    require(id) {
      assert.equal(id, '../config');
      return { webOrigin };
    }
  }, { filename: 'miniprogram/data/catalog.js' });
  return module.exports;
}

function loadWebPage(webOrigin) {
  const calls = [];
  let definition;
  const catalog = loadCatalog(webOrigin);
  vm.runInNewContext(fs.readFileSync(path.join(nativeRoot, 'pages/web/index.js'), 'utf8'), {
    Page(page) { definition = page; },
    require(id) {
      assert.equal(id, '../../data/catalog');
      return catalog;
    },
    wx: {
      setNavigationBarTitle(data) { calls.push({ method: 'setNavigationBarTitle', data }); },
      showNavigationBarLoading() { calls.push({ method: 'showNavigationBarLoading' }); },
      hideNavigationBarLoading() { calls.push({ method: 'hideNavigationBarLoading' }); },
      reLaunch(data) { calls.push({ method: 'reLaunch', data }); }
    },
    encodeURIComponent
  }, { filename: 'miniprogram/pages/web/index.js' });
  const updates = [];
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(update, callback) {
      updates.push(Object.assign({}, update));
      Object.assign(this.data, update);
      if (callback) callback();
    }
  });
  return { page, calls, updates, catalog };
}

test('native catalog resolves a known ID only and cannot expose prototype properties', () => {
  const catalog = loadCatalog(origin);
  const feature = catalog.getFeature(featureId);
  assert.ok(feature);
  assert.equal(feature.id, featureId);
  assert.ok(catalog.getFeatureUrl(featureId).startsWith(origin + '/'));
  for (const id of ['unknown', 'ready-go-duel', '__proto__', 'constructor', 'toString', '', null, undefined, {}, 'https://other.example.com']) {
    assert.equal(catalog.getFeature(id), null);
    assert.equal(catalog.getFeatureUrl(id), '');
  }
});

test('native catalog accepts HTTPS origins and rejects insecure or non-origin configuration', () => {
  for (const invalid of [
    '', undefined, null, {},
    'http://pocket.example.com',
    'javascript:alert(1)',
    'https://pocket.example.com/',
    'https://pocket.example.com/path',
    'https://pocket.example.com?redirect=other',
    'https://pocket.example.com#fragment',
    'https://user:pass@pocket.example.com',
    'https://pocket.example.com:8080',
    'https://pocket.example.com\\@other.example.com',
    'https://pocket..example.com',
    'https://-pocket.example.com',
    ' https://pocket.example.com',
    'https://pocket.example.com\n'
  ]) {
    assert.equal(loadCatalog(invalid).getFeatureUrl(featureId), '', String(invalid));
  }
  for (const valid of [origin, 'https://brclio-pocket.workers.dev', 'https://POCKET.example.com']) {
    assert.ok(loadCatalog(valid).getFeatureUrl(featureId).startsWith(valid + '/'));
  }
});

test('native web page ignores arbitrary URL options and shares only a registered feature ID', () => {
  const { page, catalog } = loadWebPage(origin);
  page.onLoad({
    id: featureId,
    url: 'https://attacker.example.com/',
    src: 'javascript:alert(1)',
    webViewUrl: 'https://attacker.example.com/'
  });
  assert.equal(page.data.src, catalog.getFeatureUrl(featureId));
  assert.equal(page.data.errorTitle, '');
  const share = page.onShareAppMessage({ webViewUrl: 'https://attacker.example.com/' });
  assert.equal(share.path, '/pages/web/index?id=' + encodeURIComponent(featureId));
  assert.ok(!share.path.includes('attacker'));
});

test('native web page does not navigate when the feature ID is invalid', () => {
  for (const id of ['unknown', '__proto__', 'wedding-inspiration&url=https://attacker.example.com', undefined]) {
    const { page, calls } = loadWebPage(origin);
    page.onLoad({ id, url: origin });
    assert.equal(page.data.src, '');
    assert.ok(page.data.errorTitle);
    assert.equal(page.data.canRetry, false);
    assert.ok(!calls.some((call) => call.method === 'showNavigationBarLoading'));
    assert.equal(page.onShareAppMessage().path, '/pages/home/index');
  }
});

test('native web page provides an honest fallback when its service origin is absent', () => {
  const { page, calls } = loadWebPage('');
  page.onLoad({ id: featureId });
  assert.equal(page.data.src, '');
  assert.ok(page.data.errorTitle);
  assert.ok(page.data.errorMessage);
  assert.equal(page.data.canRetry, false);
  page.openEntry();
  assert.equal(page.data.src, '');
  assert.ok(!calls.some((call) => call.method === 'showNavigationBarLoading'));
  page.goHome();
  assert.equal(calls.at(-1).method, 'reLaunch');
  assert.equal(calls.at(-1).data.url, '/pages/home/index');
});

test('native web page removes failed web-view content and retries the same configured URL', () => {
  const { page, catalog, calls, updates } = loadWebPage(origin);
  page.onLoad({ id: featureId });
  page.handleError({ detail: { src: 'https://attacker.example.com/' } });
  assert.equal(page.data.src, '');
  assert.ok(page.data.errorTitle);
  assert.equal(page.data.canRetry, true);
  assert.equal(calls.at(-1).method, 'hideNavigationBarLoading');

  page.openEntry();
  assert.equal(updates.at(-2).src, '');
  assert.equal(page.data.src, catalog.getFeatureUrl(featureId));
  assert.equal(page.data.errorTitle, '');
  assert.equal(page.data.canRetry, false);
  page.handleLoad();
  assert.equal(calls.at(-1).method, 'hideNavigationBarLoading');
  page.onUnload();
  assert.equal(calls.at(-1).method, 'hideNavigationBarLoading');
});
