'use strict';

// Small, deterministic CommonJS bundler for the shared local interaction core.
// Only modules inside sourceRoot are eligible; no Node modules or remote code.
const fs = require('node:fs');
const path = require('node:path');

function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function bundleGame(options) {
  const opts = options || {};
  const sourceRoot = fs.realpathSync(path.resolve(opts.sourceRoot || path.join(__dirname, '..', 'minigame')));
  const entry = fs.realpathSync(path.resolve(opts.entry || path.join(sourceRoot, 'game.js')));
  if (!isInside(sourceRoot, entry)) throw new Error('Bundle entry must be inside sourceRoot');
  const modules = new Map();

  function resolveModule(from, request) {
    if (!request.startsWith('.')) throw new Error('Only local modules can be bundled: ' + request);
    const candidate = path.resolve(path.dirname(from), request);
    for (const filename of [candidate, candidate + '.js', candidate + '.json', path.join(candidate, 'index.js')]) {
      if (!isInside(sourceRoot, filename) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) continue;
      const real = fs.realpathSync(filename);
      if (!isInside(sourceRoot, real)) throw new Error('Module resolves outside sourceRoot: ' + request);
      if (!['.js', '.json'].includes(path.extname(real))) throw new Error('Unsupported module format: ' + request);
      return real;
    }
    throw new Error('Cannot resolve ' + request + ' from ' + path.relative(sourceRoot, from));
  }

  function visit(filename) {
    const id = path.relative(sourceRoot, filename).split(path.sep).join('/');
    if (modules.has(id)) return id;
    const source = fs.readFileSync(filename, 'utf8');
    const dependencies = Object.create(null);
    const json = filename.endsWith('.json');
    modules.set(id, { source, dependencies, json });
    if (!json) {
      for (const match of source.matchAll(/\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)) {
        dependencies[match[2]] = visit(resolveModule(filename, match[2]));
      }
    }
    return id;
  }

  const entryId = visit(entry);
  const definitions = Array.from(modules, function (pair) {
    const [id, module] = pair;
    const body = module.json ? 'module.exports = ' + JSON.stringify(JSON.parse(module.source)) + ';' : module.source;
    return JSON.stringify(id) + ': [function(require, module, exports) {\n' + body + '\n}, ' + JSON.stringify(module.dependencies) + ']';
  });
  const code = '(function () {\n"use strict";\n' +
    'const modules = {\n' + definitions.join(',\n') + '\n};\n' +
    'const cache = Object.create(null);\n' +
    'function load(id) {\n' +
    '  if (cache[id]) return cache[id].exports;\n' +
    '  if (!Object.prototype.hasOwnProperty.call(modules, id)) throw new Error("Unknown module: " + id);\n' +
    '  const module = cache[id] = { exports: {} };\n' +
    '  const definition = modules[id];\n' +
    '  definition[0](function (request) {\n' +
    '    const target = definition[1][request];\n' +
    '    if (!target) throw new Error("Unsupported require: " + request + " in " + id);\n' +
    '    return load(target);\n' +
    '  }, module, module.exports);\n' +
    '  return module.exports;\n' +
    '}\n' +
    'function start() {\n' +
    '  try { load(' + JSON.stringify(entryId) + '); window.BrclioRuntime.ready(); }\n' +
    '  catch (error) { window.BrclioRuntime.fail(error); }\n' +
    '}\n' +
    '// Optional storage bootstrap may finish before the shared core reads its preferences.\n' +
    '// Bootstrap failures preserve the local experience.\n' +
    'Promise.resolve(window.__brclioBootstrap).catch(function () {}).then(start);\n' +
    '})();\n';
  return { code, entryId, moduleCount: modules.size, moduleIds: Array.from(modules.keys()) };
}

module.exports = { bundleGame };

if (require.main === module) process.stdout.write(bundleGame().code);
