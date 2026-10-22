#!/usr/bin/env node
'use strict';

// An explicit native review baseline. Import/sync/build must never regenerate it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.join(PROJECT_ROOT, 'web/projects/lingotiles/upstream');
const DEFAULT_CONTRACT = path.join(PROJECT_ROOT, 'web/projects/lingotiles/NATIVE_CONTRACT.json');
const REVIEW_CODE = 'LINGOTILES_NATIVE_CONTRACT_REVIEW_REQUIRED';
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|vue|svelte|wxml|wxs|html|wasm)$/i;
const TEST_FILE = /(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;
const ASSET_SOURCE = new Set(['src/data/illustrations.seed.json']);

function reviewError(message, changes = { added: [], removed: [], modified: [] }) {
  const error = new Error(message);
  error.code = REVIEW_CODE;
  error.changes = changes;
  return error;
}

function relativePath(filename) {
  return typeof filename === 'string' && filename.length > 0 && !filename.includes('\\') &&
    !filename.startsWith('/') && filename.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Inventory executable UI/rules/data-schema sources, not public assets or tests. */
function collectBehaviorFiles(upstreamRoot) {
  const sourceRoot = path.resolve(upstreamRoot);
  const src = path.join(sourceRoot, 'src');
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw reviewError(`上游功能源目录不存在：${src}`);
  const files = {};
  const add = filename => {
    const bytes = fs.readFileSync(path.join(sourceRoot, filename));
    files[filename] = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  };
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const filename = path.relative(sourceRoot, absolute).split(path.sep).join('/');
      if (TEST_FILE.test(filename)) continue;
      if (entry.isSymbolicLink()) throw reviewError(`上游功能源包含符号链接，需先审查：${filename}`);
      if (entry.isDirectory()) walk(absolute);
      else if (SOURCE_EXTENSIONS.test(filename) && !ASSET_SOURCE.has(filename)) add(filename);
    }
  }
  if (fs.existsSync(path.join(sourceRoot, 'PRODUCT.md'))) add('PRODUCT.md');
  walk(src);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

function loadContract(contractPath) {
  let contract;
  try { contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')); }
  catch (_) { throw reviewError(`无法读取原生功能审查契约：${contractPath}。需保留并人工审查该文件，不能由同步程序自动生成。`); }
  if (contract.version !== 1 || !/^[a-f0-9]{40}$/.test(contract.reviewedCommit || '') ||
    !contract.files || Array.isArray(contract.files) || !Object.keys(contract.files).length ||
    !Array.isArray(contract.features) || !contract.features.length || !Array.isArray(contract.knownDifferences)) {
    throw reviewError(`原生功能审查契约格式不完整：${contractPath}`);
  }
  for (const [filename, value] of Object.entries(contract.files)) {
    if (!relativePath(filename) || (filename !== 'PRODUCT.md' && !filename.startsWith('src/')) ||
      !value || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
      throw reviewError(`原生契约包含无效功能文件条目：${filename}`);
    }
  }
  const ids = new Set();
  const assigned = new Set();
  for (const feature of contract.features) {
    if (!feature || typeof feature.id !== 'string' || !feature.id || ids.has(feature.id) ||
      !['shared', 'adapted', 'partial'].includes(feature.coverage) || !Array.isArray(feature.upstreamFiles) ||
      !feature.upstreamFiles.length || !Array.isArray(feature.nativeFiles) || !feature.nativeFiles.length ||
      !Array.isArray(feature.regressionTests) || !feature.regressionTests.length) {
      throw reviewError('原生契约必须为每项功能记录唯一编号、覆盖状态、原生实现和回归证据。');
    }
    ids.add(feature.id);
    for (const filename of feature.upstreamFiles) {
      if (!Object.hasOwn(contract.files, filename)) throw reviewError(`功能 ${feature.id} 引用了未审查的上游文件：${filename}`);
      assigned.add(filename);
    }
    if (feature.coverage === 'partial' && !contract.knownDifferences.some(value => value.feature === feature.id && value.details)) {
      throw reviewError(`功能 ${feature.id} 尚有差异，必须在 knownDifferences 明确记录，不能宣称完整对齐。`);
    }
  }
  for (const filename of Object.keys(contract.files)) {
    if (!assigned.has(filename)) throw reviewError(`上游功能文件尚未分配原生适配审查：${filename}`);
  }
  return contract;
}

/**
 * Throws REVIEW_CODE for added/removed/changed functional sources or PRODUCT.
 * A resource-only commit may differ: unchanged source hashes preserve the review,
 * while reviewedCommit always identifies the commit that was actually audited.
 * Success proves an unchanged reviewed baseline, never feature parity or device QA.
 */
function verifyNativeContract(upstreamRoot = DEFAULT_SOURCE, options = {}) {
  const contractPath = path.resolve(options.contractPath || DEFAULT_CONTRACT);
  const contract = loadContract(contractPath);
  const actual = collectBehaviorFiles(upstreamRoot);
  const expected = contract.files;
  const changes = {
    added: Object.keys(actual).filter(filename => !Object.hasOwn(expected, filename)),
    removed: Object.keys(expected).filter(filename => !Object.hasOwn(actual, filename)),
    modified: Object.keys(actual).filter(filename => Object.hasOwn(expected, filename) &&
      (actual[filename].sha256 !== expected[filename].sha256 || actual[filename].bytes !== expected[filename].bytes))
  };
  if (changes.added.length || changes.removed.length || changes.modified.length) {
    const describe = (label, files) => files.length ? `${label}：${files.join('、')}` : '';
    const detail = [describe('新增功能源', changes.added), describe('删除功能源', changes.removed), describe('变更功能源', changes.modified)].filter(Boolean).join('\n');
    const affectedFeatures = contract.features.filter(feature => feature.upstreamFiles.some(filename => changes.removed.includes(filename) || changes.modified.includes(filename))).map(feature => feature.id);
    const error = reviewError(`LingoTiles 上游功能已超出原生审查基线（${contract.reviewedCommit}）。\n${detail}\n请核对新增或变化的原生功能、接口、存储迁移与回归测试，再明确更新 NATIVE_CONTRACT.json；同步程序不得自动更新该审查契约。`, changes);
    error.affectedFeatures = affectedFeatures;
    error.reviewedCommit = contract.reviewedCommit;
    throw error;
  }
  let sourceCommit = options.commit || null;
  if (!sourceCommit) {
    try { sourceCommit = JSON.parse(fs.readFileSync(path.join(upstreamRoot, '../SNAPSHOT.json'), 'utf8')).commit || null; }
    catch (_) { /* A staged checkout can be checked before it has a local snapshot. */ }
  }
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw reviewError('功能契约检查需要完整的 40 位上游提交编号。');
  return { ok: true, reviewedCommit: contract.reviewedCommit, sourceCommit,
    checkedFiles: Object.keys(actual).length, features: contract.features.map(feature => ({ id: feature.id, coverage: feature.coverage })),
    knownDifferences: contract.knownDifferences,
    parityClaim: 'reviewed-baseline-only', contractPath };
}

function main(argv) {
  const options = {};
  let source = DEFAULT_SOURCE;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--json') json = true;
    else if (['--source', '--contract', '--commit'].includes(flag) && argv[index + 1]) {
      const value = argv[++index];
      if (flag === '--source') source = path.resolve(value);
      else if (flag === '--contract') options.contractPath = path.resolve(value);
      else options.commit = value;
    } else if (flag === '--help') {
      console.log('node scripts/check-lingotiles-contract.js [--source UPSTREAM_ROOT] [--contract CONTRACT_JSON] [--commit FULL_SHA] [--json]\n只读检查原生功能审查基线，不自动更新契约，不代表完整对齐或真机验收。');
      return 0;
    } else throw new Error(`未知或缺少参数：${flag}`);
  }
  const result = verifyNativeContract(source, options);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`LingoTiles 原生审查基线一致：${result.checkedFiles} 个功能文件，审查提交 ${result.reviewedCommit}。${result.knownDifferences.length} 项平台差异已明确记录；此检查不代表完整功能对齐或真机验收。`);
  return 0;
}

module.exports = { verifyNativeContract, collectBehaviorFiles, REVIEW_CODE, DEFAULT_CONTRACT, DEFAULT_SOURCE };
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
