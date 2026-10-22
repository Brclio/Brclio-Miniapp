'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const importer = import('../scripts/sync-lingotiles.mjs');

function files(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? files(path.join(directory, item.name), prefix + item.name + '/') : [prefix + item.name]).sort();
}
function digest(directory) {
  const hash = crypto.createHash('sha256');
  for (const filename of files(directory)) hash.update(filename + '\0').update(fs.readFileSync(path.join(directory, filename)));
  return hash.digest('hex');
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingotiles-sync-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceDir = path.join(directory, 'source');
  const targetDir = path.join(directory, 'project');
  fs.mkdirSync(sourceDir); fs.mkdirSync(targetDir);
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', sourceDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Local Sync Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  const put = (filename, bytes) => { const destination = path.join(sourceDir, filename); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes); };
  put('src/game/engine.ts', "export const feature = 'one';\n");
  put('src/App.tsx', "export const screen = 'one';\n");
  put('src/obsolete.ts', 'export const obsolete = true;\n');
  put('public/vocabulary/chunk.json', Buffer.from([0, 10, 128, 255, 0, 13, 10]));
  put('public/duplicate.bin', Buffer.from([0, 10, 128, 255, 0, 13, 10]));
  put('public/empty.txt', '');
  put('PRODUCT.md', '# Original product\n'); put('DESIGN.md', '# Original design\n');
  put('package.json', JSON.stringify({ dependencies: { react: '^18.3.0' }, scripts: { postinstall: 'node do-not-run.js' } }));
  put('vite.config.ts', 'export default {};\n');
  put('do-not-run.js', "require('fs').writeFileSync('EXECUTED','unsafe');");
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']); };
  const first = commit();
  fs.mkdirSync(path.join(targetDir, 'adapters'));
  fs.writeFileSync(path.join(targetDir, 'adapters/web.json'), '{"personalAdapter":true}\n');
  fs.writeFileSync(path.join(targetDir, 'mobile.css'), '/* Keep the local mobile layout. */\n');
  const adapters = {
    prepareWebSources(source) {
      const prepared = new Map(files(source).map(filename => [filename, Buffer.concat([Buffer.from('// adapted\n'), fs.readFileSync(path.join(source, filename))])]));
      if (prepared.get('App.tsx').includes('BROKEN_WEB')) throw new Error('Web adapter cannot match upstream App.tsx');
      return prepared;
    },
    validateNativeSources(source) { if (fs.readFileSync(path.join(source, 'game/engine.ts'), 'utf8').includes('BROKEN_NATIVE')) throw new Error('Native adapter cannot match upstream engine'); return true; }
  };
  return { directory, sourceDir, targetDir, git, put, commit, first, adapters,
    options: { sourceDir, targetDir, ref: 'main', adapters } };
}

test('sync defaults to a read-only report; apply imports verified committed bytes and preserves local adapters', async t => {
  const f = fixture(t);
  const { syncLingotiles, blobHash } = await importer;
  const before = digest(f.targetDir);
  const checked = await syncLingotiles(f.options);
  assert.equal(checked.applied, false);
  assert.equal(checked.readyToApply, true);
  assert.equal(checked.commit, f.first);
  assert.equal(digest(f.targetDir), before);
  assert.equal(checked.fileCount, 8);
  assert.ok(checked.buildMetadata.dependencies.some(item => item.name === 'react' && item.installedVersion));
  assert.equal(checked.buildMetadata.automaticallyRunUpstreamScripts, false);
  // Dirty working-copy files must never be mistaken for a Git commit's source.
  f.put('src/game/engine.ts', 'DIRTY WORKTREE\n');
  const applied = await syncLingotiles({ ...f.options, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(path.join(f.targetDir, 'upstream/src/game/engine.ts'), 'utf8'), "export const feature = 'one';\n");
  assert.ok(fs.existsSync(path.join(f.targetDir, 'adapters/web.json')));
  assert.ok(fs.existsSync(path.join(f.targetDir, 'mobile.css')));
  assert.equal(fs.existsSync(path.join(f.sourceDir, 'EXECUTED')), false);
  const snapshot = JSON.parse(fs.readFileSync(path.join(f.targetDir, 'SNAPSHOT.json'), 'utf8'));
  for (const item of snapshot.files) {
    const filename = item.path.startsWith('public/') ? item.path : 'upstream/' + item.path;
    const bytes = fs.readFileSync(path.join(f.targetDir, filename));
    assert.equal(blobHash(bytes), item.gitBlobSha, item.path);
    assert.equal(bytes.length, item.bytes);
  }
  assert.equal(fs.existsSync(path.join(f.targetDir, 'upstream/package.json')), false, 'Build metadata is report-only');
});

test('an explicit commit update reports additions/deletions, feature exports and dependency drift', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  f.put('src/game/engine.ts', 'export function newFeature() { return 2; }\n');
  f.put('src/new-screen.ts', 'export const screen = 2;\n');
  fs.unlinkSync(path.join(f.sourceDir, 'src/obsolete.ts'));
  f.put('PRODUCT.md', '# New product feature\n');
  f.put('package.json', JSON.stringify({ dependencies: { react: '^99.0.0', 'missing-lingotiles-fixture-package': '1.0.0' } }));
  const second = f.commit();
  const report = await syncLingotiles({ ...f.options, ref: second });
  assert.equal(report.buildMetadata.baselineAvailable, true);
  assert.ok(report.buildMetadata.changes.some(item => item.path === 'package.json' && item.change === 'modified'));
  assert.equal(report.buildMetadata.dependencies.find(item => item.name === 'missing-lingotiles-fixture-package').installedVersion, null);
  assert.equal(report.buildMetadata.dependencies.find(item => item.name === 'react').reviewRequired, true);
  assert.ok(report.changes.some(item => item.path === 'src/obsolete.ts' && item.change === 'deleted'));
  assert.ok(report.sourceChanges.find(item => item.path === 'src/game/engine.ts').addedExports.includes('newFeature'));
  assert.equal(report.nativeContractReviewRequired, true);
  assert.match(report.requiredValidation.join(' '), /not automatically aligned/);
  const applied = await syncLingotiles({ ...f.options, ref: second, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(fs.existsSync(path.join(f.targetDir, 'src/obsolete.ts')), false);
  assert.ok(fs.existsSync(path.join(f.targetDir, 'src/new-screen.ts')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetDir, 'SNAPSHOT.json'))).commit, second);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetDir, 'UPDATE_REPORT.json'))).nativeContractReviewRequired, true);
});

