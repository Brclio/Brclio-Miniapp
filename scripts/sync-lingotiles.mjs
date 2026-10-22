#!/usr/bin/env node
// Explicit, auditable upstream refresh. Normal builds do not run this command.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const repository = 'https://github.com/Brclio/brclio-lingotiles';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTarget = path.join(projectRoot, 'web/projects/lingotiles');
const scopes = ['src', 'public', 'PRODUCT.md', 'DESIGN.md'];
const gitOptions = ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never'];
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };

function git(directory, args) {
  const result = spawnSync('git', [...gitOptions, '-C', directory, ...args], { env: gitEnv, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: args[0] === 'fetch' ? 180000 : 30000 });
  if (result.error || result.status !== 0) throw new Error(`Git ${args[0]} failed: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
  return result.stdout;
}
export function blobHash(bytes) { return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function safePath(value) {
  if (typeof value !== 'string' || !value || path.posix.normalize(value) !== value || value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value) || value.split('/').some(part => part === '..' || part === '.')) throw new Error(`Unsafe source path: ${JSON.stringify(value)}`);
  return value;
}
function localPath(source) { return source.startsWith('public/') ? source : 'upstream/' + source; }
function walk(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const relative = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error(`Symlinks are not allowed in imported directories: ${relative}`);
    return item.isDirectory() ? walk(path.join(directory, item.name), relative + '/') : [relative];
  }).sort();
}
function treeEntries(directory, commit, selected = scopes, recursive = true) {
  const rows = git(directory, ['ls-tree', recursive ? '-rz' : '-z', '--full-tree', commit, '--', ...selected]).split('\0').filter(Boolean);
  const entries = rows.map(row => {
    const tab = row.indexOf('\t');
    const [mode, type, hash] = row.slice(0, tab).split(' ');
    const filename = safePath(row.slice(tab + 1));
    if (type === 'tree' && !recursive) return null;
    if (type !== 'blob' || !['100644', '100755'].includes(mode) || !/^[a-f0-9]{40}$/.test(hash)) throw new Error(`Unsupported Git object or symlink: ${filename}`);
    return { path: filename, gitBlobSha: hash };
  }).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}
function sourceEntries(directory, commit) {
  const entries = treeEntries(directory, commit);
  for (const scope of scopes) if (!entries.some(item => scope.endsWith('.md') ? item.path === scope : item.path.startsWith(scope + '/'))) throw new Error(`Required upstream scope is missing: ${scope}`);
  return entries;
}

/** Stream Git's batch protocol; never check out or execute an upstream file. */
async function materialize(directory, entries, destination) {
  const groups = new Map();
  for (const entry of entries) groups.set(entry.gitBlobSha, [...(groups.get(entry.gitBlobSha) || []), entry]);
  const hashes = [...groups.keys()];
  const child = spawn('git', [...gitOptions, '-C', directory, 'cat-file', '--batch'], { env: gitEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-8192); });
  child.stdin.on('error', () => {});
  child.stdin.end(hashes.join('\n') + '\n');
  let index = 0, pending = Buffer.alloc(0), current = null;
  const complete = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Git cat-file failed: ${errors.trim()}`))); });
  // Attach a rejection handler before awaiting the stdout iterator.
  complete.catch(() => {});
  try {
    for await (const chunk of child.stdout) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        if (!current) {
          const newline = pending.indexOf(10);
          if (newline < 0) break;
          const header = pending.subarray(0, newline).toString('utf8').match(/^([a-f0-9]{40}) blob (\d+)$/);
          if (!header || header[1] !== hashes[index]) throw new Error('Unexpected Git batch object header');
          const size = Number(header[2]);
          if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git blob length');
          const targets = groups.get(header[1]);
          const filename = path.join(destination, localPath(targets[0].path));
          fs.mkdirSync(path.dirname(filename), { recursive: true });
          current = { size, remaining: size, fd: fs.openSync(filename, 'w'), filename, targets,
            hash: crypto.createHash('sha1').update(`blob ${size}\0`) };
          pending = pending.subarray(newline + 1);
        }
        if (current.remaining) {
          const count = Math.min(current.remaining, pending.length);
          const data = pending.subarray(0, count);
          let written = 0;
          while (written < count) written += fs.writeSync(current.fd, data, written, count - written);
          current.hash.update(data);
          current.remaining -= count;
          pending = pending.subarray(count);
        }
        if (current.remaining || !pending.length) break;
        if (pending[0] !== 10) throw new Error('Invalid Git batch body delimiter');
        pending = pending.subarray(1);
        fs.closeSync(current.fd); current.fd = null;
        if (current.hash.digest('hex') !== hashes[index]) throw new Error('Git blob hash verification failed');
        for (const [offset, entry] of current.targets.entries()) {
          entry.bytes = current.size;
          if (offset) {
            const filename = path.join(destination, localPath(entry.path));
            fs.mkdirSync(path.dirname(filename), { recursive: true });
            fs.copyFileSync(current.filename, filename);
          }
        }
        current = null; index++;
      }
    }
    await complete;
    if (current || index !== hashes.length || pending.length) throw new Error('Incomplete Git object stream');
  } catch (error) {
    if (current?.fd !== null && current?.fd !== undefined) fs.closeSync(current.fd);
    child.kill();
    throw error;
  }
}

