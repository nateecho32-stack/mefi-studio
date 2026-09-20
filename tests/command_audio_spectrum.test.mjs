import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const section = source.slice(source.indexOf("  function analyzeMusicSpectrum("), source.indexOf("  // ---------- layout / projection ----------"));
const env = vm.createContext({});
vm.runInContext(section, env);
const analyze = env.analyzeMusicSpectrum;
const features = ["bass", "mid", "treble", "energy", "beat", "kick", "snare", "hat", "bassline"];

function spectrum(ranges = [], sampleRate = 48000, fftSize = 2048) {
  const data = new Float32Array(fftSize / 2).fill(-Infinity);
  for (let index = 1; index < data.length; index++) {
    const hz = index * sampleRate / fftSize;
    for (const [from, to, db] of ranges) if (hz >= from && hz < to) data[index] = db;
  }
  return data;
}

function frame(data, previous, at, options = {}) {
  return analyze(data, options.sampleRate ?? 48000, data.length * 2, previous, at, { decibels: true, ...options });
}

function settle(data, { previous = null, start = 0, duration = 1200, step = 1000 / 60, ...options } = {}) {
  let result = previous;
  for (let at = start; at <= start + duration + 0.01; at += step) result = frame(data, result, at, options);
  return result;
}

test("each frequency range stays responsive across quiet and loud inputs and sample rates", () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const [name, range] of [["bass", [55, 200]], ["mid", [500, 3000]], ["treble", [6000, 12000]]]) {
      let loud;
      for (const db of [-12, -35, -60, -80]) {
        const result = settle(spectrum([[...range, db]], sampleRate), { sampleRate });
        assert.ok(result[name] > 0.8, `${name} at ${db} dB / ${sampleRate} Hz remains visible`);
        assert.ok(result.energy > 0.5, "isolated upper bands carry energy without bass");
        for (const other of ["bass", "mid", "treble"].filter(key => key !== name)) assert.equal(result[other], 0);
        loud ??= result[name];
        assert.ok(Math.abs(result[name] - loud) < 0.02, "level adaptation preserves quiet detail");
      }
    }
  }
});

test("independent normalization preserves quiet hats and mids under a loud bassline", () => {
  const result = settle(spectrum([[50, 180, -12], [650, 2000, -40], [6000, 12000, -48]]));
  assert.ok(result.bass > 0.8);
  assert.ok(result.mid > 0.8);
  assert.ok(result.treble > 0.8);
  const reduced = settle(spectrum([[50, 180, -80], [650, 2000, -80], [6000, 12000, -80]]), { previous: result, start: 1217, duration: 3000 });
  for (const name of ["bass", "mid", "treble"]) assert.ok(reduced[name] > 0.58, `${name} recovers after a large playback level drop`);
});

test("sub-bass reaches the first audible FFT bin instead of being excluded below 35 Hz", () => {
  for (const [sampleRate, fftSize] of [[44100, 2048], [48000, 2048], [96000, 4096]]) {
    const result = settle(spectrum([[20, 32, -70]], sampleRate, fftSize), { sampleRate });
    assert.ok(result.bass > 0.8, `low bass is visible at ${sampleRate} Hz`);
    assert.ok(result.bassline > 0.8);
    assert.equal(result.mid, 0);
    assert.equal(result.treble, 0);
  }
});

test("low, mid and high attacks produce separate rhythmic cues without requiring bass", () => {
  for (const db of [-12, -80]) {
    for (const [cue, range] of [["kick", [55, 200]], ["snare", [500, 3000]], ["hat", [6000, 12000]]]) {
      let result = frame(spectrum(), null, 1000);
      result = frame(spectrum([[...range, db]]), result, 1033);
      assert.ok(result[cue] > 0.65, `${cue} reads an attack at ${db} dB`);
      assert.ok(result.beat > 0.65);
      for (const other of ["kick", "snare", "hat"].filter(key => key !== cue)) assert.equal(result[other], 0);
      result = settle(spectrum(), { previous: result, start: 1066, duration: 450 });
      result = frame(spectrum([[...range, db]]), result, 1550);
      assert.equal(result.lastBeat, 1550, "the next percussion hit retriggers");
      assert.ok(result[cue] > 0.65);
    }
  }
});

test("sustained bass stays present without invented drums, and moving notes produce fresh spectral attacks", () => {
  const held = spectrum([[70, 130, -65]]);
  const first = frame(held, null, 1000);
  const result = settle(held, { previous: first, start: 1017, duration: 2000 });
  assert.equal(result.lastBeat, 1000);
  assert.ok(result.bassline > 0.8);
  assert.ok(result.kick < 0.001);
  assert.ok(result.beat < 0.001);
  const moved = frame(spectrum([[155, 210, -65]]), result, 3050);
  assert.equal(moved.lastBeat, 3050, "positive spectral change detects a new note at the same volume");
  assert.ok(moved.kick > 0.5);
});

