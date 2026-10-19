'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { before } = require('node:test');
let createWorker;
before(async () => { ({ createWorker } = await import('../worker/index.mjs')); });

const ORIGIN = 'https://pocket.brclio.com';
const EXTRA_ORIGIN = 'https://pocket.bornforthis.cn';
const TIME = Date.UTC(2026, 9, 19, 8);
const match = (id = 'match-1', at = TIME - 1000) => ({ id, at, names: ['红方', '蓝方'], winner: 0, scores: [3, 1], bestMs: 231 });

function setup(overrides = {}) {
  let time = TIME;
  const files = new Map();
  const calls = [];
  const limits = [];
  const limiter = (name) => ({ async limit({ key }) { limits.push({ name, key }); return { success: true }; } });
  const env = { SYNC_ENABLED: 'true', GITHUB_TOKEN: 'server-only-secret-token', DATA_HMAC_KEY: 'test-only-signing-key-with-more-than-32-chars',
    GITHUB_OWNER: 'BrclioData', GITHUB_REPO: 'Brclio-Miniapp-Data', GITHUB_BRANCH: 'main', PUBLIC_ORIGIN: ORIGIN, EXTRA_ALLOWED_ORIGIN: EXTRA_ORIGIN,
    API_RATE_LIMITER: limiter('api'), SESSION_RATE_LIMITER: limiter('session'), WRITE_RATE_LIMITER: limiter('write'), ...overrides };
  const state = { beforeWrite: null, status: null, statusByMethod: {} };
  const worker = createWorker({ now: () => time, fetcher: async (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname.split('/contents/')[1];
    calls.push({ url, options, path });
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
    assert.equal(options.redirect, 'manual');
    assert.match(path, /^pocket\/v1\/devices\/[a-f0-9]{64}\.json$/);
    const errorStatus = state.statusByMethod[options.method] || state.status;
    if (errorStatus) return new Response('private upstream error with sensitive details', { status: errorStatus });
    if (options.method === 'GET') {
      const file = files.get(path);
      return file ? Response.json({ type: 'file', encoding: 'base64', sha: file.sha,
        content: Buffer.from(JSON.stringify(file.record)).toString('base64') }) : new Response(null, { status: 404 });
    }
    const body = JSON.parse(options.body);
    if (state.beforeWrite) { const callback = state.beforeWrite; state.beforeWrite = null; return new Response(null, { status: callback(path) || 409 }); }
    const existing = files.get(path);
    if (existing && body.sha !== existing.sha) return new Response(null, { status: 409 });
    if (!existing && body.sha) return new Response(null, { status: 409 });
    if (options.method === 'DELETE') { files.delete(path); return Response.json({ content: null }); }
    const record = JSON.parse(Buffer.from(body.content, 'base64').toString());
    files.set(path, { record, sha: String(files.size + calls.length).padStart(40, '0') });
    return Response.json({ content: { sha: files.get(path).sha } }, { status: existing ? 200 : 201 });
  } });
  const request = (path, { token, method = 'GET', body, headers = {}, origin = ORIGIN } = {}) => {
    const requestHeaders = { Origin: origin, 'CF-Connecting-IP': '192.0.2.1', ...headers };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: requestHeaders,
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }), env);
  };
  return { env, worker, request, files, calls, limits, state, advance(ms) { time += ms; },
    async session() { const response = await request('/api/v1/session', { method: 'POST', body: {} }); assert.equal(response.status, 201); return (await response.json()).token; } };
}

test('health exposes availability without credentials or storage identifiers', async () => {
  const s = setup();
  const response = await s.request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'brclio-pocket', syncAvailable: true });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(s.calls.length, 0);
});

test('sync fails closed when disabled, signing secret is short, or limits are missing', async () => {
  for (const values of [{ SYNC_ENABLED: 'false' }, { DATA_HMAC_KEY: 'short' }, { WRITE_RATE_LIMITER: null }]) {
    const s = setup(values);
    assert.equal((await s.request('/api/v1/session', { method: 'POST', body: {} })).status, 503);
    assert.equal(s.calls.length, 0);
  }
});

test('session is high entropy, HMAC signed, scoped to a single device, and creates no files', async () => {
  const s = setup();
  const token = await s.session();
  const other = await s.session();
  assert.match(token, /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, other);
  assert.equal(s.files.size, 0);
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  const otherResponse = await s.request('/api/v1/history', { token: other });
  assert.deepEqual(await otherResponse.json(), { matches: [], updatedAt: null });
  const savedPath = s.calls[0].path;
  assert.ok(!savedPath.includes(token.split('.')[1]));
  assert.ok(s.limits.every(({ key }) => !key.includes('192.0.2.1')));
});