function readSnapshot(target) {
  const filename = path.join(target, 'SNAPSHOT.json');
  if (!fs.existsSync(filename)) return null;
  const snapshot = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (snapshot.repository !== repository || !/^[a-f0-9]{40}$/.test(snapshot.commit) || !Array.isArray(snapshot.files)) throw new Error('Existing SNAPSHOT.json has an invalid repository or commit');
  const paths = new Set();
  for (const entry of snapshot.files) {
    safePath(entry.path);
    if ((!entry.path.startsWith('src/') && !entry.path.startsWith('public/') && !['PRODUCT.md', 'DESIGN.md'].includes(entry.path)) || paths.has(entry.path) || !/^[a-f0-9]{40}$/.test(entry.gitBlobSha)) throw new Error('Existing snapshot has invalid or duplicate files');
    paths.add(entry.path);
  }
  return snapshot;
}
function differences(previous, entries) {
  const before = new Map((previous?.files || []).map(item => [item.path, item]));
  const after = new Map(entries.map(item => [item.path, item]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(filename => {
    const old = before.get(filename), next = after.get(filename);
    if (old?.gitBlobSha === next?.gitBlobSha) return [];
    return [{ path: filename, change: !old ? 'added' : !next ? 'deleted' : 'modified',
      before: old?.gitBlobSha || null, after: next?.gitBlobSha || null }];
  });
}
function existingRawDrift(target, snapshot) {
  const changes = [];
  const expected = new Set((snapshot?.files || []).map(item => localPath(item.path)));
  for (const item of snapshot?.files || []) {
    const relative = localPath(item.path), filename = path.join(target, relative);
    try {
      const info = fs.lstatSync(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file');
      const bytes = fs.readFileSync(filename);
      if (bytes.length !== item.bytes || blobHash(bytes) !== item.gitBlobSha) changes.push({ path: relative, reason: 'modified' });
    } catch (_) { changes.push({ path: relative, reason: 'missing-or-unreadable' }); }
  }
  for (const scope of ['upstream', 'public']) for (const filename of walk(path.join(target, scope))) {
    const relative = scope + '/' + filename;
    if (!expected.has(relative)) changes.push({ path: relative, reason: 'untracked-imported-file' });
  }
  return changes;
}
function adapterMapDrift(target, prepared) {
  const changes = [];
  const actual = new Set(walk(path.join(target, 'src')));
  for (const [filename, bytes] of prepared) {
    safePath(filename);
    const local = path.join(target, 'src', filename);
    if (!actual.has(filename) || !fs.readFileSync(local).equals(Buffer.from(bytes))) changes.push({ path: 'src/' + filename, reason: 'adapted-local-change' });
    actual.delete(filename);
  }
  for (const filename of actual) changes.push({ path: 'src/' + filename, reason: 'untracked-adapted-file' });
  return changes;
}
function exportedNames(bytes) {
  const result = [];
  const expression = /\bexport\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of bytes.toString('utf8').matchAll(expression)) result.push(match[1]);
  return result.sort();
}
function featureReport(target, incoming, changes) {
  return changes.filter(item => item.path.startsWith('src/')).map(item => {
    const previousFile = path.join(target, localPath(item.path));
    const before = item.before && fs.existsSync(previousFile) ? fs.readFileSync(previousFile) : Buffer.alloc(0);
    const after = item.after ? fs.readFileSync(path.join(incoming, localPath(item.path))) : Buffer.alloc(0);
    const oldNames = exportedNames(before), newNames = exportedNames(after);
    return { path: item.path, change: item.change,
      addedExports: newNames.filter(name => !oldNames.includes(name)), removedExports: oldNames.filter(name => !newNames.includes(name)),
      review: /\/game\/engine\./.test(item.path) ? 'rules-and-native-gameplay' : /\/data\//.test(item.path) ? 'vocabulary-and-curriculum' : /\/game\//.test(item.path) ? 'persistence-preferences-and-presentation' : 'web-ui-and-native-interaction-parity' };
  });
}

async function buildMetadata(source, commit, previousCommit, temporary) {
  const metadataTree = revision => {
    const names = git(source, ['ls-tree', '--name-only', '-z', revision]).split('\0').filter(filename => /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|index\.html|vite\.config\.(?:js|ts|mjs|mts|cjs|cts)|tsconfig(?:\.[\w-]+)?\.json)$/.test(filename));
    return names.length ? treeEntries(source, revision, names, false) : [];
  };
  const entries = metadataTree(commit);
  const folder = path.join(temporary, 'build-metadata');
  if (entries.length) await materialize(source, entries, folder);
  let oldEntries = [], baselineAvailable = false;
  if (previousCommit) {
    try { oldEntries = metadataTree(previousCommit); baselineAvailable = true; }
    catch (_) { /* Shallow fetches and local mirrors need not contain the old commit. */ }
  }
  let upstreamPackage = null;
  if (entries.some(item => item.path === 'package.json')) upstreamPackage = JSON.parse(fs.readFileSync(path.join(folder, 'upstream/package.json'), 'utf8'));
  const projectPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const declaredHere = { ...projectPackage.devDependencies, ...projectPackage.dependencies, ...projectPackage.optionalDependencies };
  let semver;
  try { semver = require('semver'); } catch (_) { /* A missing optional range evaluator is reported as unknown. */ }
  const dependencies = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, requested] of Object.entries(upstreamPackage?.[section] || {})) {
      let installedVersion = null;
      if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) && !name.includes('..')) {
        try { installedVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', name, 'package.json'), 'utf8')).version; } catch (_) {}
      }
      let satisfiesUpstreamRange = null;
      try { if (semver && installedVersion && typeof requested === 'string' && semver.validRange(requested)) satisfiesUpstreamRange = semver.satisfies(installedVersion, requested); } catch (_) {}
      dependencies.push({ name, section, upstreamRequirement: requested, projectRequirement: declaredHere[name] || null,
        installedVersion, satisfiesUpstreamRange,
        reviewRequired: !installedVersion || requested !== declaredHere[name] || satisfiesUpstreamRange === false });
    }
  }
  return { baselineAvailable, baselineStatus: baselineAvailable ? 'compared-with-previous-git-tree' : previousCommit ? 'previous-commit-unavailable-in-object-database' : 'no-previous-snapshot',
    files: entries.map(item => ({ ...item })), changes: baselineAvailable ? differences({ files: oldEntries }, entries) : null,
    dependencies, upstreamScriptNames: Object.keys(upstreamPackage?.scripts || {}).sort(),
    automaticallyInstallDependencies: false, automaticallyRunUpstreamScripts: false,
    note: 'Build entry points and dependency changes require review; no upstream dependency or script is installed or executed.' };
}

