const KEY = 'brclio.duel.v1';
const DEFAULTS = { targetScore: 3, haptics: true, names: ['红方', '蓝方'], matches: [] };

function read() {
  let value;
  try { value = wx.getStorageSync(KEY); } catch (_) { value = null; }
  if (!value || typeof value !== 'object') value = {};
  return {
    targetScore: [1, 3, 5].indexOf(value.targetScore) >= 0 ? value.targetScore : 3,
    haptics: typeof value.haptics === 'boolean' ? value.haptics : true,
    names: Array.isArray(value.names) && value.names.length === 2 ? value.names.map(function (name, i) { return typeof name === 'string' ? name.trim().slice(0, 8) || DEFAULTS.names[i] : DEFAULTS.names[i]; }) : DEFAULTS.names.slice(),
    matches: Array.isArray(value.matches) ? value.matches.filter(function (match) {
      return match && typeof match.id === 'string' && Number.isFinite(match.at) && [0, 1].indexOf(match.winner) >= 0 && Array.isArray(match.scores) && match.scores.length === 2 && match.scores.every(function (score) { return Number.isInteger(score) && score >= 0; }) && (match.bestMs === null || Number.isFinite(match.bestMs) && match.bestMs >= 0) && Array.isArray(match.names) && match.names.length === 2 && match.names.every(function (name) { return typeof name === 'string'; });
    }).slice(0, 20) : []
  };
}

function save(patch) {
  const value = Object.assign({}, read(), patch);
  try { wx.setStorageSync(KEY, value); return true; } catch (_) { return false; }
}

function recordMatch(match) {
  const current = read();
  if (current.matches.some(function (item) { return item.id === match.id; })) return true;
  return save({ matches: [match].concat(current.matches).slice(0, 20) });
}

module.exports = { read, save, recordMatch, KEY };
