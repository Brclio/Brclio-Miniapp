const config = require('../../config');

Page({
  data: { version: config.version },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  }
});