function nativeContractReport(incoming, target, commit) {
  const contractPath = path.join(target, 'NATIVE_CONTRACT.json');
  if (!fs.existsSync(contractPath)) return { ok: false, status: 'missing-review-contract', changes: null, affectedFeatures: [],
    error: 'The target has no native review contract. Explicit implementation review is required; sync does not create it.' };
  try {
    const { verifyNativeContract } = require('./check-lingotiles-contract.js');
    return verifyNativeContract(path.join(incoming, 'upstream'), { contractPath, commit });
  } catch (error) {
    return { ok: false, status: 'review-required', code: error.code || null, reviewedCommit: error.reviewedCommit || null,
      changes: error.changes || null, affectedFeatures: error.affectedFeatures || [], error: error.message };
  }
}

function canonicalOutput(filename) {
  let parent = path.resolve(filename), remaining = [];
  while (!fs.existsSync(parent)) {
    remaining.unshift(path.basename(parent));
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  return path.resolve(fs.realpathSync(parent), ...remaining);
}
function validateExistingReport(reportFile) {
  try { fs.lstatSync(reportFile); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let previous;
  try {
    if (!fs.statSync(reportFile).isFile()) throw new Error('not a regular file');
    previous = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (_) {
    throw new Error(`--report refuses to overwrite an existing non-report file: ${reportFile}`);
  }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous) ||
    previous.version !== 1 || previous.repository !== repository || !/^[a-f0-9]{40}$/.test(previous.commit || '') ||
    !Number.isSafeInteger(previous.fileCount) || previous.fileCount < 0 ||
    !['check', 'apply'].includes(previous.mode) || typeof previous.applied !== 'boolean' ||
    !Array.isArray(previous.changes) || !Array.isArray(previous.localChanges) || !Array.isArray(previous.conflicts)) {
    throw new Error(`--report refuses to overwrite an existing non-report file: ${reportFile}`);
  }
}
function validateReportPath(reportFile, target) {
  if (!reportFile) return;
  const output = canonicalOutput(reportFile), targetRoot = canonicalOutput(target);
  const relative = path.relative(targetRoot, output);
  if ((!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) && relative !== 'UPDATE_REPORT.json') {
    throw new Error('--report may not overwrite project sources, snapshots, adapters or review contracts; use artifacts/ or explicitly target UPDATE_REPORT.json');
  }
  validateExistingReport(reportFile);
}

/** Same-filesystem directory swap with rollback. Hook is only for fault-injection tests. */
export function commitDirectory(staging, target, afterBackup) {
  const backup = target + '.sync-backup-' + crypto.randomUUID();
  const existed = fs.existsSync(target);
  if (existed) fs.renameSync(target, backup);
  try {
    if (afterBackup) afterBackup();
    fs.renameSync(staging, target);
  } catch (error) {
    if (existed) fs.renameSync(backup, target);
    throw error;
  }
  // A successfully installed tree stays installed if backup cleanup is interrupted.
  try { if (existed) fs.rmSync(backup, { recursive: true, force: true }); } catch (_) { return { backupRetained: backup }; }
  return {};
}

export async function syncLingotiles(options = {}) {
  const target = path.resolve(options.targetDir || defaultTarget);
  const ref = options.ref || 'main';
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.endsWith('/')) throw new Error('Use a simple branch, tag, or full commit as --ref');
  if (target === path.parse(target).root) throw new Error('A filesystem root cannot be a sync target');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Sync target must not be a symlink');
  validateReportPath(options.reportFile, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brclio-lingotiles-fetch-'));
  let staging;
  try {
    let source = options.sourceDir ? path.resolve(options.sourceDir) : path.join(temporary, 'repository.git');
    if (!options.sourceDir) {
      fs.mkdirSync(source);
      git(source, ['init', '--bare', '--quiet']);
      git(source, ['fetch', '--depth=1', '--no-tags', repository + '.git', ref]);
    }
    const commit = git(source, ['rev-parse', '--verify', '--end-of-options', options.sourceDir ? ref + '^{commit}' : 'FETCH_HEAD^{commit}']).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected an upstream SHA-1 commit');
    const entries = sourceEntries(source, commit);
    const incoming = path.join(temporary, 'incoming');
    await materialize(source, entries, incoming);
    const previous = readSnapshot(target);
    const changes = differences(previous, entries);
    const report = { version: 1, repository, requestedRef: ref, previousCommit: previous?.commit || null, commit,
      sourceTransport: options.sourceDir ? 'explicit-local-git-object-database' : 'fixed-github-https-git',
      checkedAt: new Date().toISOString(), mode: options.apply ? 'apply' : 'check', applied: false,
      fileCount: entries.length, totalBytes: entries.reduce((sum, item) => sum + item.bytes, 0),
      changes, sourceChanges: featureReport(target, incoming, changes),
      buildMetadata: await buildMetadata(source, commit, previous?.commit, temporary),
      documentChanges: changes.filter(item => ['PRODUCT.md', 'DESIGN.md'].includes(item.path)),
      localChanges: existingRawDrift(target, previous), conflicts: [],
      nativeContract: nativeContractReport(incoming, target, commit),
      requiredValidation: ['Review upstream feature and design changes against the native page.', 'Review/update NATIVE_CONTRACT.json explicitly; new features are not automatically aligned to the mini program.', 'Run native contract, model/page tests, web E2E, and an offline build before release.'] };
    report.nativeContractReviewRequired = !report.nativeContract.ok;
    let adapters, prepared;
    try { adapters = options.adapters || require('./lingotiles-adapters.js'); }
    catch (error) { report.conflicts.push({ adapter: 'loader', error: error.message }); }
    if (adapters) {
      try { prepared = adapters.prepareWebSources(path.join(incoming, 'upstream/src')); if (!(prepared instanceof Map)) throw new Error('prepareWebSources must return a Map'); }
      catch (error) { report.conflicts.push({ adapter: 'web', error: error.message }); }
      try { adapters.validateNativeSources(path.join(incoming, 'upstream/src')); }
      catch (error) { report.conflicts.push({ adapter: 'native', error: error.message }); }
      if (previous) {
        try { report.localChanges.push(...adapterMapDrift(target, adapters.prepareWebSources(path.join(target, 'upstream/src')))); }
        catch (error) { report.conflicts.push({ adapter: 'existing-web', error: error.message }); }
      } else if (fs.existsSync(path.join(target, 'src'))) report.localChanges.push({ path: 'src/', reason: 'existing-adaptation-has-no-snapshot' });
    }
    report.readyToApply = report.conflicts.length === 0 && report.localChanges.length === 0;
    if (options.apply && report.readyToApply && (changes.length || previous?.commit !== commit)) {
      validateReportPath(path.join(target, 'UPDATE_REPORT.json'), target);
      staging = fs.mkdtempSync(path.join(path.dirname(target), '.lingotiles-sync-'));
      if (fs.existsSync(target)) fs.cpSync(target, staging, { recursive: true, dereference: false });
      for (const scope of ['upstream', 'public', 'src']) fs.rmSync(path.join(staging, scope), { recursive: true, force: true });
      for (const scope of ['upstream', 'public']) fs.cpSync(path.join(incoming, scope), path.join(staging, scope), { recursive: true });
      for (const [filename, bytes] of prepared) {
        safePath(filename);
        const destination = path.join(staging, 'src', filename);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes);
      }
      const snapshot = { repository, commit, importedOn: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), sourceTransport: report.sourceTransport,
        files: entries.map(item => ({ path: item.path, bytes: item.bytes, gitBlobSha: item.gitBlobSha })) };
      fs.writeFileSync(path.join(staging, 'SNAPSHOT.json'), JSON.stringify(snapshot, null, 2) + '\n');
      report.applied = true;
      fs.writeFileSync(path.join(staging, 'UPDATE_REPORT.json'), JSON.stringify(report, null, 2) + '\n');
      Object.assign(report, commitDirectory(staging, target, options.afterBackup));
      staging = null;
    }
    if (options.reportFile) {
      const filename = path.resolve(options.reportFile);
      validateReportPath(filename, target);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
    }
    return report;
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const options = {};
  const flags = { '--ref': 'ref', '--source-dir': 'sourceDir', '--target-dir': 'targetDir', '--report': 'reportFile' };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--check') options.check = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (flags[argument] && args[index + 1] && !args[index + 1].startsWith('--')) options[flags[argument]] = args[++index];
    else throw new Error('Unknown or missing argument: ' + argument);
  }
  if (options.apply && options.check) throw new Error('--apply and --check are mutually exclusive');
  return options;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/sync-lingotiles.mjs [--ref main|COMMIT] [--check | --apply] [--source-dir LOCAL_GIT_REPO] [--target-dir TARGET] [--report FILE]\nDefaults to a read-only check against the fixed GitHub repository. Apply verifies blobs and adapters, protects local edits, then swaps the imported tree. Review native feature parity and run contracts/tests after any update.');
    else {
      const report = await syncLingotiles(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.readyToApply) process.exitCode = 2;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
