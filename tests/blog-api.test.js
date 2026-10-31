const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const BASE = 'https://pocket.bornforthis.cn/api/blog';
const SECRET = 'test-only-blog-account-hmac-secret-32-characters';
const modulePromise = import('../web/blog-api.mjs');
const article = overrides => ({ title: '第一篇博客', content: '# 你好\n\n这是正文。', excerpt: '记录与分享', category: '随笔', tags: ['生活', '代码'], coverUrl: '', status: 'published', commentsEnabled: true, ...overrides });

async function harness() {
  const { createBlogApi } = await modulePromise;
  const state = { users: new Map(), blog: new Map(), data: new Map() };
  const queues = { users: Promise.resolve(), blog: Promise.resolve(), data: Promise.resolve() };
  const accessed = [];
  let at = Date.UTC(2026, 9, 27, 2);
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: SECRET, BLOG_ADMIN_EMAILS: 'writer@example.test' };
  const storeFactory = (_env, { repository }) => {
    assert.ok(Object.hasOwn(state, repository));
    accessed.push(repository);
    return {
      async read(path) { return structuredClone(state[repository].get(path) || null); },
      transaction(callback) {
        const work = queues[repository].then(async () => {
          const draft = structuredClone(state[repository]);
          const result = await callback({
            get: async path => structuredClone(draft.get(path) || null),
            put(path, value) {
              assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024, 'document fits existing GitHub store');
              draft.set(path, structuredClone(value));
            },
            delete(path) { draft.delete(path); }
          });
          state[repository] = draft;
          return result;
        });
        queues[repository] = work.catch(() => {});
        return work;
      }
    };
  };
  const handler = createBlogApi({ storeFactory, now: () => at, fetchImpl: async () => { throw Error('No live requests in tests'); } });
  function user(char, email, status = 'active') {
    const id = char.repeat(32), token = 'm1.' + id + '.' + char.repeat(64);
    const prefix = 'users/v1/' + id.slice(0, 2) + '/' + id + '/';
    state.users.set(prefix + 'profile.json', { id, email, status, username: 'member_' + char, displayName: '读者 ' + char, providers: ['email'], avatar: { type: 'builtin', id: 1 }, createdAt: at });
    state.users.set(prefix + 'sessions.json', { items: [{ hash: createHash('sha256').update(token).digest('hex'), expiresAt: 1 }] });
    return { id, token, email, prefix };
  }
  const writer = user('a', 'writer@example.test'), reader = user('b', 'reader@example.test'), other = user('c', 'other@example.test');
  async function call(route, body, { method = body === undefined ? 'GET' : 'POST', token, environment = env, headers = {}, raw } = {}) {
    const response = await handler(new Request(BASE + route, { method, headers: {
      'CF-Connecting-IP': '203.0.113.47', ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers
    }, ...(['GET', 'HEAD', 'OPTIONS'].includes(method) ? {} : { body: raw === undefined ? body === undefined ? undefined : JSON.stringify(body) : raw }) }), environment);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { status: response.status, value: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  async function create(overrides = {}) {
    const result = await call('/admin/posts', article(overrides), { token: writer.token });
    assert.equal(result.status, 201, JSON.stringify(result.value)); return result.value.post;
  }
  return { call, create, writer, reader, other, state, env, accessed, advance(ms) { at += ms; }, get at() { return at; } };
}
function error(result, status, code) { assert.equal(result.status, status, JSON.stringify(result.value)); assert.equal(result.value.error, code); }

test('blog shares read-only session authentication and fails closed for writer privileges', async () => {
  const h = await harness();
  assert.deepEqual((await h.call('/me')).value, { user: null, canWrite: false });
  const own = await h.call('/me', undefined, { token: h.writer.token });
  assert.equal(own.value.canWrite, true);
  assert.equal(own.value.user.id, h.writer.id);
  assert.equal(own.value.user.avatarUrl, 'https://pocket.bornforthis.cn/avatars/0001.png?v=20261026');
  assert.equal(h.state.users.get(h.writer.prefix + 'sessions.json').items[0].expiresAt, 1, 'blog reads must not migrate sessions');
  error(await h.call('/admin/posts'), 401, 'unauthorized');
  error(await h.call('/admin/posts', undefined, { token: h.reader.token }), 403, 'writer_required');
  const noAdmin = { ...h.env, BLOG_ADMIN_EMAILS: '' };
  assert.equal((await h.call('/me', undefined, { token: h.writer.token, environment: noAdmin })).value.canWrite, false);
  assert.equal((await h.call('/me', undefined, { token: h.reader.token, environment: { ...noAdmin, BLOG_ADMIN_USER_IDS: h.reader.id } })).value.canWrite, true);
  error(await h.call('/me', undefined, { token: 'm1.' + 'f'.repeat(32) + '.' + 'f'.repeat(64) }), 401, 'unauthorized');
  h.state.users.get(h.reader.prefix + 'profile.json').status = 'disabled';
  error(await h.call('/me', undefined, { token: h.reader.token }), 401, 'unauthorized');
});

test('drafts stay private across detail, list and engagement endpoints', async () => {
  const h = await harness(), post = await h.create({ status: 'draft', title: '私密草稿' });
  assert.equal((await h.call('/posts')).value.total, 0);
  assert.equal((await h.call('/admin/posts', undefined, { token: h.writer.token })).value.total, 1);
  const adminDetail = await h.call('/posts/' + post.id, undefined, { token: h.writer.token });
  assert.equal(adminDetail.value.post.content, post.content);
  assert.equal(adminDetail.value.canEdit, true);
  for (const token of [undefined, h.reader.token]) {
    error(await h.call('/posts/' + post.id, undefined, { token }), 404, 'post_not_found');
    error(await h.call('/posts/' + post.id + '/view', { visitorId: 'private-visitor-12345' }, { token }), 404, 'post_not_found');
    error(await h.call('/posts/' + post.id + '/like', { active: true }, { token, method: 'PUT' }), 404, 'post_not_found');
  }
});

test('published posts expose safe public authors, summaries, search and bounded pagination', async () => {
  const h = await harness();
  const first = await h.create(); h.advance(1000);
  await h.create({ title: '摄影笔记', category: '摄影', tags: ['相机'], excerpt: '散步与风景' });
  const list = await h.call('/posts?pageSize=1');
  assert.equal(list.value.total, 2); assert.equal(list.value.posts.length, 1);
  assert.equal(list.value.posts[0].title, '摄影笔记');
  assert.equal(Object.hasOwn(list.value.posts[0], 'content'), false);
  assert.equal(JSON.stringify(list.value).includes('writer@example.test'), false);
  assert.deepEqual(list.value.categories, ['摄影', '随笔']);
  assert.equal((await h.call('/posts?q=' + encodeURIComponent('风景'))).value.total, 1);
  assert.equal((await h.call('/posts?category=' + encodeURIComponent('随笔') + '&tag=' + encodeURIComponent('代码'))).value.posts[0].id, first.id);
  assert.equal((await h.call('/posts?page=3&pageSize=1')).value.posts.length, 0);
  error(await h.call('/posts?pageSize=31'), 400, 'invalid_query');
  error(await h.call('/posts?page=0'), 400, 'invalid_query');
  error(await h.call('/posts?q=x&q=y'), 400, 'invalid_query');
  error(await h.call('/posts?unknown=x'), 400, 'invalid_query');
});

test('editing, withdrawing, republishing and deletion enforce article revision', async () => {
  const h = await harness(), first = await h.create();
  h.advance(1000);
  const updated = await h.call('/admin/posts/' + first.id, { ...article({ title: '更新标题' }), revision: 1 }, { token: h.writer.token, method: 'PUT' });
  assert.equal(updated.value.post.revision, 2);
  assert.equal(updated.value.post.publishedAt, first.publishedAt);
  error(await h.call('/admin/posts/' + first.id, { ...article(), revision: 1 }, { token: h.writer.token, method: 'PUT' }), 409, 'revision_conflict');
  const withdrawn = await h.call('/admin/posts/' + first.id, { ...article({ status: 'draft' }), revision: 2 }, { token: h.writer.token, method: 'PUT' });
  assert.equal(withdrawn.value.post.status, 'draft');
  error(await h.call('/posts/' + first.id), 404, 'post_not_found');
  const republished = await h.call('/admin/posts/' + first.id, { ...article(), revision: 3 }, { token: h.writer.token, method: 'PUT' });
  assert.equal(republished.value.post.publishedAt, first.publishedAt);
  error(await h.call('/admin/posts/' + first.id, { revision: 3 }, { token: h.writer.token, method: 'DELETE' }), 409, 'revision_conflict');
  assert.equal((await h.call('/admin/posts/' + first.id, { revision: 4 }, { token: h.writer.token, method: 'DELETE' })).value.deleted, true);
  assert.equal((await h.call('/posts')).value.total, 0);
  error(await h.call('/posts/' + first.id), 404, 'post_not_found');
});

test('concurrent edits produce exactly one winning revision', async () => {
  const h = await harness(), post = await h.create();
  const results = await Promise.all(['标题甲', '标题乙'].map(title => h.call('/admin/posts/' + post.id, { ...article({ title }), revision: 1 }, { token: h.writer.token, method: 'PUT' })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await h.call('/posts/' + post.id)).value.post.revision, 2);
});

test('likes and favorites are idempotent per account, preserve counts and isolate saved lists', async () => {
  const h = await harness(), post = await h.create(), path = '/posts/' + post.id;
  error(await h.call(path + '/like', { active: true }, { method: 'PUT' }), 401, 'unauthorized');
  for (let i = 0; i < 2; i += 1) {
    const result = await h.call(path + '/like', { active: true }, { method: 'PUT', token: h.reader.token });
    assert.equal(result.value.counts.likes, 1); assert.equal(result.value.interaction.liked, true);
  }
  const saved = await h.call(path + '/favorite', { active: true }, { method: 'PUT', token: h.reader.token });
  assert.equal(saved.value.counts.favorites, 1); assert.equal(saved.value.interaction.favorited, true);
  assert.equal((await h.call('/posts?saved=1', undefined, { token: h.reader.token })).value.total, 1);
  assert.equal((await h.call('/posts?saved=1', undefined, { token: h.other.token })).value.total, 0);
  error(await h.call('/posts?saved=1'), 401, 'unauthorized');
  assert.equal((await h.call(path, undefined, { token: h.reader.token })).value.interaction.liked, true);
  assert.equal((await h.call(path, undefined, { token: h.other.token })).value.interaction.liked, false);
  const removed = await h.call(path + '/like', { active: false }, { method: 'PUT', token: h.reader.token });
  assert.equal(removed.value.counts.likes, 0); assert.equal(removed.value.counts.favorites, 1);
  error(await h.call(path + '/like', { active: 'yes' }, { method: 'PUT', token: h.reader.token }), 400, 'invalid_reaction');
  assert.equal((await h.call('/posts')).value.posts[0].counts.favorites, 1);
});

test('concurrent reaction updates preserve both users and do not change editorial revision', async () => {
  const h = await harness(), post = await h.create();
  const results = await Promise.all([h.reader, h.other].map(user => h.call('/posts/' + post.id + '/like', { active: true }, { token: user.token, method: 'PUT' })));
  assert.ok(results.every(result => result.status === 200));
  const detail = (await h.call('/posts/' + post.id)).value;
  assert.equal(detail.post.counts.likes, 2); assert.equal(detail.post.revision, 1);
});

test('view counts dedupe visitors and logged-in accounts per day without storing raw identity', async () => {
  const h = await harness(), post = await h.create(), path = '/posts/' + post.id + '/view';
  assert.equal((await h.call(path, { visitorId: 'anonymous-visitor-123456' })).value.counts.views, 1);
  assert.equal((await h.call(path, { visitorId: 'anonymous-visitor-123456' })).value.counts.views, 1);
  assert.equal((await h.call(path, { visitorId: 'another-visitor-12345678' }, { token: h.reader.token })).value.counts.views, 2);
  assert.equal((await h.call(path, { visitorId: 'different-browser-123456' }, { token: h.reader.token })).value.counts.views, 2);
  h.advance(86400000);
  assert.equal((await h.call(path, { visitorId: 'anonymous-visitor-123456' })).value.counts.views, 3);
  const serialized = JSON.stringify([...h.state.blog]);
  assert.equal(serialized.includes('203.0.113.47'), false);
  assert.equal(serialized.includes('anonymous-visitor-123456'), false);
  error(await h.call(path, { visitorId: '../not-valid' }), 400, 'invalid_visitor');
});

test('retired comment endpoints reject every client before authentication or storage access', async () => {
  const h = await harness(), post = await h.create(), commentId = 'd'.repeat(32);
  const root = 'blog/v1/posts/' + post.id + '/';
  h.state.blog.get(root + 'article.json').commentsEnabled = true;
  h.state.blog.get(root + 'article.json').counts.comments = 1;
  h.state.blog.set(root + 'comments.json', { schemaVersion: 1, items: [{ id: commentId }] });
  h.state.blog.set(root + 'comment-' + commentId + '.json', { schemaVersion: 1, id: commentId, content: '历史评论', author: { id: h.reader.id, displayName: '读者', avatarUrl: '' }, createdAt: h.at });
  const before = structuredClone(h.state), accesses = h.accessed.length;
  for (const token of [undefined, h.reader.token, h.writer.token, 'invalid-session']) {
    for (const id of [post.id, 'f'.repeat(32)]) {
      const path = '/posts/' + id + '/comments';
      error(await h.call(path + '?page=1&pageSize=20', undefined, { token }), 404, 'not_found');
      error(await h.call(path, { content: '不可提交' }, { token }), 404, 'not_found');
      error(await h.call(path + '/' + commentId, undefined, { token, method: 'DELETE' }), 404, 'not_found');
      error(await h.call(path, undefined, { token, method: 'OPTIONS' }), 404, 'not_found');
    }
  }
  assert.equal(h.accessed.length, accesses, 'retired routes never authenticate or open a store');
  assert.deepEqual(h.state, before, 'legacy comments, counters and account records are untouched');
});

test('legacy comment settings cannot enable the feature and existing articles remain readable and editable', async () => {
  const h = await harness();
  for (const commentsEnabled of [undefined, true, false]) {
    const post = await h.create({ commentsEnabled });
    assert.equal(post.commentsEnabled, false);
    assert.equal(h.state.blog.get('blog/v1/posts/' + post.id + '/article.json').commentsEnabled, false);
  }
  const post = await h.create(), root = 'blog/v1/posts/' + post.id + '/';
  const stored = h.state.blog.get(root + 'article.json');
  stored.commentsEnabled = true; stored.counts.comments = 7;
  const catalogEntry = h.state.blog.get('blog/v1/catalog/' + post.id[0] + '.json').posts.find(item => item.id === post.id);
  catalogEntry.commentsEnabled = true; catalogEntry.counts.comments = 7;
  const detail = await h.call('/posts/' + post.id);
  assert.equal(detail.status, 200); assert.equal(detail.value.post.commentsEnabled, false);
  assert.equal(detail.value.post.counts.comments, 7, 'historical counters retain the v1 record shape');
  for (const route of ['/posts', '/admin/posts']) {
    const list = await h.call(route, undefined, { token: h.writer.token });
    assert.equal(list.value.posts.find(item => item.id === post.id).commentsEnabled, false);
  }
  assert.equal(h.state.blog.get(root + 'article.json').commentsEnabled, true, 'reading does not migrate persisted records');
  const updated = await h.call('/admin/posts/' + post.id, { ...article({ commentsEnabled: true }), revision: 1 }, { token: h.writer.token, method: 'PUT' });
  assert.equal(updated.status, 200); assert.equal(updated.value.post.commentsEnabled, false);
  assert.equal(updated.value.post.counts.comments, 7);
  assert.equal(h.state.blog.get(root + 'article.json').commentsEnabled, false);
  assert.equal(h.state.blog.get('blog/v1/catalog/' + post.id[0] + '.json').posts.find(item => item.id === post.id).commentsEnabled, false);
});

test('remaining view rate limits persist across requests and relax after their window', async () => {
  const h = await harness(), post = await h.create(), path = '/posts/' + post.id + '/view';
  for (let i = 0; i < 120; i += 1) assert.equal((await h.call(path, { visitorId: 'rate-limit-visitor-' + i })).status, 200);
  const limited = await h.call(path, { visitorId: 'rate-limit-overflow-visitor' });
  error(limited, 429, 'rate_limited'); assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await h.call('/posts/' + post.id)).value.post.counts.views, 120);
  h.advance(3600000);
  assert.equal((await h.call(path, { visitorId: 'rate-limit-overflow-visitor' })).status, 200);
});

