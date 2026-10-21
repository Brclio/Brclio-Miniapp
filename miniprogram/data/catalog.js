const config = require('../config');
const photos = require('./photos');

const features = Object.freeze([
  Object.freeze({
    id: 'content-hub',
    title: '内容空间',
    subtitle: '收藏影像，也收藏生活的表达',
    category: '内容合集',
    description: '浏览摄影灵感与放松互动，发现当前已发布的内容与项目。',
    path: '/?entry=wechat'
  }),
  Object.freeze({
    id: 'firstsight',
    title: 'FirstSight 摄影',
    subtitle: '婚纱里的约定，孕期里的期待',
    category: '摄影',
    description: '浏览 FirstSight_Online 的 8 组婚纱与 1 组孕期影像，共 169 张实际摄影照片。',
    path: '/projects/firstsight/?entry=wechat'
  }),
  Object.freeze({
    id: 'relax',
    title: '放松',
    subtitle: '和身边的人，轻松互动片刻',
    category: '放松',
    description: '打开双人反应挑战，在同一部设备上和身边的人比一比反应速度。',
    path: '/?category=relax&entry=wechat'
  }),
  Object.freeze({
    id: 'ready-go-duel',
    title: '双人反应挑战',
    subtitle: '同屏双人，比一比反应速度',
    category: '放松',
    description: '原作触摸对决与无限挑战，包含开始音效、彩头、设置和战报；另保留 1、3、5 分计分与本机战绩扩展。',
    path: '/projects/ready-go-duel/?entry=wechat'
  }),
  Object.freeze({
    id: 'wedding-inspiration',
    title: '孕期影像',
    subtitle: '倾听你的心跳',
    category: '孕期摄影',
    description: '翻开 41 张孕期实际摄影，留住期待新生命的时光。',
    path: '/projects/firstsight/?entry=wechat#/album/pregnancy'
  })
]);

function getFeature(id) {
  if (typeof id !== 'string') return null;
  return features.find(function (feature) { return feature.id === id; }) || null;
}

function getFeatureUrl(id) {
  const feature = getFeature(id);
  if (!feature) return '';
  // An origin only: HTTPS, DNS hostname, no credentials, port, path, or query.
  // Route parameters never become part of this origin or the entry URL.
  const origin = config.webOrigin;
  if (typeof origin !== 'string' || !/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(origin)) return '';
  return origin + feature.path;
}

function getFeatureRoute(id) {
  if (!getFeature(id)) return '';
  const routes = {
    'content-hub': '/pages/home/index',
    firstsight: '/pages/gallery/index',
    relax: '/pages/home/index?tab=relax',
    'ready-go-duel': '/pages/duel/index',
    'wedding-inspiration': (photos.collections.find(function (album) { return album.id === 'pregnancy'; }) || {}).nativePath || '/pages/gallery/index'
  };
  return routes[id];
}

module.exports = { features, getFeature, getFeatureUrl, getFeatureRoute };
