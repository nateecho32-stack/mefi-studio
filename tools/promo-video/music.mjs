// The promo's score, synthesised from scratch so the film carries no licensed
// audio: a soft pad on a four-chord loop, a plucked arpeggio with a ping-pong
// delay, a half-time kick, and a noise swell into every scene cut. 96 BPM, so
// a bar is 2.5 s and the cuts in promo.html land on bar lines.
//
//   node tools/promo-video/music.mjs out/score.wav
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const BEAT = 60 / 96;
const CUTS = [5, 10, 17.5, 25, 32.5, 37.5, 42.5];

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const CHORDS = {
  Am: [45, 52, 57, 60, 64, 67],
  F: [41, 48, 53, 57, 60, 64],
  C: [36, 48, 55, 59, 64, 67],
  G: [43, 50, 55, 59, 62, 66],
};
// One chord per five seconds.
const PROGRESSION = ["Am", "F", "C", "G", "Am", "F", "C", "G", "F", "C"];

// A soft, band-limited saw: the first eight harmonics, rolled off.
const TABLE = new Float32Array(4096);
for (let i = 0; i < TABLE.length; i++) {
  let v = 0;
  for (let h = 1; h <= 8; h++) v += Math.sin((2 * Math.PI * h * i) / TABLE.length) / (h * h * 0.6 + 0.4);
  TABLE[i] = v * 0.5;
}
const tab = (phase) => TABLE[Math.floor((phase % 1) * TABLE.length)];

function makeNoise(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

export function renderScore(duration) {
  const n = Math.round(duration * RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  const add = (i, l, r) => { if (i >= 0 && i < n) { L[i] += l; R[i] += r; } };

  // Pad: every chord tone as three detuned voices, slow in and slow out.
  const phase = makeNoise(3);
  PROGRESSION.forEach((name, c) => {
    const start = c * 5, end = start + 5;
    const last = c === PROGRESSION.length - 1;
    const tail = last ? 0.2 : 1.6;
    CHORDS[name].forEach((note, k) => {
      const f = midi(note + (k === 0 ? 0 : 12)) * (k === 0 ? 1 : 0.5);
      const amp = k === 0 ? 0.07 : 0.04;
      for (const [det, pan] of [[-0.004, 0.25], [0, 0.5], [0.0045, 0.75]]) {
        let ph = phase() * 0.5 + 0.5;
        const i0 = Math.floor(Math.max(0, start - 0.8) * RATE), i1 = Math.min(n, Math.floor((end + tail) * RATE));
        for (let i = i0; i < i1; i++) {
          const t = i / RATE;
          const env = Math.min(1, (t - (start - 0.8)) / 1.4) * Math.min(1, Math.max(0, (end + tail - t) / (tail + 0.8)));
          ph += (f * (1 + det)) / RATE;
          const v = tab(ph) * amp * env * env;
          add(i, v * (1 - pan) * 1.4, v * pan * 1.4);
        }
      }
    });
  });

  // Plucked arpeggio in eighths from the second scene on, through a delay.
  const arpL = new Float32Array(n), arpR = new Float32Array(n);
  const PATTERN = [0, 2, 3, 4, 5, 4, 3, 2];
  for (let step = 0, t = 5; t < 47.5; step++, t = 5 + step * BEAT / 2) {
    const chord = CHORDS[PROGRESSION[Math.min(PROGRESSION.length - 1, Math.floor(t / 5))]];
    const note = chord[PATTERN[step % PATTERN.length]] + 12;
    const f = midi(note);
    const vel = (step % 4 === 0 ? 0.075 : 0.05) * Math.min(1, (t - 5) / 2.5) * Math.min(1, (47.5 - t) / 3);
    const pan = step % 2 ? 0.35 : 0.65;
    const i0 = Math.floor(t * RATE), len = Math.floor(0.7 * RATE);
    for (let j = 0; j < len; j++) {
      const tt = j / RATE;
      const env = Math.exp(-tt * 7) * Math.min(1, tt * 400);
      const v = (Math.sin(2 * Math.PI * f * tt) + 0.25 * Math.sin(4 * Math.PI * f * tt) + 0.08 * Math.sin(6 * Math.PI * f * tt)) * vel * env;
      if (i0 + j < n) { arpL[i0 + j] += v * (1 - pan); arpR[i0 + j] += v * pan; }
    }
  }
  const d = Math.floor(BEAT * 0.75 * RATE);
  for (let i = 0; i < n; i++) {
    const fl = i >= d ? arpR[i - d] * 0.42 : 0;
    const fr = i >= d ? arpL[i - d] * 0.42 : 0;
    arpL[i] += fl; arpR[i] += fr;
    L[i] += arpL[i]; R[i] += arpR[i];
  }

  // Half-time kick under the feature scenes, soft ticks on the off-beats.
  const noise = makeNoise(7);
  for (let b = 0, t = 10; t < 42.5; b++, t = 10 + b * BEAT) {
    const i0 = Math.floor(t * RATE);
    if (b % 2 === 0) {
      let ph = 0;
      for (let j = 0; j < 0.45 * RATE; j++) {
        const tt = j / RATE;
        ph += (45 + 70 * Math.exp(-tt * 28)) / RATE;
        const v = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 7) * 0.32;
        add(i0 + j, v, v);
      }
    }
    if (t >= 17.5) {
      const h0 = i0 + Math.floor((BEAT / 2) * RATE);
      let prev = 0;
      for (let j = 0; j < 0.06 * RATE; j++) {
        const x = noise(), v = (x - prev) * Math.exp(-j / RATE * 70) * 0.025; prev = x;
        add(h0 + j, v * 0.8, v);
      }
    }
  }

  // A swell into each cut: noise through a rising one-pole low-pass.
  for (const cut of CUTS) {
    const len = 1.1, i0 = Math.floor((cut - len) * RATE);
    let yl = 0, yr = 0;
    for (let j = 0; j < len * RATE + 0.15 * RATE; j++) {
      const tt = j / RATE, p = Math.min(1, tt / len);
      const env = tt <= len ? p * p : Math.exp(-(tt - len) * 30);
      const a = 0.01 + 0.2 * p * p;
      yl += a * (noise() - yl); yr += a * (noise() - yr);
      add(i0 + j, yl * env * 0.22, yr * env * 0.22);
    }
  }

  // Low booms under the logo at the open and close.
  for (const t of [0.3, 42.5]) {
    const i0 = Math.floor(t * RATE);
    for (let j = 0; j < 3 * RATE; j++) {
      const tt = j / RATE;
      const v = Math.sin(2 * Math.PI * 41 * tt) * Math.exp(-tt * 1.4) * Math.min(1, tt * 60) * 0.3;
      add(i0 + j, v, v);
    }
  }

  // Fade in and out, then normalise.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const g = Math.min(1, t / 0.4) * Math.min(1, Math.max(0, (duration - t) / 2.5));
    L[i] *= g; R[i] *= g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = 0.89 / (peak || 1);
  for (let i = 0; i < n; i++) { L[i] *= norm; R[i] *= norm; }
  return [L, R];
}

export function writeScore(file, duration) {
  const [L, R] = renderScore(duration);
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, buf);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeScore(process.argv[2] || "score.wav", 50);
}
