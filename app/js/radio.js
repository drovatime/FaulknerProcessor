// The cabin radio: original 8-bit stations, synthesized live with Web Audio.
//   Fog Line          — slow, misty, dreamy: sustained pads, echoing arpeggios, a lonely melody.
//   Low Tide          — ambient pads and chimes over gentle surf.
//   Rain on the Sound — lo-fi keys, a lazy beat, rain and vinyl crackle.
//   Harbor Lights     — late-night jazz trio: walking bass, brushes and ride, soft comping, vibes.
//   Cedar Waltz       — a gentle jazz waltz in three.
//   Last Call         — noir: muted trumpet, slow two-feel bass, swirling brushes, rain on the window.
// The music is generated from chord progressions with gentle randomness, so it never
// repeats exactly but always settles back into the same mood.

let ctx = null, mix, out, send, verb, warm, waves = {}, noiseBuf = null, beds = [];
let timer = null, nextTime = 0, step = 0, current = null;
let volume = 0.5;
const listeners = new Set();

export const STATIONS = {
  fog: { name: 'Fog Line', blurb: 'Slow, misty synth for long nights' },
  tide: { name: 'Low Tide', blurb: 'Ambient pads and chimes over gentle surf' },
  rain: { name: 'Rain on the Sound', blurb: 'Lo-fi keys, a lazy beat, rain on the glass' },
  harbor: { name: 'Harbor Lights', blurb: 'Walking bass, brushes and vibes' },
  waltz: { name: 'Cedar Waltz', blurb: 'A gentle jazz waltz in three' },
  noir: { name: 'Last Call', blurb: 'Muted trumpet and brushes, a wet street at 2 a.m.' },
};

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pulseWave(duty) {
  const n = 48;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    real[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
    imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
  }
  return ctx.createPeriodicWave(real, imag);
}

function setup(given) {
  if (ctx && !given) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = given || new AC();
  // Let iPhones play through even when the ring/silent switch is on.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
  out = ctx.createGain();
  out.gain.value = volume;
  warm = ctx.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 3400;
  mix = ctx.createGain();
  mix.connect(warm).connect(out).connect(ctx.destination);
  // Echo bus (a soft tape-style delay)
  send = ctx.createGain();
  const delay = ctx.createDelay(2);
  const fb = ctx.createGain();
  const dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.value = 1700;
  send.connect(delay);
  delay.connect(dlp);
  dlp.connect(fb).connect(delay);
  dlp.connect(mix);
  send._delay = delay;
  send._fb = fb;
  // Room reverb: a convolver with a synthesized, softly darkening impulse response.
  const conv = ctx.createConvolver();
  const irLen = Math.floor(ctx.sampleRate * 2.6);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < irLen; i++) {
      const k = i / irLen;
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * (0.55 - 0.45 * k); // gets darker as it decays
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  conv.buffer = ir;
  verb = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  verb.connect(conv).connect(wet).connect(mix);
  waves.p12 = pulseWave(0.125);
  waves.p25 = pulseWave(0.25);
  waves.p50 = pulseWave(0.5);
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

function tone(t, midi, dur, { wave = 'triangle', gain = 0.1, attack = 0.01, release = 0.12, echo = 0, vibrato = 0, cutoff = 0, bend = 0, detune = 0, room = 0 } = {}) {
  const o = ctx.createOscillator();
  if (waves[wave]) o.setPeriodicWave(waves[wave]); else o.type = wave;
  o.frequency.setValueAtTime(midiHz(midi), t);
  if (detune) o.detune.value = detune;
  if (bend) { // a fall-off at the end of the note, like a horn player letting it go
    o.frequency.setValueAtTime(midiHz(midi), t + dur * 0.6);
    o.frequency.exponentialRampToValueAtTime(midiHz(midi + bend), t + dur + 0.05);
  }
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 5;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t + 0.15);
    lfo.stop(t + dur + release + 0.1);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  let node = o;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(mix);
  if (echo) {
    const s = ctx.createGain();
    s.gain.value = echo;
    g.connect(s).connect(send);
  }
  if (room) {
    const s = ctx.createGain();
    s.gain.value = room;
    g.connect(s).connect(verb);
  }
  o.start(t);
  o.stop(t + dur + release + 0.05);
}

