#!/usr/bin/env node
'use strict';

// Dependency-free browser preview of the actual WeChat Mini Game entry point.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gameRoot = path.join(root, 'minigame');
const previewRoot = path.join(root, 'preview');
const host = process.env.PREVIEW_HOST || '127.0.0.1';
const port = Number(process.env.PREVIEW_PORT || process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };

function isInside(base, filename) {
  const relative = path.relative(base, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveModule(from, request) {
  if (!request.startsWith('.')) throw new Error('Browser preview only supports local modules: ' + request);
  const candidate = path.resolve(path.dirname(from), request);
  const resolved = [candidate, candidate + '.js', candidate + '.json', path.join(candidate, 'index.js')].find(function (filename) {
    return isInside(gameRoot, filename) && fs.existsSync(filename) && fs.statSync(filename).isFile();
  });
  if (!resolved) throw new Error('Cannot resolve ' + request + ' from ' + path.relative(gameRoot, from));
  return resolved;
}

function bundle() {
  const entry = path.join(gameRoot, 'game.js');
  const modules = new Map();
  function visit(filename) {
    const id = path.relative(gameRoot, filename).split(path.sep).join('/');
    if (modules.has(id)) return id;
    const source = fs.readFileSync(filename, 'utf8');
    const dependencies = {};
    modules.set(id, { source: source, dependencies: dependencies, json: filename.endsWith('.json') });
    if (!filename.endsWith('.json')) {
      for (const match of source.matchAll(/\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) {
        dependencies[match[2]] = visit(resolveModule(filename, match[2]));
      }
    }
    return id;
  }
  const entryId = visit(entry);
  const definitions = Array.from(modules, function (pair) {
    const id = pair[0];
    const module = pair[1];
    const body = module.json ? 'module.exports = ' + JSON.stringify(JSON.parse(module.source)) + ';' : module.source;
    return JSON.stringify(id) + ': [function(require, module, exports) {\n' + body + '\n}, ' + JSON.stringify(module.dependencies) + ']';
  });
  return '(function(){\n"use strict";\nconst modules = {\n' + definitions.join(',\n') + '\n};\nconst cache = {};\nfunction load(id) {\n  if (cache[id]) return cache[id].exports;\n  if (!modules[id]) throw new Error("Unknown game module: " + id);\n  const module = cache[id] = { exports: {} };\n  const definition = modules[id];\n  definition[0](function(request) {\n    const target = definition[1][request];\n    if (!target) throw new Error("Unsupported require: " + request + " in " + id);\n    return load(target);\n  }, module, module.exports);\n  return module.exports;\n}\ntry { load(' + JSON.stringify(entryId) + '); window.__preview.ready(' + modules.size + '); } catch(error) { window.__preview.fail(error); throw error; }\n})();\n';
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (_) { return send(res, 400, 'Invalid URL'); }
  if (pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, runtime: 'browser-preview', entryExists: fs.existsSync(path.join(gameRoot, 'game.js')) }), mime['.json']);
  if (pathname === '/bundle.js') {
    try { return send(res, 200, req.method === 'HEAD' ? '' : bundle(), mime['.js']); }
    catch (error) {
      return send(res, 200, 'window.__preview.fail(new Error(' + JSON.stringify(error.message) + '));', mime['.js']);
    }
  }
  let base;
  let relative;
  if (pathname === '/' || pathname === '/index.html') { base = previewRoot; relative = 'index.html'; }
  else if (pathname.startsWith('/preview/')) { base = previewRoot; relative = pathname.slice('/preview/'.length); }
  else if (pathname.startsWith('/minigame/')) { base = gameRoot; relative = pathname.slice('/minigame/'.length); }
  else { base = gameRoot; relative = pathname.replace(/^\/+/, ''); }
  const filename = path.resolve(base, relative);
  if (!isInside(base, filename)) return send(res, 403, 'Forbidden');
  fs.readFile(filename, function (error, data) {
    if (error) return send(res, error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, 'File unavailable');
    send(res, 200, req.method === 'HEAD' ? '' : data, mime[path.extname(filename).toLowerCase()] || 'application/octet-stream');
  });
});

server.on('error', function (error) {
  console.error('Preview server: ' + error.message);
  process.exitCode = 1;
});
server.listen(port, host, function () {
  console.log('Brclio game source preview: http://' + host + ':' + port);
  console.log('Browser Canvas bridge; verify the release separately in WeChat Developer Tools and on a device.');
});
