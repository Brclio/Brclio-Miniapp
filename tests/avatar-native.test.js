'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAccountClient, STORAGE_KEY } = require('../miniprogram/lib/account');
const { prepareNativeAvatar, ORIGINAL_LIMIT } = require('../miniprogram/lib/avatar-upload');
const catalog = require('../miniprogram/lib/avatar-catalog');
const imageFixtures = require('./helpers/avatar-images.json');
const USER = { id: 'avatar-user', username: 'brclio', avatarId: 8, avatarType: 'builtin', avatarUrl: 'https://miniapp.example.com/avatars/0008.png' };
function clientHost() {
  const storage = new Map([[STORAGE_KEY, { user: USER, token: 'old-token', expiresAt: null }]]), requests = [];
  const api = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), request(value) { requests.push(value); } };
  return { client: createAccountClient({ wx: api, config: { webOrigin: 'https://miniapp.example.com' } }), storage, requests };
}
function respond(request, body, statusCode = 200) { request.success({ statusCode, data: body }); }

test('avatar changes preserve the bearer session, expose only safe profile fields and update cached UI state', async () => {
  const h = clientHost(), events = []; h.client.subscribe(event => events.push(event));
  const update = h.client.setBuiltinAvatar(1000);
  assert.equal(h.requests[0].url, 'https://miniapp.example.com/api/account/avatar');
  assert.equal(h.requests[0].method, 'PUT'); assert.equal(h.requests[0].header.Authorization, 'Bearer old-token');
  assert.deepEqual(h.requests[0].data, { builtinId: 1000 });
  respond(h.requests[0], { user: { ...USER, avatarId: 1000, avatarUrl: 'https://miniapp.example.com/avatars/1000.png', password: 'secret', originalPath: 'private' } });
  const saved = await update;
  assert.equal(saved.user.avatarId, 1000); assert.equal(h.storage.get(STORAGE_KEY).token, 'old-token');
  assert.equal(saved.expiresAt, null); assert.equal(events[0].reason, 'avatar');
  assert.equal(JSON.stringify(saved).includes('secret'), false); assert.equal(JSON.stringify(saved).includes('originalPath'), false);
  await assert.rejects(h.client.setBuiltinAvatar(1001), error => error.code === 'invalid_avatar');
  assert.equal(h.requests.length, 1);
});

test('a delayed profile refresh cannot overwrite a newly saved avatar', async () => {
  const h = clientHost(), refresh = h.client.refreshSession(), update = h.client.setBuiltinAvatar(42);
  respond(h.requests[1], { user: { ...USER, avatarId: 42 } }); await update;
  respond(h.requests[0], { user: USER, expiresAt: null });
  assert.equal((await refresh).user.avatarId, 42); assert.equal(h.client.getCachedUser().avatarId, 42);
});

test('avatar failures and logout or account changes never replace the active avatar or resurrect the old session', async () => {
  const h = clientHost();
  const failed = h.client.uploadAvatar({ original: { mimeType: 'image/png', data: 'original' }, compressed: { mimeType: 'image/jpeg', data: 'compressed' } });
  respond(h.requests[0], { error: 'store_upstream_unavailable', message: '请稍后重试。' }, 503);
  await assert.rejects(failed); assert.equal(h.client.getCachedUser().avatarId, 8);
  const update = h.client.setBuiltinAvatar(42), logout = h.client.logout();
  respond(h.requests[2], { ok: true }); await logout;
  respond(h.requests[1], { user: { ...USER, avatarId: 42 } });
  await assert.rejects(update, error => error.code === 'operation_canceled'); assert.equal(h.client.getCachedUser(), null);
  const g = clientHost(), pending = g.client.setBuiltinAvatar(42), login = g.client.loginPassword('other', 'password');
  respond(g.requests[1], { user: { ...USER, id: 'other-user' }, token: 'other-token', expiresAt: null }); await login;
  respond(g.requests[0], { user: { ...USER, avatarId: 42 } });
  await assert.rejects(pending, error => error.code === 'operation_canceled'); assert.equal(g.client.getCachedUser().id, 'other-user');
});

