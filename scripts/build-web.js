#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// The initial published collection contains only the wedding lookbook.
// Retained experimental interactions are deliberately excluded from this build.
const source = path.join(root, 'web', 'wedding');
const output = path.join(root, 'dist', 'web');

// A fixed output directory keeps cleanup away from source and credentials.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const filename of ['index.html', 'style.css', 'main.js']) {
  fs.copyFileSync(path.join(source, filename), path.join(output, filename));
}
fs.cpSync(path.join(source, 'assets'), path.join(output, 'assets'), { recursive: true });

// Only explicit public files belong here, such as WeChat's domain proof .txt.
// Source, environment files, and upload keys are never copied to the web output.
const publicRoot = path.join(root, 'web', 'public');
if (fs.existsSync(publicRoot)) {
  for (const item of fs.readdirSync(publicRoot, { withFileTypes: true })) {
    if (!item.isFile() || !/^(?:MP_verify_)?[A-Za-z0-9_-]{6,64}\.txt$/.test(item.name)) continue;
    fs.copyFileSync(path.join(publicRoot, item.name), path.join(output, item.name));
  }
}

fs.writeFileSync(path.join(output, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页面未找到</title><body><p>页面未找到。<a href="/">返回婚纱灵感图册</a></p></body></html>');
// Replace previously published script URLs explicitly so CDN caches receive
// retired content even when deleted assets would otherwise remain cached.
for (const filename of ['bundle.js', 'runtime.js', 'sync.js', 'config.js']) {
  fs.writeFileSync(path.join(output, filename), '/* Retired. This release contains only the wedding lookbook. */\n');
}
fs.writeFileSync(path.join(output, '_headers'),
  '/*\n' +
  '  X-Content-Type-Options: nosniff\n' +
  '  Referrer-Policy: strict-origin-when-cross-origin\n' +
  '  Permissions-Policy: camera=(), microphone=(), geolocation=()\n' +
  '  Cache-Control: public, no-cache, no-transform\n' +
  '/assets/*\n' +
  '  Cache-Control: public, max-age=86400, no-transform\n');
console.log('Built ' + output + ' (wedding lookbook only)');
