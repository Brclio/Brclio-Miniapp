'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDuelPlatform } = require('../miniprogram/lib/duel-platform');
const { createGameApp } = require('../minigame/lib/game-app');
const { KEY } = require('../minigame/lib/storage');

// Use the real page bridge and shared rules/rendering together. A page Canvas
// supplies animation frames; no mini-game global animation API is available.
function host(t, options) {
  const opt = options || {};
  const originals = new Map();
  const tasks = new Map();
  const writes = [];
  const wake = [];
  const modals = [];
  const images = [];
  const goPaintPhases = [];
  const cancelledFrames = [];
  const bounds = opt.bounds || { left: 23, top: 17, width: 390, height: 740 };
  let info = { windowWidth: 430, windowHeight: 780, screenWidth: 430, screenHeight: 844, screenTop: 64, pixelRatio: 2 };
  let time = 1700000010000;
  let taskId = 0;
  let nativeFrames = 0;
  let stored = Object.assign({ targetScore: 1, haptics: false, names: ['红方', '蓝方'], matches: [] }, opt.stored);
  let app;

  function replace(name, value) {
    originals.set(name, { exists: Object.hasOwn(globalThis, name), value: globalThis[name] });
    globalThis[name] = value;
  }
  function schedule(callback, delay, kind) {
    const id = ++taskId;
    tasks.set(id, { callback, at: time + Math.max(0, Number(delay) || 0), kind });
    return id;
  }
  const originalNow = Date.now;
  const originalRandom = Math.random;
  replace('setTimeout', (callback, delay) => schedule(callback, delay, 'timer'));
  replace('clearTimeout', (id) => tasks.delete(id));
  replace('requestAnimationFrame', undefined);
  replace('cancelAnimationFrame', undefined);
  Date.now = () => time;
  Math.random = () => 0;
  t.after(() => {
    originals.forEach((previous, name) => {
      if (previous.exists) globalThis[name] = previous.value;
      else delete globalThis[name];
    });
    Date.now = originalNow;
    Math.random = originalRandom;
  });

  const context = new Proxy({
    fillText(value) {
      if (value === 'GO!' && app) goPaintPhases.push(app.snapshot().duel.phase);
    }
  }, {
    get(target, key) { return key in target ? target[key] : function () {}; },
    set(target, key, value) { target[key] = value; return true; }
  });
  const canvas = {
    getContext(type) { assert.equal(type, '2d'); return context; },
    requestAnimationFrame(callback) {
      assert.equal(this, canvas, 'Canvas methods must retain their receiver');
      nativeFrames += 1;
      return schedule(() => callback(time), 16, 'frame');
    },
    cancelAnimationFrame(id) {
      assert.equal(this, canvas);
      cancelledFrames.push(id);
      tasks.delete(id);
    },
    createImage() { const image = { width: 64, height: 64 }; images.push(image); return image; }
  };
  const api = {
    getWindowInfo() { return info; },
    getStorageSync(key) { assert.equal(key, KEY); return structuredClone(stored); },
    setStorageSync(key, value) { assert.equal(key, KEY); stored = structuredClone(value); writes.push(structuredClone(value)); },
    getPerformance() { throw new Error('The mini-program performance object is not the mini-game microsecond clock'); },
    setKeepScreenOn(value) { wake.push(value.keepScreenOn); },
    showModal(value) { modals.push(value); },
    showShareMenu() {},
    vibrateShort() {},
    setClipboardData(value) { if (value.success) value.success(); }
  };
  replace('wx', api);
  const platform = createDuelPlatform({ wx: api, canvas, bounds, windowInfo: info });

  function advanceTo(deadline) {
    for (let count = 0; ; count += 1) {
      assert.ok(count < 1000, 'No expired timer loop');
      const next = Array.from(tasks.entries()).filter((entry) => entry[1].at <= deadline)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      tasks.delete(next[0]);
      time = next[1].at;
      next[1].callback();
    }
    time = deadline;
  }
  function touch(points, local) {
    const changedTouches = points.map(([x, y]) => local ? { x, y } : { clientX: bounds.left + x, clientY: bounds.top + y });
    platform.emitTouch('Start', { changedTouches, touches: changedTouches });
  }
  function boot() {
    app = createGameApp(platform, { initialScreen: 'duel', avatarSrc: '/assets/avatar.png' });
    return app;
  }
  if (opt.boot !== false) boot();
  return {
    api, canvas, platform, bounds, writes, wake, modals, images, goPaintPhases, cancelledFrames,
    get app() { return app; },
    get stored() { return stored; },
    get time() { return time; },
    get pendingTasks() { return tasks.size; },
    get nativeFrames() { return nativeFrames; },
    setInfo(value) { info = value; },
    boot, touch, advanceTo,
    advance(ms) { advanceTo(time + ms); },
    start() { touch([[195, 670]]); assert.equal(app.snapshot().duel.phase, 'waiting'); },
    signal() { advanceTo(app.snapshot().duel.signalDueAt + 16); assert.equal(app.snapshot().duel.phase, 'go'); },
    dispose() { if (app) app.dispose(); platform.dispose(); }
  };
}

