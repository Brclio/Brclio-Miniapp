// Only explicit business data schemas may cross into the Data repository.
// Account/session credentials and ReadyGo rewards never enter this document.
const encoder = new TextEncoder();
export const MAX_SYNC_REQUEST_BYTES = 256 * 1024;
const MAX_ENTRY_BYTES = 200 * 1024;
const MAX_DOCUMENT_BYTES = 768 * 1024;
const MAX_COUNT = 1000000;
const DAY = 86400000;
export const SYNC_KEYS = Object.freeze([
  'brclio.duel.v1', 'RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME',
  'RGD_MAX_WAIT', 'RGD_TITLE_TS', 'RGD_SOUND_ENABLED',
  'lingotiles.progress.v1', 'lingotiles.preferences.v1',
  'lingotiles.native.reduce-motion.v1', 'lingotiles.history.v1',
  'brclio.nursery-favorites.v1'
]);
const allowedKeys = new Set(SYNC_KEYS);
const privateField = /^(?:__proto__|prototype|constructor|password|passwordPlaintext|passwd|pwd|token|access[_-]?token|refresh[_-]?token|secret|credential(?:s)?|session|session[_-]?key|openid|unionid|authorization|cookie|private[_-]?key|.*reward.*|.*password.*|彩头|密码)$/i;

