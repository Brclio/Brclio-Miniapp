#!/usr/bin/env node
// Explicit production verification. Uses one temporary, hashed owner session
// plus two marker-owned synthetic readers. No mail, password read, profile edit,
// role change or ordinary business-data write is performed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitHubStore } from '../web/account-store.mjs';
import { accountInternals } from '../web/account-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINS = ['https://pocket.bornforthis.cn', 'https://pocket.brclio.com'];
const REPOSITORIES = { users: 'Brclio-Miniapp-UserData', blog: 'Brclio-Miniapp-Blog-Data', data: 'Brclio-Miniapp-Data' };
const OWNER_EMAIL = 'aiyuechuang@gmail.com';
const KIND = 'blog-live-smoke-v1';
const runId = randomBytes(6).toString('hex');
const startedAt = new Date().toISOString();
const relativeDirectory = 'artifacts/blog-release/live-' + startedAt.replace(/[:.]/g, '-') + '-' + runId;
const directory = path.join(root, relativeDirectory);
const readers = [], commentIds = new Set(), viewDays = new Set();
const report = { schemaVersion: 1, kind: KIND, runId, startedAt, passed: false, checks: [], requests: [], storage: [], cleanup: [] };
const marker = { kind: KIND, runId, nonce: randomBytes(16).toString('hex') };
const title = '上线验收（自动清理） ' + runId;
const articleFields = { title, excerpt: '自动验收临时文章，将在核实后撤回并删除。', category: '上线验收',
  tags: ['自动清理', 'qa-' + runId], coverUrl: '', status: 'draft', commentsEnabled: true,
  content: '# 博客上线验收\n\n这是自动清理的临时测试文章。\n\n' + JSON.stringify(marker) };
let env, users, blog, oldData, owner, post, postOwnershipVerified = false, outputReady = false;
let ownerSessionAttempted = false, readerSeedAttempted = false, postCreateAttempted = false;
let previousDataHead, currentDataHead;
const heads = Object.create(null);

function ensure(condition, code) { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); }
function checked(name, condition) { ensure(condition, name); report.checks.push(name); }
function safeError(error) { return /^[a-z][a-z0-9_]{0,100}$/.test(error?.safeCode || '') ? error.safeCode : 'smoke_operation_failed'; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function phase(name) { console.log('[blog smoke] ' + name); }
function articlePath(id, file = 'article') { ensure(/^[a-f0-9]{32}$/.test(id), 'article_id_invalid'); return 'blog/v1/posts/' + id + '/' + file + '.json'; }
function ownsPost(value) { return value?.author?.id === owner?.id && value.title === title && value.content === articleFields.content; }
function noPrivateFields(value, publicIdentity = false) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    ensure(!/password|credential|secret|session_key|openid|unionid|token/i.test(key), 'response_contains_private_fields');
    if (publicIdentity) ensure(!/^email$/i.test(key), 'public_response_contains_email');
    noPrivateFields(child, publicIdentity);
  }
}
function ownerProfile(value) { return value?.id === owner?.id && value.status === 'active' && value.email === OWNER_EMAIL && Array.isArray(value.providers) && value.providers.includes('email'); }
function ownsReader(value, fixture) { return value?.id === fixture.id && value.username === fixture.username && value.email === fixture.email && value.status === 'active' && same(value.providers, ['email']) && same(value.smokeFixture, fixture.marker); }
function ownsOwnerSession(value) { return value?.hash === owner?.sessionHash && value.createdAt === owner?.createdAt && value.expiresAt === null && same(value.smokeFixture, marker); }

