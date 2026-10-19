'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameApp } = require('../minigame/lib/game-app');
const { KEY } = require('../minigame/lib/storage');

// Exercise the actual native entry logic with a WeChat-shaped host. Canvas text
// and transforms are recorded; reaction timing, hit testing, storage and lifecycle
// callbacks all run through the application rather than through the engine alone.
function nativeHost(t, options) {
  const opt = options || {};
  let time = 10000;
  let nextTask = 1;
  let app;
  let info = opt.window || { windowWidth: 390, windowHeight: 740, pixelRatio: 2 };
  const timers = new Map();
  const events = {};
  const writes = [];
  const text = [];
  const goPaintPhases = [];
  const transforms = [];
  const keepScreenOn = [];
  const modals = [];
  let stored = opt.stored;
  let canvasCalls = 0;
  let haptics = 0;
  const previous = {};
  const globalNames = ['wx', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'];
  globalNames.forEach(function (key) { previous[key] = { exists: Object.hasOwn(globalThis, key), value: globalThis[key] }; });
  const originalDateNow = Date.now;
  const originalRandom = Math.random;

  function task(callback, delay) {
    const id = nextTask++;
    timers.set(id, { callback, at: time + Math.max(0, Number(delay) || 0) });
    return id;
  }
  globalThis.setTimeout = task;
  globalThis.clearTimeout = function (id) { timers.delete(id); };
  globalThis.requestAnimationFrame = opt.noAnimationFrame ? undefined : function (callback) { return task(callback, 16); };
  globalThis.cancelAnimationFrame = opt.noCancelAnimationFrame ? undefined : function (id) { timers.delete(id); };
  Date.now = function () { return 1700000000000 + time; };
  Math.random = function () { return 0; };
  t.after(function () {
    globalNames.forEach(function (key) {
      if (previous[key].exists) globalThis[key] = previous[key].value;
      else delete globalThis[key];
    });
    Date.now = originalDateNow;
    Math.random = originalRandom;
  });

  const ctx = new Proxy({
    fillText(value) {
      text.push(String(value));
      if (value === 'GO!' && app) goPaintPhases.push(app.snapshot().duel.phase);
      // A real Canvas redraw consumes CPU time. An event containing two fingers
      // must be arbitrated before a slow first-player redraw can skew its timing.
      if (value === 'GO!' && app && app.snapshot().duel.phase === 'judging') {
        time += opt.judgingDrawCostMs || 0;
      }
    },
    setTransform() { transforms.push(Array.from(arguments)); }
  }, {
    get(target, key) { return key in target ? target[key] : function () {}; },
    set(target, key, value) { target[key] = value; return true; }
  });
  const canvas = { getContext(type) { assert.equal(type, '2d'); return ctx; } };
  const wx = {
    createCanvas() { canvasCalls += 1; return canvas; },
    // Native wx Performance.now() reports microseconds, while timer delays and
    // our host clock use milliseconds. Keep this mock faithful to the native API.
    getPerformance() { return { now() { return time * 1000; } }; },
    getWindowInfo() { return info; },
    getSystemInfoSync() { return info; },
    getMenuButtonBoundingClientRect() { return opt.menu || { bottom: 0 }; },
    getStorageSync(key) {
      assert.equal(key, KEY);
      if (opt.readFails) throw new Error('storage unavailable');
      return stored === undefined ? '' : structuredClone(stored);
    },
    setStorageSync(key, value) {
      assert.equal(key, KEY);
      if (opt.writeFails) throw new Error('quota exceeded');
      stored = structuredClone(value);
      writes.push(structuredClone(value));
    },
    onTouchStart(callback) { events.touch = callback; },
    onHide(callback) { events.hide = callback; },
    onShow(callback) { events.show = callback; },
    onWindowResize(callback) { events.resize = callback; },
    onShareAppMessage(callback) { events.share = callback; },
    onShareTimeline(callback) { events.timeline = callback; },
    showShareMenu() {},
    setKeepScreenOn(value) { keepScreenOn.push(value.keepScreenOn); },
    vibrateShort() { haptics += 1; },
    showModal(value) { modals.push(value); },
    setClipboardData(value) { if (value.success) value.success(); },
    createImage() { return { width: 64, height: 64 }; }
  };
  if (opt.legacyWindowInfo) delete wx.getWindowInfo;
  globalThis.wx = wx;
  app = createGameApp(wx);

  function advanceTo(deadline) {
    let iterations = 0;
    for (;;) {
      const pending = Array.from(timers.entries()).filter(function (entry) { return entry[1].at <= deadline; }).sort(function (a, b) { return a[1].at - b[1].at || a[0] - b[0]; });
      if (!pending.length) break;
      const [id, value] = pending[0];
      timers.delete(id);
      time = value.at;
      value.callback();
      iterations += 1;
      assert.ok(iterations < 1000, 'application must not spin on expired timers');
    }
    time = deadline;
  }

  function point(x, y) {
    const safe = info.safeArea || { top: 0, bottom: info.windowHeight };
    const top = Math.max(safe.top || 0, (opt.menu && opt.menu.bottom ? opt.menu.bottom + 4 : 0));
    const bottom = Math.max(0, info.windowHeight - (safe.bottom || info.windowHeight));
    const scale = Math.min(info.windowWidth / 390, Math.max(200, info.windowHeight - top - bottom) / 740);
    const dx = (info.windowWidth - 390 * scale) / 2;
    const dy = top + Math.max(0, (info.windowHeight - top - bottom - 740 * scale) / 2);
    return { clientX: dx + x * scale, clientY: dy + y * scale };
  }

  function touch(points) { events.touch({ changedTouches: points.map(function (p) { return point(p[0], p[1]); }) }); }

  return {
    app, canvas, events, text, goPaintPhases, transforms, keepScreenOn, writes, modals,
    get canvasCalls() { return canvasCalls; },
    get haptics() { return haptics; },
    get stored() { return stored; },
    get time() { return time; },
    get pendingTasks() { return timers.size; },
    enter() { touch([[195, 558]]); assert.equal(app.snapshot().screen, 'duel'); },
    start() { touch([[195, 670]]); assert.equal(app.snapshot().duel.phase, 'waiting'); },
    tap(x, y) { touch([[x, y]]); },
    touch,
    advance(ms) { advanceTo(time + ms); },
    advanceTo,
    signal() {
      const waiting = app.snapshot().duel;
      advanceTo(waiting.signalDueAt + (opt.noAnimationFrame ? 0 : 16));
      assert.equal(app.snapshot().duel.phase, 'go');
      return app.snapshot().duel;
    },
    win(player, reactionMs) {
      this.start(); this.signal(); this.advance(reactionMs);
      this.tap(player === 'p1' ? 105 : 285, 460);
      this.advance(35);
      return app.snapshot().duel;
    },
    resize(nextInfo) { info = nextInfo; events.resize(); }
  };
}

test('native boot creates a DPR-sized visible Canvas and registers touch, lifecycle and sharing', (t) => {
  const h = nativeHost(t);
  assert.equal(h.canvasCalls, 1);
  assert.equal(h.canvas.width, 780);
  assert.equal(h.canvas.height, 1480);
  assert.deepEqual(h.transforms[0], [2, 0, 0, 2, 0, 0]);
  assert.equal(h.app.snapshot().screen, 'home');
  assert.ok(h.text.includes('把有趣，'));
  for (const event of ['touch', 'hide', 'show', 'resize', 'share', 'timeline']) assert.equal(typeof h.events[event], 'function');
  assert.ok(h.events.share().title.includes('举手决斗'));
  assert.ok(h.events.timeline().title.includes('举手决斗'));
  assert.equal(h.writes.length, 0);
  assert.equal(h.pendingTasks, 0);
});

test('GO is painted in an animation frame before starting the actual reaction clock', (t) => {
  const h = nativeHost(t);
  h.enter(); h.start();
  const waiting = h.app.snapshot().duel;
  assert.deepEqual(h.keepScreenOn, [true]);
  h.advanceTo(waiting.signalDueAt);
  assert.equal(h.app.snapshot().duel.phase, 'waiting');
  assert.equal(h.goPaintPhases.length, 0);
  h.advance(16);
  const go = h.app.snapshot().duel;
  assert.equal(go.phase, 'go');
  assert.equal(go.goAt, waiting.signalDueAt + 16);
  assert.deepEqual(h.goPaintPhases.slice(0, 2), ['waiting', 'go']);
  h.advance(211);
  h.tap(105, 460);
  assert.equal(h.app.snapshot().duel.reactions.p1, 211);
  h.advance(35);
  assert.equal(h.app.snapshot().duel.result.reactionMs, 211);
});

test('native microsecond performance clock is normalized to millisecond waits and reactions', (t) => {
  const h = nativeHost(t);
  h.enter(); h.start();
  const waiting = h.app.snapshot().duel;
  assert.equal(waiting.waitMs, 2000);
  assert.equal(waiting.signalDueAt - h.time, 2000);
  h.advance(1999);
  assert.equal(h.app.snapshot().duel.phase, 'waiting');
  h.advance(1);
  assert.equal(h.app.snapshot().duel.phase, 'waiting');
  h.advance(16);
  assert.equal(h.app.snapshot().duel.phase, 'go');
  h.advance(123);
  h.tap(105, 460);
  assert.equal(h.app.snapshot().duel.reactions.p1, 123);
  h.advance(35);
  assert.equal(h.app.snapshot().duel.result.reactionMs, 123);
});

test('touch during the queued signal frame still false-starts and stale frame cannot reveal GO', (t) => {
  const h = nativeHost(t, { noCancelAnimationFrame: true });
  h.enter(); h.start();
  h.advanceTo(h.app.snapshot().duel.signalDueAt);
  h.tap(105, 460);
  assert.equal(h.app.snapshot().duel.result.reason, 'false-start');
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 0, p2: 1 });
  h.advance(10000);
  assert.equal(h.app.snapshot().duel.result.reason, 'false-start');
  assert.equal(h.goPaintPhases.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a native simultaneous multi-touch event fairly ties rather than dropping the second player', (t) => {
  const h = nativeHost(t);
  h.enter(); h.start(); h.signal(); h.advance(200);
  h.touch([[105, 460], [285, 460]]);
  const s = h.app.snapshot().duel;
  assert.equal(s.phase, 'result');
  assert.equal(s.result.reason, 'tie');
  assert.deepEqual(s.reactions, { p1: 200, p2: 200 });
  assert.deepEqual(s.scores, { p1: 0, p2: 0 });
  h.advance(10000);
  assert.equal(h.app.snapshot().duel.roundsPlayed, 1);
  assert.equal(h.writes.length, 0);
});

