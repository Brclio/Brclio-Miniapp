'use strict';

// ReadyGoDuel e3efd5f3: retain the original oscillator, pitch, envelope and
// trigger sounds. Native InnerAudioContext uses the generated local WAVs when
// a complete oscillator-based Web Audio implementation is unavailable.
const SOUND_TYPES = ['start', 'go', 'false', 'win', 'test'];

function createDuelAudio(platform, options) {
  const api = platform || {};
  const opt = options || {};
  const assetBase = (opt.assetBase || 'assets/duel-audio').replace(/\/$/, '');
  let enabled = opt.enabled !== false;
  let disposed = false;
  let context = null;
  let triedContext = false;
  const players = Object.create(null);
  const nodes = new Set();

  function attempt(callback) {
    try {
      const result = callback();
      if (result && typeof result.catch === 'function') result.catch(function () {});
      return result;
    } catch (_) { return null; }
  }

  function webContext() {
    if (triedContext) return context;
    triedContext = true;
    if (typeof api.createWebAudioContext !== 'function') return null;
    const created = attempt(function () { return api.createWebAudioContext(); });
    if (created && typeof created.createOscillator === 'function' && typeof created.createGain === 'function') context = created;
    else if (created && typeof created.close === 'function') attempt(function () { return created.close(); });
    return context;
  }

  function localPlayer(type) {
    if (players[type]) return players[type];
    if (typeof api.createInnerAudioContext !== 'function') return null;
    const player = attempt(function () { return api.createInnerAudioContext({ useWebAudioImplement: true }); });
    if (!player) return null;
    player.autoplay = false;
    player.loop = false;
    player.obeyMuteSwitch = false;
    player.volume = 1;
    player.src = assetBase + '/' + type + '.wav';
    if (typeof player.onError === 'function') player.onError(function () {});
    players[type] = player;
    return player;
  }

  function unlock() {
    if (disposed) return;
    const ctx = webContext();
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') attempt(function () { return ctx.resume(); });
    if (!ctx) SOUND_TYPES.forEach(localPlayer);
  }

  function tone(ctx, wave, frequency, peak, duration, decay, delay, endFrequency) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime + (delay || 0);
    oscillator.type = wave;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(frequency, at);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    gain.gain.setValueAtTime(peak, at);
    if (decay === 'linear') gain.gain.linearRampToValueAtTime(0.01, at + duration);
    else gain.gain.exponentialRampToValueAtTime(0.01, at + duration);
    const entry = { oscillator, gain };
    nodes.add(entry);
    oscillator.onended = function () {
      nodes.delete(entry);
      attempt(function () { oscillator.disconnect(); });
      attempt(function () { gain.disconnect(); });
    };
    oscillator.start(at);
    oscillator.stop(at + duration);
  }

  function stop() {
    Object.keys(players).forEach(function (type) { attempt(function () { players[type].stop(); }); });
    nodes.forEach(function (entry) {
      attempt(function () { entry.oscillator.stop(); });
      attempt(function () { entry.oscillator.disconnect(); });
      attempt(function () { entry.gain.disconnect(); });
    });
    nodes.clear();
  }

  function play(type, mode) {
    if (disposed || !enabled || SOUND_TYPES.indexOf(type) === -1 || mode === 'VOICE' && type === 'go') return false;
    unlock();
    if (context) {
      return attempt(function () {
        if (type === 'start') tone(context, 'sine', 440, 0.3, 0.1, 'exponential', 0, 880);
        else if (type === 'go') tone(context, 'square', 880, 0.5, 0.3, 'exponential');
        else if (type === 'false') tone(context, 'sawtooth', 150, 0.5, 0.3, 'linear');
        else if (type === 'test') tone(context, 'triangle', 440, 0.5, 0.5, 'linear');
        else [523.25, 659.25, 783.99].forEach(function (frequency, i) { tone(context, 'sine', frequency, 0.2, 0.4, 'exponential', i * 0.1); });
        return true;
      }) === true;
    }
    const player = localPlayer(type);
    if (!player) return false;
    return attempt(function () { player.stop(); player.play(); return true; }) === true;
  }

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    Object.keys(players).forEach(function (type) {
      attempt(function () { players[type].destroy(); });
      delete players[type];
    });
    if (context && typeof context.close === 'function') attempt(function () { return context.close(); });
    context = null;
  }

  return { unlock, play, stop, dispose, setEnabled: function (value) { enabled = !!value; if (!enabled) stop(); } };
}

module.exports = { createDuelAudio, SOUND_TYPES };
