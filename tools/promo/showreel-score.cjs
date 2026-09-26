// The showreel's score, synthesised here: no samples, no downloaded music.
// 150 BPM (a 0.4 s beat); the scene cuts from showreel-stage.js sit on beats
// and each one lands an impact. writeScore(file, duration, cuts) writes a
// 48 kHz stereo 16-bit WAV.
const fs = require("node:fs");

const SR = 48000, BEAT = 0.4;
function renderScore(duration, cuts) {
  const n = Math.ceil(duration * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let seed = 240925;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const add = (i, v, pan = 0) => { if (i >= 0 && i < n) { L[i] += v * Math.sqrt((1 - pan) / 2) * 1.414; R[i] += v * Math.sqrt((1 + pan) / 2) * 1.414; } };

  function kick(at, level = 0.9) {
    const s = Math.round(at * SR), len = Math.round(0.45 * SR);
    let phase = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      const f = 45 + 110 * Math.exp(-t * 28);
      phase += f / SR;
      add(s + i, Math.sin(phase * 2 * Math.PI) * Math.exp(-t * 7) * level + (i < 90 ? noise() * 0.25 * (1 - i / 90) * level : 0));
    }
  }
  function hat(at, level = 0.12, pan = 0.3, open = false) {
    const s = Math.round(at * SR), len = Math.round((open ? 0.22 : 0.05) * SR);
    let prev = 0;
    for (let i = 0; i < len; i += 1) {
      const x = noise(); const hp = x - prev; prev = x;
      add(s + i, hp * Math.exp(-(i / SR) * (open ? 14 : 70)) * level, pan);
    }
  }
  function clap(at, level = 0.35) {
    const s = Math.round(at * SR), len = Math.round(0.2 * SR);
    let lp = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.6 : 1) : 1;
      lp += (noise() - lp) * 0.35;
      add(s + i, lp * Math.exp(-t * 18) * level * burst, (i % 2 ? 0.2 : -0.2));
    }
  }
  function tone(at, hz, length, level, { attack = 0.005, decay = 3, pan = 0, harmonics = [1], detune = 0 } = {}) {
    const s = Math.round(at * SR), len = Math.round(length * SR);
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      let v = 0;
      harmonics.forEach((amp, h) => { v += amp * Math.sin(2 * Math.PI * hz * (h + 1) * t) + (detune ? amp * Math.sin(2 * Math.PI * hz * (h + 1) * (1 + detune) * t) : 0); });
      const env = Math.min(1, t / attack) * Math.exp(-t * decay) * Math.min(1, (length - t) * 8);
      add(s + i, v * env * level, pan);
    }
  }
  function swell(from, to, level = 0.25) {
    const s = Math.round(from * SR), len = Math.round((to - from) * SR);
    let lp = 0;
    for (let i = 0; i < len; i += 1) {
      const u = i / len;
      lp += (noise() - lp) * (0.02 + u * 0.4);
      add(s + i, lp * u * u * level, Math.sin(u * 9) * 0.4);
    }
  }
  function impact(at, level = 1) {
    kick(at, 0.95 * level);
    const s = Math.round(at * SR), len = Math.round(1.4 * SR);
    let lp = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      lp += (noise() - lp) * 0.5;
      add(s + i, lp * Math.exp(-t * 3.2) * 0.22 * level, (i % 3) / 3 - 0.33);
    }
    tone(at, 36.7, 1.6, 0.35 * level, { decay: 1.6, harmonics: [1, 0.3] });
  }
  const blip = (at, hz, level = 0.12, pan = 0) => tone(at, hz, 0.14, level, { decay: 26, harmonics: [1, 0.2, 0.1], pan });

  // D minor: Dm – Bb – F – C, as low pads.
  const CHORDS = [[146.83, 174.61, 220.0], [116.54, 146.83, 174.61], [174.61, 220.0, 261.63], [130.81, 164.81, 196.0]];
  const BASS = [73.42, 58.27, 87.31, 65.41];

  // 0 – 2 s: the ignition. A rising swell into a sub boom as the hub lights.
  swell(0, cuts.wall, 0.3);
  tone(0.3, 36.7, 2.2, 0.45, { attack: 0.02, decay: 1.1, harmonics: [1, 0.25] });
  kick(0.3, 0.7);
  [293.66, 440, 587.33].forEach((hz, i) => tone(0.9 + i * 0.2, hz, 1.2, 0.07, { decay: 2.5, pan: (i - 1) * 0.5, harmonics: [1, 0.3] }));

  // The groove from the word wall to the principles.
  const grooveEnd = cuts.end;
  for (let at = cuts.wall, beat = 0; at < grooveEnd - 1e-6; at += BEAT, beat += 1) {
    const bar = Math.floor(beat / 4);
    if (beat % 4 === 0) {
      const chord = CHORDS[bar % 4];
      chord.forEach((hz, i) => tone(at, hz, BEAT * 4 + 0.2, 0.05, { attack: 0.05, decay: 0.5, pan: (i - 1) * 0.6, harmonics: [1, 0.5, 0.25, 0.12], detune: 0.004 }));
    }
    kick(at, beat % 4 === 0 ? 0.85 : 0.65);
    hat(at + BEAT / 2, 0.11, 0.35);
    hat(at + BEAT / 4, 0.05, -0.35);
    hat(at + BEAT * 3 / 4, 0.05, -0.35);
    if (beat % 2 === 1) clap(at, 0.28);
    const bass = BASS[bar % 4];
    tone(at, bass, BEAT * 0.9, 0.22, { decay: 5, harmonics: [1, 0.5, 0.2] });
    tone(at + BEAT / 2, bass * 2, BEAT * 0.4, 0.07, { decay: 10, harmonics: [1, 0.4] });
  }
  // Every scene cut lands an impact; each style and each slammed word a blip.
  for (const at of [cuts.wall, cuts.tree, cuts.styles, cuts.crew, cuts.flow, cuts.slam]) impact(at, 0.8);
  for (let i = 0; i < 8; i += 1) blip(cuts.styles + i * BEAT, [587.33, 659.25, 698.46, 783.99, 880, 783.99, 698.46, 1046.5][i], 0.1, i % 2 ? 0.4 : -0.4);
  for (let i = 0; i < 4; i += 1) { impact(cuts.slam + i * BEAT, 0.6); blip(cuts.slam + i * BEAT, 220 * (i + 2), 0.08); }
  for (let i = 0; i < 4; i += 1) blip(cuts.wall + i * BEAT, 440 * (1 + i * 0.25), 0.07, 0.2);
  // A riser into the end card.
  swell(cuts.slam, cuts.end, 0.35);

  // The end card: one big chord that rings out.
  impact(cuts.end, 1.1);
  [73.42, 146.83, 220, 293.66, 349.23, 440].forEach((hz, i) => tone(cuts.end, hz, duration - cuts.end, 0.07, { attack: 0.02, decay: 0.55, pan: (i % 2 ? 0.5 : -0.5) * (i / 6), harmonics: [1, 0.45, 0.2], detune: 0.003 }));
  [587.33, 880, 1174.66].forEach((hz, i) => blip(cuts.end + 0.4 + i * 0.2, hz, 0.08, (i - 1) * 0.6));

  // Glue: a soft tanh limiter and a fade at both ends.
  const fadeIn = 0.25 * SR, fadeOut = 0.5 * SR;
  for (let i = 0; i < n; i += 1) {
    const g = Math.min(1, i / fadeIn, (n - i) / fadeOut);
    L[i] = Math.tanh(L[i] * 1.1) * 0.9 * g;
    R[i] = Math.tanh(R[i] * 1.1) * 0.9 * g;
  }
  return { L, R };
}

function writeScore(file, duration, cuts) {
  const { L, R } = renderScore(duration, cuts);
  const n = L.length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

module.exports = { writeScore, renderScore };
