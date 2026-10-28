#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { verifyFingerprintedAssets } = require('./fingerprint-assets');
const root = path.resolve(__dirname, '..');
const release = process.argv.includes('--release');
let failed = false;

function check(ok, label) {
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) failed = true;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(function (entry) {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

try {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  check(project.compileType === 'miniprogram' && project.miniprogramRoot === 'miniprogram/', '普通小程序入口工程配置');
  const appRoot = path.join(root, 'miniprogram');
  const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  check(Array.isArray(config.pages) && config.pages.length > 0, '原生页面已注册');
  const packages = config.subPackages || [];
  const allPages = config.pages.concat(packages.flatMap(function (pack) { return pack.pages.map(function (page) { return pack.root + '/' + page; }); }));
  allPages.forEach(function (page) {
    check(['.js', '.json', '.wxml', '.wxss'].every(function (suffix) { return fs.existsSync(path.join(appRoot, page + suffix)); }), '页面完整 ' + page);
  });
  const site = require(path.join(appRoot, 'config.js'));
  const validOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(site.webOrigin || '');
  check(release ? validOrigin : validOrigin || site.webOrigin === '', '网页功能 HTTPS origin 配置');
  const files = walk(appRoot);
  const size = files.reduce(function (total, file) { return total + fs.statSync(file).size; }, 0);
  const subSizes = packages.map(function (pack) {
    const bytes = walk(path.join(appRoot, pack.root)).reduce(function (sum, file) { return sum + fs.statSync(file).size; }, 0);
    check(bytes < 2 * 1024 * 1024, '分包小于 2 MiB ' + pack.root + '（' + (bytes / 1024).toFixed(1) + ' KiB）');
    return bytes;
  });
  const mainSize = size - subSizes.reduce(function (sum, bytes) { return sum + bytes; }, 0);
  check(mainSize < 2 * 1024 * 1024, '主包小于 2 MiB（' + (mainSize / 1024).toFixed(1) + ' KiB）');
  check(size < 20 * 1024 * 1024, '全部本地代码与素材小于 20 MiB（' + (size / 1024).toFixed(1) + ' KiB）');
  check(!files.filter(function (file) { return file.endsWith('.wxml'); }).some(function (file) { return /<web-view\b/.test(fs.readFileSync(file, 'utf8')); }), '摄影、相册、挑战、悦学与育儿界面全部原生内置，无 web-view');
  const nativePhotos = require(path.join(appRoot, 'data/photos.js'));
  const crypto = require('node:crypto');
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'data/photo-assets.json'), 'utf8'));
  check(nativePhotos.collections.length === 9 && nativePhotos.collections.reduce(function (n, c) { return n + c.photos.filter(function (p) { return p.available; }).length; }, 0) === 169 && manifest.assets.length === 169 && manifest.assets.every(function (asset) {
    const file = path.join(appRoot, asset.url.slice(1));
    return /^\/photo-\d+\/assets\/photos\/[a-z0-9-]+\.jpg$/.test(asset.url) && fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === asset.sha256;
  }), '9 本真实相册与 169 张本地展示素材随代码内置并校验哈希');
  const scripts = files.concat(walk(path.join(root, 'minigame')), walk(path.join(root, 'web')), walk(path.join(root, 'worker')), walk(path.join(root, 'realtime'))).filter(function (file) { return /\.(?:js|mjs)$/.test(file); });
  scripts.forEach(function (file) {
    const result = child.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    check(result.status === 0, 'JS 语法 ' + path.relative(root, file));
    if (result.status !== 0) console.error(result.stderr);
  });
  const source = scripts.map(function (file) { return fs.readFileSync(file, 'utf8'); }).join('\n');
  check(!/\b(?:eval|Function)\s*\(/.test(source), '客户端与服务端源码没有动态代码执行');
  check(!files.some(function (file) { return /\.(?:pem|key|env)$/.test(file); }), '小程序上传目录没有私钥或环境文件');
  const scan = scripts.concat(walk(path.join(root, 'dist/web'))).filter(function (file) { return /\.(?:js|mjs|json|html|css|txt)$/.test(file); });
  const outputRoot = path.join(root, 'dist/web');
  check(['index.html', 'main.js', 'catalog.js', 'projects.json', '_worker.js', 'projects/firstsight/index.html', 'projects/firstsight/main.js'].every(function (file) { return fs.existsSync(path.join(outputRoot, file)); }), '综合门户与摄影项目已在同一产物构建');
  check(['account-runtime.js', 'account.js', 'account-widget.css'].every(function (file) { return fs.existsSync(path.join(outputRoot, file)); }) && /data-account-form/.test(fs.readFileSync(path.join(outputRoot, 'index.html'), 'utf8')), '网页注册、登录与共享账号运行时已构建');
  check(walk(path.join(outputRoot, 'projects')).filter(file => file.endsWith('.html')).every(function (file) {
    const html = fs.readFileSync(file, 'utf8');
    return /<script src="\/account-runtime\.js"><\/script>/.test(html) && html.indexOf('/account-runtime.js') < html.lastIndexOf('<script') && /href="\/account-widget\.css"/.test(html);
  }), '所有网页模块在游戏启动前接入账号隔离与同步');
  check(['bundle.js', 'runtime.js', 'sync.js', 'config.js'].every(function (file) { return fs.readFileSync(path.join(outputRoot, file), 'utf8') === '/* Retired. Use the content portal and registered projects. */\n'; }), '历史脚本仅返回退役占位');
  const registry = require(path.join(root, 'web/portal/catalog.js')).validateCatalog(JSON.parse(fs.readFileSync(path.join(outputRoot, 'projects.json'), 'utf8')));
  const version = require(path.join(root, 'package.json')).version;
  check(registry.version === version && site.version === version, '门户与原生版本一致');
  check(registry.categories.find(function (item) { return item.id === 'relax'; }).status === 'active' && registry.projects.some(function (item) { return item.id === 'ready-go-duel' && item.category === 'relax' && item.status === 'active'; }) && ['main.js', 'main.css', 'match/bundle.js'].every(function (file) { return fs.existsSync(path.join(outputRoot, 'projects/ready-go-duel', file)); }), '放松栏目、原版反应对决与积分扩展均已构建');
  const buildConfig = JSON.parse(fs.readFileSync(path.join(root, 'projects.config.json'), 'utf8'));
  for (const item of buildConfig.projects.filter(function (item) { return item.fingerprintAssets && registry.projects.some(function (entry) { return entry.id === item.id && entry.status === 'active'; }); })) {
    const folder = path.join(outputRoot, 'projects', item.id);
    check(verifyFingerprintedAssets(folder, fs.readFileSync(path.join(folder, 'index.html'), 'utf8')), '网页引用内容指纹资源，哈希及兼容文件一致 ' + item.id);
  }
  check(registry.categories.find(function (item) { return item.id === 'learn'; }).status === 'active' && registry.projects.some(function (item) { return item.id === 'lingotiles' && item.category === 'learn' && item.status === 'active'; }) && ['index.html', 'main.js', 'main.css', 'vocabulary/manifest.json', 'images/words/index/manifest.json'].every(function (file) { return fs.existsSync(path.join(outputRoot, 'projects/lingotiles', file)); }), '悦学栏目、词了个词及按需词库与现有插图索引均已构建');
  const covers = require('./check-nursery-covers').verifyNurseryCovers();
  check(covers.count === 47, '47 首独立儿歌封面、256px 压缩、来源提示词及网页字节一致');
  const nativeCatalog = require(path.join(appRoot, 'data/catalog.js'));
  check(nativeCatalog.features.map(function (feature) { return feature.id; }).sort().join(',') === 'blog,content-hub,firstsight,learn,lingotiles,nursery-music,ready-go-duel,relax,wedding-inspiration' && nativeCatalog.getFeatureRoute('lingotiles') === '/pages/lingotiles/index' && nativeCatalog.getFeatureRoute('nursery-music') === '/nursery/pages/player/index' && nativeCatalog.getFeatureUrl('nursery-music') === '' && config.pages.includes('pages/parenting/index'), '原生固定入口、育儿音乐及历史分享入口登记完整');
  check(nativeCatalog.getFeatureRoute('blog') === '/blog/pages/list/index' && packages.some(pack => pack.root === 'blog') && ['blog/index.html', 'blog/main.js', 'blog/style.css', 'blog/content.js', 'blog/cache.js'].every(file => fs.existsSync(path.join(outputRoot, file))), '博客原生分包、网页阅读写作与共享排版已构建');
  check(fs.readFileSync(path.join(outputRoot, 'blog/content.js'), 'utf8') === fs.readFileSync(path.join(appRoot, 'lib/blog-content.js'), 'utf8') && /api\/blog/.test(fs.readFileSync(path.join(outputRoot, '_worker.js'), 'utf8')), '博客两端排版字节一致且发布产物包含 API');
  check(fs.readFileSync(path.join(outputRoot, 'blog/cache.js'), 'utf8') === fs.readFileSync(path.join(appRoot, 'lib/blog-cache.js'), 'utf8'), '博客两端缓存引擎字节一致');
  const photoData = JSON.parse(fs.readFileSync(path.join(root, 'web/projects/firstsight/original-data.json'), 'utf8'));
  const photoAssets = photoData.assets.filter(function (asset) { return asset.available; });
  check(photoAssets.length > 2 && photoAssets.every(function (asset) {
    if (!/^\/projects\/firstsight\/assets\/original\/[a-f0-9]{20}\.(?:jpg|png|webp|gif)$/.test(asset.url)) return false;
    const file = path.join(outputRoot, asset.url.slice(1));
    return fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === asset.sha256;
  }), 'FirstSight_Online 全部上游优化 WebP 已按来源字节构建到同一项目');
  const firstsightBundle = fs.readFileSync(path.join(outputRoot, 'projects/firstsight/main.js'), 'utf8');
  check(!/comment\.bornforthis|waline|fonts\.googleapis|\.\/media\/(?:garden|coast)\.jpg/.test(firstsightBundle) && photoAssets.every(function (asset) { return firstsightBundle.includes(asset.url); }), 'FirstSight 使用真实摄影清单，未混入旧样例图或留言服务');
  check(!scan.some(function (file) { return /github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(fs.readFileSync(file, 'utf8')); }), '发布源码与网页产物无凭据内容');
  const hasAppId = /^wx[0-9a-f]{16}$/i.test(project.appid || '');
  check(release ? hasAppId : hasAppId || project.appid === 'touristappid', release ? '已配置真实小程序 AppID' : 'AppID 配置可用于本地开发');
  if (!hasAppId) console.log('PENDING 注册完成后配置真实 AppID；当前不能上传发布。');
  console.log('INFO 静态检查不验证微信账号类目、资质、备案、真机或审核状态。');
} catch (error) {
  failed = true;
  console.error(error.message);
}
process.exitCode = failed ? 1 : 0;
