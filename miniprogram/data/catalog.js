const config = require('../config');
const photos = require('./photos');

const features = Object.freeze([
  Object.freeze({
    id: 'content-hub',
    title: '内容空间',
    subtitle: '收藏影像，也收藏生活的表达',
    category: '内容合集',
    description: '浏览摄影、放松互动、悦学与育儿项目，给喜欢的事留一点时间。',
    path: '/?entry=wechat'
  }),
  Object.freeze({
    id: 'blog',
    title: 'Brclio 博客',
    subtitle: '阅读，也留下你的想法',
    category: '博客',
    description: '阅读公开文章，搜索分类与标签，登录后点赞和收藏。',
    path: '/blog/?entry=wechat'
  }),
  Object.freeze({
    id: 'learn',
    title: '悦学',
    subtitle: '每天学一点，好奇多一点',
    category: '悦学',
    description: '在轻松的记忆与配对中，慢慢积累新单词。',
    path: '/?category=learn&entry=wechat'
  }),
  Object.freeze({
    id: 'lingotiles',
    title: '词了个词',
    subtitle: 'LingoTiles · 先记忆，再消除',
    category: '悦学',
    description: '经典主题与小学到大学的分级闯关，保留三牌配对、单词本、收藏和通关记录。',
    path: '/projects/lingotiles/?entry=wechat'
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
    id: 'parenting-guide',
    title: '悦创育儿宝典',
    subtitle: '读懂孩子，一起成长',
    category: 'parenting',
    description: '阅读悦创育儿宝典文字专栏，了解智力发展、情绪管理与亲子沟通。',
    nativeOnly: true
  }),
  Object.freeze({
    id: 'nursery-music',
    title: '儿歌多多',
    subtitle: '小小音乐盒，陪伴每一天',
    category: 'parenting',
    description: '在儿歌与轻音乐里，听见每天的小小快乐。支持歌单浏览、播放控制与睡前轻听。',
    nativeOnly: true
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
  if (!feature || feature.nativeOnly) return '';
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
    blog: '/blog/pages/list/index',
    firstsight: '/pages/gallery/index',
    relax: '/pages/home/index?tab=relax',
    learn: '/pages/home/index?tab=learn',
    lingotiles: '/pages/lingotiles/index',
    'nursery-music': '/nursery/pages/player/index',
    'parenting-guide': '/parenting/pages/list/index',
    'ready-go-duel': '/pages/duel/index',
    'wedding-inspiration': (photos.collections.find(function (album) { return album.id === 'pregnancy'; }) || {}).nativePath || '/pages/gallery/index'
  };
  return routes[id];
}

module.exports = { features, getFeature, getFeatureUrl, getFeatureRoute };
