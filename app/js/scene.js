// The writer's window: a pixel-art Pacific Northwest coastline seen from a cabin desk,
// with a typewriter that types along with you.
const H = 64;
const HORIZON = 30;
const SHORE = 46;
const SILL = 53;
const DESK = 57;

const PALETTES = {
  dawn: {
    sky: ['#2b2d52', '#4f456f', '#93607e', '#d98a83', '#f2b994'],
    sun: '#ffe2a8', sea: ['#4a5478', '#5f6787', '#7d7c99'], seaHi: '#f5c7a6',
    far: '#5d5a7d', farDark: '#4a4767', rock: '#2a2a3e', rockHi: '#7a6378',
    sand: '#a99083', sandWet: '#857080', foam: '#f6e8df',
    tree: '#17232c', treeHi: '#2a3b44', cloud: '#e6a6a0', fog: '#d9c3cf',
    desk: '#6a4429', deskHi: '#86593a', deskDark: '#4a2e1b', wood: '#4f321f', woodHi: '#6f4a30',
    gull: '#2a2a3e', star: 0, shade: 0.12,
  },
  day: {
    sky: ['#6f9bbd', '#8db2cc', '#a9c6d9', '#c4d8e2', '#dbe7ea'],
    sun: '#fffbe6', sea: ['#2d5c72', '#3b7487', '#56909f'], seaHi: '#d5edf0',
    far: '#6f8e99', farDark: '#5d7c88', rock: '#3a3e44', rockHi: '#737a82',
    sand: '#cbb995', sandWet: '#a9997d', foam: '#ffffff',
    tree: '#1d3a2c', treeHi: '#2f5a40', cloud: '#f4f7f8', fog: '#e4eaec',
    desk: '#7a4f30', deskHi: '#996641', deskDark: '#56361f', wood: '#5b3a24', woodHi: '#7d5536',
    gull: '#3a3e44', star: 0, shade: 0,
  },
  dusk: {
    sky: ['#1e1c3c', '#3d2c57', '#7a3f63', '#c9604f', '#eea05a'],
    sun: '#ffc96b', sea: ['#2a2845', '#423659', '#6d475c'], seaHi: '#f5a35c',
    far: '#3b2f4e', farDark: '#2c233c', rock: '#18141f', rockHi: '#5c3a50',
    sand: '#86665e', sandWet: '#6a5058', foam: '#f6d6c2',
    tree: '#121520', treeHi: '#20263a', cloud: '#c26d78', fog: '#9b7d93',
    desk: '#5a3922', deskHi: '#734a2d', deskDark: '#3c2414', wood: '#432a19', woodHi: '#5d3c26',
    gull: '#18141f', star: 0.3, shade: 0.22,
  },
  night: {
    sky: ['#05070f', '#090f20', '#0f182f', '#152140', '#1c2b50'],
    sun: '#e9ecd8', sea: ['#0a1324', '#111d36', '#192947'], seaHi: '#9fb4da',
    far: '#121a2d', farDark: '#0c1222', rock: '#060810', rockHi: '#25304a',
    sand: '#292b38', sandWet: '#20222f', foam: '#8c99b5',
    tree: '#03050a', treeHi: '#0b111e', cloud: '#26324f', fog: '#3f4a63',
    desk: '#3c2617', deskHi: '#4f3320', deskDark: '#26170d', wood: '#2c1c11', woodHi: '#3d2819',
    gull: '#9aa6c0', star: 1, shade: 0.4,
  },
};

const GREY = { sky: ['#5c646b', '#737b81', '#8a9196', '#a0a6aa', '#b4b9bc'], sea: ['#3a4a52', '#475961', '#566a70'] };

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function autoTime(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 5.5 && h < 8.5) return 'dawn';
  if (h >= 8.5 && h < 17) return 'day';
  if (h >= 17 && h < 20.5) return 'dusk';
  return 'night';
}
function autoWeather(d = new Date()) {
  const key = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
  const r = rng(key)();
  // It's the Pacific Northwest.
  return r < 0.3 ? 'clear' : r < 0.6 ? 'drizzle' : r < 0.8 ? 'fog' : 'rain';
}

