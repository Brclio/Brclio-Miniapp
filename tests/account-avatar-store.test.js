const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash } = require('node:crypto');
const images = require('./helpers/avatar-images.json');
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
const sha = value => createHash('sha1').update(value).digest('hex');
const USER = 'a'.repeat(32), ASSET = 'b'.repeat(32);
const DIRECTORY = 'users/v1/aa/' + USER + '/avatars/' + ASSET + '/';
let sequence = 1;
function mockGitHub({ conflict = false, failUpdate = false } = {}) {
  let head = sha('initial'), serial = 0, conflicted = false;
  const versions = new Map([[head, new Map([['keep.json', Buffer.from('{"keep":true}')]])]]), trees = new Map(), blobs = new Map(), calls = [];
  const json = (value, status = 200) => Response.json(value, { status });
  return {
    calls, get current() { return versions.get(head); },
    async fetchImpl(input, options) {
      assert.equal(options.redirect, 'manual');
      const url = new URL(input), path = url.pathname, body = options.body && JSON.parse(options.body);
      calls.push({ path, method: options.method, body });
      if (/^\/repos\/BrclioData\/[^/]+$/.test(path)) return json({ private: true });
      if (path === '/app/installations/7/access_tokens') return json({ token: 'test-only-binary-token', expires_at: new Date(Date.now() + 3600000).toISOString() }, 201);
      if (path.includes('/git/ref/heads/')) return json({ object: { type: 'commit', sha: head } });
      if (path.includes('/contents/')) {
        const bytes = versions.get(url.searchParams.get('ref'))?.get(decodeURIComponent(path.split('/contents/')[1]));
        return bytes ? json({ type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') }) : json({}, 404);
      }
      if (path.endsWith('/git/blobs')) {
        assert.equal(body.encoding, 'base64');
        const bytes = Buffer.from(body.content, 'base64'), id = sha(bytes);
        blobs.set(id, bytes);
        return json({ sha: id }, 201);
      }
      if (path.includes('/git/commits/') && options.method === 'GET') return json({ tree: { sha: sha('tree-' + path.split('/').at(-1)) } });
      if (path.endsWith('/git/trees')) {
        const base = [...versions.keys()].find(id => sha('tree-' + id) === body.base_tree);
        assert.ok(base);
        const files = new Map(versions.get(base));
        for (const entry of body.tree) {
          assert.equal(entry.type, 'blob');
          assert.equal(entry.mode, '100644');
          if (entry.sha === null) files.delete(entry.path);
          else files.set(entry.path, entry.content === undefined ? blobs.get(entry.sha) : Buffer.from(entry.content));
        }
        const id = sha('tree-' + ++serial);
        trees.set(id, files);
        return json({ sha: id }, 201);
      }
      if (path.endsWith('/git/commits') && options.method === 'POST') {
        const id = sha('commit-' + ++serial);
        versions.set(id, new Map(trees.get(body.tree)));
        return json({ sha: id }, 201);
      }
      if (path.includes('/git/refs/heads/') && options.method === 'PATCH') {
        assert.equal(body.force, false);
        if (failUpdate) return json({ message: 'private-upstream-message' }, 500);
        if (conflict && !conflicted) {
          conflicted = true;
          const files = new Map(versions.get(head));
          files.set('concurrent.json', Buffer.from('{"preserve":true}'));
          head = sha('concurrent'); versions.set(head, files);
          return json({}, 422);
        }
        head = body.sha;
        return json({ object: { sha: head } });
      }
      throw new Error('Unexpected GitHub test path: ' + path);
    }
  };
}
async function setup(options) {
  const { createGitHubStore } = await import('../web/account-store.mjs');
  const github = mockGitHub(options);
  const store = createGitHubStore({ GITHUB_APP_ID: String(800000 + sequence++), GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_INSTALLATION_ID: '7' }, { fetchImpl: github.fetchImpl });
  return { github, store };
}

test('binary uploads create exact base64 Git blobs and publish originals, display and profile in one atomic commit', async () => {
  const { github, store } = await setup();
  const original = Buffer.from(images['image/png'], 'base64'), display = Buffer.from(images['image/jpeg'], 'base64');
  await store.transaction(tx => {
    tx.putBinary(DIRECTORY + 'original.png', original);
    tx.putBinary(DIRECTORY + 'display.jpg', display);
    tx.put('users/v1/aa/' + USER + '/profile.json', { avatar: { type: 'custom', assetId: ASSET } });
  });
  assert.deepEqual(github.current.get(DIRECTORY + 'original.png'), original);
  assert.deepEqual(github.current.get(DIRECTORY + 'display.jpg'), display);
  assert.deepEqual(JSON.parse(github.current.get('keep.json')), { keep: true });
  assert.equal(github.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(github.calls.filter(call => call.path.endsWith('/git/blobs')).length, 2);
  const entries = github.calls.find(call => call.path.endsWith('/git/trees')).body.tree;
  assert.equal(entries.filter(entry => entry.path.includes('/avatars/')).every(entry => !Object.hasOwn(entry, 'content') && /^[a-f0-9]{40}$/.test(entry.sha)), true);
  assert.deepEqual(Buffer.from(await store.readBinary(DIRECTORY + 'display.jpg')), display);
  await assert.rejects(store.readBinary(DIRECTORY + 'original.png'), { safeCode: 'store_path_invalid' });
});

test('10 MiB original allowance is independent of JSON transaction limits and bounded per transaction', async () => {
  const { github, store } = await setup();
  const original = new Uint8Array(10 * 1024 * 1024); original.fill(129); original[100] = 0; original[1000] = 255;
  await store.transaction(tx => {
    tx.putBinary(DIRECTORY + 'original.png', original);
    tx.putBinary(DIRECTORY + 'display.jpg', Buffer.from(images['image/jpeg'], 'base64'));
    tx.put('users/v1/aa/' + USER + '/profile.json', { avatar: ASSET });
  });
  assert.deepEqual(github.current.get(DIRECTORY + 'original.png'), Buffer.from(original));
  const writes = github.calls.filter(call => call.method === 'PATCH').length;
  await assert.rejects(store.transaction(tx => {
    tx.putBinary(DIRECTORY + 'original.png', original);
    tx.putBinary(DIRECTORY.replace(ASSET, 'c'.repeat(32)) + 'original.png', original);
  }), { safeCode: 'store_transaction_too_large' });
  await assert.rejects(store.transaction(tx => tx.putBinary(DIRECTORY + 'original.png', new Uint8Array(10 * 1024 * 1024 + 1))), { safeCode: 'store_binary_too_large' });
  assert.equal(github.calls.filter(call => call.method === 'PATCH').length, writes);
});

test('binary conflict retries revalidate against current HEAD and preserve concurrent files', async () => {
  const { github, store } = await setup({ conflict: true });
  let attempts = 0;
  await store.transaction(async tx => {
    attempts += 1;
    assert.deepEqual(await tx.get('keep.json'), { keep: true });
    tx.putBinary(DIRECTORY + 'original.png', Buffer.from(images['image/png'], 'base64'));
    tx.putBinary(DIRECTORY + 'display.jpg', Buffer.from(images['image/jpeg'], 'base64'));
    tx.put('users/v1/aa/' + USER + '/profile.json', { avatar: ASSET });
  });
  assert.equal(attempts, 2);
  assert.deepEqual(JSON.parse(github.current.get('concurrent.json')), { preserve: true });
  assert.deepEqual(github.current.get(DIRECTORY + 'original.png'), Buffer.from(images['image/png'], 'base64'));
});

test('failed branch update does not expose orphaned blobs or partial avatar profile', async () => {
  const { github, store } = await setup({ failUpdate: true });
  await assert.rejects(store.transaction(tx => {
    tx.putBinary(DIRECTORY + 'original.png', Buffer.from(images['image/png'], 'base64'));
    tx.put('users/v1/aa/' + USER + '/profile.json', { avatar: ASSET });
  }), error => error.safeCode === 'store_upstream_unavailable' && !error.message.includes('private-upstream-message'));
  assert.deepEqual([...github.current.keys()], ['keep.json']);
});
