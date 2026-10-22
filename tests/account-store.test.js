const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash, createPublicKey, verify } = require('node:crypto');

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const pkcs1 = key.export({ format: 'pem', type: 'pkcs1' });
const pkcs8 = key.export({ format: 'pem', type: 'pkcs8' });
let appSequence = 100;
const sha = value => createHash('sha1').update(String(value)).digest('hex');
const response = (value, status = 200) => Response.json(value, { status });
const clone = value => structuredClone(value);
function configuration(extra = {}) {
  return { GITHUB_APP_ID: String(appSequence++), GITHUB_APP_PRIVATE_KEY: pkcs1, GITHUB_APP_INSTALLATION_ID: '7', ...extra };
}
function fixture({ files = {}, empty = false, conflict = false, hook } = {}) {
  const calls = [];
  const versions = new Map();
  const trees = new Map();
  let serial = 0;
  let head = empty ? null : sha('initial');
  if (head) versions.set(head, clone(files));
  let conflicted = false;
  let tokenCount = 0;
  function advance(next) { head = sha('commit-' + ++serial); versions.set(head, clone(next)); return head; }
  const fetchImpl = async (input, options) => {
    assert.equal(options.redirect, 'manual', 'Workers requires manual redirects; never forward a credential automatically');
    const url = new URL(input);
    const body = options.body && JSON.parse(options.body);
    const call = { path: url.pathname, search: url.search, ...options, body };
    calls.push(call);
    const custom = await hook?.(call, { calls, versions, get head() { return head; }, advance });
    if (custom) return custom;
    if (/^\/repos\/BrclioData\/[^/]+$/.test(call.path)) return response({ private: true });
    if (call.path.endsWith('/installation')) return response({ id: 7 });
    if (call.path === '/app/installations/7/access_tokens') {
      tokenCount += 1;
      return response({ token: 'test-installation-token-' + tokenCount, expires_at: new Date(Date.now() + 3600000).toISOString() }, 201);
    }
    if (call.path.includes('/git/ref/heads/')) return head ? response({ object: { type: 'commit', sha: head } }) : response({}, 409);
    if (call.path.endsWith('/commits') && call.method === 'GET') return head ? response([{ sha: head }]) : response({}, 409);
    if (call.path.includes('/contents/')) {
      const path = decodeURIComponent(call.path.split('/contents/')[1]);
      if (call.method === 'PUT' && path === '.brclio-store.json') {
        if (head) return response({}, 422);
        advance({ [path]: JSON.parse(Buffer.from(body.content, 'base64').toString()) });
        return response({ commit: { sha: head } }, 201);
      }
      assert.equal(call.method, 'GET');
      const filesAtHead = versions.get(url.searchParams.get('ref'));
      assert.ok(filesAtHead, 'all reads must use a known, immutable commit SHA');
      if (!Object.hasOwn(filesAtHead, path)) return response({}, 404);
      const content = JSON.stringify(filesAtHead[path]);
      return response({ type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
    }
    if (call.path.includes('/git/commits/') && call.method === 'GET') return response({ tree: { sha: sha('tree-' + call.path.split('/').at(-1)) } });
    if (call.path.endsWith('/git/trees')) {
      const source = [...versions.keys()].find(value => sha('tree-' + value) === body.base_tree);
      assert.ok(source, 'tree uses exactly the pinned parent commit tree');
      const next = clone(versions.get(source));
      for (const entry of body.tree) {
        assert.equal(entry.type, 'blob');
        if (entry.sha === null) delete next[entry.path];
        else next[entry.path] = JSON.parse(entry.content);
      }
      const treeSha = sha('new-tree-' + ++serial);
      trees.set(treeSha, next);
      return response({ sha: treeSha }, 201);
    }
    if (call.path.endsWith('/git/commits') && call.method === 'POST') {
      assert.equal(body.parents.length, 1);
      const commit = sha('created-commit-' + ++serial);
      versions.set(commit, clone(trees.get(body.tree)));
      return response({ sha: commit }, 201);
    }
    if (call.path.includes('/git/refs/heads/') && call.method === 'PATCH') {
      assert.equal(body.force, false, 'never force a branch update');
      if (conflict && !conflicted) {
        conflicted = true;
        advance({ ...versions.get(head), 'users/a/counter.json': { value: 8 }, 'preserve.json': { concurrent: true } });
        return response({ message: 'Reference update failed' }, 422);
      }
      head = body.sha;
      return response({ object: { sha: head } });
    }
    throw new Error('Unexpected mock API request: ' + call.method + ' ' + call.path);
  };
  return { fetchImpl, calls, versions, get head() { return head; }, get tokenCount() { return tokenCount; } };
}

async function api() { return import('../web/account-store.mjs'); }

test('JSON writes are one atomic commit, preserve untouched files and support read-your-writes', async () => {
  const { createGitHubStore } = await api();
  const mock = fixture({ files: { 'users/a/old.json': { obsolete: true }, 'users/a/null.json': null, 'preserve.json': { keep: true } } });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  let transaction;
  const answer = await store.transaction(async tx => {
    transaction = tx;
    assert.equal(await tx.get('users/a/missing.json'), null);
    tx.put('users/a/profile.json', { id: 'a', displayName: '中文' });
    const value = await tx.get('users/a/profile.json');
    value.id = 'caller-mutated';
    assert.equal((await tx.get('users/a/profile.json')).id, 'a');
    tx.put('indexes/email/a.json', { userId: 'a' });
    tx.delete('users/a/old.json');
    tx.delete('users/a/null.json');
    tx.delete('users/a/missing.json');
    assert.equal(await tx.get('users/a/old.json'), null);
    return { userId: 'a' };
  });
  assert.deepEqual(answer, { userId: 'a' });
  assert.deepEqual(mock.versions.get(mock.head), {
    'preserve.json': { keep: true }, 'users/a/profile.json': { id: 'a', displayName: '中文' }, 'indexes/email/a.json': { userId: 'a' }
  });
  assert.equal(mock.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(mock.calls.filter(call => call.path.endsWith('/git/trees')).length, 1);
  assert.equal(mock.calls.filter(call => call.path.includes('/contents/') && call.method !== 'GET').length, 0);
  assert.equal(mock.tokenCount, 1);
  assert.throws(() => transaction.put('late.json', {}), { safeCode: 'store_transaction_closed' });
});

test('fast-forward conflicts retry all validation against the new immutable HEAD', async () => {
  const { createGitHubStore } = await api();
  const mock = fixture({ files: { 'users/a/counter.json': { value: 2 } }, conflict: true });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  let attempts = 0;
  const result = await store.transaction(async tx => {
    attempts += 1;
    const record = await tx.get('users/a/counter.json');
    const value = record.value + 1;
    tx.put('users/a/counter.json', { value });
    tx.put('indexes/counter.json', { value });
    return value;
  });
  assert.equal(attempts, 2);
  assert.equal(result, 9);
  assert.deepEqual(mock.versions.get(mock.head), {
    'users/a/counter.json': { value: 9 }, 'indexes/counter.json': { value: 9 }, 'preserve.json': { concurrent: true }
  });
  const refs = mock.calls.filter(call => call.path.includes('/contents/')).map(call => new URLSearchParams(call.search).get('ref'));
  assert.equal(new Set(refs).size, 2);
});

test('transaction retry count is bounded and conflict error contains no upstream body', async () => {
  const { createGitHubStore, AccountStoreError } = await api();
  const mock = fixture({ hook: call => call.method === 'PATCH' ? response({ message: 'secret credential password private details' }, 409) : null });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  let attempts = 0;
  await assert.rejects(store.transaction(tx => { attempts += 1; tx.put('users/a/profile.json', { id: 'a' }); }), error => {
    assert.ok(error instanceof AccountStoreError);
    assert.equal(error.status, 409);
    assert.equal(error.safeCode, 'store_conflict');
    assert.doesNotMatch(error.stack, /secret credential|private details/);
    return true;
  });
  assert.equal(attempts, 4);
});

test('paths, branches, repository selectors and JSON document limits are validated', async () => {
  const { createGitHubStore } = await api();
  let calls = 0;
  const store = createGitHubStore(configuration(), { fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); } });
  for (const path of ['', '../secret.json', 'users/../secret.json', '/users/a.json', 'users//a.json', 'users/%2fsecret.json',
    'users/secret.json?ref=main', 'users/.git/config.json', 'users/a.txt', 'users/a\\secret.json', 'users/a.json\0', '用户/a.json']) {
    await assert.rejects(store.read(path), { status: 400, safeCode: 'store_path_invalid' }, path);
  }
  assert.equal(calls, 0);
  assert.throws(() => createGitHubStore(configuration(), { repository: 'https://attacker.example' }), { safeCode: 'store_configuration_invalid' });
  assert.throws(() => createGitHubStore(configuration({ GITHUB_USERDATA_BRANCH: '../bad' })), { safeCode: 'store_configuration_invalid' });
  const mock = fixture();
  const writable = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  await assert.rejects(writable.transaction(tx => tx.put('too-large.json', { value: 'x'.repeat(1024 * 1024) })), { status: 413, safeCode: 'store_document_too_large' });
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false);
});

