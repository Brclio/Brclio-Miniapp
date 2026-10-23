const { SONGS } = require('../../../data/nursery-songs');
const { getNurseryAudio } = require('../../../lib/nursery-audio');

const MODES = { sequence: '顺序播放', shuffle: '随机播放', 'repeat-one': '单曲循环' };
const SCENES = [
  { id: 'all', title: '全部儿歌', symbol: '♪' },
  { id: 'active', title: '蹦跳时光', symbol: '☀' },
  { id: 'sleep', title: '睡前轻听', symbol: '☾' },
  { id: 'favorites', title: '我的收藏', symbol: '♡' }
];
function clock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(value / 60).toString().padStart(2, '0') + ':' + (value % 60).toString().padStart(2, '0');
}

Page({
  data: {
    scenes: SCENES, scene: 'all', query: '', songs: [], total: SONGS.length,
    currentSong: SONGS[0], status: 'idle', isPlaying: false, isLoading: false,
    currentTime: 0, duration: 0, currentTimeText: '00:00', durationText: '00:00',
    mode: 'sequence', modeText: MODES.sequence, favorite: false, favorites: [],
    sleepText: '定时关闭', sleepActive: false, storageNotice: '', error: '', compact: false, statusText: '选一首，听听吧',
    coverFailures: {}, listTitle: '全部儿歌', emptyTitle: '', emptyCopy: '', audioBackend: ''
  },

  onLoad(options) {
    this._alive = true;
    this._audio = getNurseryAudio();
    const scene = options && options.scene;
    if (SCENES.some(item => item.id === scene)) this.setData({ scene });
    const song = options && options.song;
    if (SONGS.some(item => item.id === song)) this._audio.select(song);
    else if (!this._audio.getState().currentSong) {
      const queue = SONGS.filter(item => scene !== 'sleep' && scene !== 'active' || item.scene === scene);
      this._audio.select((queue[0] || SONGS[0]).id, { queue: queue.map(item => item.id) });
    }
    this._unsubscribe = this._audio.subscribe(state => this.applyAudioState(state));
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  onShow() {
    if (this._audio) this.applyAudioState(this._audio.getState());
  },
  onUnload() {
    this._alive = false;
    if (this._unsubscribe) this._unsubscribe();
  },
  onPageScroll(event) {
    const compact = event.scrollTop > 450;
    if (compact !== this.data.compact) this.setData({ compact });
  },
  applyAudioState(state) {
    if (!this._alive) return;
    this._state = state;
    const song = state.currentSong || SONGS[0];
    if (this.data.currentSong.id !== song.id) this._seeking = false;
    const duration = state.duration || song.duration || 0;
    const playing = state.status === 'playing';
    const loading = state.status === 'loading';
    this.setData({
      currentSong: song, status: state.status, isPlaying: playing, isLoading: loading,
      currentTime: this._seeking ? this.data.currentTime : state.currentTime,
      currentTimeText: clock(this._seeking ? this.data.currentTime : state.currentTime),
      duration, durationText: clock(duration), mode: state.mode, modeText: MODES[state.mode] || MODES.sequence,
      favorites: state.favorites, favorite: state.favorites.indexOf(song.id) !== -1,
      sleepActive: state.sleepRemaining > 0,
      sleepText: state.sleepRemaining > 0 ? clock(state.sleepRemaining) + ' 后停止' : '定时关闭',
      error: state.error || '', storageNotice: state.storageNotice || '', audioBackend: state.audioBackend,
      statusText: loading ? '正在加载音乐…' : playing ? '正在播放' : state.status === 'error' ? '暂时无法播放' : state.status === 'paused' ? '已暂停，慢慢来' : '选一首，听听吧'
    });
    const listSignature = [song.id, playing, state.favorites.join(',')].join('|');
    if (this._listSignature !== listSignature) {
      this._listSignature = listSignature;
      this.updateList();
    }
  },
  updateList() {
    const { scene, favorites, query, currentSong, isPlaying } = this.data;
    const text = query.trim().toLowerCase();
    const songs = SONGS.filter(song => {
      const matches = scene === 'all' || (scene === 'favorites' ? favorites.indexOf(song.id) !== -1 : song.scene === scene || (song.scenes || []).indexOf(scene) !== -1);
      return matches && (!text || song.title.toLowerCase().indexOf(text) !== -1);
    }).map((song, index) => ({
      id: song.id, title: song.title, cover: song.cover, number: String(index + 1).padStart(2, '0'),
      sceneLabel: song.scene === 'sleep' ? '睡前轻听' : '蹦跳儿歌', durationText: clock(song.duration),
      favorite: favorites.indexOf(song.id) !== -1,
      selected: !!currentSong && song.id === currentSong.id,
      playing: !!currentSong && song.id === currentSong.id && isPlaying
    }));
    this._visibleIds = songs.map(song => song.id);
    this.setData({ songs, listTitle: scene === 'favorites' ? '收藏的儿歌' : scene === 'sleep' ? '睡前轻听' : scene === 'active' ? '蹦跳时光' : '全部儿歌',
      emptyTitle: text ? '还没找到这首歌' : '把喜欢的儿歌留下来',
      emptyCopy: text ? '换个歌名试试，或清空搜索看看。' : '点击歌曲旁的爱心，下次就能在这里找到。'
    });
  },
  onCoverError(event) {
    const id = event.currentTarget.dataset.id;
    if (!SONGS.some(song => song.id === id) || this.data.coverFailures[id]) return;
    this.setData({ coverFailures: Object.assign({}, this.data.coverFailures, { [id]: true }) });
  },
  switchScene(event) {
    const scene = event.currentTarget.dataset.scene;
    if (!SCENES.some(item => item.id === scene)) return;
    this.setData({ scene }); this.updateList();
  },
  searchSongs(event) { this.setData({ query: event.detail.value || '' }); this.updateList(); },
  clearSearch() { this.setData({ query: '' }); this.updateList(); },
  playSong(event) {
    const id = event.currentTarget.dataset.id;
    if (!SONGS.some(song => song.id === id)) return;
    if (this.data.currentSong.id === id && (this.data.isPlaying || this.data.isLoading)) this._audio.pause();
    else this._audio.play(id, { queue: this._visibleIds });
  },
  togglePlayback() { this._audio.toggle(); },
  previousSong() { this._audio.previous(); },
  nextSong() { this._audio.next(); },
  changeMode() {
    this._audio.cycleMode();
    wx.showToast({ title: MODES[this._audio.getState().mode], icon: 'none' });
  },
  toggleFavorite(event) {
    const id = event.currentTarget.dataset.id || this.data.currentSong.id;
    this._audio.toggleFavorite(id);
  },
  previewSeek(event) {
    this._seeking = true;
    this._seekSongId = this.data.currentSong.id;
    this.setData({ currentTime: event.detail.value, currentTimeText: clock(event.detail.value) });
  },
  seekSong(event) {
    this._seeking = false;
    if (this._seekSongId && this._seekSongId !== this.data.currentSong.id) {
      this._seekSongId = null;
      this.applyAudioState(this._audio.getState());
      return;
    }
    this._seekSongId = null;
    this._audio.seek(event.detail.value);
    this.applyAudioState(this._audio.getState());
  },
  chooseSleepTimer() {
    const minutes = [0, 15, 30, 60];
    wx.showActionSheet({
      alertText: '定时停止请保持小程序在前台；锁屏或切到后台可能受微信限制。',
      itemList: ['关闭定时', '15 分钟后停止（前台）', '30 分钟后停止（前台）', '60 分钟后停止（前台）'],
      success: result => {
        if (!this._alive || !Number.isInteger(result.tapIndex) || result.tapIndex < 0 || result.tapIndex >= minutes.length) return;
        const value = minutes[result.tapIndex];
        this._audio.setSleepTimer(value);
        wx.showToast({ title: value ? value + ' 分钟后停止播放' : '已关闭定时', icon: 'none' });
      }
    });
  },
  retryPlayback() { this._audio.play(this.data.currentSong.id); },
  scrollToPlayer() { wx.pageScrollTo({ scrollTop: 0, duration: 220 }); },
  onShareAppMessage() {
    const song = this.data.currentSong;
    return { title: '一起听《' + song.title + '》 · Brclio 儿歌陪伴', path: '/pages/parenting/index?song=' + encodeURIComponent(song.id), imageUrl: song.cover };
  },
  onShareTimeline() {
    const song = this.data.currentSong;
    return { title: '一起听《' + song.title + '》 · Brclio 儿歌陪伴', query: 'song=' + encodeURIComponent(song.id) };
  }
});