function hiss(t, dur, { type = 'highpass', freq = 7000, q = 0.7, gain = 0.05, attack = 0.002, room = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(mix);
  if (room) { const s = ctx.createGain(); s.gain.value = room; g.connect(s).connect(verb); }
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function thump(t, { freq = 70, gain = 0.1, dur = 0.18 } = {}) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(mix);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ------------------------------------------------------------------ Fog Line
// Key of F. Eight bars, two beats of eighth notes per beat, 64 bpm.
const FOG = {
  bpm: 64, perBeat: 2, perBar: 8, echoTime: 0.75, echoFb: 0.42, level: 1.9,
  chords: [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 62], // Em7
    [50, 53, 57, 60], // Dm7
    [48, 52, 55, 59], // Cmaj7
    [46, 50, 53, 57], // Bbmaj7
    [45, 48, 52, 55], // Am7
    [43, 46, 50, 53], // Gm7
    [48, 53, 55, 58], // C7sus4
  ],
  scale: [53, 55, 57, 58, 60, 62, 64, 65, 67, 69, 70, 72, 74, 76],
  play(n, t, sd) {
    const bar = Math.floor(n / this.perBar);
    const pos = n % this.perBar;
    const chord = this.chords[bar % this.chords.length];
    const r = rng(Math.floor(bar / 16) * 977 + bar % 16 * 31 + pos);
    const barDur = sd * this.perBar;
    if (pos === 0) {
      chord.forEach(m => tone(t, m, barDur * 0.95, { wave: 'triangle', gain: 0.03, attack: 0.9, release: 1.6, echo: 0.25 }));
      tone(t, chord[0] - 12, barDur * 0.45, { wave: 'triangle', gain: 0.12, attack: 0.05, release: 0.5 });
    }
    if (pos === 4) tone(t, chord[r() < 0.5 ? 0 : 2] - 12, barDur * 0.45, { wave: 'triangle', gain: 0.1, attack: 0.05, release: 0.5 });
    // echoing arpeggio
    const order = [0, 1, 2, 3, 2, 1, 3, 2];
    if (r() > 0.12) tone(t, chord[order[pos]] + 12, sd * 0.5, { wave: 'p12', gain: 0.022, attack: 0.005, release: 0.18, echo: 0.6 });
    // a lonely melody on the half notes
    if ((pos === 0 || pos === 4) && r() < 0.68) {
      this.last = this.last || 69;
      const targets = r() < 0.7 ? chord.map(m => m + 12) : this.scale;
      const cands = targets.filter(m => Math.abs(m - this.last) <= 7 && m >= 60 && m <= 79);
      const m = cands.length ? cands[Math.floor(r() * cands.length)] : this.last;
      this.last = m;
      tone(t, m, sd * (r() < 0.4 ? 6 : 3.5), { wave: 'p25', gain: 0.035, attack: 0.06, release: 0.9, echo: 0.45, vibrato: 3, cutoff: 2200 });
    }
    // a far-off chime every four bars
    if (pos === 6 && bar % 4 === 3 && r() < 0.8) tone(t, chord[3] + 24, sd * 2, { wave: 'sine', gain: 0.025, attack: 0.01, release: 2.5, echo: 0.7 });
  },
};

// ------------------------------------------------------------------ Harbor Lights
// Key of B-flat. Swing feel: three triplet steps per beat, 106 bpm, 16-bar form.
const HARBOR = {
  bpm: 106, perBeat: 3, perBar: 12, echoTime: 0.42, echoFb: 0.18, level: 1,
  form: [
    { root: 46, tones: [50, 53, 57, 60] }, // Bbmaj7
    { root: 43, tones: [46, 50, 53, 57] }, // Gm7
    { root: 48, tones: [51, 55, 58, 62] }, // Cm7
    { root: 41, tones: [45, 48, 51, 55] }, // F7
    { root: 50, tones: [53, 57, 60, 64] }, // Dm7
    { root: 43, tones: [47, 50, 53, 57] }, // G7
    { root: 48, tones: [51, 55, 58, 62] }, // Cm7
    { root: 41, tones: [45, 48, 51, 55] }, // F7
    { root: 51, tones: [55, 58, 62, 65] }, // Ebmaj7
    { root: 52, tones: [55, 58, 61, 64] }, // Edim7
    { root: 46, tones: [50, 53, 57, 60] }, // Bbmaj7
    { root: 43, tones: [47, 50, 53, 57] }, // G7
    { root: 48, tones: [51, 55, 58, 62] }, // Cm7
    { root: 41, tones: [45, 48, 51, 55] }, // F7
    { root: 46, tones: [50, 53, 55, 57] }, // Bb6
    { root: 41, tones: [45, 48, 51, 55] }, // F7
  ],
  scale: [58, 60, 62, 63, 65, 67, 69, 70, 72, 74, 75, 77],
  bassAt: 34,
  play(n, t, sd) {
    const bar = Math.floor(n / this.perBar);
    const pos = n % this.perBar;
    const beat = Math.floor(pos / 3);
    const sub = pos % 3;
    const ch = this.form[bar % this.form.length];
    const next = this.form[(bar + 1) % this.form.length];
    const r = rng(bar * 131 + pos * 7 + Math.floor(bar / 32) * 3);
    const beatDur = sd * 3;

    // walking bass on every beat
    if (sub === 0) {
      const near = m => { let x = m; while (x - this.bassAt > 7) x -= 12; while (this.bassAt - x > 7) x += 12; return Math.max(31, Math.min(50, x)); };
      let m;
      if (beat === 0) m = near(ch.root - 12);
      else if (beat === 3) m = near(next.root - 12) + (r() < 0.5 ? 1 : -1);
      else {
        const pick = ch.tones[r() < 0.5 ? 0 : 1] - 24;
        m = near(pick);
      }
      this.bassAt = m;
      tone(t, m, beatDur * 0.85, { wave: 'triangle', gain: 0.26, attack: 0.006, release: 0.07 });
      tone(t, m + 12, beatDur * 0.3, { wave: 'p50', gain: 0.012, attack: 0.004, release: 0.05, cutoff: 900 });
    }
    // drums: ride "ding, ding-a ding", hat on 2 & 4, brushes, feathered kick
    if (sub === 0) hiss(t, 0.28, { freq: 8000, gain: beat % 2 ? 0.03 : 0.04 });
    if (sub === 2 && (beat === 1 || beat === 3)) hiss(t, 0.16, { freq: 8500, gain: 0.022 });
    if (sub === 0 && (beat === 1 || beat === 3)) {
      hiss(t, 0.05, { type: 'bandpass', freq: 6500, q: 1.2, gain: 0.03 });
      hiss(t, 0.24, { type: 'bandpass', freq: 2400, q: 0.6, gain: 0.025, attack: 0.04 });
    }
    if (sub === 0 && (beat === 0 || beat === 2)) thump(t, { gain: 0.06 });
    // comping: soft rootless chord stabs on swung offbeats
    if (!this.comp || pos === 0) {
      const patterns = [[2, 8], [5], [3, 11], [2, 6, 11], [8]];
      this.comp = patterns[Math.floor(r() * patterns.length)];
    }
    if (this.comp.includes(pos)) {
      ch.tones.forEach(m => tone(t, m + 12, sd * (r() < 0.5 ? 1.2 : 2.2), { wave: 'p25', gain: 0.016, attack: 0.008, release: 0.12, cutoff: 1800 }));
    }
    // vibes: short phrases that answer each other
    if (pos === 0 && bar % 2 === 0) {
      this.phrase = r() < 0.65;
      this.line = this.line || 70;
    }
    if (this.phrase && (sub === 0 || sub === 2) && r() < 0.42) {
      const pool = r() < 0.6 ? ch.tones.map(m => m + 12) : this.scale;
      const cands = pool.filter(m => Math.abs(m - this.line) <= 5 && m >= 62 && m <= 81);
      const m = cands.length ? cands[Math.floor(r() * cands.length)] : this.line;
      this.line = m;
      tone(t, m, sd * (sub === 2 ? 0.9 : 1.6), { wave: 'sine', gain: 0.055, attack: 0.004, release: 0.6, echo: 0.2, vibrato: 2.5 });
      tone(t, m + 12, sd * 0.5, { wave: 'sine', gain: 0.012, attack: 0.002, release: 0.25 });
    }
  },
};

// ------------------------------------------------------------------ ambience beds
// A looping noise layer: surf (slow swells), rain, or room tone.
function bed(t, { lp = 800, hp = 60, gain = 0.04, swell = 0, swellDepth = 0.6 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
  const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 2);
  src.connect(h).connect(l).connect(g).connect(mix);
  const nodes = [src];
  if (swell) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = swell;
    depth.gain.value = gain * swellDepth;
    lfo.connect(depth).connect(g.gain);
    lfo.start(t);
    nodes.push(lfo);
  }
  src.start(t, Math.random());
  return nodes;
}
function crackle(t, span, density, { lo = 1500, hi = 5500, loud = 1 } = {}) {
  for (let i = 0; i < density; i++) {
    const at = t + Math.random() * span;
    hiss(at, 0.004 + Math.random() * 0.01, { type: 'bandpass', freq: lo + Math.random() * (hi - lo), q: 1, gain: (0.01 + Math.random() * 0.035) * loud, attack: 0.0005 });
  }
}
const near = (m, prev, lo, hi) => { let x = m; while (x - prev > 6) x -= 12; while (prev - x > 6) x += 12; while (x < lo) x += 12; while (x > hi) x -= 12; return x; };

