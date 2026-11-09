#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const command = process.argv[2] || 'doctor';
const version = require('../package.json').version;
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
    upload: ['upload', '--project', root, '--version', version, '--desc', 'Brclio 悦创 ' + version + '：调整页面入口文案。', '--info-output', path.join(root, 'artifacts/wechat-upload-' + version + '.json')]
  };
  if (!commands[command]) {
    console.error('支持的命令：doctor、open、login、preview、upload');
    process.exitCode = 1;
  } else {
    const args = commands[command];
    const infoIndex = args.indexOf('--info-output');
    const report = infoIndex >= 0 ? args[infoIndex + 1] : '';
    // DevTools can exit zero after an authentication failure. Only accept a new package report.
    const pending = report && report + '.' + require('node:crypto').randomUUID() + '.json';
    if (report) args[infoIndex + 1] = pending;
    const result = spawnSync(cli, args, { cwd: root, stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status === null ? 1 : result.status;
    if (report) {
      try {
        if (!process.exitCode) {
          const size = JSON.parse(fs.readFileSync(pending, 'utf8')).size;
          if (!(size?.total > 0) || !size.packages?.some(pkg => pkg.name === 'main' && pkg.size > 0)) throw Error('invalid package report');
          fs.renameSync(pending, report);
        }
      } catch {
        console.error('微信开发者工具未返回本次有效的代码包报告，请查看上方官方结果。');
        process.exitCode = 1;
      } finally {
        fs.rmSync(pending, { force: true });
      }
    }
  }
}
