'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const appRoot = path.resolve(__dirname, '../miniprogram');
const catalog = require('../miniprogram/parenting/data/catalog');
const primary = require('../miniprogram/parenting/data/guide');
const extra = require('../miniprogram/parenting-extra/data/guide');
const tap = values => ({ currentTarget: { dataset: values } });
const plain = value => JSON.parse(JSON.stringify(value));

function host(options = {}) {
  const calls = [], updates = [];
  const wx = {};
  for (const method of ['navigateTo', 'redirectTo', 'navigateBack', 'setNavigationBarTitle']) {
    wx[method] = args => {
      calls.push({ method, ...args });
      if (options.failNavigation && args.fail) args.fail({ errMsg: 'failed' });
      if (args.complete) args.complete();
    };
  }
  const context = { wx, module: { exports: {} }, getCurrentPages: () => options.pages || [] };
  vm.runInNewContext(fs.readFileSync(path.join(appRoot, 'lib/parenting-reader.js'), 'utf8'), context);
  return { wx, calls, updates, createReader: context.module.exports.createReader,
    page(definition) {
      return { ...definition, data: structuredClone(definition.data), setData(patch) { updates.push(patch); Object.assign(this.data, patch); } };
    }
  };
}
function listHost(options = {}) {
  const h = host(options);
  let definition;
  const filename = path.join(appRoot, 'parenting/pages/list/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { wx: h.wx, require: createRequire(filename), Page: value => { definition = value; } });
  h.page = h.page(definition);
  h.page.onLoad(options.query || {});
  return h;
}
function readerHost(article, options = {}) {
  const h = host(options);
  const source = article && article.readerPath.startsWith('/parenting-extra/') ? extra : primary;
  h.page = h.page(h.createReader(source));
  h.page.onLoad({ id: article && article.id });
  return h;
}

test('guide directory filters titles within a topic and restores paginated results', () => {
  const h = listHost(), p = h.page;
  assert.equal(p.data.total, 191);
  assert.equal(p.data.articles.length, 30);
  p.onReachBottom();
  assert.equal(p.data.articles.length, 60);
  const section = catalog.SECTIONS.find(item => item.title === '智力脑');
  p.selectSection(tap({ id: section.id }));
  assert.equal(p.data.total, section.count);
  assert.equal(p.data.articles.length, 30);
  p.inputSearch({ detail: { value: '  孩子  ' } });
  const expected = catalog.ARTICLES.filter(item => item.sectionId === section.id && item.title.includes('孩子'));
  assert.equal(p.data.total, expected.length);
  assert.deepEqual(plain(p.data.articles).map(item => item.id), expected.slice(0, 30).map(item => item.id));
  p.inputSearch({ detail: { value: '无匹配标题xyz' } });
  assert.equal(p.data.articles.length, 0);
  assert.equal(p.data.hasMore, false);
  p.clearSearch();
  assert.equal(p.data.total, section.count);
  p.selectSection(tap({ id: 'invalid' }));
  assert.equal(p.data.sectionId, section.id);
  p.clearFilters();
  while (p.data.hasMore) p.loadMore();
  assert.equal(p.data.articles.length, catalog.ARTICLES.length);
  assert.deepEqual(plain(p.data.articles).map(item => item.id), catalog.ARTICLES.map(item => item.id));
});

test('directory shares and topic entry are validated, and each article opens its own package', () => {
  const section = catalog.SECTIONS.at(-1), h = listHost({ query: { section: section.id } }), p = h.page;
  assert.equal(p.data.total, section.count);
  assert.equal(p.onShareAppMessage().path, '/parenting/pages/list/index?section=' + section.id);
  const article = catalog.ARTICLES.at(-1);
  p.openArticle(tap({ id: article.id }));
  assert.equal(h.calls.at(-1).url, '/parenting-extra/pages/article/index?id=' + article.id);
  p.openArticle(tap({ id: 'not-a-course-article' }));
  assert.equal(h.calls.length, 1);
  assert.equal(listHost({ query: { section: 'invalid' } }).page.data.total, 191);
});

test('reader renders every imported article completely with its column metadata and stable share routes', () => {
  for (const article of catalog.ARTICLES) {
    const h = readerHost(article), p = h.page;
    const expected = (article.readerPath.startsWith('/parenting-extra/') ? extra : primary).getArticle(article.id);
    assert.deepEqual(plain(p.data.course), plain(catalog.COURSE));
    assert.equal(p.data.course.title, '悦创育儿宝典');
    assert.deepEqual(plain(p.data.blocks).map(({ key, ...block }) => block), plain(expected.blocks));
    assert.equal(new Set(p.data.blocks.map(block => block.key)).size, expected.blocks.length);
    assert.equal(p.data.article.blocks, undefined);
    assert.equal(p.onShareAppMessage().path, article.readerPath + '?id=' + article.id);
    assert.equal(p.onShareTimeline().query, 'id=' + article.id);
    assert.ok(h.updates.every(patch => Buffer.byteLength(JSON.stringify(patch)) < 1024 * 1024));
  }
});

test('adjacent reading crosses package boundary without growing navigation stack', () => {
  const index = catalog.ARTICLES.findIndex((article, i, items) => i > 0 && article.readerPath !== items[i - 1].readerPath);
  const before = catalog.ARTICLES[index - 1], after = catalog.ARTICLES[index];
  for (const [article, direction, neighbor] of [[before, 'next', after], [after, 'previous', before]]) {
    const h = readerHost(article);
    h.page.openNeighbor(tap({ direction }));
    assert.equal(h.calls.at(-1).method, 'redirectTo');
    assert.equal(h.calls.at(-1).url, neighbor.readerPath + '?id=' + neighbor.id);
  }
  for (const [article, direction] of [[catalog.ARTICLES[0], 'previous'], [catalog.ARTICLES.at(-1), 'next']]) {
    const h = readerHost(article), count = h.calls.length;
    h.page.openNeighbor(tap({ direction }));
    h.page.openNeighbor(tap({ direction: 'sourceUrl' }));
    assert.equal(h.calls.length, count);
  }
});

test('reader returns to the existing directory, or opens it from a direct shared article', () => {
  const article = catalog.ARTICLES.at(-1);
  const nested = readerHost(article, { pages: [{ route: 'pages/home/index' }, { route: 'parenting/pages/list/index' }, { route: 'parenting-extra/pages/article/index' }] });
  nested.page.openList();
  assert.equal(nested.calls.at(-1).method, 'navigateBack');
  assert.equal(nested.calls.at(-1).delta, 1);
  const direct = readerHost(article, { pages: [{ route: 'parenting-extra/pages/article/index' }] });
  direct.page.openList();
  assert.equal(direct.calls.at(-1).method, 'redirectTo');
  assert.equal(direct.calls.at(-1).url, '/parenting/pages/list/index');
});

test('invalid article and failed navigation offer recovery without losing the readable article', () => {
  const invalid = readerHost(null);
  assert.match(invalid.page.data.error, /返回目录/);
  assert.equal(invalid.page.data.article, null);
  invalid.page.openList();
  assert.equal(invalid.calls.at(-1).url, '/parenting/pages/list/index');
  const h = readerHost(catalog.ARTICLES[0], { failNavigation: true });
  h.page.openNeighbor(tap({ direction: 'next' }));
  assert.match(h.page.data.navigationError, /重试/);
  assert.equal(h.page.data.article.id, catalog.ARTICLES[0].id);
  const count = h.calls.length;
  h.page.openNeighbor(tap({ direction: 'next' }));
  assert.equal(h.calls.length, count + 1);
  const list = listHost({ failNavigation: true });
  list.page.openArticle(tap({ id: catalog.ARTICLES[0].id }));
  assert.match(list.page.data.error, /重试/);
});
