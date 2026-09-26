// The showreel's score, synthesised here: no samples, no downloaded music.
// 150 BPM (a 0.4 s beat) in D minor, Dm9 – Bbmaj9 – Fmaj9 – C/E, one chord a
// bar. The sections follow the scene cuts from showreel-stage.js: a filtered
// intro, a quiet build under the prompt, the drop as the tree grows, a lift
// through styles and themes, a break for the principles and a ringing close.
// writeScore(file, duration, cuts) writes a 48 kHz stereo 16-bit WAV.
const fs = require("node:fs");

const SR = 48000, BEAT = 0.4, BAR = BEAT * 4, TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const CHORDS = [
  { root: 38, notes: [50, 53, 57, 60, 64] },   // Dm9
  { root: 34, notes: [46, 50, 53, 57, 60] },   // Bbmaj9
  { root: 41, notes: [53, 57, 60, 64, 67] },   // Fmaj9
  { root: 36, notes: [52, 55, 60, 62, 67] },   // C/E add9
];
const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / BAR) % 4];
// The mix: each instrument's level against the others. Small speakers
// (a phone, a laptop) carry the pads and the arp, not the sub.
const MIX = { pad: 3.2, pluck: 2.6, bell: 1.9, bass: 0.4, kick: 0.5, snare: 0.8, hat: 0.75, impact: 0.35, riser: 0.9 };