test("silence, sub-floor noise and faint FFT leakage remain still and envelopes decay", () => {
  for (const data of [spectrum(), new Float32Array(1024).fill(-120), new Float32Array(1024).fill(-Infinity)]) {
    const result = settle(data);
    for (const key of features) assert.equal(result[key], 0, `${key} does not amplify silence`);
  }
  const sine = settle(spectrum([[50, 150, -20], [300, 4000, -85], [5000, 14000, -95]]));
  assert.ok(sine.bass > 0.8);
  assert.equal(sine.mid, 0);
  assert.equal(sine.treble, 0);
  const quiet = settle(spectrum(), { previous: sine, start: 1220, duration: 3000 });
  for (const key of features) assert.ok(quiet[key] < 0.001, `${key} decays when sound stops`);
});

test("waveform retains signed audio shape at quiet levels, stays bounded and returns to rest", () => {
  const responses = [];
  for (const amplitude of [0.8, 0.0001]) {
    const samples = Float32Array.from({ length: 2048 }, (_, index) => Math.sin(index * Math.PI * 6 / 2048) * amplitude);
    const result = settle(spectrum([[55, 180, 20 * Math.log10(amplitude)]]), { waveform: samples });
    assert.equal(result.waveform.length, 64);
    assert.ok(Math.min(...result.waveform) < -0.85);
    assert.ok(Math.max(...result.waveform) > 0.85);
    assert.ok(result.waveform.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
    responses.push(result.waveform);
    const quiet = settle(spectrum(), { previous: result, start: 1220, duration: 1000, waveform: new Float32Array(2048) });
    assert.ok(quiet.waveform.every(value => Math.abs(value) < 0.001));
  }
  assert.ok(responses[0].every((value, index) => Math.abs(value - responses[1][index]) < 0.001));
});

test("quiet real playback waveform survives FFT window attenuation below -100 dB per bin", () => {
  // The isolated Electron fixture measured a 0.000074 peak waveform but a
  // -106.96 dB strongest FFT bin for its very quiet drum/bass/high mixture.
  const waveform = Float32Array.from({ length: 2048 }, (_, index) => Math.sin(index / 32) * 0.000074);
  const data = spectrum([[70, 180, -107], [650, 2500, -115], [6000, 12000, -119]]);
  const result = settle(data, { waveform });
  for (const name of ["bass", "mid", "treble"]) assert.ok(result[name] > 0.8, `${name} uses source level instead of rejecting attenuated FFT bins`);
  assert.ok(result.energy > 0.8);
  const first = frame(data, null, 1000, { waveform });
  assert.ok(first.kick > 0.65 && first.snare > 0.65 && first.hat > 0.65);
  const silent = settle(data, { waveform: new Float32Array(2048) });
  for (const key of features) assert.equal(silent[key], 0, "a silent source cannot amplify stale FFT residue");
});

test("response envelopes remain consistent at 30, 60 and 120 frames per second", () => {
  const results = [30, 60, 120].map(rate => {
    const dt = 1000 / rate;
    const held = settle(spectrum([[60, 180, -72], [6000, 12000, -72]]), { duration: 1000, step: dt });
    return settle(spectrum(), { previous: held, start: 1000 + dt, duration: 300 - dt, step: dt });
  });
  for (const key of features) {
    const values = results.map(result => result[key]);
    assert.ok(Math.max(...values) - Math.min(...values) < 0.015, `${key} uses elapsed time`);
  }
});

test("real analyzer path reads floats and time samples, then ignores stale FFT data while paused", () => {
  let reads = 0, timeReads = 0;
  const data = spectrum([[70, 160, -80]]);
  const state = {
    reactive: true, localAudio: { element: { paused: false } }, audio: { sampleRate: 48000 }, bands: {},
    analyser: { frequencyBinCount: 1024, fftSize: 2048,
      getFloatFrequencyData(target) { reads++; target.set(data); },
      getFloatTimeDomainData(target) { timeReads++; for (let index = 0; index < target.length; index++) target[index] = Math.sin(index / 32) * 0.0001; },
      getByteFrequencyData() { assert.fail("float input must not be quantized to bytes"); },
    },
  };
  let now = 1000;
  const context = vm.createContext({ state, renderMusicStatus() {}, Date: { now: () => now } });
  vm.runInContext(section, context);
  for (let count = 0; count < 60; count++, now += 17) context.audioEnergy();
  assert.ok(state.music.bass > 0.8);
  assert.ok(Math.max(...state.music.waveform) > 0.5);
  const previousReads = reads;
  state.localAudio.element.paused = true;
  for (let count = 0; count < 180; count++, now += 17) context.audioEnergy();
  assert.equal(reads, previousReads);
  assert.equal(timeReads, previousReads);
  assert.ok(state.music.energy < 0.001);
  assert.ok(state.music.waveform.every(value => Math.abs(value) < 0.001));
  state.localAudio.element.paused = false;
  context.audioEnergy();
  assert.ok(state.music.kick > 0.5, "resume reads the source again");
});
