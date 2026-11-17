// Synthesized typewriter sounds (no audio files needed).
let ctx = null, master = null, noise = null;
let volume = 0.5;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

function burst(t, { freq = 2500, q = 1.2, dur = 0.035, gain = 0.6, offset = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t, offset, dur + 0.02);
}

function thump(t, freq = 140, dur = 0.05, gain = 0.5) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.01);
}

function bell(t) {
  for (const [f, gv, d] of [[2093, 0.25, 1.4], [4186, 0.08, 0.8], [3136, 0.05, 0.6]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gv, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + d + 0.05);
  }
}

function zip(t) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 3;
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.32);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.04);
  g.gain.linearRampToValueAtTime(0.25, t + 0.28);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.2);
  src.stop(t + 0.4);
  burst(t + 0.38, { freq: 1800, dur: 0.06, gain: 0.7 });
}

export function play(kind) {
  if (!ac()) return;
  const t = ctx.currentTime + 0.001;
  const off = Math.random() * 0.4;
  const jitter = 0.85 + Math.random() * 0.3;
  switch (kind) {
    case 'enter':
      bell(t);
      zip(t + 0.12);
      break;
    case 'space':
      burst(t, { freq: 1400 * jitter, dur: 0.05, gain: 0.55, offset: off });
      thump(t, 110, 0.07, 0.45);
      break;
    case 'back':
      burst(t, { freq: 3200 * jitter, dur: 0.025, gain: 0.35, offset: off });
      break;
    default:
      burst(t, { freq: 2600 * jitter, q: 1.5, dur: 0.03, gain: 0.6, offset: off });
      burst(t + 0.012, { freq: 900 * jitter, dur: 0.03, gain: 0.3, offset: off });
      thump(t, 160 * jitter, 0.04, 0.3);
  }
}