test('PKCS#1 and PKCS#8 keys create valid RS256 JWTs; Client ID is preferred and tokens are repo-scoped', async () => {
  const { createGitHubStore } = await api();
  for (const privateKey of [pkcs1.replace(/\n/g, '\\n'), pkcs8]) {
    const jwtSeen = [];
    const mock = fixture({ hook: call => {
      if (call.path.endsWith('/access_tokens') || call.path.endsWith('/installation')) jwtSeen.push(call.headers.Authorization.slice(7));
    } });
    const env = configuration({ GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_CLIENT_ID: 'Iv23.' + appSequence, GITHUB_APP_INSTALLATION_ID: '' });
    const users = createGitHubStore(env, { fetchImpl: mock.fetchImpl });
    assert.equal(await users.read('users/a/profile.json'), null);
    await users.read('users/a/profile.json');
    const data = createGitHubStore(env, { fetchImpl: mock.fetchImpl, repository: 'data' });
    await data.read('users/a/progress.json');
    assert.equal(mock.tokenCount, 2);
    for (const jwt of jwtSeen) {
      const [header, payload, signature] = jwt.split('.');
      assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(claims.iss, env.GITHUB_APP_CLIENT_ID);
      assert.ok(claims.exp - claims.iat <= 600);
      assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + payload), createPublicKey(key), Buffer.from(signature, 'base64url')));
    }
    assert.deepEqual(mock.calls.filter(call => call.path.endsWith('/access_tokens')).map(call => call.body), [
      { repositories: ['Brclio-Miniapp-UserData'], permissions: { contents: 'write' } },
      { repositories: ['Brclio-Miniapp-Data'], permissions: { contents: 'write' } }
    ]);
  }
});

