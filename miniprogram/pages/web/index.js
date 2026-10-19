const catalog = require('../../data/catalog');

Page({
  data: {
    src: '',
    errorTitle: '',
    errorMessage: '',
    canRetry: false
  },

  onLoad(options) {
    this.feature = catalog.getFeature(options.id);
    if (!this.feature) {
      this.setData({ errorTitle: '没有找到这个体验', errorMessage: '请回到首页，选择当前已收纳的功能。' });
      return;
    }
    wx.setNavigationBarTitle({ title: this.feature.title });
    this.entryUrl = catalog.getFeatureUrl(this.feature.id);
    if (!this.entryUrl) {
      this.setData({ errorTitle: '功能页面尚未配置', errorMessage: '网页服务接入完成后，即可从这里打开体验。' });
      return;
    }
    this.openEntry();
  },

  openEntry() {
    if (!this.entryUrl) return;
    wx.showNavigationBarLoading();
    this.setData({ src: '', errorTitle: '', errorMessage: '', canRetry: false }, () => {
      this.setData({ src: this.entryUrl });
    });
  },

  handleLoad() {
    wx.hideNavigationBarLoading();
  },

  handleError() {
    wx.hideNavigationBarLoading();
    this.setData({
      src: '',
      errorTitle: '暂时无法打开',
      errorMessage: '请检查网络后重试。如果仍无法打开，可稍后再试。',
      canRetry: true
    });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  onUnload() {
    wx.hideNavigationBarLoading();
  },

  onShareAppMessage() {
    const feature = this.feature;
    return feature
      ? { title: 'Brclio 口袋 · ' + feature.title, path: '/pages/web/index?id=' + encodeURIComponent(feature.id) }
      : { title: 'Brclio 口袋', path: '/pages/home/index' };
  }
});
