'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createBrowserAccount } = require('../web/account-browser');
const { createAccountClient } = require('../miniprogram/lib/account');
const renderer = require('../miniprogram/lib/blog-content');
const cacheEngine = require('../miniprogram/lib/blog-cache');
const ORIGIN = 'https://pocket.bornforthis.cn';
const html = fs.readFileSync(path.join(__dirname, '../web/blog/index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../web/blog/main.js'), 'utf8');

async function until(predicate, description) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out: ' + description);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// All account, blog and rendering code is real. Only storage, transport and
// verification-email delivery are replaced; no remote account or article exists.
test('web editor and native account client share draft, publication, interactions and withdrawal', { timeout: 20000 }, async t => {
  const [{ createAccountApi }, { createBlogApi }] = await Promise.all([import('../web/account-api.mjs'), import('../web/blog-api.mjs')]);
  const state = { users: new Map(), blog: new Map(), data: new Map() }, queues = { users: Promise.resolve(), blog: Promise.resolve(), data: Promise.resolve() }, deliveries = [];
  const now = () => Date.UTC(2026, 9, 27, 6);
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: 'integration-only-account-hmac-secret-at-least32', BLOG_ADMIN_EMAILS: 'aiyuechuang@gmail.com' };
  const storeFactory = (_env, { repository }) => ({
    async read(file) { return structuredClone(state[repository].get(file) || null); },
    transaction(callback) {
      const pending = queues[repository].then(async () => {
        const draft = structuredClone(state[repository]);
        const result = await callback({ get: async file => structuredClone(draft.get(file) || null),
          put(file, value) { draft.set(file, structuredClone(value)); }, delete(file) { draft.delete(file); } });
        state[repository] = draft; return result;
      });
      queues[repository] = pending.catch(() => {}); return pending;
    }
  });
  const blockedFetch = async () => { throw Error('Integration tests cannot contact providers'); };
  const accountApi = createAccountApi({ storeFactory, now, fetchImpl: blockedFetch, sendEmail: async message => { deliveries.push(message); } });
  const blogApi = createBlogApi({ storeFactory, now, fetchImpl: blockedFetch });
  async function transport(url, options = {}) {
    const request = new Request(url, { method: options.method || 'GET', headers: options.headers,
      ...(options.body === undefined ? {} : { body: options.body }) });
    const pathname = new URL(url).pathname;
    assert.ok(pathname.startsWith('/api/account/') || pathname.startsWith('/api/blog/'), 'fixed same-project API boundary');
    return (pathname.startsWith('/api/account/') ? accountApi : blogApi)(request, env);
  }
  async function register(client, email, username) {
    await client.sendEmailCode(email, 'register');
    const code = deliveries.findLast(item => item.email === email || item.to === email)?.code;
    assert.match(code, /^\d{6}$/);
    return client.register({ email, username, password: 'Integration-only password123!', code });
  }
  function nativeClient() {
    const local = new Map();
    return createAccountClient({ now, config: { accountBase: ORIGIN + '/api/account' }, wx: {
      getStorageSync: key => local.get(key), setStorageSync: (key, value) => local.set(key, structuredClone(value)), removeStorageSync: key => local.delete(key),
      request(request) {
        void transport(request.url, { method: request.method, headers: request.header, ...(request.data === undefined ? {} : { body: JSON.stringify(request.data) }) })
          .then(async response => request.success({ statusCode: response.status, data: await response.json() })).catch(() => request.fail());
      }
    } });
  }
  async function browser(url, prepare) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true }), window = dom.window;
    window.scrollTo = () => {}; window.confirm = window.alert = () => { throw Error('Use the in-page confirmation'); }; window.BrclioBlogContent = renderer;
    window.BrclioBlogCache = cacheEngine;
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); window.queueMicrotask(() => this.dispatchEvent(new window.Event('close'))); };
    const runtime = createBrowserAccount(window, { now, fetchImpl: transport, portal: true });
    window.BrclioAccount = runtime;
    t.after(() => { runtime.destroy(); dom.window.close(); });
    await runtime.ready; if (prepare) await prepare(runtime.client);
    window.eval(main); window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { window, runtime, get: selector => window.document.querySelector(selector),
      input(name, value) { const element = window.document.querySelector('#editor-form').elements[name]; element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); },
      click(selector) { const element = window.document.querySelector(selector); assert.ok(element, selector); element.click(); },
      refreshRoute() { window.document.querySelector('#refresh-blog').click(); } };
  }

  const writer = await browser(ORIGIN + '/blog/?view=write', client => register(client, 'aiyuechuang@gmail.com', 'blog_writer'));
  await until(() => writer.get('#editor-form'), 'authorized web writing form');
  writer.input('title', '网页落笔，小程序接着读'); writer.input('content', '## 共同的文章\n\n两端共享同一份内容与讨论。');
  writer.input('category', '开发记录'); writer.input('tags', '博客,跨端'); writer.click('[data-save="draft"]');
  await until(() => new URL(writer.window.location.href).searchParams.has('edit') && !writer.get('[data-save="draft"]').disabled, 'draft saved through editor');
  const id = new URL(writer.window.location.href).searchParams.get('edit'), guest = nativeClient();
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal((await guest.blogRequest('/posts')).total, 0);
  await assert.rejects(guest.blogRequest('/posts/' + id), { status: 404, code: 'post_not_found' });

  writer.click('[data-save="published"]');
  assert.equal(writer.get('#confirm-dialog').open, true);
  assert.equal((await guest.blogRequest('/posts')).total, 0, 'publication remains private until explicitly confirmed');
  writer.click('#confirm-cancel');
  assert.equal(writer.get('#confirm-dialog').open, false);
  assert.equal((await writer.runtime.requestBlog('/posts/' + id)).post.status, 'draft');
  writer.click('[data-save="published"]'); writer.click('#confirm-accept');
  await until(() => /文章已发布/.test(writer.get('#notice').textContent), 'publication through web editor');
  const published = await guest.blogRequest('/posts/' + id);
  assert.equal(published.post.status, 'published'); assert.match(published.post.content, /共同的文章/);
  assert.equal((await guest.blogRequest('/posts')).total, 1);

  const member = nativeClient(), session = await register(member, 'reader@example.test', 'blog_reader');
  assert.notEqual(session.user.id, writer.runtime.client.getCachedUser().id);
  await member.blogRequest('/posts/' + id + '/like', 'PUT', { active: true });
  await member.blogRequest('/posts/' + id + '/favorite', 'PUT', { active: true });
  await member.blogRequest('/posts/' + id + '/comments', 'POST', { content: '在小程序留下的第一条评论。' });
  assert.equal((await member.blogRequest('/posts?saved=1')).posts[0].id, id);
  const reader = await browser(ORIGIN + '/blog/?post=' + id);
  await until(() => reader.get('.comment-body') && reader.get('#post-title'), 'native comment visible in actual web reader');
  assert.equal(reader.get('#post-title').textContent, '网页落笔，小程序接着读');
  assert.equal(reader.get('#article-content h2').textContent, '共同的文章');
  assert.equal(reader.get('.comment-body').textContent, '在小程序留下的第一条评论。');
  assert.match(reader.get('[data-reaction="like"]').textContent, /1/);
  assert.match(reader.get('[data-reaction="favorite"]').textContent, /1/);
  assert.equal(reader.get('#comments-count').textContent, '1 条留言');

  writer.click('[data-save="draft"]');
  assert.equal(writer.get('#confirm-dialog').open, true);
  assert.equal((await guest.blogRequest('/posts/' + id)).post.status, 'published', 'withdrawal also waits for confirmation');
  writer.click('#confirm-accept');
  await until(() => /草稿已保存/.test(writer.get('#notice').textContent), 'withdrawal through web editor');
  await assert.rejects(guest.blogRequest('/posts/' + id), { status: 404, code: 'post_not_found' });
  await assert.rejects(member.blogRequest('/posts/' + id), { status: 404, code: 'post_not_found' });
  assert.equal((await member.blogRequest('/posts?saved=1')).total, 0);
  reader.refreshRoute(); await until(() => reader.get('[data-action="retry"]'), 'withdrawn web article becomes unavailable');
  assert.match(reader.get('#blog-reader').textContent, /撤回/);
  assert.equal((await writer.runtime.requestBlog('/posts/' + id)).post.status, 'draft');
});