test('simultaneous fingers are arbitrated together before a slow Canvas render', (t) => {
  const h = nativeHost(t, { judgingDrawCostMs: 40 });
  h.enter(); h.start(); h.signal(); h.advance(200);
  h.touch([[105, 460], [285, 460]]);
  const s = h.app.snapshot().duel;
  assert.equal(s.result.reason, 'tie');
  assert.deepEqual(s.reactions, { p1: 200, p2: 200 });
  assert.deepEqual(s.scores, { p1: 0, p2: 0 });
});

test('first-to-one completes from native touches and records exactly one match', (t) => {
  const h = nativeHost(t);
  h.enter();
  h.tap(120, 615);
  assert.equal(h.app.snapshot().duel.targetScore, 1);
  assert.equal(h.stored.targetScore, 1);
  const s = h.win('p2', 225);
  assert.equal(s.phase, 'complete');
  assert.equal(h.stored.matches.length, 1);
  assert.equal(h.stored.matches[0].winner, 1);
  assert.deepEqual(h.stored.matches[0].scores, [0, 1]);
  assert.equal(h.stored.matches[0].bestMs, 225);
  const writes = h.writes.length;
  h.touch([[105, 460], [285, 460]]);
  h.advance(20000);
  assert.equal(h.writes.length, writes);
  assert.equal(h.stored.matches.length, 1);
  h.tap(195, 670);
  assert.equal(h.app.snapshot().duel.phase, 'ready');
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 0, p2: 0 });
  assert.equal(h.stored.matches.length, 1);
});

