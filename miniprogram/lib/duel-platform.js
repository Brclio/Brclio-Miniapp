'use strict';

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readWindowInfo(api) {
  try {
    if (typeof api.getWindowInfo === 'function') {
      const info = api.getWindowInfo();
      if (info && typeof info === 'object') return info;
    }
    if (typeof api.getSystemInfoSync === 'function') {
      const info = api.getSystemInfoSync();
      if (info && typeof info === 'object') return info;
    }
  } catch (_) {}
  return { windowWidth: 390, windowHeight: 740, pixelRatio: 1 };
}

// Adapt a page-owned 2D Canvas to the shared game's platform contract. No
// global wx listeners, browser objects, or second set of game rules are used.
function createDuelPlatform(options) {
  const api = options.wx;
  const canvas = options.canvas;
  const listeners = Object.create(null);
  const frames = new Map();
  const images = new Set();
  let nativeInfo = options.windowInfo || readWindowInfo(api);
  let bounds = options.bounds || {};
  let disposed = false;
  let visible = true;
  let keepScreenOn = false;
  let nextFrame = 0;

  function windowInfo() {
    const width = positive(bounds.width, positive(nativeInfo.windowWidth, 390));
    const height = positive(bounds.height, positive(nativeInfo.windowHeight, 740));
    const safe = nativeInfo.safeArea;
    // Convert screen-based safeArea into the page Canvas's local coordinates.
    // Native navigation already contains the capsule; do not reserve it twice.
    const pageTop = positive(nativeInfo.screenTop, Math.max(0, (nativeInfo.screenHeight || height) - (nativeInfo.windowHeight || height)));
    const canvasTop = pageTop + (bounds.top || 0);
    const safeTop = safe && typeof safe.top === 'number' ? Math.min(height, Math.max(0, safe.top - canvasTop)) : 0;
    const safeBottom = safe && typeof safe.bottom === 'number' ? Math.min(height, Math.max(safeTop, safe.bottom - canvasTop)) : height;
    return Object.assign({}, nativeInfo, {
      windowWidth: width,
      windowHeight: height,
      pixelRatio: positive(nativeInfo.pixelRatio, 1),
      safeArea: { left: 0, right: width, top: safeTop, bottom: safeBottom, width, height: safeBottom - safeTop }
    });
  }

  function on(name, callback) {
    if (disposed || typeof callback !== 'function') return;
    if (!listeners[name]) listeners[name] = [];
    if (listeners[name].indexOf(callback) === -1) listeners[name].push(callback);
  }

  function off(name, callback) {
    if (!listeners[name]) return;
    listeners[name] = callback ? listeners[name].filter(function (item) { return item !== callback; }) : [];
  }

  function emit(name, event) {
    if (disposed) return;
    return (listeners[name] || []).slice().map(function (callback) { return callback(event); });
  }

  function cancelFrame(id) {
    const entry = frames.get(id);
    if (!entry) return;
    frames.delete(id);
    if (entry.native && typeof canvas.cancelAnimationFrame === 'function') canvas.cancelAnimationFrame(entry.id);
    else clearTimeout(entry.id);
  }

  function cancelFrames() {
    Array.from(frames.keys()).forEach(cancelFrame);
  }

  function requestFrame(callback) {
    if (disposed) return null;
    const id = ++nextFrame;
    const entry = { native: typeof canvas.requestAnimationFrame === 'function' && typeof canvas.cancelAnimationFrame === 'function', id: null };
    frames.set(id, entry);
    const run = function (time) {
      frames.delete(id);
      if (!disposed && visible) callback(time);
    };
    entry.id = entry.native ? canvas.requestAnimationFrame(run) : setTimeout(function () { run(Date.now()); }, 16);
    return id;
  }

  function safeOptions(value) {
    const result = Object.assign({}, value);
    ['success', 'fail', 'complete'].forEach(function (name) {
      if (typeof result[name] !== 'function') return;
      const callback = result[name];
      result[name] = function (response) { if (!disposed) callback(response); };
    });
    return result;
  }

  function invoke(name, value) {
    if (disposed || typeof api[name] !== 'function') return;
    return api[name](safeOptions(value));
  }

  function applyKeepScreenOn(value) {
    if (typeof api.setKeepScreenOn === 'function') api.setKeepScreenOn({ keepScreenOn: value, fail: function () {} });
  }

  function normalizeTouch(touch) {
    // Canvas touch.x/y are local. General Touch.clientX/Y are page-relative.
    const x = typeof touch.clientX === 'number' ? touch.clientX - (bounds.left || 0) : touch.x;
    const y = typeof touch.clientY === 'number' ? touch.clientY - (bounds.top || 0) : touch.y;
    return Object.assign({}, touch, { x, y, clientX: x, clientY: y });
  }

  const platform = {
    cloudBackupSupported: false,
    createCanvas: function () { return canvas; },
    createWebAudioContext: function () { if (!disposed && typeof api.createWebAudioContext === 'function') return api.createWebAudioContext(); },
    createInnerAudioContext: function (options) { if (!disposed && typeof api.createInnerAudioContext === 'function') return api.createInnerAudioContext(options); },
    createImage: function () {
      if (disposed || typeof canvas.createImage !== 'function') return null;
      const image = canvas.createImage();
      images.add(image);
      return image;
    },
    // Mini-program Performance is not the mini-game microsecond clock.
    // The shared game deliberately falls back to Date.now() in milliseconds.
    getPerformance: function () { return null; },
    getWindowInfo: windowInfo,
    getSystemInfoSync: windowInfo,
    getMenuButtonBoundingClientRect: function () {
      if (!options.customNavigation || typeof api.getMenuButtonBoundingClientRect !== 'function') return null;
      const rect = api.getMenuButtonBoundingClientRect();
      if (!rect) return null;
      const pageTop = positive(nativeInfo.screenTop, Math.max(0, (nativeInfo.screenHeight || bounds.height) - (nativeInfo.windowHeight || bounds.height)));
      const canvasTop = pageTop + (bounds.top || 0);
      return Object.assign({}, rect, { top: rect.top - canvasTop, bottom: rect.bottom - canvasTop });
    },
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
    showModal: function (value) { return invoke('showModal', value); },
    setClipboardData: function (value) { return invoke('setClipboardData', value); },
    vibrateShort: function (value) { return invoke('vibrateShort', value); },
    showShareMenu: function (value) { return invoke('showShareMenu', value); },
    setKeepScreenOn: function (value) {
      if (disposed) return;
      keepScreenOn = !!value.keepScreenOn;
      return invoke('setKeepScreenOn', Object.assign({}, value, { keepScreenOn: visible && keepScreenOn }));
    },
    updateViewport: function (nextBounds, nextInfo) {
      if (disposed) return;
      bounds = nextBounds;
      nativeInfo = nextInfo || readWindowInfo(api);
      emit('WindowResize', { size: { windowWidth: bounds.width, windowHeight: bounds.height } });
    },
    emitTouch: function (phase, event) {
      if (disposed || !visible) return;
      const source = event || {};
      const normalized = Object.assign({}, source, {
        touches: (source.touches || []).map(normalizeTouch),
        changedTouches: (source.changedTouches || source.touches || []).map(normalizeTouch)
      });
      emit('Touch' + phase, normalized);
    },
    show: function () {
      if (disposed) return;
      visible = true;
      if (keepScreenOn) applyKeepScreenOn(true);
      emit('Show');
    },
    hide: function () {
      if (disposed) return;
      visible = false;
      emit('Hide');
      cancelFrames();
      applyKeepScreenOn(false);
    },
    shareAppMessage: function (event) {
      const values = emit('ShareAppMessage', event) || [];
      return values[values.length - 1] || {};
    },
    shareTimeline: function (event) {
      const values = emit('ShareTimeline', event) || [];
      return values[values.length - 1] || {};
    },
    dispose: function () {
      if (disposed) return;
      platform.hide();
      disposed = true;
      keepScreenOn = false;
      Object.keys(listeners).forEach(function (name) { delete listeners[name]; });
      images.forEach(function (image) { image.onload = null; image.onerror = null; });
      images.clear();
      canvas.width = 1;
      canvas.height = 1;
    }
  };

  ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Show', 'Hide', 'WindowResize', 'ShareAppMessage', 'ShareTimeline'].forEach(function (name) {
    platform['on' + name] = function (callback) { on(name, callback); };
    platform['off' + name] = function (callback) { off(name, callback); };
  });

  return platform;
}

module.exports = { createDuelPlatform, readWindowInfo };
