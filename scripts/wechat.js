#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const command = process.argv[2] || 'doctor';
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const bundleNames = ['wechatwebdevtools.app', '微信开发者工具.app', 'WeChat DevTools.app'];
const candidates = [process.env.WECHAT_DEVTOOLS_CLI].concat(
  [path.join(os.homedir(), 'Applications'), '/Applications'].flatMap(function (folder) {
    return bundleNames.map(function (name) { return path.join(folder, name, 'Contents/MacOS/cli'); });
  })
).filter(Boolean);
const cli = candidates.find(function (file) { return fs.existsSync(file); });
if (!cli) {
  console.error('未找到微信开发者工具。请安装官方版本，或通过 WECHAT_DEVTOOLS_CLI 指定其 Contents/MacOS/cli 路径。');
  process.exitCode = 1;
} else if (command === 'doctor') {
  console.log('开发者工具 CLI：' + cli);
  console.log('AppID：' + config.appid);
  console.log('工程类型：' + config.compileType);
  console.log('后续需要登录、确认账号类型，并在工具设置中允许服务端口。此检查不代表已上传或发布。');
} else {
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const commands = {
    open: ['open', '--project', root],
    login: ['login', '--qr-format', 'image', '--qr-output', path.join(root, 'artifacts/wechat-login.png')],
    preview: ['preview', '--project', root, '--qr-format', 'image', '--qr-output', path.join(root, 'artifacts/wechat-preview.png'), '--info-output', path.join(root, 'artifacts/wechat-preview.json')],
    upload: ['upload', '--project', root, '--version', '0.1.1', '--desc', '恢复FirstSight原有摄影图集与首页原图封面，提供14组相册及大图浏览；保留摄影、放松内容入口与同屏双人反应挑战，本机保存记录，无需登录。', '--info-output', path.join(root, 'artifacts/wechat-upload.json')]
  };
  if (!commands[command]) {
    console.error('支持的命令：doctor、open、login、preview、upload');
    process.exitCode = 1;
  } else {
    const result = spawnSync(cli, commands[command], { cwd: root, stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status === null ? 1 : result.status;
  }
}
