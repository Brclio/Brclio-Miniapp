const test = require('node:test');
const assert = require('node:assert/strict');

function blockNetwork(t) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('disabled account service must not access the network'); };
  t.after(() => { globalThis.fetch = original; });
  return () => calls;
}

test('account entry requires explicit server enablement and never forwards old credentials', async t => {
  const calls = blockNetwork(t);
  const { proxyAccount } = await import('../web/account-proxy.mjs');
  for (const [route, method] of [['session', 'GET'], ['register', 'POST'], ['login/password', 'POST'], ['login/email', 'POST'], ['login/wechat', 'POST'], ['logout', 'POST']]) {
    const response = await proxyAccount(new Request('https://pocket.bornforthis.cn/api/account/' + route, {
      method, headers: { Authorization: 'Bearer old-native-session', Cookie: 'old-session=private', 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{not-json' })
    }), {});
    assert.equal(response.status, 503);
    const value = await response.json();
    assert.equal(value.error, 'account_unavailable');
    assert.equal(JSON.stringify(value).includes('old-native-session'), false);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  for (const route of ['code', 'login', 'profile', 'password', 'apps/miniapp/data', 'unknown']) {
    const response = await proxyAccount(new Request('https://pocket.bornforthis.cn/api/account/' + route), {});
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'not_found');
  }
  assert.equal(calls(), 0);
});

test('Pages passes account environment to the handler while portal, projects and health remain available', async t => {
  const calls = blockNetwork(t);
  const { createPagesWorker } = await import('../web/pages-worker.mjs');
  const assets = [];
  let reads = 0;
  const env = {
    get ACCOUNT_ENABLED() { reads += 1; return 'false'; },
    ASSETS: { fetch(request) { assets.push(new URL(request.url).pathname); return new Response('unchanged asset'); } }
  };
  const worker = createPagesWorker({ activeProjectIds: ['firstsight', 'ready-go-duel', 'lingotiles'], version: '0.1.2' });
  const disabled = await worker.fetch(new Request('https://pocket.bornforthis.cn/api/account/session'), env);
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error, 'account_unavailable');
  assert.equal(reads, 1, 'the exact Pages environment must reach the account handler');
  for (const suffix of ['', '/', '/login', '/apps/miniapp/data', '/unknown?upstream=https://tools.brclio.com']) {
    const response = await worker.fetch(new Request('https://pocket.bornforthis.cn/api/account' + suffix), env);
    assert.equal(response.status, 404, suffix);
    assert.equal((await response.json()).error, 'not_found');
  }
  assert.equal(assets.length, 0);
  assert.equal(calls(), 0);
  for (const route of ['/', '/projects/firstsight/main.js', '/projects/ready-go-duel/main.js', '/projects/lingotiles/main.js']) {
    const response = await worker.fetch(new Request('https://pocket.bornforthis.cn' + route), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'unchanged asset');
  }
  assert.equal(assets.length, 4);
  const health = await worker.fetch(new Request('https://pocket.bornforthis.cn/api/health'), env);
  assert.deepEqual(await health.json(), { ok: true, service: 'brclio-pocket', version: '0.1.2', syncAvailable: false });
});
