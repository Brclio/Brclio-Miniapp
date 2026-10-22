(function () {
  'use strict';
  const viewport = document.getElementById('game-viewport');
  const mainCanvas = document.getElementById('game-canvas');
  const status = document.getElementById('runtime-status');
  const overlay = document.getElementById('modal');
  const app = document.querySelector('.app-content');
  const listeners = { touchStart: [], touchMove: [], touchEnd: [], touchCancel: [], hide: [], show: [], resize: [], error: [] };
  const pointers = new Map();
  const storagePrefix = 'brclio-minigame:';
  const hasNativeTouch = 'ontouchstart' in window;
  let mainCanvasClaimed = false;
  let toastTimer;
  let modalResolve;
  let shareHandler;
  let resizeFrame = null;
  let wakeLock = null;
  let keepAwake = false;
  let accountScope;
  function accountStorage() {
    const account = window.BrclioAccount;
    if (!account) return null;
    const scope = account.getScope ? account.getScope() : account.sync.getScope();
    if (accountScope !== undefined && accountScope !== scope) throw new Error('账号已变化，请重新打开当前模块。');
    return account.storage;
  }

  function viewportHeight() {
    const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', Math.round(height) + 'px');
  }
  viewportHeight();

  function windowInfo() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const safe = getComputedStyle(document.getElementById('safe-area-probe'));
    const top = Math.min(height, parseFloat(safe.paddingTop) || 0);
    const bottom = Math.max(top, height - (parseFloat(safe.paddingBottom) || 0));
    return { pixelRatio: window.devicePixelRatio || 1, windowWidth: width, windowHeight: height, screenWidth: width, screenHeight: height, statusBarHeight: 0, screenTop: 0, safeArea: { left: 0, right: width, top: top, bottom: bottom, width: width, height: bottom - top } };
  }

  function complete(options, value) {
    if (options && typeof options.success === 'function') options.success(value);
    if (options && typeof options.complete === 'function') options.complete(value);
    return value;
  }
  function failure(options, error) {
    const result = { errMsg: error && error.message || String(error) };
    if (options && typeof options.fail === 'function') options.fail(result);
    if (options && typeof options.complete === 'function') options.complete(result);
    return result;
  }
  function emit(name, event) { listeners[name].slice().forEach(function (listener) { listener(event); }); }
  function on(name, listener) { if (typeof listener === 'function' && !listeners[name].includes(listener)) listeners[name].push(listener); }
  function off(name, listener) { listeners[name] = listener ? listeners[name].filter(function (item) { return item !== listener; }) : []; }

  function toast(options) {
    const opts = typeof options === 'string' ? { title: options } : options || {};
    const node = document.getElementById('toast');
    node.textContent = opts.title || '';
    node.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('visible'); }, opts.duration || 2200);
    complete(opts, { errMsg: 'showToast:ok' });
  }

  function closeModal(confirm) {
    overlay.hidden = true;
    app.inert = false;
    if (modalResolve) {
      const resolve = modalResolve;
      modalResolve = null;
      resolve({ confirm: confirm, cancel: !confirm, errMsg: 'showModal:ok' });
    }
    mainCanvas.focus({ preventScroll: true });
  }

  function modal(options) {
    const opts = options || {};
    if (modalResolve) closeModal(false);
    pointers.clear();
    document.getElementById('modal-title').textContent = opts.title || '提示';
    document.getElementById('modal-copy').textContent = opts.content || '';
    const cancel = document.getElementById('modal-cancel');
    const confirm = document.getElementById('modal-confirm');
    cancel.hidden = opts.showCancel === false;
    cancel.textContent = opts.cancelText || '取消';
    confirm.textContent = opts.confirmText || '确定';
    confirm.style.backgroundColor = /^#[a-f\d]{3,8}$/i.test(opts.confirmColor || '') ? opts.confirmColor : '';
    app.inert = true;
    overlay.hidden = false;
    confirm.focus();
    return new Promise(function (resolve) { modalResolve = resolve; }).then(function (result) { return complete(opts, result); });
  }

  function decorateCanvas(canvas) {
    canvas.requestAnimationFrame = window.requestAnimationFrame.bind(window);
    canvas.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    canvas.createImage = function () { return new Image(); };
    if (canvas === mainCanvas && !canvas.dataset.textMirror) {
      // Expose the actual rendered words; the shared core remains the only UI state.
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      const fillText = context.fillText.bind(context);
      const fillRect = context.fillRect.bind(context);
      let frameText = [];
      context.fillRect = function (x, y, width, height) {
        if (x === 0 && y === 0 && width > 0 && height > 0) frameText = [];
        return fillRect.apply(null, arguments);
      };
      context.fillText = function (value) {
        const result = fillText.apply(null, arguments);
        frameText.push(String(value));
        canvas.setAttribute('aria-label', '互动界面：' + frameText.join(' · '));
        return result;
      };
      canvas.dataset.textMirror = 'true';
    }
    return canvas;
  }

  function storageRead(key) {
    const controlled = accountStorage();
    if (controlled) return controlled.getStorageSync(key);
    try { const value = localStorage.getItem(storagePrefix + key); return value === null ? '' : JSON.parse(value); }
    catch (_) { return ''; }
  }

  function storageWrite(key, value, options) {
    const controlled = accountStorage();
    if (controlled) { controlled.setStorageSync(key, value, options); return; }
    const encoded = JSON.stringify(value);
    localStorage.setItem(storagePrefix + key, encoded);
    // Local event only. Optional sync code decides whether and where to send data.
    window.dispatchEvent(new CustomEvent('brclio:storage-write', { detail: { key: key, value: JSON.parse(encoded) } }));
  }

  function updateWakeLock() {
    if (!keepAwake || document.hidden || !navigator.wakeLock) return Promise.resolve();
    if (wakeLock && !wakeLock.released) return Promise.resolve();
    return navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      if (!keepAwake || document.hidden) return lock.release();
    }).catch(function () {});
  }

  function clipboard(options) {
    const opts = options || {};
    return Promise.resolve().then(function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      return navigator.clipboard.writeText(String(opts.data || ''));
    }).then(function () { return complete(opts, { errMsg: 'setClipboardData:ok' }); }).catch(function (error) {
      modal({ title: '长按复制链接', content: String(opts.data || ''), showCancel: false });
      return failure(opts, error);
    });
  }

  const wx = {
    cloudBackupSupported: false,
    accountSyncSupported: !!window.BrclioAccount,
    createCanvas: function () {
      if (!mainCanvasClaimed) { mainCanvasClaimed = true; return decorateCanvas(mainCanvas); }
      return decorateCanvas(document.createElement('canvas'));
    },
    createOffscreenCanvas: function (options) { const canvas = decorateCanvas(document.createElement('canvas')); canvas.width = options && options.width || 1; canvas.height = options && options.height || 1; return canvas; },
    createImage: function () { return new Image(); },
    createWebAudioContext: function () { const AudioContext = window.AudioContext || window.webkitAudioContext; return AudioContext ? new AudioContext() : null; },
    getWindowInfo: windowInfo,
    getSystemInfoSync: function () { return Object.assign(windowInfo(), { platform: 'web', system: 'Web', brand: 'browser', model: 'Web', language: navigator.language, SDKVersion: '3.7.0', version: '0.1.0', benchmarkLevel: 1 }); },
    getSystemInfo: function (options) { complete(options, wx.getSystemInfoSync()); },
    // The core normalizes WeChat's microsecond clock back to milliseconds.
    getPerformance: function () { return { now: function () { return performance.now() * 1000; } }; },
    getLaunchOptionsSync: function () { return { query: Object.fromEntries(new URLSearchParams(location.search)), scene: 1001, shareTicket: '' }; },
    getEnterOptionsSync: function () { return wx.getLaunchOptionsSync(); },
    getStorageSync: storageRead,
    setStorageSync: storageWrite,
    removeStorageSync: function (key) { const controlled = accountStorage(); if (controlled) controlled.removeStorageSync(key); else localStorage.removeItem(storagePrefix + key); },
    clearStorageSync: function () { if (accountStorage()) throw new Error('请分别管理当前账号的记录。'); Object.keys(localStorage).filter(function (key) { return key.startsWith(storagePrefix); }).forEach(function (key) { localStorage.removeItem(key); }); },
    getStorageInfoSync: function () { return { keys: Object.keys(localStorage).filter(function (key) { return key.startsWith(storagePrefix); }).map(function (key) { return key.slice(storagePrefix.length); }), currentSize: 0, limitSize: 10240 }; },
    onTouchStart: function (listener) { on('touchStart', listener); },
    offTouchStart: function (listener) { off('touchStart', listener); },
    onTouchMove: function (listener) { on('touchMove', listener); },
    offTouchMove: function (listener) { off('touchMove', listener); },
    onTouchEnd: function (listener) { on('touchEnd', listener); },
    offTouchEnd: function (listener) { off('touchEnd', listener); },
    onTouchCancel: function (listener) { on('touchCancel', listener); },
    offTouchCancel: function (listener) { off('touchCancel', listener); },
    onHide: function (listener) { on('hide', listener); },
    offHide: function (listener) { off('hide', listener); },
    onShow: function (listener) { on('show', listener); },
    offShow: function (listener) { off('show', listener); },
    onWindowResize: function (listener) { on('resize', listener); },
    offWindowResize: function (listener) { off('resize', listener); },
    onError: function (listener) { on('error', listener); },
    offError: function (listener) { off('error', listener); },
    showToast: toast,
    hideToast: function () { document.getElementById('toast').classList.remove('visible'); },
    showModal: modal,
    vibrateShort: function (options) { try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {} complete(options, { errMsg: 'vibrateShort:ok' }); },
    vibrateLong: function (options) { try { if (navigator.vibrate) navigator.vibrate(120); } catch (_) {} complete(options, { errMsg: 'vibrateLong:ok' }); },
    setKeepScreenOn: function (options) {
      keepAwake = !!(options && options.keepScreenOn);
      if (!keepAwake && wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
      return updateWakeLock().then(function () { return complete(options, { errMsg: 'setKeepScreenOn:ok' }); });
    },
    showShareMenu: function (options) { complete(options, { errMsg: 'showShareMenu:ok' }); },
    updateShareMenu: function (options) { complete(options, { errMsg: 'updateShareMenu:ok' }); },
    hideShareMenu: function (options) { complete(options, { errMsg: 'hideShareMenu:ok' }); },
    onShareAppMessage: function (handler) { shareHandler = handler; },
    offShareAppMessage: function () { shareHandler = null; },
    shareAppMessage: function (options) {
      const message = options || (shareHandler && shareHandler()) || {};
      if (/MicroMessenger/i.test(navigator.userAgent)) { toast({ title: '点击微信右上角「···」，选择转发。' }); return message; }
      if (navigator.share) return navigator.share({ title: message.title || 'Brclio 悦创', url: location.href }).catch(function () {});
      return clipboard({ data: location.href, success: function () { toast({ title: '链接已复制，可以发给朋友了。' }); } });
    },
    setClipboardData: clipboard,
    exitMiniProgram: function (options) { toast({ title: '点击左上角返回，或关闭当前页面。' }); complete(options, { errMsg: 'exitMiniProgram:ok' }); }
  };

  function point(identifier, clientX, clientY, force) {
    const rect = mainCanvas.getBoundingClientRect();
    const x = (clientX - rect.left) * viewport.clientWidth / rect.width;
    const y = (clientY - rect.top) * viewport.clientHeight / rect.height;
    return { identifier: identifier, clientX: x, clientY: y, pageX: x, pageY: y, force: force || .5 };
  }

  function pointer(name, event) {
    if (hasNativeTouch && event.pointerType === 'touch') return;
    if (event.pointerType === 'mouse' && event.button > 0 || !overlay.hidden) return;
    event.preventDefault();
    const changed = point(event.pointerId, event.clientX, event.clientY, event.pressure);
    if (name === 'touchStart') {
      pointers.set(event.pointerId, changed);
      try { mainCanvas.setPointerCapture(event.pointerId); } catch (_) {}
      mainCanvas.focus({ preventScroll: true });
    } else if (!pointers.has(event.pointerId)) return;
    else if (name === 'touchEnd' || name === 'touchCancel') pointers.delete(event.pointerId);
    else pointers.set(event.pointerId, changed);
    emit(name, { touches: Array.from(pointers.values()), changedTouches: [changed], timeStamp: event.timeStamp });
  }

  function touch(name, event) {
    if (!overlay.hidden) return;
    event.preventDefault();
    const convert = function (item) { return point(item.identifier, item.clientX, item.clientY, item.force); };
    if (name === 'touchStart') mainCanvas.focus({ preventScroll: true });
    // Keep simultaneous contacts in one shared-core event for fair arbitration.
    emit(name, { touches: Array.from(event.touches, convert), changedTouches: Array.from(event.changedTouches, convert), timeStamp: event.timeStamp });
  }

  function resize() {
    viewportHeight();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function () {
      resizeFrame = null;
      pointers.clear();
      emit('resize', { windowWidth: viewport.clientWidth, windowHeight: viewport.clientHeight });
    });
  }

  mainCanvas.addEventListener('pointerdown', function (event) { pointer('touchStart', event); });
  mainCanvas.addEventListener('pointermove', function (event) { pointer('touchMove', event); });
  mainCanvas.addEventListener('pointerup', function (event) { pointer('touchEnd', event); });
  mainCanvas.addEventListener('pointercancel', function (event) { pointer('touchCancel', event); });
  mainCanvas.addEventListener('lostpointercapture', function (event) { if (pointers.has(event.pointerId)) pointer('touchCancel', event); });
  if (hasNativeTouch) {
    [['touchstart', 'touchStart'], ['touchmove', 'touchMove'], ['touchend', 'touchEnd'], ['touchcancel', 'touchCancel']].forEach(function (pair) {
      mainCanvas.addEventListener(pair[0], function (event) { touch(pair[1], event); }, { passive: false });
    });
  }
  document.addEventListener('visibilitychange', function () {
    pointers.clear();
    emit(document.hidden ? 'hide' : 'show', document.hidden ? {} : wx.getEnterOptionsSync());
    if (!document.hidden) updateWakeLock();
  });
  window.addEventListener('pagehide', function () { pointers.clear(); emit('hide', {}); });
  window.addEventListener('pageshow', function (event) { if (event.persisted) { emit('show', wx.getEnterOptionsSync()); updateWakeLock(); } });
  window.addEventListener('blur', function () { pointers.clear(); emit('hide', {}); });
  window.addEventListener('focus', function () { if (!document.hidden) { emit('show', wx.getEnterOptionsSync()); updateWakeLock(); } });
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport);
  document.getElementById('reload').addEventListener('click', function () { location.reload(); });
  document.getElementById('modal-confirm').addEventListener('click', function () { closeModal(true); });
  document.getElementById('modal-cancel').addEventListener('click', function () { closeModal(false); });
  document.addEventListener('keydown', function (event) {
    if (overlay.hidden) return;
    const cancel = document.getElementById('modal-cancel');
    const confirm = document.getElementById('modal-confirm');
    if (event.key === 'Escape' && !cancel.hidden) closeModal(false);
    if (event.key === 'Tab') {
      event.preventDefault();
      (cancel.hidden || document.activeElement === cancel ? confirm : cancel).focus();
    }
  });

  window.wx = wx;
  window.GameGlobal = window;
  if (window.BrclioAccount) window.__brclioBootstrap = Promise.resolve(window.BrclioAccount.startModule ? window.BrclioAccount.startModule({ timeoutMs: 1800 }) : window.BrclioAccount.ready).then(function () {
    accountScope = window.BrclioAccount.getScope ? window.BrclioAccount.getScope() : window.BrclioAccount.sync.getScope();
  });
  window.BrclioStorage = {
    read: storageRead,
    // Bootstrap hydration does not emit storage-write, avoiding upload loops.
    hydrate: function (key, value) { if (window.BrclioAccount) return; localStorage.setItem(storagePrefix + key, JSON.stringify(value)); },
    refresh: function () { if (!document.hidden) emit('show', wx.getEnterOptionsSync()); }
  };
  window.BrclioRuntime = {
    suspend: function () { pointers.clear(); emit('hide', {}); },
    resume: function () { if (!document.hidden) emit('show', wx.getEnterOptionsSync()); },
    ready: function () {
      status.textContent = '口袋已打开';
      status.classList.add('ready');
      mainCanvas.dataset.ready = 'true';
      window.dispatchEvent(new CustomEvent('brclio:ready'));
    },
    fail: function (error) {
      status.textContent = '暂时无法打开';
      status.classList.add('ready');
      document.getElementById('runtime-error').hidden = false;
      document.getElementById('error-message').textContent = '请刷新重试；如果仍未恢复，稍后再来看看。';
      emit('error', error && error.message || String(error));
    }
  };
  window.addEventListener('error', function (event) { if (event.error || event.message) window.BrclioRuntime.fail(event.error || new Error(event.message)); });
  window.addEventListener('unhandledrejection', function (event) { window.BrclioRuntime.fail(event.reason || new Error('Unable to open')); });
})();
