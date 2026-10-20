const test = require('node:test');
const assert = require('node:assert/strict');
const load = import('../web/pages-worker.mjs');

test('single-project health identifies the release and storage remains disabled', async () => {
  const { createPagesWorker } = await load;
  const worker = createPagesWorker({ activeProjectIds: ['firstsight'], version: '0.1.1' });
  const response = await worker.fetch(new Request('https://pocket.example/api/health'), {});
  assert.deepEqual(await response.json(), { ok: true, service: 'brclio-pocket', version: '0.1.1', syncAvailable: false });
  for (const method of ['POST', 'GET', 'DELETE', 'OPTIONS']) {
    const closed = await worker.fetch(new Request('https://pocket.example/api/v1/history', { method }), {});
    assert.equal(closed.status, 503);
    assert.deepEqual(await closed.json(), { error: 'sync_unavailable' });
  }
});

test('inactive project paths cannot reach cached or static modules', async () => {
  const { createPagesWorker } = await load;
  let calls = 0;
  const env = { ASSETS: { fetch() { calls += 1; return new Response('asset'); } } };
  const worker = createPagesWorker({ activeProjectIds: ['firstsight'] });
  for (const path of ['/projects/retired/', '/projects/retired/main.js', '/projects/firstsight%2fretired/', '/projects/constructor/', '/projects/']) {
    const response = await worker.fetch(new Request('https://pocket.example' + path), env);
    assert.equal(response.status, 404, path);
  }
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(new Request('https://pocket.example/projects/firstsight/main.js'), env)).status, 200);
  assert.equal(calls, 1);
});

test('portal assets pass through while unknown APIs never proxy private storage', async () => {
  const { createPagesWorker } = await load;
  const paths = [];
  const env = { ASSETS: { fetch(request) { paths.push(new URL(request.url).pathname); return new Response('portal'); } } };
  const worker = createPagesWorker();
  for (const path of ['/', '/projects.json', '/jBK3p5zOBn.txt']) assert.equal((await worker.fetch(new Request('https://pocket.example' + path), env)).status, 200);
  assert.deepEqual(paths, ['/', '/projects.json', '/jBK3p5zOBn.txt']);
  assert.equal((await worker.fetch(new Request('https://pocket.example/api/anything'), env)).status, 404);
  assert.equal(paths.length, 3);
});
