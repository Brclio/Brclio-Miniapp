'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createReadyGo, KEYS, TTL } = require('../miniprogram/lib/ready-go-model');
const data = require('../miniprogram/lib/ready-go-data');

function host(initial, random) {
  const values = Object.assign({}, initial); let time = 1800000000000;
  const storage = { getStorageSync: (key) => values[key], setStorageSync: (key, value) => { values[key] = value; }, removeStorageSync: (key) => { delete values[key]; } };
  const game = createReadyGo({ storage, random: random || (() => 0), now: () => time });
  return { game, values, storage, now: () => time, advance: (ms) => { time += ms; } };
}

test('native libraries retain every original reward and random title/player name', () => {
  const original = fs.readFileSync(path.resolve(__dirname, '../web/projects/ready-go-duel/upstream/App.tsx'), 'utf8');
  const declarations = original.slice(original.indexOf('const REWARD_POOLS:'), original.indexOf('const STORAGE_KEY_TITLE'))
    .replace("const REWARD_POOLS: Record<Exclude<RewardCategory, 'CUSTOM'>, string[]> =", 'const REWARD_POOLS =')
    .replace('const CATEGORY_LABELS: Record<string, string> =', 'const CATEGORY_LABELS =');
  const fixture = vm.runInNewContext(declarations + '; JSON.stringify({ REWARD_POOLS, RANDOM_TITLES, RANDOM_PLAYER_NAMES, CATEGORY_LABELS })');
  const expected = JSON.parse(fixture);
  for (const key of Object.keys(expected)) assert.deepEqual(data[key], expected[key], key + ' must exactly match upstream');
  assert.ok(data.REWARD_POOLS.ALL.length > 300);
});

test('original duel accepts first input immediately, never waits for tie arbitration or target score', () => {
  const { game, advance } = host();
  assert.equal(game.launch().delay, 2000);
  advance(2000); game.signal(); advance(173);
  const first = game.touch('p1');
  assert.equal(first.winner, 'p1'); assert.equal(first.reactionTime, 173); assert.equal(first.gameState, 'ENDED');
  assert.equal(game.touch('p2'), null);
  assert.equal('targetScore' in first, false);
  assert.deepEqual(first.gameHistory.map((event) => event.step), ['WAITING', 'GO', 'END']);
});

test('touch before GO gives the opponent the win, and a late signal cannot override it', () => {
  const { game } = host(); game.launch();
  const result = game.touch('p2');
  assert.equal(result.winner, 'p1'); assert.equal(result.winReason, 'FALSE_START'); assert.equal(result.reactionTime, 0);
  assert.equal(game.signal(), null);
});

test('GO remains available after five seconds until a player responds, with configured random wait', () => {
  const h = host({}, () => 0.9999);
  h.game.settings({ title: '测试', maxWait: 10 });
  const round = h.game.launch(); assert.equal(round.delay, 9999);
  h.advance(round.delay); h.game.signal(); h.advance(60000);
  assert.equal(h.game.snapshot().gameState, 'GO');
  assert.equal(h.game.touch('p2').reactionTime, 60000);
});

test('settings and custom rewards expire independently after seven days; max wait persists', () => {
  const h = host(); h.game.settings({ title: '洗碗争霸赛', p1: '又菜又爱玩', p2: '爱喝奶茶', maxWait: 8 });
  h.advance(3000); h.game.importRewards('  奶茶\r\n\n 洗碗 \n');
  assert.deepEqual(h.game.snapshot().customRewards, ['奶茶', '洗碗']);
  h.advance(TTL - 3000);
  const after = createReadyGo({ storage: h.storage, now: h.now }).snapshot();
  assert.equal(after.customTitle, ''); assert.equal(after.p1Name, ''); assert.equal(after.p2Name, '');
  assert.equal(after.maxWaitTime, 8); assert.deepEqual(after.customRewards, ['奶茶', '洗碗']);
  h.advance(3000);
  assert.deepEqual(createReadyGo({ storage: h.storage, now: h.now }).snapshot().customRewards, []);
  assert.equal(h.values[KEYS.custom], undefined);
});

test('reward categories, secret input, password checking, locked clear and reveal match original flow', () => {
  const h = host(); const game = h.game;
  assert.equal(game.snapshot().categories.some((c) => c.key === 'CUSTOM'), false);
  game.importRewards('自定义的第一个彩头\n自定义的第二个彩头'); game.category('CUSTOM'); game.randomReward('p1');
  assert.equal(game.snapshot().p1Reward, '自定义的第一个彩头');
  game.toggleInput('p1'); assert.equal(game.snapshot().p1InputType, 'password');
  game.setPassword('p1', '口令'); game.lock('p1');
  assert.equal(game.checkPassword('p1', '123456').ok, false);
  assert.deepEqual(game.checkPassword('p1', '口令'), { ok: true, content: '自定义的第一个彩头' });
  game.launch(); h.advance(2000); game.signal(); h.advance(150); game.touch('p1');
  assert.equal(game.snapshot().isRewardRevealed, false);
  assert.equal(game.reveal().isRewardRevealed, true);
  assert.equal(game.clear('p1').p1Reward, ''); assert.equal(game.snapshot().p1Masked, false);
  assert.throws(() => game.importRewards('  \n '), /为空/);
});

test('infinite rounds preserve the full list and next round automatically chooses and hides rewards', () => {
  const h = host(); const game = h.game;
  game.switchMode('INFINITE'); game.category('FOOD'); game.updateReward('p2', '手动彩头');
  game.launch(); game.touch('p1');
  let result = game.snapshot(); assert.equal(result.infiniteStats[0].reward, '手动彩头'); assert.equal(result.p2Wins, 1);
  for (let i = 0; i < 4; i += 1) { game.launch(true); h.advance(2000); game.signal(); h.advance(100); game.touch('p1'); }
  result = game.snapshot();
  assert.equal(result.infiniteStats.length, 5); assert.equal(result.p1Wins, 4); assert.equal(result.p2Wins, 1);
  assert.equal(result.infiniteStats[4].roundNumber, 5); assert.equal(result.p1Reward, data.REWARD_POOLS.FOOD[0]);
  assert.equal(result.p1Masked, true); assert.equal(result.p2Masked, true);
  game.switchMode('TOUCH'); assert.equal(game.snapshot().infiniteStats.length, 0); assert.equal(game.snapshot().p1Reward, data.REWARD_POOLS.FOOD[0]);
});

test('switching modes or hiding cancels unfinished rounds without appending a result', () => {
  const { game } = host(); game.switchMode('INFINITE'); game.launch();
  assert.equal(game.cancel().gameState, 'IDLE'); assert.equal(game.snapshot().infiniteStats.length, 0);
  assert.equal(game.touch('p1'), null); assert.equal(game.signal(), null);
  assert.throws(() => game.switchMode('VOICE'), /Unknown/);
});