test('invalid keys and upstream or transport failures never reveal submitted secrets', async () => {
  const { createGitHubStore } = await api();
  const forbidden = 'private-key-and-password-do-not-print';
  const invalid = createGitHubStore(configuration({ GITHUB_APP_PRIVATE_KEY: forbidden }), { fetchImpl: async () => { throw new Error(forbidden); } });
  await assert.rejects(invalid.read('users/a/profile.json'), error => {
    assert.equal(error.safeCode, 'store_configuration_invalid');
    assert.doesNotMatch(JSON.stringify(error) + error.stack, new RegExp(forbidden));
    return true;
  });
  for (const status of [403, 500]) {
    const mock = fixture({ hook: call => call.path.includes('/git/ref/') ? response({ message: forbidden, documentation_url: 'https://example.com/' + forbidden }, status) : null });
    const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
    await assert.rejects(store.read('users/a/profile.json'), error => {
      assert.equal(error.status, 503);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, new RegExp(forbidden));
      return true;
    });
  }
  const network = createGitHubStore(configuration(), { fetchImpl: async () => { throw new Error(forbidden); } });
  await assert.rejects(network.read('users/a/profile.json'), { safeCode: 'store_upstream_unavailable' });
});

test('empty repository reads have no writes and first transaction bootstraps then commits atomically', async () => {
  const { createGitHubStore } = await api();
  const mock = fixture({ empty: true });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  assert.equal(await store.read('users/a/profile.json'), null);
  assert.equal(mock.calls.some(call => call.method === 'PUT'), false);
  let attempts = 0;
  await store.transaction(async tx => {
    attempts += 1;
    assert.equal(await tx.get('users/a/profile.json'), null);
    tx.put('users/a/profile.json', { id: 'a' });
    tx.put('indexes/email/a.json', { userId: 'a' });
  });
  assert.equal(attempts, 2);
  assert.deepEqual(mock.versions.get(mock.head), {
    '.brclio-store.json': { schemaVersion: 1, repository: 'users' },
    'users/a/profile.json': { id: 'a' }, 'indexes/email/a.json': { userId: 'a' }
  });
  assert.equal(mock.calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(mock.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('a missing configured branch is surfaced instead of treating records as absent', async () => {
  const { createGitHubStore } = await api();
  const mock = fixture({ hook: call => call.path.includes('/git/ref/') ? response({}, 404) : null });
  const store = createGitHubStore(configuration({ GITHUB_USERDATA_BRANCH: 'records/main' }), { fetchImpl: mock.fetchImpl });
  await assert.rejects(store.read('users/a/profile.json'), { safeCode: 'store_branch_missing' });
  assert.equal(mock.calls.some(call => call.method === 'PUT'), false);
});

test('401 expires only the current credential scope and refreshes the installation token', async () => {
  const { createGitHubStore } = await api();
  let rejected = false;
  const mock = fixture({ hook: call => {
    if (call.path.includes('/git/ref/') && !rejected) { rejected = true; return response({}, 401); }
  } });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  assert.equal(await store.read('users/a/profile.json'), null);
  assert.equal(mock.tokenCount, 2);
});


test('private repository guard runs before records are read or written', async () => {
  const { createGitHubStore } = await api();
  const mock = fixture({ hook: call => /^\/repos\/BrclioData\/[^/]+$/.test(call.path) ? response({ private: false }) : null });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  await assert.rejects(store.transaction(tx => tx.put('users/a/profile.json', { id: 'a' })), { status: 503, safeCode: 'store_repository_not_private' });
  assert.equal(mock.calls.some(call => call.path.includes('/git/')), false);
  assert.equal(mock.calls.some(call => call.path.includes('/contents/')), false);
});

test('cached installation token cannot write after repository visibility changes', async () => {
  const { createGitHubStore } = await api();
  let isPrivate = true;
  const mock = fixture({ hook: call => /^\/repos\/BrclioData\/[^/]+$/.test(call.path) ? response({ private: isPrivate }) : null });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  assert.equal(await store.read('users/a/profile.json'), null);
  isPrivate = false;
  await assert.rejects(store.transaction(tx => tx.put('users/a/profile.json', { id: 'a' })), { safeCode: 'store_repository_not_private' });
  assert.equal(mock.calls.some(call => call.method === 'POST' && call.path.endsWith('/git/trees')), false);
});

test('GitHub redirect responses fail closed without forwarding an App credential', async () => {
  const { createGitHubStore } = await api();
  const mock = fixture({ hook: call => call.path.includes('/git/ref/') ? new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } }) : null });
  const store = createGitHubStore(configuration(), { fetchImpl: mock.fetchImpl });
  await assert.rejects(store.read('users/a/profile.json'), { status: 503 });
  assert.equal(mock.calls.filter(call => call.path.includes('/git/ref/')).length, 1);
  assert.equal(mock.calls.some(call => call.path.includes('/contents/')), false);
});
