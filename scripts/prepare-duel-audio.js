#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const SAMPLE_RATE = 48000;
const DURATIONS = { start: 0.1, go: 0.3, false: 0.3, win: 0.6, test: 0.5 };

// Band-limited periodic waves avoid aliasing in the native WAV fallback.
// The primary playback path uses the original Web Audio oscillators directly.
function periodic(wave, cycles, frequency) {
  const phase = 2 * Math.PI * cycles;
  if (wave === 'sine') return Math.sin(phase);
  let sum = 0;
  const harmonics = Math.floor((SAMPLE_RATE / 2 - 1) / frequency);
  for (let n = 1; n <= harmonics; n += wave === 'sawtooth' ? 1 : 2) {
    if (wave === 'triangle') sum += Math.pow(-1, (n - 1) / 2) * Math.sin(n * phase) / (n * n);
    else if (wave === 'square') sum += Math.sin(n * phase) / n;
    else sum += (n % 2 ? 1 : -1) * Math.sin(n * phase) / n;
  }
  return sum * (wave === 'triangle' ? 8 / (Math.PI * Math.PI) : wave === 'square' ? 4 / Math.PI : 2 / Math.PI);
}

function envelope(peak, at, duration, linear) {
  return linear ? peak + (0.01 - peak) * at / duration : peak * Math.pow(0.01 / peak, at / duration);
}

function sample(type, time) {
  if (type === 'start') {
    const rate = Math.log(2) / 0.1;
    const cycles = 440 * (Math.exp(rate * time) - 1) / rate;
    return Math.sin(2 * Math.PI * cycles) * envelope(0.3, time, 0.1);
  }
  if (type === 'win') {
    return [523.25, 659.25, 783.99].reduce(function (value, frequency, i) {
      const at = time - i * 0.1;
      return value + (at >= 0 && at < 0.4 ? Math.sin(2 * Math.PI * frequency * at) * envelope(0.2, at, 0.4) : 0);
    }, 0);
  }
  const frequency = type === 'go' ? 880 : type === 'false' ? 150 : 440;
  const wave = type === 'go' ? 'square' : type === 'false' ? 'sawtooth' : 'triangle';
  return periodic(wave, time * frequency, frequency) * envelope(0.5, time, DURATIONS[type], type !== 'go');
}

function renderWav(type) {
  if (!Object.hasOwn(DURATIONS, type)) throw new Error('Unknown ReadyGoDuel sound');
  const frames = Math.round(DURATIONS[type] * SAMPLE_RATE);
  const output = Buffer.alloc(44 + frames * 2);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24); output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(type, i / SAMPLE_RATE))) * 32767), 44 + i * 2);
  return output;
}

function prepareDuelAudio() {
  const folders = ['minigame/assets/duel-audio', 'miniprogram/assets/duel-audio'];
  folders.forEach(function (folder) { fs.mkdirSync(path.join(root, folder), { recursive: true }); });
  Object.keys(DURATIONS).forEach(function (type) {
    const bytes = renderWav(type);
    folders.forEach(function (folder) {
      const target = path.join(root, folder, type + '.wav');
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) fs.writeFileSync(target, bytes);
    });
  });
}

module.exports = { prepareDuelAudio, renderWav, SAMPLE_RATE, DURATIONS };
if (require.main === module) { prepareDuelAudio(); console.log('Prepared the five local ReadyGoDuel sound fallbacks.'); }