test('article fields, URL schemes, request sizes and query fields are validated', async () => {
  const h = await harness();
  for (const invalid of [{ title: '' }, { title: 'x'.repeat(121) }, { content: 'x'.repeat(100001) }, { category: 'x'.repeat(41) }, { tags: Array(9).fill('tag') }, { tags: ['x'.repeat(25)] }, { coverUrl: 'javascript:alert(1)' }, { coverUrl: 'https://user:pass@example.test/a.png' }, { commentsEnabled: 'yes' }, { status: 'hidden' }, { arbitrary: true }]) {
    const result = await h.call('/admin/posts', article(invalid), { token: h.writer.token });
    assert.equal(result.status, 400, JSON.stringify({ invalid, result: result.value }));
  }
  assert.equal((await h.call('/posts')).value.total, 0);
  error(await h.call('/admin/posts', undefined, { token: h.writer.token, method: 'POST', raw: 'x'.repeat(512001) }), 413, 'body_too_large');
  error(await h.call('/admin/posts', undefined, { token: h.writer.token, method: 'POST', raw: '{' }), 400, 'invalid_json');
  error(await h.call('/admin/posts', article(), { token: h.writer.token, headers: { 'Content-Type': 'text/plain' } }), 415, 'json_required');
  error(await h.call('/posts?category=' + 'x'.repeat(41)), 400, 'invalid_article');
});

