'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createBlogCache } = require('../miniprogram/lib/blog-cache');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const post = { id: 'article_1', title: '文章', content: '正文', status: 'published', counts: { views: 3, likes: 2, favorites: 1, comments: 4 } };
const DETAIL = '/posts/article_1', COMMENTS = DETAIL + '/comments?page=1&pageSize=20';
function host(options = {}) {
  let at = Date.UTC(2026, 9, 27, 6), identity = 'writer';
  const calls = [];
  const cache = createBlogCache({
    ...options, now: () => at, getIdentity: () => identity,
    request(path, method, data) {
      calls.push({ path, method, data });
      if (options.request) return options.request(path, method, data);
      if (path === '/me') return Promise.resolve({ user: { id: identity }, canWrite: true });
      if (path.startsWith('/posts?') || path.startsWith('/admin/posts?')) return Promise.resolve({ posts: [structuredClone(post)], total: 1 });
      if (path.includes('/comments')) return Promise.resolve({ comments: [{ id: 'comment_1', content: '留言' }], total: 1 });
      return Promise.resolve({ post: structuredClone(post), interaction: { liked: false, favorited: false } });
    }
  });
  return { cache, calls, advance(value) { at += value; }, account(value) { identity = value; } };
}

test('shared cache runs in a minimal WeChat-like host and exposes the same browser factory', () => {
  const source = fs.readFileSync(require.resolve('../miniprogram/lib/blog-cache'), 'utf8');
  const sandbox = { window: {}, Map, Date, JSON, Promise };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.window.BrclioBlogCache.createBlogCache, 'function');
  assert.doesNotMatch(source, /\b(?:URL|URLSearchParams|Buffer|TextEncoder|structuredClone)\b/);
});

test('successful reads normalize query order and encoding while keeping caller copies separate', async () => {
  const h = host();
  const first = await h.cache.request('/posts?page=1&q=%E6%96%87+%E5%AD%97');
  first.posts[0].title = '已在页面修改';
  const second = await h.cache.request('/posts?q=%E6%96%87%20%E5%AD%97&page=1');
  assert.equal(h.calls.length, 1); assert.equal(second.posts[0].title, '文章');
  const snapshot = h.cache.peek('/posts?page=1&q=%E6%96%87%20%E5%AD%97');
  snapshot.posts[0].counts.likes = 100;
  assert.equal(h.cache.peek('/posts?q=%E6%96%87%20%E5%AD%97&page=1').posts[0].counts.likes, 2);
});

test('duplicate query values retain their original precedence', async () => {
  const h = host();
  await h.cache.request('/posts?page=1&page=2'); await h.cache.request('/posts?page=2&page=1');
  assert.equal(h.calls.length, 2);
});

test('concurrent equivalent reads share transport but never share mutable response objects', async () => {
  const waiting = deferred(), h = host({ request: () => waiting.promise });
  const first = h.cache.request('/posts?page=1&q=a'), second = h.cache.request('/posts?q=a&page=1');
  assert.equal(h.calls.length, 1);
  waiting.resolve({ posts: [post] });
  const [a, b] = await Promise.all([first, second]); a.posts[0].title = '修改';
  assert.equal(b.posts[0].title, '文章'); assert.equal(h.cache.peek('/posts?q=a&page=1').posts[0].title, '文章');
});

test('fresh reads bypass cache and an older in-flight result cannot replace the refresh', async () => {
  const old = deferred(), current = deferred(); let sequence = 0;
  const h = host({ request: () => (++sequence === 1 ? old : current).promise });
  const before = h.cache.request(DETAIL), refreshed = h.cache.request(DETAIL, 'GET', undefined, { fresh: true });
  const joined = h.cache.request(DETAIL);
  current.resolve({ post: { ...post, title: '最新文章' } });
  assert.equal((await refreshed).post.title, '最新文章'); assert.equal((await joined).post.title, '最新文章');
  old.resolve({ post: { ...post, title: '过时文章' } });
  assert.equal((await before).post.title, '过时文章');
  assert.equal(h.cache.peek(DETAIL).post.title, '最新文章'); assert.equal(h.calls.length, 2);
});

test('reset starts a new visit and late prior-visit reads cannot backfill it', async () => {
  const waiting = deferred(), h = host({ request: () => waiting.promise });
  const revision = h.cache.revision(), pending = h.cache.request(DETAIL);
  h.cache.reset(); assert.equal(h.cache.revision(), revision + 1);
  waiting.resolve({ post }); assert.equal((await pending).post.title, '文章');
  assert.equal(h.cache.peek(DETAIL), undefined);
});

