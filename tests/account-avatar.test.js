const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const images = require('./helpers/avatar-images.json');
const BASE = 'https://pocket.bornforthis.cn/api/account';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const payload = (mimeType = 'image/png') => ({ original: { mimeType, data: images[mimeType] }, compressed: { mimeType: 'image/jpeg', data: images['image/jpeg'] } });

async function harness() {
  const { createAccountApi, accountInternals } = await import('../web/account-api.mjs');
  let files = new Map(), failBinary = false, serial = 0;
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: 'test-avatar-only-hmac-secret-with-32-characters', WECHAT_APP_ID: 'wx' + 'a'.repeat(16) };
  const handler = createAccountApi({
    now: () => 1792700000000,
    exchangeWeChat: async code => 'openid-for-' + code,
    storeFactory(_env, { repository }) {
      assert.equal(repository, 'users');
      return {
        async read(path) { return structuredClone(files.get(path) || null); },
        async readBinary(path) { return files.has(path) ? files.get(path).slice() : null; },
        async transaction(callback) {
          const draft = structuredClone(files);
          const answer = await callback({
            async get(path) { return structuredClone(draft.get(path) || null); },
            put(path, value) { draft.set(path, structuredClone(value)); },
            putBinary(path, value) { if (failBinary) throw new Error('private-upload-diagnostic'); draft.set(path, value.slice()); }
          });
          files = draft;
          return answer;
        }
      };
    }
  });
  async function call(route, { method = 'GET', body, token, url } = {}) {
    const response = await handler(new Request(url || BASE + route, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    const value = response.headers.get('Content-Type')?.startsWith('image/') ? new Uint8Array(await response.arrayBuffer()) : await response.json();
    return { status: response.status, headers: response.headers, value };
  }
  async function login(code = 'user-' + ++serial) {
    const result = await call('/login/wechat', { method: 'POST', body: { code } });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    return result.value;
  }
  return { call, login, handler, env, internals: accountInternals, get files() { return files; }, failBinary() { failBinary = true; } };
}

test('new accounts receive persisted builtin avatars; later logins retain user selection', async () => {
  const h = await harness(), session = await h.login('same');
  assert.ok(session.user.avatarId >= 1 && session.user.avatarId <= 1000);
  assert.equal(session.user.avatarType, 'builtin');
  assert.equal(session.user.avatarUrl, 'https://pocket.bornforthis.cn/avatars/' + String(session.user.avatarId).padStart(4, '0') + '.png?v=20261026');
  assert.equal((await h.login('same')).user.avatarId, session.user.avatarId);
  const result = await h.call('/avatar', { method: 'PUT', token: session.token, body: { builtinId: 1000 } });
  assert.equal(result.status, 200);
  assert.equal(result.value.user.avatarId, 1000);
  assert.equal((await h.login('same')).user.avatarId, 1000);
  const otherOrigin = await h.call('/session', { token: session.token, url: 'https://pocket.brclio.com/api/account/session' });
  assert.equal(otherOrigin.value.user.avatarUrl, 'https://pocket.brclio.com/avatars/1000.png?v=20261026');
});

test('legacy profiles migrate at authenticated refresh and login exactly once', async () => {
  const h = await harness(), session = await h.login('same');
  const path = h.internals.userPath(session.user.id, 'profile');
  const profile = h.files.get(path);
  delete profile.avatar;
  const result = await h.call('/session', { token: session.token });
  assert.equal(result.status, 200);
  assert.equal(result.value.user.avatarType, 'builtin');
  const selected = result.value.user.avatarId;
  assert.equal((await h.call('/session', { token: session.token })).value.user.avatarId, selected);
  delete h.files.get(path).avatar;
  const login = await h.login('same');
  assert.ok(login.user.avatarId >= 1 && login.user.avatarId <= 1000);
  assert.equal(h.files.get(path).avatar.id, login.user.avatarId);
});

test('custom uploads preserve exact original bytes for every supported raster type and expose only JPEG derivatives', async () => {
  for (const mimeType of Object.keys(images)) {
    const h = await harness(), session = await h.login();
    const result = await h.call('/avatar', { method: 'PUT', token: session.token, body: payload(mimeType) });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.user.avatarType, 'custom');
    assert.equal(result.value.user.avatarId, null);
    assert.deepEqual(Object.keys(result.value), ['user']);
    assert.doesNotMatch(JSON.stringify(result.value), /original|base64|sha256|BrclioData|github/);
    const profile = h.files.get(h.internals.userPath(session.user.id, 'profile'));
    const originalEntry = [...h.files].find(([path]) => path.includes('/avatars/' + profile.avatar.assetId + '/original.'));
    assert.ok(originalEntry);
    assert.deepEqual(Buffer.from(originalEntry[1]), Buffer.from(images[mimeType], 'base64'));
    assert.equal(profile.avatar.original.sha256, hash(originalEntry[1]));
    assert.equal(profile.avatar.original.mimeType, mimeType);
    const display = await h.call('', { url: result.value.user.avatarUrl });
    assert.equal(display.status, 200);
    assert.equal(display.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(display.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(display.headers.get('Cache-Control'), /immutable/);
    assert.deepEqual(Buffer.from(display.value), Buffer.from(images['image/jpeg'], 'base64'));
    const originalRoute = new URL(result.value.user.avatarUrl).pathname + '/original.png';
    assert.equal((await h.call('', { url: 'https://pocket.bornforthis.cn' + originalRoute })).status, 404);
  }
});

test('custom versions survive switching to builtin, while missing or inactive user images are denied', async () => {
  const h = await harness(), session = await h.login();
  const upload = await h.call('/avatar', { method: 'PUT', token: session.token, body: payload() });
  const avatarUrl = upload.value.user.avatarUrl;
  await h.call('/avatar', { method: 'PUT', token: session.token, body: { builtinId: 3 } });
  assert.equal((await h.call('', { url: avatarUrl })).status, 200);
  assert.equal((await h.call('/avatar/' + session.user.id + '/' + '0'.repeat(32))).status, 404);
  h.files.get(h.internals.userPath(session.user.id, 'profile')).status = 'inactive';
  assert.equal((await h.call('', { url: avatarUrl })).status, 404);
});

test('avatar updates require current ownership and reject selectors, malformed IDs, media and compression', async () => {
  const h = await harness(), session = await h.login(), other = await h.login();
  assert.equal((await h.call('/avatar', { method: 'PUT', body: payload() })).status, 401);
  for (const body of [{ builtinId: 0 }, { builtinId: 1001 }, { builtinId: 1.5 }, { builtinId: '1' }, { builtinId: 1, userId: other.user.id },
    { ...payload(), original: { mimeType: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') } },
    { ...payload(), original: { mimeType: 'image/jpeg', data: images['image/png'] } },
    { ...payload(), compressed: { mimeType: 'image/png', data: images['image/png'] } },
    { ...payload(), compressed: { mimeType: 'image/jpeg', data: '%%%%' } },
    { ...payload(), original: { ...payload().original, githubPath: 'untrusted' } }]) {
    const result = await h.call('/avatar', { method: 'PUT', token: session.token, body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  const dimensions = Buffer.from(images['image/jpeg'], 'base64');
  const frame = dimensions.indexOf(Buffer.from([255, 192]));
  dimensions.writeUInt16BE(257, frame + 7);
  assert.equal((await h.call('/avatar', { method: 'PUT', token: session.token, body: { ...payload(), compressed: { mimeType: 'image/jpeg', data: dimensions.toString('base64') } } })).status, 400);
  const otherProfile = h.files.get(h.internals.userPath(other.user.id, 'profile'));
  assert.equal(otherProfile.avatar.type, 'builtin');
  await h.call('/logout', { method: 'POST', token: session.token, body: {} });
  assert.equal((await h.call('/avatar', { method: 'PUT', token: session.token, body: { builtinId: 1 } })).status, 401);
});

test('size limits and failed binary writes leave the previous profile and assets intact', async () => {
  const h = await harness(), session = await h.login();
  const previous = structuredClone(h.files);
  const huge = { ...payload(), original: { mimeType: 'image/png', data: 'A'.repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 4) } };
  assert.equal((await h.call('/avatar', { method: 'PUT', token: session.token, body: huge })).status, 413);
  const hugeCompressed = { ...payload(), compressed: { mimeType: 'image/jpeg', data: 'A'.repeat(Math.ceil(128 * 1024 / 3) * 4 + 4) } };
  assert.equal((await h.call('/avatar', { method: 'PUT', token: session.token, body: hugeCompressed })).status, 413);
  h.failBinary();
  const result = await h.call('/avatar', { method: 'PUT', token: session.token, body: payload() });
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result.value), /private-upload-diagnostic/);
  assert.deepEqual(h.files, previous);
});

test('avatar changes enforce a bounded user write budget', async () => {
  const h = await harness(), session = await h.login();
  for (let id = 1; id <= 30; id += 1) assert.equal((await h.call('/avatar', { method: 'PUT', token: session.token, body: { builtinId: id } })).status, 200);
  const result = await h.call('/avatar', { method: 'PUT', token: session.token, body: { builtinId: 31 } });
  assert.equal(result.status, 429);
  assert.ok(result.value.retryAfter > 0);
  assert.equal(h.files.get(h.internals.userPath(session.user.id, 'profile')).avatar.id, 30);
});

test('invalid sessions and exhausted avatar budgets are rejected before reading an upload body', async () => {
  const h = await harness(), session = await h.login();
  let reads = 0;
  async function unreadBody(token) {
    const request = new Request(BASE + '/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: '{}' });
    Object.defineProperty(request, 'body', { get() { reads += 1; throw new Error('large-upload-body-must-not-be-read'); } });
    return h.handler(request, h.env);
  }
  const bogus = session.token.slice(0, -1) + (session.token.endsWith('0') ? '1' : '0');
  assert.equal((await unreadBody(bogus)).status, 401);
  assert.equal(reads, 0);
  await h.call('/avatar', { method: 'PUT', token: session.token, body: { builtinId: 10 } });
  const ratePath = [...h.files.keys()].find(path => path.startsWith('abuse/v1/avatar-user/'));
  h.files.get(ratePath).count = 30;
  // The preliminary rejection also must not commit unrelated migrations.
  delete h.files.get(h.internals.userPath(session.user.id, 'profile')).avatar;
  h.files.get(h.internals.userPath(session.user.id, 'sessions')).items.forEach(item => { item.expiresAt = 1; });
  const before = structuredClone(h.files);
  assert.equal((await unreadBody(session.token)).status, 429);
  assert.equal(reads, 0);
  assert.deepEqual(h.files, before);
});

test('an upload rechecks ownership if the session is revoked after its preliminary read', async () => {
  const h = await harness(), session = await h.login();
  const previousAvatar = structuredClone(h.files.get(h.internals.userPath(session.user.id, 'profile')).avatar);
  const request = new Request(BASE + '/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify(payload()) });
  const body = request.body;
  Object.defineProperty(request, 'body', { get() {
    // This point is reached only after the read-only session/budget check.
    h.files.get(h.internals.userPath(session.user.id, 'sessions')).items = [];
    return body;
  } });
  const response = await h.handler(request, h.env);
  assert.equal(response.status, 401);
  assert.deepEqual(h.files.get(h.internals.userPath(session.user.id, 'profile')).avatar, previousAvatar);
  assert.equal([...h.files.keys()].some(path => path.includes('/avatars/')), false);
});
