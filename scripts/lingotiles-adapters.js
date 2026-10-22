'use strict';
const fs = require('node:fs');
const path = require('node:path');
const recipe = require('../web/projects/lingotiles/adapters/web.json');

function replaceOnce(source, before, after, label) {
  const matches = source.split(before).length - 1;
  if (!before || matches !== 1) {
    const error = new Error(`词了个词适配冲突：${label}（预期唯一上下文，实际 ${matches} 处）。请检查上游变化并更新适配，禁止跳过。`);
    error.code = 'LINGOTILES_ADAPTER_CONFLICT';
    throw error;
  }
  return source.replace(before, () => after);
}

function readTree(directory, prefix = '', result = new Map()) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const relative = prefix + item.name;
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) readTree(absolute, relative + '/', result);
    else if (item.isFile()) result.set(relative, fs.readFileSync(absolute));
    else throw new Error('Unsupported upstream entry: ' + relative);
  }
  return result;
}

function prepareWebSources(upstreamSrcDir) {
  const files = readTree(upstreamSrcDir);
  for (const patch of recipe.patches) {
    if (!files.has(patch.file)) throw new Error('Missing upstream adapter file: ' + patch.file);
    let source = files.get(patch.file).toString('utf8');
    patch.edits.forEach((edit, index) => { source = replaceOnce(source, edit.before, edit.after, `${patch.file} #${index + 1}`); });
    // Keep the established generated output's single terminal newline.
    if (patch.file === 'App.tsx' || patch.file === 'data/library.ts') source = source.replace(/\n+$/, '\n');
    files.set(patch.file, Buffer.from(source));
  }
  return files;
}

const nativeFiles = Object.freeze(['data/vocabulary.ts', 'data/library.ts', 'data/illustrationSchema.ts', 'data/illustrations.seed.json', 'game/engine.ts', 'game/progress.ts', 'game/preferences.ts', 'game/history.ts', 'game/wordIllustrations.ts']);
function patchNativeSource(filename, source, runtime) {
  const replace = (before, after, label) => { source = replaceOnce(source, before, after, filename + ': ' + label); };
  if (filename === 'data/library.ts') {
    replace("return `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\\//, '')}`;", 'return assetUrl(path);', 'resource URL');
    replace('if (!ids.length) return [];\n  const manifest = await loadManifest();', 'if (!ids.length) return [];', 'offline theme lookup');
    replace('  await Promise.all([...groups].map(', '  if (!groups.size) return ids.map(id => resolved.get(id)).filter((word): word is Word => !!word);\n  const manifest = await loadManifest();\n  await Promise.all([...groups].map(', 'deferred dictionary manifest');
    source = `import { nativeFetch as fetch, assetUrl } from ${JSON.stringify(runtime)};\n` + source;
  }
  if (filename === 'game/wordIllustrations.ts') {
    replace("fetch('./images/words/index/manifest.json', { signal: AbortSignal.timeout(5000) })", "nativeFetch(assetUrl('images/words/index/manifest.json'))", 'illustration manifest');
    replace('fetch(`./${part.path}?v=${manifest.revision}`, { signal: AbortSignal.timeout(5000) })', 'nativeFetch(assetUrl(`${part.path}?v=${manifest.revision}`))', 'illustration bucket');
    replace("  if (typeof window === 'undefined') return null;\n  try { return globalThis.localStorage ?? null; } catch { return null; }", '  return nativeStorage;', 'storage');
    source = `import { nativeFetch, assetUrl, nativeStorage } from ${JSON.stringify(runtime)};\n` + source;
  }
  if (filename === 'game/history.ts') {
    const markers = ['function browserIndexedDB', '/** Always quote cells', 'const defaultStore'];
    for (const marker of markers) replaceOnce(source, marker, marker, filename + ': ' + marker);
    const [database, csv, defaults] = markers.map(marker => source.indexOf(marker));
    if (!(database < csv && csv < defaults)) throw new Error('History adapter section order changed');
    source = source.slice(0, database) + source.slice(csv, defaults);
    replace("text.replaceAll('\"', '\"\"')", "text.replace(/\"/g, '\"\"')", 'CSV ES2018 compatibility');
  }
  return source;
}

function prepareNativeSources(upstreamSrcDir, runtime) {
  return new Map(nativeFiles.map(file => [file, Buffer.from(patchNativeSource(file, fs.readFileSync(path.join(upstreamSrcDir, file), 'utf8'), runtime))]));
}
function validateNativeSources(upstreamSrcDir) { prepareNativeSources(upstreamSrcDir, 'native-runtime'); return true; }

module.exports = { prepareWebSources, prepareNativeSources, validateNativeSources, readTree, replaceOnce };