test('unapproved origin, originless, and workers.dev browser calls cannot access sync', async () => {
  const s = setup();
  assert.equal((await s.request('/api/v1/session', { method: 'POST', body: {}, origin: 'https://other.example' })).status, 403);
  assert.equal((await s.worker.fetch(new Request(`${ORIGIN}/api/v1/history`), s.env)).status, 403);
  assert.equal((await s.worker.fetch(new Request('https://preview.workers.dev/api/v1/history', { headers: { Origin: 'https://preview.workers.dev' } }), s.env)).status, 403);
  assert.equal(s.calls.length, 0);
});

test('same origin browser GET may use Referer when the browser omits Origin', async () => {
  const s = setup();
  const token = await s.session();
  const response = await s.worker.fetch(new Request(`${ORIGIN}/api/v1/history`, {
    headers: { Authorization: `Bearer ${token}`, Referer: `${ORIGIN}/` }
  }), s.env);
  assert.equal(response.status, 200);
});

test('missing, forged, or altered session tokens never reach private storage', async () => {
  const s = setup();
  const token = await s.session();
  for (const invalid of [null, 'v1.forged', token.replace('v1.', 'v1.a'), `${token.slice(0, 5)}x${token.slice(6)}`]) {
    const response = await s.request('/api/v1/history', { token: invalid });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'invalid_session' });
  }
  assert.equal(s.calls.length, 0);
});

test('saves canonical history in private repo then returns only permitted match data', async () => {
  const s = setup();
  const token = await s.session();
  const response = await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [{ ...match(), path: '../secret', extra: 'drop' }] } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { matches: [match()], updatedAt: TIME });
  const stored = Array.from(s.files.values())[0].record;
  assert.deepEqual(stored, { version: 1, updatedAt: TIME, matches: [match()] });
  assert.ok(!JSON.stringify(stored).includes(token));
  assert.ok(!JSON.stringify(stored).includes('secret-token'));
  const get = await s.request('/api/v1/history', { token });
  assert.deepEqual(await get.json(), { matches: [match()], updatedAt: TIME });
});

test('invalid scores, timestamps, names and duplicate IDs are rejected before GitHub', async () => {
  const s = setup();
  const token = await s.session();
  const invalid = [
    [{ ...match(), scores: [9, 0] }], [{ ...match(), scores: [3, 3] }], [{ ...match(), winner: 1 }],
    [{ ...match(), at: TIME + 600000 }], [{ ...match(), bestMs: -1 }], [{ ...match(), names: ['', 'B'] }],
    [{ ...match(), id: '../../secrets' }], [match(), match()], Array.from({ length: 21 }, (_, i) => match(`x${i}`))
  ];
  for (const matches of invalid) {
    assert.equal((await s.request('/api/v1/history', { token, method: 'POST', body: { matches } })).status, 400);
  }
  assert.equal(s.calls.length, 0);
});

