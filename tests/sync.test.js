'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'web', 'sync.js'), 'utf8');
const HISTORY = 'brclio-minigame:brclio.duel.v1';
const SETTINGS = 'brclio-pocket:cloud-backup-v1';
const SESSION = 'brclio-pocket:cloud-session-v1';
const TOKEN = 'v1.' + 'a'.repeat(43) + '.' + 'b'.repeat(43);
const TIME = 1792382400000;
const copy = (value) => JSON.parse(JSON.stringify(value));
const match = (id, at = TIME) => ({ id, at, names: ['红方', '蓝方'], winner: 1, scores: [0, 1], bestMs: null });

function harness(options = {}) {
  let now = TIME;
  let nextTimer = 1;
  let remote = copy(options.remote || []);
  let suspended = 0;
  let resumed = 0;
  const timers = new Map();
  const calls = [];
  const values = new Map(Object.entries(options.storage || {}));
  const windowListeners = new Map();
  const elements = new Map();
  const localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  const document = {
    activeElement: null,
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    querySelector: () => document.getElementById('app'),
    addEventListener: () => {}
  };
  function element(id) {
    const listeners = new Map();
    return { id, hidden: false, disabled: false, checked: false, textContent: '', inert: false,
      addEventListener: (event, handler) => listeners.set(event, handler),
      setAttribute: () => {},
      focus() { document.activeElement = this; },
      querySelectorAll: () => Array.from(elements.values()),
      getClientRects: () => [{ width: 1 }],
      click() { if (!this.disabled && listeners.has('click')) listeners.get('click')(); },
      change() { if (listeners.has('change')) listeners.get('change')(); }
    };
  }
  document.getElementById('cloud-panel').hidden = true;
  const window = {
    BrclioStorage: {
      read: (key) => JSON.parse(localStorage.getItem('brclio-minigame:' + key) || '{}'),
      hydrate: (key, value) => localStorage.setItem('brclio-minigame:' + key, JSON.stringify(value))
    },
    BrclioRuntime: { suspend: () => suspended++, resume: () => resumed++ },
    addEventListener(event, handler) {
      if (!windowListeners.has(event)) windowListeners.set(event, []);
      windowListeners.get(event).push(handler);
    }
  };
  class Clock extends Date { static now() { return now; } }
  const response = (value, status = 200, retry = null) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => retry }, json: async () => copy(value) });
  const context = vm.createContext({ window, document, localStorage, Date: Clock, AbortController,
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      if (options.fetch) {
        const custom = await options.fetch(url, opts, response);
        if (custom !== undefined) return custom;
      }
      if (url === '/api/health') return response({ syncAvailable: true });
      if (url === '/api/v1/session') return response({ token: TOKEN }, 201);
      if (url === '/api/v1/history' && opts.method === 'GET') return response({ matches: remote, updatedAt: remote.length ? TIME - 20000 : null });
      if (url === '/api/v1/history' && opts.method === 'POST') { remote = JSON.parse(opts.body).matches; return response({ matches: remote, updatedAt: now }); }
      if (url === '/api/v1/history' && opts.method === 'DELETE') { remote = []; return response({ deleted: true }); }
      throw new Error('Unexpected API request');
    }
  });
  vm.runInContext(SOURCE, context, { filename: 'web/sync.js' });
  const settle = async () => new Promise(setImmediate);
  return { calls, values, window,
    get suspended() { return suspended; }, get resumed() { return resumed; },
    state: () => JSON.parse(localStorage.getItem(SETTINGS) || '{}'),
    local: () => JSON.parse(localStorage.getItem(HISTORY) || '{}'),
    node: (name) => document.getElementById('cloud-' + name),
    settle,
    async click(name) { document.getElementById('cloud-' + name).click(); await settle(); },
    async enable() { const consent = document.getElementById('cloud-consent'); consent.checked = true; consent.change(); await this.click('enable'); },
    write(value) {
      localStorage.setItem(HISTORY, JSON.stringify(value));
      for (const handler of windowListeners.get('brclio:storage-write') || []) handler({ detail: { key: 'brclio.duel.v1', value } });
    },
    async tick(ms) {
      const end = now + ms;
      for (let turns = 0; turns < 100; turns++) {
        const next = Array.from(timers).filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) { now = end; await settle(); return; }
        now = next[1].due; timers.delete(next[0]); next[1].callback(); await settle();
      }
      throw new Error('Unexpected retry loop');
    }
  };
}

test('cloud backup defaults off and creates no session or history request', async () => {
  const h = harness();
  await h.window.__brclioBootstrap;
  await h.tick(60000);
  assert.equal(h.calls.length, 0);
  await h.click('open');
  assert.deepEqual(h.calls.map(({ url }) => url), ['/api/health']);
  assert.equal(h.suspended, 1);
  assert.equal(h.node('enable').disabled, true);
  await h.click('close');
  assert.equal(h.resumed, 1);
});

