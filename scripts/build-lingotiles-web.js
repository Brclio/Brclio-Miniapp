#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { prepareWebSources, readTree } = require('./lingotiles-adapters');
const project = path.resolve(__dirname, '../web/projects/lingotiles');

function checkLingotilesWeb(projectRoot = project) {
  const expected = prepareWebSources(path.join(projectRoot, 'upstream/src'));
  const actual = readTree(path.join(projectRoot, 'src'));
  const drift = [...new Set([...expected.keys(), ...actual.keys()])].filter(file => !expected.get(file)?.equals(actual.get(file)));
  if (drift.length) throw new Error('词了个词网页生成源码存在手改或未同步：' + drift.join(', ') + '。请修改 upstream 适配规则并通过同步工具重新生成，不要直接修改 src。');
  return { files: expected.size };
}

function writeGeneratedWebSources(projectRoot = project) {
  const sources = prepareWebSources(path.join(projectRoot, 'upstream/src'));
  const staging = fs.mkdtempSync(path.join(projectRoot, '.adapt-web-'));
  const destination = path.join(projectRoot, 'src');
  const backup = staging + '.backup';
  let moved = false;
  try {
    for (const [relative, bytes] of sources) {
      const file = path.join(staging, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    }
    fs.renameSync(destination, backup); moved = true;
    fs.renameSync(staging, destination);
    fs.rmSync(backup, { recursive: true, force: true });
    return { files: sources.size };
  } catch (error) {
    if (moved && !fs.existsSync(destination)) fs.renameSync(backup, destination);
    throw error;
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
module.exports = { checkLingotilesWeb, writeGeneratedWebSources };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--write')) throw new Error('Usage: node scripts/build-lingotiles-web.js [--write]');
  console.log(args.includes('--write') ? writeGeneratedWebSources() : checkLingotilesWeb());
}