test('body size, malformed JSON and unexpected fields are rejected', async () => {
  const s = setup();
  const token = await s.session();
  assert.equal((await s.request('/api/v1/history', { token, method: 'POST', body: ' '.repeat(8193) })).status, 413);
  assert.equal((await s.request('/api/v1/history', { token, method: 'POST', body: '{' })).status, 400);
  assert.equal((await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [], path: '../private' } })).status, 400);
  const noType = await s.worker.fetch(new Request(`${ORIGIN}/api/v1/history`, {
    method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` }, body: '{}'
  }), s.env);
  assert.equal(noType.status, 415);
  assert.equal(s.calls.length, 0);
});

test('read and write rate limits reject requests before GitHub use', async () => {
  const s = setup();
  const token = await s.session();
  s.env.WRITE_RATE_LIMITER = { limit: async () => ({ success: false }) };
  const response = await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(s.calls.length, 0);
  s.env.API_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await s.request('/api/v1/history', { token })).status, 429);
  assert.equal(s.calls.length, 0);
});

test('idempotent retries do not add commits and an existing match cannot be edited', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  const retry = await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [{ ...match(), bestMs: 1 }] } });
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).matches, [match()]);
  assert.equal(s.calls.filter(({ options }) => options.method === 'PUT').length, 1);
  assert.equal((await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match('match-2')] } })).status, 429);
});

test('merges history, orders newest first and caps to 20 recent matches', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: Array.from({ length: 20 }, (_, i) => match(`old-${i}`, TIME - 30000 - i)) } });
  s.advance(11000);
  const result = await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match('new')] } });
  const record = await result.json();
  assert.equal(result.status, 200);
  assert.equal(record.matches.length, 20);
  assert.equal(record.matches[0].id, 'new');
  assert.ok(!record.matches.some(({ id }) => id === 'old-19'));
});

test('GitHub SHA conflicts retry with latest data instead of losing another write', async () => {
  const s = setup();
  const token = await s.session();
  s.state.beforeWrite = (path) => {
    s.files.set(path, { sha: 'a'.repeat(40), record: { version: 1, updatedAt: TIME - 20000, matches: [match('concurrent', TIME - 20000)] } });
  };
  const response = await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).matches.map(({ id }) => id), ['match-1', 'concurrent']);
  assert.equal(s.calls.filter(({ options }) => options.method === 'PUT').length, 2);
});

test('upstream failures expose no repository content, tokens, or error text', async () => {
  const s = setup();
  const token = await s.session();
  s.state.status = 403;
  const response = await s.request('/api/v1/history', { token });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'storage_unavailable' });
});

test('GitHub redirects fail closed instead of forwarding its bearer or exposing a redirect', async () => {
  const s = setup();
  const token = await s.session();
  s.state.statusByMethod.GET = 302;
  const read = await s.request('/api/v1/history', { token });
  assert.equal(read.status, 503);
  assert.deepEqual(await read.json(), { error: 'storage_unavailable' });
  assert.equal(read.headers.get('Location'), null);
  delete s.state.statusByMethod.GET;
  s.state.statusByMethod.PUT = 307;
  const write = await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  assert.equal(write.status, 503);
  assert.deepEqual(await write.json(), { error: 'storage_unavailable' });
  assert.equal(s.files.size, 0);
  delete s.state.statusByMethod.PUT;
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  s.state.statusByMethod.DELETE = 301;
  const remove = await s.request('/api/v1/history', { token, method: 'DELETE' });
  assert.equal(remove.status, 503);
  assert.deepEqual(await remove.json(), { error: 'storage_unavailable' });
  assert.equal(s.files.size, 1);
  assert.ok(s.calls.every(({ url, options }) => new URL(url).origin === 'https://api.github.com' && options.redirect === 'manual'));
});

test('corrupt private data fails safely instead of being overwritten', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  const file = Array.from(s.files.values())[0];
  file.record = { unrelatedPrivateDocument: 'never expose' };
  const response = await s.request('/api/v1/history', { token });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'storage_unavailable' });
});

test('unknown API routes never proxy arbitrary repository files and assets use only ASSETS', async () => {
  const s = setup({ ASSETS: { fetch: async () => new Response('static content') } });
  assert.equal((await s.request('/api/v1/history/../../private')).status, 404);
  assert.equal((await s.request('/api/repos/private')).status, 404);
  assert.equal(await (await s.request('/wechat/verification.txt')).text(), 'static content');
  assert.equal(s.calls.length, 0);
});

test('deletes only the current device history and repeated deletion is idempotent', async () => {
  const s = setup();
  const token = await s.session();
  const other = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  await s.request('/api/v1/history', { token: other, method: 'POST', body: { matches: [match('other')] } });
  const response = await s.request('/api/v1/history', { token, method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(s.files.size, 1);
  assert.deepEqual((await (await s.request('/api/v1/history', { token: other })).json()).matches, [match('other')]);
  assert.equal((await s.request('/api/v1/history', { token, method: 'DELETE' })).status, 200);
  assert.equal(s.calls.filter(({ options }) => options.method === 'DELETE').length, 1);
  assert.deepEqual(await (await s.request('/api/v1/history', { token })).json(), { matches: [], updatedAt: null });
});

test('delete requires valid capability, allowed origin, and available write budget', async () => {
  const s = setup();
  const token = await s.session();
  assert.equal((await s.request('/api/v1/history', { method: 'DELETE' })).status, 401);
  assert.equal((await s.request('/api/v1/history', { token, method: 'DELETE', origin: 'https://evil.example' })).status, 403);
  s.env.WRITE_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await s.request('/api/v1/history', { token, method: 'DELETE' })).status, 429);
  assert.equal(s.calls.length, 0);
});

test('delete retries SHA conflicts and removes the latest current record', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  s.state.beforeWrite = (path) => { s.files.get(path).sha = 'b'.repeat(40); };
  const response = await s.request('/api/v1/history', { token, method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.equal(s.files.size, 0);
  assert.equal(s.calls.filter(({ options }) => options.method === 'DELETE').length, 2);
});

test('delete handles upstream errors without claiming deletion or exposing private details', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  s.state.statusByMethod.DELETE = 403;
  const response = await s.request('/api/v1/history', { token, method: 'DELETE' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'storage_unavailable' });
  assert.equal(s.files.size, 1);
});

test('delete returns success if another request removes the file between read and delete', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  s.state.beforeWrite = (path) => { s.files.delete(path); return 404; };
  const response = await s.request('/api/v1/history', { token, method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(s.files.size, 0);
});

test('delete stops after three conflicts and reports failure without losing the saved file', async () => {
  const s = setup();
  const token = await s.session();
  await s.request('/api/v1/history', { token, method: 'POST', body: { matches: [match()] } });
  function conflict(path) { s.files.get(path).sha = 'c'.repeat(40); s.state.beforeWrite = conflict; }
  s.state.beforeWrite = conflict;
  const response = await s.request('/api/v1/history', { token, method: 'DELETE' });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'sync_conflict' });
  assert.equal(s.calls.filter(({ options }) => options.method === 'DELETE').length, 3);
  assert.equal(s.files.size, 1);
});

test('only the two exact approved HTTPS origins receive credential-free CORS responses', async () => {
  const s = setup();
  for (const origin of [ORIGIN, EXTRA_ORIGIN]) {
    const response = await s.request('/api/v1/session', { method: 'POST', body: {}, origin });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
    assert.equal(response.headers.get('Vary'), 'Origin');
  }
  for (const origin of ['https://evil.example', `${EXTRA_ORIGIN}.evil.example`, 'http://pocket.bornforthis.cn', 'null']) {
    const response = await s.request('/api/v1/session', { method: 'POST', body: {}, origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(s.calls.length, 0);
});

test('approved alias can use the API hosted at the public origin', async () => {
  const s = setup();
  const issued = await s.request('/api/v1/session', { method: 'POST', body: {}, origin: EXTRA_ORIGIN });
  const token = (await issued.json()).token;
  const saved = await s.request('/api/v1/history', { token, origin: EXTRA_ORIGIN, method: 'POST', body: { matches: [match()] } });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('Access-Control-Allow-Origin'), EXTRA_ORIGIN);
  const restored = await s.request('/api/v1/history', { token, origin: EXTRA_ORIGIN });
  assert.deepEqual((await restored.json()).matches, [match()]);
  const deleted = await s.request('/api/v1/history', { token, origin: EXTRA_ORIGIN, method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.headers.get('Access-Control-Allow-Origin'), EXTRA_ORIGIN);
});

test('approved cross-origin preflight allows only the advertised methods and headers', async () => {
  const s = setup();
  const response = await s.request('/api/v1/history', { method: 'OPTIONS', origin: EXTRA_ORIGIN, headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type'
  } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), EXTRA_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, POST, DELETE, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
  assert.equal(response.headers.get('Vary'), 'Origin');
  assert.equal(s.calls.length, 0);
  assert.equal(s.limits.length, 0);
});

test('unapproved preflight origin and methods or headers cannot expand the CORS policy', async () => {
  const s = setup();
  const denied = await s.request('/api/v1/history', { method: 'OPTIONS', origin: 'https://evil.example', headers: { 'Access-Control-Request-Method': 'GET' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  for (const headers of [
    { 'Access-Control-Request-Method': 'PUT' },
    { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-arbitrary-header' }
  ]) {
    const response = await s.request('/api/v1/history', { method: 'OPTIONS', origin: EXTRA_ORIGIN, headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), null);
  }
});

test('wildcard, HTTP, path, or slash origins cannot be configured as approved origins', async () => {
  for (const invalid of ['*', 'http://pocket.bornforthis.cn', `${EXTRA_ORIGIN}/`, `${EXTRA_ORIGIN}/path`]) {
    const s = setup({ EXTRA_ALLOWED_ORIGIN: invalid });
    const response = await s.request('/api/v1/session', { method: 'POST', body: {} });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(s.calls.length, 0);
  }
});
