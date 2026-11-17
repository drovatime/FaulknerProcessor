// The cabin radio: two original 8-bit stations, synthesized live with Web Audio.
//   Fog Line       — slow, misty, dreamy: sustained pads, echoing arpeggios, a lonely melody.
//   Harbor Lights  — late-night jazz trio: walking bass, brushes and ride, soft chord comping, vibes.
// The music is generated from chord progressions with gentle randomness, so it never
// repeats exactly but always settles back into the same mood.

let ctx = null, mix, out, send, waves = {}, noiseBuf = null;
let timer = null, nextTime = 0, step = 0, current = null;
let volume = 0.5;
const listeners = new Set();

export const STATIONS = {
  fog: { name: 'Fog Line', blurb: 'Slow, misty synth for long nights' },
  harbor: { name: 'Harbor Lights', blurb: 'Walking bass, brushes and vibes' },
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
  const warm = ctx.createBiquadFilter();
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
  waves.p12 = pulseWave(0.125);
  waves.p25 = pulseWave(0.25);
  waves.p50 = pulseWave(0.5);
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

function tone(t, midi, dur, { wave = 'triangle', gain = 0.1, attack = 0.01, release = 0.12, echo = 0, vibrato = 0, cutoff = 0 } = {}) {
  const o = ctx.createOscillator();
  if (waves[wave]) o.setPeriodicWave(waves[wave]); else o.type = wave;
  o.frequency.setValueAtTime(midiHz(midi), t);
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
  o.start(t);
  o.stop(t + dur + release + 0.05);
}

function hiss(t, dur, { type = 'highpass', freq = 7000, q = 0.7, gain = 0.05, attack = 0.002 } = {}) {
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

const PROGRAMS = { fog: FOG, harbor: HARBOR };

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
  send._delay.delayTime.value = prog.echoTime;
  send._fb.gain.value = prog.echoFb;
  // fade in
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(0.0001, ctx.currentTime);
  out.gain.linearRampToValueAtTime(volume * prog.level, ctx.currentTime + 1.5);
  current = station;
  step = 0;
  prog.last = undefined; prog.comp = undefined; prog.line = undefined;
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
  send._delay.delayTime.value = prog.echoTime;
  send._fb.gain.value = prog.echoFb;
  out.gain.value = 1;
  const sd = 60 / prog.bpm / prog.perBeat;
  prog.last = undefined; prog.comp = undefined; prog.line = undefined;
  for (let n = 0, t = 0.05; t < seconds - 0.5; n++, t += sd) prog.play(n, t, sd);
  const buf = await off.startRendering();
  ctx = prev;
  if (prev) setup(prev);
  return buf.getChannelData(0);
}
export function onChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(current); }

// Resume after the phone wakes or the app comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx && current && ctx.state !== 'running') ctx.resume();
});
