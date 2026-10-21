#!/usr/bin/env node
'use strict';
// Verify deployed resource bytes against the frozen deployment input, in small batches.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'artifacts/lingotiles');
const source = JSON.parse(fs.readFileSync(path.join(directory, 'deployment-input.json'), 'utf8'));
const origin = (process.argv[2] || 'https://pocket.bornforthis.cn').replace(/\/$/, '');
let selected = source.files.filter(file => file.path.startsWith('projects/lingotiles/') || ['index.html', 'main.js', 'style.css', 'projects.json', 'catalog.js'].includes(file.path));
const report = { origin, checkedAt: new Date().toISOString(), total: selected.length, checked: [], failed: [] };
if (process.argv.includes('--retry-failed')) {
  const previous = JSON.parse(fs.readFileSync(path.join(directory, 'production-assets-verification.json'), 'utf8'));
  if (previous.origin !== origin) throw new Error('Cannot reuse checks from another origin');
  const verified = new Map(previous.checked.map(file => [file.path, file]));
  report.resumedFrom = previous.checkedAt;
  selected = selected.filter(file => {
    const before = verified.get(file.path);
    if (!before || before.sha256 !== file.sha256 || before.bytes !== file.bytes) return true;
    report.checked.push(before); return false;
  });
}
async function check(file) {
  const relative = file.path === 'index.html' ? '' : file.path.replace(/\/index\.html$/, '/');
  try {
    const { stdout } = await run('curl', ['--fail', '--silent', '--show-error', '--connect-timeout', '10', '--max-time', '45', '--retry', '2', origin + '/' + relative], { encoding: 'buffer', maxBuffer: Math.max(4 * 1024 * 1024, file.bytes + 1024) });
    const hash = crypto.createHash('sha256').update(stdout).digest('hex');
    if (hash !== file.sha256 || stdout.length !== file.bytes) throw new Error('Deployed bytes differ from the frozen build');
    report.checked.push({ path: file.path, bytes: stdout.length, sha256: hash });
  } catch (error) { report.failed.push({ path: file.path, error: error.message }); }
}
(async () => {
  let index = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (index < selected.length) { const next = selected[index++]; await check(next); } }));
  report.checked.sort((a,b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(directory, 'production-assets-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ origin, total: report.total, passed: report.checked.length, failed: report.failed }));
  if (report.failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