test('web and native patch conflicts fail closed, without replacing any project file', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  const before = digest(f.targetDir);
  f.put('src/App.tsx', 'export const BROKEN_WEB = true;\n');
  f.put('src/game/engine.ts', 'export const BROKEN_NATIVE = true;\n');
  f.commit();
  const checked = await syncLingotiles(f.options);
  assert.deepEqual(checked.conflicts.map(item => item.adapter).sort(), ['native', 'web']);
  const applied = await syncLingotiles({ ...f.options, apply: true });
  assert.equal(applied.applied, false);
  assert.equal(applied.readyToApply, false);
  assert.equal(digest(f.targetDir), before);
});

test('raw and adapted local edits and unexpected imported files are protected from apply', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  f.put('PRODUCT.md', '# Upstream changed\n'); f.commit();
  fs.appendFileSync(path.join(f.targetDir, 'src/App.tsx'), '// local edit\n');
  fs.appendFileSync(path.join(f.targetDir, 'upstream/PRODUCT.md'), 'local raw edit\n');
  fs.writeFileSync(path.join(f.targetDir, 'public/local-only.bin'), 'precious local resource');
  const before = digest(f.targetDir);
  const report = await syncLingotiles({ ...f.options, apply: true });
  assert.equal(report.applied, false);
  assert.ok(report.localChanges.some(item => item.path === 'src/App.tsx'));
  assert.ok(report.localChanges.some(item => item.path === 'upstream/PRODUCT.md'));
  assert.ok(report.localChanges.some(item => item.path === 'public/local-only.bin'));
  assert.equal(digest(f.targetDir), before);
});

test('a failed directory installation restores the old complete tree and removes staging', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  f.put('PRODUCT.md', '# New upstream\n'); f.commit();
  const before = digest(f.targetDir);
  await assert.rejects(syncLingotiles({ ...f.options, apply: true, afterBackup: () => { throw new Error('Injected installation failure'); } }), /Injected installation failure/);
  assert.equal(digest(f.targetDir), before);
  assert.equal(fs.readdirSync(f.directory).some(name => name.includes('sync-backup') || name.startsWith('.lingotiles-sync-')), false);
});

test('missing historical Git objects are reported as unknown metadata, and source symlinks are rejected', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  const filename = path.join(f.targetDir, 'SNAPSHOT.json');
  const snapshot = JSON.parse(fs.readFileSync(filename)); snapshot.commit = '1'.repeat(40);
  fs.writeFileSync(filename, JSON.stringify(snapshot));
  const report = await syncLingotiles(f.options);
  assert.equal(report.buildMetadata.baselineAvailable, false);
  assert.match(report.buildMetadata.baselineStatus, /unavailable/);
  fs.symlinkSync('../outside', path.join(f.sourceDir, 'public/escape'));
  f.commit();
  await assert.rejects(syncLingotiles({ ...f.options, apply: true }), /symlink/);
});

test('report destinations cannot overwrite source, snapshot or native review files, including through symlinks', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  const before = digest(f.targetDir);
  for (const relative of ['SNAPSHOT.json', 'src/App.tsx', 'public/empty.txt', 'adapters/web.json', 'NATIVE_CONTRACT.json', 'SOURCE.md']) {
    await assert.rejects(syncLingotiles({ ...f.options, reportFile: path.join(f.targetDir, relative) }), /--report may not overwrite/);
  }
  const linked = path.join(f.directory, 'linked-report.json');
  fs.symlinkSync(path.join(f.targetDir, 'SNAPSHOT.json'), linked);
  await assert.rejects(syncLingotiles({ ...f.options, reportFile: linked }), /--report may not overwrite/);
  assert.equal(digest(f.targetDir), before);
});