// ------------------------------------------------------------------ Low Tide
// D dorian, very slow. Long pads, sparse chimes, and the surf breathing underneath.
const TIDE = {
  bpm: 50, perBeat: 2, perBar: 8, echoTime: 0.9, echoFb: 0.5, level: 1.5, cutoff: 2600,
  chords: [
    { root: 38, tones: [50, 53, 57, 60, 64] }, // Dm9
    { root: 38, tones: [50, 53, 57, 62, 65] }, // Dm(add11)
    { root: 46, tones: [50, 53, 57, 60, 62] }, // Bbmaj9
    { root: 46, tones: [50, 53, 57, 58, 62] }, // Bbmaj7
    { root: 36, tones: [48, 53, 57, 60, 64] }, // F/C
    { root: 43, tones: [46, 50, 53, 57, 58] }, // Gm9
    { root: 45, tones: [48, 52, 55, 57, 60] }, // Am7
    { root: 45, tones: [49, 52, 55, 57, 64] }, // A7sus → A
  ],
  chime: [62, 65, 67, 69, 72, 74, 77, 79, 81],
  bed(t) { return bed(t, { lp: 650, hp: 80, gain: 0.09, swell: 0.11, swellDepth: 0.8 }); },
  play(n, t, sd) {
    const bar = Math.floor(n / this.perBar), pos = n % this.perBar;
    const ch = this.chords[bar % this.chords.length];
    const r = rng(bar * 389 + pos * 13 + Math.floor(bar / 16) * 7);
    const barDur = sd * this.perBar;
    if (pos === 0) {
      ch.tones.forEach((m, i) => {
        tone(t, m, barDur * 1.05, { wave: 'triangle', gain: 0.022, attack: 2.2, release: 2.5, echo: 0.35, detune: i % 2 ? 6 : -6 });
        if (i < 3) tone(t, m + 12, barDur, { wave: 'sine', gain: 0.012, attack: 2.8, release: 2.5 });
      });
      tone(t, ch.root, barDur * 0.95, { wave: 'sine', gain: 0.13, attack: 0.6, release: 1.5 });
    }
    if (r() < 0.28) {
      const m = this.chime[Math.floor(r() * this.chime.length)];
      tone(t + r() * sd * 0.3, m, sd * 0.4, { wave: 'sine', gain: 0.03, attack: 0.002, release: 2.2, echo: 0.65 });
      tone(t, m + 24, sd * 0.1, { wave: 'sine', gain: 0.004, attack: 0.001, release: 0.6 });
    }
  },
};