test('identity changes clear all reads and reject late private responses including cache hits', async () => {
  const h = host(); await h.cache.request('/me');
  const cachedRead = h.cache.request('/me'); h.account('reader');
  await assert.rejects(cachedRead, { code: 'operation_canceled', canceled: true });
  assert.equal(h.cache.peek('/me'), undefined); assert.equal((await h.cache.request('/me')).user.id, 'reader');
  const waiting = deferred(), privateHost = host({ request: () => waiting.promise });
  const pending = privateHost.cache.request('/admin/posts?page=1'); privateHost.account('other');
  waiting.resolve({ posts: [{ ...post, status: 'draft' }] });
  await assert.rejects(pending, { code: 'operation_canceled' });
  assert.equal(privateHost.cache.peek('/admin/posts?page=1'), undefined);
});

test('a pending private read stays canceled when the account changes away and back to the same identity', async () => {
  const waiting = deferred(), h = host({ request: () => waiting.promise });
  const pending = h.cache.request('/admin/posts?page=1');
  h.account('reader'); h.cache.revision(); h.account('writer'); h.cache.revision();
  waiting.resolve({ posts: [{ ...post, status: 'draft' }] });
  await assert.rejects(pending, { code: 'operation_canceled' });
  assert.equal(h.cache.peek('/admin/posts?page=1'), undefined);
});

test('TTL expires reads without extending lifetime on hits and clock rollback also expires', async () => {
  const h = host({ ttlMs: 100 }); await h.cache.request(DETAIL);
  h.advance(90); assert.ok(h.cache.peek(DETAIL));
  h.advance(10); assert.equal(h.cache.peek(DETAIL), undefined);
  await h.cache.request(DETAIL); assert.equal(h.calls.length, 2);
  h.advance(-1); assert.equal(h.cache.peek(DETAIL), undefined);
});

test('LRU entry and UTF-8 byte budgets bound memory and skip oversize responses', async () => {
  const h = host({ maxEntries: 2 });
  await h.cache.request('/posts?page=1'); await h.cache.request('/posts?page=2'); h.cache.peek('/posts?page=1');
  await h.cache.request('/posts?page=3');
  assert.equal(h.cache.peek('/posts?page=2'), undefined); assert.ok(h.cache.peek('/posts?page=1'));
  const budget = host({ maxBytes: 25, request: () => Promise.resolve({ value: '文字🙂文字' }) });
  await budget.cache.request('/me'); assert.equal(budget.cache.peek('/me'), undefined);
  const small = host({ maxBytes: Buffer.byteLength(JSON.stringify({ value: '文字🙂文字' })), request: () => Promise.resolve({ value: '文字🙂文字' }) });
  await small.cache.request('/me'); assert.deepEqual(small.cache.peek('/me'), { value: '文字🙂文字' });
  const sharedBudget = host({ maxBytes: 17, request: () => Promise.resolve({ v: 'a' }) });
  await sharedBudget.cache.request('/posts?page=1'); await sharedBudget.cache.request('/posts?page=2');
  assert.equal(sharedBudget.cache.peek('/posts?page=1'), undefined); assert.ok(sharedBudget.cache.peek('/posts?page=2'));
});

test('failed reads and unsupported read routes are never cached', async () => {
  let failed = true;
  const h = host({ request: () => failed ? Promise.reject(Error('offline')) : Promise.resolve({ okay: true }) });
  await assert.rejects(h.cache.request('/posts?page=1'), /offline/); assert.equal(h.cache.peek('/posts?page=1'), undefined);
  failed = false; await h.cache.request('/posts?page=1'); await h.cache.request('/posts?page=1'); assert.equal(h.calls.length, 2);
  await h.cache.request('/posts/article_1/comments/comment_1'); await h.cache.request('/posts/article_1/comments/comment_1');
  assert.equal(h.calls.length, 4); assert.equal(h.cache.peek('/posts/article_1/comments/comment_1'), undefined);
});

test('likes update article and list snapshots without mutating callers or extending TTL', async () => {
  const h = host({ ttlMs: 100, request(path, method) {
    if (method === 'PUT') return Promise.resolve({ counts: { ...post.counts, likes: 3 }, interaction: { liked: true, favorited: false } });
    return Promise.resolve(path === DETAIL ? { post: structuredClone(post), interaction: { liked: false, favorited: true } } : { posts: [structuredClone(post)] });
  } });
  const reader = await h.cache.request(DETAIL); await h.cache.request('/posts?page=1');
  const revision = h.cache.revision(); h.advance(90);
  await h.cache.request(DETAIL + '/like', 'PUT', { active: true });
  assert.equal(h.cache.revision(), revision, 'writes do not replace the visit epoch');
  assert.equal(reader.post.counts.likes, 2); assert.equal(h.cache.peek(DETAIL).post.counts.likes, 3);
  assert.deepEqual(h.cache.peek(DETAIL).interaction, { liked: true, favorited: true });
  assert.equal(h.cache.peek('/posts?page=1').posts[0].counts.likes, 3);
  h.advance(10); assert.equal(h.cache.peek(DETAIL), undefined);
});

