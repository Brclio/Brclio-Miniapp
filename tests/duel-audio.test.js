'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDuelAudio, SOUND_TYPES } = require('../minigame/lib/duel-audio');
const { renderWav, DURATIONS, SAMPLE_RATE } = require('../scripts/prepare-duel-audio');

function audioHost() {
  const notes = [];
  let resumes = 0;
  let closed = 0;
  const context = {
    currentTime: 10, destination: {}, state: 'suspended',
    resume() { resumes += 1; this.state = 'running'; return Promise.resolve(); },
    close() { closed += 1; },
    createGain() {
      const gain = { events: [], connect() {}, disconnect() {} };
      gain.gain = {};
      for (const method of ['setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime']) gain.gain[method] = (...args) => gain.events.push([method, ...args]);
      return gain;
    },
    createOscillator() {
      const note = { frequencyEvents: [], stops: [], connect(gain) { this.gain = gain; }, disconnect() {}, start(at) { this.at = at; }, stop(at) { this.stops.push(at); } };
      note.frequency = {};
      for (const method of ['setValueAtTime', 'exponentialRampToValueAtTime']) note.frequency[method] = (...args) => note.frequencyEvents.push([method, ...args]);
      notes.push(note); return note;
    }
  };
  return { notes, context, api: { createWebAudioContext() { return context; } }, get resumes() { return resumes; }, get closed() { return closed; } };
}

test('the five oscillator sounds retain the fixed original frequencies, envelopes and durations', () => {
  const h = audioHost(), audio = createDuelAudio(h.api);
  audio.play('start');
  assert.equal(h.resumes, 1);
  assert.equal(h.notes[0].type, 'sine');
  assert.deepEqual(h.notes[0].frequencyEvents, [['setValueAtTime', 440, 10], ['exponentialRampToValueAtTime', 880, 10.1]]);
  assert.deepEqual(h.notes[0].gain.events, [['setValueAtTime', 0.3, 10], ['exponentialRampToValueAtTime', 0.01, 10.1]]);
  assert.deepEqual(h.notes[0].stops, [10.1]);
  audio.play('go'); audio.play('false'); audio.play('test'); audio.play('win');
  assert.deepEqual(h.notes.slice(1, 4).map(n => [n.type, n.frequencyEvents[0][1], n.stops[0], n.gain.events[1][0]]), [
    ['square', 880, 10.3, 'exponentialRampToValueAtTime'],
    ['sawtooth', 150, 10.3, 'linearRampToValueAtTime'],
    ['triangle', 440, 10.5, 'linearRampToValueAtTime']
  ]);
  assert.deepEqual(h.notes.slice(4).map(n => [n.type, n.frequencyEvents[0][1], n.at]), [['sine', 523.25, 10], ['sine', 659.25, 10.1], ['sine', 783.99, 10.2]]);
  audio.dispose(); assert.equal(h.closed, 1);
});

test('voice suppresses only GO; mute, hide cleanup and disposal stop playback', () => {
  const h = audioHost(), audio = createDuelAudio(h.api);
  assert.equal(audio.play('go', 'VOICE'), false);
  for (const type of ['start', 'false', 'win', 'test']) assert.equal(audio.play(type, 'VOICE'), true);
  const count = h.notes.length;
  audio.setEnabled(false);
  assert.ok(h.notes.every(n => n.stops.includes(undefined)));
  assert.equal(audio.play('start'), false); assert.equal(h.notes.length, count);
  audio.setEnabled(true); assert.equal(audio.play('start'), true);
  audio.dispose(); audio.dispose();
  assert.equal(audio.play('start'), false); assert.equal(h.closed, 1);
});

test('native fallback preloads bundled sounds, replays from start and releases all contexts', () => {
  const players = [], played = [];
  const audio = createDuelAudio({ createInnerAudioContext() {
    const player = { stop() {}, play() { played.push(this.src); }, destroy() { this.destroyed = true; }, onError() {} };
    players.push(player); return player;
  } }, { assetBase: '/assets/duel-audio' });
  audio.unlock(); assert.equal(players.length, 5);
  assert.ok(players.every(p => p.autoplay === false && p.obeyMuteSwitch === false));
  audio.play('start'); audio.play('start'); audio.play('go', 'VOICE');
  assert.deepEqual(played, ['/assets/duel-audio/start.wav', '/assets/duel-audio/start.wav']);
  audio.dispose(); assert.ok(players.every(p => p.destroyed));
});

test('unsupported or failing audio cannot interrupt gameplay', () => {
  assert.equal(createDuelAudio({}).play('start'), false);
  const audio = createDuelAudio({ createWebAudioContext() { throw new Error('unsupported'); }, createInnerAudioContext() { throw new Error('unavailable'); } });
  assert.doesNotThrow(() => { audio.unlock(); audio.play('go'); audio.stop(); audio.dispose(); });
});

test('bundled native WAV fallbacks are deterministic, non-silent and have original sound lengths', () => {
  for (const type of SOUND_TYPES) {
    const bytes = renderWav(type);
    const shipped = fs.readFileSync(path.resolve(__dirname, '../miniprogram/assets/duel-audio', type + '.wav'));
    assert.ok(bytes.equals(shipped), type + ' asset must match its reproducible generator');
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(bytes.readUInt32LE(40) / 2 / SAMPLE_RATE, DURATIONS[type]);
    let peak = 0; for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    assert.ok(peak > 3000 && peak < 32767, type + ' should be audible without clipping');
  }
});
