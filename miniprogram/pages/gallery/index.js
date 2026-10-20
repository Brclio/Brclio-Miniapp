const photoData = require('../../data/photos');

const groups = [
  { id: 'all', label: '全部' },
  { id: 'wedding', label: '婚纱' },
  { id: 'pregnancy', label: '孕期' }
];

function belongsTo(collection, category) {
  return category === 'all' || collection.category === category;
}

Page({
  data: {
    category: 'all',
    categories: [],
    collections: [],
    featured: null,
    albumCount: 0,
    photoCount: 0,
    hasUnavailable: false
  },

  onLoad() {
    this._collections = photoData.collections.map(function (collection, index) {
      return Object.assign({}, collection, {
        number: String(index + 1).padStart(2, '0'),
        photoCount: Array.isArray(collection.photos) ? collection.photos.length : Number(collection.photoCount) || 0,
        coverFailed: !collection.cover
      });
    });
    const collections = this._collections;
    this.setData({
      categories: groups.map(function (group) {
        return Object.assign({}, group, { count: collections.filter(function (item) { return belongsTo(item, group.id); }).length });
      }),
      collections: collections,
      featured: collections.find(function (collection) { return collection.id === 'ws1'; }) || collections[0] || null,
      albumCount: collections.length,
      photoCount: collections.reduce(function (sum, collection) { return sum + collection.photoCount; }, 0),
      hasUnavailable: collections.some(function (collection) { return Boolean(collection.hasUnavailable) || (Array.isArray(collection.photos) && collection.photos.some(function (photo) { return !photo.available; })); })
    });
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.id;
    if (!groups.some(function (group) { return group.id === category; }) || category === this.data.category) return;
    this.setData({
      category: category,
      collections: this._collections.filter(function (collection) { return belongsTo(collection, category); })
    });
  },

  openAlbum(event) {
    const id = event.currentTarget.dataset.id;
    const collection = this._collections && this._collections.find(function (item) { return item.id === id; });
    if (!collection || typeof collection.nativePath !== 'string' || !collection.nativePath) return;
    wx.navigateTo({ url: collection.nativePath });
  },

  onCoverError(event) {
    const id = event.currentTarget.dataset.id;
    if (!this._collections) return;
    this._collections = this._collections.map(function (collection) {
      return collection.id === id ? Object.assign({}, collection, { coverFailed: true }) : collection;
    });
    this.setData({
      collections: this._collections.filter((collection) => belongsTo(collection, this.data.category)),
      featured: this._collections.find(function (collection) { return collection.id === 'ws1'; }) || this._collections[0] || null
    });
  },

  returnHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  onShareAppMessage() {
    return { title: 'FirstSight 摄影 · 把日常，看成风景。', path: '/pages/gallery/index' };
  },

  onShareTimeline() {
    return { title: 'FirstSight 摄影 · 把日常，看成风景。' };
  }
});