// ------------------------------------------------------------------ Rain on the Sound
// Lo-fi: E-flat, 16th-note grid with a lazy swing. Warm keys, a soft beat, rain and crackle.
const RAIN = {
  bpm: 76, perBeat: 4, perBar: 16, echoTime: 0.59, echoFb: 0.28, level: 1.2, cutoff: 2300,
  chords: [
    { root: 44, tones: [55, 58, 60, 63, 67] }, // Abmaj9
    { root: 43, tones: [53, 58, 62, 65] },     // Gm7
    { root: 41, tones: [51, 55, 56, 60, 63] }, // Fm9
    { root: 46, tones: [51, 55, 56, 60, 62] }, // Bb13sus
  ],
  pent: [63, 65, 67, 70, 72, 75, 77, 79],
  bed(t) { return bed(t, { lp: 5200, hp: 1400, gain: 0.018 }); },
  play(n, tIn, sd) {
    const t = n % 2 ? tIn + sd * 0.22 : tIn; // lazy swing on the off-16ths
    const bar = Math.floor(n / this.perBar), pos = n % this.perBar;
    const ch = this.chords[bar % this.chords.length];
    const r = rng(bar * 211 + pos * 17 + Math.floor(bar / 16) * 5);
    const st = this.st;
    if (pos === 0) crackle(t, sd * this.perBar, 10);
    // keys: a warm electric-piano chord on 1 and the "and" of 3
    if (pos === 0 || pos === 10 || (pos === 14 && r() < 0.3)) {
      const len = pos === 0 ? sd * 9 : sd * 5;
      ch.tones.forEach(m => {
        tone(t + r() * 0.012, m, len, { wave: 'sine', gain: 0.034, attack: 0.006, release: 0.9, vibrato: 1.5 });
        tone(t, m, len * 0.4, { wave: 'p50', gain: 0.006, attack: 0.004, release: 0.3, cutoff: 1100 });
      });
    }
    // bass
    if (pos === 0) tone(t, ch.root - 12 + 12, sd * 6, { wave: 'sine', gain: 0.2, attack: 0.01, release: 0.25 });
    if (pos === 10) tone(t, ch.root - 12 + (r() < 0.5 ? 19 : 12), sd * 4, { wave: 'sine', gain: 0.16, attack: 0.01, release: 0.2 });
    // drums
    if (pos === 0 || pos === 10 || (pos === 7 && r() < 0.4)) thump(t, { freq: 52, gain: 0.16, dur: 0.3 });
    if (pos === 4 || pos === 12) {
      hiss(t, 0.16, { type: 'bandpass', freq: 1900, q: 0.8, gain: 0.06 });
      thump(t, { freq: 190, gain: 0.04, dur: 0.08 });
    }
    if (pos % 2 === 0) hiss(t, pos % 4 === 2 ? 0.07 : 0.04, { freq: 7500, gain: pos % 4 === 2 ? 0.022 : 0.013 });
    // a sparse melody that wanders
    if (pos === 0 && bar % 2 === 1) { st.phrase = r() < 0.7; }
    if (st.phrase && pos % 2 === 0 && r() < 0.32) {
      st.line = st.line || 70;
      const cands = this.pent.filter(m => Math.abs(m - st.line) <= 5);
      const m = cands[Math.floor(r() * cands.length)] || st.line;
      st.line = m;
      tone(t, m, sd * (r() < 0.3 ? 4 : 1.6), { wave: 'triangle', gain: 0.04, attack: 0.01, release: 0.5, echo: 0.4, vibrato: 3 });
    }
  },
};