async function loadEnvironment() {
  for (const item of ['.dev.vars', 'artifacts/blog-release/']) {
    try { await promisify(execFile)('git', ['check-ignore', '--quiet', '--', item], { cwd: root }); }
    catch { ensure(false, 'private_paths_not_ignored'); }
  }
  const result = Object.create(null);
  for (const line of (await fs.readFile(path.join(root, '.dev.vars'), 'utf8')).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    ensure(match, 'configuration_format_invalid');
    try { result[match[1]] = JSON.parse(match[2]); } catch { ensure(false, 'configuration_format_invalid'); }
  }
  ensure(result.ACCOUNT_ENABLED === 'true' && result.ACCOUNT_HMAC_SECRET?.length >= 32, 'account_configuration_missing');
  return result;
}
async function manifest() {
  if (!outputReady) return;
  const value = { schemaVersion: 1, kind: KIND, runId, startedAt, origins: ORIGINS,
    note: 'Recovery inventory has no bearer or password. Remove only the exact marker-owned reader documents and owner-session hash listed here. Preserve all other owner sessions, profiles, shared rate counters and Git history.',
    owner: owner ? { userId: owner.id, email: OWNER_EMAIL, profilePath: owner.profilePath, sessionsPath: owner.sessionsPath,
      temporarySessionHash: owner.sessionHash, temporarySessionCreatedAt: owner.createdAt, marker,
      sessionAppendAttempted: ownerSessionAttempted } : null,
    readers: readers.map(value => ({ userId: value.id, label: value.label, username: value.username, email: value.email,
      profilePath: value.profilePath, sessionsPath: value.sessionsPath, favoritePath: 'blog/v1/users/' + value.id + '/favorites.json',
      marker: value.marker, seedAttempted: readerSeedAttempted })),
    article: { title, authorId: owner?.id || null, exactContentSha256: hash(articleFields.content), marker,
      createAttempted: postCreateAttempted, postId: post?.id || null,
      paths: post ? ['article', 'reactions', 'comments', ...[...commentIds].map(id => 'comment-' + id), ...[...viewDays].map(day => 'views-' + day)].map(file => articlePath(post.id, file)) : [],
      catalogPath: post ? 'blog/v1/catalog/' + post.id[0] + '.json' : null } };
  await fs.writeFile(path.join(directory, 'recovery.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function observedFetch(input, init = {}) {
  const url = new URL(input), method = init.method || 'GET';
  ensure(url.origin === 'https://api.github.com', 'storage_origin_invalid');
  const match = /^\/repos\/BrclioData\/([^/]+)(?:\/|$)/.exec(url.pathname);
  if (match) {
    ensure(Object.values(REPOSITORIES).includes(match[1]), 'storage_repository_invalid');
    if (match[1] === REPOSITORIES.data) ensure(method === 'GET', 'ordinary_data_write_forbidden');
    if (match[1] === REPOSITORIES.users && method === 'POST' && url.pathname.endsWith('/git/trees')) {
      const allowed = new Set([owner?.sessionsPath, ...readers.flatMap(value => [value.profilePath, value.sessionsPath])].filter(Boolean));
      const value = JSON.parse(init.body);
      ensure(Array.isArray(value.tree) && value.tree.every(item => allowed.has(item.path)), 'account_write_scope_invalid');
    }
  } else {
    ensure(/^\/app\/installations\/[1-9][0-9]*\/access_tokens$/.test(url.pathname) && method === 'POST', 'storage_endpoint_invalid');
    const body = JSON.parse(init.body);
    ensure(Array.isArray(body.repositories) && body.repositories.length === 1 && Object.values(REPOSITORIES).includes(body.repositories[0]), 'token_repository_scope_invalid');
  }
  const response = await fetch(input, init);
  if (match && url.pathname.includes('/git/ref/') && response.ok) {
    const value = await response.clone().json();
    if (/^[a-f0-9]{40,64}$/.test(value?.object?.sha || '')) heads[match[1]] = value.object.sha;
  }
  if (match && !['GET', 'HEAD'].includes(method)) report.storage.push({ repository: match[1], method, path: url.pathname, status: response.status });
  return response;
}
async function call(origin, route, { method = 'GET', data, token, expected = 200, publicIdentity = false, account = false } = {}) {
  ensure(ORIGINS.includes(origin), 'request_origin_invalid');
  const record = { origin, route, method, expected, status: null, durationMs: null };
  report.requests.push(record);
  const begin = performance.now();
  try {
    const response = await fetch(origin + (account ? '/api/account' : '/api/blog') + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    record.status = response.status;
    const date = Date.parse(response.headers.get('Date'));
    if (route.endsWith('/view')) { viewDays.add(Math.floor(Date.now() / 86400000)); if (Number.isFinite(date)) viewDays.add(Math.floor(date / 86400000)); }
    let value; try { value = await response.json(); } catch { ensure(false, 'api_response_invalid'); }
    noPrivateFields(value, publicIdentity);
    ensure(response.headers.get('Cache-Control')?.includes('no-store'), 'api_cache_policy_invalid');
    if (record.status !== expected) {
      record.errorCode = /^[a-z][a-z0-9_]{0,79}$/.test(value?.error || '') ? value.error : 'unexpected_response';
      ensure(false, 'api_status_unexpected');
    }
    return value;
  } finally { record.durationMs = Math.round(performance.now() - begin); }
}
async function discoverOwner() {
  const index = await users.read(await accountInternals.indexPath(env.ACCOUNT_HMAC_SECRET, 'email', OWNER_EMAIL));
  ensure(/^[a-f0-9]{32}$/.test(index?.userId || ''), 'owner_email_account_missing');
  const id = index.userId, token = 'm1.' + id + '.' + randomBytes(32).toString('hex');
  owner = { id, token, sessionHash: hash(token), createdAt: Date.now(),
    profilePath: accountInternals.userPath(id, 'profile'), sessionsPath: accountInternals.userPath(id, 'sessions') };
  const profile = await users.read(owner.profilePath);
  ensure(ownerProfile(profile), 'owner_profile_not_verified'); owner.profileSnapshotHash = hash(JSON.stringify(profile));
  await manifest();
}
async function appendOwnerSession() {
  ownerSessionAttempted = true; await manifest();
  await users.transaction(async tx => {
    ensure(ownerProfile(await tx.get(owner.profilePath)), 'owner_profile_not_verified');
    const value = await tx.get(owner.sessionsPath);
    ensure(value && Array.isArray(value.items) && !value.items.some(item => item.hash === owner.sessionHash), 'owner_sessions_invalid');
    tx.put(owner.sessionsPath, { ...value, items: value.items.concat({ hash: owner.sessionHash, createdAt: owner.createdAt, expiresAt: null, smokeFixture: marker }) });
  });
  checked('temporary_owner_session_appended', (await users.read(owner.sessionsPath))?.items?.some(ownsOwnerSession));
}
async function seedReaders() {
  for (const label of ['a', 'b']) {
    const id = randomBytes(16).toString('hex'), token = 'm1.' + id + '.' + randomBytes(32).toString('hex');
    readers.push({ label, id, token, sessionHash: hash(token), createdAt: Date.now(), username: 'qabl_' + runId + label,
      email: 'blog-' + runId + '-' + label + '@brclio-smoke.invalid',
      profilePath: accountInternals.userPath(id, 'profile'), sessionsPath: accountInternals.userPath(id, 'sessions'),
      marker: { ...marker, label } });
  }
  readerSeedAttempted = true; await manifest();
  await users.transaction(async tx => {
    for (const reader of readers) for (const key of ['profilePath', 'sessionsPath']) ensure(await tx.get(reader[key]) === null, 'reader_fixture_path_occupied');
    for (const reader of readers) {
      tx.put(reader.profilePath, { schemaVersion: 1, id: reader.id, username: reader.username, email: reader.email,
        displayName: 'Blog smoke ' + reader.label, providers: ['email'], status: 'active', avatar: { type: 'builtin', id: 1 },
        createdAt: reader.createdAt, updatedAt: reader.createdAt, smokeFixture: reader.marker });
      tx.put(reader.sessionsPath, { schemaVersion: 1, items: [{ hash: reader.sessionHash, createdAt: reader.createdAt, expiresAt: null, smokeFixture: reader.marker }] });
    }
  });
}
async function updateArticle(fields) {
  const result = await call(ORIGINS[0], '/admin/posts/' + post.id, { method: 'PUT', token: owner.token, data: { ...articleFields, ...fields, revision: post.revision } });
  ensure(ownsPost(result.post), 'article_ownership_changed'); post = result.post; await manifest(); return post;
}
async function verifyWorkflow() {
  const [a, b] = readers;
  for (const origin of ORIGINS) {
    const me = await call(origin, '/me', { token: owner.token });
    checked('owner_is_admin_' + new URL(origin).hostname, me.user?.id === owner.id && me.user.email === OWNER_EMAIL && me.canWrite === true);
    for (const reader of readers) {
      checked('shared_account_session_' + new URL(origin).hostname + '_' + reader.label,
        (await call(origin, '/session', { account: true, token: reader.token })).user?.id === reader.id);
      checked('reader_is_not_admin_' + new URL(origin).hostname + '_' + reader.label,
        (await call(origin, '/me', { token: reader.token })).canWrite === false);
    }
    await call(origin, '/admin/posts', { token: a.token, expected: 403 });
    await call(origin, '/admin/posts', { expected: 401 });
  }
  phase('create private draft and prove public isolation');
  postCreateAttempted = true; await manifest();
  const result = await call(ORIGINS[0], '/admin/posts', { method: 'POST', token: owner.token, data: articleFields, expected: 201 });
  ensure(ownsPost(result.post), 'article_ownership_changed'); post = result.post; postOwnershipVerified = true; await manifest();
  checked('draft_revision_one', post.status === 'draft' && post.revision === 1);
  for (const origin of ORIGINS) {
    await call(origin, '/posts/' + post.id, { expected: 404 });
    await call(origin, '/posts/' + post.id, { token: a.token, expected: 404 });
    checked('draft_absent_from_public_list_' + new URL(origin).hostname,
      !(await call(origin, '/posts?q=' + runId, { publicIdentity: true })).posts.some(item => item.id === post.id));
  }
  const stored = await blog.read(articlePath(post.id));
  checked('draft_stored_in_dedicated_repository', ownsPost(stored) && stored.status === 'draft');
  checked('ordinary_business_repo_has_no_blog_article', await oldData.read(articlePath(post.id)) === null);

  phase('publish and verify reads on both production domains');
  const previousRevision = post.revision; await updateArticle({ status: 'published' });
  checked('published_revision_increments', post.revision === previousRevision + 1 && Number.isSafeInteger(post.publishedAt));
  for (const origin of ORIGINS) {
    const detail = await call(origin, '/posts/' + post.id, { publicIdentity: true });
    checked('published_read_' + new URL(origin).hostname, detail.post.content === articleFields.content && !detail.canEdit);
    checked('published_list_' + new URL(origin).hostname, (await call(origin, '/posts?q=' + runId, { publicIdentity: true })).posts.some(item => item.id === post.id));
  }
  const revision = post.revision;
  await call(ORIGINS[1], '/admin/posts/' + post.id, { method: 'PUT', token: owner.token,
    data: { ...articleFields, status: 'published', revision: previousRevision }, expected: 409 });
  checked('stale_article_revision_rejected', (await call(ORIGINS[0], '/posts/' + post.id, { token: owner.token })).post.revision === revision);

  phase('verify cross-domain views, reactions and per-account favorites');
  const visitor = 'blog_smoke_' + randomBytes(16).toString('hex'); viewDays.add(Math.floor(Date.now() / 86400000));
  const views = await call(ORIGINS[0], '/posts/' + post.id + '/view', { method: 'POST', data: { visitorId: visitor } });
  checked('first_view_counted', views.counts.views === 1);
  checked('visitor_view_deduped_cross_domain', (await call(ORIGINS[1], '/posts/' + post.id + '/view', { method: 'POST', data: { visitorId: visitor } })).counts.views === 1);
  checked('first_like_counted', (await call(ORIGINS[0], '/posts/' + post.id + '/like', { method: 'PUT', token: a.token, data: { active: true } })).counts.likes === 1);
  checked('like_idempotent_cross_domain', (await call(ORIGINS[1], '/posts/' + post.id + '/like', { method: 'PUT', token: a.token, data: { active: true } })).counts.likes === 1);
  checked('second_account_does_not_inherit_like', (await call(ORIGINS[1], '/posts/' + post.id, { token: b.token })).interaction.liked === false);
  checked('second_account_like_added', (await call(ORIGINS[1], '/posts/' + post.id + '/like', { method: 'PUT', token: b.token, data: { active: true } })).counts.likes === 2);
  checked('first_favorite_counted', (await call(ORIGINS[0], '/posts/' + post.id + '/favorite', { method: 'PUT', token: a.token, data: { active: true } })).counts.favorites === 1);
  checked('favorite_idempotent_cross_domain', (await call(ORIGINS[1], '/posts/' + post.id + '/favorite', { method: 'PUT', token: a.token, data: { active: true } })).counts.favorites === 1);
  checked('favorites_read_cross_domain', (await call(ORIGINS[1], '/posts?saved=1', { token: a.token })).posts.some(item => item.id === post.id));
  checked('favorites_isolated', !(await call(ORIGINS[0], '/posts?saved=1', { token: b.token })).posts.some(item => item.id === post.id));
  await call(ORIGINS[0], '/posts/' + post.id + '/like', { method: 'PUT', data: { active: true }, expected: 401 });

  phase('verify comments, authorization, closure and moderation');
  const commentText = '上线验收 ' + runId + ' <script>不会执行</script>';
  const comment = await call(ORIGINS[0], '/posts/' + post.id + '/comments', { method: 'POST', token: a.token, data: { content: commentText }, expected: 201 });
  commentIds.add(comment.comment.id); await manifest();
  const publicComments = await call(ORIGINS[1], '/posts/' + post.id + '/comments', { publicIdentity: true });
  checked('comment_reads_cross_domain_as_text', publicComments.comments.some(item => item.id === comment.comment.id && item.content === commentText && !item.canDelete));
  await call(ORIGINS[1], '/posts/' + post.id + '/comments/' + comment.comment.id, { method: 'DELETE', token: b.token, expected: 403 });
  await updateArticle({ status: 'published', commentsEnabled: false });
  await call(ORIGINS[1], '/posts/' + post.id + '/comments', { method: 'POST', token: b.token, data: { content: '评论关闭后不应保存' }, expected: 403 });
  checked('closed_comments_remain_readable', (await call(ORIGINS[0], '/posts/' + post.id + '/comments')).total === 1);
  checked('comment_author_can_delete', (await call(ORIGINS[1], '/posts/' + post.id + '/comments/' + comment.comment.id, { method: 'DELETE', token: a.token })).counts.comments === 0);
  await updateArticle({ status: 'published', commentsEnabled: true });
  const second = await call(ORIGINS[1], '/posts/' + post.id + '/comments', { method: 'POST', token: b.token, data: { content: '管理员可在撤回后管理本条验收评论 ' + runId }, expected: 201 });
  commentIds.add(second.comment.id); await manifest();
  const persisted = await blog.read(articlePath(post.id));
  checked('published_structured_counts_match', ownsPost(persisted) && persisted.counts.likes === 2 && persisted.counts.favorites === 1 && persisted.counts.views === 1 && persisted.counts.comments === 1);
  noPrivateFields(persisted, true);
  const reactions = await blog.read(articlePath(post.id, 'reactions'));
  checked('structured_reactions_match_accounts', same(new Set(reactions.likes).size, 2) && reactions.likes.includes(a.id) && reactions.likes.includes(b.id) && same(reactions.favorites, [a.id]));
  report.blogRecord = { repository: REPOSITORIES.blog, postId: post.id, articlePath: articlePath(post.id),
    revision: persisted.revision, counts: persisted.counts, keys: Object.keys(persisted).sort(), observedHead: heads[REPOSITORIES.blog] || null };

  phase('withdraw, hide saved entries and moderate withdrawn comments');
  await updateArticle({ status: 'draft' });
  for (const origin of ORIGINS) {
    await call(origin, '/posts/' + post.id, { expected: 404 });
    await call(origin, '/posts/' + post.id, { token: a.token, expected: 404 });
    checked('withdrawn_hidden_from_saved_' + new URL(origin).hostname, !(await call(origin, '/posts?saved=1', { token: a.token })).posts.some(item => item.id === post.id));
  }
  checked('admin_can_delete_withdrawn_comment', (await call(ORIGINS[0], '/posts/' + post.id + '/comments/' + second.comment.id, { method: 'DELETE', token: owner.token })).counts.comments === 0);
  checked('owner_profile_unchanged', hash(JSON.stringify(await users.read(owner.profilePath))) === owner.profileSnapshotHash);
  phase('delete disposable article through the live administrator API');
  const deleted = await call(ORIGINS[0], '/admin/posts/' + post.id, { method: 'DELETE', token: owner.token, data: { revision: post.revision } });
  checked('admin_article_delete_succeeds', deleted.deleted === true && await blog.read(articlePath(post.id)) === null);
  for (const origin of ORIGINS) await call(origin, '/posts/' + post.id, { token: owner.token, expected: 404 });
}

async function recoverPost() {
  if (!postCreateAttempted || post) return;
  const shards = await Promise.all('0123456789abcdef'.split('').map(value => blog.read('blog/v1/catalog/' + value + '.json')));
  const matches = shards.flatMap(value => value?.posts || []).filter(value => value.title === title && value.author?.id === owner.id);
  ensure(matches.length <= 1, 'cleanup_article_ambiguous');
  if (matches.length) {
    const candidate = await blog.read(articlePath(matches[0].id));
    ensure(ownsPost(candidate), 'cleanup_article_ownership_unverified'); post = candidate; postOwnershipVerified = true; await manifest();
  }
}
async function cleanupBlog() {
  const result = { scope: 'blog_fixture', passed: false, removedPaths: [] }; report.cleanup.push(result);
  try {
    await recoverPost();
    if (!post) { result.passed = true; result.note = 'No article was committed.'; return; }
    const present = await blog.read(articlePath(post.id));
    ensure(present ? ownsPost(present) : postOwnershipVerified, 'cleanup_article_ownership_unverified');
    if (present) {
      // Exercise the published DELETE route before removing inaccessible fixture
      // social documents. Any ambiguous response is reconciled by the transaction.
      try { await call(ORIGINS[0], '/admin/posts/' + post.id, { method: 'DELETE', token: owner.token, data: { revision: present.revision } }); }
      catch { /* Exact ownership is checked again atomically below. */ }
    }
    await blog.transaction(async tx => {
      const article = await tx.get(articlePath(post.id));
      ensure(article ? ownsPost(article) : postOwnershipVerified, 'cleanup_article_ownership_unverified');
      const catalogPath = 'blog/v1/catalog/' + post.id[0] + '.json', catalog = await tx.get(catalogPath);
      if (catalog) {
        const target = catalog.posts.find(value => value.id === post.id);
        ensure(!target || target.title === title && target.author?.id === owner.id, 'cleanup_catalog_ownership_unverified');
        tx.put(catalogPath, { ...catalog, posts: catalog.posts.filter(value => value.id !== post.id) });
      }
      const index = await tx.get(articlePath(post.id, 'comments'));
      for (const item of index?.items || []) { ensure(/^[a-f0-9]{32}$/.test(item.id), 'cleanup_comment_id_invalid'); commentIds.add(item.id); }
      const files = ['article', 'reactions', 'comments', ...[...commentIds].map(value => 'comment-' + value), ...[...viewDays].map(day => 'views-' + day)];
      for (const file of files) { const p = articlePath(post.id, file); tx.delete(p); result.removedPaths.push(p); }
      for (const reader of readers) {
        const p = 'blog/v1/users/' + reader.id + '/favorites.json', favorites = await tx.get(p);
        ensure(!favorites || Array.isArray(favorites.ids) && favorites.ids.every(value => value === post.id), 'cleanup_favorites_ownership_unverified');
        if (favorites) { tx.delete(p); result.removedPaths.push(p); }
      }
    });
    checked('fixture_blog_records_removed', (await Promise.all(result.removedPaths.map(value => blog.read(value)))).every(value => value === null));
    checked('ordinary_business_article_still_absent', await oldData.read(articlePath(post.id)) === null);
    result.passed = true;
  } catch (error) { result.error = safeError(error); }
  finally { try { await manifest(); } catch { result.passed = false; result.error ||= 'recovery_inventory_write_failed'; } }
}
async function cleanupReader(reader) {
  const result = { scope: 'reader_' + reader.label, userId: reader.id, passed: false, removedPaths: [] }; report.cleanup.push(result);
  try {
    const profile = await users.read(reader.profilePath), sessions = await users.read(reader.sessionsPath);
    if (!profile && !sessions) { result.passed = true; return; }
    ensure(ownsReader(profile, reader) && Array.isArray(sessions?.items) && sessions.items.every(value => value.hash === reader.sessionHash && same(value.smokeFixture, reader.marker)), 'cleanup_reader_ownership_unverified');
    await users.transaction(async tx => {
      ensure(ownsReader(await tx.get(reader.profilePath), reader), 'cleanup_reader_ownership_unverified');
      const active = await tx.get(reader.sessionsPath);
      ensure(active?.items?.every(value => value.hash === reader.sessionHash && same(value.smokeFixture, reader.marker)), 'cleanup_reader_sessions_unverified');
      tx.delete(reader.profilePath); tx.delete(reader.sessionsPath);
    });
    result.removedPaths = [reader.profilePath, reader.sessionsPath];
    ensure((await Promise.all(result.removedPaths.map(value => users.read(value)))).every(value => value === null), 'cleanup_reader_records_remaining'); result.passed = true;
  } catch (error) { result.error = safeError(error); }
}
async function cleanupOwnerSession() {
  const result = { scope: 'temporary_owner_session', userId: owner.id, passed: false }; report.cleanup.push(result);
  try {
    await users.transaction(async tx => {
      ensure(ownerProfile(await tx.get(owner.profilePath)), 'cleanup_owner_profile_changed');
      const sessions = await tx.get(owner.sessionsPath);
      ensure(Array.isArray(sessions?.items), 'cleanup_owner_sessions_invalid');
      const target = sessions.items.find(value => value.hash === owner.sessionHash);
      if (!target) return;
      ensure(ownsOwnerSession(target), 'cleanup_owner_session_ownership_unverified');
      tx.put(owner.sessionsPath, { ...sessions, items: sessions.items.filter(value => value.hash !== owner.sessionHash) });
    });
    ensure(!(await users.read(owner.sessionsPath))?.items?.some(value => value.hash === owner.sessionHash), 'cleanup_owner_session_remaining');
    for (const origin of ORIGINS) await call(origin, '/me', { token: owner.token, expected: 401 });
    result.passed = true;
  } catch (error) { result.error = safeError(error); }
}

async function main() {
  try {
    ensure(process.argv.length === 3 && process.argv[2] === '--run', 'explicit_run_flag_required');
    env = await loadEnvironment();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 }); outputReady = true;
    users = createGitHubStore(env, { repository: 'users', fetchImpl: observedFetch });
    blog = createGitHubStore(env, { repository: 'blog', fetchImpl: observedFetch });
    oldData = createGitHubStore(env, { repository: 'data', fetchImpl: observedFetch });
    // This repository is read-only throughout the entire script.
    await oldData.read('blog/v1/release-probe-' + runId + '.json'); previousDataHead = heads[REPOSITORIES.data] || null;
    phase('verify existing owner identity without reading credentials');
    await discoverOwner();
    phase('append one temporary owner session and seed isolated reader profiles');
    await appendOwnerSession(); await seedReaders();
    await verifyWorkflow();
    report.passed = true;
  } catch (error) { report.error = safeError(error); }
  finally {
    if (blog && owner && postCreateAttempted) { phase('remove the exact disposable blog fixture'); await cleanupBlog(); }
    if (users && readerSeedAttempted) for (const reader of readers) await cleanupReader(reader);
    if (users && owner && ownerSessionAttempted) { phase('remove only this run temporary owner session'); await cleanupOwnerSession(); }
    if (oldData) {
      try {
        await oldData.read('blog/v1/release-probe-' + runId + '.json'); currentDataHead = heads[REPOSITORIES.data] || null;
        report.ordinaryBusinessRepository = { repository: REPOSITORIES.data, beforeHead: previousDataHead, afterHead: currentDataHead,
          unchanged: previousDataHead === currentDataHead, scriptWriteRequests: report.storage.filter(value => value.repository === REPOSITORIES.data).length,
          note: 'HEAD changes can come from concurrent real activity; this script rejects every write request to this repository.' };
      } catch { report.passed = false; report.error ||= 'ordinary_business_readback_failed'; }
    }
    const expectedCleanup = (postCreateAttempted ? 1 : 0) + (readerSeedAttempted ? readers.length : 0) + (ownerSessionAttempted ? 1 : 0);
    if (report.cleanup.length !== expectedCleanup || report.cleanup.some(value => !value.passed)) report.passed = false;
    report.finishedAt = new Date().toISOString();
    report.note = 'Temporary owner session only; no owner password read, email delivery, real profile/role changes or ordinary business-repository writes. Synthetic current documents removed after ownership checks. Shared limits and Git history remain.';
    if (outputReady) {
      try {
        await manifest();
        await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        console.log('[blog smoke] ' + (report.passed ? 'PASS' : 'FAIL') + ' · ' + relativeDirectory + '/report.json');
      } catch { report.passed = false; console.log('[blog smoke] FAIL · artifact_write_failed'); }
    } else console.log('[blog smoke] FAIL · ' + (report.error || 'configuration_unavailable'));
    process.exitCode = report.passed ? 0 : 1;
  }
}
if (process.argv[2] === '--help' || process.argv.length === 2) {
  console.log('Usage: node scripts/blog-live-smoke.mjs --run');
  console.log('Checks both production domains using the dedicated private Blog-Data repository. Writes disposable fixtures and one temporary owner-session hash, then removes their exact current records. No email or password read. Evidence: ignored artifacts/blog-release/live-*/.');
} else await main();
