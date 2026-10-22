'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowserAccount } = require('../scripts/browser-account-assets');

test('module account bootstrap runs before application scripts without changing asset URLs', () => {
  const source = '<!doctype html><html><head><script type="module" src="./main.123.js"></script></head><body></body></html>';
  const result = withBrowserAccount(source);
  assert.ok(result.indexOf('src="/account-runtime.js"') < result.indexOf('src="./main.123.js"'));
  assert.match(result, /<script src="\/account-runtime\.js"><\/script>/);
  assert.match(result, /<link rel="stylesheet" href="\/account-widget\.css">/);
  assert.match(result, /<script src="\/account\.js" defer><\/script>/);
  assert.equal((result.match(/account-runtime\.js/g) || []).length, 1);
  assert.throws(() => withBrowserAccount(result), /Duplicate/);
  assert.throws(() => withBrowserAccount('<html><body></body></html>'), /no head/);
});

test('every published project HTML includes the shared account runtime before app startup', () => {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'projects.config.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'web/portal/projects.json'), 'utf8'));
  const active = new Set(catalog.projects.filter(project => project.status === 'active').map(project => project.id));
  for (const project of config.projects.filter(project => active.has(project.id))) {
    // Use the exact build inputs, including nested legacy canvas pages.
    const inputs = [{ source: path.join(root, project.source, project.html || 'index.html'), name: project.id }];
    if (project.canvasExtension) for (const file of project.canvasExtension.files.filter(file => file.endsWith('.html'))) {
      inputs.push({ source: path.join(root, project.source, project.canvasExtension.source, file), name: project.id + '/' + file });
    }
    for (const input of inputs) {
      const result = withBrowserAccount(fs.readFileSync(input.source, 'utf8'));
      assert.ok(result.indexOf('/account-runtime.js') < result.lastIndexOf('<script'), input.name);
    }
  }
});