// ------------------------------------------------------------------ Cedar Waltz
// F major jazz waltz, 3/4, swung triplet grid. Bass on one, chords on two and three.
const WALTZ = {
  bpm: 138, perBeat: 3, perBar: 9, echoTime: 0.43, echoFb: 0.3, level: 1.1, cutoff: 2700,
  // An old record in a warm room: a low, soft surface rumble, gentle pops, and reverb on everything.
  bed(t) { return [...bed(t, { lp: 700, hp: 90, gain: 0.016, swell: 0.07, swellDepth: 0.35 }), ...bed(t, { lp: 1400, hp: 400, gain: 0.004 })]; },
  form: [
    { root: 41, tones: [57, 60, 64, 65] }, // Fmaj7
    { root: 38, tones: [57, 60, 62, 65] }, // Dm7
    { root: 43, tones: [58, 62, 65, 67] }, // Gm7
    { root: 36, tones: [58, 60, 64, 67] }, // C7
    { root: 45, tones: [55, 60, 64, 67] }, // Am7
    { root: 38, tones: [57, 60, 62, 66] }, // D7
    { root: 43, tones: [58, 62, 65, 67] }, // Gm7
    { root: 36, tones: [58, 60, 64, 67] }, // C7
    { root: 46, tones: [57, 58, 62, 65] }, // Bbmaj7
    { root: 46, tones: [55, 58, 61, 62] }, // Bbm6
    { root: 45, tones: [55, 60, 64, 67] }, // Am7
    { root: 38, tones: [57, 60, 63, 66] }, // D7b9
    { root: 43, tones: [58, 62, 65, 67] }, // Gm7
    { root: 36, tones: [58, 60, 64, 67] }, // C7
    { root: 41, tones: [57, 60, 64, 65] }, // Fmaj7
    { root: 36, tones: [58, 60, 64, 67] }, // C7
  ],
  scale: [65, 67, 69, 70, 72, 74, 76, 77, 79, 81],
  play(n, t, sd) {
    const bar = Math.floor(n / this.perBar), pos = n % this.perBar;
    const beat = Math.floor(pos / 3), sub = pos % 3;
    const ch = this.form[bar % this.form.length];
    const next = this.form[(bar + 1) % this.form.length];
    const r = rng(bar * 173 + pos * 11 + Math.floor(bar / 32) * 3);
    const st = this.st;
    st.bass = st.bass || 41;
    // bass: one on each bar, walking through every other bar
    if (sub === 0) {
      const walk = bar % 2 === 1;
      let m = null;
      if (beat === 0) m = ch.root;
      else if (walk && beat === 1) m = ch.tones[0] - 12;
      else if (walk && beat === 2) m = next.root + (r() < 0.5 ? 1 : -1);
      else if (!walk && beat === 2 && r() < 0.6) m = ch.root + 7;
      if (m !== null) {
        m = near(m, st.bass, 33, 50);
        st.bass = m;
        tone(t, m, sd * (beat === 0 && !walk ? 5 : 2.6), { wave: 'triangle', gain: 0.24, attack: 0.006, release: 0.08, room: 0.12 });
      }
    }
    if (pos === 0) crackle(t, sd * this.perBar, 3, { lo: 500, hi: 1600, loud: 0.6 });
    // brushes and ride
    if (sub === 0) hiss(t, beat === 0 ? 0.3 : 0.12, { type: 'bandpass', freq: beat === 0 ? 2600 : 5200, q: 0.7, gain: beat === 0 ? 0.03 : 0.02, attack: beat === 0 ? 0.05 : 0.003, room: 0.35 });
    if (sub === 0) hiss(t, 0.22, { freq: 8200, gain: beat === 0 ? 0.026 : 0.016, room: 0.3 });
    if (sub === 2 && beat === 1) hiss(t, 0.1, { freq: 8500, gain: 0.012, room: 0.3 });
    if (pos === 0) thump(t, { gain: 0.05 });
    // comping: oom-pah-pah
    if (sub === 0 && beat > 0 && r() < 0.85) {
      ch.tones.forEach(m => tone(t, m, sd * 1.6, { wave: 'p25', gain: 0.013, attack: 0.006, release: 0.2, cutoff: 1500, room: 0.4 }));
    }
    // melody: vibes for eight bars, a breathy flute for the next eight
    if (pos === 0 && bar % 4 === 0) st.phrase = r() < 0.75;
    const flute = Math.floor(bar / 8) % 2 === 1;
    st.busy = st.busy || 0;
    if (st.phrase && (sub === 0 || (sub === 2 && r() < 0.4)) && r() < 0.5 && (!flute || t >= st.busy)) {
      st.line = st.line || 72;
      const pool = r() < 0.6 ? ch.tones.map(m => m + 12) : this.scale;
      const cands = pool.filter(m => Math.abs(m - st.line) <= 5 && m >= 64 && m <= 84);
      const m = cands[Math.floor(r() * cands.length)] || st.line;
      st.line = m;
      if (flute) {
        const len = sd * (r() < 0.4 ? 5 : 2.6);
        tone(t, m, len, { wave: 'triangle', gain: 0.045, attack: 0.06, release: 0.25, vibrato: 4, echo: 0.12, room: 0.5 });
        st.busy = t + len + 0.2;
      } else tone(t, m, sd * 1.4, { wave: 'sine', gain: 0.05, attack: 0.003, release: 0.9, vibrato: 2.5, echo: 0.18, room: 0.55 });
    }
  },
};

