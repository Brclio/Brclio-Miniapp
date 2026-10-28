'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnlineDuelAudio } = require('../miniprogram/lib/online-duel-audio');

function phone(options = {}) {
  let serial = 0, interruption;
  const contexts = [], timers = new Map(), policies = [], failures = [], removed = [];
  const api = {
    setInnerAudioOption(value) { policies.push(value.obeyMuteSwitch); if (value.success) options.policyFailure ? value.fail() : value.success(); },
    createInnerAudioContext(value) {
      assert.equal(value.useWebAudioImplement, false);
      const events = {}, calls = [];
      const context = {
        calls, events,
        onPlay(fn) { events.play = fn; }, onError(fn) { events.error = fn; }, onEnded(fn) { events.ended = fn; },
        play() { calls.push(['play', context.volume]); }, stop() { calls.push(['stop']); }, destroy() { calls.push(['destroy']); },
        emit(type) { events[type]({ errMsg: 'private native error must not be shown' }); }
      };
      contexts.push(context); return context;
    },
    onAudioInterruptionBegin(fn) { interruption = fn; },
    offAudioInterruptionBegin(fn) { removed.push(fn); if (fn === interruption) interruption = null; }
  };
  const audio = createOnlineDuelAudio(api, { onFailure: message => failures.push(message), timeoutMs: 4000,
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  return { audio, api, contexts, timers, policies, failures, removed,
    find(type) { return contexts.find(context => context.src.endsWith('/' + type + '.wav')); },
    prime() { for (const context of contexts) if (context.src.endsWith('/start.wav') || context.src.endsWith('/go.wav')) context.emit('play'); },
    timeout() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }, interrupt() { interruption(); } };
}

test('both phones confirm their own packaged start and GO playback before becoming ready', async () => {
  const a = phone(), b = phone();
  for (const h of [a, b]) {
    h.audio.activate();
    assert.equal(h.contexts.length, 2);
    assert.deepEqual(h.policies, [false]);
    assert.equal(h.audio.play('start'), false, 'unprepared cues must not start on a late load event');
  }
  const ap = a.audio.prepare(), bp = b.audio.prepare(); let aFinished = false;
  ap.then(() => { aFinished = true; });
  a.find('start').emit('play'); await Promise.resolve();
  assert.equal(aFinished, false, 'both required cues must work on this phone');
  a.find('go').emit('play'); b.prime();
  assert.deepEqual(await Promise.all([ap, bp]), [true, true]);
  for (const h of [a, b]) {
    for (const type of ['start', 'go']) assert.equal(h.find(type).volume, 0, 'native stop may be asynchronous, so warm-up must remain muted');
    assert.equal(h.audio.play('start'), true); assert.equal(h.audio.play('go'), true);
    for (const type of ['start', 'go']) {
      const context = h.find(type);
      assert.equal(context.src, '/assets/duel-audio/' + type + '.wav');
      assert.equal(context.autoplay, false); assert.equal(context.loop, false);
      assert.deepEqual(context.calls.filter(call => call[0] === 'play'), [['play', 0], ['play', 1]]);
    }
    assert.equal(h.timers.size, 0); h.audio.dispose();
    assert.equal(h.policies.at(-1), true); assert.equal(h.removed.length, 1);
  }
});

test('a failed or stalled cue blocks audio readiness and cannot play later at the signal', async () => {
  for (const mode of ['error', 'timeout']) {
    const h = phone(); h.audio.activate(); const prepared = h.audio.prepare();
    h.find('start').emit('play');
    if (mode === 'error') h.find('go').emit('error'); else h.timeout();
    assert.equal(await prepared, false);
    assert.equal(h.audio.play('go'), false); assert.equal(h.find('go').volume, 0);
    h.find('go').emit('play');
    assert.deepEqual(h.find('go').calls.at(-1), ['stop']);
    assert.deepEqual(h.failures, [], 'prepare failure is handled by the ready gate');
    assert.equal(h.timers.size, 0); h.audio.dispose();
  }
});

test('ready-state updates stop sound without canceling the other phone warm-up; hiding cancels it', async () => {
  const h = phone(); h.audio.activate(); const first = h.audio.prepare();
  h.audio.stop(false); h.prime(); assert.equal(await first, true);
  const next = h.audio.prepare(); h.audio.deactivate();
  assert.equal(await next, false); assert.equal(h.timers.size, 0);
  h.prime(); assert.equal(h.audio.play('start'), false);
  assert.equal(h.policies.at(-1), true);
  h.audio.activate(); const resumed = h.audio.prepare(); h.prime(); assert.equal(await resumed, true);
  h.audio.dispose(); assert.equal(h.timers.size, 0);
});

test('playback errors and system interruptions report safe failures and require another warm-up', async () => {
  const h = phone(); h.audio.activate(); let prepared = h.audio.prepare(); h.prime(); await prepared;
  h.audio.play('start'); h.find('start').emit('error');
  assert.equal(h.failures.length, 1); assert.equal(h.failures[0].includes('private'), false);
  assert.equal(h.audio.play('start'), false);
  prepared = h.audio.prepare(); h.prime(); assert.equal(await prepared, true);
  h.audio.play('go'); h.interrupt();
  assert.equal(h.failures.length, 2); assert.equal(h.audio.play('go'), false);
  prepared = h.audio.prepare(); h.prime(); assert.equal(await prepared, true);
  h.audio.deactivate(); h.find('go').emit('error');
  assert.equal(h.failures.length, 2, 'hidden-page callbacks cannot abort another page');
  h.audio.dispose();
});

test('explicit online mute uses visual cues and restores the app audio-session baseline', async () => {
  const h = phone(); h.audio.setEnabled(false); h.audio.activate();
  assert.equal(await h.audio.prepare(), true); assert.equal(h.audio.play('start'), true);
  assert.equal(h.contexts.some(context => context.calls.some(call => call[0] === 'play')), false);
  assert.deepEqual(h.policies, [true]);
  h.audio.setEnabled(true); assert.equal(h.policies.at(-1), false);
  const prepared = h.audio.prepare(); h.prime(); assert.equal(await prepared, true);
  h.audio.setEnabled(false); assert.equal(h.policies.at(-1), true);
  h.audio.dispose(); assert.equal(h.timers.size, 0);
});

test('failure applying the native audio session is recoverable through an explicit retry', async () => {
  const options = { policyFailure: true }, h = phone(options); h.audio.activate();
  let prepared = h.audio.prepare(); h.prime(); assert.equal(await prepared, false);
  options.policyFailure = false;
  prepared = h.audio.prepare(); h.prime(); assert.equal(await prepared, true);
  h.audio.dispose();
});

test('unavailable native playback cannot silently count as audio readiness', async () => {
  const h = createOnlineDuelAudio({}); h.activate();
  assert.equal(await h.prepare(), false); assert.equal(h.play('start'), false);
  h.dispose(); assert.equal(await h.prepare(), false);
});

test('late native audio-option completion after hide or dispose reapplies the original baseline', async () => {
  for (const action of ['deactivate', 'dispose']) {
    const h = phone(); let late;
    h.api.setInnerAudioOption = value => { h.policies.push(value.obeyMuteSwitch); if (value.obeyMuteSwitch === false) late = value.success; };
    h.audio.activate(); const prepared = h.audio.prepare(); h.prime();
    h.audio[action](); assert.equal(await prepared, false);
    assert.equal(h.policies.at(-1), true); late();
    assert.equal(h.policies.at(-1), true, 'late native completion must not change the next page mute policy');
    assert.equal(h.timers.size, 0); h.audio.dispose();
  }
});

test('synchronous player errors return false without triggering a duplicate asynchronous abort', async () => {
  const h = phone(); h.audio.activate(); const prepared = h.audio.prepare(); h.prime(); await prepared;
  h.find('start').play = () => h.find('start').emit('error');
  assert.equal(h.audio.play('start'), false);
  assert.equal(h.failures.length, 0, 'the transport handles this synchronous failure once');
  h.audio.dispose();
});
