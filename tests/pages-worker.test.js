const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  for (const path of ['/projects/retired/', '/projects/retired/main.js', '/projects/firstsight%2fretired/', '/projects/constructor/', '/projects/', '/projects/firstsight/media/garden.jpg', '/projects/firstsight/media/coast.jpg']) {
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

test('only the imported FirstSight photos reach ASSETS even when it retains retired files', async () => {
  const { createPagesWorker } = await load;
  const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../web/projects/firstsight/original-data.json'), 'utf8'));
  const imported = source.assets.filter(function (asset) { return asset.available; }).map(function (asset) { return asset.url; });
  assert.equal(imported.length, 169);
  const calls = [];
  const env = { ASSETS: { fetch(request) { calls.push(new URL(request.url).pathname); return new Response('cached image'); } } };
  const worker = createPagesWorker({ activeProjectIds: ['firstsight'], firstsightAssetPaths: imported });
  for (const image of imported) {
    assert.equal((await worker.fetch(new Request('https://pocket.example' + image), env)).status, 200, image);
  }
  assert.deepEqual(calls, imported);
  const retired = '/projects/firstsight/assets/original/3d7f0d7e15610cd67b4c.jpg';
  for (const image of [retired, '/projects/firstsight/assets/original/00000000000000000000.webp', imported[0].replace(/\.webp$/, '.jpg'), retired.replace('/original/', '/%6friginal/'), retired.replace('/assets/', '/%61ssets/')]) {
    const response = await worker.fetch(new Request('https://pocket.example' + image), env);
    assert.equal(response.status, 404, image);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(calls.length, imported.length, 'Retired and undeclared images must be rejected before ASSETS');
});

test('FirstSight photo access fails closed when its build allowlist is absent', async () => {
  const { createPagesWorker } = await load;
  const worker = createPagesWorker({ activeProjectIds: ['firstsight'] });
  let calls = 0;
  const env = { ASSETS: { fetch() { calls += 1; return new Response('old photo'); } } };
  const response = await worker.fetch(new Request('https://pocket.example/projects/firstsight/assets/original/a6cea33d9101838313d3.webp'), env);
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(new Request('https://pocket.example/projects/firstsight/main.js'), env)).status, 200);
  assert.equal(calls, 1);
});
