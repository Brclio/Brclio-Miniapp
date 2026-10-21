const test = require('node:test');
const assert = require('node:assert/strict');
const load = import('../web/account-proxy.mjs');
const base = 'https://pocket.bornforthis.cn/api/account/';
const native = { 'X-Brclio-Client': 'native', 'Content-Type': 'application/json' };
test('fixed proxy forwards only allowed native account operations and strips cookies, origin and response cookies', async () => {
  const { proxyAccount } = await load;
  let call;
  const request = new Request(base + 'apps/miniapp/data', { method: 'PUT', headers: { ...native, Authorization: 'Bearer fixture-native-session-token', Cookie: 'should-not-forward', Origin: 'https://pocket.bornforthis.cn' }, body: JSON.stringify({ revision: 0, data: {} }) });
  const response = await proxyAccount(request, async (url, init) => { call = { url, init }; return Response.json({ userId: 'fixture' }, { headers: { 'Set-Cookie': 'never-forward' } }); });
  assert.equal(response.status, 200); assert.equal(call.url, 'https://tools.brclio.com/api/account/apps/miniapp/data');
  assert.equal(call.init.redirect, 'manual'); assert.equal(call.init.headers.Cookie, undefined); assert.equal(call.init.headers.Origin, undefined);
  assert.equal(call.init.headers.Authorization, 'Bearer fixture-native-session-token');
  assert.equal(response.headers.get('Set-Cookie'), null); assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('proxy rejects foreign origins, arbitrary routes, query strings, methods and cookie-mode requests before transport', async () => {
  const { proxyAccount } = await load;
  let calls = 0;
  for (const request of [
    new Request(base + 'login', { method: 'POST', headers: { ...native, Origin: 'https://evil.example' }, body: '{}' }),
    new Request(base + 'apps/other/data', { headers: native }),
    new Request(base + 'session?url=https://evil.example', { headers: native }),
    new Request(base + 'session', { method: 'DELETE', headers: native }),
    new Request(base + 'session', { headers: { Cookie: 'old-cookie' } })
  ]) assert.ok((await proxyAccount(request, async () => { calls++; })).status >= 400);
  assert.equal(calls, 0);
});
test('proxy refuses redirects, HTML, oversized bodies and malformed upstream JSON', async () => {
  const { proxyAccount } = await load;
  for (const upstream of [new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }), new Response('<html>'), new Response('{', { headers: { 'Content-Type': 'application/json' } }), Response.json({ value: 'x'.repeat(131073) })]) {
    const response = await proxyAccount(new Request(base + 'session', { headers: native }), async () => upstream);
    assert.equal(response.status, 502);
  }
  let calls = 0;
  const response = await proxyAccount(new Request(base + 'login', { method: 'POST', headers: native, body: JSON.stringify({ text: 'x'.repeat(131073) }) }), async () => { calls++; });
  assert.equal(response.status, 400); assert.equal(calls, 0);
});
