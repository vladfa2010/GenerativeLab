/* ============================================================
   GAME ART ENGINE — монтирует играбельные веб-демо арт-работ
   mountGame(holder, gameId, opts) -> { destroy, restart, canvas }
   opts: { seed, onScore(score), onEvent(name, data) }
   ============================================================ */
const GameArt = (() => {
  const W = 960, H = 540;

  /* ---------- utils ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function valueNoise(seed) {
    const r = mulberry32(seed), g = new Float32Array(512);
    for (let i = 0; i < 512; i++) g[i] = r();
    const at = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const h = (X, Y) => g[((X * 73 + Y * 199) & 511 + 512) & 511];
      return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) +
             h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v;
    };
    return (x, y, oct = 3) => {
      let sum = 0, amp = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { sum += at(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.1; }
      return sum / norm;
    };
  }

  /* ---------- audio (ленивый WebAudio, короткие блипы) ---------- */
  let AC = null, muted = false;
  function ac() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, dur = 0.12, type = 'square', vol = 0.05, slide = 0) {
    if (muted) return; const ctx = ac(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }
  function chord(freqs, dur = 1.6, type = 'sine', vol = 0.04) {
    freqs.forEach((f, i) => setTimeout(() => tone(f, dur, type, vol), i * 60));
  }
  document.addEventListener('pointerdown', () => ac(), { once: true });
  document.addEventListener('keydown', () => ac(), { once: true });

  /* ---------- input ---------- */
  const held = {}, pressedSet = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (!held[e.code]) pressedSet.add(e.code);
    held[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { held[e.code] = false; });

  /* ---------- ядро ---------- */
  function mountGame(holder, gameId, opts = {}) {
    const game = GAMES[gameId];
    if (!game) { holder.innerHTML = '<div style="color:#939393;padding:40px;">Демо не найдено</div>'; return null; }
    const seed = opts.seed !== undefined ? opts.seed : String((Math.random() * 1e9) | 0);

    holder.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'ga-shell';
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.className = 'ga-canvas';
    canvas.setAttribute('tabindex', '0');
    shell.appendChild(canvas);
    if (game.touch) {
      const tc = document.createElement('div');
      tc.className = 'ga-touch';
      game.touch.forEach((btn) => {
        const b = document.createElement('button');
        b.className = 'ga-tbtn ga-tbtn-' + btn;
        b.textContent = { left: '◀', right: '▶', up: '▲', down: '▼', a: 'A', b: 'B' }[btn] || btn;
        const code = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', a: 'KeyZ', b: 'KeyX' }[btn];
        const dn = (e) => { e.preventDefault(); if (!held[code]) pressedSet.add(code); held[code] = true; ac(); };
        const up = (e) => { e.preventDefault(); held[code] = false; };
        b.addEventListener('pointerdown', dn);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('pointercancel', up);
        tc.appendChild(b);
      });
      shell.appendChild(tc);
    }
    holder.appendChild(shell);

    const ctx = canvas.getContext('2d');
    const pointer = { x: 0, y: 0, down: false, clicked: false, released: false };
    function toLocal(e) {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (W / r.width), y: (t.clientY - r.top) * (H / r.height) };
    }
    const pd = (e) => { const p = toLocal(e); pointer.x = p.x; pointer.y = p.y; pointer.down = true; pointer.clicked = true; ac(); if (e.cancelable) e.preventDefault(); };
    const pu = (e) => { pointer.down = false; pointer.released = true; if (e.cancelable) e.preventDefault(); };
    const pm = (e) => { const p = toLocal(e); pointer.x = p.x; pointer.y = p.y; };
    canvas.addEventListener('mousedown', pd);
    canvas.addEventListener('mouseup', pu);
    canvas.addEventListener('mousemove', pm);
    canvas.addEventListener('touchstart', pd, { passive: false });
    canvas.addEventListener('touchend', pu, { passive: false });
    canvas.addEventListener('touchmove', pm, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const api = {
      W, H, ctx, canvas, pointer, seed,
      rand: mulberry32(hashStr(seed)),
      noise: valueNoise(hashStr(seed) ^ 0x9e3779b9),
      keys: held, time: 0, over: false, overText: '', score: null,
      tone, chord, muted: () => muted,
      setMuted(m) { muted = m; },
      key(c) { return !!held[c]; },
      wasPressed(c) { return pressedSet.has(c); },
      end(text) { if (!api.over) { api.over = true; api.overText = text || ''; } },
      setScore(s) { api.score = s; if (opts.onScore) opts.onScore(s); },
      event(name, data) { if (opts.onEvent) opts.onEvent(name, data); },
    };

    const state = game.init(api);
    let raf = 0, last = performance.now(), destroyed = false, hidden = false;
    const visHandler = () => { hidden = document.hidden; last = performance.now(); };
    document.addEventListener('visibilitychange', visHandler);

    function frame(now) {
      if (destroyed) return;
      raf = requestAnimationFrame(frame);
      let dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (hidden) { pressedSet.clear(); pointer.clicked = false; pointer.released = false; return; }
      api.time += dt;
      try {
        if (!api.over) game.update(api, state, dt);
        game.draw(api, state);
        if (api.over) drawOverlay(api, state);
      } catch (err) {
        console.error('[game-art]', gameId, err);
      }
      pressedSet.clear();
      pointer.clicked = false; pointer.released = false;
    }
    raf = requestAnimationFrame(frame);

    function drawOverlay(api) {
      const { ctx } = api;
      ctx.save();
      ctx.fillStyle = 'rgba(8,8,10,0.82)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbfbfb';
      ctx.font = '600 26px Inter, system-ui, sans-serif';
      const lines = String(api.overText || 'Конец').split('\n');
      lines.forEach((ln, i) => ctx.fillText(ln, W / 2, H / 2 - (lines.length - 1) * 18 + i * 36));
      ctx.fillStyle = '#79A0FF';
      ctx.font = '500 14px Inter, system-ui, sans-serif';
      ctx.fillText('R — начать заново', W / 2, H / 2 + lines.length * 18 + 34);
      ctx.restore();
      if (api.wasPressed('KeyR')) { api.over = false; api.overText = ''; Object.assign(state, game.init(api)); }
    }

    return {
      canvas,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', visHandler);
        holder.innerHTML = '';
      },
      restart() { api.over = false; api.overText = ''; Object.assign(state, game.init(api)); },
    };
  }

  /* ============================================================
     ИГРЫ
     ============================================================ */
  const GAMES = {};

  /* ---------- 01. Super Mario Clouds (после Arcangel) ---------- */
  GAMES.clouds = {
    touch: [],
    init(api) {
      const clouds = [];
      for (let i = 0; i < 5; i++) clouds.push(newCloud(api, Math.random() * api.W));
      return { clouds, corrupt: 0, count: 5, wind: 0.6, t: 0 };
    },
    update(api, s, dt) {
      s.t += dt;
      if (api.wasPressed('KeyC')) { s.corrupt = Math.min(1, s.corrupt + 0.25); api.tone(180, 0.1, 'sawtooth', 0.05, -120); }
      if (api.key('ArrowRight')) s.wind = Math.min(2.5, s.wind + dt * 2);
      if (api.key('ArrowLeft')) s.wind = Math.max(0.1, s.wind - dt * 2);
      if (api.pointer.clicked && !api.over) { s.clouds.push(newCloud(api, api.pointer.x, api.pointer.y)); s.count++; api.tone(660, 0.08, 'square', 0.03, 220); }
      if (s.corrupt > 0) s.corrupt = Math.max(0, s.corrupt - dt * 0.04);
      s.clouds.forEach(c => { c.x -= c.spd * s.wind * dt * 14; });
      s.clouds = s.clouds.filter(c => c.x > -140);
      while (s.clouds.length < 5) s.clouds.push(newCloud(api, api.W + 40));
      api.setScore(s.count);
    },
    draw(api, s) {
      const { ctx } = api;
      // небо SMB
      ctx.fillStyle = '#5c94fc'; ctx.fillRect(0, 0, api.W, api.H);
      // лёгкий градиент «салфетки»
      const g = ctx.createLinearGradient(0, 0, 0, api.H);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,40,0.10)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H);
      // солнце-строчка
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let x = 0; x < api.W; x += 24) if ((x / 24) % 2 === 0) ctx.fillRect(x, 26, 12, 6);
      // облака из блоков 8px
      s.clouds.forEach(c => drawPixelCloud(ctx, c.x, c.y, c.scale));
      // коррупция кода
      if (s.corrupt > 0.02) {
        const n = Math.floor(s.corrupt * 60);
        for (let i = 0; i < n; i++) {
          const y = (api.rand() * api.H) | 0, x = (api.rand() * api.W) | 0, w = 20 + api.rand() * 120;
          ctx.fillStyle = ['#000', '#fff', '#ff004d', '#00e5ff'][(api.rand() * 4) | 0];
          ctx.fillRect(x, y, w, 4 + api.rand() * 8);
        }
        ctx.font = '12px monospace'; ctx.fillStyle = '#0f0';
        ctx.fillText('0x' + ((api.rand() * 0xffffff) | 0).toString(16).padStart(6, '0'), api.rand() * 800, api.rand() * 500);
      }
      drawHud(api, 'SUPER MARIO CLOUDS · after Cory Arcangel (2002)', 'облаков: ' + s.count + ' · ветер: ' + s.wind.toFixed(1) + ' · C — сломать код');
    },
  };
  function newCloud(api, x, y) {
    return { x, y: y !== undefined ? y : 40 + api.rand() * (api.H - 160), spd: 0.5 + api.rand(), scale: 0.8 + api.rand() * 0.9 };
  }
  function drawPixelCloud(ctx, x, y, k) {
    const u = 8 * k;
    ctx.fillStyle = '#ffffff';
    const rows = [[1, 5], [0, 7], [0, 7], [1, 5]];
    rows.forEach((r, i) => ctx.fillRect(x + r[0] * u, y + i * u, r[1] * u, u));
    ctx.fillRect(x + 2 * u, y - u, 3 * u, u);
    ctx.fillStyle = 'rgba(92,148,252,0.35)';
    ctx.fillRect(x + u, y + 3 * u, 5 * u, u);
  }

  /* ---------- 02. SOD (после JODI) ---------- */
  GAMES.sod = {
    touch: [],
    init(api) {
      return { rot: 0, noise: 0, flashes: [], shot: 0, dist: 0 };
    },
    update(api, s, dt) {
      if (api.key('ArrowLeft')) s.rot -= dt * 1.6;
      if (api.key('ArrowRight')) s.rot += dt * 1.6;
      s.dist += dt * 60;
      s.noise = Math.max(0, s.noise - dt * 0.35);
      if (api.pointer.clicked) {
        s.noise = Math.min(1, s.noise + 0.18); s.shot++;
        api.tone(90, 0.15, 'sawtooth', 0.06, -40);
        for (let i = 0; i < 10; i++) s.flashes.push({ x: api.pointer.x, y: api.pointer.y, t: 0.4, a: api.rand() * 6.28 });
        api.event('shot');
      }
      if (api.wasPressed('KeyR')) { s.noise = 0; s.shot = 0; s.flashes = []; }
      s.flashes.forEach(f => { f.t -= dt; f.x += Math.cos(f.a) * 90 * dt; f.y += Math.sin(f.a) * 90 * dt; });
      s.flashes = s.flashes.filter(f => f.t > 0);
      api.setScore(s.shot);
    },
    draw(api, s) {
      const { ctx } = api;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, api.W, api.H);
      const cx = api.W / 2, cy = api.H / 2, N = 14;
      // каркас коридора: схемы вместо стен
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      const shift = (s.dist % 80);
      for (let i = 0; i < N; i++) {
        const z = ((i * 80 + 80 - shift) / (N * 80));
        const scale = 1 / (z + 0.08);
        const w = 420 * scale, h = 260 * scale;
        const ox = Math.sin(s.rot + i) * 30 * scale + s.noise * (api.rand() - 0.5) * 60;
        const oy = Math.cos(s.rot * 0.7 + i) * 20 * scale + s.noise * (api.rand() - 0.5) * 40;
        ctx.globalAlpha = Math.min(1, scale * 0.16);
        ctx.strokeRect(cx - w / 2 + ox, cy - h / 2 + oy, w, h);
        // чёрные квадраты вместо врагов
        if (i % 3 === 0) {
          ctx.globalAlpha = Math.min(1, scale * 0.2);
          ctx.fillStyle = (i % 2 ? '#fff' : '#000');
          const q = 34 * scale;
          ctx.fillRect(cx + ox - q / 2, cy + oy - q / 2, q, q);
          ctx.strokeRect(cx + ox - q / 2, cy + oy - q / 2, q, q);
        }
      }
      ctx.globalAlpha = 1;
      // ASCII-дождь при повреждении
      if (s.noise > 0.05) {
        ctx.font = '14px monospace';
        for (let i = 0; i < s.noise * 40; i++) {
          ctx.fillStyle = api.rand() > 0.5 ? '#0f0' : '#fff';
          ctx.fillText(String.fromCharCode(33 + (api.rand() * 90) | 0), api.rand() * api.W, api.rand() * api.H);
        }
      }
      s.flashes.forEach(f => {
        ctx.strokeStyle = '#fff'; ctx.globalAlpha = f.t * 2;
        ctx.strokeRect(f.x - 10, f.y - 10, 20, 20);
        ctx.globalAlpha = 1;
      });
      if (s.noise > 0.85) api.end('КОД НЕВОССТАНОВИМ\nвы сделали из шутера оп-арт');
      drawHud(api, 'SOD · after JODI (1999)', '←→ — обзор · клик — выстрел · повреждение кода: ' + Math.round(s.noise * 100) + '%');
    },
  };
