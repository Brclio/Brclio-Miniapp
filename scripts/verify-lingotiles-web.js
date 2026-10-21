#!/usr/bin/env node
'use strict';

// Optional browser verification: use Codex's bundled Playwright or PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwrightModule;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
  try { playwrightModule = require(candidate); break; } catch (_) { /* Try the next available runtime. */ }
}
if (!playwrightModule) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module before browser verification.');
const { chromium } = playwrightModule;
const model = require('../miniprogram/lib/lingotiles');
const root = path.resolve(__dirname, '..');
const base = (process.env.LINGOTILES_BASE || process.argv[2] || 'http://127.0.0.1:8790').replace(/\/$/, '');
const output = path.join(root, 'artifacts/lingotiles');
const url = base + '/projects/lingotiles/';
const report = { url, checkedAt: new Date().toISOString(), checks: [], screenshots: [], consoleErrors: [], requestFailures: [] };
fs.mkdirSync(output, { recursive: true });

function solveBoard(tiles, boardWidth, boardHeight) {
  const initial = { ...model.createGame(model.LEVELS[0].words, 1, boardWidth === 4), tiles, solution: [], boardWidth, boardHeight };
  const visited = new Set();
  let attempts = 0;
  function dfs(state) {
    if (state.status === 'won') return [];
    if (state.status !== 'playing') return null;
    const key = state.tiles.map(tile => tile.id).sort().join('|') + '/' + state.tray.map(tile => tile.id).sort().join('|');
    if (visited.has(key)) return null;
    visited.add(key);
    if (++attempts > 500000) throw new Error('Board solver exceeded 500,000 distinct legal states');
    const candidates = model.getAvailableTiles(state).map(tile => ({ tile, next: model.selectTile(state, tile.id) }));
    // Prefer completed sets and then useful existing pairs; the search still tries every legal tile.
    const value = candidate => {
      const next = candidate.next;
      const bestGroup = next.words.reduce((best, word) => Math.max(best,
        Number(next.tray.some(tile => tile.kind === 'word' && tile.wordId === word.id))
        + Number(next.tray.some(tile => tile.kind === 'pos' && tile.text === word.pos))
        + Number(next.tray.some(tile => tile.kind === 'meaning' && tile.text === word.meaning))), 0);
      return next.matchedWordIds.length * 100 + bestGroup * 5 - next.tray.length;
    };
    candidates.sort((a, b) => value(b) - value(a));
    for (const candidate of candidates) {
      const tail = dfs(candidate.next);
      if (tail) return [candidate.tile.id, ...tail];
    }
    return null;
  }
  const solution = dfs(initial);
  assert.ok(solution, 'The DOM board must have a legal complete solution');
  return { solution, attempts };
}

