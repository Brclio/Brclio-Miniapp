'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../web/blog/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../web/blog/main.js'), 'utf8');
const renderer = require('../miniprogram/lib/blog-content');
const cacheEngine = require('../miniprogram/lib/blog-cache');
const ID = 'a'.repeat(32), USER = { id: 'b'.repeat(32), displayName: '写作者' };
const post = { id: ID, title: '写下一点好奇', content: '## 开始\n\n一点文字。', excerpt: '给想法一个位置。', status: 'published', revision: 3, category: '学习', tags: ['记录'], author: { id: USER.id, displayName: USER.displayName }, readingMinutes: 1, publishedAt: 1793088000000, updatedAt: 1793088000000, commentsEnabled: true, counts: { views: 12, likes: 2, favorites: 1, comments: 0 } };
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
async function harness(options = {}) {
  const dom = new JSDOM(html, { url: options.url || 'https://pocket.bornforthis.cn/blog/', runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window, calls = [], timers = new Map(); let nextTimer = 0, accountListener;
  const activeUser = options.user === undefined ? USER : options.user;
  window.BrclioBlogContent = renderer;
  window.BrclioBlogCache = cacheEngine;
  window.scrollTo = () => {};
  window.confirm = window.alert = () => { throw new Error('Blog confirmations must stay inside the page'); };
  let dialogFocus;
  window.HTMLDialogElement.prototype.showModal = function () { dialogFocus = window.document.activeElement; this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); dialogFocus?.focus(); window.queueMicrotask(() => this.dispatchEvent(new window.Event('close'))); };
  window.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
  window.clearTimeout = id => timers.delete(id);
  if (options.storage) for (const [key, value] of Object.entries(options.storage)) window.localStorage.setItem(key, JSON.stringify(value));
  window.BrclioAccount = {
    ready: Promise.resolve(), client: { getCachedUser: () => activeUser }, onAccountChange(callback) { accountListener = callback; },
    async requestBlog(route, settings = {}) {
      const request = { route, ...structuredClone(settings) }; calls.push(request);
      const intercepted = await options.respond?.(request);
      if (intercepted !== undefined) return structuredClone(intercepted);
      if (route === '/me') return { user: activeUser, canWrite: options.canWrite !== false && !!activeUser };
      if (route.startsWith('/posts?') || route.startsWith('/admin/posts?')) return { posts: [structuredClone(post)], total: 1, page: 1, pageSize: 12, categories: ['学习'], tags: ['记录'] };
      if (route === '/posts/' + ID) return { post: structuredClone(post), canEdit: options.canWrite !== false && !!activeUser, interaction: { liked: false, favorited: false } };
      if (route.endsWith('/view')) return { counts: { ...post.counts, views: 13 } };
      if (route.endsWith('/like')) return { interaction: { liked: true, favorited: false }, counts: { ...post.counts, likes: 3 } };
      if (route.endsWith('/favorite')) return { interaction: { liked: false, favorited: true }, counts: { ...post.counts, favorites: 2 } };
      if (route === '/admin/posts' || route === '/admin/posts/' + ID) return { post: { ...structuredClone(post), ...structuredClone(settings.data), revision: 4, id: ID } };
      throw new Error('Unexpected route ' + route);
    }
  };
  window.eval(script); window.document.dispatchEvent(new window.Event('DOMContentLoaded')); await flush();
  const get = selector => window.document.querySelector(selector);
  const input = (name, value) => { const element = get('#editor-form').elements[name]; element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); };
  return { window, dom, calls, get, input, timers, flush, accountListener, click: async selector => { get(selector).click(); await flush(); }, close: () => dom.window.close() };
}

test('blog renders live list, escapes metadata and filters query without treating data as markup', async () => {
  const h = await harness({ respond(request) { if (request.route.startsWith('/posts?')) return { posts: [{ ...post, title: '<script>attack</script>' }], total: 1, page: 1, pageSize: 12, categories: ['学习'], tags: ['记录'] }; } });
  assert.equal(h.get('.post-row h2').textContent, '<script>attack</script>');
  assert.equal(h.get('#posts script'), null);
  h.get('#search').value = '语法'; h.get('#search-form').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.ok(h.calls.some(call => call.route.includes('q=%E8%AF%AD%E6%B3%95')));
  await h.click('[data-category="学习"]'); assert.equal(new URL(h.window.location.href).searchParams.get('category'), '学习');
  h.close();
});

