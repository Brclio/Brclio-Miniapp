'use strict';

const account = require('../../lib/account');
const sync = require('../../lib/account-sync');
// Keep each email and purpose independent when navigating away and back.
const codeDeadlines = Object.create(null);
const MODES = ['login', 'register', 'bind'];

Page({
  data: {
    mode: 'login', loginMethod: 'code', email: '', username: '', identifier: '', password: '', confirmPassword: '', code: '',
    agreed: false, busy: false, sendingCode: false, refreshing: false, codeSeconds: 0,
    error: '', notice: '', user: null, userLabel: '', userInitial: '', showBind: false, wechatLinked: false,
    syncState: 'guest', syncMessage: '', syncPending: 0
  },

  onLoad(options) {
    this._alive = true;
    this.applySyncStatus(sync.getStatus());
    this._unsubscribeSync = sync.subscribe(status => this.applySyncStatus(status));
    const mode = options && options.mode;
    if (MODES.indexOf(mode) !== -1 && mode !== 'bind') this.setData({ mode });
  },

  async onShow() {
    this._alive = true;
    const user = account.getCachedUser();
    this.applyUser(user);
    sync.onShow({ pull: true });
    this.updateCooldown();
    if (!user || this._refreshing || this.data.busy) return;
    this._refreshing = true;
    this.setData({ refreshing: true });
    try {
      const session = await account.refreshSession();
      if (!this._alive) return;
      this.applyUser(session && session.user);
      if (!session) this.setData({ notice: '登录状态已更新，请重新登录。' });
    } catch (_) {
      if (this._alive) {
        this.applyUser(account.getCachedUser());
        this.setData({ notice: '暂时无法更新账号状态，可稍后重试。' });
      }
    } finally {
      this._refreshing = false;
      if (this._alive) this.setData({ refreshing: false });
    }
  },

  onHide() { sync.onHide(); },

  onUnload() {
    this._alive = false;
    if (this._unsubscribeSync) this._unsubscribeSync();
    clearInterval(this._codeTimer);
    this._codeTimer = null;
    this._expiryTimer = null;
    // Transient credentials are never written to device storage.
    this.data.password = '';
    this.data.confirmPassword = '';
    this.data.code = '';
  },

  applyUser(user) {
    const label = user ? user.displayName || user.username || (user.email ? user.email.split('@')[0] : '微信用户') : '';
    this.setData({ user, userLabel: label, userInitial: label.slice(0, 1).toUpperCase(), wechatLinked: !!(user && user.providers && user.providers.indexOf('wechat') !== -1) });
    if (!user && this.data.mode === 'bind') this.setData({ mode: 'login', showBind: false });
  },

  applySyncStatus(status) {
    if (!this._alive) return;
    this.setData({ syncState: status.state, syncMessage: status.message, syncPending: status.pending });
  },

  retrySync() { return sync.activate({ pull: true }).then(() => sync.flush()); },

  inputField(event) {
    const field = event.currentTarget.dataset.field;
    if (['email', 'username', 'identifier', 'password', 'confirmPassword', 'code'].indexOf(field) === -1) return;
    this.setData({ [field]: event.detail.value, error: '', notice: '' });
    if (field === 'email') this.updateCooldown();
  },

  changeConsent(event) {
    this.setData({ agreed: Array.isArray(event.detail.value) && event.detail.value.indexOf('agree') !== -1, error: '' });
  },

  switchMode(event) {
    if (this.data.busy) return;
    const mode = event.currentTarget.dataset.mode;
    if (['login', 'register'].indexOf(mode) === -1) return;
    this.setData({ mode, password: '', confirmPassword: '', code: '', error: '', notice: '' });
    this.updateCooldown();
  },

  switchLoginMethod(event) {
    if (this.data.busy) return;
    const method = event.currentTarget.dataset.method;
    if (['code', 'password'].indexOf(method) === -1) return;
    this.setData({ loginMethod: method, password: '', code: '', error: '', notice: '' });
    this.updateCooldown();
  },

  codeKey(email, purpose) {
    return purpose + ':' + account.normalizeEmail(email === undefined ? this.data.email : email);
  },

  codePurpose() { return this.data.mode === 'register' ? 'register' : this.data.mode === 'bind' ? 'bind' : 'login'; },

  updateCooldown() {
    clearInterval(this._codeTimer);
    this._codeTimer = null;
    const update = () => {
      const deadline = codeDeadlines[this.codeKey(undefined, this.codePurpose())] || 0;
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (this._alive) this.setData({ codeSeconds: seconds });
      if (!seconds) { clearInterval(this._codeTimer); this._codeTimer = null; }
      return seconds;
    };
    if (update() > 0) this._codeTimer = setInterval(update, 1000);
  },

  requireConsent() {
    if (this.data.agreed) return true;
    this.setData({ error: '请先阅读并同意《隐私与数据说明》。', notice: '' });
    return false;
  },

  async sendCode() {
    if (this.data.busy || this.data.sendingCode || this.data.codeSeconds || !this.requireConsent()) return;
    const email = this.data.email, purpose = this.codePurpose(), key = this.codeKey(email, purpose);
    this.setData({ sendingCode: true, error: '', notice: '' });
    try {
      const result = await account.sendEmailCode(email, purpose);
      const retryAfter = Math.max(1, Number(result.retryAfter || result.cooldown || 60));
      codeDeadlines[key] = Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000;
      if (this._alive) this.setData({ notice: '验证码已发送，请查看邮箱，留意垃圾邮件。' });
    } catch (error) {
      if (error.retryAfter > 0) codeDeadlines[key] = Date.now() + error.retryAfter * 1000;
      if (this._alive) this.setData({ error: error.message || '验证码发送失败，请稍后重试。' });
    } finally {
      if (this._alive) { this.setData({ sendingCode: false }); this.updateCooldown(); }
    }
  },

  async submitForm() {
    if (this.data.busy || this.data.sendingCode || !this.requireConsent()) return;
    if ((this.data.mode === 'register' || this.data.mode === 'bind') && this.data.password !== this.data.confirmPassword) {
      this.setData({ error: '两次输入的密码不一致。', notice: '' });
      return;
    }
    const mode = this.data.mode;
    await this.runAuth(() => {
      if (mode === 'register' || mode === 'bind') {
        const input = { email: this.data.email, username: this.data.username, password: this.data.password, code: this.data.code };
        return mode === 'bind' ? account.bindEmail(input) : account.register(input);
      }
      return this.data.loginMethod === 'code' ? account.loginEmail(this.data.email, this.data.code) : account.loginPassword(this.data.identifier, this.data.password);
    }, mode === 'bind' ? '邮箱已绑定。' : mode === 'register' ? '注册成功，欢迎来到悦创。' : '登录成功，欢迎回来。');
  },

  async wechatLogin() {
    if (this.data.busy || this.data.sendingCode || this.data.refreshing) return;
    if (this.data.user) {
      if (this.data.wechatLinked) return;
      await this.runAuth(() => account.bindWechat(), '微信已绑定，下次可用微信一键登录此账号。');
      return;
    }
    if (!this.requireConsent()) return;
    await this.runAuth(() => account.loginWechat(), '微信登录成功，欢迎来到悦创。');
  },

  async runAuth(operation, notice) {
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const session = await operation();
      if (!this._alive) return;
      this.applyUser(session.user);
      sync.activate({ pull: true });
      this.setData({ mode: 'login', showBind: false, password: '', confirmPassword: '', code: '', notice });
    } catch (error) {
      if (this._alive) {
        this.applyUser(account.getCachedUser());
        this.setData({ error: error.message || '操作未完成，请稍后重试。', password: '', confirmPassword: '' });
      }
    } finally {
      if (this._alive) this.setData({ busy: false });
    }
  },

  startBind() {
    if (!this.data.user || this.data.user.email || this.data.busy) return;
    this.setData({ mode: 'bind', showBind: true, email: '', username: '', password: '', confirmPassword: '', code: '', error: '', notice: '' });
    this.updateCooldown();
  },

  cancelBind() {
    if (this.data.busy) return;
    this.setData({ mode: 'login', showBind: false, password: '', confirmPassword: '', code: '', error: '', notice: '' });
    this.updateCooldown();
  },

  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', notice: '' });
    let notice = '已退出登录。';
    try { await account.logout(); } catch (_) { notice = '已退出登录，联网后会完成服务端退出。'; }
    if (!this._alive) return;
    this.applyUser(null);
    this.setData({ busy: false, showBind: false, mode: 'login', email: '', username: '', identifier: '', password: '', confirmPassword: '', code: '', agreed: false, notice });
    this.updateCooldown();
  },

  retrySession() { return this.onShow(); },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  continueBrowsing() { wx.reLaunch({ url: '/pages/home/index?tab=mine' }); }
});
