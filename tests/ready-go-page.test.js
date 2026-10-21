'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createReadyGo } = require('../miniprogram/lib/ready-go-model');

function host() {
  let definition; let time = 1800000000000; let nextId = 0; let query;
  const tasks = new Map(); const values = {}; const sounds = []; const removed = []; const keeps = []; const toasts = []; const navigations = [];
  const sound = { unlock() { sounds.push('unlock'); }, play(type, mode) { sounds.push([type, mode]); }, setEnabled(enabled) { sounds.push(['enabled', enabled]); }, stop() { sounds.push('stop'); }, dispose() { sounds.push('dispose'); } };
  const api = {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 780, statusBarHeight: 47 }),
    getStorageSync: (key) => values[key], setStorageSync: (key, value) => { values[key] = value; }, removeStorageSync: (key) => { delete values[key]; },
    setKeepScreenOn: ({ keepScreenOn }) => keeps.push(keepScreenOn), showShareMenu() {},
    showToast: (value) => toasts.push(value.title), navigateTo: (value) => navigations.push(value.url),
    getFileSystemManager: () => ({ unlink: ({ filePath }) => removed.push(filePath) }),
    canvasToTempFilePath(value) { api.pendingExport = value; }
  };
  let reportPromise = Promise.resolve({ width: 600, height: 800 });
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/duel/index.js'), 'utf8');
  vm.runInNewContext(source, { wx: api, Page: (value) => { definition = value; },
    setTimeout(callback, delay) { const id = ++nextId; tasks.set(id, { callback, at: time + delay }); return id; }, clearTimeout: (id) => tasks.delete(id),
    require(id) {
      if (id === './legacy') return { data: {} };
      if (id === '../../lib/duel') return { createDuelAudio: () => sound };
      if (id === '../../lib/ready-go-model') return { createReadyGo: (options) => createReadyGo(Object.assign({}, options, { now: () => time, random: () => 0 })) };
      if (id === '../../lib/ready-go-report') return { drawReadyGoReport: () => reportPromise };
      throw new Error('Unexpected require ' + id);
    }
  });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); }, createSelectorQuery() { return { select: () => ({ fields: () => ({ exec(callback) { query = callback; } }) }) }; } });
  page.onLoad({}); page.onShow();
  return { page, api, tasks, sounds, removed, keeps, toasts, navigations,
    async resolveQuery() { if (query) await query([{ node: {} }]); },
    pendingReport() { let resolve; reportPromise = new Promise((done) => { resolve = done; }); return () => resolve({ width: 600, height: 800 }); },
    advance(ms) { const deadline = time + ms; for (;;) { const entry = Array.from(tasks.entries()).filter(([, task]) => task.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; tasks.delete(entry[0]); time = entry[1].at; entry[1].callback(); } time = deadline; }
  };
}
const player = (id) => ({ currentTarget: { dataset: { player: id } } });
const mode = (value) => ({ currentTarget: { dataset: { mode: value } } });

test('native default opens original duel, plays start, GO, win and false-start sounds, and exposes optional score extension', () => {
  const h = host(); const p = h.page;
  assert.equal(p.data.view, 'original'); assert.equal(p.data.gameState, 'IDLE');
  p.openRewards(); assert.equal(p.data.showRewardInput, true);
  p.launchRound(); assert.equal(p.data.gameState, 'WAITING'); assert.ok(h.sounds.some((s) => Array.isArray(s) && s[0] === 'start'));
  h.advance(2000); assert.equal(p.data.gameState, 'GO'); assert.ok(h.sounds.some((s) => Array.isArray(s) && s[0] === 'go'));
  h.advance(207); p.playerTouch(player('p2')); assert.equal(p.data.winner, 'p2'); assert.equal(p.data.reactionTime, 207);
  assert.ok(h.sounds.some((s) => Array.isArray(s) && s[0] === 'win'));
  p.launchRound(); p.playerTouch(player('p1')); assert.equal(p.data.winner, 'p2'); assert.equal(p.data.winReason, 'FALSE_START');
  assert.ok(h.sounds.some((s) => Array.isArray(s) && s[0] === 'false'));
  p.toggleSound(); assert.equal(p.data.soundEnabled, false); assert.ok(h.sounds.some((s) => Array.isArray(s) && s[0] === 'enabled' && s[1] === false));
  p.openMatch(); assert.deepEqual(h.navigations, ['/pages/duel/index?view=match']); p.onUnload();
});

test('hide stops all round and confetti timers; show does not resurrect GO or score', () => {
  const h = host(); h.page.launchRound(); h.page.onHide();
  assert.equal(h.tasks.size, 0); assert.equal(h.page.data.gameState, 'IDLE'); assert.equal(h.keeps.at(-1), false);
  h.advance(60000); h.page.onShow(); assert.equal(h.page.data.gameState, 'IDLE');
  h.page.switchMode(mode('INFINITE')); h.page.launchRound(); h.advance(2000); h.page.playerTouch(player('p1'));
  assert.equal(h.page.data.infiniteStats.length, 1); assert.ok(h.tasks.size > 0);
  h.page.onUnload(); assert.equal(h.tasks.size, 0); assert.equal(h.keeps.at(-1), false); assert.equal(h.sounds.at(-1), 'dispose');
});

test('canceled report generation resets controls and stale exported images are deleted', async () => {
  const h = host(); h.page.generateReport(); assert.equal(h.page.data.isGeneratingReport, true);
  h.page.onHide(); await h.resolveQuery(); assert.equal(h.page.data.isGeneratingReport, false); assert.equal(h.api.pendingExport, undefined);
  h.page.onShow(); h.page.generateReport(); await h.resolveQuery(); assert.ok(h.api.pendingExport);
  h.page.switchMode(mode('INFINITE')); h.api.pendingExport.success({ tempFilePath: '/tmp/stale-report.png' }); h.api.pendingExport.complete();
  assert.deepEqual(h.removed, ['/tmp/stale-report.png']); assert.equal(h.page.data.showReportModal, false);
  assert.equal(h.page.data.isGeneratingReport, false); h.page.onUnload();
});

test('hide during image decoding leaves report generation retryable', async () => {
  const h = host(); const resolve = h.pendingReport(); h.page.generateReport(); const query = h.resolveQuery();
  h.page.onHide(); resolve(); await query;
  assert.equal(h.page.data.isGeneratingReport, false); assert.equal(h.api.pendingExport, undefined); h.page.onUnload();
});

test('native original screen has no microphone permissions or hidden voice dependency', () => {
  const files = ['../miniprogram/pages/duel/index.js', '../miniprogram/pages/duel/index.wxml', '../miniprogram/lib/ready-go-model.js'];
  files.forEach((file) => assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), /scope\.record|getRecorderManager|createReadyGoVoice|data-mode="VOICE"/));
});
