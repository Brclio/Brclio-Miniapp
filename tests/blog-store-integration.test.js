const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync } = require('node:crypto');
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
const sha = value => createHash('sha1').update(value).digest('hex');
let sequence = 9000;

async function fixture({ conflict = false, comments = 0 } = {}) {
  const { createBlogApi } = await import('../web/blog-api.mjs');
  const userId = 'a'.repeat(32), postId = 'b'.repeat(32), token = 'm1.' + userId + '.' + 'c'.repeat(64), at = Date.UTC(2026, 9, 27);
  const files = {
    'Brclio-Miniapp-UserData': {
      ['users/v1/aa/' + userId + '/profile.json']: { id: userId, status: 'active', email: 'writer@example.test', displayName: 'Brclio', providers: ['email'], avatar: { type: 'builtin', id: 1 } },
      ['users/v1/aa/' + userId + '/sessions.json']: { items: [{ hash: createHash('sha256').update(token).digest('hex') }] }
    },
    'Brclio-Miniapp-Blog-Data': {}
  };
  if (comments) {
    const root = 'blog/v1/posts/' + postId + '/';
    files['Brclio-Miniapp-Blog-Data'][root + 'article.json'] = { schemaVersion: 1, id: postId, title: '存储联调', excerpt: '摘要', category: '随笔', tags: [], coverUrl: '', status: 'published', content: '正文', commentsEnabled: true, author: { id: userId, displayName: 'Brclio', avatarUrl: '' }, createdAt: at, publishedAt: at, updatedAt: at, readingMinutes: 1, revision: 1, counts: { views: 0, likes: 0, favorites: 0, comments } };
    files['Brclio-Miniapp-Blog-Data'][root + 'comments.json'] = { schemaVersion: 1, items: Array.from({ length: comments }, (_, index) => ({ id: index.toString(16).padStart(32, '0') })) };
    for (let index = 0; index < comments; index += 1) {
      const id = index.toString(16).padStart(32, '0');
      files['Brclio-Miniapp-Blog-Data'][root + 'comment-' + id + '.json'] = { schemaVersion: 1, id, content: '读者留言 ' + index, author: { id: userId, displayName: 'Brclio', avatarUrl: '' }, createdAt: at };
    }
  }
  const calls = [];
  const response = (body, status = 200) => Response.json(body, { status });
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: 'test-only-blog-store-integration-secret-at-least32', BLOG_ADMIN_EMAILS: 'writer@example.test', GITHUB_APP_ID: String(sequence++), GITHUB_APP_INSTALLATION_ID: '17', GITHUB_APP_PRIVATE_KEY: privateKey };
  let serial = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input), method = options.method;
    calls.push({ url: url.href, method });
    assert.equal(options.redirect, 'manual');
    if (url.pathname === '/app/installations/17/access_tokens') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.permissions, { contents: 'write' });
      assert.equal(body.repositories.length, 1);
      assert.ok(Object.hasOwn(files, body.repositories[0]));
      return response({ token: 'fixture-' + body.repositories[0], expires_at: new Date(Date.now() + 3600000).toISOString() }, 201);
    }
    const match = /^\/repos\/BrclioData\/(Brclio-Miniapp-(?:UserData|Blog-Data))(.*)$/.exec(url.pathname);
    assert.ok(match, 'requests stay inside fixed private repositories');
    const repo = match[1], suffix = match[2];
    if (!suffix) return response({ private: true });
    if (suffix === '/git/ref/heads/main') return response({ object: { type: 'commit', sha: sha(repo) } });
    if (suffix.startsWith('/contents/')) {
      assert.equal(method, 'GET');
      assert.equal(url.searchParams.get('ref'), sha(repo));
      const path = decodeURIComponent(suffix.slice('/contents/'.length));
      if (!Object.hasOwn(files[repo], path)) return response({}, 404);
      const value = JSON.stringify(files[repo][path]);
      return response({ type: 'file', encoding: 'base64', size: Buffer.byteLength(value), content: Buffer.from(value).toString('base64') });
    }
    if (suffix === '/git/commits/' + sha(repo)) return response({ tree: { sha: sha('base-tree') } });
    if (suffix === '/git/trees') return response({ sha: sha('tree-' + ++serial) }, 201);
    if (suffix === '/git/commits' && method === 'POST') return response({ sha: sha('commit-' + ++serial) }, 201);
    if (suffix === '/git/refs/heads/main' && method === 'PATCH') return response({}, conflict ? 409 : 200);
    throw new Error('Unexpected mock request');
  };
  const api = createBlogApi({ fetchImpl, now: () => at });
  async function call(route, body) {
    const response = await api(new Request('https://pocket.bornforthis.cn/api/blog' + route, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {})
    }), env);
    return { status: response.status, value: await response.json() };
  }
  return { call, calls, postId, files };
}

test('retired comments do not access GitHub and legacy articles stay readable within the fetch budget', async () => {
  const h = await fixture({ comments: 30 }), before = structuredClone(h.files);
  for (const body of [undefined, { content: '不可新增评论' }]) {
    const result = await h.call('/posts/' + h.postId + '/comments', body);
    assert.equal(result.status, 404); assert.equal(result.value.error, 'not_found');
  }
  assert.equal(h.calls.length, 0, 'retired routes make no external requests');
  const result = await h.call('/posts/' + h.postId);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal(result.value.post.commentsEnabled, false);
  assert.equal(result.value.post.counts.comments, 30, 'legacy schema remains readable');
  assert.ok(h.calls.length <= 45, 'reserve headroom under Cloudflare 50-external-fetch ceiling');
  assert.equal(h.calls.some(call => call.url.includes('/comment')), false, 'article reads do not fetch historical comments');
  assert.equal(h.calls.some(call => call.method === 'PATCH'), false, 'article read creates no commits');
  assert.deepEqual(h.files, before);
});

test('real GitHub transaction conflict retries stop before platform subrequest exhaustion', async () => {
  const h = await fixture({ conflict: true });
  const result = await h.call('/admin/posts', { title: '冲突保护', content: '正文', status: 'published' });
  assert.equal(result.status, 409, JSON.stringify(result.value));
  assert.equal(result.value.error, 'storage_conflict');
  assert.equal(h.calls.length, 45);
  assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 1, 'first conflicting attempt is replayed only within the remaining fetch budget');
});