test('page Canvas bridge normalizes nonzero bounds, preserves local touch coordinates and simultaneous fingers', (t) => {
  const h = host(t);
  assert.equal(h.canvas.width, 780);
  assert.equal(h.canvas.height, 1480);
  assert.equal(h.app.snapshot().screen, 'duel');
  h.start(); h.signal(); h.advance(211);
  h.touch([[105, 460], [285, 460]]);
  const tied = h.app.snapshot().duel;
  assert.equal(tied.result.reason, 'tie');
  assert.deepEqual(tied.reactions, { p1: 211, p2: 211 });
  assert.deepEqual(tied.scores, { p1: 0, p2: 0 });
  assert.equal(h.writes.length, 0);

  h.start(); h.signal(); h.advance(123);
  h.touch([[285, 460]], true);
  h.advance(35);
  assert.equal(h.app.snapshot().duel.result.winner, 'p2');
  assert.equal(h.stored.matches.length, 1);
  assert.equal(h.stored.matches[0].bestMs, 123);
  h.dispose();
});

test('page bridge uses millisecond Date.now and Canvas RAF before painting GO', (t) => {
  const h = host(t);
  h.start();
  const waiting = h.app.snapshot().duel;
  assert.equal(waiting.signalDueAt - h.time, 2000);
  h.advance(1999);
  assert.equal(h.app.snapshot().duel.phase, 'waiting');
  assert.equal(h.nativeFrames, 0);
  h.advance(1);
  assert.equal(h.nativeFrames, 1);
  assert.equal(h.app.snapshot().duel.phase, 'waiting');
  assert.deepEqual(h.goPaintPhases, []);
  h.advance(16);
  assert.equal(h.app.snapshot().duel.goAt, waiting.signalDueAt + 16);
  assert.deepEqual(h.goPaintPhases.slice(0, 2), ['waiting', 'go']);
  h.advance(219); h.touch([[105, 460]]); h.advance(35);
  assert.equal(h.stored.matches[0].bestMs, 219);
  h.dispose();
});

test('hide cancels a queued Canvas frame and restores a paused round without scoring', (t) => {
  const h = host(t);
  h.start();
  h.advanceTo(h.app.snapshot().duel.signalDueAt);
  assert.equal(h.nativeFrames, 1);
  h.platform.hide();
  assert.equal(h.cancelledFrames.length, 1);
  assert.equal(h.pendingTasks, 0);
  assert.equal(h.wake.at(-1), false);
  h.advance(10000);
  h.touch([[105, 460]]);
  h.platform.show();
  assert.equal(h.wake.at(-1), true);
  assert.equal(h.app.snapshot().duel.phase, 'ready');
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 0, p2: 0 });
  assert.equal(h.goPaintPhases.length, 0);
  assert.equal(h.writes.length, 0);
  h.dispose();
});

test('unloading during arbitration stops timers, keeps prior score and cannot write a completed match', (t) => {
  const h = host(t, { stored: { targetScore: 3 } });
  h.start(); h.signal(); h.advance(200); h.touch([[105, 460]]); h.advance(35);
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 1, p2: 0 });
  h.start(); h.signal(); h.advance(150); h.touch([[285, 460]]);
  assert.equal(h.app.snapshot().duel.phase, 'judging');
  h.dispose();
  assert.equal(h.pendingTasks, 0);
  assert.equal(h.wake.at(-1), false);
  assert.equal(h.canvas.width, 1);
  assert.equal(h.canvas.height, 1);
  h.advance(60000);
  h.platform.show();
  h.touch([[105, 460]]);
  h.platform.updateViewport({ left: 0, top: 0, width: 430, height: 800 });
  assert.equal(h.app.snapshot().duel.phase, 'ready');
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 1, p2: 0 });
  assert.equal(h.writes.length, 0);
  assert.ok(h.images.every((image) => image.onload === null && image.onerror === null));
});

