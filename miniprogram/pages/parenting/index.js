const { SONGS } = require('../../data/nursery-songs');

// Preserve links shared before the player moved into its own small asset package.
Page({
  data: { failed: false },
  onLoad(options) {
    const query = options || {}, params = [];
    if (['all', 'active', 'sleep', 'favorites'].includes(query.scene)) params.push('scene=' + encodeURIComponent(query.scene));
    if (SONGS.some(song => song.id === query.song)) params.push('song=' + encodeURIComponent(query.song));
    this._target = '/nursery/pages/player/index' + (params.length ? '?' + params.join('&') : '');
    this.openPlayer();
  },
  openPlayer() {
    this.setData({ failed: false });
    wx.redirectTo({ url: this._target, fail: () => this.setData({ failed: true }) });
  },
  onShareAppMessage() { return { title: 'Brclio · 儿歌陪伴', path: '/pages/parenting/index' }; }
});