// ------------------------------------------------------------------ Last Call
// Noir. C minor, slow swung triplets. Two-feel upright bass, swirling brushes,
// low piano voicings, a muted trumpet that lets its notes fall away. Rain on the window.
const NOIR = {
  bpm: 58, perBeat: 3, perBar: 12, echoTime: 0.52, echoFb: 0.32, level: 0.92, cutoff: 2500,
  form: [
    { root: 36, tones: [51, 55, 59, 62] }, // Cm(maj7)
    { root: 36, tones: [51, 55, 58, 62] }, // Cm7
    { root: 41, tones: [56, 60, 63, 67] }, // Fm9
    { root: 41, tones: [56, 60, 62, 65] }, // Fm6
    { root: 38, tones: [50, 53, 56, 60] }, // Dm7b5
    { root: 43, tones: [53, 56, 59, 62] }, // G7b9
    { root: 36, tones: [51, 55, 57, 60] }, // Cm6
    { root: 44, tones: [51, 54, 56, 60] }, // Ab7
  ],
  blues: [60, 63, 65, 66, 67, 70, 72, 75, 77],
  bed(t) { return bed(t, { lp: 3800, hp: 900, gain: 0.02, swell: 0.05, swellDepth: 0.3 }); },
  play(n, t, sd) {
    const bar = Math.floor(n / this.perBar), pos = n % this.perBar;
    const beat = Math.floor(pos / 3), sub = pos % 3;
    const ch = this.form[bar % this.form.length];
    const next = this.form[(bar + 1) % this.form.length];
    const r = rng(bar * 97 + pos * 23 + Math.floor(bar / 16) * 11);
    const st = this.st;
    st.bass = st.bass || 36;
    // upright bass: two-feel, walking into the turnaround
    if (sub === 0) {
      const walk = bar % 4 === 3;
      let m = null;
      if (beat === 0) m = ch.root;
      else if (beat === 2 && !walk) m = ch.root + 7;
      else if (walk) m = beat === 3 ? next.root + 1 : ch.tones[beat % ch.tones.length] - 24;
      if (m !== null) {
        m = near(m, st.bass, 31, 48);
        st.bass = m;
        tone(t, m, sd * (walk ? 2.6 : 5.2), { wave: 'triangle', gain: 0.27, attack: 0.008, release: 0.12 });
      }
    }
    // brushes: a slow swirl on every beat, soft ride, a rim click now and then
    if (sub === 0) hiss(t, sd * 2.6, { type: 'bandpass', freq: 2200, q: 0.5, gain: 0.018, attack: sd * 1.2 });
    if (sub === 0 && (beat === 1 || beat === 3)) hiss(t, 0.3, { freq: 8000, gain: 0.02 });
    if (sub === 2 && (beat === 1 || beat === 3)) hiss(t, 0.14, { freq: 8500, gain: 0.011 });
    if (pos === 9 && r() < 0.35) { hiss(t, 0.03, { type: 'bandpass', freq: 1300, q: 3, gain: 0.05 }); thump(t, { freq: 420, gain: 0.02, dur: 0.04 }); }
    // piano: dark, low, sustained voicings
    if (pos === 0 || (pos === 8 && r() < 0.35)) {
      ch.tones.forEach((m, i) => tone(t + i * 0.012, m - (i === 0 ? 12 : 0), sd * 8, { wave: 'sine', gain: 0.03, attack: 0.004, release: 1.4, room: 0.25 }));
    }
    // muted trumpet: one voice. Each note finishes (plus a breath) before the next begins.
    // Phrases of mixed short and held notes, slurred one into the next, with a breath between phrases.
    if (pos === 0 && bar % 2 === 0) { st.phrase = r() < 0.75; st.left = 3 + Math.floor(r() * 5); }
    st.busy = st.busy || 0;
    const onBeat = sub === 0 || (sub === 2 && r() < 0.45);
    if (st.phrase && st.left > 0 && onBeat && t >= st.busy - 0.005 && r() < 0.8) {
      st.line = st.line || 67;
      const pool = r() < 0.6 ? ch.tones.map(m => m + 12) : this.blues;
      const cands = pool.filter(m => Math.abs(m - st.line) <= 5 && m >= 58 && m <= 77);
      const m = cands[Math.floor(r() * cands.length)] || st.line;
      st.line = m;
      st.left--;
      const last = st.left === 0;
      // length in triplet steps: a swung eighth, a beat, a beat and a half, two beats… held longer at phrase ends
      const steps = last ? [6, 9, 12][Math.floor(r() * 3)] : [2, 2, 3, 3, 3, 4, 6][Math.floor(r() * 7)];
      const len = steps * sd * 0.94;
      const fall = last && steps >= 9 && r() < 0.4;
      tone(t, m, len, { wave: 'sawtooth', gain: 0.042, attack: steps <= 3 ? 0.04 : 0.08, release: 0.09, vibrato: steps >= 6 ? 4.5 : 1.5, cutoff: 1250, echo: 0.06, room: 0.45, bend: fall ? -3 : 0 });
      st.busy = t + len + 0.04 + (last ? sd * 3 * (1 + Math.floor(r() * 3)) : 0);
    }
  },
};