test('origins, methods, configuration and unknown routes fail safely', async () => {
  const h = await harness();
  error(await h.call('/me', undefined, { headers: { Origin: 'https://evil.example' } }), 403, 'origin_forbidden');
  const allowed = await h.call('/me', undefined, { headers: { Origin: 'https://pocket.brclio.com' } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://pocket.brclio.com');
  const preflight = await h.call('/posts', undefined, { method: 'OPTIONS', headers: { Origin: 'https://pocket.bornforthis.cn' } });
  assert.equal(preflight.status, 204);
  error(await h.call('/me', {}, { method: 'PUT' }), 405, 'method_not_allowed');
  error(await h.call('/not-here'), 404, 'not_found');
  error(await h.call('/posts/../../secret'), 404, 'not_found');
  error(await h.call('/posts', undefined, { environment: {} }), 503, 'blog_unavailable');
});

test('provider failures return no paths or diagnostics to clients', async () => {
  const { createBlogApi } = await modulePromise;
  const api = createBlogApi({ storeFactory() { throw Error('private/repository secret-provider-token'); } });
  const response = await api(new Request(BASE + '/posts'), { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: SECRET });
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('secret-provider'), false);
});

test('withdrawn articles reject engagement even for the administrator', async () => {
  const h = await harness(), post = await h.create(), path = '/posts/' + post.id;
  await h.call('/admin/posts/' + post.id, { ...article({ status: 'draft' }), revision: 1 }, { token: h.writer.token, method: 'PUT' });
  error(await h.call(path + '/like', { active: true }, { token: h.writer.token, method: 'PUT' }), 404, 'post_not_found');
  error(await h.call(path + '/favorite', { active: true }, { token: h.writer.token, method: 'PUT' }), 404, 'post_not_found');
  error(await h.call(path + '/view', { visitorId: 'admin-draft-viewer-1234' }, { token: h.writer.token }), 404, 'post_not_found');
});

test('article line count is bounded after CRLF/CR normalization to limit native markup amplification', async () => {
  const h = await harness();
  const valid = await h.create({ content: Array(5000).fill('x').join('\r\n') });
  assert.equal(valid.content.includes('\r'), false);
  error(await h.call('/admin/posts', article({ content: Array(5001).fill('x').join('\n') }), { token: h.writer.token }), 400, 'invalid_article');
  error(await h.call('/admin/posts', article({ content: Array(5001).fill('x').join('\r') }), { token: h.writer.token }), 400, 'invalid_article');
});

test('deleted article IDs are pruned before saved-list documents can grow without bound', async () => {
  const h = await harness(), post = await h.create();
  const path = 'blog/v1/users/' + h.reader.id + '/favorites.json';
  h.state.blog.set(path, { schemaVersion: 1, ids: Array.from({ length: 500 }, (_, index) => index.toString(16).padStart(32, '0')) });
  const saved = await h.call('/posts/' + post.id + '/favorite', { active: true }, { token: h.reader.token, method: 'PUT' });
  assert.equal(saved.status, 200);
  assert.deepEqual(h.state.blog.get(path).ids, [post.id]);
  assert.equal((await h.call('/posts?saved=1', undefined, { token: h.reader.token })).value.total, 1);
});

test('all structured blog writes stay in the dedicated blog repository and never alter ordinary account business data', async () => {
  const h = await harness(), original = { preferences: 'preserve ordinary app data' };
  h.state.data.set('users/v1/ordinary.json', original);
  const post = await h.create();
  for (const [route, body] of [['like', { active: true }], ['favorite', { active: true }]]) assert.equal((await h.call('/posts/' + post.id + '/' + route, body, { token: h.reader.token, method: 'PUT' })).status, 200);
  assert.equal((await h.call('/posts/' + post.id + '/view', { visitorId: 'structured-visitor-12345' })).status, 200);
  assert.equal(h.accessed.includes('data'), false);
  assert.deepEqual([...h.state.data], [['users/v1/ordinary.json', original]]);
  assert.deepEqual([...new Set(h.accessed)].sort(), ['blog', 'users']);
  assert.ok(h.state.blog.size > 5);
  for (const [path, record] of h.state.blog) {
    assert.ok(path.startsWith('blog/v1/'));
    assert.equal(record.schemaVersion, 1, path);
  }
});

test('malformed or unexpected persisted fields never escape article, summary or interaction reads', async () => {
  const cases = [
    async (h, post) => { h.state.blog.get('blog/v1/posts/' + post.id + '/article.json').credentials = 'private-extra'; return '/posts/' + post.id; },
    async (h, post) => { h.state.blog.get('blog/v1/catalog/' + post.id[0] + '.json').posts[0].author.email = 'private-extra'; return '/posts'; },
    async (h, post) => { h.state.blog.get('blog/v1/posts/' + post.id + '/article.json').counts.views = 'private-extra'; return '/posts/' + post.id; },
    async (h, post) => { h.state.blog.set('blog/v1/posts/' + post.id + '/reactions.json', { schemaVersion: 1, likes: [h.reader.id, h.reader.id], favorites: [] }); return '/posts/' + post.id; },
    async (h, post) => { h.state.blog.get('blog/v1/posts/' + post.id + '/article.json').schemaVersion = 2; return '/posts/' + post.id; }
  ];
  for (const mutate of cases) {
    const h = await harness(), post = await h.create(), route = await mutate(h, post);
    const result = await h.call(route, undefined, { token: h.reader.token });
    error(result, 503, 'blog_unavailable');
    assert.equal(JSON.stringify(result.value).includes('private-extra'), false);
  }
});