test('favorite writes invalidate all saved pages while preserving other list snapshots', async () => {
  const h = host({ request(path, method) { return Promise.resolve(method === 'PUT' ? { counts: { ...post.counts, favorites: 0 }, interaction: { liked: false, favorited: false } } : { posts: [structuredClone(post)] }); } });
  await h.cache.request('/posts?saved=1&page=1'); await h.cache.request('/posts?page=2&saved=1'); await h.cache.request('/posts?page=1');
  await h.cache.request(DETAIL + '/favorite', 'PUT', { active: false });
  assert.equal(h.cache.peek('/posts?saved=1&page=1'), undefined); assert.equal(h.cache.peek('/posts?saved=1&page=2'), undefined);
  assert.equal(h.cache.peek('/posts?page=1').posts[0].counts.favorites, 0);
});

test('comment writes expire every comments page and repair list and detail counters', async () => {
  const h = host({ request(path, method) {
    if (method === 'POST' || method === 'DELETE') return Promise.resolve({ counts: { ...post.counts, comments: method === 'POST' ? 5 : 3 } });
    if (path === DETAIL) return Promise.resolve({ post: structuredClone(post) });
    return Promise.resolve(path.indexOf('/comments') >= 0 ? { comments: [{ id: 'comment_1' }], total: 4 } : { posts: [structuredClone(post)] });
  } });
  await h.cache.request(DETAIL); await h.cache.request('/posts?page=1'); await h.cache.request(COMMENTS); await h.cache.request(DETAIL + '/comments?page=2');
  await h.cache.request(DETAIL + '/comments', 'POST', { content: '新留言' });
  assert.equal(h.cache.peek(COMMENTS), undefined); assert.equal(h.cache.peek(DETAIL + '/comments?page=2'), undefined);
  assert.equal(h.cache.peek(DETAIL).post.counts.comments, 5); assert.equal(h.cache.peek('/posts?page=1').posts[0].counts.comments, 5);
  await h.cache.request(DETAIL + '/comments/comment_1', 'DELETE');
  assert.equal(h.cache.peek(DETAIL).post.counts.comments, 3);
});

test('editor writes clear public and private content reads but preserve account metadata', async () => {
  const h = host();
  await h.cache.request('/me'); await h.cache.request('/posts?page=1'); await h.cache.request('/admin/posts?page=1'); await h.cache.request(DETAIL); await h.cache.request(COMMENTS);
  await h.cache.request('/admin/posts/article_1', 'PUT', { title: '新版', revision: 1 });
  for (const path of ['/posts?page=1', '/admin/posts?page=1', DETAIL, COMMENTS]) assert.equal(h.cache.peek(path), undefined);
  assert.equal(h.cache.peek('/me').user.id, 'writer');
});

test('reads overlapping a write cannot backfill pre-mutation counters or comments', async () => {
  const oldDetail = deferred(), oldComments = deferred();
  const h = host({ request(path, method) {
    if (method === 'PUT') return Promise.resolve({ counts: { ...post.counts, likes: 3 }, interaction: { liked: true } });
    if (method === 'POST') return Promise.resolve({ counts: { ...post.counts, comments: 5 } });
    return path === DETAIL ? oldDetail.promise : oldComments.promise;
  } });
  const before = h.cache.request(DETAIL), commentsBefore = h.cache.request(COMMENTS);
  await h.cache.request(DETAIL + '/like', 'PUT', { active: true }); await h.cache.request(DETAIL + '/comments', 'POST', { content: '文字' });
  oldDetail.resolve({ post }); oldComments.resolve({ comments: [], total: 0 }); await Promise.all([before, commentsBefore]);
  assert.equal(h.cache.peek(DETAIL), undefined); assert.equal(h.cache.peek(COMMENTS), undefined);
});