test('saved alias requires a real account and hides writing controls for readers', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?saved=1', user: null });
  assert.match(h.get('#list-title').textContent, /重读|文字/);
  assert.match(h.get('#posts').textContent, /登录/);
  assert.equal(h.get('[data-view="write"]').hidden, true);
  assert.equal(h.calls.some(call => call.route.includes('saved=1')), false);
  h.close();
});

test('reader renders safe Markdown, registers view and persists reaction through API', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID });
  assert.equal(h.get('#post-title').textContent, post.title);
  assert.equal(h.get('#article-content h2').textContent, '开始');
  assert.equal(h.get('#toc a').textContent, '开始');
  assert.ok(h.calls.some(call => call.route.endsWith('/view') && /^[a-f0-9]{32}$/.test(call.data.visitorId)));
  await h.click('[data-reaction="like"]');
  const reaction = h.calls.find(call => call.route.endsWith('/like'));
  assert.equal(reaction.method, 'PUT'); assert.equal(reaction.data.active, true);
  assert.equal(h.get('[data-reaction="like"]').getAttribute('aria-pressed'), 'true');
  assert.match(h.get('[data-reaction="like"]').textContent, /3/);
  h.close();
});

test('readers never render or request comments even for legacy articles that enabled them', async () => {
  for (const user of [USER, null]) {
    const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID, user });
    assert.equal(h.get('#post-title').textContent, post.title);
    assert.equal(h.get('.comments-section, #comment-form, #comments-count, [data-action="jump-comments"]'), null);
    assert.doesNotMatch(h.get('#blog-reader').textContent, /评论|留言/);
    assert.equal(h.calls.some(call => call.route.includes('/comments')), false);
    await h.click('[data-action="back-list"]');
    assert.equal(h.get('.post-statistics').querySelectorAll('.stat-item').length, 3);
    assert.doesNotMatch(h.get('.post-statistics').textContent, /评论|留言/);
    h.close();
  }
});

test('editor autosave is account scoped and revision conflicts preserve entered text', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write&edit=' + ID, respond(request) {
    if (request.method === 'PUT' && request.route.startsWith('/admin/')) { const error = new Error('文章已在其他页面更新'); error.status = 409; error.code = 'revision_conflict'; throw error; }
  } });
  h.input('title', '我仍在写'); h.input('content', '不能丢失的文字');
  for (const callback of [...h.timers.values()]) callback();
  const key = 'brclio.blog-draft.v1:' + USER.id + ':' + ID;
  assert.equal(JSON.parse(h.window.localStorage.getItem(key)).fields.content, '不能丢失的文字');
  await h.click('[data-save="published"]');
  const save = h.calls.find(call => call.method === 'PUT'); assert.equal(save.data.revision, 3);
  assert.equal(h.get('#editor-form').elements.content.value, '不能丢失的文字');
  assert.match(h.get('#notice').textContent, /新版本/);
  assert.equal(JSON.parse(h.window.localStorage.getItem(key)).fields.content, '不能丢失的文字');
  h.close();
});

test('new article preview, draft recovery and save use the live writing API', async () => {
  const key = 'brclio.blog-draft.v1:' + USER.id + ':new';
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write', storage: { [key]: { version: 1, userId: USER.id, postId: '', at: Date.now(), revision: 0, fields: { title: '恢复文章', content: '## 被保留的文字', tags: ['记录'], commentsEnabled: true } } } });
  assert.equal(h.get('#draft-recovery').hidden, false);
  assert.equal(h.get('[name=commentsEnabled]'), null);
  await h.click('[data-action="restore-draft"]');
  assert.equal(h.get('#editor-form').elements.title.value, '恢复文章');
  assert.equal(Object.hasOwn(JSON.parse(h.window.localStorage.getItem(key)).fields, 'commentsEnabled'), false);
  await h.click('[data-editor-mode="preview"]');
  assert.equal(h.get('#editor-preview h2').textContent, '被保留的文字');
  await h.click('[data-save="draft"]');
  const save = h.calls.find(call => call.route === '/admin/posts'); assert.equal(save.method, 'POST'); assert.equal(save.data.status, 'draft');
  assert.equal(Object.hasOwn(save.data, 'commentsEnabled'), false);
  assert.equal(h.window.localStorage.getItem(key), null);
  assert.equal(new URL(h.window.location.href).searchParams.get('edit'), ID);
  assert.match(h.get('#notice').textContent, /云端/);
  h.close();
});

