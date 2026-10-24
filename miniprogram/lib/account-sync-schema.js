'use strict';

// Explicit business-data contract. Credentials, custom rewards, exports and
// downloaded media have no representation in the cloud sync protocol.
const MAX_ENTRY_BYTES = 200 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_HISTORY_RECORDS = 200;
const HISTORY_KEY = 'lingotiles.history.v1';
const NURSERY_FAVORITES_KEY = 'brclio.nursery-favorites.v1';
const NURSERY_LOCAL_KEY = 'brclio.nursery-music.v1';
const JSON_KEYS = ['lingotiles.progress.v1', 'lingotiles.preferences.v1'];
const SYNC_KEYS = ['brclio.duel.v1', 'RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME', 'RGD_MAX_WAIT', 'RGD_TITLE_TS', 'RGD_SOUND_ENABLED', 'lingotiles.progress.v1', 'lingotiles.preferences.v1', 'lingotiles.native.reduce-motion.v1', HISTORY_KEY, NURSERY_FAVORITES_KEY];
const LOCAL_ONLY_KEYS = ['RGD_CUSTOM_REWARDS', 'RGD_CUSTOM_TS', 'brclio.duel.before-restore.v1', 'lingotiles.illustrations.pending.v1', NURSERY_LOCAL_KEY];
const clone = value => JSON.parse(JSON.stringify(value));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const finite = (value, maximum = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
const text = (value, maximum = 200, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // Miniapp runtimes need not provide TextEncoder or Buffer.
  let bytes = 0;
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); if (code < 128) bytes++; else if (code < 2048) bytes += 2; else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; } else bytes += 3; }
  return bytes;
}
function parse(raw) { if (typeof raw !== 'string') return raw; try { return JSON.parse(raw); } catch (_) { return undefined; } }
function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return undefined;
  const byId = new Map();
  for (const item of raw) {
    if (!record(item) || !text(item.id) || !text(String(item.levelId)) || !text(item.levelTitle) || !['theme', 'curriculum'].includes(item.mode)) continue;
    if (typeof item.levelId !== 'string' && (!integer(item.levelId, 1000000) || item.levelId < 1)) continue;
    if (!['wordCount', 'score', 'stars', 'assists'].every(key => integer(item[key], 1000000)) || item.wordCount < 1 || item.stars < 1 || item.stars > 3) continue;
    if (!['gameSeconds', 'studySeconds', 'totalSeconds'].every(key => finite(item[key], 864000)) || Math.abs(item.totalSeconds - item.gameSeconds - item.studySeconds) > .001) continue;
    if (typeof item.completedAt !== 'string' || item.completedAt.length > 40 || !Number.isFinite(Date.parse(item.completedAt))) continue;
    if (item.round !== undefined && (!integer(item.round, 1000000) || item.round < 1)) continue;
    if (['stageId', 'stageTitle'].some(key => item[key] !== undefined && !text(item[key]))) continue;
    const value = {};
    ['id', 'levelId', 'levelTitle', 'mode', 'wordCount', 'gameSeconds', 'studySeconds', 'totalSeconds', 'score', 'stars', 'assists', 'completedAt', 'stageId', 'stageTitle', 'round'].forEach(key => { if (item[key] !== undefined) value[key] = item[key]; });
    if (!byId.has(value.id)) byId.set(value.id, value);
  }
  const result = [...byId.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id)).slice(0, MAX_HISTORY_RECORDS);
  while (result.length && byteLength(result) > MAX_ENTRY_BYTES - 1024) result.pop();
  return result;
}
function normalizeProgress(raw) {
  if (!record(raw)) return undefined;
  const completed = {};
  if (record(raw.completed)) for (const id of Object.keys(raw.completed)) {
    const value = raw.completed[id], number = Number(id);
    if (!/^\d+$/.test(id) || !integer(number) || !(number >= 1 && number <= 6 || number >= 100001 && number <= 160000) || !record(value)) continue;
    if (!integer(value.stars, 3) || value.stars < 1 || !finite(value.bestScore, 1000000) || !finite(value.bestTime, 86400)) continue;
    completed[id] = { stars: value.stars, bestScore: Math.floor(value.bestScore), bestTime: Math.floor(value.bestTime) };
  }
  const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => text(id) && /^(?:dict:)?[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’()&/+_-]*$/u.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id)))] : [];
  const day = typeof raw.lastPlayed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastPlayed) && Number.isFinite(Date.parse(raw.lastPlayed)) && new Date(raw.lastPlayed).toISOString().slice(0, 10) === raw.lastPlayed ? raw.lastPlayed : null;
  return { completed, seen: ids(raw.seen), saved: ids(raw.saved), sessions: integer(raw.sessions, 1000000) ? raw.sessions : 0, lastPlayed: day, streak: day && integer(raw.streak, 1000000) ? raw.streak : 0, ...(text(raw.lastResultId) ? { lastResultId: raw.lastResultId } : {}) };
}
function normalizeDuel(raw) {
  if (!record(raw)) return undefined;
  const result = {};
  if ([1, 3, 5].includes(raw.targetScore)) result.targetScore = raw.targetScore;
  ['haptics', 'soundEnabled'].forEach(key => { if (typeof raw[key] === 'boolean') result[key] = raw[key]; });
  if (Array.isArray(raw.names) && raw.names.length === 2 && raw.names.every(name => text(name, 200, true))) result.names = raw.names.slice();
  if (Array.isArray(raw.matches)) result.matches = raw.matches.filter(item => record(item) && text(item.id) && integer(item.at) && [0, 1].includes(item.winner) && Array.isArray(item.scores) && item.scores.length === 2 && item.scores.every(value => integer(value, 1000000)) && (item.bestMs === null || finite(item.bestMs, 86400000)) && Array.isArray(item.names) && item.names.length === 2 && item.names.every(name => text(name, 200, true))).slice(0, 20).map(item => ({ id: item.id, at: item.at, winner: item.winner, scores: item.scores.slice(), bestMs: item.bestMs, names: item.names.slice() }));
  return Object.keys(result).length ? result : undefined;
}
function normalizeValue(key, raw) {
  if (!SYNC_KEYS.includes(key)) return undefined;
  if (raw === null) return null;
  let value = JSON_KEYS.includes(key) ? parse(raw) : raw;
  if (key === 'brclio.duel.v1') value = normalizeDuel(value);
  else if (key === 'lingotiles.progress.v1') value = normalizeProgress(value);
  else if (key === 'lingotiles.preferences.v1') value = record(value) && typeof value.matchAnimation === 'boolean' ? { matchAnimation: value.matchAnimation } : undefined;
  else if (key === HISTORY_KEY) value = normalizeHistory(value);
  else if (key === NURSERY_FAVORITES_KEY) value = record(value) && Array.isArray(value.favorites) && value.favorites.length <= 1000 && value.favorites.every(id => typeof id === 'string' && /^\d{1,20}$/.test(id)) ? { favorites: [...new Set(value.favorites)] } : undefined;
  else if (['RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME'].includes(key)) value = text(value, 200, true) ? value : undefined;
  else if (key === 'RGD_MAX_WAIT') value = finite(Number(value), 10) && Number(value) >= 3 ? Number(value) : undefined;
  else if (key === 'RGD_TITLE_TS') value = integer(Number(value)) ? Number(value) : undefined;
  else value = typeof value === 'boolean' ? value : undefined;
  if (key === 'lingotiles.progress.v1' && value && (value.seen.length > 10000 || value.saved.length > 10000 || Object.keys(value.completed).length > 5000)) return undefined;
  if (value === undefined || byteLength(value) > MAX_ENTRY_BYTES) return undefined;
  return clone(value);
}
function encodeLocal(key, value, previous) {
  if (JSON_KEYS.includes(key)) return JSON.stringify(value);
  if (key === 'brclio.duel.v1' && record(previous)) return { ...previous, ...value };
  return clone(value);
}
function scopedKey(key) { return SYNC_KEYS.includes(key) || LOCAL_ONLY_KEYS.includes(key) || /^RGD_[A-Z0-9_]+$/.test(key); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function mergeEntry(key, first, second) {
  if (!first) return second && clone(second);
  if (!second) return clone(first);
  const recent = second.updatedAt >= first.updatedAt ? second : first;
  const older = recent === second ? first : second;
  if (recent.value === null || older.value === null) return clone(recent);
  let value = clone(recent.value);
  if (key === HISTORY_KEY) value = normalizeHistory([...recent.value, ...older.value]);
  else if (key === 'lingotiles.progress.v1') {
    const completed = { ...older.value.completed, ...recent.value.completed };
    for (const id of Object.keys(completed)) {
      const a = older.value.completed[id], b = recent.value.completed[id];
      if (a && b) completed[id] = { stars: Math.max(a.stars, b.stars), bestScore: Math.max(a.bestScore, b.bestScore), bestTime: Math.min(a.bestTime, b.bestTime) };
    }
    value = { ...value, completed, seen: [...new Set([...older.value.seen, ...recent.value.seen])], sessions: Math.max(older.value.sessions, recent.value.sessions) };
  } else if (key === 'brclio.duel.v1') {
    value = { ...older.value, ...recent.value };
    if (Array.isArray(recent.value.matches) && recent.value.matches.length > 0 && Array.isArray(older.value.matches)) {
    const matches = new Map();
    [...recent.value.matches, ...older.value.matches].forEach(match => { if (!matches.has(match.id)) matches.set(match.id, match); });
    value.matches = [...matches.values()].sort((a, b) => b.at - a.at).slice(0, 20);
    }
  }
  return { value, updatedAt: Math.max(first.updatedAt, second.updatedAt) };
}
module.exports = { MAX_ENTRY_BYTES, MAX_REQUEST_BYTES, MAX_HISTORY_RECORDS, HISTORY_KEY, NURSERY_FAVORITES_KEY, NURSERY_LOCAL_KEY, SYNC_KEYS, LOCAL_ONLY_KEYS, JSON_KEYS, normalizeValue, encodeLocal, scopedKey, byteLength, equal, mergeEntry };
