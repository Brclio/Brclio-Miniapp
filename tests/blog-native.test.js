'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
const { createAccountClient, STORAGE_KEY } = require('../miniprogram/lib/account');
const { createBlogCache } = require('../miniprogram/lib/blog-cache');
const utils = require('../miniprogram/blog/lib/client');
const markdown = require('../miniprogram/lib/blog-content');
const counts = { views: 3, likes: 0, favorites: 0, comments: 1 };
const author = { id: 'a'.repeat(32), displayName: '作者', avatarUrl: '' };
const article = { id: 'post_1', title: '认真写下一点想法', content: '# 小标题\n\n**开始阅读** <script>alert(1)</script>', status: 'published', category: '随笔', tags: ['生活'], excerpt: '一篇文章', commentsEnabled: true, publishedAt: 1793066400000, readingMinutes: 1, author, counts, revision: 1 };
const event = data => ({ currentTarget: { dataset: data } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function host(kind, options = {}) {
  let definition, cached = options.user || null, listener;
  const calls = [], navigations = [], modals = [], toasts = [], patches = [], scrolls = [];
  const request = options.request || (async (route, method, payload) => {
    if (route === '/me') return { user: cached, canWrite: !!cached };
    if (route.startsWith('/posts?')) return { posts: [article], page: 1, pageSize: 12, total: 1, categories: ['随笔'], tags: ['生活'] };
    if (route === '/posts/post_1') return { post: structuredClone(article), interaction: { liked: false, favorited: false }, canEdit: !!cached };
    if (route.endsWith('/view')) return { counts: { ...counts, views: 4 } };
    if (route.endsWith('/like') || route.endsWith('/favorite')) return { counts: { ...counts, views: 4, likes: payload.active ? 1 : 0 }, interaction: { liked: payload.active, favorited: false } };
    throw new Error('Unexpected route ' + route);
  });
  const cache = options.cache || createBlogCache({
    request(route, method = 'GET', payload) { calls.push({ route, method, payload }); return request(route, method, payload); },
    getIdentity: () => cached && cached.id || '', ...(options.now ? { now: options.now } : {})
  });
  const api = { ...utils, account: { getCachedUser: () => cached, subscribe(fn) { listener = fn; return () => { listener = null; }; } },
    request: cache.request, peek: cache.peek, reset: cache.reset, revision: cache.revision,
    enter() { if (!options.internal) cache.reset(); },
    visitorId: () => 'mini_1234567890123456', login() { navigations.push('/pages/account/index'); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'blog/pages', kind, 'index.js'), 'utf8'), {
    Page(value) { definition = value; }, require(name) { return name.includes('blog-content') ? markdown : api; },
    getCurrentPages: () => options.pages || [],
    wx: { navigateTo(value) { navigations.push(value.url); }, navigateBack(value) { navigations.push('back:' + value.delta); }, pageScrollTo(value) { scrolls.push(value); if (value.success) value.success(); }, setNavigationBarTitle() {}, showToast(value) { toasts.push(value); }, showModal(value) { modals.push(value); }, stopPullDownRefresh() {}, setClipboardData() {} }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, done) {
    patches.push(structuredClone(patch));
    Object.entries(patch).forEach(([key, value]) => { const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data; while (parts.length > 1) target = target[parts.shift()]; target[parts[0]] = value; }); if (done) done();
  } };
  page.onLoad(options.query || (kind === 'article' ? { id: 'post_1' } : {}));
  return { page, calls, navigations, modals, toasts, patches, scrolls, cache, setUser(user) { cached = user; if (listener) listener({ user }); } };
}

test('blog client reuses private session, permits anonymous reads and rejects unsafe routes', async () => {
  const calls = [], storage = new Map();
  const client = createAccountClient({ config: { accountBase: 'https://pocket.bornforthis.cn/api/account' }, wx: {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    request(options) { calls.push(options); options.success({ statusCode: 200, data: { ok: true } }); }
  } });
  await client.blogRequest('/posts?q=hello%20world');
  await client.blogRequest('/posts/post_1/view', 'POST', { visitorId: 'abcdefghijklmnop' });
  assert.equal(calls[0].url, 'https://pocket.bornforthis.cn/api/blog/posts?q=hello%20world');
  assert.equal(Object.hasOwn(calls[0].header, 'Authorization'), false);
  await assert.rejects(client.blogRequest('/posts/post_1/like', 'PUT', { active: true }), { code: 'session_expired' });
  for (const route of ['https://attacker.example', '/../../account', '/posts#fragment', '/posts\\evil', '/admin/other']) await assert.rejects(client.blogRequest(route), { code: 'invalid_request' });
  assert.equal(calls.length, 2);
});

test('anonymous blog results are canceled when a login changes account generation', async () => {
  const storage = new Map(); let blogRequest;
  const client = createAccountClient({ config: { accountBase: 'https://pocket.bornforthis.cn/api/account' }, wx: {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    request(options) { if (options.url.includes('/api/blog/')) blogRequest = options; else options.success({ statusCode: 200, data: { user: author, token: 'private-test-token', expiresAt: null } }); }
  } });
  const reading = client.blogRequest('/posts');
  await client.loginPassword('writer', 'password-123');
  blogRequest.success({ statusCode: 200, data: { posts: [] } });
  await assert.rejects(reading, { code: 'operation_canceled' });
  assert.equal(storage.get(STORAGE_KEY).token, 'private-test-token');
  assert.equal(JSON.stringify(client.getSessionSnapshot()).includes('private-test-token'), false);
});

test('native list filters and paging use server data and preserve a reachable saved-articles login', async () => {
  const h = host('list'); await h.page.onShow();
  assert.equal(h.page.data.posts.length, 1);
  assert.equal(h.page.data.posts[0].dateText.length, 10);
  h.page.inputSearch({ detail: { value: '写作 & 阅读' } }); await h.page.search();
  assert.match(h.calls.findLast(call => call.route.startsWith('/posts?')).route, /q=%E5%86%99%E4%BD%9C%20%26%20%E9%98%85%E8%AF%BB/);
  await h.page.selectCategory(event({ category: '随笔' }));
  assert.match(h.calls.findLast(call => call.route.startsWith('/posts?')).route, /category=/);
  await h.page.selectTag(event({ tag: '生活' }));
  assert.equal(h.page.data.tag, '生活');
  h.page.openPost(event({ id: 'post_1' }));
  assert.equal(h.navigations.at(-1), '/blog/pages/article/index?id=post_1');
  h.page.openPost(event({ id: '../invalid' })); assert.equal(h.navigations.length, 1);
  h.page.openAccount(); assert.equal(h.navigations.at(-1), '/pages/account/index');
  h.page.onUnload();
});

test('list load-more appends unique posts and a hidden page ignores late results', async () => {
  const pending = deferred(); let delayed = false;
  const h = host('list', { request: async route => route === '/me' ? { user: null, canWrite: false } : delayed ? pending.promise : { posts: [{ ...article, id: route.includes('page=2') ? 'post_2' : 'post_1' }], total: 13, page: route.includes('page=2') ? 2 : 1, pageSize: 12, categories: [], tags: [] } });
  await h.page.onShow(); assert.equal(h.page.data.hasMore, true);
  await h.page.loadMore(); assert.deepEqual(Array.from(h.page.data.posts, post => post.id), ['post_1', 'post_2']);
  assert.equal(h.page.data.hasMore, false);
  delayed = true; const work = h.page.reload(); h.page.onHide();
  pending.resolve({ posts: [article], total: 1, page: 1, pageSize: 12 }); await work;
  assert.equal(h.page.data.posts.length, 0); assert.equal(h.page.data.loading, false); h.page.onUnload();
});

test('article uses sanitized native rich-text, records a view and sends guests to the existing account page', async () => {
  const h = host('article'); await h.page.onShow(); await flush();
  assert.match(h.page.data.htmlChunks.map(chunk => chunk.html).join(''), /&lt;script&gt;/);
  assert.doesNotMatch(h.page.data.htmlChunks.map(chunk => chunk.html).join(''), /<script>/);
  assert.equal(h.page.data.post.counts.views, 4);
  assert.equal(h.calls.find(call => call.route.endsWith('/view')).payload.visitorId, 'mini_1234567890123456');
  await h.page.react(event({ type: 'like' })); assert.equal(h.navigations.at(-1), '/pages/account/index');
  assert.equal(h.calls.some(call => call.route.endsWith('/like')), false);
  assert.equal(h.page.onShareAppMessage().path, '/blog/pages/article/index?id=post_1'); h.page.onUnload();
});

test('authenticated article reactions use explicit state without loading comments', async () => {
  const h = host('article', { user: author }); await h.page.onShow();
  await h.page.react(event({ type: 'like' }));
  assert.equal(h.page.data.interaction.liked, true);
  assert.equal(h.calls.at(-1).payload.active, true);
  await h.page.react(event({ type: 'like' }));
  assert.equal(h.page.data.interaction.liked, false);
  assert.equal(h.calls.at(-1).payload.active, false);
  assert.equal(h.calls.some(call => call.route.includes('/comments')), false);
  h.page.onUnload();
});


test('switching accounts invalidates article responses and clears prior permissions', async () => {
  const h = host('article', { user: author }); await h.page.onShow();
  h.page.onHide(); h.setUser({ ...author, id: 'b'.repeat(32) });
  assert.equal(h.page.data.post, null); assert.equal(h.page.data.canEdit, false);
  await h.page.onShow(); assert.equal(h.page.data.user.id, 'b'.repeat(32)); h.page.onUnload();
});


test('blog pages are native subpackage routes and every WXML event has a handler', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  const pkg = app.subPackages.find(entry => entry.root === 'blog');
  assert.deepEqual(pkg.pages, ['pages/list/index', 'pages/article/index']);
  assert.equal(require('../miniprogram/data/catalog').getFeatureRoute('blog'), '/blog/pages/list/index');
  for (const kind of ['list', 'article']) {
    const h = host(kind), wxml = fs.readFileSync(path.join(root, 'blog/pages', kind, 'index.wxml'), 'utf8');
    assert.doesNotMatch(wxml, /<web-view\b/);
    for (const match of wxml.matchAll(/(?:bind|catch)(?:tap|input|confirm|blur)="([^"]+)"/g)) assert.equal(typeof h.page[match[1]], 'function', match[1]);
    h.page.onUnload();
  }
});