test('article unavailable and API failures provide a retry while preserving the route', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID, respond(request) { if (request.route === '/posts/' + ID) throw new Error('文章不存在或已撤回。'); } });
  assert.match(h.get('#blog-reader').textContent, /撤回/); assert.ok(h.get('[data-action="retry"]'));
  await h.click('[data-action="retry"]'); assert.equal(h.calls.filter(call => call.route === '/posts/' + ID).length, 2);
  h.close();
});

test('reader mutations share a pending lock so reaction snapshots cannot overlap', async () => {
  let finishLike;
  const likeReply = new Promise(resolve => { finishLike = resolve; });
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID, respond(request) {
    if (request.route.endsWith('/like')) return likeReply;
    if (request.route.endsWith('/favorite')) return { interaction: { liked: true, favorited: true }, counts: { ...post.counts, likes: 3, favorites: 2 } };
  } });
  await h.click('[data-reaction="like"]');
  for (const button of h.window.document.querySelectorAll('[data-reaction]')) assert.equal(button.disabled, true);
  assert.equal(h.get('#toc a').getAttribute('href'), '#section-0');
  await h.click('[data-reaction="favorite"]');
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1);
  finishLike({ interaction: { liked: true, favorited: false }, counts: { ...post.counts, likes: 3 } }); await flush();
  assert.equal(h.get('[data-reaction="favorite"]').disabled, false);
  await h.click('[data-reaction="favorite"]');
  assert.equal(h.get('[data-reaction="like"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.get('[data-reaction="favorite"]').getAttribute('aria-pressed'), 'true');
  h.close();
});



test('restoring an older draft keeps its base revision and requires comparison acknowledgement before replacing the cloud article', async () => {
  const key = 'brclio.blog-draft.v1:' + USER.id + ':' + ID;
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write&edit=' + ID, storage: { [key]: { version: 1, userId: USER.id, postId: ID, at: Date.now(), revision: 2, fields: { title: '旧版本的想法', content: '需要先和云端比较的文字', tags: [], commentsEnabled: true } } } });
  await h.click('[data-action="restore-draft"]');
  assert.equal(JSON.parse(h.window.localStorage.getItem(key)).revision, 2);
  assert.match(h.get('#notice').textContent, /旧版本/);
  await h.click('[data-save="published"]');
  assert.equal(h.calls.some(call => call.method === 'PUT'), false);
  assert.match(h.get('#confirm-message').textContent, /版本 2/); assert.match(h.get('#confirm-message').textContent, /版本 3/); assert.match(h.get('#confirm-message').textContent, /比较/);
  await h.click('#confirm-cancel');
  assert.equal(h.get('#editor-form').elements.content.value, '需要先和云端比较的文字');
  await h.click('[data-save="published"]');
  await h.click('#confirm-accept');
  const save = h.calls.find(call => call.method === 'PUT'); assert.equal(save.data.revision, 3);
  assert.equal(h.window.localStorage.getItem(key), null);
  h.close();
});





test('publishing uses an in-page confirmation; cancel and Escape preserve the editor without a write', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write' });
  h.input('title', '<文章标题>'); h.input('content', '准备分享的文字');
  const publish = h.get('[data-save="published"]'); publish.focus();
  await h.click('[data-save="published"]');
  assert.equal(h.get('#confirm-dialog').open, true);
  assert.match(h.get('#confirm-title').textContent, /确认发布/);
  assert.equal(h.get('#confirm-subject').textContent, '<文章标题>'); assert.equal(h.get('#confirm-subject').children.length, 0);
  assert.equal(h.window.document.activeElement, h.get('#confirm-cancel'));
  assert.equal(h.calls.some(call => call.method === 'POST'), false);
  await h.click('#confirm-cancel');
  assert.equal(h.get('#confirm-dialog').open, false); assert.equal(h.window.document.activeElement, publish);
  assert.equal(h.get('#editor-form').elements.content.value, '准备分享的文字');
  await h.click('[data-save="published"]');
  const escape = new h.window.Event('cancel', { cancelable: true }); h.get('#confirm-dialog').dispatchEvent(escape); await flush();
  assert.equal(escape.defaultPrevented, true); assert.equal(h.get('#confirm-dialog').open, false);
  assert.equal(h.calls.some(call => call.method === 'POST'), false);
  await h.click('[data-save="published"]'); await h.click('#confirm-accept');
  assert.equal(h.calls.filter(call => call.route === '/admin/posts').length, 1);
  assert.equal(h.calls.find(call => call.route === '/admin/posts').data.status, 'published');
  assert.match(h.get('#notice').textContent, /已发布/);
  assert.equal(h.get('#confirm-dialog').open, false);
  h.close();
});