function imageHost(options = {}) {
  const calls = [], original = options.original || imageFixtures['image/png'], jpeg = Buffer.from('jpeg-derivative').toString('base64');
  const drawing = { fillRect(...args) { calls.push(['fill', ...args]); }, drawImage(...args) { calls.push(['draw', ...args.slice(1)]); } };
  const canvas = { getContext: () => drawing, createImage() {
    const image = { width: 400, height: 800 };
    Object.defineProperty(image, 'src', { set(value) { calls.push(['image', value]); queueMicrotask(() => image.onload()); } });
    return image;
  } };
  const fileSystem = { readFile(value) { calls.push(['read', value.filePath]); value.success({ data: value.filePath === 'source.png' ? original : jpeg }); }, unlink(value) { calls.push(['unlink', value.filePath]); } };
  const api = {
    chooseMedia(value) { calls.push(['choose', value]); value.success({ tempFiles: [{ tempFilePath: 'source.png', size: options.size || 100 }] }); },
    getImageInfo(value) { value.success({ type: 'png', width: 400, height: 800 }); },
    getFileSystemManager: () => fileSystem,
    canvasToTempFilePath(value, page) { calls.push(['export', value, page]); value.success({ tempFilePath: 'display.jpg' }); },
    ...options.api
  };
  const page = { createSelectorQuery() { return { select() { return this; }, fields() { return this; }, exec(callback) { callback([{ node: canvas }]); } }; } };
  return { calls, page, api, original, jpeg };
}

test('native custom upload reads exact original bytes and creates a separate centered JPEG256 derivative', async () => {
  const h = imageHost(), result = await prepareNativeAvatar(h.page, h.api);
  assert.deepEqual(result.original, { mimeType: 'image/png', data: h.original });
  assert.deepEqual(result.compressed, { mimeType: 'image/jpeg', data: h.jpeg });
  assert.deepEqual(h.calls[0][1].sizeType, ['original']); assert.deepEqual(h.calls[0][1].sourceType, ['album']);
  assert.deepEqual(h.calls.find(call => call[0] === 'draw').slice(1), [0, 200, 400, 400, 0, 0, 256, 256]);
  const output = h.calls.find(call => call[0] === 'export');
  assert.equal(output[1].fileType, 'jpg'); assert.equal(output[1].destWidth, 256); assert.equal(output[1].destHeight, 256);
  assert.equal(output[2], h.page); assert.deepEqual(h.calls.at(-1), ['unlink', 'display.jpg']);
});

test('native source signatures support unknown WebP metadata and preserve all supported original formats', async () => {
  for (const [mimeType, original] of Object.entries(imageFixtures)) {
    const type = mimeType === 'image/webp' ? 'unknown' : mimeType.slice('image/'.length);
    const h = imageHost({ original, api: { getImageInfo(value) { value.success({ type, width: 400, height: 800 }); } } });
    const result = await prepareNativeAvatar(h.page, h.api);
    assert.deepEqual(result.original, { mimeType, data: original });
    assert.ok(h.calls.some(call => call[0] === 'export'));
  }
});

test('native invalid and spoofed source signatures are rejected before decoding or exporting a display image', async () => {
  for (const original of [Buffer.from('not-a-png-file').toString('base64'), imageFixtures['image/jpeg']]) {
    const h = imageHost({ original }); // Platform metadata claims PNG in both cases.
    await assert.rejects(prepareNativeAvatar(h.page, h.api), error => error.code === 'invalid_avatar');
    assert.equal(h.calls.some(call => call[0] === 'image' || call[0] === 'export'), false);
  }
});

test('native image cancellation, oversize selection and account changes abort before source transmission', async () => {
  const canceled = imageHost({ api: { chooseMedia(value) { value.fail({ errMsg: 'chooseMedia:fail cancel' }); } } });
  await assert.rejects(prepareNativeAvatar(canceled.page, canceled.api), error => error.code === 'avatar_canceled');
  const huge = imageHost({ size: ORIGINAL_LIMIT + 1 });
  await assert.rejects(prepareNativeAvatar(huge.page, huge.api), error => error.code === 'avatar_too_large');
  assert.equal(huge.calls.some(call => call[0] === 'read'), false);
  const stale = imageHost();
  await assert.rejects(prepareNativeAvatar(stale.page, stale.api, () => false), error => error.code === 'operation_canceled');
  assert.equal(stale.calls.some(call => call[0] === 'read'), false);
});

