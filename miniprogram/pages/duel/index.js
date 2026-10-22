'use strict';

const legacy = require('./legacy');
const { createDuelAudio } = require('../../lib/duel');
const { createReadyGo } = require('../../lib/ready-go-model');
const { drawReadyGoReport } = require('../../lib/ready-go-report');
const accountSync = require('../../lib/account-sync');

Page(Object.assign({}, legacy, {
  data: Object.assign({}, legacy.data, {
    view: 'original', gameState: 'IDLE', gameMode: 'TOUCH', soundEnabled: true,
    safeTop: 20, canvasWidth: 390, canvasHeight: 740, keyboardHeight: 0, heading: '双人反应对决',
    showSettingsModal: false, showRewardInput: false, showInfiniteSummary: false,
    showReportModal: false, reportImageUrl: '', isGeneratingReport: false,
    passwordVisible: false, passwordPlayer: '', passwordInput: '', viewedRewardContent: '',
    editingPwdPlayer: '', tempSettings: { title: '', p1: '', p2: '', maxWait: 6 },
    particles: [], players: [], visitCount: 0, formFocusId: ''
  }),

  onLoad(options) {
    this._legacy = !!(options && options.view === 'match');
    if (this._legacy) { this.setData({ view: 'match' }); legacy.onLoad.call(this, options); return; }
    this._alive = true; this._visible = true; this._timers = new Set(); this._generation = 0;
    this._model = createReadyGo({ storage: accountSync.storage });
    this._audio = createDuelAudio(wx, { enabled: true, assetBase: '/assets/duel-audio' });
    this._keyboardListener = (event) => { if (this._alive && this._visible) this.setData({ keyboardHeight: Math.max(0, event.height || 0) }); };
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this._keyboardListener);
    this.measureWindow(); this.sync(); this._audio.setEnabled(this.data.soundEnabled);
    try { const count = Number(wx.getStorageSync('RGD_LOCAL_VISITS') || 0) + 1; wx.setStorageSync('RGD_LOCAL_VISITS', count); this.setData({ visitCount: count }); } catch (_) {}
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  onReady() { if (this._legacy) legacy.onReady.call(this); else this.measureWindow(); },
  onShow() { if (this._legacy) { legacy.onShow.call(this); return; } this._visible = true; this.measureWindow(); if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: true }); },
  onHide() {
    accountSync.onHide();
    if (this._legacy) { legacy.onHide.call(this); return; }
    this._visible = false; this._generation += 1; this.clearTimers();
    if (this._audio) this._audio.stop();
    if (this._model) this.sync(this._model.cancel());
    this.setData({ isGeneratingReport: false, particles: [], keyboardHeight: 0 });
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: false });
  },
  onUnload() {
    if (this._legacy) { legacy.onUnload.call(this); return; }
    this._alive = false; this._visible = false; this._generation += 1; this.clearTimers();
    if (wx.offKeyboardHeightChange && this._keyboardListener) wx.offKeyboardHeightChange(this._keyboardListener);
    if (this._audio) this._audio.dispose(); this.removeReport();
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: false });
  },
  onResize() { if (this._legacy) legacy.onResize.call(this); else this.measureWindow(); },
  measureWindow() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    this.setData({ canvasWidth: info.windowWidth || 390, canvasHeight: info.windowHeight || 740, safeTop: info.statusBarHeight || 20 });
  },
  sync(value) {
    if (!this._model || !this._alive) return;
    const state = value || this._model.snapshot();
    state.players = ['p1', 'p2'].map((id) => ({ id, name: state[id + 'Name'] || (id === 'p1' ? 'P1 红方' : 'P2 蓝方'), reward: state[id + 'Reward'], masked: state[id + 'Masked'], inputType: state[id + 'InputType'], password: state[id + 'Password'], winner: state.gameState === 'ENDED' && state.winner === id, loser: state.gameState === 'ENDED' && state.winner !== id }));
    state.canRevealReward = !!state.winnerReward;
    this.setData(state);
  },
  schedule(callback, delay) { const id = setTimeout(() => { this._timers.delete(id); if (this._alive && this._visible) callback(); }, delay); this._timers.add(id); return id; },
  clearTimers() { if (this._timers) this._timers.forEach((id) => clearTimeout(id)); if (this._timers) this._timers.clear(); },
  notify(message) { if (wx.showToast) wx.showToast({ title: message, icon: 'none', duration: 2500 }); },
  noop() {},
  onFormFocus(event) {
    const id = event.currentTarget.dataset.focus;
    if (typeof id !== 'string' || !/^(?:settings-(?:title|p1|p2)|reward-p[12]|password-check)$/.test(id)) return;
    this.setData({ formFocusId: '' }, () => { if (this._alive) this.setData({ formFocusId: id }); });
  },
  switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    this._generation += 1; this.clearTimers(); this._audio.stop();
    this.sync(this._model.switchMode(mode));
    this.setData({ showRewardInput: false, showInfiniteSummary: false, viewedRewardContent: '', isGeneratingReport: false, particles: [] });
  },
  exitInfinite() { this.switchMode({ currentTarget: { dataset: { mode: 'TOUCH' } } }); },
  toggleSound() { const state = this._model.setSound(!this.data.soundEnabled); this._audio.unlock(); this._audio.setEnabled(state.soundEnabled); this.sync(state); },
  testSound() { this._audio.unlock(); this._audio.play('test', this.data.gameMode); },
  openSettings() { this.setData({ showSettingsModal: true, tempSettings: { title: this.data.customTitle, p1: this.data.p1Name, p2: this.data.p2Name, maxWait: this.data.maxWaitTime } }); },
  closeKeyboard() { if (wx.hideKeyboard) wx.hideKeyboard({}); this.setData({ keyboardHeight: 0 }); },
  closeSettings() { this.closeKeyboard(); this.setData({ showSettingsModal: false }); },
  settingsInput(event) { const field = event.currentTarget.dataset.field; const value = Object.assign({}, this.data.tempSettings); value[field] = event.detail.value; this.setData({ tempSettings: value }); },
  randomSetting(event) { const field = event.currentTarget.dataset.field; const value = Object.assign({}, this.data.tempSettings); value[field] = field === 'title' ? this._model.randomTitle() : this._model.randomName(); this.setData({ tempSettings: value }); },
  resetSettings() { this.setData({ tempSettings: { title: '', p1: '', p2: '', maxWait: 6 } }); },
  saveSettings() { this.sync(this._model.settings(this.data.tempSettings)); this.closeSettings(); },
  openRewards() { this._audio.unlock(); this.setData({ showRewardInput: true, viewedRewardContent: '', editingPwdPlayer: '', passwordVisible: false }); },
  closeRewards() { this.closeKeyboard(); this.setData({ showRewardInput: false }); },
  rewardInput(event) { this.sync(this._model.updateReward(event.currentTarget.dataset.player, event.detail.value)); },
  rewardCategory(event) { this.sync(this._model.category(event.currentTarget.dataset.category)); },
  randomReward(event) { this.sync(this._model.randomReward(event.currentTarget.dataset.player)); },
  lockReward(event) { this.sync(this._model.lock(event.currentTarget.dataset.player)); },
  clearReward(event) { this.sync(this._model.clear(event.currentTarget.dataset.player)); },
  toggleInput(event) { this.sync(this._model.toggleInput(event.currentTarget.dataset.player)); },
  editPassword(event) { const player = event.currentTarget.dataset.player; this.setData({ editingPwdPlayer: this.data.editingPwdPlayer === player ? '' : player }); },
  passwordSetting(event) { this.sync(this._model.setPassword(event.currentTarget.dataset.player, event.detail.value)); },
  requestPassword(event) { this.setData({ passwordVisible: true, passwordPlayer: event.currentTarget.dataset.player, passwordInput: '', viewedRewardContent: '' }); },
  passwordInput(event) { this.setData({ passwordInput: event.detail.value }); },
  closePassword() { this.closeKeyboard(); this.setData({ passwordVisible: false }); },
  verifyPassword() { const value = this._model.checkPassword(this.data.passwordPlayer, this.data.passwordInput); if (!value.ok) { this.notify('密码错误'); return; } this.closeKeyboard(); this.setData({ passwordVisible: false, viewedRewardContent: value.content }); },
  importRewards() {
    if (!wx.chooseMessageFile || !wx.getFileSystemManager) { this.notify('请更新微信后导入 .txt 文件。'); return; }
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['txt'], success: (result) => {
      if (!this._alive) return;
      const file = result.tempFiles && result.tempFiles[0]; if (!file) return;
      wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: (value) => { if (!this._alive) return; try { const state = this._model.importRewards(value.data); this.sync(state); this.notify('成功导入 ' + state.customRewards.length + ' 个自定义彩头！'); } catch (error) { this.notify(error.message); } }, fail: () => { if (this._alive) this.notify('文件读取失败，请选择 UTF-8 格式的 .txt 文件。'); } });
    } });
  },
  launchRound(event) {
    this.closeKeyboard();
    this._generation += 1;
    const next = !!(event && event.currentTarget && event.currentTarget.dataset.next);
    this.clearTimers(); this._audio.unlock();
    const result = this._model.launch(next); this.sync(result.state);
    this.setData({ showRewardInput: false, showInfiniteSummary: false, viewedRewardContent: '', isGeneratingReport: false, particles: [] });
    this._audio.play('start', this.data.gameMode);
    this.schedule(() => { const state = this._model.signal(); if (state) { this.sync(state); this._audio.play('go', state.gameMode); } }, result.delay);
  },
  playerTouch(event) { this._audio.unlock(); const result = this._model.touch(event.currentTarget.dataset.player); if (result) this.finishRound(result); },
  finishRound(result) {
    this.clearTimers(); this.sync(result); this._audio.play(result.winReason === 'FALSE_START' ? 'false' : 'win', result.gameMode);
    if (result.winReason !== 'FALSE_START') this.makeConfetti();
  },
  makeConfetti() {
    const colors = ['#FFC700', '#FF0000', '#2E3192', '#41BBC7', '#73FF00', '#FF00EA'];
    this.setData({ particles: Array.from({ length: 72 }, (_, index) => ({ id: index, color: colors[index % colors.length], left: Math.random() * 100, delay: Math.random() * 0.5, duration: 1.7 + Math.random(), rotation: Math.round(Math.random() * 360) })) });
    this.schedule(() => this.setData({ particles: [] }), 3500);
  },
  revealReward() { this.sync(this._model.reveal()); },
  showSummary() { this.setData({ showInfiniteSummary: true }); },
  removeReport() { if (this.data.reportImageUrl && wx.getFileSystemManager) wx.getFileSystemManager().unlink({ filePath: this.data.reportImageUrl, fail() {} }); },
  generateReport() {
    if (this.data.isGeneratingReport) return;
    this.setData({ isGeneratingReport: true });
    const generation = this._generation;
    this.createSelectorQuery().select('#report-canvas').fields({ node: true }).exec(async (results) => {
      try {
        if (!this._alive || !this._visible || generation !== this._generation) return;
        const canvas = results && results[0] && results[0].node; if (!canvas) throw new Error('Canvas unavailable');
        const size = await drawReadyGoReport(canvas, this.data, this.data.gameMode === 'INFINITE' && this.data.showInfiniteSummary, () => this._alive && this._visible && generation === this._generation);
        if (!this._alive || !this._visible || generation !== this._generation) return;
        const maxImageHeight = Math.max(120, this.data.canvasHeight - this.data.safeTop - 180);
        const imageWidth = Math.max(80, Math.min(360, this.data.canvasWidth - 48, maxImageHeight * size.width / size.height));
        this.setData({ reportDisplayWidth: Math.round(imageWidth), reportDisplayHeight: Math.round(imageWidth * size.height / size.width) });
        wx.canvasToTempFilePath({ canvas, width: size.width, height: size.height, destWidth: size.width, destHeight: size.height, fileType: 'png', success: (value) => { if (!this._alive || !this._visible || generation !== this._generation) { if (wx.getFileSystemManager) wx.getFileSystemManager().unlink({ filePath: value.tempFilePath, fail() {} }); return; } this.removeReport(); this.setData({ reportImageUrl: value.tempFilePath, showReportModal: true }); }, fail: () => { if (this._alive && generation === this._generation) this.notify('战报生成失败，请重试。'); }, complete: () => { if (this._alive && generation === this._generation) this.setData({ isGeneratingReport: false }); } }, this);
      } catch (_) { if (this._alive && generation === this._generation) { this.setData({ isGeneratingReport: false }); this.notify('战报生成失败，请重试。'); } }
    });
  },
  closeReport() { this.setData({ showReportModal: false }); },
  saveReport() {
    if (!this.data.reportImageUrl) return;
    wx.saveImageToPhotosAlbum({ filePath: this.data.reportImageUrl, success: () => this.notify('战报已保存到相册'), fail: (error) => { if (!this._alive) return; if (/auth|deny|denied/.test(error.errMsg || '')) wx.showModal({ title: '允许保存到相册', content: '请在微信设置中允许保存图片，然后重试。', confirmText: '去设置', success: (value) => { if (value.confirm && this._alive && wx.openSetting) wx.openSetting({}); } }); else this.notify('保存失败，可长按战报图片保存。'); } });
  },
  shareReport() { if (wx.showShareImageMenu && this.data.reportImageUrl) wx.showShareImageMenu({ path: this.data.reportImageUrl }); else if (this.data.reportImageUrl && wx.previewImage) wx.previewImage({ urls: [this.data.reportImageUrl] }); },
  openMatch() { wx.navigateTo({ url: '/pages/duel/index?view=match' }); },
  onTouchStart(event) { if (this._legacy) legacy.onTouchStart.call(this, event); },
  onTouchMove(event) { if (this._legacy) legacy.onTouchMove.call(this, event); },
  onTouchEnd(event) { if (this._legacy) legacy.onTouchEnd.call(this, event); },
  onTouchCancel(event) { if (this._legacy) legacy.onTouchCancel.call(this, event); },
  onShareAppMessage(event) { if (this._legacy) return legacy.onShareAppMessage.call(this, event); return { title: this.data.customTitle || 'Ready Go Duel · 双人反应对决', path: '/pages/duel/index', imageUrl: this.data.reportImageUrl || undefined }; },
  onShareTimeline(event) { if (this._legacy) return legacy.onShareTimeline.call(this, event); return { title: this.data.customTitle || 'Ready Go Duel · 双人反应对决', imageUrl: this.data.reportImageUrl || undefined }; }
}));