test('repeated publish clicks and confirmation clicks send exactly one write while saving', async () => {
  let finishSave;
  const saving = new Promise(resolve => { finishSave = resolve; });
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write', respond(request) { if (request.route === '/admin/posts') return saving; } });
  h.input('title', '只发布一次'); h.input('content', '正文');
  await h.click('[data-save="published"]'); await h.click('[data-save="published"]');
  assert.equal(h.calls.some(call => call.method === 'POST'), false);
  await h.click('#confirm-accept'); await h.click('#confirm-accept'); await h.click('[data-save="published"]');
  assert.equal(h.calls.filter(call => call.route === '/admin/posts').length, 1);
  assert.equal(h.get('[data-save="published"]').disabled, true);
  finishSave({ post }); await flush();
  assert.equal(h.get('[data-save="published"]').disabled, false);
  h.close();
});

test('route and page lifecycle changes cancel pending confirmations without sending stale writes', async () => {
  for (const type of ['popstate', 'pagehide']) {
    const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write' });
    h.input('title', '没有确认的文章'); h.input('content', '保留的文字');
    await h.click('[data-save="published"]');
    if (type === 'popstate') h.window.history.replaceState({}, '', '/blog/');
    h.window.dispatchEvent(new h.window.Event(type)); await flush();
    assert.equal(h.get('#confirm-dialog').open, false, type);
    await h.click('#confirm-accept');
    assert.equal(h.calls.some(call => call.method === 'POST'), false, type);
    assert.equal(JSON.parse(h.window.localStorage.getItem('brclio.blog-draft.v1:' + USER.id + ':new')).fields.content, '保留的文字');
    h.close();
  }
});

test('old draft review and publication confirmations remain separate across queued close events', async () => {
  const key = 'brclio.blog-draft.v1:' + USER.id + ':' + ID;
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write&edit=' + ID,
    storage: { [key]: { version: 1, userId: USER.id, postId: ID, at: Date.now(), revision: 2, fields: { title: '本机草稿', content: '待发布正文', tags: [] } } },
    respond(request) { if (request.route === '/posts/' + ID) return { post: { ...post, status: 'draft' }, canEdit: true }; }
  });
  await h.click('[data-action="restore-draft"]'); await h.click('[data-save="published"]');
  assert.match(h.get('#confirm-title').textContent, /替换/);
  await h.click('#confirm-accept');
  assert.equal(h.get('#confirm-dialog').open, true); assert.match(h.get('#confirm-title').textContent, /发布/);
  assert.equal(h.calls.some(call => call.method === 'PUT'), false);
  await h.click('#confirm-cancel'); assert.equal(h.calls.some(call => call.method === 'PUT'), false);
  await h.click('[data-save="published"]'); await h.click('#confirm-accept'); await h.click('#confirm-accept');
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1);
  h.close();
});

test('withdrawal, article deletion and local draft removal use explicit in-page danger confirmations', async () => {
  const key = 'brclio.blog-draft.v1:' + USER.id + ':' + ID;
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write&edit=' + ID,
    storage: { [key]: { version: 1, userId: USER.id, postId: ID, at: Date.now(), revision: 3, fields: { title: '草稿', content: '保留的文字' } } },
    respond(request) { if (request.method === 'DELETE') return { deleted: true }; }
  });
  await h.click('[data-action="discard-draft"]'); assert.equal(h.get('#confirm-dialog').dataset.danger, 'true');
  await h.click('#confirm-cancel'); assert.notEqual(h.window.localStorage.getItem(key), null);
  await h.click('[data-action="discard-draft"]'); await h.click('#confirm-accept'); assert.equal(h.window.localStorage.getItem(key), null);
  await h.click('[data-save="draft"]'); assert.match(h.get('#confirm-title').textContent, /撤回/);
  await h.click('#confirm-cancel'); assert.equal(h.calls.some(call => call.method === 'PUT'), false);
  await h.click('[data-save="draft"]'); await h.click('#confirm-accept');
  assert.equal(h.calls.find(call => call.method === 'PUT').data.status, 'draft');
  await h.click('[data-action="delete-post"]'); assert.match(h.get('#confirm-title').textContent, /永久删除/);
  await h.click('#confirm-cancel'); assert.equal(h.calls.some(call => call.method === 'DELETE'), false);
  await h.click('[data-action="delete-post"]'); await h.click('#confirm-accept');
  assert.equal(h.calls.filter(call => call.method === 'DELETE').length, 1);
  assert.equal(new URL(h.window.location.href).searchParams.get('view'), 'admin');
  h.close();
});

