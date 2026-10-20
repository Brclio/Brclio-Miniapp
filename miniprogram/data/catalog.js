const config = require('../config');

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
    subtitle: '光影、构图与婚纱氛围的灵感示例',
    category: '摄影',
    description: '浏览 FirstSight 婚纱摄影灵感，图片由 AI 生成，供氛围、色彩与造型参考，非真实客片。',
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
    description: '两人在同一部设备上进行反应挑战，支持 1、3、5 分赛制、抢跑判定和本机历史记录。',
    path: '/projects/ready-go-duel/?entry=wechat'
  }),
  Object.freeze({
    id: 'wedding-inspiration',
    title: '婚纱灵感图册',
    subtitle: '为重要的一天，收集一点灵感',
    category: '婚礼灵感',
    description: '浏览花园与海岸主题的 AI 生成婚纱示意图，发现喜欢的氛围、色彩与造型。',
    path: '/projects/wedding/?entry=wechat'
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

module.exports = { features, getFeature, getFeatureUrl };
