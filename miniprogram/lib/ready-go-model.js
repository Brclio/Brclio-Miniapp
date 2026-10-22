'use strict';

const { REWARD_POOLS, RANDOM_REWARDS, CATEGORY_LABELS, RANDOM_TITLES, RANDOM_PLAYER_NAMES } = require('./ready-go-data');
const TTL = 7 * 24 * 60 * 60 * 1000;
const KEYS = { title: 'RGD_CUSTOM_TITLE', p1Name: 'RGD_P1_NAME', p2Name: 'RGD_P2_NAME', maxWait: 'RGD_MAX_WAIT', settingsAt: 'RGD_TITLE_TS', custom: 'RGD_CUSTOM_REWARDS', customAt: 'RGD_CUSTOM_TS' };
const MODES = ['TOUCH', 'INFINITE'];
const copy = (value) => JSON.parse(JSON.stringify(value));

function createReadyGo(options) {
  const opt = options || {};
  const storage = opt.storage || {};
  const now = opt.now || Date.now;
  const random = opt.random || Math.random;
  let state = {
    gameState: 'IDLE', gameMode: 'TOUCH', winner: null, winReason: null,
    reactionTime: 0, soundEnabled: true,
    customTitle: '', p1Name: '', p2Name: '', maxWaitTime: 6,
    rewardCategory: 'ALL', customRewards: [], p1Reward: '', p2Reward: '',
    p1Masked: false, p2Masked: false, p1InputType: 'text', p2InputType: 'text',
    p1Password: '123456', p2Password: '123456', isRewardRevealed: false,
    infiniteStats: [], gameHistory: [], roundStartedAt: 0, signalAt: 0
  };
  function read(key) { try { return storage.getStorageSync && storage.getStorageSync(key); } catch (_) { return null; } }
  function write(key, value) { try { if (storage.setStorageSync) storage.setStorageSync(key, value); } catch (_) {} }
  function remove(key) { try { if (storage.removeStorageSync) storage.removeStorageSync(key); } catch (_) {} }
  const stamp = Number(read(KEYS.settingsAt));
  if (stamp && now() - stamp < TTL) {
    ['title', 'p1Name', 'p2Name'].forEach((key) => { state[key === 'title' ? 'customTitle' : key] = String(read(KEYS[key]) || ''); });
  } else if (stamp) {
    ['title', 'p1Name', 'p2Name', 'settingsAt'].forEach((key) => remove(KEYS[key]));
  }
  const maxWait = Number(read(KEYS.maxWait));
  if (maxWait >= 3) state.maxWaitTime = Math.max(3, Math.min(10, maxWait));
  const soundEnabled = read('RGD_SOUND_ENABLED');
  if (typeof soundEnabled === 'boolean') state.soundEnabled = soundEnabled;
  const customStamp = Number(read(KEYS.customAt));
  if (customStamp && now() - customStamp < TTL) {
    try { const items = read(KEYS.custom); const list = typeof items === 'string' ? JSON.parse(items) : items; if (Array.isArray(list)) state.customRewards = list.filter((item) => typeof item === 'string' && item.trim()); } catch (_) {}
  } else if (customStamp) { remove(KEYS.custom); remove(KEYS.customAt); }

  function snapshot() {
    const value = copy(state);
    value.p1Display = state.p1Name || 'P1 红方';
    value.p2Display = state.p2Name || 'P2 蓝方';
    value.winnerName = state.winner === 'p1' ? state.p1Name || '红方' : state.p2Name || '蓝方';
    value.winnerReward = state.winner === 'p1' ? state.p1Reward : state.p2Reward;
    value.p1Wins = state.infiniteStats.filter((round) => round.winner === 'p1').length;
    value.p2Wins = state.infiniteStats.filter((round) => round.winner === 'p2').length;
    value.categories = Object.keys(CATEGORY_LABELS).filter((key) => key !== 'CUSTOM' || state.customRewards.length).map((key) => ({ key, label: CATEGORY_LABELS[key] }));
    value.infiniteStats = value.infiniteStats.map((round) => Object.assign(round, { name: round.winner === 'p1' ? state.p1Name || '红方' : state.p2Name || '蓝方' }));
    value.modeLabel = state.gameMode === 'INFINITE' ? '无限模式' : '触摸模式';
    value.heading = state.customTitle || (state.gameMode === 'INFINITE' ? '无限世界挑战' : '双人反应对决');
    return value;
  }
  function pool() { return state.rewardCategory === 'CUSTOM' ? state.customRewards.length ? state.customRewards : RANDOM_REWARDS : REWARD_POOLS[state.rewardCategory] || RANDOM_REWARDS; }
  function pick(items) { return items[Math.min(items.length - 1, Math.floor(random() * items.length))]; }
  function switchMode(mode) {
    if (!MODES.includes(mode)) throw new TypeError('Unknown ReadyGoDuel mode');
    Object.assign(state, { gameMode: mode, gameState: 'IDLE', winner: null, winReason: null, isRewardRevealed: false, infiniteStats: [], gameHistory: [] });
    return snapshot();
  }
  function settings(value) {
    state.customTitle = String(value.title || '').trim();
    state.p1Name = String(value.p1 || '').trim();
    state.p2Name = String(value.p2 || '').trim();
    state.maxWaitTime = Math.max(3, Math.min(10, Number(value.maxWait) || 6));
    [['title', state.customTitle], ['p1Name', state.p1Name], ['p2Name', state.p2Name]].forEach(([key, text]) => text ? write(KEYS[key], text) : remove(KEYS[key]));
    write(KEYS.maxWait, state.maxWaitTime); write(KEYS.settingsAt, now());
    return snapshot();
  }
  function importRewards(text) {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('文件内容为空或格式不正确');
    state.customRewards = lines; write(KEYS.custom, JSON.stringify(lines)); write(KEYS.customAt, now());
    return snapshot();
  }
  function updateReward(player, value) { validatePlayer(player); state[player + 'Reward'] = String(value || ''); return snapshot(); }
  function validatePlayer(player) { if (player !== 'p1' && player !== 'p2') throw new TypeError('Unknown player'); }
  function randomReward(player) { validatePlayer(player); state[player + 'Reward'] = pick(pool()); state[player + 'Masked'] = false; state[player + 'InputType'] = 'text'; return snapshot(); }
  function lock(player) { validatePlayer(player); if (state[player + 'Reward'].trim()) state[player + 'Masked'] = true; return snapshot(); }
  function clear(player) { validatePlayer(player); state[player + 'Reward'] = ''; state[player + 'Masked'] = false; state[player + 'InputType'] = 'text'; return snapshot(); }
  function setPassword(player, value) { validatePlayer(player); state[player + 'Password'] = String(value); return snapshot(); }
  function checkPassword(player, value) { validatePlayer(player); return String(value) === state[player + 'Password'] ? { ok: true, content: state[player + 'Reward'] } : { ok: false }; }
  function toggleInput(player) { validatePlayer(player); state[player + 'InputType'] = state[player + 'InputType'] === 'text' ? 'password' : 'text'; return snapshot(); }
  function category(value) { if (!CATEGORY_LABELS[value]) throw new TypeError('Unknown category'); state.rewardCategory = value; return snapshot(); }
  function launch(nextRound) {
    if (nextRound) { state.p1Reward = pick(pool()); state.p2Reward = pick(pool()); }
    Object.assign(state, { gameState: 'WAITING', winner: null, winReason: null, reactionTime: 0, isRewardRevealed: false, roundStartedAt: now(), signalAt: 0, gameHistory: [{ step: 'WAITING', timestamp: 0 }] });
    if (state.p1Reward) state.p1Masked = true;
    if (state.p2Reward) state.p2Masked = true;
    return { state: snapshot(), delay: Math.floor(random() * (Math.max(3000, state.maxWaitTime * 1000) - 2000)) + 2000 };
  }
  function signal() {
    if (state.gameState !== 'WAITING') return null;
    state.signalAt = now(); state.gameState = 'GO'; state.gameHistory.push({ step: 'GO', timestamp: now() - state.roundStartedAt }); return snapshot();
  }
  function touch(player) {
    validatePlayer(player);
    if (state.gameState !== 'WAITING' && state.gameState !== 'GO') return null;
    const falseStart = state.gameState === 'WAITING';
    state.winner = falseStart ? player === 'p1' ? 'p2' : 'p1' : player;
    state.winReason = falseStart ? 'FALSE_START' : 'REACTION';
    state.reactionTime = falseStart ? 0 : Math.max(0, now() - state.signalAt);
    state.gameState = 'ENDED';
    if (state.gameMode === 'INFINITE') state.infiniteStats.push({ roundNumber: state.infiniteStats.length + 1, winner: state.winner, reward: state[state.winner + 'Reward'] || '无彩头', timestamp: now() });
    state.gameHistory.push({ step: 'END', timestamp: now() - state.roundStartedAt, triggerTimestamp: now(), signalTimestamp: state.signalAt, winner: state.winner, winReason: state.winReason, reactionTime: state.reactionTime });
    return snapshot();
  }
  function cancel() { if (state.gameState === 'WAITING' || state.gameState === 'GO') { state.gameState = 'IDLE'; state.gameHistory = []; } return snapshot(); }
  return { snapshot, switchMode, settings, importRewards, updateReward, randomReward, lock, clear, setPassword, checkPassword, toggleInput, category, launch, signal, touch, cancel,
    randomTitle: () => pick(RANDOM_TITLES), randomName: () => pick(RANDOM_PLAYER_NAMES),
    setSound(value) { state.soundEnabled = !!value; write('RGD_SOUND_ENABLED', state.soundEnabled); return snapshot(); }, reveal() { state.isRewardRevealed = true; return snapshot(); } };
}

module.exports = { createReadyGo, KEYS, TTL };