const PROGRAMS = { fog: FOG, tide: TIDE, rain: RAIN, harbor: HARBOR, waltz: WALTZ, noir: NOIR };

function startStation(prog, t) {
  stopBeds(t);
  warm.frequency.setValueAtTime(prog.cutoff || 3400, t);
  send._delay.delayTime.value = prog.echoTime;
  send._fb.gain.value = prog.echoFb;
  prog.last = undefined; prog.comp = undefined; prog.line = undefined; prog.phrase = undefined;
  prog.st = {};
  if (prog.bed) beds = prog.bed(t) || [];
}
function stopBeds(at) {
  for (const n of beds) { try { n.stop(at); } catch { /* already stopped */ } }
  beds = [];
}

function schedule() {
  const prog = PROGRAMS[current];
  if (!prog) return;
  const sd = 60 / prog.bpm / prog.perBeat;
  const ahead = document.hidden ? 1.5 : 0.25;
  while (nextTime < ctx.currentTime + ahead) {
    let t = nextTime;
    prog.play(step, t, sd);
    step++;
    nextTime += sd;
  }
}

export function play(station) {
  if (!PROGRAMS[station]) return stop();
  setup();
  if (ctx.state === 'suspended') ctx.resume();
  const prog = PROGRAMS[station];
  startStation(prog, ctx.currentTime);
  // fade in
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(0.0001, ctx.currentTime);
  out.gain.linearRampToValueAtTime(volume * prog.level, ctx.currentTime + 1.5);
  current = station;
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  clearInterval(timer);
  timer = setInterval(schedule, 40);
  schedule();
  emit();
}

export function stop() {
  if (!current) return;
  current = null;
  clearInterval(timer);
  timer = null;
  if (ctx) {
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0.0001, now + 0.6);
    stopBeds(now + 0.7);
  }
  emit();
}

export function setVolume(v) {
  volume = v;
  if (ctx && current) {
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setTargetAtTime(v * PROGRAMS[current].level, ctx.currentTime, 0.05);
  }
}

export const playing = () => current;

// Render a station to raw samples without playing it (used by tests to check levels).
export async function renderOffline(station, seconds = 20) {
  const prev = ctx;
  const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
  setup(off);
  const prog = PROGRAMS[station];
  const liveBeds = beds;
  beds = [];
  startStation(prog, 0.05);
  out.gain.value = 1;
  const sd = 60 / prog.bpm / prog.perBeat;
  for (let n = 0, t = 0.05; t < seconds - 0.5; n++, t += sd) prog.play(n, t, sd);
  const buf = await off.startRendering();
  ctx = prev;
  beds = liveBeds;
  if (prev) setup(prev);
  return buf.getChannelData(0);
}
export function onChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(current); }

// Resume after the phone wakes or the app comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx && current && ctx.state !== 'running') ctx.resume();
});