test('leaving a dirty editor requires in-page consent and retains account-scoped local text', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?view=write' });
  h.input('title', '稍后继续'); h.input('content', '本机文字');
  await h.click('[data-action="back-admin"]'); assert.match(h.get('#confirm-title').textContent, /离开/);
  await h.click('#confirm-cancel'); assert.equal(new URL(h.window.location.href).searchParams.get('view'), 'write');
  await h.click('[data-action="back-admin"]'); await h.click('#confirm-accept');
  assert.equal(new URL(h.window.location.href).searchParams.get('view'), 'admin');
  assert.equal(JSON.parse(h.window.localStorage.getItem('brclio.blog-draft.v1:' + USER.id + ':new')).fields.content, '本机文字');
  h.close();
});

test('list and repeated article navigation reuse cached data and restore the list filters', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?category=' + encodeURIComponent('学习') + '&page=2', respond(request) {
    if (request.route.startsWith('/posts?')) return { posts: [post], total: 25, page: 2, pageSize: 12, categories: ['学习'], tags: ['记录'] };
  } });
  const reads = () => h.calls.filter(call => !call.method || call.method === 'GET');
  await h.click('[data-post]'); await h.click('[data-action="back-list"]');
  assert.equal(new URL(h.window.location.href).searchParams.get('category'), '学习');
  assert.equal(new URL(h.window.location.href).searchParams.get('page'), '2');
  await h.click('[data-post]'); await h.click('[data-action="back-list"]');
  assert.equal(reads().filter(call => call.route === '/posts/' + ID).length, 1);
  assert.equal(reads().filter(call => call.route.includes('/comments')).length, 0);
  assert.equal(h.calls.filter(call => call.route.endsWith('/view')).length, 1);
  assert.equal(reads().filter(call => call.route.startsWith('/posts?')).length, 1);
  h.close();
});

test('own interactions update cached list and article state without refetching their content', async () => {
  const h = await harness();
  await h.click('[data-post]'); await h.click('[data-reaction="like"]'); await h.click('[data-action="back-list"]');
  assert.match(h.get('.post-meta').textContent, /3 赞/);
  await h.click('[data-post]');
  assert.equal(h.get('[data-reaction="like"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.calls.filter(call => call.route === '/posts/' + ID).length, 1);
  assert.equal(h.calls.filter(call => call.route.startsWith('/posts?')).length, 1);
  h.close();
});

test('manual refresh and re-entry replace cached data with the latest server data', async () => {
  let remoteTitle = '第一次内容';
  const h = await harness({ respond(request) {
    if (request.route.startsWith('/posts?')) return { posts: [{ ...post, title: remoteTitle }], total: 1, page: 1, pageSize: 12, categories: [], tags: [] };
  } });
  remoteTitle = '最新内容';
  await h.click('[data-view="list"]'); assert.equal(h.get('.post-row h2').textContent, '第一次内容');
  await h.click('#refresh-blog'); assert.equal(h.get('.post-row h2').textContent, '最新内容');
  assert.equal(h.get('#refresh-blog').disabled, false);
  remoteTitle = '重新进入的内容';
  h.window.dispatchEvent(new h.window.Event('pagehide'));
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true })); await flush();
  assert.equal(h.get('.post-row h2').textContent, '重新进入的内容');
  assert.equal(h.calls.filter(call => call.route.startsWith('/posts?')).length, 3);
  h.close();
});

test('opening the editor always reads the latest revision even after a cached article read', async () => {
  let revision = 3;
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID, respond(request) {
    if (request.route === '/posts/' + ID) return { post: { ...post, revision }, canEdit: true, interaction: {} };
  } });
  revision = 4;
  await h.click('[data-edit]');
  assert.equal(h.calls.filter(call => call.route === '/posts/' + ID).length, 2);
  h.input('content', '从最新版本继续修改'); await h.click('[data-save="published"]');
  assert.equal(h.calls.find(call => call.method === 'PUT').data.revision, 4);
  h.close();
});