test('view requests share in-flight work and successful UTC-day dedupe resets on a new visit or day', async () => {
  const waiting = deferred(), h = host({ request: () => waiting.promise });
  const first = h.cache.request(DETAIL + '/view', 'POST', { visitorId: 'visitor' });
  const second = h.cache.request(DETAIL + '/view', 'POST', { visitorId: 'visitor' });
  assert.equal(h.calls.length, 1); waiting.resolve({ counts: { ...post.counts, views: 4 } }); await Promise.all([first, second]);
  const cached = await h.cache.request(DETAIL + '/view', 'POST', { visitorId: 'visitor' }); cached.counts.views = 99;
  assert.equal((await h.cache.request(DETAIL + '/view', 'POST', { visitorId: 'visitor' })).counts.views, 4); assert.equal(h.calls.length, 1);
  h.advance(86400000); await h.cache.request(DETAIL + '/view', 'POST', {}); assert.equal(h.calls.length, 2);
  h.cache.reset(); await h.cache.request(DETAIL + '/view', 'POST', {}); assert.equal(h.calls.length, 3);
  h.account('reader'); await h.cache.request(DETAIL + '/view', 'POST', {}); assert.equal(h.calls.length, 4);
});

test('late view replies update only views and preserve newer reaction and comment counts', async () => {
  const view = deferred();
  const h = host({ request(path, method) {
    if (path.endsWith('/view')) return view.promise;
    if (path.endsWith('/like')) return Promise.resolve({ counts: { ...post.counts, likes: 3, views: 4 }, interaction: { liked: true } });
    if (path.endsWith('/comments') && method === 'POST') return Promise.resolve({ counts: { ...post.counts, comments: 5, views: 4 } });
    return Promise.resolve({ post: structuredClone(post), interaction: { liked: false, favorited: false } });
  } });
  await h.cache.request(DETAIL); const pending = h.cache.request(DETAIL + '/view', 'POST', {});
  await h.cache.request(DETAIL + '/like', 'PUT', { active: true }); await h.cache.request(DETAIL + '/comments', 'POST', { content: '评论' });
  view.resolve({ counts: { views: 5, likes: 2, favorites: 1, comments: 4 } }); await pending;
  assert.deepEqual(h.cache.peek(DETAIL).post.counts, { views: 5, likes: 3, favorites: 1, comments: 5 });
});

test('parallel reaction replies patch only their own interaction and counter fields', async () => {
  const like = deferred(), favorite = deferred();
  const h = host({ request(path) {
    if (path.endsWith('/like')) return like.promise;
    if (path.endsWith('/favorite')) return favorite.promise;
    return Promise.resolve({ post: structuredClone(post), interaction: { liked: false, favorited: false } });
  } });
  await h.cache.request(DETAIL);
  const a = h.cache.request(DETAIL + '/like', 'PUT', { active: true }), b = h.cache.request(DETAIL + '/favorite', 'PUT', { active: true });
  favorite.resolve({ counts: { ...post.counts, favorites: 2 }, interaction: { liked: false, favorited: true } }); await b;
  like.resolve({ counts: { ...post.counts, likes: 3 }, interaction: { liked: true, favorited: false } }); await a;
  assert.deepEqual(h.cache.peek(DETAIL).interaction, { liked: true, favorited: true });
  assert.equal(h.cache.peek(DETAIL).post.counts.favorites, 2); assert.equal(h.cache.peek(DETAIL).post.counts.likes, 3);
});

test('failed writes expire affected snapshots and failed views can retry', async () => {
  let failed = false;
  const h = host({ request(path, method) {
    if (method !== 'GET') return failed ? Promise.reject(Error('response lost')) : Promise.resolve({ counts: { ...post.counts, views: 4 } });
    return Promise.resolve(path === DETAIL ? { post } : path.includes('/comments') ? { comments: [] } : { posts: [post] });
  } });
  await h.cache.request(DETAIL); await h.cache.request('/posts?page=1'); await h.cache.request(COMMENTS); failed = true;
  await assert.rejects(h.cache.request(DETAIL + '/comments', 'POST', { content: '文字' }), /response lost/);
  assert.equal(h.cache.peek(DETAIL), undefined); assert.equal(h.cache.peek('/posts?page=1'), undefined); assert.equal(h.cache.peek(COMMENTS), undefined);
  await assert.rejects(h.cache.request(DETAIL + '/view', 'POST', {}), /response lost/);
  failed = false; await h.cache.request(DETAIL + '/view', 'POST', {});
  assert.equal(h.calls.filter(call => call.path.endsWith('/view')).length, 2);
});

test('a write finishing after visit reset invalidates newer stale reads without refilling old values', async () => {
  const waiting = deferred();
  const h = host({ request(path, method) { return method === 'PUT' ? waiting.promise : Promise.resolve({ post: structuredClone(post) }); } });
  const pending = h.cache.request(DETAIL + '/like', 'PUT', { active: true });
  h.cache.reset(); await h.cache.request(DETAIL); assert.ok(h.cache.peek(DETAIL));
  waiting.resolve({ counts: { ...post.counts, likes: 3 } }); await pending;
  assert.equal(h.cache.peek(DETAIL), undefined);
});
