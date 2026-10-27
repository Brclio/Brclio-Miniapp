// Server-only blog service. Article content and social data stay in the existing
// private blog repository; account sessions stay in the account repository.
import { createGitHubStore, AccountStoreError } from './account-store.mjs';
import { authenticateAccountUser } from './account-api.mjs';
import { BLOG_SCHEMA_VERSION, validateBlogRecord, BlogSchemaError } from './blog-schema.mjs';

const BASE = '/api/blog';
const PREFIX = 'blog/v1/';
const encoder = new TextEncoder();
const DAY = 86400000;
const HOUR = 3600000;
const SHARDS = '0123456789abcdef'.split('');
// Leave headroom below Workers Free's 50 external subrequests. The underlying
// store retries whole Git transactions, so contention must not exhaust the
// platform before we can return a controlled retry response.
const FETCH_BUDGET = 45;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const ALLOWED_ORIGINS = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
const LIMITS = Object.freeze({ posts: 500, content: 100000, contentLines: 5000, title: 120, excerpt: 300, category: 40, tags: 8, tag: 24, comment: 1000, comments: 1000, reactions: 5000, viewsPerDay: 10000 });
class BlogError extends Error {
  constructor(status, code, message, retryAfter) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
function fail(status, code, message, retryAfter) { throw new BlogError(status, code, message, retryAfter); }
function json(value, status, headers) { return Response.json(value, { status, headers: { ...HEADERS, ...headers } }); }
function hex(bytes) { return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
function randomId() { return hex(crypto.getRandomValues(new Uint8Array(16))); }
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function fields(body, names) { if (Object.keys(body).some(key => !names.includes(key))) fail(400, 'invalid_fields', '请求包含不支持的字段。'); }
function text(value, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || required && !value.trim()) fail(400, 'invalid_article', '请检查文章或评论内容及长度。');
  return value.trim();
}
function cover(value = '') {
  value = text(value, 2048);
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { fail(400, 'invalid_cover', '封面须使用有效的 HTTPS 图片链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail(400, 'invalid_cover', '封面须使用有效的 HTTPS 图片链接。');
  return url.href;
}
function articleInput(body, updating = false) {
  fields(body, ['title', 'excerpt', 'category', 'tags', 'coverUrl', 'content', 'status', 'commentsEnabled', ...(updating ? ['revision'] : [])]);
  const title = text(body.title, LIMITS.title, true), content = text(body.content, LIMITS.content, true).replace(/\r\n?/g, '\n');
  if ((content.match(/\n/g)?.length || 0) >= LIMITS.contentLines) fail(400, 'invalid_article', '文章最多 5000 行，请分篇发布。');
  const excerpt = text(body.excerpt || '', LIMITS.excerpt);
  const category = text(body.category || '随笔', LIMITS.category, true);
  if (!Array.isArray(body.tags || []) || (body.tags || []).length > LIMITS.tags) fail(400, 'invalid_article', '标签最多 8 个，每个最多 24 字。');
  const tags = [...new Set((body.tags || []).map(value => text(value, LIMITS.tag, true)))];
  const status = body.status || 'draft';
  if (!['draft', 'published'].includes(status) || body.commentsEnabled !== undefined && typeof body.commentsEnabled !== 'boolean') fail(400, 'invalid_article', '文章状态或评论设置错误。');
  return { title, content, excerpt: excerpt || content.replace(/[#*`>\[\]]/g, '').replace(/\s+/g, ' ').slice(0, LIMITS.excerpt), category, tags, coverUrl: cover(body.coverUrl), status, commentsEnabled: body.commentsEnabled !== false };
}
async function readBody(request, maximum = 8192) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail(415, 'json_required', '请使用 JSON 请求。');
  if (Number(request.headers.get('Content-Length')) > maximum) fail(413, 'body_too_large', '内容过大。');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json', '请求内容错误。');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail(413, 'body_too_large', '内容过大。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'invalid_json', '请求内容错误。'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'invalid_json', '请求内容错误。');
  return value;
}
function publicAuthor(user) { return { id: user.id, displayName: user.displayName || 'Brclio 用户', avatarUrl: user.avatarUrl || '' }; }
function admin(user, env) {
  if (!user) return false;
  const ids = String(env.BLOG_ADMIN_USER_IDS || '').split(',').map(value => value.trim());
  const emails = String(env.BLOG_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  // Email identities are assigned only after verification in the account API.
  return ids.includes(user.id) || Boolean(user.email && emails.includes(user.email.toLowerCase()));
}
function requireAdmin(user, env) { if (!user) fail(401, 'unauthorized', '请先登录。'); if (!admin(user, env)) fail(403, 'writer_required', '当前账号没有博客管理权限。'); }
function requireUser(user) { if (!user) fail(401, 'unauthorized', '请先登录后再操作。'); }
function summary(post) { const { content, ...value } = post; return value; }
function recordKind(path) {
  if (/^blog\/v1\/catalog\/[a-f0-9]\.json$/.test(path)) return 'catalog';
  if (/^blog\/v1\/users\/[a-f0-9]{32}\/favorites\.json$/.test(path)) return 'favorites';
  if (/^blog\/v1\/rates\/\d+\/[a-f0-9]{64}(?:-comment)?\.json$/.test(path)) return 'rate';
  const file = /^blog\/v1\/posts\/[a-f0-9]{32}\/(article|reactions|comments|comment-[a-f0-9]{32}|views-\d+)\.json$/.exec(path)?.[1];
  return file?.startsWith('comment-') ? 'comment' : file?.startsWith('views-') ? 'views' : file || '';
}
function structuredTransaction(tx) {
  return {
    async get(path) {
      const kind = recordKind(path); if (!kind) throw new BlogSchemaError();
      const value = await tx.get(path);
      if (value === null) return null;
      validateBlogRecord(kind, value);
      if (kind === 'article' && value.id !== path.split('/')[3] || kind === 'comment' && value.id !== path.split('/').at(-1).slice(8, -5) || kind === 'catalog' && value.posts.some(post => post.id[0] !== path.split('/').at(-1)[0])) throw new BlogSchemaError();
      return value;
    },
    put(path, value) { const kind = recordKind(path); if (!kind) throw new BlogSchemaError(); tx.put(path, validateBlogRecord(kind, value)); },
    delete(path) { if (!recordKind(path)) throw new BlogSchemaError(); tx.delete(path); }
  };
}
function postPath(id, file = 'article') { return PREFIX + 'posts/' + id + '/' + file + '.json'; }
function shardPath(id) { return PREFIX + 'catalog/' + id[0] + '.json'; }
async function catalog(tx) {
  const shards = await Promise.all(SHARDS.map(shard => tx.get(PREFIX + 'catalog/' + shard + '.json')));
  return shards.flatMap(value => value?.posts || []);
}
async function updateSummary(tx, post, remove = false) {
  const path = shardPath(post.id), shard = await tx.get(path) || { schemaVersion: BLOG_SCHEMA_VERSION, posts: [] };
  const posts = shard.posts.filter(item => item.id !== post.id);
  if (!remove) posts.push(summary(post));
  const value = { schemaVersion: BLOG_SCHEMA_VERSION, posts };
  if (encoder.encode(JSON.stringify(value)).length > 1000000) fail(409, 'blog_capacity', '文章目录分区已达当前容量，请整理旧文章。');
  tx.put(path, value);
}
async function loadPost(tx, id, user, env, publishedOnly = false) {
  const post = await tx.get(postPath(id));
  if (post && post.id !== id) throw new BlogSchemaError();
  if (!post || post.status !== 'published' && (publishedOnly || !admin(user, env))) fail(404, 'post_not_found', '文章不存在或已撤回。');
  return post;
}
function pageOptions(url, maximum = 30) {
  const pageValue = url.searchParams.get('page') || '1', sizeValue = url.searchParams.get('pageSize') || '12';
  if (!/^[1-9]\d{0,4}$/.test(pageValue) || !/^[1-9]\d{0,2}$/.test(sizeValue)) fail(400, 'invalid_query', '分页参数错误。');
  const page = Number(pageValue), pageSize = Number(sizeValue);
  if (pageSize > maximum) fail(400, 'invalid_query', '分页大小超出限制。');
  return { page, pageSize };
}
function queryFields(url, allowed) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key, index) => !allowed.includes(key) || keys.indexOf(key) !== index) || url.search.length > 2048) fail(400, 'invalid_query', '筛选条件错误。');
}
async function interaction(tx, id, user) {
  if (!user) return { liked: false, favorited: false };
  const reactions = await tx.get(postPath(id, 'reactions')) || { schemaVersion: BLOG_SCHEMA_VERSION, likes: [], favorites: [] };
  return { liked: reactions.likes.includes(user.id), favorited: reactions.favorites.includes(user.id) };
}
async function takeRate(tx, key, at, maximum, period) {
  const path = PREFIX + 'rates/' + Math.floor(at / DAY) + '/' + key + '.json';
  let record = await tx.get(path);
  if (!record || at >= record.resetAt) record = { schemaVersion: BLOG_SCHEMA_VERSION, count: 0, resetAt: at + period };
  if (record.count >= maximum) return { failure: { status: 429, error: 'rate_limited', message: '操作较频繁，请稍后再试。', retryAfter: Math.max(1, Math.ceil((record.resetAt - at) / 1000)) } };
  tx.put(path, { schemaVersion: BLOG_SCHEMA_VERSION, count: record.count + 1, resetAt: record.resetAt });
  return null;
}
function readingMinutes(content) { return Math.max(1, Math.ceil((content.match(/[\u3400-\u9fff]/g)?.length || 0) / 400 + (content.match(/[A-Za-z0-9]+/g)?.length || 0) / 200)); }
function methodFor(route) {
  if (route === '/me') return 'GET';
  if (route === '/posts') return 'GET';
  if (route === '/admin/posts') return 'GET,POST';
  if (/^\/admin\/posts\/[a-f0-9]{32}$/.test(route)) return 'PUT,DELETE';
  if (/^\/posts\/[a-f0-9]{32}$/.test(route)) return 'GET';
  if (/^\/posts\/[a-f0-9]{32}\/view$/.test(route)) return 'POST';
  if (/^\/posts\/[a-f0-9]{32}\/(like|favorite)$/.test(route)) return 'PUT';
  if (/^\/posts\/[a-f0-9]{32}\/comments$/.test(route)) return 'GET,POST';
  if (/^\/posts\/[a-f0-9]{32}\/comments\/[a-f0-9]{32}$/.test(route)) return 'DELETE';
  return '';
}

export function createBlogApi({ storeFactory = createGitHubStore, fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  return async function blogApi(request, env = {}) {
    let originHeaders = {};
    let fetches = 0, budgetExhausted = false;
    const requestFetch = (...args) => {
      if (fetches >= FETCH_BUDGET) {
        budgetExhausted = true;
        throw new Error('blog_subrequest_budget');
      }
      fetches += 1;
      return fetchImpl(...args);
    };
    try {
      const url = new URL(request.url), origin = request.headers.get('Origin');
      if (origin) {
        if (!ALLOWED_ORIGINS.has(origin) || !ALLOWED_ORIGINS.has(url.origin)) fail(403, 'origin_forbidden', '请求来源不受支持。');
        originHeaders = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      }
      const route = url.pathname.startsWith(BASE + '/') ? url.pathname.slice(BASE.length) : '';
      const methods = methodFor(route);
      if (!methods) fail(404, 'not_found', '接口不存在。');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...HEADERS, ...originHeaders, 'Access-Control-Allow-Methods': methods, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
      if (!methods.split(',').includes(request.method)) return json({ error: 'method_not_allowed', message: '请求方式不受支持。' }, 405, { ...originHeaders, Allow: methods });
      if (env.ACCOUNT_ENABLED !== 'true' || typeof env.ACCOUNT_HMAC_SECRET !== 'string' || env.ACCOUNT_HMAC_SECRET.length < 32) fail(503, 'blog_unavailable', '博客服务暂不可用。');
      const at = now();
      let user = null;
      if (request.headers.has('Authorization')) {
        try { user = await authenticateAccountUser(storeFactory(env, { repository: 'users', fetchImpl: requestFetch }), request, at, url.origin); }
        catch (error) { if (error.status === 401 && error.code === 'unauthorized') fail(401, 'unauthorized', '登录已失效，请重新登录。'); throw error; }
      }
      if (route === '/me') {
        queryFields(url, []);
        return json({ user, canWrite: admin(user, env) }, 200, originHeaders);
      }
      const isAdminRoute = route.startsWith('/admin/');
      if (isAdminRoute) requireAdmin(user, env);
      const isList = route === '/posts' || route === '/admin/posts';
      if (request.method === 'GET') queryFields(url, isList ? ['q', 'category', 'tag', 'page', 'pageSize', 'saved'] : route.endsWith('/comments') ? ['page', 'pageSize'] : []);
      else queryFields(url, []);
      if (url.searchParams.has('saved') && url.searchParams.get('saved') !== '1') fail(400, 'invalid_query', '收藏筛选参数错误。');
      if (url.searchParams.has('saved')) requireUser(user);
      const store = storeFactory(env, { repository: 'blog', fetchImpl: requestFetch });
      const id = route.match(/\/posts\/([a-f0-9]{32})/)?.[1];
      const write = !['GET', 'HEAD'].includes(request.method);
      const body = write && !(request.method === 'DELETE' && route.includes('/comments/')) ? await readBody(request, isAdminRoute && request.method !== 'DELETE' ? 512000 : 8192) : null;
      const ipKey = write ? await hmac(env.ACCOUNT_HMAC_SECRET, 'blog-rate:v1:' + (request.headers.get('CF-Connecting-IP') || 'unknown')) : '';
      const userKey = write && user ? await hmac(env.ACCOUNT_HMAC_SECRET, 'blog-user-rate:v1:' + user.id) : '';
      const createdId = request.method === 'POST' && (route === '/admin/posts' || route.endsWith('/comments')) ? randomId() : null;
      const result = await store.transaction(async rawTx => {
        const tx = structuredTransaction(rawTx);
        if (isList && request.method === 'GET') {
          const { page, pageSize } = pageOptions(url);
          let posts = (await catalog(tx)).filter(post => isAdminRoute || post.status === 'published');
          const categories = [...new Set(posts.map(post => post.category))].sort();
          const tags = [...new Set(posts.flatMap(post => post.tags))].sort();
          const q = text(url.searchParams.get('q') || '', 100).toLocaleLowerCase();
          const category = text(url.searchParams.get('category') || '', LIMITS.category);
          const tag = text(url.searchParams.get('tag') || '', LIMITS.tag);
          posts = posts.filter(post => (!q || [post.title, post.excerpt, post.category, ...post.tags].join(' ').toLocaleLowerCase().includes(q)) && (!category || post.category === category) && (!tag || post.tags.includes(tag)));
          if (url.searchParams.has('saved')) {
            const saved = await tx.get(PREFIX + 'users/' + user.id + '/favorites.json') || { schemaVersion: BLOG_SCHEMA_VERSION, ids: [] };
            posts = posts.filter(post => saved.ids.includes(post.id));
          }
          posts.sort((a, b) => (isAdminRoute ? b.updatedAt - a.updatedAt : b.publishedAt - a.publishedAt) || a.id.localeCompare(b.id));
          return { posts: posts.slice((page - 1) * pageSize, page * pageSize), total: posts.length, page, pageSize, categories, tags };
        }
        if (route === '/admin/posts' && request.method === 'POST') {
          const input = articleInput(body);
          const posts = await catalog(tx);
          if (posts.length >= LIMITS.posts) fail(409, 'blog_capacity', '文章数量已达当前容量，请整理旧文章。');
          const rate = await takeRate(tx, userKey, at, 120, HOUR); if (rate) return rate;
          const post = { schemaVersion: BLOG_SCHEMA_VERSION, ...input, id: createdId, author: publicAuthor(user), createdAt: at, publishedAt: input.status === 'published' ? at : null, updatedAt: at, readingMinutes: readingMinutes(input.content), revision: 1, counts: { views: 0, likes: 0, favorites: 0, comments: 0 } };
          tx.put(postPath(post.id), post); await updateSummary(tx, post);
          return { post };
        }
        const moderatingDraft = request.method === 'DELETE' && route.includes('/comments/') && admin(user, env);
        const post = await loadPost(tx, id, user, env, !isAdminRoute && request.method !== 'GET' && !moderatingDraft);
        if (isAdminRoute && request.method === 'PUT') {
          if (!Number.isSafeInteger(body.revision) || body.revision !== post.revision) fail(409, 'revision_conflict', '文章已在其他页面更新，请重新载入后再保存。');
          const input = articleInput(body, true);
          const rate = await takeRate(tx, userKey, at, 120, HOUR); if (rate) return rate;
          const updated = { ...post, ...input, author: post.author, updatedAt: at, publishedAt: input.status === 'published' ? post.publishedAt || at : post.publishedAt, readingMinutes: readingMinutes(input.content), revision: post.revision + 1 };
          tx.put(postPath(id), updated); await updateSummary(tx, updated); return { post: updated };
        }
        if (isAdminRoute && request.method === 'DELETE') {
          fields(body, ['revision']);
          if (!Number.isSafeInteger(body.revision) || body.revision !== post.revision) fail(409, 'revision_conflict', '文章已更新，请重新载入后再删除。');
          const rate = await takeRate(tx, userKey, at, 120, HOUR); if (rate) return rate;
          tx.delete(postPath(id)); await updateSummary(tx, post, true); return { deleted: true };
        }
        if (route === '/posts/' + id) return { post, interaction: await interaction(tx, id, user), canEdit: admin(user, env) };
        if (route.endsWith('/comments') && request.method === 'GET') {
          const { page, pageSize } = pageOptions(url);
          const index = await tx.get(postPath(id, 'comments')) || { schemaVersion: BLOG_SCHEMA_VERSION, items: [] };
          const selected = index.items.slice((page - 1) * pageSize, page * pageSize);
          const comments = (await Promise.all(selected.map(item => tx.get(postPath(id, 'comment-' + item.id))))).filter(Boolean).map(comment => ({ ...comment, canDelete: Boolean(user && (user.id === comment.author.id || admin(user, env))) }));
          return { comments, total: index.items.length, page, pageSize };
        }
        if (route.endsWith('/view')) {
          fields(body, ['visitorId']);
          if (typeof body.visitorId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.visitorId)) fail(400, 'invalid_visitor', '访问标识错误。');
          const day = Math.floor(at / DAY), viewer = await hmac(env.ACCOUNT_HMAC_SECRET, 'blog-view:v1:' + id + ':' + day + ':' + (user ? 'user:' + user.id : 'visitor:' + body.visitorId));
          const path = postPath(id, 'views-' + day), views = await tx.get(path) || { schemaVersion: BLOG_SCHEMA_VERSION, visitors: [] };
          if (views.visitors.includes(viewer)) return { counts: post.counts };
          const rate = await takeRate(tx, ipKey, at, 120, HOUR); if (rate) return rate;
          if (views.visitors.length >= LIMITS.viewsPerDay) return { counts: post.counts };
          views.visitors.push(viewer); tx.put(path, views); post.counts.views += 1;
          tx.put(postPath(id), post); await updateSummary(tx, post); return { counts: post.counts };
        }
        requireUser(user);
        if (route.endsWith('/like') || route.endsWith('/favorite')) {
          fields(body, ['active']); if (typeof body.active !== 'boolean') fail(400, 'invalid_reaction', '互动状态错误。');
          const key = route.endsWith('/like') ? 'likes' : 'favorites';
          const reactions = await tx.get(postPath(id, 'reactions')) || { schemaVersion: BLOG_SCHEMA_VERSION, likes: [], favorites: [] };
          const existing = reactions[key].includes(user.id);
          if (existing === body.active) return { interaction: { liked: reactions.likes.includes(user.id), favorited: reactions.favorites.includes(user.id) }, counts: post.counts };
          const rate = await takeRate(tx, userKey, at, 120, HOUR); if (rate) return rate;
          if (body.active && reactions[key].length >= LIMITS.reactions) fail(409, 'reaction_capacity', '当前互动数量已达容量。');
          reactions[key] = reactions[key].filter(value => value !== user.id); if (body.active) reactions[key].push(user.id);
          post.counts[key] = reactions[key].length;
          tx.put(postPath(id, 'reactions'), reactions);
          if (key === 'favorites') {
            const path = PREFIX + 'users/' + user.id + '/favorites.json', saved = await tx.get(path) || { schemaVersion: BLOG_SCHEMA_VERSION, ids: [] };
            // Deleting an article cannot scan every user's private favorites.
            // Prune deleted IDs lazily before they can grow this document.
            if (saved.ids.length >= LIMITS.posts) {
              const existingIds = new Set((await catalog(tx)).map(value => value.id));
              saved.ids = saved.ids.filter(value => existingIds.has(value));
            }
            saved.ids = saved.ids.filter(value => value !== id); if (body.active) saved.ids.push(id); tx.put(path, saved);
          }
          tx.put(postPath(id), post); await updateSummary(tx, post);
          return { interaction: { liked: reactions.likes.includes(user.id), favorited: reactions.favorites.includes(user.id) }, counts: post.counts };
        }
        if (route.endsWith('/comments') && request.method === 'POST') {
          fields(body, ['content']); const content = text(body.content, LIMITS.comment, true);
          if (!post.commentsEnabled) fail(403, 'comments_closed', '作者已关闭这篇文章的评论。');
          const index = await tx.get(postPath(id, 'comments')) || { schemaVersion: BLOG_SCHEMA_VERSION, items: [] };
          if (index.items.length >= LIMITS.comments) fail(409, 'comment_capacity', '评论数量已达当前容量。');
          const userRate = await takeRate(tx, userKey + '-comment', at, 10, HOUR); if (userRate) return userRate;
          const ipRate = await takeRate(tx, ipKey + '-comment', at, 30, HOUR); if (ipRate) return ipRate;
          const comment = { schemaVersion: BLOG_SCHEMA_VERSION, id: createdId, content, author: publicAuthor(user), createdAt: at };
          index.items.unshift({ id: comment.id }); post.counts.comments = index.items.length;
          tx.put(postPath(id, 'comment-' + comment.id), comment); tx.put(postPath(id, 'comments'), index); tx.put(postPath(id), post); await updateSummary(tx, post);
          return { comment: { ...comment, canDelete: true }, counts: post.counts };
        }
        if (request.method === 'DELETE' && route.includes('/comments/')) {
          const commentId = route.split('/').at(-1), path = postPath(id, 'comment-' + commentId), comment = await tx.get(path);
          if (!comment) fail(404, 'comment_not_found', '评论已删除或不存在。');
          if (comment.author.id !== user.id && !admin(user, env)) fail(403, 'comment_forbidden', '只能删除自己的评论。');
          const rate = await takeRate(tx, userKey, at, 120, HOUR); if (rate) return rate;
          const index = await tx.get(postPath(id, 'comments')) || { schemaVersion: BLOG_SCHEMA_VERSION, items: [] };
          index.items = index.items.filter(item => item.id !== commentId); post.counts.comments = index.items.length;
          tx.delete(path); tx.put(postPath(id, 'comments'), index); tx.put(postPath(id), post); await updateSummary(tx, post); return { deleted: true, counts: post.counts };
        }
        fail(404, 'not_found', '接口不存在。');
      });
      if (result?.failure) {
        const { status, retryAfter, ...failure } = result.failure;
        return json({ ...failure, ...(retryAfter ? { retryAfter } : {}) }, status, { ...originHeaders, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) });
      }
      return json(result, request.method === 'POST' && (route === '/admin/posts' || route.endsWith('/comments')) ? 201 : 200, originHeaders);
    } catch (error) {
      if (budgetExhausted && !['GET', 'HEAD'].includes(request.method)) return json({ error: 'storage_conflict', message: '同时操作较多，请重新载入并稍后重试。' }, 409, originHeaders);
      if (error instanceof BlogError) return json({ error: error.code, message: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, error.status, originHeaders);
      if (error instanceof AccountStoreError && error.status === 409) return json({ error: 'storage_conflict', message: '同时操作较多，请稍后重试。' }, 409, originHeaders);
      return json({ error: 'blog_unavailable', message: '博客服务暂不可用，请稍后重试。' }, 503, originHeaders);
    }
  };
}

export const blogLimits = LIMITS;
export const handleBlog = createBlogApi();
