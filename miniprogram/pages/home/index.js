const catalog = require('../../data/catalog');

Page({
  data: { featured: catalog.getFeature('firstsight') },

  openFeature(event) {
    const id = event.currentTarget.dataset.id;
    if (!catalog.getFeature(id)) return;
    wx.navigateTo({ url: '/pages/web/index?id=' + encodeURIComponent(id) });
  },

  openAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  onShareAppMessage() {
    return { title: 'Brclio 口袋 · 摄影与生活的内容空间', path: '/pages/home/index' };
  },

  onShareTimeline() {
    return { title: 'Brclio 口袋 · 摄影与生活的内容空间' };
  }
});