test('long native articles transfer balanced chunks without sending source and HTML together', async () => {
  const long = { ...article, content: ('短段落。\n\n').repeat(16000).slice(0, 100000) };
  const h = host('article', { request: async route => {
    if (route === '/posts/post_1') return { post: long, interaction: { liked: false, favorited: false }, canEdit: false };
    return { counts };
  } });
  await h.page.onShow(); await flush();
  assert.equal(h.page.data.error, '');
  assert.equal(Object.hasOwn(h.page.data.post, 'content'), false);
  assert.ok(h.page.data.htmlChunks.length > 1);
  assert.equal(h.page.data.contentLoading, false);
  assert.ok(h.patches.every(patch => Buffer.byteLength(JSON.stringify(patch), 'utf8') < 1024 * 1024));
  h.page.onUnload();
});

test('returning from a cached article preserves loaded list pages and updates counts without rereading', async () => {
  const list = host('list', { user: author, request: async (route, method, payload) => {
    if (route === '/me') return { user: author, canWrite: true };
    if (route.startsWith('/posts?')) return { posts: [{ ...article, id: route.includes('page=2') ? 'post_2' : 'post_1' }], total: 13, page: route.includes('page=2') ? 2 : 1, pageSize: 12, categories: ['随笔'], tags: ['生活'] };
    if (route === '/posts/post_1') return { post: structuredClone(article), interaction: { liked: false, favorited: false }, canEdit: true };
    if (route.endsWith('/view')) return { counts: { ...counts, views: 4 } };
    if (route.endsWith('/like')) return { counts: { ...counts, views: 4, likes: 1 }, interaction: { liked: true, favorited: false } };
    throw Error('Unexpected ' + route + ' ' + method + ' ' + payload);
  } });
  await list.page.onShow(); await list.page.loadMore(); list.page.onHide();
  const reader = host('article', { user: author, internal: true, cache: list.cache });
  await reader.page.onShow(); await flush(); await reader.page.react(event({ type: 'like' }));
  const before = list.calls.length;
  reader.page.onHide(); await list.page.onShow();
  assert.equal(list.calls.length, before, 'returning to the existing list only reads memory');
  assert.equal(list.page.data.page, 2); assert.deepEqual(Array.from(list.page.data.posts, post => post.id), ['post_1', 'post_2']);
  assert.equal(list.page.data.posts[0].counts.likes, 1); assert.equal(list.page.data.posts[0].counts.views, 4);
  list.page.onHide(); await reader.page.onShow();
  assert.equal(list.calls.length, before, 'returning to the reader keeps cached content');
  assert.equal(reader.page.data.interaction.liked, true);
  reader.page.onUnload(); list.page.onUnload();
});

