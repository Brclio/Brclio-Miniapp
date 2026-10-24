'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountClient, STORAGE_KEY } = require('../miniprogram/lib/account');
const NURSERY_KEY = 'brclio.nursery-favorites.v1';
const VERSION_HEADER = 'X-Brclio-Sync-Version';
const ORIGIN = 'https://pocket.bornforthis.cn';
const NOW = Date.parse('2026-10-24T02:00:00Z');

async function harness() {
  const { createAccountApi } = await import('../web/account-api.mjs');
  const stores = { users: new Map(), data: new Map() }, values = new Map(), calls = [];
  const env = { ACCOUNT_ENABLED: 'true', ACCOUNT_HMAC_SECRET: 'test-only-sync-compatibility-secret-with-32-characters' };
  const api = createAccountApi({ now: () => NOW, exchangeWeChat: async () => 'openid-sync-compatibility',
    storeFactory(_env, { repository }) {
      const state = stores[repository];
      return {
        async read(path) { return structuredClone(state.get(path) || null); },
        async transaction(callback) {
          const draft = structuredClone(state);
          const result = await callback({ async get(path) { return structuredClone(draft.get(path) || null); }, put(path, value) { draft.set(path, structuredClone(value)); }, delete(path) { draft.delete(path); } });
          state.clear(); for (const [path, value] of draft) state.set(path, value);
          return result;
        }
      };
    }
  });
  const wx = {
    getStorageSync: key => structuredClone(values.get(key)), setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key),
    login(request) { request.success({ code: 'test-only-wechat-code' }); },
    request(request) {
      calls.push(request);
      void api(new Request(request.url, { method: request.method, headers: request.header,
        ...(request.data === undefined ? {} : { body: JSON.stringify(request.data) }) }), env)
        .then(async response => request.success({ statusCode: response.status, data: await response.json() }), request.fail);
    }
  };
  const client = createAccountClient({ wx, config: { webOrigin: ORIGIN }, now: () => NOW });
  await client.loginWechat();
  async function call(method, body, version, route = '/sync') {
    const token = values.get(STORAGE_KEY).token;
    const response = await api(new Request(ORIGIN + '/api/account' + route, { method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(version === undefined ? {} : { [VERSION_HEADER]: version }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    return { status: response.status, body: await response.json() };
  }
  return { client, call, calls, stores, api, env };
}

test('new sync clients advertise version 2 while legacy GET and PUT preserve a compatible view and all stored nursery data', async () => {
  const h = await harness();
  const nursery = { value: { favorites: ['1451390672'] }, updatedAt: NOW };
  const initial = await h.client.writeSync({ revision: 0, entries: { [NURSERY_KEY]: nursery, RGD_MAX_WAIT: { value: 8, updatedAt: NOW } } });
  assert.equal(initial.revision, 1); assert.deepEqual(initial.entries[NURSERY_KEY], nursery);
  assert.equal(h.calls.at(-1).header[VERSION_HEADER], '2');
  assert.equal(h.calls[0].header[VERSION_HEADER], undefined, 'authentication does not send sync capabilities');
  await h.client.readSync(); assert.equal(h.calls.at(-1).header[VERSION_HEADER], '2');
  assert.match(h.calls.at(-1).header.Authorization, /^Bearer /);
  assert.equal(h.calls.at(-1).header['Content-Type'], 'application/json');
  assert.equal(new URL(h.calls.at(-1).url).search, '');

  const old = await h.call('GET');
  assert.equal(old.status, 200);
  assert.deepEqual(old.body, { revision: 1, entries: { RGD_MAX_WAIT: initial.entries.RGD_MAX_WAIT } });
  const write = await h.call('PUT', { revision: old.body.revision, entries: { RGD_SOUND_ENABLED: { value: false, updatedAt: NOW } } });
  assert.equal(write.status, 200); assert.equal(write.body.revision, 2);
  assert.equal(write.body.entries[NURSERY_KEY], undefined);
  assert.equal(write.body.entries.RGD_SOUND_ENABLED.value, false);
  const after = await h.client.readSync();
  assert.equal(after.revision, 2); assert.deepEqual(after.entries[NURSERY_KEY], nursery);
  assert.equal(after.entries.RGD_SOUND_ENABLED.value, false);
  const stored = [...h.stores.data.values()][0];
  assert.deepEqual(stored.entries[NURSERY_KEY], nursery);
  const noop = await h.call('PUT', { revision: 2, entries: {} });
  assert.equal(noop.body.revision, 2); assert.equal(noop.body.entries[NURSERY_KEY], undefined);
});

test('legacy sync retries use the shared revision and cannot overwrite or delete hidden nursery keys', async () => {
  const h = await harness();
  await h.client.writeSync({ revision: 0, entries: { [NURSERY_KEY]: { value: { favorites: ['1451390672'] }, updatedAt: NOW } } });
  const old = await h.call('GET');
  await h.client.writeSync({ revision: 1, entries: { [NURSERY_KEY]: { value: { favorites: ['2079653665'] }, updatedAt: NOW + 1 } } });
  const stale = await h.call('PUT', { revision: old.body.revision, entries: { RGD_MAX_WAIT: { value: 7, updatedAt: NOW } } });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'sync_conflict');
  const current = await h.call('GET');
  assert.equal(current.body.revision, 2); assert.deepEqual(current.body.entries, {});
  const retried = await h.call('PUT', { revision: 2, entries: { RGD_MAX_WAIT: { value: 7, updatedAt: NOW } } });
  assert.equal(retried.status, 200); assert.equal(retried.body.revision, 3);
  const modern = await h.call('GET', undefined, '2');
  assert.deepEqual(modern.body.entries[NURSERY_KEY].value.favorites, ['2079653665']);
  assert.equal(modern.body.entries.RGD_MAX_WAIT.value, 7);
  for (const version of ['1', '3', 'unknown']) {
    const response = await h.call('GET', undefined, version);
    assert.equal(response.body.revision, 3); assert.equal(response.body.entries[NURSERY_KEY], undefined);
  }
  assert.equal((await h.call('GET', undefined, '2', '/sync?version=2')).status, 404);
});

test('sync capability CORS preflight permits the version header and retains origin and auth protections', async () => {
  const h = await harness();
  const response = await h.api(new Request(ORIGIN + '/api/account/sync', { method: 'OPTIONS', headers: {
    Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization, content-type, x-brclio-sync-version'
  } }), h.env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const allowed = response.headers.get('Access-Control-Allow-Headers').toLowerCase().split(',').map(value => value.trim());
  assert.deepEqual(allowed, ['authorization', 'content-type', 'x-brclio-sync-version']);
  const denied = await h.api(new Request(ORIGIN + '/api/account/sync', { headers: { [VERSION_HEADER]: '2' } }), h.env);
  assert.equal(denied.status, 401);
  const foreign = await h.api(new Request(ORIGIN + '/api/account/sync', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', [VERSION_HEADER]: '2' } }), h.env);
  assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
});
