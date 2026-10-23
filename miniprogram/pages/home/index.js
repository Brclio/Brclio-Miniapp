const catalog = require('../../data/catalog');
const account = require('../../lib/account');
const sync = require('../../lib/account-sync');

Page({
  data: {
    activeTab: 'photo',
    accountUser: null,
    accountLabel: '',
    accountInitial: '',
    syncMessage: '',
    featured: catalog.getFeature('firstsight')
  },

  onLoad(options) {
    this._alive = true;
    this.setData({ syncMessage: sync.getStatus().message });
    this._unsubscribeSync = sync.subscribe(status => { if (this._alive) this.setData({ syncMessage: status.message }); });
    if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: 'Brclio 悦创' });
    const tab = options && options.tab;
    if (['photo', 'relax', 'learn', 'parenting', 'mine'].indexOf(tab) !== -1) this.setData({ activeTab: tab });
  },

  async onShow() {
    this._alive = true;
    const user = typeof account.getCachedUser === 'function' ? account.getCachedUser() : null;
    this.applyAccountUser(user);
    sync.onShow({ pull: true });
    if (!user || this._accountRefreshing) return;
    this._accountRefreshing = true;
    try {
      const session = await account.refreshSession();
      if (this._alive) this.applyAccountUser(session && session.user);
    } catch (_) {
      if (this._alive) this.applyAccountUser(account.getCachedUser());
    } finally { this._accountRefreshing = false; }
  },

  onHide() { sync.onHide(); },
  onUnload() { this._alive = false; if (this._unsubscribeSync) this._unsubscribeSync(); },

  applyAccountUser(user) {
    const label = user ? user.displayName || user.username || (user.email ? user.email.split('@')[0] : '微信用户') : '';
    this.setData({ accountUser: user, accountLabel: label, accountInitial: label.slice(0, 1).toUpperCase() });
  },

  openAccount(event) {
    const mode = event && event.currentTarget && event.currentTarget.dataset.mode;
    wx.navigateTo({ url: '/pages/account/index' + (mode === 'register' ? '?mode=register' : '') });
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (['photo', 'relax', 'learn', 'parenting', 'mine'].indexOf(tab) === -1 || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'mine' && typeof account.getCachedUser === 'function') this.applyAccountUser(account.getCachedUser());
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  openFeature(event) {
    const id = event.currentTarget.dataset.id;
    if (!catalog.getFeature(id)) return;
    sync.flush();
    const scene = event.currentTarget.dataset.scene;
    const query = id === 'nursery-music' && scene === 'sleep' ? '?scene=sleep' : '';
    wx.navigateTo({ url: catalog.getFeatureRoute(id) + query });
  },

  openAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  onShareAppMessage() {
    return { title: 'Brclio 悦创 · 摄影、放松、悦学与育儿', path: '/pages/home/index' + (this.data.activeTab === 'parenting' ? '?tab=parenting' : '') };
  },

  onShareTimeline() {
    const share = { title: 'Brclio 悦创 · 摄影、放松、悦学与育儿' };
    if (this.data.activeTab === 'parenting') share.query = 'tab=parenting';
    return share;
  }
});