test('existing ordinary files and JSON outside the import target cannot be clobbered by reports', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  const ordinary = path.join(f.directory, 'package.json');
  const text = path.join(f.directory, 'notes.txt');
  const impostor = path.join(f.directory, 'not-a-sync-report.json');
  fs.writeFileSync(ordinary, '{"name":"precious-package","version":"1.0.0"}\n');
  fs.writeFileSync(text, 'Keep this ordinary document.\n');
  fs.writeFileSync(impostor, JSON.stringify({ version: 1, commit: 'a'.repeat(40), fileCount: 8, mode: 'check' }));
  for (const reportFile of [ordinary, text, impostor]) {
    const before = fs.readFileSync(reportFile);
    await assert.rejects(syncLingotiles({ ...f.options, reportFile }), /existing non-report file/);
    assert.ok(before.equals(fs.readFileSync(reportFile)));
  }
  const linked = path.join(f.directory, 'ordinary-report-link.json');
  fs.symlinkSync(ordinary, linked);
  await assert.rejects(syncLingotiles({ ...f.options, reportFile: linked }), /existing non-report file/);
  assert.equal(JSON.parse(fs.readFileSync(ordinary)).name, 'precious-package');
});

test('new report paths and genuine same-repository reports may be written and refreshed', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  const reportFile = path.join(f.directory, 'reports/upstream.json');
  const first = await syncLingotiles({ ...f.options, reportFile });
  assert.equal(JSON.parse(fs.readFileSync(reportFile)).commit, first.commit);
  f.put('PRODUCT.md', '# Second report\n');
  const nextCommit = f.commit();
  const second = await syncLingotiles({ ...f.options, reportFile });
  assert.equal(second.commit, nextCommit);
  assert.equal(JSON.parse(fs.readFileSync(reportFile)).commit, nextCommit);
  const otherRepository = { ...second, repository: 'https://github.com/other/other' };
  fs.writeFileSync(reportFile, JSON.stringify(otherRepository));
  await assert.rejects(syncLingotiles({ ...f.options, reportFile }), /existing non-report file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportFile)), otherRepository);
});

test('UPDATE_REPORT rejects ordinary content even during implicit apply, but valid reports can refresh', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  await syncLingotiles({ ...f.options, apply: true });
  const reportFile = path.join(f.targetDir, 'UPDATE_REPORT.json');
  f.put('PRODUCT.md', '# Compatible update\n');
  const nextCommit = f.commit();
  await syncLingotiles({ ...f.options, apply: true, reportFile });
  assert.equal(JSON.parse(fs.readFileSync(reportFile)).commit, nextCommit);
  fs.writeFileSync(reportFile, '{"keep":"ordinary local data"}\n');
  const before = digest(f.targetDir);
  f.put('PRODUCT.md', '# Another update\n');
  f.commit();
  await assert.rejects(syncLingotiles({ ...f.options, apply: true }), /existing non-report file/);
  assert.equal(digest(f.targetDir), before);
  await assert.rejects(syncLingotiles({ ...f.options, reportFile }), /existing non-report file/);
  assert.equal(digest(f.targetDir), before);
});

test('a resource-only commit preserves a valid native review contract without requiring functional review', async t => {
  const f = fixture(t);
  const { syncLingotiles } = await importer;
  const { collectBehaviorFiles } = require('../scripts/check-lingotiles-contract');
  await syncLingotiles({ ...f.options, apply: true });
  const reviewedFiles = collectBehaviorFiles(path.join(f.targetDir, 'upstream'));
  const contract = { version: 1, reviewedCommit: f.first, files: reviewedFiles,
    features: [{ id: 'fixture-feature', coverage: 'shared', upstreamFiles: Object.keys(reviewedFiles), nativeFiles: ['native.js'], regressionTests: ['fixture.test.js'] }], knownDifferences: [] };
  const contractPath = path.join(f.targetDir, 'NATIVE_CONTRACT.json');
  fs.writeFileSync(contractPath, JSON.stringify(contract));
  const originalContract = fs.readFileSync(contractPath, 'utf8');
  f.put('public/new-illustration.webp', Buffer.from('new image bytes')); f.commit();
  const report = await syncLingotiles({ ...f.options, apply: true });
  assert.equal(report.nativeContract.ok, true);
  assert.equal(report.nativeContractReviewRequired, false);
  assert.equal(report.nativeContract.reviewedCommit, f.first);
  assert.equal(fs.readFileSync(contractPath, 'utf8'), originalContract, 'Sync must never regenerate a review contract');
  f.put('src/game/engine.ts', 'export const feature = 2;\n'); f.commit();
  const changed = await syncLingotiles(f.options);
  assert.equal(changed.nativeContract.ok, false);
  assert.equal(changed.nativeContractReviewRequired, true);
  assert.ok(changed.nativeContract.changes.modified.includes('src/game/engine.ts'));
  assert.deepEqual(changed.nativeContract.affectedFeatures, ['fixture-feature']);
});