function pageHost(options = {}) {
  let definition, cached = { ...USER }, uploads = 0;
  const account = { getCachedUser: () => cached, normalizeEmail: value => value,
    async refreshSession() { return { user: cached }; },
    async setBuiltinAvatar(id) { cached = { ...cached, avatarId: id, avatarType: 'builtin' }; return { user: cached }; },
    async uploadAvatar(payload) { uploads += 1; return options.upload ? options.upload(payload) : { user: cached }; }
  };
  const sync = { getStatus: () => ({ state: 'idle' }), subscribe: () => () => {}, onHide() {}, onShow() {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/account/index.js'), 'utf8'), {
    Page(value) { definition = value; }, require(id) { return id.endsWith('account-sync') ? sync : id.endsWith('avatar-catalog') ? catalog : id.endsWith('avatar-upload') ? { prepareNativeAvatar: options.prepare || (() => Promise.resolve({ original: {}, compressed: {} })) } : id.endsWith('config') ? { webOrigin: 'https://miniapp.example.com' } : account; },
    wx: {}, clearInterval() {}, setInterval() {}
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  page.onLoad({}); page.applyUser(cached);
  return { page, account, setUser(value) { cached = value; }, get uploads() { return uploads; } };
}

test('native picker pages through all 1000 remote assets and applies a saved selection', async () => {
  const h = pageHost(), p = h.page; p.openAvatars();
  assert.equal(p.data.avatarItems.length, 40); assert.equal(p.data.avatarItems[0].id, 1);
  p.showAvatarPage(24); assert.equal(p.data.avatarItems.at(-1).id, 1000);
  assert.equal(p.data.avatarItems.at(-1).url, 'https://miniapp.example.com/avatars/1000.png?v=20261026');
  p.nextAvatarPage(); assert.equal(p.data.avatarPage, 24);
  await p.selectAvatar({ currentTarget: { dataset: { id: 1000 } } });
  assert.equal(p.data.user.avatarId, 1000); assert.equal(p.data.showAvatars, false); assert.equal(p.data.busy, false);
});

test('opening the native album may hide the page; unloading aborts pending preparation and failed upload retains current avatar', async () => {
  let finish;
  const h = pageHost({ prepare: () => new Promise(resolve => { finish = resolve; }) }), p = h.page;
  const pending = p.uploadAvatar(); p.onHide(); finish({ original: {}, compressed: {} }); await pending;
  assert.equal(h.uploads, 1); assert.equal(p.data.busy, false);
  const unloaded = pageHost({ prepare: () => new Promise(resolve => { finish = resolve; }) });
  const abandoned = unloaded.page.uploadAvatar(); unloaded.page.onUnload(); finish({ original: {}, compressed: {} }); await abandoned;
  assert.equal(unloaded.uploads, 0);
  const failure = pageHost({ upload: () => Promise.reject(new Error('网络未连接，请稍后重试。')) });
  await failure.page.uploadAvatar(); assert.equal(failure.page.data.user.avatarId, 8); assert.equal(failure.page.data.busy, false);
  assert.match(failure.page.data.error, /网络/);
});

test('switching the cached user during native avatar preparation releases busy controls and cancels the old upload', async () => {
  let finish;
  const h = pageHost({ prepare: () => new Promise(resolve => { finish = resolve; }) }), p = h.page;
  const pending = p.uploadAvatar(); assert.equal(p.data.busy, true);
  h.setUser({ ...USER, id: 'new-user', avatarId: 20 });
  await p.onShow();
  assert.equal(p.data.user.id, 'new-user'); assert.equal(p.data.busy, false);
  finish({ original: {}, compressed: {} }); await pending;
  assert.equal(h.uploads, 0); assert.equal(p.data.busy, false); assert.equal(p.data.user.avatarId, 20);
});