export function createScene(canvas, initial = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 320;
  let opts = { time: 'auto', weather: 'auto', body: '#6fa596', bodyHi: '#97c7b8', bodyLo: '#4b7b6d', motion: true, ...initial };
  let world = null;
  let raf = 0, last = 0, t0 = performance.now();
  let running = true;

  // Typewriter state
  const tw = {
    lines: [0], chars: 0, strike: 0, pressed: -1, pressedT: 0,
    carriage: 0, returning: 0, ding: 0, feed: 0,
  };

  function build() {
    const r = rng(W * 7919 + 17);
    const farEnd = Math.floor(W * 0.36);
    const ridge = [];
    let h = 7;
    for (let x = 0; x < farEnd + 8; x++) {
      h += (r() - 0.5) * 1.6;
      const fall = x > farEnd - 18 ? (x - (farEnd - 18)) * 0.45 : 0;
      h = Math.max(2, Math.min(11, h));
      ridge.push(Math.max(0, Math.round(h - fall)));
    }
    const ridgeTrees = [];
    for (let x = 3; x < farEnd - 14; x += 2 + Math.floor(r() * 3)) ridgeTrees.push({ x, h: 2 + Math.floor(r() * 3) });

    const trees = [];
    const leftCount = Math.max(2, Math.round(W / 140));
    for (let i = 0; i < leftCount; i++) trees.push({ x: 4 + i * 9 + Math.floor(r() * 5), h: 34 + Math.floor(r() * 14) });
    for (let i = 0; i < leftCount; i++) trees.push({ x: W - 6 - i * 10 - Math.floor(r() * 5), h: 30 + Math.floor(r() * 16) });

    const stars = Array.from({ length: Math.floor(W / 6) }, () => ({ x: Math.floor(r() * W), y: 3 + Math.floor(r() * (HORIZON - 8)), p: r() * 6 }));
    const clouds = Array.from({ length: Math.max(3, Math.floor(W / 90)) }, () => ({ x: r() * W, y: 6 + Math.floor(r() * 14), w: 14 + Math.floor(r() * 22), s: 0.6 + r() * 1.2 }));
    const shimmer = [];
    for (let y = HORIZON + 1; y < SHORE + 2; y++) {
      const n = Math.max(2, Math.floor(W / 40));
      for (let i = 0; i < n; i++) shimmer.push({ y, x: r() * W, len: 2 + Math.floor(r() * 5), s: (r() - 0.5) * 3, p: r() * 6 });
    }
    const drops = Array.from({ length: Math.floor(W / 2.5) }, () => ({ x: r() * (W + 40), y: r() * H, s: 40 + r() * 30 }));
    const streaks = Array.from({ length: Math.max(3, Math.floor(W / 50)) }, () => ({ x: Math.floor(r() * W), y: r() * SILL, s: 0.6 + r() * 2 }));
    const stack = Math.floor(W * 0.6);
    world = { farEnd, ridge, ridgeTrees, trees, stars, clouds, shimmer, drops, streaks, stack, lighthouse: Math.floor(farEnd * 0.72), seed: r };
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const cssH = rect.height || 128;
    const scale = cssH / H;
    const nw = Math.max(160, Math.ceil((rect.width || 640) / scale));
    if (nw !== W || !world) {
      W = nw;
      canvas.width = W;
      canvas.height = H;
      build();
    }
    draw(performance.now());
  }

  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  function disc(cx, cy, rad, c) {
    ctx.fillStyle = c;
    for (let y = -rad; y <= rad; y++) {
      const w = Math.round(Math.sqrt(rad * rad - y * y));
      ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }

  function conifer(cx, base, h, c, hi) {
    for (let r = 0; r < h; r++) {
      const y = base - h + r;
      let hw = Math.floor(0.5 + r * 0.26);
      if (r % 5 === 0 && r > 4) hw -= Math.floor(r * 0.12);
      hw = Math.max(0, hw);
      px(cx - hw, y, hw * 2 + 1, 1, c);
      if (r % 2 === 1 && hw > 1) px(cx - hw, y, 1, 1, hi);
    }
    px(cx - 1, base, 3, 3, c);
  }

  function draw(now) {
    if (!world) return;
    const t = (now - t0) / 1000;
    const time = opts.time === 'auto' ? autoTime() : opts.time;
    const weather = opts.weather === 'auto' ? autoWeather() : opts.weather;
    const P = PALETTES[time] || PALETTES.day;
    const overcast = weather === 'clear' ? 0 : weather === 'drizzle' ? 0.35 : weather === 'fog' ? 0.45 : 0.55;
    const skyC = P.sky.map((c, i) => mix(c, time === 'night' ? mix(GREY.sky[i], '#000000', 0.8) : GREY.sky[i], overcast));
    const seaC = P.sea.map((c, i) => mix(c, time === 'night' ? mix(GREY.sea[i], '#000000', 0.7) : GREY.sea[i], overcast * 0.7));

    // Sky bands with dithered seams
    const band = HORIZON / skyC.length;
    for (let i = 0; i < skyC.length; i++) {
      const y0 = Math.floor(i * band), y1 = Math.floor((i + 1) * band);
      px(0, y0, W, y1 - y0, skyC[i]);
      if (i < skyC.length - 1) {
        ctx.fillStyle = skyC[i + 1];
        for (let x = (y1 - 1) % 2; x < W; x += 2) ctx.fillRect(x, y1 - 1, 1, 1);
      }
    }

    // Stars
    if (P.star && overcast < 0.5) {
      for (const s of world.stars) {
        const tw_ = Math.sin(t * 1.7 + s.p);
        if (tw_ > -0.3) px(s.x, s.y, 1, 1, tw_ > 0.7 ? '#ffffff' : '#9fb0d0');
      }
    }

    // Sun / moon
    let sx = 0, sy = 0;
    if (overcast < 0.5 || time === 'night') {
      if (time === 'dawn') { sx = Math.floor(W * 0.18); sy = HORIZON - 3; }
      else if (time === 'day') { sx = Math.floor(W * 0.78); sy = 8; }
      else if (time === 'dusk') { sx = Math.floor(W * 0.52); sy = HORIZON - 2; }
      else { sx = Math.floor(W * 0.82); sy = 8; }
      disc(sx, sy, time === 'day' ? 4 : 5, P.sun);
      if (time === 'night') disc(sx + 2, sy - 1, 4, skyC[1]);
    }

    // Clouds
    for (const c of world.clouds) {
      const x = ((c.x + t * c.s) % (W + c.w * 2)) - c.w;
      const col = mix(P.cloud, skyC[2], 0.25 - overcast * 0.2);
      px(x, c.y, c.w, 2, col);
      px(x + 3, c.y - 1, c.w - 7, 1, col);
      px(x + Math.floor(c.w * 0.3), c.y - 2, Math.floor(c.w * 0.35), 1, col);
      px(x + 1, c.y + 2, c.w - 3, 1, mix(col, skyC[3], 0.5));
    }

    // Gull
    const gp = (t % 28) / 28;
    if (gp < 0.6 && weather !== 'rain') {
      const gx = Math.floor(gp / 0.6 * (W + 20)) - 10;
      const gy = 14 + Math.round(Math.sin(t * 0.8) * 2);
      const up = Math.floor(t * 4) % 2;
      const pts = up ? [[-2, -1], [-1, 0], [0, 0], [1, 0], [2, -1]] : [[-2, 0], [-1, -1], [0, 0], [1, -1], [2, 0]];
      for (const [dx, dy] of pts) px(gx + dx, gy + dy, 1, 1, P.gull);
    }

    // Sea
    const seaRows = SHORE + 3 - HORIZON;
    for (let y = HORIZON; y < SHORE + 3; y++) {
      const k = (y - HORIZON) / seaRows;
      const c = k < 0.33 ? seaC[0] : k < 0.66 ? seaC[1] : seaC[2];
      px(0, y, W, 1, c);
    }
    ctx.globalAlpha = 0.7;
    for (const s of world.shimmer) {
      if (Math.sin(t * 2 + s.p) < 0) continue;
      const x = ((s.x + t * s.s) % W + W) % W;
      px(x, s.y, s.len, 1, P.seaHi);
    }
    // Sun / moon glint path
    if (sx && (time !== 'day')) {
      for (let y = HORIZON + 1; y < SHORE; y += 2) {
        const w = 2 + Math.floor((y - HORIZON) / 3) + (Math.sin(t * 3 + y) > 0 ? 1 : 0);
        px(sx - w, y, w * 2, 1, P.seaHi);
      }
    }
    ctx.globalAlpha = 1;

    // Far headland + lighthouse
    for (let x = 0; x < world.ridge.length; x++) {
      const h = world.ridge[x];
      if (h > 0) px(x, HORIZON - h, 1, h + 1, P.far);
    }
    for (const rt of world.ridgeTrees) {
      const base = HORIZON - world.ridge[rt.x];
      for (let i = 0; i < rt.h; i++) px(rt.x - Math.floor(i / 2), base - rt.h + i, 1 + 2 * Math.floor(i / 2), 1, P.farDark);
    }
    const lx = world.lighthouse, ly = HORIZON - world.ridge[lx] - 6;
    px(lx, ly, 2, 6, mix('#f2efe6', P.far, 0.35));
    px(lx, ly + 2, 2, 1, mix('#b2433a', P.far, 0.35));
    px(lx - 1, ly - 1, 4, 1, mix('#2a2a2a', P.far, 0.3));
    const lampOn = time !== 'day' || weather === 'fog';
    px(lx, ly - 2, 2, 1, lampOn ? '#ffe9a0' : mix('#cfcfcf', P.far, 0.3));
    if (lampOn) {
      const dir = Math.cos(t * 0.9);
      const len = Math.floor(Math.abs(dir) * 40) + 2;
      const sgn = dir > 0 ? 1 : -1;
      for (let i = 1; i < len; i++) {
        ctx.globalAlpha = 0.55 * (1 - i / len);
        px(lx + (sgn > 0 ? 1 : 0) + sgn * i, ly - 2 + Math.floor(i / 14), 1, 1 + Math.floor(i / 12), '#fff2b8');
      }
      ctx.globalAlpha = 1;
    }

    // Sea stacks (a big haystack and two needles)
    const st = world.stack;
    const stackBase = SHORE + 1;
    const hh = 19;
    for (let r = 0; r < hh; r++) {
      const k = r / hh;
      const hw = Math.round(11 * Math.sqrt(k) + (r % 3 === 0 ? 1 : 0) * (k > 0.3 ? 1 : 0));
      const y = stackBase - hh + r;
      px(st - hw, y, hw * 2 + 1, 1, P.rock);
      px(st - hw, y, 1, 1, P.rockHi);
      if (r % 4 === 2 && hw > 3) px(st - hw + 2, y, 2, 1, P.rockHi);
    }
    px(st - 2, stackBase - hh - 1, 4, 1, P.rock);
    for (const [dx, h, w] of [[17, 10, 2], [22, 6, 1], [-17, 5, 2]]) {
      for (let r = 0; r < h; r++) {
        const ww = r < 2 ? 1 : w + Math.floor(r / 4);
        px(st + dx - Math.floor(ww / 2), stackBase - h + r, ww, 1, P.rock);
      }
      px(st + dx - Math.floor(w / 2), stackBase - h + 1, 1, h - 1, P.rockHi);
    }
    // Surf around the rocks
    for (let i = -13; i <= 26; i++) {
      if (Math.sin(t * 2.4 + i * 1.7) > 0.2) px(st + i, stackBase - 1 + (Math.sin(t + i) > 0.6 ? -1 : 0), 1, 1, P.foam);
    }

    // Shoreline, foam, sand
    for (let x = 0; x < W; x++) {
      const sh = SHORE + 2 + Math.round(Math.sin(x * 0.06 + t * 0.7) * 1 + Math.sin(t * 0.55) * 1.4);
      px(x, sh, 1, SILL - sh, P.sand);
      px(x, sh, 1, 1, P.sandWet);
      if (Math.sin(x * 0.9 + t * 3) > -0.5) px(x, sh - 1, 1, 1, P.foam);
      if (x % 7 === 0 && Math.sin(x + t * 1.5) > 0.5) px(x, sh - 3, 2, 1, P.foam);
    }
    // Driftwood
    const dw = Math.floor(W * 0.42);
    px(dw, SILL - 3, 11, 1, mix('#b9a184', P.sand, 0.3));
    px(dw + 2, SILL - 2, 9, 1, mix('#8a7560', P.sand, 0.3));
    px(dw + 10, SILL - 4, 1, 1, mix('#b9a184', P.sand, 0.3));

    // Foreground conifers
    for (const tr of world.trees) conifer(tr.x, SILL, tr.h, P.tree, P.treeHi);

    // Weather
    if (weather === 'fog' || weather === 'drizzle') {
      ctx.globalAlpha = weather === 'fog' ? 0.38 : 0.18;
      for (const [yc, amp, sp, k] of [[HORIZON - 4, 3, 0.25, 0], [HORIZON + 6, 2, -0.18, 2], [SHORE - 2, 2, 0.12, 4]]) {
        for (let x = 0; x < W; x += 2) {
          const th = Math.max(1, Math.round(amp + 2 * Math.sin(x * 0.045 + t * sp + k)));
          px(x, yc - th, 2, th * 2, P.fog);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (weather === 'rain' || weather === 'drizzle') {
      const n = weather === 'rain' ? world.drops.length : Math.floor(world.drops.length / 3);
      ctx.fillStyle = time === 'night' ? '#55617e' : '#c9d6dd';
      ctx.globalAlpha = weather === 'rain' ? 0.55 : 0.4;
      for (let i = 0; i < n; i++) {
        const d = world.drops[i];
        const y = (d.y + t * d.s) % (SILL + 6);
        const x = ((d.x - (y * 0.3)) % (W + 40));
        ctx.fillRect(Math.round(x), Math.round(y), 1, weather === 'rain' ? 3 : 2);
      }
      ctx.globalAlpha = 1;
    }

    // Window glass reflection + raindrops on glass
    ctx.globalAlpha = 0.07;
    for (let k = 0; k < W; k += 70) {
      for (let i = 0; i < 18; i++) px(k + 20 + i, 6 + i, 3, 1, '#ffffff');
    }
    ctx.globalAlpha = 1;
    if (weather === 'rain' || weather === 'drizzle') {
      ctx.globalAlpha = 0.5;
      for (const s of world.streaks) {
        const y = (s.y + t * s.s) % SILL;
        px(s.x, y, 1, 2, time === 'night' ? '#6c7b9a' : '#e8f0f2');
        px(s.x, y - 3, 1, 1, time === 'night' ? '#4e5a75' : '#d0dde2');
      }
      ctx.globalAlpha = 1;
    }

    // Window frame
    px(0, 0, W, 3, P.wood); px(0, 2, W, 1, P.woodHi);
    px(0, 0, 3, SILL, P.wood); px(W - 3, 0, 3, SILL, P.wood);
    const panes = Math.max(1, Math.round(W / 110));
    for (let k = 1; k < panes; k++) {
      const x = Math.floor((k * W) / panes) - 1;
      px(x, 0, 3, SILL, P.wood);
      px(x, 0, 1, SILL, P.woodHi);
    }
    px(0, SILL, W, 4, P.wood);
    px(0, SILL, W, 1, P.woodHi);

    // Desk
    px(0, DESK, W, H - DESK, P.desk);
    px(0, DESK, W, 1, P.deskHi);
    for (let x = (W % 23); x < W; x += 23) px(x, DESK + 2, 1, H - DESK - 2, P.deskDark);
    px(0, H - 2, W, 2, P.deskDark);

    // Books on the left of the desk
    const bx = 8;
    px(bx, DESK - 3, 16, 3, '#38624f'); px(bx, DESK - 3, 16, 1, '#4f7e68');
    px(bx + 1, DESK - 6, 14, 3, '#9a4d3c'); px(bx + 1, DESK - 6, 14, 1, '#bb6a55');
    px(bx + 2, DESK - 8, 13, 2, '#2f4f6b'); px(bx + 2, DESK - 8, 13, 1, '#45698a');
    px(bx + 4, DESK - 7, 6, 1, '#d8c69a');

    // Typewriter
    drawTypewriter(P, t);

    // Lamp light at night
    if (P.shade) {
      ctx.globalAlpha = P.shade;
      px(0, 0, W, H, '#0a0b1a');
      ctx.globalAlpha = 1;
      if (time === 'night' || time === 'dusk') {
        const cxl = W - 70 > 30 ? W - 74 : 30;
        const flick = 0.85 + Math.sin(t * 9) * 0.05 + Math.sin(t * 13.7) * 0.05;
        const g = ctx.createRadialGradient(cxl, DESK - 4, 1, cxl, DESK - 4, 46);
        g.addColorStop(0, `rgba(255,190,110,${0.38 * flick})`);
        g.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cxl - 50, 0, 100, H);
        // candle in a jar
        px(cxl - 2, DESK - 6, 5, 6, '#8fa9a8'); px(cxl - 2, DESK - 6, 5, 1, '#b8cccb');
        px(cxl - 1, DESK - 5, 3, 4, '#efe2c4');
        px(cxl, DESK - 8 + (flick > 0.88 ? 0 : 1), 1, 2, '#ffd27a');
        px(cxl, DESK - 7, 1, 1, '#fff5c8');
      }
    }
  }

  function drawTypewriter(P, t) {
    const x0 = W - 50 > 60 ? W - 50 : W - 42;
    const by = DESK + 1;
    const y0 = by - 22;
    // Coffee mug + steam
    const mx = x0 - 13;
    px(mx, DESK - 6, 6, 6, '#d9d2c3'); px(mx, DESK - 6, 6, 1, '#f1ece0'); px(mx, DESK - 1, 6, 1, '#b3ab9b');
    px(mx + 6, DESK - 5, 2, 1, '#d9d2c3'); px(mx + 7, DESK - 5, 1, 3, '#d9d2c3'); px(mx + 6, DESK - 3, 2, 1, '#d9d2c3');
    px(mx + 1, DESK - 5, 4, 1, '#4a2c1a');
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.7 + i / 3) % 1;
      const sy = DESK - 8 - Math.floor(ph * 10);
      const sxp = mx + 2 + Math.round(Math.sin(t * 2 + i * 2 + ph * 6) * 1.5);
      px(sxp, sy, 1, 2, '#e8eef0');
    }
    ctx.globalAlpha = 1;

    // Carriage motion
    if (tw.returning > 0) {
      tw.returning = Math.max(0, tw.returning - 0.12);
      tw.carriage = Math.round(tw.carriage * tw.returning);
    } else {
      tw.carriage = -Math.min(10, Math.floor(tw.chars / 4));
    }
    const co = tw.carriage;

    // Paper
    const pX = x0 + 11 + co;
    const lines = tw.lines.slice(-4);
    const ph = 9 + Math.min(3, tw.lines.length - 1);
    px(pX, y0 - ph + 9, 14, ph, '#f3ecd9');
    px(pX + 13, y0 - ph + 9, 1, ph, '#d8cfb8');
    lines.forEach((len, i) => {
      const y = y0 - ph + 10 + i * 2;
      if (len > 0) px(pX + 2, y, Math.min(10, len), 1, '#4b4a48');
    });
    // Carriage / platen
    px(x0 + 3 + co, y0 + 8, 30, 3, '#1d1d1f');
    px(x0 + 3 + co, y0 + 8, 30, 1, '#3d3d42');
    px(x0 + 1 + co, y0 + 7, 2, 5, '#2b2b2e');
    px(x0 + 33 + co, y0 + 7, 2, 5, '#2b2b2e');
    // Return lever
    px(x0 - 1 + co, y0 + 6, 3, 1, '#b8bcc0');
    px(x0 - 2 + co, y0 + 5, 1, 1, '#b8bcc0');
    if (tw.ding > 0) {
      tw.ding--;
      px(x0 + 37 + co, y0 + 4, 1, 1, '#fff6c8');
      px(x0 + 38 + co, y0 + 3, 1, 1, '#fff6c8');
      px(x0 + 36 + co, y0 + 3, 1, 1, '#fff6c8');
    }
    // Body (trapezoid)
    for (let r = 0; r < 11; r++) {
      const inset = Math.max(0, 3 - Math.floor(r / 3));
      px(x0 + inset, y0 + 11 + r, 36 - inset * 2, 1, r === 0 ? opts.bodyHi : r === 10 ? opts.bodyLo : opts.body);
    }
    // Typebar basket + ribbon spools
    px(x0 + 13, y0 + 11, 10, 2, '#202022');
    px(x0 + 5, y0 + 11, 3, 1, '#7d2b2b');
    px(x0 + 28, y0 + 11, 3, 1, '#7d2b2b');
    // Strike
    if (tw.strike > 0) {
      tw.strike--;
      px(x0 + 18, y0 + 9, 1, 3, '#c9cdd1');
      px(x0 + 17, y0 + 8, 3, 1, '#e7eaee');
    }
    // Keys
    let k = 0;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 9 - row; i++, k++) {
        const kx = x0 + 5 + row + i * 3;
        const ky = y0 + 14 + row * 2;
        const down = tw.pressed === k && tw.pressedT > 0;
        px(kx, ky + (down ? 1 : 0), 2, 1, down ? '#9d968a' : '#efe7d6');
        if (!down) px(kx, ky + 1, 2, 1, '#2a2a2c');
      }
    }
    const spaceDown = tw.pressed === 99 && tw.pressedT > 0;
    px(x0 + 11, y0 + 20 + (spaceDown ? 1 : 0), 14, 1, spaceDown ? '#9d968a' : '#efe7d6');
    if (tw.pressedT > 0) tw.pressedT--;
  }

  function frame(now) {
    if (!running) return;
    const interval = opts.motion ? 1000 / 12 : 4000;
    if (now - last >= interval) {
      last = now;
      draw(now);
    }
    raf = requestAnimationFrame(frame);
  }

  function key(kind) {
    if (kind === 'enter') {
      tw.lines.push(0);
      if (tw.lines.length > 40) tw.lines.splice(0, 20);
      tw.chars = 0;
      tw.returning = 1;
      tw.ding = 6;
    } else if (kind === 'back') {
      tw.chars = Math.max(0, tw.chars - 1);
      tw.lines[tw.lines.length - 1] = Math.floor(tw.chars / 3);
    } else {
      tw.chars++;
      if (tw.chars > 44) { tw.chars = 0; tw.lines.push(0); tw.returning = 1; }
      tw.lines[tw.lines.length - 1] = Math.floor(tw.chars / 3);
      tw.strike = 2;
      tw.pressed = kind === 'space' ? 99 : Math.floor(Math.random() * 24);
      tw.pressedT = 2;
    }
    if (running) draw(performance.now());
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement);
  const onVis = () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVis);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    key,
    resize,
    setOptions(o) { opts = { ...opts, ...o }; draw(performance.now()); },
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    current() { return { time: opts.time === 'auto' ? autoTime() : opts.time, weather: opts.weather === 'auto' ? autoWeather() : opts.weather }; },
  };
}