test('first-to-three preserves scores between rounds and never stores unfinished matches', (t) => {
  const h = nativeHost(t);
  h.enter();
  assert.equal(h.win('p1', 250).phase, 'result');
  assert.equal(h.writes.length, 0);
  assert.equal(h.win('p2', 300).phase, 'result');
  assert.equal(h.writes.length, 0);
  assert.equal(h.win('p1', 200).phase, 'result');
  assert.equal(h.win('p1', 230).phase, 'complete');
  assert.equal(h.stored.matches.length, 1);
  assert.deepEqual(h.stored.matches[0].scores, [3, 1]);
  assert.equal(h.stored.matches[0].bestMs, 200);
});

test('backgrounding an arbitration round cancels the pending winner while preserving prior scores', (t) => {
  const h = nativeHost(t);
  h.enter(); h.win('p2', 300);
  h.start(); h.signal(); h.advance(100); h.tap(105, 460);
  assert.equal(h.app.snapshot().duel.phase, 'judging');
  h.events.hide();
  h.advance(100000);
  h.events.touch({ changedTouches: [{ clientX: 285, clientY: 460 }] });
  h.events.show();
  const s = h.app.snapshot().duel;
  assert.equal(s.phase, 'ready');
  assert.deepEqual(s.scores, { p1: 0, p2: 1 });
  assert.deepEqual(s.bestTimes, { p1: null, p2: 300 });
  assert.equal(s.roundsPlayed, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.pendingTasks, 0);
  h.start(); h.signal(); h.advance(220); h.tap(105, 460); h.advance(35);
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 1, p2: 1 });
});