test('a late clear-record modal response after unload cannot delete native local history', (t) => {
  const match = { id: 'saved', at: 1700000000000, names: ['红方', '蓝方'], winner: 0, scores: [1, 0], bestMs: 200 };
  const h = host(t, { stored: { matches: [match] } });
  h.touch([[44, 30]]); // Duel → home.
  h.touch([[330, 32]]); // Home → about.
  h.touch([[195, 503]]); // About → privacy.
  assert.equal(h.app.snapshot().screen, 'privacy');
  h.touch([[195, 670]]);
  assert.equal(h.modals.length, 1);
  const lateResponse = h.modals[0].success;
  h.dispose();
  lateResponse({ confirm: true });
  h.advance(60000);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.stored.matches, [match]);
  assert.equal(h.pendingTasks, 0);
  assert.equal(h.wake.at(-1), false);
});

function pageHost(t) {
  const h = host(t, { boot: false, bounds: { left: 0, top: 0, width: 390, height: 740 } });
  const queries = [];
  let definition;
  let creates = 0;
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/duel/index.js'), 'utf8');
  vm.runInNewContext(source, {
    wx: h.api,
    Page(value) { definition = value; },
    require(id) {
      if (id === '../../lib/duel') return { createGameApp() { creates += 1; return createGameApp.apply(null, arguments); } };
      if (id === '../../lib/duel-platform') return require('../miniprogram/lib/duel-platform');
      throw new Error('Unexpected page dependency: ' + id);
    }
  }, { filename: 'miniprogram/pages/duel/index.js' });
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); },
    createSelectorQuery() {
      return {
        select(value) { assert.equal(value, '#duel-canvas'); return this; },
        fields(value) { assert.equal(value.node, true); assert.equal(value.size, true); assert.equal(value.rect, true); return this; },
        exec(callback) { queries.push(callback); }
      };
    }
  });
  return { h, page, queries, get creates() { return creates; }, result(width = 390, height = 740) { return [{ node: h.canvas, width, height, left: 0, top: 0 }]; } };
}

test('page selector results arriving after unload or hide do not resurrect the game', (t) => {
  const p = pageHost(t);
  p.page.onLoad(); p.page.onShow();
  assert.equal(p.queries.length, 0, 'onShow before onReady must not query Canvas');
  p.page.onReady();
  assert.equal(p.queries.length, 1);
  p.page.onHide();
  p.queries[0](p.result());
  assert.equal(p.creates, 0);
  p.page.onShow();
  assert.equal(p.queries.length, 2);
  p.page.onUnload();
  p.queries[1](p.result());
  assert.equal(p.creates, 0);
  assert.equal(p.page._game, null);
  assert.equal(p.page._platform, null);
  assert.equal(p.h.wake.length, 0);
  assert.equal(p.h.writes.length, 0);
});

test('page resize rejects an older measurement and touch cancellation pauses an active round', (t) => {
  const p = pageHost(t);
  p.page.onLoad(); p.page.onReady();
  p.queries[0](p.result());
  assert.equal(p.creates, 1);
  assert.equal(p.page.data.status, 'ready');
  p.page.onResize();
  p.page.onResize();
  assert.equal(p.queries.length, 3);
  p.queries[2](p.result(390, 740));
  const acceptedWidth = p.h.canvas.width;
  p.queries[1](p.result(300, 600));
  assert.equal(p.h.canvas.width, acceptedWidth);
  p.page.onTouchStart({ changedTouches: [{ x: 195, y: 670 }] });
  assert.equal(p.page._game.snapshot().duel.phase, 'waiting');
  p.page.onTouchCancel({ changedTouches: [] });
  assert.equal(p.page._game.snapshot().duel.phase, 'ready');
  assert.equal(p.h.pendingTasks, 0);
  p.page.onUnload();
  p.h.advance(60000);
  assert.equal(p.h.wake.at(-1), false);
  assert.equal(p.h.writes.length, 0);
});
