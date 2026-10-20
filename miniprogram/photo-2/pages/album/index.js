const photoData = require('../../data/photos');

function validIndex(value, length) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < length ? index : -1;
}

Page({
  data: {
    album: null,
    photos: [],
    notFound: false,
    hasUnavailable: false,
    previewOpen: false,
    previewIndex: 0,
    previewPosition: 1,
    previewPhoto: null,
    previewScale: 1,
    previewZoomed: false,
    previewX: 0,
    previewY: 0
  },

  onLoad(options) {
    const id = options && typeof options.id === 'string' ? options.id : '';
    const album = photoData.collections.find(function (collection) { return collection.id === id; });
    if (!album) {
      this.setData({ notFound: true });
      return;
    }
    const photos = album.photos.map(function (photo, index) {
      return Object.assign({}, photo, {
        available: Boolean(photo.available && photo.url),
        number: String(index + 1).padStart(2, '0')
      });
    });
    this.setData({
      album: { id: album.id, category: album.category, nativePath: album.nativePath, title: album.title, subtitle: album.subtitle, description: album.description },
      photos: photos,
      hasUnavailable: photos.some(function (photo) { return !photo.available; })
    });
    wx.setNavigationBarTitle({ title: album.title });
  },

  openPhoto(event) {
    const index = validIndex(event.currentTarget.dataset.index, this.data.photos.length);
    if (index === -1) return;
    this._lastTap = null;
    this.setData({
      previewOpen: true,
      previewIndex: index,
      previewPosition: index + 1,
      previewPhoto: this.data.photos[index],
      previewScale: 1,
      previewZoomed: false,
      previewX: 0,
      previewY: 0
    });
  },

  closePreview() {
    this._lastTap = null;
    this.setData({ previewOpen: false, previewScale: 1, previewZoomed: false, previewX: 0, previewY: 0 });
  },

  onPreviewChange(event) {
    if (this.data.previewZoomed) return;
    const index = validIndex(event.detail.current, this.data.photos.length);
    if (index === -1 || index === this.data.previewIndex) return;
    this.goToPhoto(index);
  },

  goToPhoto(index) {
    if (!this.data.previewOpen || validIndex(index, this.data.photos.length) === -1) return;
    this._lastTap = null;
    this.setData({ previewIndex: index, previewPosition: index + 1, previewPhoto: this.data.photos[index], previewScale: 1, previewZoomed: false, previewX: 0, previewY: 0 });
  },

  previousPhoto() {
    if (this.data.previewIndex > 0) this.goToPhoto(this.data.previewIndex - 1);
  },

  nextPhoto() {
    if (this.data.previewIndex < this.data.photos.length - 1) this.goToPhoto(this.data.previewIndex + 1);
  },

  toggleZoom() {
    if (!this.data.previewOpen || !this.data.previewPhoto || !this.data.previewPhoto.available) return;
    const scale = this.data.previewZoomed ? 1 : 2;
    this.setData({ previewScale: scale, previewZoomed: scale > 1, previewX: 0, previewY: 0 });
  },

  onPreviewTap(event) {
    const index = validIndex(event.currentTarget.dataset.index, this.data.photos.length);
    if (index !== this.data.previewIndex) return;
    const now = Date.now();
    if (this._lastTap && this._lastTap.index === index && now - this._lastTap.time < 300) {
      this._lastTap = null;
      this.toggleZoom();
    } else {
      this._lastTap = { index: index, time: now };
    }
  },

  onPreviewScale(event) {
    if (Number(event.currentTarget.dataset.index) !== this.data.previewIndex) return;
    const scale = Number(event.detail.scale);
    if (!Number.isFinite(scale) || scale < 1 || scale > 4) return;
    if (!this.data.previewZoomed || Math.abs(scale - this.data.previewScale) < .01) return;
    this.setData({ previewScale: scale });
  },

  onPreviewMove(event) {
    if (Number(event.currentTarget.dataset.index) !== this.data.previewIndex || !this.data.previewZoomed) return;
    const detail = event.detail;
    if (detail.source !== 'touch' && detail.source !== 'touch-out-of-bounds') return;
    if (Number.isFinite(detail.x) && Number.isFinite(detail.y)) this.setData({ previewX: detail.x, previewY: detail.y });
  },

  onPhotoError(event) {
    const index = validIndex(event.currentTarget.dataset.index, this.data.photos.length);
    if (index === -1 || !this.data.photos[index].available) return;
    const update = { hasUnavailable: true };
    update['photos[' + index + '].available'] = false;
    if (this.data.previewOpen && this.data.previewIndex === index) {
      update.previewPhoto = Object.assign({}, this.data.photos[index], { available: false });
      update.previewScale = 1;
      update.previewZoomed = false;
    }
    this.setData(update);
  },

  preventPageScroll() {},

  returnToAlbums() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1 && pages[pages.length - 2].route === 'pages/gallery/index') {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.redirectTo({ url: '/pages/gallery/index' });
    }
  },

  onShareAppMessage() {
    const album = this.data.album;
    return album && album.nativePath ? { title: album.title + ' · FirstSight 摄影', path: album.nativePath } : { title: 'FirstSight 摄影', path: '/pages/gallery/index' };
  },

  onShareTimeline() {
    const album = this.data.album;
    return album ? { title: album.title + ' · FirstSight 摄影', query: 'id=' + encodeURIComponent(album.id) } : { title: 'FirstSight 摄影' };
  }
});