export class SyncDataError extends Error {
  constructor(status = 400, code = 'invalid_sync_data') { super(code); this.status = status; this.code = code; }
}
function ensure(value, status = 400, code = 'invalid_sync_data') { if (!value) throw new SyncDataError(status, code); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value, allowed, required = []) {
  ensure(record(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)));
}
function text(value, max = 200, empty = false) { return typeof value === 'string' && value.length <= max && (empty || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value); }
function integer(value, min = 0, max = MAX_COUNT) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function number(value, min = 0, max = MAX_COUNT) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function stamp(value) { return integer(value, 0, Number.MAX_SAFE_INTEGER); }
function tree(value, depth = 0, budget = { nodes: 0 }) {
  ensure(depth <= 10 && ++budget.nodes <= 30000);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { ensure(Number.isFinite(value)); return; }
  if (typeof value === 'string') { ensure(value.length <= MAX_ENTRY_BYTES && !/[\u0000-\u001f\u007f]/.test(value)); return; }
  ensure(typeof value === 'object');
  ensure(Object.keys(value).length <= 10000);
  for (const [key, item] of Object.entries(value)) {
    ensure(!privateField.test(key), 400, 'sync_private_data_forbidden');
    tree(item, depth + 1, budget);
  }
}
function names(value) { return Array.isArray(value) && value.length === 2 && value.every(name => text(name, 200, true)); }
function duel(value) {
  fields(value, ['targetScore', 'haptics', 'soundEnabled', 'names', 'matches']);
  ensure(Object.keys(value).length > 0);
  if (Object.hasOwn(value, 'targetScore')) ensure([1, 3, 5].includes(value.targetScore));
  for (const key of ['haptics', 'soundEnabled']) if (Object.hasOwn(value, key)) ensure(typeof value[key] === 'boolean');
  if (Object.hasOwn(value, 'names')) ensure(names(value.names));
  if (!Object.hasOwn(value, 'matches')) return;
  ensure(Array.isArray(value.matches) && value.matches.length <= 20);
  for (const item of value.matches) {
    fields(item, ['id', 'at', 'winner', 'scores', 'bestMs', 'names'], ['id', 'at', 'winner', 'scores', 'bestMs', 'names']);
    ensure(text(item.id) && stamp(item.at) && [0, 1].includes(item.winner) && names(item.names) &&
      Array.isArray(item.scores) && item.scores.length === 2 && item.scores.every(score => integer(score)) &&
      (item.bestMs === null || number(item.bestMs, 0, 86400000)));
  }
}
function wordIds(value) {
  return Array.isArray(value) && value.length <= 10000 && value.every(id => text(id) && /^(?:dict:)?[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’()&/+_-]*$/u.test(id));
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function progress(value) {
  fields(value, ['completed', 'seen', 'saved', 'sessions', 'lastPlayed', 'streak', 'lastResultId'], ['completed', 'seen', 'saved', 'sessions', 'lastPlayed', 'streak']);
  ensure(record(value.completed) && Object.keys(value.completed).length <= 5000 && wordIds(value.seen) && wordIds(value.saved) &&
    integer(value.sessions) && integer(value.streak) && (value.lastPlayed === null || day(value.lastPlayed)) &&
    (!Object.hasOwn(value, 'lastResultId') || text(value.lastResultId)));
  for (const [id, result] of Object.entries(value.completed)) {
    ensure(/^\d{1,6}$/.test(id) && integer(Number(id), 1, 160000));
    fields(result, ['stars', 'bestScore', 'bestTime'], ['stars', 'bestScore', 'bestTime']);
    ensure(integer(result.stars, 1, 3) && integer(result.bestScore) && integer(result.bestTime, 0, 86400));
  }
}
function completion(item) {
  const required = ['id', 'levelId', 'levelTitle', 'mode', 'wordCount', 'gameSeconds', 'studySeconds', 'totalSeconds', 'score', 'stars', 'assists', 'completedAt'];
  fields(item, [...required, 'stageId', 'stageTitle', 'round'], required);
  ensure(text(item.id) && (integer(item.levelId, 1) || text(item.levelId)) && text(item.levelTitle) && ['theme', 'curriculum'].includes(item.mode) &&
    ['stageId', 'stageTitle'].every(key => !Object.hasOwn(item, key) || text(item[key])) &&
    (!Object.hasOwn(item, 'round') || integer(item.round, 1)) && integer(item.wordCount, 1) && integer(item.score) && integer(item.stars, 1, 3) && integer(item.assists) &&
    ['gameSeconds', 'studySeconds', 'totalSeconds'].every(key => number(item[key], 0, 10 * DAY / 1000)) &&
    Math.abs(item.totalSeconds - item.gameSeconds - item.studySeconds) <= 0.001 && text(item.completedAt, 40) && Number.isFinite(Date.parse(item.completedAt)));
}
function valueFor(key, value) {
  if (value === null) return; // A timestamped tombstone prevents deleted settings reappearing.
  if (key === 'brclio.duel.v1') return duel(value);
  if (['RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME'].includes(key)) { ensure(text(value, 200, true)); return; }
  if (key === 'RGD_MAX_WAIT') { ensure(number(value, 3, 10)); return; }
  if (key === 'RGD_TITLE_TS') { ensure(stamp(value)); return; }
  if (['RGD_SOUND_ENABLED', 'lingotiles.native.reduce-motion.v1'].includes(key)) { ensure(typeof value === 'boolean'); return; }
  if (key === 'lingotiles.progress.v1') return progress(value);
  if (key === 'brclio.nursery-favorites.v1') {
    fields(value, ['favorites'], ['favorites']);
    ensure(Array.isArray(value.favorites) && value.favorites.length <= 1000 &&
      value.favorites.every(id => typeof id === 'string' && /^\d{1,20}$/.test(id)) &&
      new Set(value.favorites).size === value.favorites.length);
    return;
  }
  if (key === 'lingotiles.preferences.v1') { fields(value, ['matchAnimation']); ensure(Object.values(value).every(item => typeof item === 'boolean')); return; }
  if (key === 'lingotiles.history.v1') {
    ensure(Array.isArray(value) && value.length <= 200);
    const ids = new Set();
    for (const item of value) { completion(item); ensure(!ids.has(item.id)); ids.add(item.id); }
    return;
  }
  throw new SyncDataError(400, 'sync_key_forbidden');
}
function entries(value, maximumStamp) {
  ensure(record(value) && Object.keys(value).length <= SYNC_KEYS.length);
  for (const [key, entry] of Object.entries(value)) {
    ensure(allowedKeys.has(key), 400, 'sync_key_forbidden');
    fields(entry, ['value', 'updatedAt'], ['value', 'updatedAt']);
    ensure(stamp(entry.updatedAt) && entry.updatedAt <= maximumStamp);
    ensure(encoder.encode(JSON.stringify(entry.value)).length <= MAX_ENTRY_BYTES, 413, 'sync_data_too_large');
    tree(entry.value);
    valueFor(key, entry.value);
  }
}
export function validateSyncPatch(value, now) {
  fields(value, ['revision', 'entries'], ['revision', 'entries']);
  ensure(integer(value.revision, 0, Number.MAX_SAFE_INTEGER - 1));
  entries(value.entries, now + DAY);
  return value;
}
export function readSyncDocument(document) {
  if (document === null) return { revision: 0, entries: {} };
  try {
    fields(document, ['schemaVersion', 'revision', 'updatedAt', 'entries'], ['schemaVersion', 'revision', 'updatedAt', 'entries']);
    ensure(document.schemaVersion === 1 && stamp(document.updatedAt) && integer(document.revision, 0, Number.MAX_SAFE_INTEGER));
    entries(document.entries, Number.MAX_SAFE_INTEGER);
    return { revision: document.revision, entries: document.entries };
  } catch { throw new SyncDataError(503, 'sync_unavailable'); }
}
export function mergeSyncPatch(current, patch, now) {
  const merged = { ...current.entries };
  let changed = false;
  for (const [key, entry] of Object.entries(patch.entries)) {
    const previous = merged[key];
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      if (JSON.stringify(previous) !== JSON.stringify(entry)) { merged[key] = entry; changed = true; }
    }
  }
  if (!changed) return null;
  const document = { schemaVersion: 1, revision: current.revision + 1, updatedAt: now, entries: merged };
  ensure(encoder.encode(JSON.stringify(document)).length <= MAX_DOCUMENT_BYTES, 413, 'sync_data_too_large');
  return document;
}