function renderScore(duration, cuts) {
  const n = Math.ceil(duration * SR);
  const bus = () => ({ L: new Float32Array(n), R: new Float32Array(n) });
  const dry = bus(), duck = bus(), verb = bus(), echo = bus();
  let seed = 240925;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const put = (b, i, v, pan = 0) => {
    if (i < 0 || i >= n) return;
    const a = (pan + 1) * Math.PI / 4;
    b.L[i] += v * Math.cos(a) * 1.414; b.R[i] += v * Math.sin(a) * 1.414;
  };
  // A send: the same sample into a second bus at a level.
  const send = (b, i, v, pan, level) => { if (level) put(b, i, v * level, pan); };

  // ---- sections -------------------------------------------------------------
  const C = cuts;
  const energy = (t) => (t < C.prompt ? 0.2 : t < C.tree ? 0.45 : t < C.styles ? 0.8 : t < C.principles ? 1 : t < C.end ? 0.5 : 0.7);

  // ---- oscillators and filters ----------------------------------------------
  // polyBLEP saw, band-limited enough for pads and plucks.
  function blep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  // Zavalishin's TPT state-variable filter; returns lowpass.
  function svf() {
    let ic1 = 0, ic2 = 0;
    return (x, cutoff, q = 0.7) => {
      const g = Math.tan(Math.PI * Math.min(cutoff, SR * 0.45) / SR), k = 1 / q;
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      return v2;
    };
  }

  // ---- instruments ------------------------------------------------------------
  // Supersaw pad: seven detuned saws per note through a slowly opening lowpass.
  function pad(at, length, notes, level, cutoffFrom, cutoffTo, { attack = 0.35, release = 0.8, target = duck, space = 0.35 } = {}) {
    level *= MIX.pad;
    const s = Math.round(at * SR), len = Math.round((length + release) * SR);
    notes.forEach((note, ni) => {
      const hz = midi(note);
      const voices = [-0.11, -0.06, -0.025, 0, 0.025, 0.06, 0.11].map((d, vi) => ({ f: hz * 2 ** (d / 12), p: (vi * 0.137 + ni * 0.31) % 1, pan: (vi - 3) / 3 * 0.8 }));
      const fl = svf(), fr = svf();
      for (let i = 0; i < len; i += 1) {
        const t = i / SR;
        const env = Math.min(1, t / attack) * (t > length ? Math.max(0, 1 - (t - length) / release) : 1);
        if (env <= 0) continue;
        let l = 0, r = 0;
        for (const v of voices) {
          const dt = v.f / SR;
          v.p += dt; if (v.p >= 1) v.p -= 1;
          const x = 2 * v.p - 1 - blep(v.p, dt);
          l += x * (1 - v.pan) * 0.5; r += x * (1 + v.pan) * 0.5;
        }
        const u = Math.min(1, t / Math.max(0.01, length));
        const cut = cutoffFrom + (cutoffTo - cutoffFrom) * u + 250 * Math.sin(t * 1.3 + ni);
        const yl = fl(l / 7, cut) * env * level, yr = fr(r / 7, cut) * env * level;
        const i2 = s + i;
        if (i2 >= n) break;
        target.L[i2] += yl; target.R[i2] += yr;
        verb.L[i2] += yl * space; verb.R[i2] += yr * space;
      }
    });
  }
  // Pluck: saw + square blend with a fast filter envelope; echoes and verb.
  function pluck(at, note, level, { pan = 0, bright = 1, decay = 7, delaySend = 0.3, verbSend = 0.2, target = duck } = {}) {
    level *= MIX.pluck;
    const s = Math.round(at * SR), len = Math.round(0.9 * SR), hz = midi(note);
    const f = svf();
    let p = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR, dt = hz / SR;
      p += dt; if (p >= 1) p -= 1;
      const saw = 2 * p - 1 - blep(p, dt);
      const sq = p < 0.5 ? 1 : -1;
      const x = saw * 0.7 + sq * 0.2;
      const cut = 300 + 5200 * bright * Math.exp(-t * 18);
      const y = f(x, cut, 1.1) * Math.exp(-t * decay) * Math.min(1, t * 400) * level;
      put(target, s + i, y, pan);
      send(echo, s + i, y, pan, delaySend);
      send(verb, s + i, y, pan, verbSend);
    }
  }
  // Bell: FM-ish sine partials, long tail into the reverb.
  function bell(at, note, level, pan = 0) {
    level *= MIX.bell;
    const s = Math.round(at * SR), len = Math.round(1.8 * SR), hz = midi(note);
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      const mod = Math.sin(TAU * hz * 3.5 * t) * 1.4 * Math.exp(-t * 6);
      const y = (Math.sin(TAU * hz * t + mod) * Math.exp(-t * 2.6) + 0.25 * Math.sin(TAU * hz * 2.01 * t) * Math.exp(-t * 5)) * level * Math.min(1, t * 600);
      put(dry, s + i, y, pan);
      send(verb, s + i, y, pan, 0.55);
      send(echo, s + i, y, -pan, 0.25);
    }
  }
  // Sub bass that follows the chord roots, with a little drive.
  function bass(at, length, note, level) {
    level *= MIX.bass;
    const s = Math.round(at * SR), len = Math.round(length * SR), hz = midi(note);
    const f = svf();
    let p = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR, dt = hz / SR;
      p += dt; if (p >= 1) p -= 1;
      const x = Math.sin(TAU * p) + 0.35 * (2 * p - 1 - blep(p, dt));
      const env = Math.min(1, t * 80) * Math.min(1, (length - t) * 30);
      put(duck, s + i, Math.tanh(f(x, 420, 0.8) * 1.6) * env * level, 0);
    }
  }

  // ---- drums -------------------------------------------------------------------
  const kicks = [];
  function kick(at, level = 1) {
    kicks.push(at);
    level *= MIX.kick;
    const s = Math.round(at * SR), len = Math.round(0.5 * SR);
    let ph = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      const f = 48 + 140 * Math.exp(-t * 32) + 40 * Math.exp(-t * 200);
      ph += f / SR;
      const body = Math.sin(TAU * ph) * Math.exp(-t * 6.5);
      const click = i < 160 ? noise() * 0.35 * (1 - i / 160) : 0;
      put(dry, s + i, Math.tanh((body + click) * 1.8) * 0.8 * level, 0);
    }
  }
  function snare(at, level = 1, verbSend = 0.35) {
    level *= MIX.snare;
    const s = Math.round(at * SR), len = Math.round(0.35 * SR);
    const f = svf();
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      const tone = Math.sin(TAU * 185 * t) * Math.exp(-t * 28) * 0.5 + Math.sin(TAU * 330 * t) * Math.exp(-t * 34) * 0.2;
      const nz = noise();
      const hiss = (nz - f(nz, 1800)) * Math.exp(-t * 16) * 0.8;
      const y = (tone + hiss) * level * 0.55;
      put(dry, s + i, y, 0.05);
      send(verb, s + i, y, 0, verbSend);
    }
  }
  function hat(at, level = 0.2, pan = 0.25, open = false) {
    level *= MIX.hat;
    const s = Math.round(at * SR), len = Math.round((open ? 0.28 : 0.06) * SR);
    const f = svf();
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      const nz = noise();
      const hp = nz - f(nz, 7000);
      put(dry, s + i, hp * Math.exp(-t * (open ? 11 : 60)) * level, pan);
    }
  }
  function shaker(at, level = 0.07) {
    const s = Math.round(at * SR), len = Math.round(0.09 * SR);
    const f = svf();
    for (let i = 0; i < len; i += 1) {
      const t = i / SR, nz = noise();
      put(dry, s + i, (nz - f(nz, 5000)) * Math.sin(Math.PI * t / 0.09) * level, -0.35);
    }
  }

  // ---- fx ----------------------------------------------------------------------
  // A noise riser whose band climbs, with a rising tone under it.
  function riser(from, to, level = 0.3) {
    level *= MIX.riser;
    const s = Math.round(from * SR), len = Math.round((to - from) * SR);
    const f = svf();
    let p = 0;
    for (let i = 0; i < len; i += 1) {
      const u = i / len, nz = noise();
      const band = f(nz, 400 + 9000 * u * u, 2.2);
      p += (midi(50) * (1 + 2 * u * u)) / SR; if (p >= 1) p -= 1;
      const y = (band * 0.7 + (2 * p - 1) * 0.08 * u) * u * u * level;
      put(dry, s + i, y, Math.sin(u * 14) * 0.5);
      send(verb, s + i, y, 0, 0.4);
    }
  }
  // A low boom with a tail for each cut: felt more than heard, no crash.
  function impact(at, level = 1) {
    level *= MIX.impact;
    const s = Math.round(at * SR), len = Math.round(2.2 * SR);
    let ph = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      ph += (32 + 30 * Math.exp(-t * 5)) / SR;
      const y = Math.sin(TAU * ph) * Math.exp(-t * 2.2) * 0.55 * level;
      put(dry, s + i, y, 0);
      send(verb, s + i, y, 0, 0.25);
    }
  }
  // Soft key clicks for typing.
  function tick(at, level = 0.06) {
    const s = Math.round(at * SR), len = Math.round(0.025 * SR);
    const f = svf();
    for (let i = 0; i < len; i += 1) {
      const nz = noise();
      put(dry, s + i, (nz - f(nz, 3000)) * Math.exp(-(i / SR) * 180) * level, 0.3);
    }
  }

  // ---- arrangement -----------------------------------------------------------------
  // Pads: one chord a bar, the filter opening with the energy of the section.
  for (let bar = 0; bar * BAR < duration - 0.1; bar += 1) {
    const at = bar * BAR;
    if (at >= C.end) break;
    const chord = chordAt(at);
    const e = energy(at);
    pad(at, BAR, chord.notes, 0.075 + 0.02 * e, 500 + 1200 * e, 900 + 2600 * e, { attack: at < C.prompt ? 1.2 : 0.25, release: 0.6 });
  }
  // The intro motif: bells over the opening chords.
  [[0.4, 69], [0.8, 72], [1.2, 76], [1.6, 74], [2.4, 69], [2.8, 67]].forEach(([at, note], i) => bell(at, note, 0.09, i % 2 ? 0.35 : -0.35));
  riser(C.prompt - 1.2, C.prompt, 0.18);
  impact(C.prompt, 0.6);
  // Under the prompt: bass and a soft pulse, typing ticks.
  for (let at = C.prompt; at < C.tree - 1e-6; at += BEAT) {
    const chord = chordAt(at);
    if (Math.round((at - C.prompt) / BEAT) % 2 === 0) bass(at, BEAT * 1.8, chord.root, 0.28);
    shaker(at + BEAT / 2, 0.05);
  }
  // one key click a character while the prompt types (0.35 s to 2.6 s in), and the Create press
  for (let i = 0; i < 48; i += 1) tick(C.prompt + 0.35 + i * (2.25 / 48) + (i % 3) * 0.006, 0.05);
  bell(C.prompt + 2.75, 81, 0.07, 0.2);
  riser(C.tree - 1.6, C.tree, 0.32);

  // The groove, from the tree to the principles.
  const groove = (from, to, { claps = true, arp = true, busy = 1 } = {}) => {
    for (let at = from, beat = 0; at < to - 1e-6; at += BEAT, beat += 1) {
      const chord = chordAt(at);
      kick(at, beat % 4 === 0 ? 1 : 0.9);
      if (claps && beat % 2 === 1) snare(at, 0.9);
      for (let s = 0; s < 4; s += 1) {
        const swing = s % 2 ? 0.018 : 0;
        hat(at + s * BEAT / 4 + swing, s === 2 ? 0.16 : 0.07 * busy, s % 2 ? -0.3 : 0.3, s === 2 && beat % 4 === 3);
      }
      // off-beat bass under the kick's duck
      bass(at + BEAT / 2, BEAT / 2 * 0.9, chord.root + (beat % 4 === 3 ? 12 : 0), 0.34);
      if (arp) {
        const tones = [...chord.notes, ...chord.notes.map((x) => x + 12)];
        for (let s = 0; s < 4; s += 1) {
          const step = (beat * 4 + s);
          const note = tones[[0, 2, 4, 5, 3, 6, 4, 7][step % 8] % tones.length] + 12;
          pluck(at + s * BEAT / 4, note, 0.07, { pan: s % 2 ? 0.45 : -0.45, bright: 0.6 + 0.4 * energy(at), decay: 9 });
        }
      }
    }
  };
  groove(C.tree, C.styles, { arp: true, busy: 0.8 });
  groove(C.styles, C.numbers, { arp: true, busy: 1 });
  groove(C.numbers, C.principles, { arp: true, busy: 1.2 });
  // Each node style and each theme rings its own bell, a phrase across them.
  [74, 76, 77, 81, 79, 77, 76, 72].forEach((note, i) => bell(C.styles + i * BEAT, note + 12, 0.07, i % 2 ? 0.4 : -0.4));
  [69, 72, 76, 79].forEach((note, i) => bell(C.themes + i * 0.8, note + 12, 0.08, i % 2 ? -0.3 : 0.3));
  [62, 65, 69, 74].forEach((note, i) => bell(C.numbers + i * 0.8, note + 12, 0.08, 0));
  // A snare roll into the break.
  for (let i = 0; i < 16; i += 1) snare(C.principles - 1.6 + i * 0.1, 0.25 + i * 0.03, 0.2);
  riser(C.principles - 1.6, C.principles, 0.25);
  // The break: half-time, pad and bells.
  for (let at = C.principles, beat = 0; at < C.end - 1e-6; at += BEAT, beat += 1) {
    if (beat % 4 === 0) kick(at, 0.7);
    if (beat % 4 === 2) snare(at, 0.5, 0.6);
    hat(at + BEAT / 2, 0.06, 0.3);
    if (beat % 2 === 0) bass(at, BEAT * 1.6, chordAt(at).root, 0.25);
    if (beat % 2 === 0) bell(at + 0.2, chordAt(at).notes[4] + 12, 0.045, beat % 4 ? 0.4 : -0.4);
  }
  riser(C.end - 1.2, C.end, 0.3);
  // Scene cuts land a low impact (not on the ones inside the groove's flow).
  for (const at of [C.tree, C.styles, C.themes, C.crew, C.flow, C.numbers]) impact(at, 0.45);
  // The close: the tonic, big and open, ringing out.
  impact(C.end, 1);
  kick(C.end, 1);
  pad(C.end, duration - C.end - 0.6, [38, 50, 57, 62, 65, 69, 76], 0.1, 2600, 900, { attack: 0.02, release: 0.6, target: dry, space: 0.6 });
  bass(C.end, 2.4, 38, 0.3);
  [81, 76, 74, 69].forEach((note, i) => bell(C.end + 0.4 + i * 0.4, note, 0.08, (i - 1.5) * 0.4));

  // ---- sidechain, echo, reverb, master -------------------------------------------------
  // The duck bus pumps with every kick.
  const gain = new Float32Array(n).fill(1);
  for (const at of kicks) {
    const s = Math.round(at * SR), len = Math.round(0.28 * SR);
    for (let i = 0; i < len && s + i < n; i += 1) {
      const t = i / SR;
      gain[s + i] = Math.min(gain[s + i], 1 - 0.7 * Math.exp(-t * 14) * Math.min(1, t * 900 + 0.2));
    }
  }
  for (let i = 0; i < n; i += 1) { dry.L[i] += duck.L[i] * gain[i]; dry.R[i] += duck.R[i] * gain[i]; }
  // Ping-pong echo, a dotted eighth (0.3 s), darkened each repeat.
  {
    const d = Math.round(0.3 * SR);
    let lpL = 0, lpR = 0;
    const bL = new Float32Array(n), bR = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const inL = echo.L[i] + (i >= d ? bR[i - d] * 0.42 : 0);
      const inR = echo.R[i] + (i >= d ? bL[i - d] * 0.42 : 0);
      lpL += (inL - lpL) * 0.35; lpR += (inR - lpR) * 0.35;
      bL[i] = lpL; bR[i] = lpR;
      dry.L[i] += bL[i] * 0.5; dry.R[i] += bR[i] * 0.5;
      verb.L[i] += bL[i] * 0.15; verb.R[i] += bR[i] * 0.15;
    }
  }
  // Freeverb: eight damped combs and four allpasses per side.
  {
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round(x * SR / 44100));
    const alls = [556, 441, 341, 225].map((x) => Math.round(x * SR / 44100));
    const side = (input, spread) => {
      const out = new Float32Array(n);
      const banks = combs.map((len) => ({ buf: new Float32Array(len + spread), i: 0, store: 0 }));
      for (let i = 0; i < n; i += 1) {
        const x = input[i] * 0.015;
        let y = 0;
        for (const c of banks) {
          const o = c.buf[c.i];
          c.store = o * 0.75 + c.store * 0.25;
          c.buf[c.i] = x + c.store * 0.86;
          c.i = (c.i + 1) % c.buf.length;
          y += o;
        }
        out[i] = y;
      }
      for (const len of alls) {
        const buf = new Float32Array(len + spread);
        let p = 0;
        for (let i = 0; i < n; i += 1) {
          const b = buf[p];
          const x = out[i];
          buf[p] = x + b * 0.5;
          out[i] = b - x;
          p = (p + 1) % buf.length;
        }
      }
      return out;
    };
    const wl = side(verb.L, 0), wr = side(verb.R, 23);
    for (let i = 0; i < n; i += 1) { dry.L[i] += wl[i] * 3; dry.R[i] += wr[i] * 3; }
  }
  // Glue: a slow compressor on the sum, soft clip, normalise to -1 dBFS, fade.
  let env = 0;
  for (let i = 0; i < n; i += 1) {
    const level = Math.max(Math.abs(dry.L[i]), Math.abs(dry.R[i]));
    env = level > env ? env + (level - env) * 0.01 : env + (level - env) * 0.0002;
    const g = env > 0.5 ? 0.5 / env + (1 - 0.5 / env) * 0.4 : 1;
    dry.L[i] = Math.tanh(dry.L[i] * g * 1.2);
    dry.R[i] = Math.tanh(dry.R[i] * g * 1.2);
  }
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(dry.L[i]), Math.abs(dry.R[i]));
  const norm = peak > 0 ? 0.89 / peak : 1;
  const fadeIn = 0.05 * SR, fadeOut = 1.4 * SR;
  for (let i = 0; i < n; i += 1) {
    const g = Math.min(1, i / fadeIn, (n - i) / fadeOut) * norm;
    dry.L[i] *= g; dry.R[i] *= g;
  }
  return dry;
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

// node tools/promo/showreel-score.cjs out.wav  — the score alone, on the film's cuts.
if (require.main === module) {
  const CUTS = { ignite: 0, prompt: 3.2, tree: 7.2, styles: 12.0, grid: 15.2, themes: 16.8, crew: 20.0, flow: 24.0, numbers: 27.2, principles: 30.4, end: 33.6 };
  const started = Date.now();
  console.log(writeScore(process.argv[2] || "showreel-score.wav", 40, CUTS), `${Date.now() - started} ms`);
}
