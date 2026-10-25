'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const avatars = require('../web/avatar-browser');
const script = fs.readFileSync(require.resolve('../web/portal/account.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../web/portal/index.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

test('browser custom avatar preserves original bytes while only center-cropping the display image', async () => {
  const original = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 41]).toString('base64');
  const jpeg = Buffer.from('display-only-test-bytes').toString('base64');
  const draws = [];
  const canvas = { getContext: () => ({ fillRect() {}, drawImage(...args) { draws.push(args); } }), toDataURL: type => 'data:' + type + ';base64,' + jpeg };
  const host = {
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,' + original; this.onload(); } },
    Image: class { constructor() { this.naturalWidth = 800; this.naturalHeight = 400; } set src(_) { this.onload(); } },
    document: { createElement: () => canvas }
  };
  const result = await avatars.prepareBrowserAvatar({ type: 'image/png', size: 11 }, host);
  assert.equal(result.payload.original.data, original);
  assert.equal(result.payload.original.mimeType, 'image/png');
  assert.equal(result.payload.compressed.data, jpeg);
  assert.equal(canvas.width, 256); assert.equal(canvas.height, 256);
  assert.deepEqual(draws[0].slice(1), [200, 0, 400, 400, 0, 0, 256, 256]);
});

test('browser rejects oversized files, unsupported input and canvas export failure before upload', async () => {
  await assert.rejects(avatars.prepareBrowserAvatar({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }, {}), /10 MB/);
  await assert.rejects(avatars.prepareBrowserAvatar({ type: 'image/svg+xml', size: 200 }, {}), /JPG/);
  const host = {
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,eA=='; this.onload(); } },
    Image: class { constructor() { this.naturalWidth = 100; this.naturalHeight = 100; } set src(_) { this.onload(); } },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/png;base64,eA==' }) }
  };
  await assert.rejects(avatars.prepareBrowserAvatar({ type: 'image/png', size: 1 }, host), /压缩失败/);
});

async function fixture(prepareBrowserAvatar) {
  const dom = new JSDOM(html, { url: 'https://miniapp.example/?category=mine', runScripts: 'outside-only' });
  const w = dom.window, subscribers = new Set(), calls = [];
  let user = { id: 'user-a', username: 'alice', email: 'a@example.test', avatarId: 1, avatarType: 'builtin', avatarUrl: 'https://miniapp.example/avatars/0001.png' };
  const emit = value => { user = value; for (const fn of subscribers) fn({ user, reason: 'profile' }); };
  const client = {
    getCachedUser: () => user, subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); }, refreshSession: async () => ({ user }),
    setBuiltinAvatar: async id => { calls.push(['builtin', id]); emit({ ...user, avatarId: id, avatarUrl: 'https://miniapp.example' + avatars.avatarPath(id) }); },
    uploadAvatar: async payload => { calls.push(['upload', payload]); emit({ ...user, avatarId: null, avatarType: 'custom', avatarUrl: 'https://miniapp.example/api/account/avatar/custom' }); },
    logout: async () => emit(null)
  };
  const status = { state: 'idle', message: '已同步。' };
  w.BrclioAccount = { client, avatars: { ...avatars, ...(prepareBrowserAvatar ? { prepareBrowserAvatar } : {}) }, ready: Promise.resolve(), sync: { getStatus: () => status, subscribe: () => () => {}, onShow: async () => status, onHide: async () => status } };
  w.eval(script); w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await flush();
  return { w, calls, emit, one: selector => w.document.querySelector(selector), close: () => { w.dispatchEvent(new w.Event('pagehide')); w.close(); } };
}

test('web picker loads 40 at a time, reaches avatar 1000, persists changes and updates header', async () => {
  const h = await fixture();
  h.one('[data-avatar-action="toggle"]').click();
  assert.equal(h.w.document.querySelectorAll('[data-avatar-id]').length, 40);
  assert.equal(h.one('[data-avatar-id="1"]').getAttribute('aria-pressed'), 'true');
  for (let i = 0; i < 24; i++) h.one('[data-avatar-action="next"]').click();
  assert.ok(h.one('[data-avatar-id="1000"]'));
  assert.equal(h.one('[data-avatar-action="next"]').disabled, true);
  h.one('[data-avatar-id="1000"]').click(); await flush();
  assert.deepEqual(h.calls[0], ['builtin', 1000]);
  assert.match(h.one('[data-account-avatar]').src, /1000\.png$/);
  assert.match(h.one('[data-account-entry] img').src, /1000\.png$/);
  assert.match(h.one('[data-account-session-notice]').textContent, /已更新/);
  h.close();
});

test('saving a built-in avatar retains keyboard focus after the picker grid is replaced', async () => {
  const h = await fixture();
  h.one('[data-avatar-action="toggle"]').click();
  const before = h.one('[data-avatar-id="2"]');
  before.focus(); before.click(); await flush();
  const after = h.one('[data-avatar-id="2"]');
  assert.notEqual(after, before, 'saving rebuilds the grid from the persisted profile');
  assert.equal(after.getAttribute('aria-pressed'), 'true');
  assert.equal(after.disabled, false);
  assert.equal(h.w.document.activeElement, after);
  h.close();
});

test('custom web upload previews first and requires save, while logout cancels delayed image preparation', async () => {
  const payload = { original: { mimeType: 'image/png', data: 'original' }, compressed: { mimeType: 'image/jpeg', data: 'display' } };
  let finish;
  const h = await fixture(() => new Promise(resolve => { finish = resolve; }));
  h.one('[data-avatar-action="toggle"]').click();
  const input = h.one('[data-avatar-file]');
  Object.defineProperty(input, 'files', { value: [{ size: 100, type: 'image/png' }] });
  input.dispatchEvent(new h.w.Event('change')); await flush();
  finish({ preview: 'data:image/jpeg;base64,ZGlzcGxheQ==', payload }); await flush();
  assert.equal(h.one('[data-avatar-preview]').hidden, false); assert.equal(h.calls.length, 0);
  h.one('[data-avatar-action="save"]').click(); await flush();
  assert.equal(h.calls[0][0], 'upload'); assert.deepEqual(h.calls[0][1], payload);
  assert.equal(h.one('[data-avatar-preview]').hidden, true);
  input.dispatchEvent(new h.w.Event('change')); await flush(); h.emit(null);
  finish({ preview: 'data:image/jpeg;base64,b2xk', payload }); await flush();
  assert.equal(h.one('[data-avatar-preview]').hidden, true); assert.equal(h.one('[data-account-member]').hidden, true);
  assert.equal(h.calls.length, 1); h.close();
});
