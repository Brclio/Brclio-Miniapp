const PLAYER_PATH = '/nursery/pages/music-box/index';

function playerPath(scene, song) {
  const params = [];
  if (['all', 'active', 'sleep', 'favorites'].includes(scene)) params.push('scene=' + encodeURIComponent(scene));
  if (song && require('../data/nursery-songs').SONGS.some(item => item.id === song)) params.push('song=' + encodeURIComponent(song));
  return PLAYER_PATH + (params.length ? '?' + params.join('&') : '');
}

function createPlayerRedirect(platform) {
  return {
    data: { failed: false },
    onLoad(options = {}) {
      this._target = playerPath(options.scene, options.song);
      this.openPlayer();
    },
    openPlayer() {
      this.setData({ failed: false });
      platform.redirectTo({ url: this._target, fail: () => this.setData({ failed: true }) });
    },
    onShareAppMessage() { return { title: 'Brclio · 儿歌陪伴', path: this._target || PLAYER_PATH }; }
  };
}

module.exports = { PLAYER_PATH, createPlayerRedirect };
