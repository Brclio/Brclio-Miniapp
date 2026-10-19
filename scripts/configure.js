#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const index = args.indexOf('--appid');
const appid = index >= 0 ? args[index + 1] : undefined;
if (!appid || !/^wx[0-9a-f]{16}$/i.test(appid)) {
  console.error('用法：npm run configure -- --appid wx你的16位AppID（无需 AppSecret）');
  process.exitCode = 1;
} else {
  const file = path.resolve(__dirname, '../project.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.appid = appid;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log('已配置小程序 AppID：' + appid);
  console.log('下一步：微信开发者工具导入项目根目录，完成编译和真机预览。');
}