test('explicit opt-in uploads only newly added match data, never preference writes or the capability', async () => {
  const h = harness();
  await h.enable();
  assert.equal(h.state().enabled, true);
  assert.equal(h.values.get(SESSION), TOKEN);
  assert.equal(h.calls.filter(({ method }) => method === 'POST').length, 1); // Session only.
  h.write({ targetScore: 3, haptics: true, matches: [match('one')] });
  h.write({ targetScore: 5, haptics: false, matches: [match('one')] });
  await h.tick(1200);
  const writes = h.calls.filter(({ url, method }) => url.endsWith('/history') && method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), { matches: [match('one')] });
  assert.equal(writes[0].headers.Authorization, 'Bearer ' + TOKEN);
  assert.ok(h.calls.every(({ url, body }) => !url.includes(TOKEN) && !(body || '').includes(TOKEN)));
  h.write({ targetScore: 1, haptics: true, matches: [match('one')] });
  await h.tick(60000);
  assert.equal(h.calls.filter(({ url, method }) => url.endsWith('/history') && method === 'POST').length, 1);
});

test('opted-in startup restores and merges immutable saved IDs before the shared core boots', async () => {
  const old = match('same', TIME - 30000);
  const h = harness({ remote: [old, match('remote', TIME - 20000)], storage: {
    [SETTINGS]: JSON.stringify({ enabled: true }), [SESSION]: TOKEN,
    [HISTORY]: JSON.stringify({ targetScore: 5, haptics: false, matches: [{ ...old, names: ['changed', 'changed'] }, match('local')] })
  } });
  await h.window.__brclioBootstrap;
  assert.deepEqual(h.local().matches.map(({ id }) => id), ['local', 'remote', 'same']);
  assert.deepEqual(h.local().matches.find(({ id }) => id === 'same').names, old.names);
  assert.equal(h.local().targetScore, 5);
  assert.equal(h.local().haptics, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'GET');
});

test('startup timeout preserves local records and resolves without an unhandled cloud error', async () => {
  const h = harness({ storage: { [SETTINGS]: JSON.stringify({ enabled: true }), [SESSION]: TOKEN, [HISTORY]: JSON.stringify({ matches: [match('local')] }) },
    fetch: async (url, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('offline')))) });
  await h.tick(2800);
  await h.window.__brclioBootstrap;
  assert.equal(h.local().matches[0].id, 'local');
  assert.match(h.node('state').textContent, /无法连接云端/);
  await h.tick(120000);
  assert.equal(h.calls.length, 1);
});

test('clearing local history cancels pending uploads and never pulls cloud history mid-session', async () => {
  const h = harness({ remote: [match('old')], storage: { [SETTINGS]: JSON.stringify({ enabled: true }), [SESSION]: TOKEN } });
  await h.window.__brclioBootstrap;
  h.write({ matches: [match('new', TIME + 1), match('old')] });
  h.write({ matches: [] });
  await h.tick(120000);
  assert.deepEqual(h.local().matches, []);
  assert.equal(h.calls.length, 1);
  assert.match(h.node('state').textContent, /云端记录仍保留/);
});

test('a late upload response cannot restore records cleared while the request was in flight', async () => {
  let finish;
  const h = harness({ fetch: async (url, opts, response) => {
    if (url.endsWith('/history') && opts.method === 'POST') return new Promise((resolve) => { finish = () => resolve(response({ matches: [match('one')], updatedAt: TIME })); });
  } });
  await h.enable();
  h.write({ matches: [match('one')] });
  await h.tick(1200);
  assert.equal(typeof finish, 'function');
  h.write({ matches: [] });
  finish(); await h.settle();
  assert.deepEqual(h.local().matches, []);
  await h.tick(60000);
  assert.equal(h.calls.filter(({ url, method }) => url.endsWith('/history') && method === 'POST').length, 1);
});

test('cloud removal requires its second action, switches backup off, and retains local history and device capability', async () => {
  const h = harness({ storage: { [HISTORY]: JSON.stringify({ matches: [match('one')] }) } });
  await h.enable();
  await h.click('delete');
  assert.equal(h.calls.filter(({ method }) => method === 'DELETE').length, 0);
  await h.click('delete-accept');
  assert.equal(h.calls.filter(({ method }) => method === 'DELETE').length, 1);
  assert.equal(h.state().enabled, false);
  assert.equal(h.values.get(SESSION), TOKEN);
  assert.equal(h.local().matches[0].id, 'one');
  h.write({ matches: [match('two'), match('one')] });
  await h.tick(60000);
  assert.equal(h.calls.filter(({ url, method }) => url.endsWith('/history') && method === 'POST').length, 1);
});

test('offline automatic backup does not create a rapid retry loop', async () => {
  const h = harness({ fetch: async (url, opts) => { if (url.endsWith('/history') && opts.method === 'POST') throw new Error('offline'); } });
  await h.enable();
  h.write({ matches: [match('one')] });
  await h.tick(1200);
  await h.tick(120000);
  assert.equal(h.calls.filter(({ url, method }) => url.endsWith('/history') && method === 'POST').length, 1);
  assert.equal(h.local().matches[0].id, 'one');
});
