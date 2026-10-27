#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { bundleGame } = require('./bundle-game');
const { fingerprintAssets } = require('./fingerprint-assets');
const { withBrowserAccount } = require('./browser-account-assets');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/web');
const portal = path.join(root, 'web/portal');
const config = JSON.parse(fs.readFileSync(path.join(root, 'projects.config.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(portal, 'projects.json'), 'utf8'));
require('../web/portal/catalog').validateCatalog(registry);
const version = require('../package.json').version;
if (registry.version !== version) throw new Error('Portal version differs from package version');
const retired = '/* Retired. Use the content portal and registered projects. */\n';

function sourcePath(relative) {
  if (typeof relative !== 'string' || relative.includes('\\')) throw new Error('Invalid source path');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.join(root, 'web') + path.sep)) throw new Error('Project source must be inside web/');
  return absolute;
}
function outputPath(base, relative) {
  const absolute = path.resolve(base, relative);
  if (!absolute.startsWith(base + path.sep)) throw new Error('Invalid output path');
  return absolute;
}
if (config.schemaVersion !== 1 || !Array.isArray(config.projects)) throw new Error('Invalid project build registry');
const ids = new Set();
for (const project of config.projects) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(project.id) || ids.has(project.id)) throw new Error('Invalid or duplicate project ID');
  if (!['react', 'static', 'canvas'].includes(project.kind)) throw new Error('Unsupported project kind');
  if (project.fingerprintAssets !== undefined && typeof project.fingerprintAssets !== 'boolean') throw new Error('Invalid asset fingerprint option');
  if (project.fingerprintAssets && (project.kind !== 'react' || !project.tailwind)) throw new Error('Asset fingerprints require React and compiled Tailwind assets');
  ids.add(project.id);
}
for (const item of registry.projects) {
  if (item.status === 'active' && (!ids.has(item.id) || item.path !== '/projects/' + item.id + '/')) throw new Error('Published project has no matching build: ' + item.id);
}

const published = config.projects.filter(function (project) { return registry.projects.some(function (item) { return item.id === project.id && item.status === 'active'; }); });
const firstsightAssetPaths = published.some(function (project) { return project.id === 'firstsight'; }) ?
  JSON.parse(fs.readFileSync(path.join(root, 'web/projects/firstsight/original-data.json'), 'utf8')).assets.filter(function (asset) { return asset.available === true; }).map(function (asset) { return asset.url; }).sort() : [];