test('native refresh bypasses cache while filters and repeated opens reuse the same visit', async () => {
  const list = host('list'); await list.page.onShow();
  const initial = list.calls.length;
  list.page.onHide(); await list.page.onShow(); assert.equal(list.calls.length, initial);
  await list.page.selectCategory(event({ category: '随笔' }));
  const filtered = list.calls.length;
  await list.page.clearFilters(); assert.equal(list.calls.length, filtered, 'returning to a loaded query uses its cache');
  await list.page.onPullDownRefresh(); assert.equal(list.calls.length, filtered + 2, 'pull down explicitly refreshes list and account permissions');
  const reader = host('article', { internal: true, cache: list.cache }); await reader.page.onShow(); await flush();
  const once = list.calls.length;
  reader.page.onHide(); await reader.page.onShow(); assert.equal(list.calls.length, once);
  await reader.page.onPullDownRefresh(); await flush();
  assert.equal(list.calls.length, once + 1, 'article is refreshed; successful daily view is reused');
  reader.page.onUnload(); list.page.onUnload();
});

test('a new visit or expired native cache fetches fresh article data', async () => {
  let now = 0;
  const reader = host('article', { now: () => now }); await reader.page.onShow(); await flush();
  reader.page.onHide();
  const initial = reader.calls.length; now += 5 * 60 * 1000 + 1;
  await reader.page.onShow(); await flush();
  assert.equal(reader.calls.length, initial + 1);
  reader.page.onHide(); reader.cache.reset();
  const beforeReturn = reader.calls.length; await reader.page.onShow(); await flush();
  assert.equal(reader.calls.length, beforeReturn + 2, 'foreground visit reset reads article and daily view anew');
  reader.page.onUnload();
});

