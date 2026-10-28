'use strict';

// Online play owns its audio session. Keep the original same-phone game's
// oscillator/player implementation and saved preferences independent.
const TYPES = ['start', 'go', 'false', 'win', 'test'];
const REQUIRED = ['start', 'go'];

function createOnlineDuelAudio(platform, options) {
  const api = platform || {}, opt = options || {};
  const later = opt.setTimeout || setTimeout, clear = opt.clearTimeout || clearTimeout;
  const timeoutMs = opt.timeoutMs || 4000;
  const base = (opt.assetBase || '/assets/duel-audio').replace(/\/$/, '');
  const players = new Map(), timers = new Set();
  let enabled = opt.enabled !== false, active = false, disposed = false, generation = 0, preparing = null;
  let policy = null, policyPromise = Promise.resolve(true), policyFinish = null;
  function attempt(fn) { try { return fn(); } catch (_) { return undefined; } }
  function timeout(fn) { const id = later(() => { timers.delete(id); fn(); }, timeoutMs); timers.add(id); return id; }
  function cancel(id) { if (id !== undefined) { clear(id); timers.delete(id); } }
  function audioFailure() {
    if (!disposed && active && enabled && opt.onFailure) opt.onFailure('手机提示音播放中断，请试听成功后重新准备。');
  }
  function setPolicy() {
    const obey = !active || !enabled;
    if (disposed || policy === obey) return policyPromise;
    if (policyFinish) policyFinish(false);
    policy = obey;
    if (typeof api.setInnerAudioOption !== 'function') return policyPromise = Promise.resolve(true);
    // Modern WeChat ignores per-player obeyMuteSwitch. Only change this option
    // while this page owns the session, and restore its existing app default on
    // hide/dispose. Other audio options (mixing/speaker routing) are untouched.
    if (obey) {
      // Restoring the baseline on hide must not leave a timer running.
      attempt(() => api.setInnerAudioOption({ obeyMuteSwitch: true }));
      return policyPromise = Promise.resolve(true);
    }
    policyPromise = new Promise(resolve => {
      let done = false;
      const finish = ok => { if (done) return; done = true; cancel(timer); policyFinish = null; if (!ok && policy === obey) policy = null; resolve(ok); };
      const timer = timeout(() => finish(false));
      policyFinish = finish;
      try { api.setInnerAudioOption({ obeyMuteSwitch: obey, success: () => {
        const noLongerActive = !active || !enabled || disposed;
        // The platform callback can arrive after this page has hidden. Reapply
        // the baseline so a late native option update cannot affect the next page.
        if (noLongerActive) attempt(() => api.setInnerAudioOption({ obeyMuteSwitch: true }));
        finish(!noLongerActive);
      }, fail: () => finish(false) }); }
      catch (_) { finish(false); }
    });
    return policyPromise;
  }
  function player(type) {
    if (players.has(type)) return players.get(type);
    if (disposed || typeof api.createInnerAudioContext !== 'function') return null;
    // The ordinary native implementation supports setInnerAudioOption on iOS.
    // Two packaged cues are warmed before each player's ready is transmitted.
    let context;
    try { context = api.createInnerAudioContext({ useWebAudioImplement: false }); } catch (_) { return null; }
    if (!context || typeof context.play !== 'function' || typeof context.onPlay !== 'function' || typeof context.onError !== 'function') {
      if (context && context.destroy) attempt(() => context.destroy()); return null;
    }
    const entry = { context, warmed: false, playing: false, invoking: false, pending: null };
    players.set(type, entry);
    context.onPlay(() => {
      if (entry.pending) { entry.warmed = true; entry.pending.finish(true); }
      else if (!entry.playing || disposed || !active || !enabled) attempt(() => context.stop());
    });
    context.onError(() => {
      const playing = entry.playing;
      entry.warmed = false; entry.playing = false;
      if (entry.pending) entry.pending.finish(false);
      else if (playing && !entry.invoking) audioFailure();
    });
    if (context.onEnded) context.onEnded(() => { entry.playing = false; });
    try {
      context.autoplay = false; context.loop = false; context.obeyMuteSwitch = false;
      context.volume = 1; context.startTime = 0; context.src = base + '/' + type + '.wav';
    } catch (_) { players.delete(type); attempt(() => context.destroy()); return null; }
    return entry;
  }
  function warm(type) {
    const entry = player(type);
    if (!entry) return Promise.resolve(false);
    if (entry.pending) return entry.pending.promise;
    const context = entry.context;
    let finish, timer;
    const promise = new Promise(resolve => {
      let done = false;
      finish = ok => {
        if (done) return; done = true; cancel(timer); entry.pending = null;
        // Native stop can finish asynchronously. Keep the warm-up silent until
        // play() explicitly raises the volume at the scheduled audible cue.
        entry.playing = false; attempt(() => context.stop()); attempt(() => { context.volume = 0; });
        if (!ok) entry.warmed = false;
        resolve(ok);
      };
    });
    entry.pending = { promise, finish };
    timer = timeout(() => finish(false));
    try { context.stop(); context.volume = 0; context.play(); } catch (_) { finish(false); }
    return promise;
  }
  function stop(cancelPreparation = true) {
    if (cancelPreparation) { generation += 1; preparing = null; }
    for (const entry of players.values()) {
      if (entry.pending && !cancelPreparation) continue;
      entry.playing = false;
      if (entry.pending) entry.pending.finish(false);
      attempt(() => entry.context.stop());
    }
  }
  function interrupt() {
    const wasPlaying = [...players.values()].some(entry => entry.playing);
    stop(); for (const entry of players.values()) entry.warmed = false;
    if (wasPlaying) audioFailure();
  }
  if (typeof api.onAudioInterruptionBegin === 'function') api.onAudioInterruptionBegin(interrupt);
  function unlock() { if (!disposed) REQUIRED.forEach(player); }
  function prepare() {
    if (disposed || !active) return Promise.resolve(false);
    if (!enabled) return Promise.resolve(true);
    if (preparing) return preparing;
    const expected = generation;
    // Start the muted plays synchronously inside this phone's ready gesture.
    const work = Promise.all([setPolicy(), ...REQUIRED.map(warm)]).then(results => expected === generation && active && !disposed && results.every(Boolean));
    preparing = work;
    work.then(() => { if (preparing === work) preparing = null; });
    return work;
  }
  function play(type) {
    if (disposed || !active || !TYPES.includes(type)) return false;
    if (!enabled) return true; // An explicit online mute opts into visual cues.
    const entry = player(type);
    if (!entry || REQUIRED.includes(type) && !entry.warmed) return false;
    try {
      entry.context.stop(); entry.context.volume = 1; entry.playing = true;
      entry.invoking = true; entry.context.play(); entry.invoking = false;
      return entry.playing;
    } catch (_) { entry.invoking = false; entry.playing = false; entry.warmed = false; return false; }
  }
  function activate() { if (disposed) return; active = true; setPolicy(); unlock(); }
  function deactivate() { active = false; stop(); setPolicy(); }
  function dispose() {
    if (disposed) return;
    deactivate(); disposed = true;
    if (api.offAudioInterruptionBegin) api.offAudioInterruptionBegin(interrupt);
    for (const entry of players.values()) attempt(() => entry.context.destroy());
    players.clear();
  }
  return { unlock, prepare, play, stop, activate, deactivate, dispose,
    setEnabled(value) { enabled = !!value; if (!enabled) stop(); setPolicy(); }
  };
}

module.exports = { createOnlineDuelAudio };
