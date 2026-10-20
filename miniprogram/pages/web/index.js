// Compatibility for existing shared links. All known entries now open native pages.
const catalog = require('../../data/catalog');
Page({
  data: { errorTitle: '', errorMessage: '', canRetry: false },
  onLoad(options) {
    this.feature = catalog.getFeature(options && options.id);
    this.entryRoute = this.feature ? catalog.getFeatureRoute(this.feature.id) : '';
    if (!this.entryRoute) {
      this.setData({ errorTitle: '没有找到这个体验', errorMessage: '请回到首页，选择当前已收纳的功能。' });
      return;
    }
    this.openEntry();
  },
  openEntry() {
    if (!this.entryRoute) return;
    this.setData({ errorTitle: '', errorMessage: '', canRetry: false });
    wx.redirectTo({ url: this.entryRoute, fail: () => {
      this.setData({ errorTitle: '暂时无法打开', errorMessage: '请返回首页后重试。', canRetry: true });
    } });
  },
  goHome() { wx.reLaunch({ url: '/pages/home/index' }); },
  onShareAppMessage() {
    return { title: this.feature ? 'Brclio 悦创 · ' + this.feature.title : 'Brclio 悦创', path: this.entryRoute || '/pages/home/index' };
  }
});
