'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const actual = require('../miniprogram/lib/lingotiles');
const pagePath = path.resolve(__dirname, '../miniprogram/pages/lingotiles');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../web/projects/lingotiles/public/vocabulary/manifest.json'), 'utf8'));
const event = data => ({ currentTarget: { dataset: data } });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function host(overrides = {}) {
  let definition, now = 1800000000000, nextId = 0;
  const tasks = new Map(), completions = [], shares = [], modals = [], audio = [], values = new Map();
  const model = Object.assign({}, actual, {
    loadProgress: () => actual.loadProgress(null), saveProgress: () => true,
    loadMatchAnimation: () => false, saveMatchAnimation: () => true,
    loadManifest: async () => manifest, loadIllustrationManifest: async () => ({ ready: 1083, total: 100000, pending: 98917 }),
    loadWordIllustrations: async () => {}, getWordIllustration: () => null,
    recordIllustrationPractice: () => true, getMissingIllustrations: () => [],
    appendCompletion: async record => { completions.push(structuredClone(record)); return { persisted: true }; },
    getCompletionPage: async () => ({ records: [], total: 0, persisted: true }),
    getCompletionSummary: async () => ({ total: 0, latest: null, fastest: null, persisted: true }),
    readVocabularyPage: async () => ({ words: actual.LEVELS[0].words, total: 100000 }),
    exportCsvFile: async () => ({ filePath: '/data/footprints.csv', persisted: true }),
    exportMissingIllustrationsFile: () => '/data/pictures.json'
  }, overrides);
  const api = {
    getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value),
    showShareMenu() {}, setKeepScreenOn() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, pageScrollTo() {},
    showModal: options => modals.push(options), shareFileMessage: options => { shares.push(options); options.success(); },
    createInnerAudioContext() { const context = { stop() { audio.push('stop'); }, destroy() { audio.push('destroy'); },
      play() { audio.push(this.src); }, onError(fn) { this.error = fn; }, onEnded(fn) { this.ended = fn; } }; return context; }
  };
  const schedule = (callback, delay, repeat) => { const id = ++nextId; tasks.set(id, { callback, at: now + delay, repeat }); return id; };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  vm.runInNewContext(fs.readFileSync(path.join(pagePath, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx: api, Date: ClockDate, console,
    require: id => id === '../../lib/lingotiles' ? model : id === '../../config' ? { webOrigin: 'https://example.test' } : require(id),
    setTimeout: (callback, delay) => schedule(callback, delay, 0), clearTimeout: id => tasks.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: id => tasks.delete(id)
  });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); } });
  page.onLoad(); page.onShow();
  return { page, api, model, tasks, completions, shares, modals, audio,
    advance(ms) {
      const deadline = now + ms;
      for (;;) {
        const entry = Array.from(tasks.entries()).filter(([, task]) => task.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, task] = entry; now = task.at;
        if (task.repeat) task.at += task.repeat; else tasks.delete(id);
        task.callback();
      }
      now = deadline;
    }
  };
}

test('native memory and play clocks exclude overlapping pause/dialog time exactly once', () => {
  const h = host(), p = h.page;
  p.startMemory(); h.advance(10000); assert.equal(p.data.remaining, 50);
  p.showRules(); h.advance(5000); p.togglePause(); h.advance(3000); p.closeRules(); h.advance(2000);
  assert.equal(p.data.remaining, 50); p.togglePause(); h.advance(1000); assert.equal(p.data.remaining, 49);
  p.startPlaying(); assert.equal(p._studySeconds, 11); h.advance(4000);
  p.togglePause(); h.advance(3000); p.showRules(); h.advance(2000); p.togglePause(); h.advance(2000);
  assert.equal(p.data.elapsedText, '00:04'); p.closeRules(); h.advance(2000); assert.equal(p.data.elapsedText, '00:06');
  p.onUnload(); assert.equal(h.tasks.size, 0);
});

test('final match freezes time and saves exactly once before optional fusion completes', async () => {
  const h = host(), p = h.page;
  p.startMemory(); h.advance(1250); p.startPlaying(); p.toggleAnimation({ detail: { value: true } }); h.advance(2500);
  const solution = p._game.solution.slice();
  for (const id of solution) {
    p.pickTile(event({ id }));
    if (p.data.fusionWord && p._game.status === 'playing') {
      const moves = p._game.moves; p.pickTile(event({ id: p._game.solution[0] })); assert.equal(p._game.moves, moves);
      h.advance(p.data.fusionDuration);
    }
  }
  assert.equal(p._game.status, 'won'); assert.equal(p.data.phase, 'playing'); assert.ok(p.data.fusionWord);
  assert.equal(h.completions.length, 1); assert.equal(h.completions[0].gameSeconds, 2.5);
  assert.equal(h.completions[0].studySeconds, 1.25); assert.equal(h.completions[0].totalSeconds, 3.75);
  p.togglePause(); h.advance(5000); assert.equal(p.data.phase, 'result'); assert.equal(p.data.won, true);
  assert.equal(p.data.harvestCount, actual.LEVELS[0].words.length); assert.equal(p.data.elapsedText, '00:02');
  p.saveCompletion(); await flush(); assert.equal(h.completions.length, 1); assert.equal(p.progress.sessions, 1);
  assert.equal(p.data.historySaveState, '本次通关已保存在本机'); p.onUnload();
});

test('unavailable hints, undo and unsafe shuffle do not consume tool inventory or score', () => {
  const h = host({ getHint: () => [], shuffleBoard: game => Object.assign({}, game, { solution: [] }) }), p = h.page;
  p.startMemory(); p.startPlaying();
  p.useTool(event({ tool: 'hint' })); p.useTool(event({ tool: 'undo' })); p.useTool(event({ tool: 'shuffle' }));
  assert.deepEqual(JSON.parse(JSON.stringify(p.data.toolsLeft)), { undo: 3, hint: 2, shuffle: 2 }); assert.equal(p._assistCount, 0); p.onUnload();
});