test('returning to invalidated saved results fetches membership again and keeps ordinary list cache', async () => {
  let favorite = true;
  const list = host('list', { user: author, query: { saved: '1' }, request: async (route, method) => {
    if (route === '/me') return { user: author, canWrite: true };
    if (route.startsWith('/posts?')) return { posts: favorite ? [article] : [], total: favorite ? 1 : 0, page: 1, pageSize: 12, categories: [], tags: [] };
    if (route.endsWith('/favorite') && method === 'PUT') { favorite = false; return { counts: { ...counts, favorites: 0 }, interaction: { liked: false, favorited: false } }; }
    throw Error('Unexpected ' + route);
  } });
  await list.page.onShow(); list.page.onHide();
  await list.cache.request('/posts/post_1/favorite', 'PUT', { active: false });
  const before = list.calls.length; await list.page.onShow();
  assert.equal(list.calls.length, before + 1); assert.equal(list.page.data.posts.length, 0); assert.equal(list.page.data.total, 0);
  list.page.onUnload();
});

test('native blog navigation shares a visit internally and resets it when entering from elsewhere', () => {
  let pages = [{ route: 'pages/home/index' }, { route: 'blog/pages/list/index' }], resets = 0;
  const module = { exports: {} }, session = { request() {}, peek() {}, revision() {}, reset() { resets += 1; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'blog/lib/client.js'), 'utf8'), {
    module, getCurrentPages: () => pages,
    require(name) { return name.includes('blog-session') ? session : name.includes('config') ? { webOrigin: 'https://pocket.bornforthis.cn' } : {}; }
  });
  module.exports.enter(); assert.equal(resets, 1);
  pages = [{ route: 'blog/pages/list/index' }, { route: 'blog/pages/article/index' }];
  module.exports.enter(); assert.equal(resets, 1);
  pages = [{ route: 'blog/pages/article/index' }, { route: 'blog/pages/list/index' }];
  module.exports.enter(); assert.equal(resets, 1);
  pages = [{ route: 'pages/account/index' }, { route: 'blog/pages/article/index' }];
  module.exports.enter(); assert.equal(resets, 2);
});

