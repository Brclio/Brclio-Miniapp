const catalog = require('../../data/catalog');
const { createAccountClient } = require('../../lib/account');

Page({
  data: {
    activeTab: 'photo',
    accountName: '',
    featured: catalog.getFeature('firstsight')
  },

  onLoad(options) {
    if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: 'Brclio 悦创' });
    const tab = options && options.tab;
    if (['photo', 'relax', 'mine'].indexOf(tab) !== -1) this.setData({ activeTab: tab });
  },

  onShow() {
    const user = createAccountClient(wx).currentUser();
    this.setData({ accountName: user ? user.nickname || user.username : '' });
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (['photo', 'relax', 'mine'].indexOf(tab) === -1 || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  openFeature(event) {
    const id = event.currentTarget.dataset.id;
    if (!catalog.getFeature(id)) return;
    wx.navigateTo({ url: catalog.getFeatureRoute(id) });
  },

  openAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  openAccount() {
    wx.navigateTo({ url: '/pages/account/index' });
  },

  onShareAppMessage() {
    return { title: 'Brclio 悦创 · 摄影与放松', path: '/pages/home/index' };
  },

  onShareTimeline() {
    return { title: 'Brclio 悦创 · 摄影与放松' };
  }
});
