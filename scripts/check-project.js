#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
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
  config.pages.forEach(function (page) {
    check(['.js', '.json', '.wxml', '.wxss'].every(function (suffix) { return fs.existsSync(path.join(appRoot, page + suffix)); }), '页面完整 ' + page);
  });
  const site = require(path.join(appRoot, 'config.js'));
  const validOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(site.webOrigin || '');
  check(release ? validOrigin : validOrigin || site.webOrigin === '', '网页功能 HTTPS origin 配置');
  const files = walk(appRoot);
  const size = files.reduce(function (total, file) { return total + fs.statSync(file).size; }, 0);
  check(size < 4 * 1024 * 1024, '代码包小于项目设定的 4 MiB 预算（当前 ' + (size / 1024).toFixed(1) + ' KiB）');
  const scripts = files.concat(walk(path.join(root, 'minigame')), walk(path.join(root, 'web')), walk(path.join(root, 'worker'))).filter(function (file) { return /\.(?:js|mjs)$/.test(file); });
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
  check(['index.html', 'main.js', 'assets/garden.jpg', 'assets/coast.jpg'].every(function (file) { return fs.existsSync(path.join(outputRoot, file)); }), '图册与两幅 AI 图片已构建');
  check(['bundle.js', 'runtime.js', 'sync.js', 'config.js'].every(function (file) { return fs.readFileSync(path.join(outputRoot, file), 'utf8') === '/* Retired. This release contains only the wedding lookbook. */\n'; }), '历史脚本 URL 已替换为空操作退役文件，旧功能代码未发布');
  check(require(path.join(appRoot, 'data/catalog.js')).features.every(function (feature) { return feature.id === 'wedding-inspiration'; }), '首发目录仅开放婚纱灵感图册');
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