async function main() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('requestfailed', request => report.requestFailures.push({ url: request.url(), failure: request.failure()?.errorText }));
  const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
  const screenshot = async name => {
    const filename = 'web-' + name + '.png';
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
    report.screenshots.push(filename);
  };
  const geometry = async label => {
    const value = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth, height: document.documentElement.scrollHeight }));
    assert.ok(value.document <= value.viewport + 1, `${label}: document ${value.document}px exceeds ${value.viewport}px viewport`);
    return value;
  };
  const responsiveGeometry = async label => {
    const previous = page.viewportSize();
    const layouts = [];
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      layouts.push(await geometry(label + '-' + width));
    }
    await page.setViewportSize(previous);
    report.responsive = { ...(report.responsive || {}), [label]: layouts };
    return layouts;
  };
  const check = async (name, operation) => {
    const started = Date.now();
    const detail = await operation();
    report.checks.push({ name, passed: true, milliseconds: Date.now() - started, ...(detail || {}) });
    console.log('PASS ' + name);
  };
  const waitNotebook = async (expectedCount = null) => {
    await page.waitForFunction(expected => {
      const list = document.querySelector('.notebook-list');
      return list && list.getAttribute('aria-busy') === 'false'
        && (expected === null || list.querySelectorAll('.notebook-row').length === expected);
    }, expectedCount, { timeout: 90000 });
  };
  const playRound = async (round, replay) => {
    if (replay) await page.getByRole('button', { name: '再练一次', exact: true }).click();
    else await page.getByRole('button', { name: '开始记忆', exact: true }).click();
    await page.locator('.memory-grid').waitFor();
    assert.equal(await page.locator('.memory-grid .memory-card').count() || await page.locator('.memory-grid > *').count(), 6);
    if (round === 1) { await responsiveGeometry('memory'); await screenshot('memory-390'); }
    await page.getByRole('button', { name: /记好了，开始消除/ }).click();
    await page.locator('.tile-board [data-tile-id]').first().waitFor();
    const board = await page.locator('.tile-board').evaluate(element => {
      const width = element.classList.contains('compact-board') ? 4 : 6;
      const height = width === 4 ? 5 : 4;
      return { width, height, tiles: [...element.querySelectorAll('[data-tile-id]')].map(tile => {
        const id = tile.dataset.tileId;
        const split = id.lastIndexOf(':');
        return { id, wordId: id.slice(0, split), kind: id.slice(split + 1),
          text: tile.querySelector('.tile-content').textContent, x: parseFloat(tile.style.left.match(/[-\d.]+/)[0]) * width / 100,
          y: parseFloat(tile.style.top) * height / 100, layer: Number(tile.style.zIndex) - 1 };
      }) };
    });
    for (const tile of board.tiles) tile.pos = model.LEVELS[0].words.find(word => word.id === tile.wordId).pos;
    assert.equal(board.tiles.length, 18);
    const { solution, attempts } = solveBoard(board.tiles, board.width, board.height);
    if (round === 1) {
      await responsiveGeometry('playing');
      await screenshot('play-390');
      await page.getByRole('button', { name: '暂停一下', exact: true }).click();
      await page.locator('.paused-board').waitFor();
      assert.equal(await page.locator('.tile-board').count(), 0);
      await page.locator('.paused-board').getByRole('button', { name: '继续游戏', exact: true }).click();
    }
    for (const id of solution) {
      const tile = page.locator('[data-tile-id=' + JSON.stringify(id) + ']');
      assert.equal(await tile.isEnabled(), true, `${id} is expected to be uncovered`);
      await tile.click();
      await tile.waitFor({ state: 'detached' });
    }
    await page.locator('.result-content').waitFor();
    assert.match(await page.locator('.result-content h2').textContent(), /记住|完成/);
    await page.getByText('本次通关已记录', { exact: true }).waitFor();
    assert.equal(await page.locator('.result-word-list > *').count(), 6);
    return { round, cardsClicked: solution.length, solverStates: attempts, ...await geometry('result-390') };
  };

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await check('responsive ready layouts at 390, 320 and 1440', async () => {
      const layouts = [];
      assert.equal(await page.locator('.level-card').count(), 6);
      for (const width of [390, 320, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        layouts.push(await geometry('ready-' + width));
        await screenshot('ready-' + width);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      return { layouts, themeWords: model.LEVELS.reduce((total, level) => total + level.words.length, 0) };
    });
    await check('match animation defaults off, toggles and persists', async () => {
      const toggle = page.getByRole('switch', { name: '配对合成动画' });
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    });
    await check('theme memory, pause/resume and all legal tile clicks complete first round', () => playRound(1, false));
    await screenshot('win-390');
    await check('replaying the same theme appends a second independent completion', () => playRound(2, true));
    await check('history retains both rounds after reload and exports all CSV rows', async () => {
      await nav('通关足迹').click();
      await page.locator('.history-table tbody tr').nth(1).waitFor();
      assert.equal(await page.locator('.history-table tbody tr').count(), 2);
      await responsiveGeometry('history');
      await screenshot('history-390');
      await page.reload({ waitUntil: 'networkidle' });
      await nav('通关足迹').click();
      await page.locator('.history-table tbody tr').nth(1).waitFor();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出全部 CSV', exact: true }).click();
      const download = await downloading;
      const destination = path.join(output, 'web-history.csv');
      await download.saveAs(destination);
      const csv = fs.readFileSync(destination, 'utf8');
      const rows = csv.trim().split('\r\n');
      assert.equal(rows.length, 3);
      assert.notEqual(rows[1].split(',')[0], rows[2].split(',')[0]);
      assert.ok(csv.startsWith('\uFEFF'));
      return { records: 2, csvBytes: Buffer.byteLength(csv), csv: path.relative(root, destination) };
    });
    await check('notebook reviewed words, save filter, Chinese search and persisted bookmark', async () => {
      await nav('单词本').click();
      await waitNotebook();
      await page.getByRole('button', { name: /^已复习\s+6$/ }).click();
      await waitNotebook(6);
      assert.equal(await page.locator('.notebook-row').count(), 6);
      await page.getByRole('button', { name: '收藏 apple', exact: true }).click();
      await page.getByRole('button', { name: /^收藏\s+1$/ }).click();
      await waitNotebook(1);
      assert.equal(await page.locator('.notebook-row').count(), 1);
      assert.equal(await page.locator('.notebook-word strong').textContent(), 'apple');
      await page.getByRole('searchbox', { name: '搜索英文或中文' }).fill('苹果');
      await page.waitForFunction(() => document.querySelector('.dictionary-status')?.textContent.includes('正在检索'));
      await waitNotebook(1);
      await page.waitForFunction(() => !document.querySelector('.dictionary-status')?.textContent.includes('正在'), null, { timeout: 90000 });
      assert.equal(await page.locator('.notebook-row').count(), 1);
      assert.match(await page.locator('.notebook-meaning').textContent(), /苹果/);
      await responsiveGeometry('notebook');
      await screenshot('notebook-390');
      await page.reload({ waitUntil: 'networkidle' });
      await nav('单词本').click();
      await waitNotebook();
      await page.getByRole('button', { name: /^收藏\s+1$/ }).click();
      await waitNotebook(1);
      assert.equal(await page.getByRole('button', { name: '取消收藏 apple', exact: true }).count(), 1);
      return { reviewedWords: 6, savedWords: 1, ChineseQuery: '苹果' };
    });
    await check('all six curriculum stages and the last advanced round load real vocabulary', async () => {
      await nav('闯关练习').click();
      await page.getByRole('button', { name: /分级闯关/ }).click();
      await page.locator('.stage-choice').last().waitFor();
      const stages = [];
      for (const profile of model.STAGE_PROFILES) {
        const stage = page.locator('.stage-choice').filter({ hasText: profile.title });
        await stage.click();
        await page.waitForFunction(title => document.querySelector('.ready-controls .side-eyebrow')?.textContent.includes(title)
          && !document.querySelector('.library-loading'), profile.title);
        stages.push({ id: profile.id, title: profile.title, ...await geometry('stage-' + profile.id) });
      }
      const jump = page.getByRole('spinbutton', { name: '分级关卡编号' });
      const lastRound = Number(await jump.getAttribute('max'));
      await jump.fill(String(lastRound));
      await page.getByRole('button', { name: '前往', exact: true }).click();
      await page.waitForFunction(round => document.querySelector('.ready-controls .side-eyebrow')?.textContent.includes(`第 ${round} 关`)
        && !document.querySelector('.library-loading'), lastRound);
      await responsiveGeometry('advanced-last');
      await screenshot('advanced-last-390');
      await page.getByRole('button', { name: '开始记忆', exact: true }).click();
      await page.locator('.memory-grid').waitFor();
      const finalWords = await page.locator('.memory-grid > *').count();
      assert.ok(finalWords >= 1 && finalWords <= 16);
      await page.getByRole('button', { name: /记好了，开始消除/ }).click();
      await page.locator('.tile-board [data-tile-id]').first().waitFor();
      const tileCount = await page.locator('.tile-board [data-tile-id]').count();
      assert.equal(tileCount, finalWords * 3);
      await screenshot('advanced-last-play-390');
      return { stages, lastAdvancedRound: lastRound, finalWords, tileCount };
    });
    await check('weak-network failure stays readable and retries successfully', async () => {
      const weak = await context.newPage();
      await weak.route('**/vocabulary/**', route => route.abort('failed'));
      await weak.goto(url, { waitUntil: 'networkidle' });
      await weak.getByRole('button', { name: /分级闯关/ }).click();
      await weak.locator('.library-error').waitFor();
      const feedback = await weak.locator('.library-error').textContent();
      assert.ok(feedback.trim().length > 4);
      await weak.screenshot({ path: path.join(output, 'web-network-error-390.png'), fullPage: true });
      report.screenshots.push('web-network-error-390.png');
      await weak.unroute('**/vocabulary/**');
      await weak.locator('.library-error').getByRole('button').click();
      await weak.locator('.ready-controls').waitFor();
      assert.equal(await weak.locator('.library-error').count(), 0);
      await weak.close();
      return { errorFeedback: feedback.trim() };
    });
    assert.equal(report.consoleErrors.length, 0, 'No unhandled browser errors');
    report.passed = true;
    const previousFailure = path.join(output, 'web-failure.png');
    if (fs.existsSync(previousFailure)) fs.unlinkSync(previousFailure);
  } catch (error) {
    report.passed = false;
    report.error = error.stack || String(error);
    await screenshot('failure').catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'web-verification.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