if (new Set(firstsightAssetPaths).size !== firstsightAssetPaths.length || firstsightAssetPaths.some(function (url) { return typeof url !== 'string' || !/^\/projects\/firstsight\/assets\/original\/[a-f0-9]{20}\.(?:jpe?g|png|webp|gif|avif)$/.test(url); })) throw new Error('Invalid FirstSight asset paths');
if (published.some(function (project) { return project.id === 'firstsight'; }) && firstsightAssetPaths.length === 0) throw new Error('Published FirstSight has no imported photos');
if (published.some(project => project.id === 'lingotiles')) require('./build-lingotiles-web').checkLingotilesWeb();
// Only generated output is cleared; credentials and source remain outside it.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'catalog.js', 'main.js', 'projects.json', 'account.js', 'account-widget.css']) fs.copyFileSync(path.join(portal, file), path.join(output, file));
esbuild.buildSync({ entryPoints: [path.join(root, 'web/account-browser.js')], outfile: path.join(output, 'account-runtime.js'), bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], legalComments: 'eof' });
fs.cpSync(path.join(root, 'web/blog'), path.join(output, 'blog'), { recursive: true });
fs.copyFileSync(path.join(root, 'miniprogram/lib/blog-content.js'), path.join(output, 'blog/content.js'));
fs.copyFileSync(path.join(root, 'miniprogram/lib/blog-cache.js'), path.join(output, 'blog/cache.js'));
fs.mkdirSync(path.join(output, 'schemas'), { recursive: true });
fs.copyFileSync(path.join(root, 'docs/blog-storage.schema.json'), path.join(output, 'schemas/blog-storage-v1.json'));
for (const project of published) {
  const folder = path.join(output, 'projects', project.id);
  const source = sourcePath(project.source);
  fs.mkdirSync(folder, { recursive: true });
  if (project.kind === 'react') {
    const runtime = project.runtimePackage ? createRequire(require.resolve(project.runtimePackage + '/package.json', { paths: [root] })) : null;
    const alias = runtime ? Object.fromEntries(['react', 'react-dom', 'lucide-react'].map(function (name) { return [name, path.dirname(runtime.resolve(name + '/package.json'))]; })) : undefined;
    esbuild.buildSync({ entryPoints: [outputPath(source, project.entry)], outdir: folder, entryNames: 'main', bundle: true, minify: true, format: 'esm', jsx: 'automatic', target: ['es2020'], define: { 'process.env.NODE_ENV': '"production"' }, alias: alias, legalComments: 'eof' });
    if (project.tailwind) {
      // Compile the original Tailwind 3 utilities locally; no browser CDN runtime.
      execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli.js'), '--input', outputPath(source, project.tailwind), '--output', path.join(folder, 'main.css'), '--content', path.join(source, '**/*.{html,js,ts,jsx,tsx}'), '--minify'], { cwd: root, stdio: 'inherit' });
    }
    if (project.fingerprintAssets) {
      const html = fs.readFileSync(outputPath(source, project.html), 'utf8');
      fs.writeFileSync(path.join(folder, 'index.html'), withBrowserAccount(fingerprintAssets(folder, html)));
    } else {
      fs.writeFileSync(path.join(folder, 'index.html'), withBrowserAccount(fs.readFileSync(outputPath(source, project.html), 'utf8')));
    }
    if (project.canvasExtension) {
      const extension = project.canvasExtension;
      const extensionSource = outputPath(source, extension.source);
      const extensionOutput = outputPath(folder, extension.target);
      fs.mkdirSync(extensionOutput, { recursive: true });
      for (const file of extension.files) {
        const bytes = fs.readFileSync(outputPath(extensionSource, file));
        fs.writeFileSync(outputPath(extensionOutput, file), file.endsWith('.html') ? withBrowserAccount(bytes.toString('utf8')) : bytes);
      }
      fs.copyFileSync(path.join(root, 'web/runtime.js'), path.join(extensionOutput, 'runtime.js'));
      fs.copyFileSync(path.join(root, 'web/style.css'), path.join(extensionOutput, 'style.css'));
      fs.writeFileSync(path.join(extensionOutput, 'bundle.js'), bundleGame().code);
      for (const asset of extension.assets || []) fs.cpSync(sourcePath(asset.source), outputPath(extensionOutput, asset.target), { recursive: true });
    }
  } else {
    for (const file of project.files) {
      const bytes = fs.readFileSync(outputPath(source, file));
      fs.writeFileSync(outputPath(folder, file), file.endsWith('.html') ? withBrowserAccount(bytes.toString('utf8')) : bytes);
    }
    if (project.kind === 'canvas') {
      fs.copyFileSync(path.join(root, 'web/runtime.js'), path.join(folder, 'runtime.js'));
      fs.copyFileSync(path.join(root, 'web/style.css'), path.join(folder, 'style.css'));
      fs.writeFileSync(path.join(folder, 'bundle.js'), bundleGame().code);
    }
  }
  for (const asset of project.assets || []) fs.cpSync(sourcePath(asset.source), outputPath(folder, asset.target), { recursive: true });
}
// Match the small, bundled song art used by the native player and its system audio controls.
const nurseryCovers = path.join(root, 'miniprogram/nursery/assets/covers');
if (fs.existsSync(nurseryCovers)) fs.cpSync(nurseryCovers, path.join(output, 'assets/nursery-covers'), { recursive: true });
// Shared account avatars stay out of the WeChat package and load on demand.
fs.cpSync(path.join(root, 'web/avatars'), path.join(output, 'avatars'), { recursive: true });
const publicRoot = path.join(root, 'web/public');
for (const item of fs.readdirSync(publicRoot, { withFileTypes: true })) {
  if (item.isFile() && /^(?:MP_verify_)?[A-Za-z0-9_-]{6,64}\.txt$/.test(item.name)) fs.copyFileSync(path.join(publicRoot, item.name), path.join(output, item.name));
}
fs.writeFileSync(path.join(output, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页面未找到 · Brclio 悦创</title><body style="background:#fefcf6;color:#303128;padding:48px;font-family:system-ui"><p>页面未找到。</p><a href="/" style="color:inherit">返回内容空间</a></body></html>');
for (const file of ['bundle.js', 'runtime.js', 'sync.js', 'config.js']) fs.writeFileSync(path.join(output, file), retired);
esbuild.buildSync({ entryPoints: [path.join(root, 'web/pages-worker.mjs')], outfile: path.join(output, '_worker.js'), bundle: true, format: 'esm', target: ['es2020'], external: ['cloudflare:sockets'], define: { __BRCLIO_ACTIVE_PROJECTS__: JSON.stringify(published.map(function (item) { return item.id; })), __BRCLIO_FIRSTSIGHT_ASSETS__: JSON.stringify(firstsightAssetPaths), __BRCLIO_VERSION__: JSON.stringify(version) } });
fs.writeFileSync(path.join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/projects/*'], exclude: [] }));
fs.writeFileSync(path.join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: public, no-cache, no-transform\n/projects.json\n  Cache-Control: no-store, no-transform\n');
console.log('Built one content portal and ' + published.length + ' published projects in ' + output);