test('lost board can be recovered by undo without counting time spent on the result screen', () => {
  const h = host(), p = h.page; p.startMemory(); p.startPlaying(); h.advance(3750);
  for (let attempt = 0; attempt < 20 && p._game.status === 'playing'; attempt++) {
    const candidate = actual.getAvailableTiles(p._game).find(tile => !actual.selectTile(p._game, tile.id).lastMatch);
    assert.ok(candidate); p.pickTile(event({ id: candidate.id }));
  }
  assert.equal(p._game.status, 'lost'); assert.equal(p.data.phase, 'result'); h.advance(8000);
  p.useTool(event({ tool: 'undo' })); assert.equal(p.data.phase, 'playing'); assert.equal(p.data.trayCount, 6);
  h.advance(1250); assert.equal(p.data.elapsedText, '00:05'); assert.equal(p.data.toolsLeft.undo, 2);
  assert.equal(h.completions.length, 0); p.onUnload();
});

test('navigation confirmation pauses the clock and keeps the current round when canceled', () => {
  const h = host(), p = h.page; p.startMemory(); h.advance(2000); p.goView('notebook');
  assert.equal(h.modals.length, 1); h.advance(7000); h.modals[0].success({ confirm: false }); h.advance(1000);
  assert.equal(p.data.view, 'game'); assert.equal(p.data.phase, 'memory'); assert.equal(p.data.remaining, 57);
  p.goView('notebook'); h.modals[1].success({ confirm: true }); assert.equal(p.data.view, 'notebook'); assert.equal(p.data.phase, 'ready'); p.onUnload();
});

test('obsolete notebook search is canceled and cannot replace a newer result', async () => {
  const pending = [];
  const h = host({ searchVocabulary: (query, options) => new Promise(resolve => pending.push({ query, options, resolve })) }), p = h.page;
  p.update({ notebookQuery: 'first' }); const first = p.loadNotebook(); p.update({ notebookQuery: 'second' }); const second = p.loadNotebook();
  assert.throws(() => pending[0].options.signal.throwIfAborted(), /检索已取消/);
  pending[1].resolve({ words: [actual.LEVELS[0].words[1]], total: 1 }); await second;
  pending[0].resolve({ words: [actual.LEVELS[0].words[0]], total: 1 }); await first;
  assert.equal(p.data.notebookWords[0].id, actual.LEVELS[0].words[1].id); assert.equal(p.data.notebookTotal, 1); p.onUnload();
});

test('CSV and missing-illustration exports share real generated paths, including string helper result', async () => {
  const h = host(), p = h.page; await p.exportHistory(); await p.exportMissing();
  assert.equal(h.shares[0].filePath, '/data/footprints.csv'); assert.match(h.shares[0].fileName, /\.csv$/);
  assert.equal(h.shares[1].filePath, '/data/pictures.json'); assert.match(h.shares[1].fileName, /\.json$/);
  assert.equal(p.data.exporting, false); p.onUnload();
});

test('leaving the notebook cancels queued and in-flight full-library searches', async () => {
  const pending = [];
  const h = host({ searchVocabulary: (query, options) => new Promise(resolve => pending.push({ options, resolve })) }), p = h.page;
  p.update({ view: 'notebook', notebookQuery: 'apple' });
  const search = p.loadNotebook();
  p.notebookSearch({ detail: { value: 'leaf' } });
  p.goView('game');
  assert.throws(() => pending[0].options.signal.throwIfAborted(), /检索已取消/);
  h.advance(400);
  assert.equal(pending.length, 1, 'the queued query must never start after leaving');
  pending[0].resolve({ words: [actual.LEVELS[0].words[0]], total: 1 });
  await search;
  assert.equal(p.data.view, 'game');
  assert.equal(p.data.notebookWords.length, 0);
  p.onUnload();
});

test('network pronunciation uses the same-origin endpoint and presents audio failures truthfully', () => {
  const h = host(), p = h.page; p.playWord('look up');
  assert.equal(h.audio.at(-1), 'https://example.test/api/lingotiles/pronounce?word=look%20up');
  p._audio.error({ errMsg: 'network error' }); assert.match(p.data.notice, /暂时无法播放发音/);
  p.onUnload(); assert.equal(h.audio.at(-1), 'destroy');
});

test('background time remains real while explicit pause remains excluded after returning', () => {
  const h = host(), p = h.page; p.startMemory(); p.onHide(); h.advance(61000); p.onShow(); assert.equal(p.data.phase, 'playing');
  h.advance(3000); p.togglePause(); p.onHide(); h.advance(20000); p.onShow(); assert.equal(p.data.elapsedText, '00:03');
  p.togglePause(); h.advance(1000); assert.equal(p.data.elapsedText, '00:04'); p.onUnload();
});

test('all native template handlers exist and mobile board has all seven tray slots', () => {
  const h = host(), p = h.page;
  const wxml = fs.readFileSync(path.join(pagePath, 'index.wxml'), 'utf8');
  for (const match of wxml.matchAll(/(?:bind|catch)(?:tap|input|confirm|change|error|touchmove)="([^"]+)"/g)) assert.equal(typeof p[match[1]], 'function', match[1]);
  assert.doesNotMatch(wxml, /<web-view\b/); p.startMemory(); p.startPlaying(); assert.equal(p._game.boardWidth, 4); assert.equal(p.data.tray.length, 7);
  p.onUnload();
});
