(function () {
  'use strict';
  const viewport = document.getElementById('game-viewport');
  const mainCanvas = document.getElementById('game-canvas');
  const status = document.getElementById('runtime-status');
  const listeners = { touchStart: [], touchMove: [], touchEnd: [], touchCancel: [], hide: [], show: [], resize: [], error: [] };
  const pointers = new Map();
  const storagePrefix = 'brclio-minigame:';
  let mainCanvasClaimed = false;
  let toastTimer;
  let modalResolve;
  let shareHandler;

  function windowInfo() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    return { pixelRatio: window.devicePixelRatio || 1, windowWidth: width, windowHeight: height, screenWidth: width, screenHeight: height, statusBarHeight: 0, screenTop: 0, safeArea: { left: 0, right: width, top: 0, bottom: height, width: width, height: height } };
  }

  function complete(options, value) {
    if (options && typeof options.success === 'function') options.success(value);
    if (options && typeof options.complete === 'function') options.complete(value);
    return value;
  }

  function emit(name, event) {
    listeners[name].slice().forEach(function (listener) { listener(event); });
  }

  function on(name, listener) { if (typeof listener === 'function' && !listeners[name].includes(listener)) listeners[name].push(listener); }
  function off(name, listener) { listeners[name] = listener ? listeners[name].filter(function (item) { return item !== listener; }) : []; }

  function toast(options) {
    const node = document.getElementById('toast');
    node.textContent = typeof options === 'string' ? options : options.title || '';
    node.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('visible'); }, options.duration || 2200);
    complete(options, { errMsg: 'showToast:ok' });
  }

  function closeModal(confirm) {
    document.getElementById('modal').hidden = true;
    if (modalResolve) { const resolve = modalResolve; modalResolve = null; resolve({ confirm: confirm, cancel: !confirm, errMsg: 'showModal:ok' }); }
    mainCanvas.focus({ preventScroll: true });
  }

  function modal(options) {
    if (modalResolve) closeModal(false);
    const overlay = document.getElementById('modal');
    document.getElementById('modal-title').textContent = options.title || '提示';
    document.getElementById('modal-copy').textContent = options.content || '';
    const cancel = document.getElementById('modal-cancel');
    const confirm = document.getElementById('modal-confirm');
    cancel.hidden = options.showCancel === false;
    cancel.textContent = options.cancelText || '取消';
    confirm.textContent = options.confirmText || '确定';
    overlay.hidden = false;
    confirm.focus();
    return new Promise(function (resolve) { modalResolve = resolve; }).then(function (result) { return complete(options, result); });
  }

  function decorateCanvas(canvas) {
    canvas.requestAnimationFrame = window.requestAnimationFrame.bind(window);
    canvas.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    canvas.createImage = function () { return new Image(); };
    if (canvas === mainCanvas && !canvas.dataset.textMirror) {
      // Mirror rendered text for accessibility and semantic UI checks; game state stays in the native source.
      const context = canvas.getContext('2d');
      const fillText = context.fillText.bind(context);
      const fillRect = context.fillRect.bind(context);
      let frameText = [];
      context.fillRect = function (x, y, width, height) {
        if (x === 0 && y === 0 && width >= canvas.clientWidth && height >= canvas.clientHeight) frameText = [];
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

  const wx = {
    createCanvas: function () {
      if (!mainCanvasClaimed) { mainCanvasClaimed = true; return decorateCanvas(mainCanvas); }
      return decorateCanvas(document.createElement('canvas'));
    },
    createOffscreenCanvas: function (options) { const canvas = decorateCanvas(document.createElement('canvas')); canvas.width = options && options.width || 1; canvas.height = options && options.height || 1; return canvas; },
    createImage: function () { return new Image(); },
    getWindowInfo: windowInfo,
    getSystemInfoSync: function () { return Object.assign(windowInfo(), { platform: 'devtools', system: 'Browser Canvas preview', brand: 'browser', model: 'Browser preview', language: navigator.language, SDKVersion: '3.7.0', version: 'preview', benchmarkLevel: 1 }); },
    getSystemInfo: function (options) { complete(options, wx.getSystemInfoSync()); },
    // WeChat Mini Game Performance.now() returns microseconds; browser performance.now() returns milliseconds.
    getPerformance: function () { return { now: function () { return performance.now() * 1000; } }; },
    getLaunchOptionsSync: function () { return { query: {}, scene: 1001, shareTicket: '' }; },
    getEnterOptionsSync: function () { return wx.getLaunchOptionsSync(); },
    getStorageSync: function (key) { try { const value = localStorage.getItem(storagePrefix + key); return value === null ? '' : JSON.parse(value); } catch (_) { return ''; } },
    setStorageSync: function (key, value) { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); },
    removeStorageSync: function (key) { localStorage.removeItem(storagePrefix + key); },
    clearStorageSync: function () { Object.keys(localStorage).filter(function (key) { return key.startsWith(storagePrefix); }).forEach(function (key) { localStorage.removeItem(key); }); },
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
    setKeepScreenOn: function (options) { complete(options, { errMsg: 'setKeepScreenOn:ok' }); },
    showShareMenu: function (options) { complete(options, { errMsg: 'showShareMenu:ok' }); },
    updateShareMenu: function (options) { complete(options, { errMsg: 'updateShareMenu:ok' }); },
    hideShareMenu: function (options) { complete(options, { errMsg: 'hideShareMenu:ok' }); },
    onShareAppMessage: function (handler) { shareHandler = handler; },
    offShareAppMessage: function () { shareHandler = null; },
    shareAppMessage: function (options) { const message = options || (shareHandler && shareHandler()) || {}; toast({ title: '分享内容已准备，请在微信内完成转发' }); return message; },
    setClipboardData: function (options) { return navigator.clipboard.writeText(options.data).then(function () { return complete(options, { errMsg: 'setClipboardData:ok' }); }).catch(function (error) { if (options.fail) options.fail(error); if (options.complete) options.complete(error); }); },
    exitMiniProgram: function (options) { toast({ title: '这是浏览器源码预览，可关闭此标签页。' }); complete(options, { errMsg: 'exitMiniProgram:ok' }); }
  };

  function point(event) {
    const rect = mainCanvas.getBoundingClientRect();
    return { identifier: event.pointerId, clientX: (event.clientX - rect.left) * viewport.clientWidth / rect.width, clientY: (event.clientY - rect.top) * viewport.clientHeight / rect.height, pageX: (event.clientX - rect.left) * viewport.clientWidth / rect.width, pageY: (event.clientY - rect.top) * viewport.clientHeight / rect.height, force: event.pressure || .5 };
  }

  function pointer(name, event) {
    if (event.pointerType === 'mouse' && event.button > 0) return;
    if (document.getElementById('modal').hidden === false) return;
    event.preventDefault();
    const changed = point(event);
    if (name === 'touchStart') { pointers.set(event.pointerId, changed); mainCanvas.setPointerCapture(event.pointerId); mainCanvas.focus({ preventScroll: true }); }
    else if (!pointers.has(event.pointerId)) return;
    else if (name === 'touchEnd' || name === 'touchCancel') pointers.delete(event.pointerId);
    else pointers.set(event.pointerId, changed);
    emit(name, { touches: Array.from(pointers.values()), changedTouches: [changed], timeStamp: event.timeStamp });
  }

  mainCanvas.addEventListener('pointerdown', function (event) { pointer('touchStart', event); });
  mainCanvas.addEventListener('pointermove', function (event) { pointer('touchMove', event); });
  mainCanvas.addEventListener('pointerup', function (event) { pointer('touchEnd', event); });
  mainCanvas.addEventListener('pointercancel', function (event) { pointer('touchCancel', event); });
  document.addEventListener('visibilitychange', function () {
    pointers.clear();
    emit(document.hidden ? 'hide' : 'show', document.hidden ? {} : wx.getEnterOptionsSync());
  });
  window.addEventListener('blur', function () { pointers.clear(); emit('hide', {}); });
  window.addEventListener('focus', function () { if (!document.hidden) emit('show', wx.getEnterOptionsSync()); });
  window.addEventListener('resize', function () { emit('resize', { windowWidth: viewport.clientWidth, windowHeight: viewport.clientHeight }); });
  document.getElementById('reload').addEventListener('click', function () { location.reload(); });
  document.getElementById('modal-confirm').addEventListener('click', function () { closeModal(true); });
  document.getElementById('modal-cancel').addEventListener('click', function () { closeModal(false); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !document.getElementById('modal').hidden && !document.getElementById('modal-cancel').hidden) closeModal(false); });

  window.wx = wx;
  window.GameGlobal = window;
  window.__preview = {
    ready: function (count) { status.textContent = '源码已加载 · ' + count + ' 个模块'; mainCanvas.dataset.ready = 'true'; },
    fail: function (error) { status.textContent = '加载失败'; document.getElementById('runtime-error').hidden = false; document.getElementById('error-message').textContent = error.message || String(error); emit('error', error.message || String(error)); }
  };
  window.addEventListener('error', function (event) { window.__preview.fail(event.error || new Error(event.message)); });
  window.addEventListener('unhandledrejection', function (event) { window.__preview.fail(event.reason || new Error('Promise rejected')); });
})();
