'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const { adaptOriginal } = require('../web/projects/ready-go-duel/adapt-original.cjs');

const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'web/projects/ready-go-duel');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

test('the fixed upstream snapshot is intact and only the approved adaptations produce the app', () => {
  const source = fs.readFileSync(path.join(moduleRoot, 'App.tsx'), 'utf8');
  const upstreamSource = fs.readFileSync(path.join(moduleRoot, 'upstream/App.tsx'), 'utf8');
  assert.equal(sha256(upstreamSource.trimEnd()), '12a816d6451e45be34d4a9c9cd9b583a2ee088ed40a74b69a08e1d8578777363');
  assert.equal(source, adaptOriginal(upstreamSource));
  assert.equal(sha256(fs.readFileSync(path.join(moduleRoot, 'assets/ReadyGoDuel.png'))), '8fc05e6375191a56647947fe8507915d7ac5af83f4e2e55f88821cb566fa1e6d');
});

test('the registered default is original React and preserves the existing scoring extension', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'projects.config.json'), 'utf8'));
  const project = registry.projects.find(item => item.id === 'ready-go-duel');
  assert.equal(project.kind, 'react');
  assert.equal(project.entry, 'main.tsx');
  assert.equal(project.tailwind, 'index.css');
  assert.equal(project.canvasExtension.target, 'match');
  const html = fs.readFileSync(path.join(moduleRoot, project.html), 'utf8');
  assert.match(html, /class="module-navigation"/);
  assert.match(html, /href="\.\/match\/"/);
  assert.match(html, /src="\.\/main\.js"/);
  const extension = fs.readFileSync(path.join(moduleRoot, 'match/index.html'), 'utf8');
  assert.match(extension, /src="\.\/bundle\.js"/);
  assert.match(extension, /href="\.\.\/"/);
});

test('the approved voice removal leaves no microphone, recording or replay capability', () => {
  const app = fs.readFileSync(path.join(moduleRoot, 'App.tsx'), 'utf8');
  assert.doesNotMatch(app, /VOICE|MediaRecorder|getUserMedia|mediaDevices|micStream|createMediaStreamSource|audioBlob|replay/i);
  assert.doesNotMatch(app, /声控|麦克风|录音|回放/);
  const build = fs.readFileSync(path.join(root, 'scripts/build-web.js'), 'utf8');
  assert.match(build, /microphone=\(\)/);
  assert.doesNotMatch(build, /microphone=\(self\)/);
});

test('the actual original Web Audio generator retains start, GO and the accessible test tone', () => {
  const source = fs.readFileSync(path.join(moduleRoot, 'App.tsx'), 'utf8');
  const soundSource = source.slice(source.indexOf('const safePlaySound ='), source.indexOf('// --- Canvas 绘制圆角矩形辅助函数 ---'));
  const oscillators = [];
  const gains = [];
  const parameter = () => ({
    events: [],
    setValueAtTime(value, time) { this.events.push(['set', value, time]); },
    exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); },
    linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }
  });
  class AudioContext {
    constructor() { this.currentTime = 7; this.state = 'running'; this.destination = {}; }
    createOscillator() {
      const osc = { frequency: parameter(), connect() {}, start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } };
      oscillators.push(osc);
      return osc;
    }
    createGain() { const gain = { gain: parameter(), connect() {} }; gains.push(gain); return gain; }
  }
  const sandbox = { window: { AudioContext }, exports: {}, console };
  vm.runInNewContext(transformSync('let sharedAudioCtx = null;\n' + soundSource + '\nexports.play = safePlaySound;', { loader: 'ts', format: 'cjs' }).code, sandbox);
  sandbox.exports.play('start', 'TOUCH');
  assert.equal(oscillators[0].type, 'sine');
  assert.deepEqual(oscillators[0].frequency.events, [['set', 440, 7], ['exponential', 880, 7.1]]);
  assert.deepEqual(gains[0].gain.events, [['set', 0.3, 7], ['exponential', 0.01, 7.1]]);
  assert.equal(oscillators[0].stopTime, 7.1);
  sandbox.exports.play('go', 'TOUCH');
  assert.equal(oscillators[1].type, 'square');
  assert.equal(oscillators[1].stopTime, 7.3);
  sandbox.exports.play('test', 'TOUCH');
  assert.equal(oscillators[2].type, 'triangle');
  assert.equal(oscillators[2].stopTime, 7.5);
  assert.match(source, /onClick=\{\(\) => safePlaySound\('test', gameMode\)\}/);
  sandbox.exports.play('false', 'TOUCH');
  assert.equal(oscillators[3].type, 'sawtooth');
  sandbox.exports.play('win', 'TOUCH');
  assert.deepEqual(oscillators.slice(5).map(osc => osc.frequency.value), [523.25, 659.25, 783.99]);
});
