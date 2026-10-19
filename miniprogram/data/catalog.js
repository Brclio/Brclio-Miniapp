const config = require('../config');

const features = Object.freeze([
  Object.freeze({
    id: 'wedding-inspiration',
    title: '婚纱灵感图册',
    subtitle: '为重要的一天，收集一点灵感',
    category: '婚礼灵感',
    description: '浏览花园与海岸主题的 AI 生成婚纱示意图，发现喜欢的氛围、色彩与造型。',
    path: '/?entry=wechat'
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
