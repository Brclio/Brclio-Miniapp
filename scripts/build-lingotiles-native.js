#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'web/projects/lingotiles/upstream/src');
const runtime = path.join(__dirname, 'lingotiles-native-runtime.js');

/** Bundle the pinned upstream rules; browser-only I/O is scoped to this module. */
function buildLingotilesNative() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brclio-lingotiles-native-'));
  try {
    for (const filename of ['data/vocabulary.ts', 'data/library.ts', 'data/illustrationSchema.ts', 'data/illustrations.seed.json', 'game/engine.ts', 'game/progress.ts', 'game/preferences.ts', 'game/history.ts', 'game/wordIllustrations.ts']) {
      let source = fs.readFileSync(path.join(upstream, filename), 'utf8');
      if (filename === 'data/library.ts') {
        source = `import { nativeFetch as fetch, assetUrl } from ${JSON.stringify(runtime)};\n` + source;
        source = source.replace("return `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\\//, '')}`;", 'return assetUrl(path);');
        // Saved/seen theme vocabulary must remain usable without any network.
        source = source.replace('if (!ids.length) return [];\n  const manifest = await loadManifest();', 'if (!ids.length) return [];');
        source = source.replace('  await Promise.all([...groups].map(', '  if (!groups.size) return ids.map(id => resolved.get(id)).filter((word): word is Word => !!word);\n  const manifest = await loadManifest();\n  await Promise.all([...groups].map(');
      }
      if (filename === 'game/wordIllustrations.ts') {
        source = `import { nativeFetch, assetUrl, nativeStorage } from ${JSON.stringify(runtime)};\n` + source;
        source = source.replace("fetch('./images/words/index/manifest.json', { signal: AbortSignal.timeout(5000) })", "nativeFetch(assetUrl('images/words/index/manifest.json'))");
        source = source.replace('fetch(`./${part.path}?v=${manifest.revision}`, { signal: AbortSignal.timeout(5000) })', 'nativeFetch(assetUrl(`${part.path}?v=${manifest.revision}`))');
        source = source.replace("  if (typeof window === 'undefined') return null;\n  try { return globalThis.localStorage ?? null; } catch { return null; }", '  return nativeStorage;');
      }
      if (filename === 'game/history.ts') {
        // Retain the canonical validation/CSV rules without opening a browser DB.
        source = source.slice(0, source.indexOf('function browserIndexedDB'))
          + source.slice(source.indexOf('/** Always quote cells'), source.indexOf('const defaultStore'));
        source = source.replace("text.replaceAll('\"', '\"\"')", "text.replace(/\"/g, '\"\"')");
      }
      const destination = path.join(temporary, filename);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, source);
    }
    const entry = `
      import * as engine from './game/engine.ts';
      import * as vocabulary from './data/vocabulary.ts';
      import * as library from './data/library.ts';
      import * as progress from './game/progress.ts';
      import * as preferences from './game/preferences.ts';
      import { validateCompletion, completionsToCsv, csvCell } from './game/history.ts';
      import * as illustrations from './game/wordIllustrations.ts';
      import { nativeStorage, assetUrl, createHistoryClass, writeExportFile } from ${JSON.stringify(runtime)};
      const CompletionHistoryStore = createHistoryClass(validateCompletion, completionsToCsv);
      let history;
      const store = () => history || (history = new CompletionHistoryStore());
      module.exports = {
        ...engine, ...vocabulary, ...library,
        // Empty saved/seen filters have no matches and need no 100k-word download.
        searchVocabulary: (query, options = {}) => options.allowedIds && !options.allowedIds.length
          ? Promise.resolve({words:[],total:0}) : library.searchVocabulary(query,options),
        ...progress, ...preferences,
        INITIAL_TOOLS: Object.freeze({undo:3,hint:2,shuffle:2}),
        loadProgress: (storage = nativeStorage) => progress.loadProgress(storage),
        saveProgress: (value, storage = nativeStorage) => progress.saveProgress(value, storage),
        loadMatchAnimation: (storage = nativeStorage) => preferences.loadMatchAnimation(storage),
        saveMatchAnimation: (enabled, storage = nativeStorage) => preferences.saveMatchAnimation(enabled, storage),
        CompletionHistoryStore, validateCompletion, completionsToCsv, csvCell,
        appendCompletion: record => store().append(record),
        getCompletionPage: options => store().page(options),
        getCompletionSummary: () => store().summary(),
        exportCompletionsCsv: () => store().exportCsv(),
        exportCsvFile: async () => { const {csv,...status} = await store().exportCsv(); return {...status,filePath:writeExportFile(csv,'csv','lingotiles-通关足迹')}; },
        getWordIllustration: word => { const value=illustrations.getWordIllustration(word); return value ? {src:assetUrl(value.src),alt:value.alt} : null; },
        loadIllustrationManifest: illustrations.loadIllustrationManifest,
        loadWordIllustrations: illustrations.loadWordIllustrations,
        recordIllustrationPractice: illustrations.recordIllustrationPractice,
        getMissingIllustrations: illustrations.getMissingIllustrations,
        exportMissingIllustrationsFile: () => writeExportFile(JSON.stringify({version:1,generatedAt:new Date().toISOString(),words:illustrations.getMissingIllustrations()},null,2),'json','lingotiles-待配图'),
        assetUrl
      };
    `;
    const result = esbuild.buildSync({
      stdin: { contents: entry, resolveDir: temporary, sourcefile: 'lingotiles-native-entry.js' },
      bundle: true, write: false, format: 'cjs', platform: 'neutral', target: ['es2018'],
      external: ['../config'], treeShaking: true, legalComments: 'eof',
      banner: { js: '// Generated by scripts/build-lingotiles-native.js from Lingotiles a6a3841b846d72932301d43ddb9c30e756a22c7b. Do not edit directly.' }
    });
    const output = path.join(root, 'miniprogram/lib/lingotiles.js');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    // Temporary staging paths must not leak into a checked-in, reproducible bundle.
    const text = result.outputFiles[0].text.split(temporary + '/').join('lingotiles-source/').split(temporary).join('lingotiles-source').split(root + '/').join('');
    fs.writeFileSync(output, text);
    return text;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

module.exports = { buildLingotilesNative };
if (require.main === module) { buildLingotilesNative(); console.log('Built native Lingotiles rules and on-demand vocabulary adapters.'); }