test('a forced refresh never keeps displaying cached article content after the server withdraws it', async () => {
  let withdrawn = false;
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID, respond(request) {
    if (withdrawn && request.route === '/posts/' + ID) { const error = new Error('文章已撤回。'); error.status = 404; throw error; }
  } });
  assert.equal(h.get('#post-title').textContent, post.title);
  withdrawn = true; await h.click('#refresh-blog');
  assert.equal(h.get('#post-title'), null); assert.match(h.get('#blog-reader').textContent, /撤回/);
  h.close();
});

test('a delayed refresh cannot replace a newly opened editor or erase its unsaved words', async () => {
  let reads = 0, finishRefresh;
  const pending = new Promise(resolve => { finishRefresh = resolve; });
  const h = await harness({ respond(request) { if (request.route === '/me' && ++reads === 2) return pending; } });
  await h.click('#refresh-blog'); await h.click('[data-view="write"]');
  h.input('title', '正在写的新文章'); h.input('content', '不能被延迟刷新覆盖');
  finishRefresh({ user: USER, canWrite: true }); await flush();
  assert.equal(h.get('#editor-form').elements.content.value, '不能被延迟刷新覆盖');
  assert.equal(h.get('#account-entry').textContent, USER.displayName + ' ↗');
  assert.equal(h.get('[data-view="write"]').hidden, false);
  assert.equal(h.get('#refresh-blog').disabled, false);
  h.close();
});

test('article cards use optional left thumbnails and accessible real interaction statistics', async () => {
  const h = await harness({ respond(request) {
    if (request.route.startsWith('/posts?')) return { posts: [{ ...post, coverUrl: 'https://images.example.test/cover.jpg' }, { ...post, id: 'c'.repeat(32), coverUrl: '' }], total: 2, page: 1, pageSize: 12, categories: [], tags: [] };
  } });
  const cards = [...h.window.document.querySelectorAll('.post-row')];
  assert.equal(cards.length, 2); assert.equal(cards[0].classList.contains('has-cover'), true);
  assert.equal(cards[0].querySelector('.post-row-main').firstElementChild.className, 'post-cover');
  assert.equal(cards[0].querySelector('.post-row-image').getAttribute('src'), 'https://images.example.test/cover.jpg');
  assert.equal(cards[1].querySelector('.post-cover'), null); assert.equal(cards[1].classList.contains('has-cover'), false);
  assert.equal(cards[0].querySelector('.stat-item').getAttribute('aria-label'), '12 次阅读');
  assert.equal(cards[0].querySelectorAll('.stat-item svg[aria-hidden="true"]').length, 3);
  h.close();
});

test('mobile reading actions update both toolbars and share the article link', async () => {
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID });
  const copied = [];
  Object.defineProperty(h.window.navigator, 'clipboard', { value: { async writeText(value) { copied.push(value); } } });
  assert.equal(h.get('.reader-dock').querySelectorAll('button').length, 3);
  await h.click('.reader-dock [data-reaction="like"]');
  const likes = [...h.window.document.querySelectorAll('[data-reaction="like"]')];
  assert.equal(likes.length, 2); likes.forEach(button => { assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.match(button.getAttribute('aria-label'), /已赞/); assert.equal(button.querySelector('.action-count').textContent, '3'); });
  await h.click('.reader-dock [data-reaction="favorite"]');
  [...h.window.document.querySelectorAll('[data-reaction="favorite"]')].forEach(button => assert.equal(button.getAttribute('aria-pressed'), 'true'));
  await h.click('.reader-dock [data-action="copy-link"]');
  assert.deepEqual(copied, ['https://pocket.bornforthis.cn/blog/?post=' + ID]);
  assert.match(h.get('#notice').textContent, /已复制/);
  h.close();
});

test('reader refresh fetches latest content without requesting comments', async () => {
  let remoteTitle = post.title;
  const h = await harness({ url: 'https://pocket.bornforthis.cn/blog/?post=' + ID, respond(request) {
    if (request.route === '/posts/' + ID) return { post: { ...post, title: remoteTitle, commentsEnabled: false }, interaction: {}, canEdit: false };
  } });
  remoteTitle = '重新读取后的文章'; await h.click('[data-action="refresh-reader"]');
  assert.equal(h.get('#post-title').textContent, remoteTitle);
  assert.equal(h.calls.filter(call => call.route === '/posts/' + ID).length, 2);
  assert.equal(h.calls.some(call => call.route.includes('/comments')), false);
  h.close();
});
