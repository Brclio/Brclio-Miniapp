'use strict';

// Offline component harness: JSDOM never loads resources or executes scripts.
// Audio, images and Canvas below are explicit test doubles, not media proofs.
// It temporarily installs process globals: run harness instances sequentially.
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { buildSync } = require('esbuild');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const runtime = createRequire(require.resolve('@brclio/ready-go-duel-runtime/package.json', { paths: [root] }));
const appPath = path.join(root, 'web/projects/ready-go-duel/App.tsx');
const INITIAL_TIME = 1800000000000;
let compiledApp;

function appCode() {
  if (!compiledApp) {
    compiledApp = buildSync({
      absWorkingDir: root,
      entryPoints: [appPath],
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      target: 'node20',
      write: false,
      define: { 'process.env.NODE_ENV': '"development"' }
    }).outputFiles[0].text;
  }
  return compiledApp;
}

async function createReadyGoHarness(t, { storage = {}, accountRuntime } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://readygo.test/'
    // Deliberately no resources or runScripts option: external counter scripts,
    // image elements and user supplied scripts cannot initiate network I/O.
  });
  const { window } = dom;
  const { document } = window;
  const alerts = [];
  const audioEvents = [];
  const canvasExports = [];
  const imageRequests = [];
  const drawTexts = [];
  const pending = new Map();
  const frames = new Map();
  const fileContents = new WeakMap();
  const globalDescriptors = new Map();
  let now = INITIAL_TIME;
  let sequence = 0;
  let mediaSequence = 0;
  let closed = false;
  let reactRoot;
  let act;

  const math = Object.create(Math);
  math.random = () => 0;
  const NativeDate = Date;
  class VirtualDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const performance = { now: () => now - INITIAL_TIME, timeOrigin: INITIAL_TIME };
  const networkDisabled = () => { throw new Error('Network is disabled in the ReadyGo component harness'); };
  const schedule = (callback, delay = 0, repeat = false, args = []) => {
    if (typeof callback !== 'function') throw new TypeError('Only function timers are supported');
    const id = ++sequence;
    const milliseconds = Math.max(repeat ? 1 : 0, Number(delay) || 0);
    pending.set(id, { id, callback, at: now + milliseconds, repeat, delay: milliseconds, args });
    return id;
  };
  const setTimeout = (fn, delay, ...args) => schedule(fn, delay, false, args);
  const setInterval = (fn, delay, ...args) => schedule(fn, delay, true, args);
  const clearTimeout = id => pending.delete(id);
  const clearInterval = clearTimeout;
  // Confetti can request a frame, but the harness never runs a frame loop.
  const requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  const cancelAnimationFrame = id => frames.delete(id);
  const alert = message => alerts.push(String(message));

  function replaceGlobal(name, value) {
    globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  function parameter(owner, name, initial) {
    let value = initial;
    const record = (event, next, time) => {
      value = next;
      audioEvents.push({ event: `${name}.${event}`, kind: `${name}.${event}`, ...owner, value: next, time });
    };
    return {
      get value() { return value; },
      set value(next) { record('value', next, undefined); },
      setValueAtTime(next, time) { record('setValueAtTime', next, time); return this; },
      exponentialRampToValueAtTime(next, time) { record('exponentialRampToValueAtTime', next, time); return this; },
      linearRampToValueAtTime(next, time) { record('linearRampToValueAtTime', next, time); return this; }
    };
  }
  class AudioContext {
    constructor() { this.state = 'running'; this.destination = { kind: 'audioDestination' }; }
    get currentTime() { return (now - INITIAL_TIME) / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createOscillator() {
      const oscillatorId = ++mediaSequence;
      audioEvents.push({ event: 'createOscillator', kind: 'createOscillator', oscillatorId });
      const oscillator = {
        type: 'sine',
        frequency: parameter({ oscillatorId }, 'frequency', 440),
        connect() {},
        disconnect() {},
        start(time = 0) {
          audioEvents.push({ event: 'start', kind: 'start', oscillatorId, time, type: this.type, frequency: this.frequency.value });
        },
        stop(time = 0) { audioEvents.push({ event: 'stop', kind: 'stop', oscillatorId, time, type: this.type }); }
      };
      return oscillator;
    }
    createGain() {
      const gainId = ++mediaSequence;
      audioEvents.push({ event: 'createGain', kind: 'createGain', gainId });
      return { gain: parameter({ gainId }, 'gain', 1), connect() {}, disconnect() {} };
    }
  }

  const contexts = new WeakMap();
  const contextFor = canvas => {
    if (!contexts.has(canvas)) {
      contexts.set(canvas, {
        canvas, font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000', textAlign: 'start',
        textBaseline: 'alphabetic', globalAlpha: 1, lineWidth: 1,
        clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
        translate() {}, rotate() {}, scale() {}, setTransform() {},
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
        arc() {}, rect() {}, fill() {}, stroke() {}, drawImage() {},
        measureText(text) {
          const fontSize = Number.parseFloat(this.font.match(/([\d.]+)px/)?.[1] || '10');
          return { width: Array.from(String(text)).length * fontSize * 0.6 };
        },
        fillText(text, x, y) {
          drawTexts.push({ text: String(text), x, y, font: this.font, fillStyle: this.fillStyle,
            textAlign: this.textAlign, width: canvas.width, height: canvas.height });
        }
      });
    }
    return contexts.get(canvas);
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') throw new Error(`Unsupported Canvas context: ${type}`);
    return contextFor(this);
  };
  window.HTMLCanvasElement.prototype.toDataURL = function toDataURL(mimeType = 'image/png') {
    const marker = `READYGO_TEST_CANVAS_NOT_A_PNG:${this.width}x${this.height}:${canvasExports.length + 1}`;
    const dataUrl = 'data:application/x-readygo-test-canvas;base64,' + Buffer.from(marker).toString('base64');
    canvasExports.push({ width: this.width, height: this.height, mimeType, type: mimeType, marker, dataUrl });
    return dataUrl;
  };
  class Image {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null; }
    get src() { return this._src || ''; }
    set src(value) {
      this._src = String(value);
      imageRequests.push(this._src);
      setTimeout(() => {
        this.complete = true;
        this.naturalWidth = this.naturalHeight = 350;
        this.onload?.({ type: 'load', target: this });
      }, 0);
    }
  }
  class FileReader {
    constructor() { this.result = null; this.error = null; this.readyState = 0; this.onload = null; this.onerror = null; }
    readAsText(file) {
      if (!fileContents.has(file)) throw new Error('Use harness.upload() to provide an offline file');
      this.readyState = 1;
      this._timer = setTimeout(() => {
        this.result = fileContents.get(file);
        this.readyState = 2;
        this.onload?.({ type: 'load', target: this });
      }, 0);
    }
    abort() { clearTimeout(this._timer); this.readyState = 2; }
  }

  const environment = {
    window, document, navigator: window.navigator, localStorage: window.localStorage,
    HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement, Node: window.Node, Element: window.Element,
    Event: window.Event, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
    Image, FileReader, AudioContext, alert, Date: VirtualDate, performance,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame,
    fetch: networkDisabled, XMLHttpRequest: networkDisabled, WebSocket: networkDisabled,
    EventSource: networkDisabled, IS_REACT_ACT_ENVIRONMENT: true
  };
  for (const [name, value] of Object.entries(environment)) replaceGlobal(name, value);
  for (const [name, value] of Object.entries({ ...environment, Math: math })) {
    if (name !== 'window' && name !== 'document' && name !== 'navigator' && name !== 'localStorage') {
      Object.defineProperty(window, name, { configurable: true, writable: true, value });
    }
  }
  Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: networkDisabled });
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, String(value));
  if (accountRuntime) window.BrclioAccount = typeof accountRuntime === 'function' ? accountRuntime(window) : accountRuntime;
  if (window.BrclioAccount?.ready) await window.BrclioAccount.ready;

  const React = runtime('react');
  ({ act } = React);
  // React DOM must initialize after the DOM globals exist; all dependencies
  // resolve through the same isolated upstream runtime, including jsx-runtime.
  const { createRoot } = runtime('react-dom/client');

  function loadApp() {
    const module = { exports: {} };
    const context = vm.createContext({ ...environment, console, Math: math, module, exports: module.exports,
      require: runtime, __filename: appPath, __dirname: path.dirname(appPath) });
    new vm.Script(appCode(), { filename: appPath }).runInContext(context);
    return module.exports.default;
  }
  const nextTimer = limit => [...pending.values()].filter(timer => timer.at <= limit)
    .sort((a, b) => a.at - b.at || a.id - b.id)[0];
  async function runTimer(timer) {
    if (!pending.has(timer.id)) return;
    if (timer.repeat) timer.at += timer.delay;
    else pending.delete(timer.id);
    await act(async () => { timer.callback.apply(window, timer.args); await Promise.resolve(); });
  }
  async function flushCurrent() {
    await act(async () => { await Promise.resolve(); });
    let count = 0;
    for (let timer; (timer = nextTimer(now));) {
      if (++count > 1000) throw new Error('Too many immediate virtual timers');
      await runTimer(timer);
    }
    await act(async () => { await Promise.resolve(); });
  }
  async function action(callback) {
    if (closed) throw new Error('ReadyGo harness is closed');
    await act(async () => { callback(); await Promise.resolve(); });
    await flushCurrent();
  }
  const normalize = text => String(text).replace(/\s+/gu, ' ').trim();
  function query(elements, value, describe, read) {
    const target = normalize(value);
    const matches = elements.filter(element => normalize(read(element)) === target);
    return { matches, error: () => new Error(`${describe} ${JSON.stringify(value)} not found; available: ${elements.map(el => JSON.stringify(normalize(read(el)))).join(', ')}`) };
  }
  const harness = {
    document, window, alerts, audioEvents, canvasExports, imageRequests, drawTexts, act,
    now: () => now,
    queryButton(text, index = 0) {
      const found = query([...document.querySelectorAll('button')], text, 'Button', element => element.textContent);
      if (!found.matches[index]) throw found.error();
      return found.matches[index];
    },
    queryTitle(title, index = 0) {
      const found = query([...document.querySelectorAll('[title]')], title, 'Title', element => element.getAttribute('title'));
      if (!found.matches[index]) throw found.error();
      return found.matches[index];
    },
    async click(element) {
      if (!element) throw new TypeError('click requires an element');
      await action(() => {
        // Pointer events drive the actual player zones; click drives buttons.
        for (const type of ['pointerdown', 'pointerup', 'click']) {
          const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
          Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 }, isPrimary: { value: true } });
          element.dispatchEvent(event);
        }
      });
    },
    async input(element, value) {
      if (!element) throw new TypeError('input requires an element');
      await action(() => {
        const prototype = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(value));
        element.dispatchEvent(new window.Event('input', { bubbles: true }));
        element.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
    },
    async key(key, code = key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key) {
      await action(() => {
        window.dispatchEvent(new window.KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
        window.dispatchEvent(new window.KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
      });
    },
    async advance(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new TypeError('advance needs non-negative milliseconds');
      if (closed) throw new Error('ReadyGo harness is closed');
      await flushCurrent();
      const target = now + milliseconds;
      let count = 0;
      for (let timer; (timer = nextTimer(target));) {
        if (++count > 10000) throw new Error('Too many virtual timers');
        now = timer.at;
        await runTimer(timer);
        await flushCurrent();
      }
      now = target;
      await flushCurrent();
    },
    async upload(element, text, name = 'rewards.txt') {
      const file = new window.File([String(text)], name, { type: 'text/plain', lastModified: now });
      fileContents.set(file, String(text));
      const files = [file];
      files.item = index => files[index] || null;
      Object.defineProperty(element, 'files', { configurable: true, value: files });
      await action(() => element.dispatchEvent(new window.Event('change', { bubbles: true })));
    },
    async remount() {
      if (closed) throw new Error('ReadyGo harness is closed');
      if (reactRoot) await act(async () => reactRoot.unmount());
      frames.clear();
      reactRoot = createRoot(document.getElementById('root'));
      const App = loadApp();
      await act(async () => reactRoot.render(React.createElement(App)));
      await flushCurrent();
      return harness;
    },
    async close() {
      if (closed) return;
      try {
        if (reactRoot) await act(async () => reactRoot.unmount());
      } finally {
        closed = true;
        pending.clear();
        frames.clear();
        try { window.BrclioAccount?.destroy?.(); } catch (_) {}
        dom.window.close();
        for (const [name, descriptor] of globalDescriptors) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
      }
    }
  };
  t?.after(() => harness.close());
  try { await harness.remount(); }
  catch (error) { await harness.close(); throw error; }
  return harness;
}

module.exports = { createReadyGoHarness };