test('hide before a queued GO frame cannot signal a later restarted round', (t) => {
  const h = nativeHost(t, { noCancelAnimationFrame: true });
  h.enter(); h.start();
  h.advanceTo(h.app.snapshot().duel.signalDueAt);
  h.events.hide(); h.events.show(); h.start();
  const current = h.app.snapshot().duel;
  h.advance(16);
  assert.equal(h.app.snapshot().duel.phase, 'waiting');
  assert.equal(h.app.snapshot().duel.roundId, current.roundId);
  assert.equal(h.goPaintPhases.length, 0);
  h.signal();
  assert.equal(h.app.snapshot().duel.roundId, current.roundId);
});

test('resize cancels the active round and preserves hit testing in a device safe area', (t) => {
  const h = nativeHost(t);
  h.enter(); h.start(); h.signal();
  h.resize({ windowWidth: 430, windowHeight: 932, pixelRatio: 3, safeArea: { top: 59, bottom: 898 } });
  assert.equal(h.canvas.width, 1290);
  assert.equal(h.canvas.height, 2796);
  assert.equal(h.app.snapshot().duel.phase, 'ready');
  h.start(); h.signal(); h.advance(180); h.tap(105, 460); h.advance(35);
  assert.equal(h.app.snapshot().duel.result.winner, 'p1');
  assert.equal(h.app.snapshot().duel.result.reactionMs, 180);
});

test('pause and rules modal do not award a point or allow old timers to continue', (t) => {
  const h = nativeHost(t);
  h.enter(); h.start(); h.signal();
  h.tap(338, 30);
  assert.equal(h.modals.length, 1);
  assert.equal(h.app.snapshot().duel.phase, 'ready');
  h.advance(100000);
  assert.deepEqual(h.app.snapshot().duel.scores, { p1: 0, p2: 0 });
  assert.equal(h.app.snapshot().duel.roundsPlayed, 0);
  assert.equal(h.writes.length, 0);
});

test('global reaction deadline produces a draw and no saved match', (t) => {
  const h = nativeHost(t);
  h.enter(); h.start();
  const go = h.signal();
  h.advanceTo(go.reactionDeadlineAt);
  const s = h.app.snapshot().duel;
  assert.equal(s.phase, 'result');
  assert.equal(s.result.reason, 'timeout');
  assert.deepEqual(s.scores, { p1: 0, p2: 0 });
  assert.equal(h.writes.length, 0);
  assert.equal(h.pendingTasks, 0);
});

test('storage failures still allow a completed native match and expose the unsaved-record notice', (t) => {
  const h = nativeHost(t, { stored: { targetScore: 1, haptics: false }, writeFails: true });
  h.enter();
  const s = h.win('p1', 220);
  assert.equal(s.phase, 'complete');
  assert.equal(h.haptics, 0);
  assert.equal(h.writes.length, 0);
  assert.ok(h.text.includes('存储空间不足，本场战绩未保存'));
  h.advance(3000);
  assert.equal(h.app.snapshot().duel.phase, 'complete');
});

test('legacy sizing and absent animation-frame APIs retain a working native game flow', (t) => {
  const h = nativeHost(t, { legacyWindowInfo: true, noAnimationFrame: true });
  h.enter(); h.start();
  const waiting = h.app.snapshot().duel;
  const go = h.signal();
  assert.equal(go.goAt, waiting.signalDueAt);
  h.advance(200); h.tap(285, 460); h.advance(35);
  assert.equal(h.app.snapshot().duel.result.winner, 'p2');
});

test('corrupted local data is sanitized before creating the engine or drawing history', (t) => {
  const h = nativeHost(t, { stored: {
    targetScore: 9,
    haptics: 'yes',
    names: ['  ', 9],
    matches: [{ id: 'broken', at: 1, winner: 8, scores: [99, 1], bestMs: -1, names: ['x', 'y'] }, null]
  } });
  h.enter();
  assert.equal(h.app.snapshot().duel.targetScore, 3);
  assert.ok(h.text.includes('红方'));
  assert.ok(h.text.includes('蓝方'));
  h.tap(44, 30);
  assert.equal(h.app.snapshot().screen, 'home');
  h.tap(330, 32);
  h.tap(195, 382);
  assert.equal(h.app.snapshot().screen, 'history');
  assert.ok(h.text.includes('第一场，等你开局。'));
});

test('leaving an unfinished match requires the modal response and stopping screen wake', (t) => {
  const h = nativeHost(t);
  h.enter(); h.win('p1', 210);
  h.start(); h.signal();
  h.tap(44, 30);
  assert.equal(h.app.snapshot().screen, 'duel');
  assert.equal(h.app.snapshot().duel.phase, 'ready');
  assert.equal(h.modals.length, 1);
  h.modals[0].success({ confirm: true });
  assert.equal(h.app.snapshot().screen, 'home');
  assert.deepEqual(h.keepScreenOn, [true, false]);
  h.advance(100000);
  assert.equal(h.app.snapshot().screen, 'home');
  assert.equal(h.writes.length, 0);
});