test('a returning article keeps cached content without retransmitting its rich text', async () => {
  const reader = host('article');
  await reader.page.onShow(); await flush();
  const requests = reader.calls.length, richTextPatches = reader.patches.filter(patch => Object.keys(patch).some(key => key.startsWith('htmlChunks'))).length;
  reader.page.onHide(); await reader.page.onShow(); await flush();
  assert.equal(reader.calls.length, requests);
  assert.equal(reader.patches.filter(patch => Object.keys(patch).some(key => key.startsWith('htmlChunks'))).length, richTextPatches);
  reader.page.onUnload();
});


test('returning to the cached list clears a failed load-more message without another request', async () => {
  const list = host('list', { request: async route => {
    if (route === '/me') return { user: null, canWrite: false };
    if (route.includes('page=2')) throw Error('network unavailable');
    return { posts: [article], total: 13, page: 1, pageSize: 12, categories: [], tags: [] };
  } });
  await list.page.onShow(); await list.page.loadMore();
  assert.equal(list.page.data.error, 'network unavailable');
  const before = list.calls.length; list.page.onHide(); await list.page.onShow();
  assert.equal(list.calls.length, before); assert.equal(list.page.data.error, ''); assert.equal(list.page.data.loading, false);
  assert.equal(list.page.data.posts.length, 1); assert.equal(list.page.data.hasMore, true);
  list.page.onUnload();
});

test('the article list link returns to an existing list and only opens a new list for direct entries', () => {
  const returning = host('article', { pages: [{ route: 'blog/pages/list/index' }, { route: 'blog/pages/article/index' }] });
  returning.page.openList();
  assert.equal(returning.navigations.at(-1), 'back:1');
  returning.page.onUnload();
  const direct = host('article', { pages: [{ route: 'blog/pages/article/index' }] }); direct.page.openList();
  assert.equal(direct.navigations.at(-1), '/blog/pages/list/index'); direct.page.onUnload();
});

test('native blog hides legacy comment metadata and keeps share, favorite and like actions', async () => {
  const reader = host('article'); await reader.page.onShow(); await flush();
  for (const kind of ['list', 'article']) {
    const wxml = fs.readFileSync(path.join(root, 'blog/pages', kind, 'index.wxml'), 'utf8');
    assert.doesNotMatch(wxml, /comment|评论|回应/);
  }
  const articleWxml = fs.readFileSync(path.join(root, 'blog/pages/article/index.wxml'), 'utf8');
  assert.match(articleWxml, /open-type="share"/);
  assert.match(articleWxml, /data-type="favorite"/);
  assert.match(articleWxml, /data-type="like"/);
  assert.equal(reader.calls.some(call => call.route.includes('/comments')), false);
  assert.equal(Object.hasOwn(reader.page.data, 'commentText'), false);
  reader.page.onUnload();
});
