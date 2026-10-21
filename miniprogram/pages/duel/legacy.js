'use strict';

const { createGameApp } = require('../../lib/duel');
const { createDuelPlatform, readWindowInfo } = require('../../lib/duel-platform');

module.exports = {
  data: { canvasWidth: 390, canvasHeight: 740, status: 'loading', errorMessage: '' },

  onLoad() {
    this._alive = true;
    this._visible = true;
    this._ready = false;
    this._queryVersion = 0;
    const info = readWindowInfo(wx);
    this.setData({ canvasWidth: info.windowWidth || 390, canvasHeight: info.windowHeight || 740 });
  },

  onReady() {
    this._ready = true;
    this.initializeGame();
  },

  initializeGame() {
    if (!this._alive || !this._visible || !this._ready) return;
    this.disposeGame();
    this.setData({ status: 'loading', errorMessage: '' });
    this.measureCanvas(true);
  },

  measureCanvas(initialize) {
    if (!this._alive || !this._visible) return;
    const version = ++this._queryVersion;
    const info = readWindowInfo(wx);
    this.setData({ canvasWidth: info.windowWidth || 390, canvasHeight: info.windowHeight || 740 }, () => {
      if (!this._alive || !this._visible || version !== this._queryVersion) return;
      this.createSelectorQuery().select('#duel-canvas').fields({ node: true, size: true, rect: true }).exec((results) => {
        if (!this._alive || !this._visible || version !== this._queryVersion) return;
        const field = results && results[0];
        if (!field || !field.node || !field.width || !field.height) {
          this.showCanvasError();
          return;
        }
        const bounds = { left: field.left || 0, top: field.top || 0, width: field.width, height: field.height };
        try {
          if (initialize) {
            if (!field.node.getContext('2d')) throw new Error('Canvas unavailable');
            this._platform = createDuelPlatform({ wx, canvas: field.node, bounds, windowInfo: info });
            this._game = createGameApp(this._platform, { initialScreen: 'duel', avatarSrc: '/assets/avatar.png', audioAssetBase: '/assets/duel-audio' });
            this._platform.show();
            this.setData({ status: 'ready', errorMessage: '' });
          } else if (this._platform) {
            this._platform.updateViewport(bounds, info);
          }
        } catch (_) {
          this.showCanvasError();
        }
      });
    });
  },

  onShow() {
    this._visible = true;
    if (this._platform) this._platform.show();
    if (this._ready) {
      if (this._game) this.measureCanvas(false);
      else this.initializeGame();
    }
  },

  onHide() {
    this._visible = false;
    ++this._queryVersion;
    if (this._platform) this._platform.hide();
  },

  onResize() {
    if (this._platform && this._visible) {
      this._platform.hide();
      this._platform.show();
    }
    if (this._game) this.measureCanvas(false);
    else if (this._ready) this.initializeGame();
  },

  onTouchStart(event) { if (this._platform) this._platform.emitTouch('Start', event); },
  onTouchMove(event) { if (this._platform) this._platform.emitTouch('Move', event); },
  onTouchEnd(event) { if (this._platform) this._platform.emitTouch('End', event); },
  onTouchCancel(event) {
    if (!this._platform) return;
    this._platform.emitTouch('Cancel', event);
    // System gestures and interruptions cancel a round, preserving its score.
    this._platform.hide();
    if (this._visible) this._platform.show();
  },

  showCanvasError() {
    if (!this._alive) return;
    ++this._queryVersion;
    this.disposeGame();
    this.setData({ status: 'error', errorMessage: '游戏画布暂时无法打开。请重试，或更新微信后再来一局。' });
  },

  disposeGame() {
    const game = this._game;
    const platform = this._platform;
    this._game = null;
    this._platform = null;
    try {
      if (game && typeof game.dispose === 'function') game.dispose();
    } finally {
      if (platform) platform.dispose();
    }
  },

  onUnload() {
    this._alive = false;
    this._visible = false;
    ++this._queryVersion;
    this.disposeGame();
  },

  goHome() {
    wx.navigateBack({ delta: 1, fail: function () { wx.reLaunch({ url: '/pages/home/index' }); } });
  },

  onShareAppMessage(event) {
    const shared = this._platform ? this._platform.shareAppMessage(event) : {};
    return { title: shared.title || '来一局双人反应挑战，看看谁的反应更快！', path: '/pages/duel/index' };
  },

  onShareTimeline(event) {
    const shared = this._platform ? this._platform.shareTimeline(event) : {};
    return { title: shared.title || '双人反应挑战 · 两个人，一部手机。' };
  }
};
