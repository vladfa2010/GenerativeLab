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
      press(c) { if (!held[c]) pressedSet.add(c); held[c] = true; },
      release(c) { held[c] = false; },
      end(text) { if (!api.over) { api.over = true; api.overText = text || ''; } },
      setScore(s) { api.score = s; if (opts.onScore) opts.onScore(s); },
      event(name, data) { if (opts.onEvent) opts.onEvent(name, data); },
    };

    const state = game.init(api);
    api._s = state; // отладочный доступ к состоянию игры
    let raf = 0, last = performance.now(), destroyed = false, hidden = false, prevOver = false;
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
        if (api.over && !prevOver) { prevOver = true; if (opts.onEvent) opts.onEvent('over'); }
        if (api.over) drawOverlay(api, state);
        if (!api.over) prevOver = false;
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
      canvas, api,
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

  /* ---------- 03. Passage (после Jason Rohrer) ---------- */
  GAMES.passage = {
    touch: ['left', 'right'],
    init(api) {
      const rand = api.rand;
      const chests = [];
      for (let i = 0; i < 26; i++) chests.push({ x: 300 + i * 170 + rand() * 90, y: rand() > 0.5 ? -1 : 1, got: false, empty: rand() < 0.3 });
      return {
        px: 60, t: 0, dur: 95, companion: false, deadPartner: false, chests,
        score: 0, blink: 0, partnerX: 0, aged: 0,
      };
    },
    update(api, s, dt) {
      s.t += dt;
      const k = s.t / s.dur;
      s.aged = k;
      let sp = 62;
      if (s.deadPartner) sp *= 0.55;
      if (api.key('ArrowRight') || api.key('KeyD')) s.px += sp * dt;
      if (api.key('ArrowLeft') || api.key('KeyA')) s.px -= sp * dt * 0.8;
      if (!s.companion && s.px > 210) { s.companion = true; api.chord([523, 659], 0.5, 'triangle', 0.05); }
      if (s.companion && !s.deadPartner) s.partnerX = s.px - 26;
      if (s.companion && k > 0.62 && !s.deadPartner) { s.deadPartner = true; api.chord([392, 311, 233], 1.4, 'sine', 0.05); }
      s.chests.forEach(c => {
        if (!c.got && Math.abs(c.x - s.px) < 16) { c.got = true; if (!c.empty) { s.score += s.companion && !s.deadPartner ? 2 : 1; api.tone(880, 0.1, 'square', 0.04); } else api.tone(220, 0.1, 'square', 0.03); }
      });
      api.setScore(s.score);
      if (k >= 1) api.end('R.I.P.\nсокровищ собрано: ' + s.score + '\nочки не имеют значения');
    },
    draw(api, s) {
      const { ctx } = api;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, api.W, api.H);
      const k = s.aged;
      // узкий мир-коридор, сужается со временем
      const half = 140 - k * 95;
      const horizon = api.H * 0.44;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, horizon - half, api.W, half * 2); ctx.clip();
      // лабиринт из вертикальных полос — пиксельная «живопись» Рорера
      const off = s.px;
      for (let x = -((off % 40) + 40); x < api.W; x += 40) {
        const h = api.noise((x + off) * 0.004, 0.5, 3);
        ctx.fillStyle = `hsl(${200 + h * 90 - k * 40}, ${45 - k * 25}%, ${18 + h * 40 - k * 10}%)`;
        ctx.fillRect(x, horizon - half, 40, half * 2);
      }
      // коридоры-«стены» сверху и снизу
      for (let x = -((off % 90) + 90); x < api.W; x += 90) {
        const n = api.noise((x + off) * 0.006, 3.3, 2);
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(x, horizon - half, 46, half * (0.25 + n * 0.55));
        ctx.fillRect(x + 20, horizon + half * (0.35 - n * 0.4), 46, half * (0.25 + n * 0.5));
      }
      // сундуки
      s.chests.forEach(c => {
        if (c.got) return;
        const sx = c.x - off + 60;
        if (sx < -30 || sx > api.W + 30) return;
        const sy = horizon + c.y * (half * 0.5) - 8;
        ctx.fillStyle = c.empty ? '#3a3a4a' : '#ffd166';
        ctx.fillRect(sx - 7, sy - 6, 14, 12);
        ctx.fillStyle = '#000'; ctx.fillRect(sx - 1, sy - 2, 3, 4);
      });
      // персонажи
      const py = horizon + Math.sin(s.t * 7) * 2;
      drawPixelPerson(ctx, 60 - 0, py, 1 - k * 0.45, k, '#e8b88a');
      if (s.companion && !s.deadPartner) {
        const sx = s.partnerX - off + 60;
        if (sx > -20) drawPixelPerson(ctx, sx, py, 1 - k * 0.45, k, '#c96f4a');
      }
      if (s.deadPartner) {
        ctx.fillStyle = '#666';
        ctx.fillRect(60 - 26, py + 8, 16, 4);
        ctx.fillRect(60 - 22, py + 2, 8, 8);
      }
      ctx.restore();
      // виньетка: зрение сужается
      const vg = ctx.createRadialGradient(api.W / 2, horizon, half * 0.5, api.W / 2, horizon, half * (1.7 - k * 0.5));
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.92)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, api.W, api.H);
      // шкала жизни
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(30, api.H - 26, api.W - 60, 3);
      ctx.fillStyle = '#79A0FF'; ctx.fillRect(30, api.H - 26, (api.W - 60) * Math.min(1, k), 3);
      drawHud(api, 'PASSAGE · after Jason Rohrer (2007)', 'время жизни: ' + Math.round(k * 100) + '% · сокровищ: ' + s.score);
    },
  };
  function drawPixelPerson(ctx, x, y, scale, age, skin) {
    const h = Math.max(6, 18 * scale);
    ctx.fillStyle = age > 0.55 ? '#cfcfcf' : '#4a3728'; // волосы седеют
    ctx.fillRect(x - 3 * scale, y - h - 4 * scale, 6 * scale, 3 * scale);
    ctx.fillStyle = skin;
    ctx.fillRect(x - 3 * scale, y - h, 6 * scale, 5 * scale);
    ctx.fillStyle = age > 0.75 ? '#8a8a8a' : '#3d6fd6';
    ctx.fillRect(x - 3 * scale, y - h + 5 * scale, 6 * scale, 8 * scale);
    ctx.fillStyle = '#222';
    ctx.fillRect(x - 3 * scale, y - h * 0.33, 2.4 * scale, h * 0.33);
    ctx.fillRect(x + 0.8 * scale, y - h * 0.33, 2.4 * scale, h * 0.33);
  }

  /* ---------- 04. The Graveyard (после Tale of Tales) ---------- */
  GAMES.graveyard = {
    touch: ['left', 'right', 'up', 'down'],
    init(api) {
      const stones = [];
      for (let i = 0; i < 14; i++) stones.push({ x: 120 + i * 68 + api.rand() * 30, w: 18 + api.rand() * 10, h: 26 + api.rand() * 18, cross: api.rand() > 0.5 });
      const drops = [];
      for (let i = 0; i < 130; i++) drops.push({ x: api.rand() * 1400, y: api.rand() * api.H, v: 300 + api.rand() * 200 });
      return { px: 30, sitting: false, sitT: 0, left: false, bird: 0, stones, drops, crowX: 900, sang: false };
    },
    update(api, s, dt) {
      if (!s.left) {
        if (!s.sitting) {
          if (api.key('ArrowRight') || api.key('KeyD')) { s.px += 26 * dt; api.tone(0, 0); }
          if (s.px > 520) s.px = 520;
          if ((api.wasPressed('ArrowDown') || api.wasPressed('KeyS')) && s.px > 430) {
            s.sitting = true; api.chord([196, 247, 294], 3.2, 'sine', 0.045); s.sang = true;
          }
        } else {
          s.sitT += dt;
          s.bird = Math.min(1, s.bird + dt * 0.25);
          if (s.sitT > 18) s.bird = 1;
          if (api.wasPressed('ArrowUp') || api.wasPressed('KeyW')) { s.sitting = false; s.leaving = true; }
        }
      }
      if (s.leaving) {
        s.px -= 30 * dt;
        if (s.px < -30) api.end('ВЫ УШЛИ\nона могла бы остаться ещё немного\n(в оригинале — уйти могли только те, кто заплатил)');
      }
      s.drops.forEach(d => { d.y += d.v * dt; if (d.y > api.H) { d.y = -10; d.x = api.rand() * 1400; } });
      s.crowX -= dt * 40; if (s.crowX < -60) s.crowX = 1000;
      api.setScore(s.sitting ? Math.floor(s.sitT) : 0);
    },
    draw(api, s) {
      const { ctx } = api;
      // сепия/монохром
      const sky = ctx.createLinearGradient(0, 0, 0, api.H);
      sky.addColorStop(0, '#8f8f8f'); sky.addColorStop(0.6, '#6d6d6d'); sky.addColorStop(1, '#3a3a3a');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, api.W, api.H);
      ctx.fillStyle = '#2c2c2c'; ctx.fillRect(0, api.H - 90, api.W, 90);
      // ограда
      ctx.fillStyle = '#1c1c1c';
      for (let x = 0; x < api.W; x += 26) ctx.fillRect(x, api.H - 150, 4, 60);
      ctx.fillRect(0, api.H - 136, api.W, 4);
      // могилы
      s.stones.forEach(st => {
        const x = st.x - s.px * 0.55;
        if (x < -40 || x > api.W + 40) return;
        ctx.fillStyle = '#232323';
        ctx.fillRect(x, api.H - 90 - st.h, st.w, st.h);
        if (st.cross) { ctx.fillRect(x + st.w / 2 - 2, api.H - 90 - st.h - 12, 4, 12); ctx.fillRect(x + st.w / 2 - 7, api.H - 90 - st.h - 8, 14, 4); }
      });
      // скамейка
      const bx = 560 - s.px * 0.55;
      ctx.fillStyle = '#141414';
      ctx.fillRect(bx, api.H - 116, 90, 8); ctx.fillRect(bx + 6, api.H - 108, 6, 18); ctx.fillRect(bx + 78, api.H - 108, 6, 18);
      ctx.fillRect(bx, api.H - 140, 90, 6); ctx.fillRect(bx + 6, api.H - 134, 6, 14); ctx.fillRect(bx + 78, api.H - 134, 6, 14);
      // ворона
      ctx.fillStyle = '#000';
      const cy = 90 + Math.sin(api.time * 3) * 8;
      ctx.fillRect(s.crowX, cy, 14, 6); ctx.fillRect(s.crowX + 10, cy - 4, 6, 6);
      // женщина
      const gx = 120;
      if (!s.sitting) {
        const step = (api.key('ArrowRight') || api.key('KeyD')) ? Math.sin(api.time * 6) * 3 : 0;
        ctx.fillStyle = '#101010';
        ctx.fillRect(gx - 6, api.H - 118, 12, 26);
        ctx.fillRect(gx - 6, api.H - 96 + step, 4, 8); ctx.fillRect(gx + 2, api.H - 96 - step, 4, 8);
        ctx.fillRect(gx - 5, api.H - 126, 10, 9); // голова
        ctx.fillStyle = '#d9d9d9'; ctx.fillRect(gx - 5, api.H - 126, 10, 3);
        ctx.strokeStyle = '#101010'; ctx.lineWidth = 2; // трость
        ctx.beginPath(); ctx.moveTo(gx + 8, api.H - 96); ctx.lineTo(gx + 12, api.H - 88); ctx.stroke();
      } else {
        ctx.fillStyle = '#101010';
        ctx.fillRect(gx - 14, api.H - 122, 26, 14);
        ctx.fillRect(gx - 14, api.H - 108, 5, 14);
        ctx.fillStyle = '#d9d9d9'; ctx.fillRect(gx - 14, api.H - 122, 26, 4);
        // птица на спинке
        if (s.bird > 0.4) {
          ctx.fillStyle = '#3b3b3b';
          const py = api.H - 132 + Math.sin(api.time * 4) * 1.5;
          ctx.fillRect(gx + 16, py, 8, 6); ctx.fillRect(gx + 22, py - 3, 4, 4);
        }
      }
      // дождь
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath();
      s.drops.forEach(d => { const x = (d.x - s.px * 0.3) % (api.W + 40); ctx.moveTo(x, d.y); ctx.lineTo(x - 3, d.y + 12); });
      ctx.stroke();
      // текстовые вставки
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = 'italic 16px Georgia, serif';
      if (!s.sitting && !s.leaving) ctx.fillText(s.px < 60 ? 'идите направо. медленно.' : '↓ сесть на скамейку', api.W / 2, 60);
      if (s.sitting && s.sitT < 2) ctx.fillText('…', api.W / 2, 60);
      if (s.sitting && s.sitT >= 6 && s.sitT < 9) ctx.fillText('«Забери меня, отец, куда ты угодно»', api.W / 2, 60);
      if (s.sitting && s.sitT >= 12 && s.bird >= 1) ctx.fillText('птица села рядом. ↑ встать и уйти', api.W / 2, 60);
      drawHud(api, 'THE GRAVEYARD · after Tale of Tales (2008)', s.sitting ? 'вы сидите: ' + Math.floor(s.sitT) + ' сек' : 'никаких целей. никаких очков.');
    },
  };

  /* ---------- 05. The McDonald's Videogame (после Molleindustria) ---------- */
  GAMES.molle = {
    touch: [],
    init(api) {
      return { cash: 500, health: 20, eco: 20, demand: 3, t: 0, dur: 60, cows: [0.4, 0.3, 0.5], manure: 0, served: 0, flash: '' };
    },
    update(api, s, dt) {
      if (api.over) return;
      s.t += dt;
      const regions = [
        { x: 40, y: 130, w: 260, h: 300 },   // скотный двор
        { x: 350, y: 130, w: 260, h: 300 },  // кухня
        { x: 660, y: 130, w: 260, h: 300 },  // маркетинг
      ];
      // авто-спрос
      if (Math.random() < dt * 0.3) s.demand = Math.min(9, s.demand + 1);
      if (api.pointer.clicked) {
        const p = api.pointer;
        if (p.x > regions[0].x && p.x < regions[0].x + regions[0].w && p.y > regions[0].y && p.y < regions[0].y + regions[0].h) {
          // коровник: кормить
          const c = s.cows.indexOf(Math.min(...s.cows));
          s.cows[c] = Math.min(1, s.cows[c] + 0.25);
          s.manure += 9; s.eco -= 1.2; api.tone(140, 0.09, 'square', 0.04);
          s.flash = 'коровы растут быстрее. навоз — в реку.';
        } else if (p.x > regions[1].x && p.x < regions[1].x + regions[1].w && p.y > regions[1].y && p.y < regions[1].y + regions[1].h) {
          if (s.demand > 0 && s.cows.some(c => c > 0.55)) {
            const i = s.cows.findIndex(c => c > 0.55);
            s.cows[i] -= 0.34; s.demand--; s.served++;
            s.cash += 45; s.health += 1.5; api.tone(520, 0.08, 'square', 0.04, 260);
            s.flash = 'бургер продан. +$45';
          } else { api.tone(110, 0.12, 'sawtooth', 0.04); s.flash = s.demand <= 0 ? 'нет спроса — ждите' : 'нет мяса — жирные коровы ещё не выросли'; }
        } else if (p.x > regions[2].x && p.x < regions[2].x + regions[2].w && p.y > regions[2].y && p.y < regions[2].y + regions[2].h) {
          s.demand = Math.min(12, s.demand + 3); s.cash -= 30; s.health += 4; api.tone(740, 0.1, 'triangle', 0.05);
          s.flash = 'реклама обещает счастье. спрос растёт, здоровье — нет.';
        }
      }
      s.manure = Math.max(0, s.manure - dt * 2.2);
      if (s.manure > 70) { s.eco -= dt * 2.4; }
      if (s.health > 60) s.cash -= dt * 8; // суды и компенсации
      s.health = Math.max(0, s.health - dt * 0.35);
      s.eco = Math.max(0, s.eco - dt * 0.28);
      api.setScore(s.cash | 0);
      if (s.cash <= 0) api.end('БАНКРОТСТВО\nсистема выплюнула вас: слишком честный менеджер');
      if (s.health >= 100) api.end('СКАНДАЛ\nдокументальный фильм о ваших бургерах\nсмотрели все. акции в нуле.');
      if (s.eco >= 100) api.end('ЭКОЦИД\nджунгли вырублены, реки в навозе.\nпоздравляем: вы выиграли капитализм.');
      if (s.t >= s.dur) api.end(s.cash > 1200 ? 'ГОД ЗАВЕРШЁН\nприбыль: $' + (s.cash | 0) + ' · продано бургеров: ' + s.served + '\nи никто не спросил, какой ценой' : 'ГОД ЗАВЕРШЁН\nприбыль: $' + (s.cash | 0) + '\nкорпорация недовольна. вас уволили.');
    },
    draw(api, s) {
      const { ctx } = api;
      ctx.fillStyle = '#f7f3e8'; ctx.fillRect(0, 0, api.W, api.H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c00';
      ctx.font = 'italic 800 34px Georgia, serif';
      ctx.fillText('McWIN', api.W / 2, 70);
      ctx.font = '13px Inter, sans-serif'; ctx.fillStyle = '#555';
      ctx.fillText('бизнес-симулятор. процедурная риторика Molleindustria.', api.W / 2, 94);
      const cols = [
        { t: 'СКОТНЫЙ ДВОР', hint: 'клик: кормить', c: '#8a6d3b' },
        { t: 'КУХНЯ', hint: 'клик: продать бургер', c: '#b03030' },
        { t: 'МАРКЕТИНГ', hint: 'клик: реклама (-$30)', c: '#3050b0' },
      ];
      cols.forEach((c, i) => {
        const x = 40 + i * 310;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ddd';
        ctx.fillRect(x, 130, 260, 300); ctx.strokeRect(x, 130, 260, 300);
        ctx.fillStyle = c.c; ctx.font = '700 15px Inter, sans-serif';
        ctx.fillText(c.t, x + 130, 158);
        ctx.fillStyle = '#888'; ctx.font = '12px Inter, sans-serif';
        ctx.fillText(c.hint, x + 130, 178);
      });
      // коровы
      s.cows.forEach((fat, i) => {
        const x = 90 + i * 80, y = 350 - fat * 90;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333';
        ctx.fillRect(x, y, 46 + fat * 26, 40 + fat * 26); ctx.strokeRect(x, y, 46 + fat * 26, 40 + fat * 26);
        ctx.fillStyle = '#333';
        ctx.fillRect(x + 10, y + 12, 6, 6); ctx.fillRect(x + 28, y + 20, 8, 8);
      });
      if (s.manure > 20) { ctx.fillStyle = '#7a5c22'; ctx.font = '12px Inter, sans-serif'; ctx.fillText('навоз: ' + Math.round(s.manure) + '%', 170, 420); }
      // кухня: очередь
      for (let i = 0; i < s.demand; i++) {
        ctx.fillStyle = '#444';
        ctx.fillRect(390 + i * 24, 300, 10, 26); ctx.fillRect(390 + i * 24, 288, 10, 10);
      }
      // маркетинг: диаграмма спроса
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i < s.demand ? '#3050b0' : '#dfe3ee';
        ctx.fillRect(690 + i * 18, 380 - i * 4 - 16, 12, i * 4 + 16);
      }
      // метрики
      const mets = [
        ['ПРИБЫЛЬ', '$' + (s.cash | 0), s.cash / 2000, '#2a7d2a'],
        ['СКАНДАЛ', Math.round(s.health) + '%', s.health / 100, '#c00'],
        ['ЭКОЛОГИЯ', Math.round(100 - s.eco) + '% чистоты', (100 - s.eco) / 100, '#2a6a9d'],
      ];
      mets.forEach((m, i) => {
        const x = 40 + i * 310;
        ctx.fillStyle = '#eee'; ctx.fillRect(x, 452, 260, 14);
        ctx.fillStyle = m[3]; ctx.fillRect(x, 452, Math.max(0, Math.min(1, m[2])) * 260, 14);
        ctx.fillStyle = '#333'; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(m[0] + ': ' + m[1], x, 445);
        ctx.textAlign = 'center';
      });
      ctx.fillStyle = '#a33'; ctx.font = 'italic 13px Georgia, serif';
      ctx.fillText(s.flash, api.W / 2, 505);
      const left = Math.max(0, s.dur - s.t) | 0;
      drawHud(api, 'THE McDONALD\'S VIDEOGAME · after Molleindustria (2006)', 'до отчёта: ' + left + ' сек · бургеров: ' + s.served);
    },
  };

  /* ---------- 06. The Artist Is Present (после Pippin Barr) ---------- */
  GAMES.artist = {
    touch: ['a'],
    init(api) {
      return { scene: 'ticket', q: 0, stepT: 4 + api.rand() * 4, stepFlag: false, museum: 9 * 60 + 30, gaze: 0, need: 12, blink: 3, blinkT: 0, wait: 0 };
    },
    update(api, s, dt) {
      if (api.over) return;
      s.museum += dt * 30; // ускоренное музейное время
      const hh = Math.floor(s.museum / 60) % 24, mm = Math.floor(s.museum % 60);
      const open = hh >= 10 && hh < 18;
      const act = api.wasPressed('Space') || api.wasPressed('KeyZ') || api.wasPressed('Enter') || api.pointer.clicked;
      if (s.scene === 'ticket') {
        if (act) { s.scene = 'gallery'; api.tone(440, 0.1, 'square', 0.04); }
      } else if (s.scene === 'gallery') {
        s.wait += dt;
        if (s.wait > 2.5) s.scene = 'queue';
      } else if (s.scene === 'queue') {
        if (!open) { api.end('МУЗЕЙ ЗАКРЫТ\nMoMA работает с 10:00 до 18:00\n(в игре Барра — в реальном времени)'); return; }
        if (s.stepFlag) {
          s.flagAge = (s.flagAge || 0) + dt;
          if (act) { s.stepFlag = false; s.q += 1; api.tone(500, 0.08, 'square', 0.04); s.stepT = 3 + api.rand() * 4; }
          else if (s.flagAge > 3) { s.stepFlag = false; s.q = Math.max(0, s.q - 1); s.stepT = 3 + api.rand() * 4; }
        } else {
          s.stepT -= dt;
          if (s.stepT <= 0) { s.stepFlag = true; s.flagAge = 0; }
        }
        if (s.q >= 12) { s.scene = 'table'; api.chord([262, 330, 392], 2, 'sine', 0.05); }
      } else if (s.scene === 'table') {
        // гляделки: держим Space; отпускаем, когда она моргает
        const holding = api.key('Space') || api.key('KeyZ') || api.pointer.down;
        s.blinkT -= dt;
        if (s.blinkT <= 0) { s.blinking = !s.blinking; s.blinkT = s.blinking ? 0.25 : 1.6 + api.rand() * 3.2; }
        if (holding) {
          if (s.blinking) { api.end('ВЫ МОРГНУЛИ ПЕРВЫМ\nгляделки проиграны. Марина невозмутима.'); return; }
          s.gaze += dt;
          if (s.gaze >= s.need) {
            api.setScore(Math.round(s.gaze));
            api.end('ВЫ БЫЛИ PRESENT\n' + Math.round(s.gaze) + ' секунд молчаливого взгляда\nМарина Абрамович кивнула.');
          }
        }
      }
    },
    draw(api, s) {
      const { ctx } = api;
      const hh = Math.floor(s.museum / 60) % 24, mm = Math.floor(s.museum % 60);
      const open = hh >= 10 && hh < 18;
      ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, 0, api.W, api.H);
      ctx.textAlign = 'center';
      if (s.scene === 'ticket') {
        ctx.fillStyle = '#222'; ctx.font = '700 30px Inter, sans-serif';
        ctx.fillText('MoMA · Нью-Йорк', api.W / 2, 180);
        ctx.font = '16px Inter, sans-serif'; ctx.fillStyle = '#555';
        ctx.fillText('Выставка «Marina Abramović: The Artist Is Present»', api.W / 2, 220);
        ctx.strokeStyle = '#222'; ctx.strokeRect(api.W / 2 - 130, 280, 260, 90);
        ctx.fillStyle = '#222'; ctx.font = '700 14px Inter, sans-serif';
        ctx.fillText('ВХОДНОЙ БИЛЕТ — $0 (игра бесплатна)', api.W / 2, 315);
        ctx.fillStyle = '#a00'; ctx.font = 'italic 15px Georgia, serif';
        ctx.fillText('пробел — купить билет', api.W / 2, 420);
      } else if (s.scene === 'gallery') {
        ctx.fillStyle = '#ddd3bf'; ctx.fillRect(0, 0, api.W, api.H);
        // картины
        const arts = [['ЗВЁЗДНАЯ НОЧЬ', '#1a2a6b'], ['ЧЕРНЫЙ КВАДРАТ', '#000'], ['ОСЕННИЙ РИТМ', '#b0622d']];
        arts.forEach((a, i) => {
          const x = 120 + i * 280;
          ctx.fillStyle = '#fff'; ctx.fillRect(x, 130, 180, 130);
          ctx.fillStyle = a[1]; ctx.fillRect(x + 10, 140, 160, 100);
          if (i === 0) { ctx.fillStyle = '#ffd34d'; for (let k = 0; k < 8; k++) ctx.fillRect(x + 20 + api.rand() * 130, 150 + api.rand() * 70, 4, 4); }
          ctx.fillStyle = '#333'; ctx.font = '11px Inter, sans-serif';
          ctx.fillText(a[0], x + 90, 285);
        });
        ctx.fillStyle = '#222'; ctx.font = 'italic 15px Georgia, serif';
        ctx.fillText('вы идёте через галереи…', api.W / 2, 400);
      } else if (s.scene === 'queue') {
        ctx.fillStyle = '#efe9db'; ctx.fillRect(0, 0, api.W, api.H);
        ctx.fillStyle = '#333'; ctx.font = '700 20px Inter, sans-serif';
        ctx.fillText(open ? 'АТРИУМ MoMA' : 'МУЗЕЙ ЗАКРЫТ', api.W / 2, 90);
        ctx.font = '14px Inter, sans-serif'; ctx.fillStyle = '#666';
        ctx.fillText('время музея: ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (open ? '' : ' — приходите с 10 до 18'), api.W / 2, 116);
        // стол и Марина
        ctx.fillStyle = '#5a3d22'; ctx.fillRect(api.W / 2 - 60, 250, 120, 10);
        ctx.fillStyle = '#111'; ctx.fillRect(api.W / 2 + 40, 190, 26, 60);
        ctx.fillStyle = '#caa27e'; ctx.fillRect(api.W / 2 + 44, 168, 18, 20);
        ctx.fillStyle = '#111'; ctx.fillRect(api.W / 2 + 44, 160, 18, 8);
        // очередь (вы — крайний)
        for (let i = 0; i < 12; i++) {
          const y = 480 - (i - s.q) * 26;
          if (y < 150 || y > 520) continue;
          const isYou = i === Math.floor(s.q + 0.5) && s.q > 11 ? false : (i === 12 - Math.ceil(12 - s.q));
          ctx.fillStyle = i === 12 - Math.ceil(12 - s.q) && s.q % 1 < 0.5 ? '#a00' : '#555';
          ctx.fillRect(170, y - 12, 10, 16); ctx.fillRect(170, y - 20, 10, 8);
        }
        ctx.fillStyle = '#a00';
        ctx.fillRect(170, 500, 10, 16); ctx.fillRect(170, 492, 10, 8);
        ctx.font = '11px Inter, sans-serif'; ctx.fillText('ВЫ', 175, 530);
        // сигнал шага
        if (s.stepFlag) {
          ctx.fillStyle = '#c00'; ctx.font = '700 22px Inter, sans-serif';
          ctx.fillText('ПРОБЕЛ — ШАГ ВПЕРЁД', api.W / 2, 420);
          ctx.font = '13px Inter, sans-serif';
          ctx.fillText('пропустите сигнал — потеряете место в очереди', api.W / 2, 445);
        } else {
          ctx.fillStyle = '#777'; ctx.font = 'italic 14px Georgia, serif';
          ctx.fillText('очередь движется очень медленно. ждите.', api.W / 2, 430);
        }
        ctx.fillStyle = '#333'; ctx.font = '12px Inter, sans-serif';
        ctx.fillText('впереди вас: ~' + Math.max(0, Math.ceil(12 - s.q)) + ' человек', api.W / 2, 150);
      } else if (s.scene === 'table') {
        ctx.fillStyle = '#efe9db'; ctx.fillRect(0, 0, api.W, api.H);
        ctx.fillStyle = '#111'; ctx.font = '700 18px Inter, sans-serif';
        ctx.fillText('Вы сидите напротив. Молча.', api.W / 2, 80);
        ctx.fillStyle = '#5a3d22'; ctx.fillRect(120, 300, 720, 14);
        // Марина крупно
        ctx.fillStyle = '#111'; ctx.fillRect(api.W / 2 + 120, 180, 90, 120);
        ctx.fillStyle = '#caa27e'; ctx.fillRect(api.W / 2 + 135, 130, 60, 55);
        ctx.fillStyle = '#111'; ctx.fillRect(api.W / 2 + 135, 112, 60, 20);
        if (s.blinking) {
          ctx.fillStyle = '#111';
          ctx.fillRect(api.W / 2 + 148, 152, 14, 3); ctx.fillRect(api.W / 2 + 170, 152, 14, 3);
        } else {
          ctx.fillStyle = '#fff';
          ctx.fillRect(api.W / 2 + 148, 146, 14, 10); ctx.fillRect(api.W / 2 + 170, 146, 14, 10);
          ctx.fillStyle = '#222';
          ctx.fillRect(api.W / 2 + 153, 148, 5, 6); ctx.fillRect(api.W / 2 + 175, 148, 5, 6);
        }
        // игрок — отражение
        ctx.fillStyle = '#333'; ctx.fillRect(api.W / 2 - 210, 180, 90, 120);
        ctx.fillStyle = '#d9b28c'; ctx.fillRect(api.W / 2 - 195, 130, 60, 55);
        ctx.fillStyle = '#333'; ctx.fillRect(api.W / 2 - 195, 112, 60, 20);
        // шкала взгляда
        const holding = api.key('Space') || api.key('KeyZ') || api.pointer.down;
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(api.W / 2 - 200, 460, 400, 12);
        ctx.fillStyle = holding ? '#a00' : '#999'; ctx.fillRect(api.W / 2 - 200, 460, (s.gaze / s.need) * 400, 12);
        ctx.fillStyle = '#333'; ctx.font = '14px Inter, sans-serif';
        ctx.fillText(holding ? 'вы смотрите… не отпускайте, пока она не моргнёт' : 'ЗАЖМИТЕ пробел — смотреть. Отпустите, когда она моргает.', api.W / 2, 445);
        ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = '#777';
        ctx.fillText('выдержано: ' + s.gaze.toFixed(1) + ' / ' + s.need + ' сек', api.W / 2, 495);
      }
      drawHud(api, 'THE ARTIST IS PRESENT · after Pippin Barr (2011)', 'пробел/клик — действие');
    },
  };

  /* ---------- 07. Proteus (после Ed Key & David Kanaga) ---------- */
  const PENTA = [0, 2, 4, 7, 9];
  GAMES.proteus = {
    touch: ['left', 'right', 'up', 'down'],
    init(api) {
      const ents = [];
      const add = (type, n, note) => {
        for (let i = 0; i < n; i++) ents.push({ type, x: api.rand() * 2000 - 1000, y: api.rand() * 2000 - 1000, note, phase: api.rand() * 6.28 });
      };
      add('tree', 26, 0); add('flower', 40, 2); add('rock', 20, 4); add('bug', 8, 3); add('bird', 5, 1);
      const stones = [];
      for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; stones.push({ x: Math.cos(a) * 70, y: Math.sin(a) * 70, h: 30 + api.rand() * 14 }); }
      return { px: 0, py: 0, ents, stones, circleX: (api.rand() - 0.5) * 1200, circleY: (api.rand() - 0.5) * 1200, inCircle: 0, season: 0, notes: [], heard: new Set() };
    },
    update(api, s, dt) {
      const sp = 90;
      let dx = 0, dy = 0;
      if (api.key('ArrowLeft') || api.key('KeyA')) dx -= 1;
      if (api.key('ArrowRight') || api.key('KeyD')) dx += 1;
      if (api.key('ArrowUp') || api.key('KeyW')) dy -= 1;
      if (api.key('ArrowDown') || api.key('KeyS')) dy += 1;
      const l = Math.hypot(dx, dy) || 1;
      s.px += dx / l * sp * dt; s.py += dy / l * sp * dt;
      // тор-мир
      s.px = ((s.px + 1000) % 2000 + 2000) % 2000 - 1000;
      s.py = ((s.py + 1000) % 2000 + 2000) % 2000 - 1000;
      const dist = (e) => Math.hypot(e.x - s.px, e.y - s.py);
      // близкие объекты звучат
      s.ents.forEach(e => {
        const d = dist(e);
        if (d < 120 && api.rand() < dt * (1.6 - d / 100)) {
          const base = 220 * Math.pow(2, PENTA[e.note] / 12);
          const f = base * (e.type === 'tree' ? 0.5 : 1);
          api.tone(f, e.type === 'rock' ? 0.5 : 0.25, e.type === 'flower' ? 'sine' : 'triangle', 0.035);
          s.notes.push({ x: e.x, y: e.y, t: 0.8 });
          s.heard.add(e.type);
        }
        if (e.type === 'bug' || e.type === 'bird') {
          e.x += Math.cos(e.phase + api.time) * 26 * dt; e.y += Math.sin(e.phase * 1.3 + api.time * 0.8) * 26 * dt;
        }
      });
      s.notes.forEach(n => n.t -= dt); s.notes = s.notes.filter(n => n.t > 0);
      // каменный круг
      const dC = Math.hypot(s.circleX - s.px, s.circleY - s.py);
      if (dC < 46) {
        s.inCircle += dt;
        if (s.inCircle > 2.5 && s.season === 0) {
          s.season = 1; api.chord([330, 415, 494, 659], 3.5, 'sine', 0.05);
          api.end('СТОЯ В КРУГЕ, ВЫ СЛЫШИТЕ ОСТРОВ ЦЕЛИКОМ\nвы услышали: ' + s.heard.size + ' голосов природы\n' + (s.heard.size >= 4 ? 'остров открылся вам полностью.' : 'вернитесь — на острове ещё есть голоса.'));
        }
      } else s.inCircle = Math.max(0, s.inCircle - dt);
      api.setScore(s.heard.size);
    },
    draw(api, s) {
      const { ctx } = api;
      const t = api.time;
      // вода
      ctx.fillStyle = s.season ? '#274b66' : '#2e5d80';
      ctx.fillRect(0, 0, api.W, api.H);
      // остров из шума
      const cell = 26, ox = api.W / 2 - s.px, oy = api.H / 2 - s.py;
      for (let gx = -30; gx < 30; gx++) for (let gy = -22; gy < 22; gy++) {
        const wx = Math.round((s.px + gx * cell) / cell) * cell;
        const wy = Math.round((s.py + gy * cell) / cell) * cell;
        const h = api.noise(wx * 0.0022, wy * 0.0022, 3);
        if (h < 0.52) continue;
        const sx = gx * cell + cell / 2 + ((wx - s.px) - gx * cell);
        const sy = gy * cell + cell / 2 + ((wy - s.py) - gy * cell);
        const beach = h < 0.56;
        ctx.fillStyle = beach ? '#d8c690' : (s.season ? `hsl(${100 + h * 30}, 30%, ${26 + h * 18}%)` : `hsl(${105 + h * 40}, 42%, ${28 + h * 20}%)`);
        ctx.fillRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
      }
      const drawEnt = (e) => {
        let sx = e.x - s.px + api.W / 2, sy = e.y - s.py + api.H / 2;
        sx = ((sx % 2000) + 2600) % 2000 - 600; sy = ((sy % 2000) + 2200) % 2000 - 500;
        if (sx < -40 || sx > api.W + 40 || sy < -40 || sy > api.H + 40) return;
        const bob = Math.sin(t * 2 + e.phase) * 2;
        if (e.type === 'tree') {
          ctx.fillStyle = '#4a3520'; ctx.fillRect(sx - 2, sy - 6, 4, 14);
          ctx.fillStyle = s.season ? '#b0653a' : '#2f7a3e';
          ctx.fillRect(sx - 8, sy - 20 + bob, 16, 14); ctx.fillRect(sx - 5, sy - 26 + bob, 10, 8);
        } else if (e.type === 'flower') {
          ctx.fillStyle = ['#ff7ab8', '#ffd34d', '#9be36b'][(e.note + (e.phase | 0)) % 3 | 0];
          ctx.fillRect(sx - 2, sy - 6 + bob, 5, 5); ctx.fillStyle = '#3f7a3e'; ctx.fillRect(sx, sy - 1, 2, 6);
        } else if (e.type === 'rock') {
          ctx.fillStyle = '#8d9299'; ctx.fillRect(sx - 6, sy - 5, 12, 9);
        } else if (e.type === 'bug') {
          ctx.fillStyle = '#222'; ctx.fillRect(sx - 2, sy - 2 + bob, 5, 4);
        } else {
          ctx.fillStyle = '#fff'; ctx.fillRect(sx - 3, sy - 2 + bob, 6, 3);
        }
      };
      s.ents.forEach(drawEnt);
      // каменный круг
      const csx = s.circleX - s.px + api.W / 2, csy = s.circleY - s.py + api.H / 2;
      s.stones.forEach(st => {
        const sx = csx + st.x, sy = csy + st.y;
        if (sx < -40 || sx > api.W + 40 || sy < -60 || sy > api.H + 40) return;
        ctx.fillStyle = '#6f7480';
        ctx.fillRect(sx - 7, sy - st.h, 14, st.h);
        ctx.fillStyle = '#9aa0ab';
        ctx.fillRect(sx - 7, sy - st.h, 14, 5);
      });
      if (Math.abs(csx - api.W / 2) < 500 && Math.abs(csy - api.H / 2) < 400) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + Math.sin(t * 3) * 0.15) + ')';
        ctx.beginPath(); ctx.arc(csx, csy, 44, 0, 6.283); ctx.stroke();
      }
      // ноты
      s.notes.forEach(n => {
        const sx = n.x - s.px + api.W / 2, sy = n.y - s.py + api.H / 2;
        ctx.fillStyle = 'rgba(255,255,255,' + n.t + ')';
        ctx.font = '16px serif'; ctx.textAlign = 'center';
        ctx.fillText('♪', sx, sy - (0.8 - n.t) * 30);
      });
      drawHud(api, 'PROTEUS · after Ed Key & David Kanaga (2013)', 'услышано голосов: ' + s.heard.size + ' · найдите каменный круг');
    },
  };

  /* ---------- 08. Everything (после David OReilly) ---------- */
  const LEVELS = [
    { name: 'МИКРОБ', color: '#7de08a', size: 5 },
    { name: 'ЖУК', color: '#c9a13b', size: 8 },
    { name: 'ОЛЕНЬ', color: '#b07d4f', size: 14 },
    { name: 'ЧЕЛОВЕК', color: '#d9b28c', size: 18 },
    { name: 'ОСТРОВ', color: '#4e8a5a', size: 40 },
    { name: 'ПЛАНЕТА', color: '#5b8fd6', size: 70 },
    { name: 'ЗВЕЗДА', color: '#ffd34d', size: 110 },
    { name: 'ГАЛАКТИКА', color: '#b48ae0', size: 170 },
  ];
  const QUOTES = [
    '«Мы не приходим в этот мир, мы вырастаем из него.» — Алан Уоттс',
    '«Ты — не капля в океане. Ты — океан в капле.» — после Уоттса',
    '«Попробуй представить, что ты — вселенная, глядящая на себя.»',
    '«Граница между тобой и миром — договорённость, а не факт.» — Уоттс',
    '«Каждая вещь — волна в одном океане.» — Уоттс',
    '«Малое во внутреннем содержит большое, большое во внешнем содержит малое.» — Чжуан-цзы, через Уоттса',
    '«Ты не отдель от всего остального. Ты — остальное.»',
  ];
  GAMES.everything = {
    touch: ['left', 'right', 'up', 'down', 'a'],
    init(api) {
      const stars = [];
      for (let i = 0; i < 240; i++) stars.push({ x: api.rand() * 2200 - 1100, y: api.rand() * 1600 - 800, s: 1 + api.rand() * 2.4 });
      const things = [];
      for (let i = 0; i < 60; i++) things.push({ x: api.rand() * 2000 - 1000, y: api.rand() * 1400 - 700, p: api.rand() * 6.28, lvl: (api.rand() * 8) | 0 });
      return { level: 0, x: 0, y: 0, stars, things, holdT: 0, quote: '', quoteT: 0, maxLvl: 0, anim: 0 };
    },
    update(api, s, dt) {
      let dx = 0, dy = 0;
      if (api.key('ArrowLeft') || api.key('KeyA')) dx -= 1;
      if (api.key('ArrowRight') || api.key('KeyD')) dx += 1;
      if (api.key('ArrowUp') || api.key('KeyW')) dy -= 1;
      if (api.key('ArrowDown') || api.key('KeyS')) dy += 1;
      const sp = 130 * (1 + s.level * 0.5);
      s.x += dx * sp * dt; s.y += dy * sp * dt;
      const holding = api.key('Space') || api.key('KeyZ') || api.pointer.down;
      if (holding) {
        s.holdT += dt;
        if (s.holdT > 1.2) {
          s.holdT = 0;
          s.level = Math.min(LEVELS.length - 1, s.level + 1);
          s.maxLvl = Math.max(s.maxLvl, s.level);
          s.quote = QUOTES[s.level - 1] || QUOTES[0]; s.quoteT = 4; s.anim = 1;
          api.chord([262 * Math.pow(1.25, s.level), 330 * Math.pow(1.25, s.level)], 1.2, 'sine', 0.05);
        }
      } else {
        if (s.holdT > 0.35 && s.level > 0) {
          s.level--;
          s.quote = 'вы ныряете внутрь…'; s.quoteT = 2; s.anim = 1;
          api.tone(300 * Math.pow(1.2, s.level), 0.4, 'sine', 0.04, -100);
        }
        s.holdT = 0;
      }
      s.anim = Math.max(0, s.anim - dt * 1.6);
      s.quoteT -= dt;
      s.things.forEach(th => {
        th.x += Math.cos(th.p + api.time * 0.3) * 12 * dt * (th.lvl - s.level);
        th.y += Math.sin(th.p + api.time * 0.22) * 12 * dt * (th.lvl - s.level);
      });
      api.setScore(s.maxLvl);
      if (s.level === LEVELS.length - 1 && s.maxLvl >= LEVELS.length - 1 && s.quoteT <= 0 && !s.done) {
        s.done = true;
        api.end('ВЫ — ВСЁ\nвы побывали на всех ' + LEVELS.length + ' уровнях бытия\n(в оригинале таких «вещей» — тысячи)');
      }
    },
    draw(api, s) {
      const { ctx } = api;
      const L = LEVELS[s.level];
      // фон по уровню
      const deep = s.level / (LEVELS.length - 1);
      const g = ctx.createLinearGradient(0, 0, 0, api.H);
      g.addColorStop(0, deep < 0.5 ? '#cfe8f5' : '#0a0a1e');
      g.addColorStop(1, deep < 0.5 ? '#9fc4e0' : '#181030');
      ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H);
      if (deep >= 0.5) {
        s.stars.forEach(st => {
          let sx = st.x - s.x * 0.4 + api.W / 2, sy = st.y - s.y * 0.4 + api.H / 2;
          sx = ((sx % 2200) + 2600) % 2200 - 600; sy = ((sy % 1600) + 2000) % 1600 - 700;
          ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + st.s * 0.2) + ')';
          ctx.fillRect(sx, sy, st.s, st.s);
        });
      } else {
        ctx.fillStyle = '#7db46a'; ctx.fillRect(0, api.H - 120, api.W, 120);
      }
      // zoom-анимация
      const z = 1 + s.anim * 0.6;
      ctx.save();
      ctx.translate(api.W / 2, api.H / 2); ctx.scale(z, z); ctx.translate(-api.W / 2, -api.H / 2);
      // существа
      s.things.forEach((th, i) => {
        if (th.lvl === s.level) {
          let sx = th.x - s.x + api.W / 2, sy = th.y - s.y + api.H / 2;
          sx = ((sx % 2000) + 2400) % 2000 - 600; sy = ((sy % 1400) + 2000) % 1400 - 700;
          const r = L.size * (0.5 + (i % 5) * 0.16);
          ctx.fillStyle = LEVELS[th.lvl].color;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.beginPath(); ctx.arc(sx + r * 0.3, sy - r * 0.2, Math.max(1.5, r * 0.14), 0, 6.283); ctx.fill();
        }
      });
      // вы
      const bob = Math.sin(api.time * 2.4) * 3;
      ctx.fillStyle = L.color;
      ctx.beginPath(); ctx.arc(api.W / 2, api.H / 2 + bob, L.size, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(api.W / 2, api.H / 2 + bob, L.size + 6 + Math.sin(api.time * 3) * 2, 0, 6.283); ctx.stroke();
      ctx.restore();
      // HUD-уровень
      ctx.textAlign = 'center';
      ctx.fillStyle = deep >= 0.5 ? '#fff' : '#123';
      ctx.font = '700 22px Inter, sans-serif';
      ctx.fillText(L.name, api.W / 2, 60);
      ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = deep >= 0.5 ? '#aab' : '#456';
      // шкала масштаба
      for (let i = 0; i < LEVELS.length; i++) {
        ctx.fillStyle = i === s.level ? '#fff' : 'rgba(150,150,170,0.5)';
        ctx.fillRect(api.W / 2 - (LEVELS.length * 14) / 2 + i * 14, 76, 8, 8);
      }
      if (s.quoteT > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, api.H - 96, api.W, 44);
        ctx.fillStyle = '#f2ead8'; ctx.font = 'italic 16px Georgia, serif';
        ctx.fillText(s.quote, api.W / 2, api.H - 68);
      }
      const holding = api.key('Space') || api.key('KeyZ') || api.pointer.down;
      ctx.fillStyle = deep >= 0.5 ? '#9ab' : '#456'; ctx.font = '13px Inter, sans-serif';
      ctx.fillText(holding ? 'вырастайте…' : 'ЗАЖМИТЕ пробел — стать больше · отпустите — нырнуть внутрь', api.W / 2, api.H - 24);
      drawHud(api, 'EVERYTHING · after David OReilly (2017)', 'уровень ' + (s.level + 1) + ' / ' + LEVELS.length);
    },
  };

  /* ---------- 09. DEVICE 6 (после Simogo) ---------- */
  GAMES.device6 = {
    touch: [],
    init(api) {
      return { room: 'wake', typed: '', shake: 0, done: false, t: 0 };
    },
    update(api, s, dt) {
      s.t += dt;
      s.shake = Math.max(0, s.shake - dt * 2);
      // клики по дверям-словам
      if (api.pointer.clicked) {
        const hit = doorAt(s, api.pointer.x, api.pointer.y);
        if (hit) {
          if (hit === 'safe' && s.room === 'east') { s.keypad = true; }
          else if (hit === 'close') { s.keypad = false; s.typed = ''; }
          else if (s.keypad) {
            if (/^[0-9]$/.test(hit) && s.typed.length < 3) { s.typed += hit; api.tone(500, 0.06, 'square', 0.04); }
            else if (hit === 'clr') { s.typed = ''; }
            else if (hit === 'ok') {
              if (s.typed === '314') {
                s.done = true;
                api.chord([523, 659, 784, 1047], 2.5, 'sine', 0.05);
                api.end('ГЛАВА ПРОЧИТАНА\nкод 3-1-4 был спрятан в тексте\nDEVICE 6: слова — это пространство');
              } else { s.shake = 1; s.typed = ''; api.tone(120, 0.2, 'sawtooth', 0.05); }
            }
          }
          else if (s.room === 'wake' && hit === 'sleep') { s.room = 'nexus'; api.tone(330, 0.3, 'sine', 0.04); }
          else if (hit === 'doorE') { s.room = 'east'; api.tone(392, 0.15, 'triangle', 0.04); }
          else if (hit === 'doorN') { s.room = 'north'; api.tone(392, 0.15, 'triangle', 0.04); }
          else if (hit === 'back') { s.room = s.room === 'nexus' ? 'wake' : 'nexus'; api.tone(262, 0.12, 'triangle', 0.04); }
        } else if (s.room === 'north' && api.pointer.y > 330 && api.pointer.y < 390 && api.pointer.x > 380 && api.pointer.x < 580) {
          s.clue2 = !s.clue2; api.tone(440, 0.1, 'sine', 0.04);
        } else if (s.room === 'east' && api.pointer.x > 180 && api.pointer.x < 780 && api.pointer.y > 180 && api.pointer.y < 240) {
          s.clue1 = !s.clue1; api.tone(440, 0.1, 'sine', 0.04);
        }
      }
    },
    draw(api, s) {
      const { ctx } = api;
      ctx.fillStyle = '#0d0d10'; ctx.fillRect(0, 0, api.W, api.H);
      ctx.textAlign = 'center';
      const serif = 'Georgia, serif';
      if (s.room === 'wake') {
        ctx.fillStyle = '#e8e2d4'; ctx.font = 'italic 22px ' + serif;
        line(ctx, 'Анна просыпается. Комната незнакомая.', api.W / 2, 120);
        ctx.font = '16px ' + serif; ctx.fillStyle = '#9a938a';
        line(ctx, 'Дверь на север заперта. Восточная — приоткрыта.', api.W / 2, 170);
        line(ctx, 'На стене — надпись, выцарапанная кем-то до неё:', api.W / 2, 200);
        ctx.fillStyle = '#e8e2d4'; ctx.font = 'italic 18px ' + serif;
        line(ctx, '«Сейф открывается тому, кто помнит начало числа круга.»', api.W / 2, 240);
        door(ctx, 'ВОСТОК →', 620, 400, 200, 46, '#e8e2d4');
        s._doors = [{ id: 'doorE', x: 620, y: 400, w: 200, h: 46 }];
        if (!s.clue1) { ctx.fillStyle = '#6a655c'; ctx.font = '13px ' + serif; line(ctx, '(кликните по надписи выше — прочитать внимательнее)', api.W / 2, 285); }
      } else if (s.room === 'nexus') {
        ctx.fillStyle = '#e8e2d4'; ctx.font = 'italic 22px ' + serif;
        line(ctx, 'Коридор из строк.', api.W / 2, 110);
        ctx.font = '15px ' + serif; ctx.fillStyle = '#9a938a';
        line(ctx, 'Абзац поворачивает на восток. Запятая — на север.', api.W / 2, 160);
        ctx.save();
        ctx.translate(api.W / 2, 300); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#4d6a8a'; ctx.font = '700 26px ' + serif;
        ctx.fillText('С Е В Е Р', 0, 0);
        ctx.restore();
        door(ctx, 'СЕВЕР ↑', 380, 320, 200, 46, '#8fb7e8');
        door(ctx, 'ВОСТОК →', 620, 400, 200, 46, '#e8e2d4');
        s._doors = [{ id: 'doorN', x: 380, y: 320, w: 200, h: 46 }, { id: 'doorE', x: 620, y: 400, w: 200, h: 46 }];
        backDoor(ctx);
        s._doors.push({ id: 'back', x: 30, y: 30, w: 150, h: 40 });
      } else if (s.room === 'north') {
        ctx.fillStyle = '#e8e2d4'; ctx.font = 'italic 20px ' + serif;
        line(ctx, 'Северная комната. Холодно. На стене картина в раме.', api.W / 2, 110);
        // картина из текста
        ctx.strokeStyle = '#7a5c22'; ctx.lineWidth = 3;
        ctx.strokeRect(380, 150, 200, 180);
        ctx.fillStyle = '#1a2436'; ctx.fillRect(386, 156, 188, 168);
        ctx.fillStyle = '#8fb7e8'; ctx.font = 'italic 15px ' + serif;
        line(ctx, 'лес', 480, 200); line(ctx, 'и', 500, 230); line(ctx, 'ещё лес', 470, 262);
        ctx.fillStyle = '#c9a13b'; ctx.font = '700 20px ' + serif;
        line(ctx, s.clue2 ? 'на обороте рамы карандашом: «вторая цифра — 1»' : '(кликните по картине)', 480, 305);
        ctx.fillStyle = '#9a938a'; ctx.font = '14px ' + serif;
        line(ctx, 'Подпись на раме: «вторая из трёх». Рядом чья-та пометка: «а средняя всегда одинока».', api.W / 2, 380);
        backDoor(ctx);
        s._doors = [{ id: 'back', x: 30, y: 30, w: 150, h: 40 }];
      } else if (s.room === 'east') {
        ctx.fillStyle = '#e8e2d4'; ctx.font = 'italic 20px ' + serif;
        line(ctx, 'Восточная комната. Сейф. На полу — окровавленный след из точек.', api.W / 2, 110);
        ctx.fillStyle = '#9a938a'; ctx.font = 'italic 16px ' + serif;
        line(ctx, '· · · · · · · · · · · · · · · · · · · · · · · · · · ·', api.W / 2, 160);
        ctx.fillStyle = '#e8e2d4';
        line(ctx, s.clue1 ? 'считая точки до поворота, Анна насчитывает: первых цифр — ровно ТРИ' : '(кликните по следу — сосчитать точки)', api.W / 2, 210);
        ctx.fillStyle = '#9a938a'; ctx.font = '14px ' + serif;
        line(ctx, 'Три цифры. Сейф ждёт. «Число круга» начинается с трёх…', api.W / 2, 250);
        // сейф
        ctx.fillStyle = '#3a3f4a'; ctx.fillRect(api.W / 2 - 70, 300, 140, 120);
        ctx.fillStyle = '#14161c'; ctx.fillRect(api.W / 2 - 44, 320, 88, 30);
        ctx.fillStyle = s.typed ? '#9be36b' : '#666'; ctx.font = '700 20px monospace';
        line(ctx, (s.typed || '···').split('').join(' '), api.W / 2, 341);
        door(ctx, 'ОТКРЫТЬ КЛАВИАТУРУ', api.W / 2 - 110, 440, 220, 40, '#c9a13b');
        backDoor(ctx);
        s._doors = [{ id: 'back', x: 30, y: 30, w: 150, h: 40 }, { id: 'safe', x: api.W / 2 - 110, y: 440, w: 220, h: 40 }];
      }
      // клавиатура сейфа
      if (s.keypad) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, api.W, api.H);
        const ox = api.W / 2 + (s.shake > 0 ? Math.sin(api.time * 40) * 6 * s.shake : 0);
        ctx.fillStyle = '#e8e2d4'; ctx.font = '700 22px ' + serif;
        line(ctx, 'СЕЙФ · три цифры', ox, 140);
        ctx.font = '700 30px monospace'; ctx.fillStyle = '#9be36b';
        line(ctx, (s.typed || '_ _ _').split('').join(' '), ox, 185);
        const keys = ['1','2','3','4','5','6','7','8','9','clr','0','ok'];
        s._doors = [];
        keys.forEach((k, i) => {
          const cx = ox - 110 + (i % 3) * 110, cy = 240 + Math.floor(i / 3) * 74;
          ctx.fillStyle = '#22252e'; ctx.fillRect(cx - 42, cy - 26, 84, 52);
          ctx.strokeStyle = '#4a4f5c'; ctx.strokeRect(cx - 42, cy - 26, 84, 52);
          ctx.fillStyle = k === 'ok' ? '#9be36b' : k === 'clr' ? '#e87a7a' : '#e8e2d4';
          ctx.font = '700 20px Inter, sans-serif';
          line(ctx, k === 'ok' ? 'OK' : k === 'clr' ? 'C' : k, cx, cy + 7);
          s._doors.push({ id: k, x: cx - 42, y: cy - 26, w: 84, h: 52 });
        });
        ctx.fillStyle = '#8a857c'; ctx.font = '13px ' + serif;
        line(ctx, 'подсказки разбросаны по тексту комнат', ox, 570);
      }
      drawHud(api, 'DEVICE 6 · after Simogo (2013)', s.keypad ? 'код из трёх цифр' : 'клик по подчёркнутым словам — переходы');
    },
  };
  function line(ctx, txt, x, y) { ctx.fillText(txt, x, y); }
  function door(ctx, label, x, y, w, h, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = color; ctx.font = '700 15px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 5);
    ctx.textAlign = 'center';
  }
  function backDoor(ctx) { door(ctx, '← назад', 30, 30, 150, 40, '#8a857c'); }
  function doorAt(s, x, y) {
    const list = s._doors || [];
    for (const d of list) if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return d.id;
    return null;
  }

  /* ---------- 10. Yume Nikki (после Kikiyama) ---------- */
  GAMES.yume = {
    touch: ['left', 'right', 'up', 'down', 'a'],
    init(api) {
      return {
        scene: 'room', x: 480, y: 320, fx: [], effects: [],
        worlds: {
          numbers: { got: false, tx: 130, ty: 120 },
          forest: { got: false, tx: 800, ty: 110 },
          neon: { got: false, tx: 480, ty: 430 },
        },
        uboa: 0,
      };
    },
    update(api, s, dt) {
      const sp = s.effects.includes('bicycle') ? 150 : 80;
      let dx = 0, dy = 0;
      if (api.key('ArrowLeft') || api.key('KeyA')) dx -= 1;
      if (api.key('ArrowRight') || api.key('KeyD')) dx += 1;
      if (api.key('ArrowUp') || api.key('KeyW')) dy -= 1;
      if (api.key('ArrowDown') || api.key('KeyS')) dy += 1;
      s.x += dx * sp * dt; s.y += dy * sp * dt;
      const act = api.wasPressed('KeyZ') || api.wasPressed('Enter') || api.wasPressed('Space');
      if (s.scene === 'room') {
        s.x = clamp(s.x, 200, 760); s.y = clamp(s.y, 180, 460);
        if (act && Math.hypot(s.x - 640, s.y - 200) < 60) { s.scene = 'nexus'; s.x = 480; s.y = 480; api.tone(196, 0.8, 'sine', 0.05, 60); }
      } else if (s.scene === 'nexus') {
        s.x = clamp(s.x, 80, 880); s.y = clamp(s.y, 90, 500);
        const doors = [{ id: 'numbers', x: 180, y: 140 }, { id: 'forest', x: 780, y: 140 }, { id: 'neon', x: 480, y: 110 }];
        if (act) {
          for (const d of doors) {
            if (Math.hypot(s.x - d.x, s.y - d.y) < 55) { s.scene = d.id; s.x = 480; s.y = 470; api.tone(147, 0.6, 'sine', 0.05); }
          }
        }
      } else {
        // миры снов
        s.x = clamp(s.x, 60, 900); s.y = clamp(s.y, 80, 500);
        const w = s.worlds[s.scene];
        if (act && Math.hypot(s.x - w.tx, s.y - w.ty) < 50 && !w.got) {
          w.got = true;
          const eff = { numbers: 'зонтик', forest: 'велосипед', neon: 'фонарь' }[s.scene];
          s.effects.push(eff);
          api.chord([262, 330, 392, 523], 1.8, 'triangle', 0.05);
          s.fx.push({ text: 'получен эффект: ' + eff.toUpperCase(), t: 3 });
        }
        if (act && Math.hypot(s.x - 480, s.y - 500) < 60) { s.scene = 'nexus'; s.x = 480; s.y = 140; api.tone(165, 0.4, 'sine', 0.04); }
      }
      s.fx.forEach(f => f.t -= dt); s.fx = s.fx.filter(f => f.t > 0);
      api.setScore(s.effects.length);
      if (s.effects.length >= 3 && !s.done) {
        s.done = true;
        setTimeout(() => { }, 0);
        api.end('ВЫ СОБРАЛИ ВСЕ ЭФФЕКТЫ: ' + s.effects.join(', ') + '\nМадоцуки просыпается.\n(в оригинале их 24 — и никто не объясняет зачем)');
      }
    },
    draw(api, s) {
      const { ctx } = api;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, api.W, api.H);
      ctx.textAlign = 'center';
      if (s.scene === 'room') {
        ctx.fillStyle = '#1a1410'; ctx.fillRect(200, 180, 560, 280);
        ctx.strokeStyle = '#3a2f22'; ctx.strokeRect(200, 180, 560, 280);
        // кровать
        ctx.fillStyle = '#5c2e2e'; ctx.fillRect(600, 160, 120, 80);
        ctx.fillStyle = '#d9d0c0'; ctx.fillRect(600, 160, 120, 22);
        // стол, телевизор
        ctx.fillStyle = '#4a3b28'; ctx.fillRect(260, 200, 90, 60);
        ctx.fillStyle = '#222'; ctx.fillRect(270, 168, 70, 40);
        ctx.fillStyle = '#445'; ctx.fillRect(276, 174, 58, 28);
        ctx.fillStyle = '#6a5a40'; ctx.font = '11px monospace';
        line(ctx, 'кровать → спать (Z)', 660, 265);
        line(ctx, 'телевизор молчит', 305, 290);
        drawMado(ctx, s.x, s.y, s.effects);
        ctx.fillStyle = '#7a7268'; ctx.font = 'italic 13px Georgia, serif';
        line(ctx, 'Мадоцуки давно не выходит из комнаты.', api.W / 2, 100);
        line(ctx, 'Единственная дверь наружу — во сне. Подойдите к кровати и нажмите Z.', api.W / 2, 124);
      } else if (s.scene === 'nexus') {
        // Некс: тёмная площадка с дверями
        ctx.fillStyle = '#0a0a12'; ctx.fillRect(60, 80, 840, 440);
        ctx.strokeStyle = '#232338'; ctx.strokeRect(60, 80, 840, 440);
        const doors = [['numbers', 180, 140, '#8a5cff', 'ЧИСЛА'], ['forest', 780, 140, '#3f7a3e', 'ЛЕС'], ['neon', 480, 110, '#ff4d94', 'НЕОН']];
        doors.forEach(d => {
          const got = s.worlds[d[0]].got;
          ctx.fillStyle = got ? '#222' : d[2];
          ctx.fillRect(d[1] - 34, d[2] === undefined ? 0 : d[2], 0, 0);
          ctx.fillRect(d[1] - 34, d[2] ? d[2] : 0, 0, 0);
          ctx.fillStyle = got ? '#1c1c26' : d[2];
          ctx.fillRect(d[1] - 30, d[2] ? 0 : 0, 0, 0);
          ctx.fillRect(d[1] - 30, 100, 60, 76);
          ctx.fillStyle = got ? '#555' : '#fff';
          ctx.font = '700 12px monospace';
          line(ctx, got ? '···' : d[3], d[1], 150);
        });
        ctx.fillStyle = '#55506a'; ctx.font = 'italic 14px Georgia, serif';
        line(ctx, 'НЕКСУС · дверей много, слов никаких', api.W / 2, 520);
        drawMado(ctx, s.x, s.y, s.effects);
        ctx.fillStyle = '#8a857c'; ctx.font = '12px monospace';
        line(ctx, 'эффектов: ' + s.effects.length + ' / 3', api.W / 2, 546);
      } else {
        // миры снов
        const w = s.scene;
        if (w === 'numbers') {
          ctx.fillStyle = '#120a20'; ctx.fillRect(0, 0, api.W, api.H);
          for (let x = 0; x < api.W; x += 48) for (let y = 0; y < api.H; y += 48) {
            ctx.fillStyle = `hsl(${(x + y) % 360}, 50%, ${12 + ((x * y) % 20)}%)`;
            ctx.fillRect(x + 4, y + 4, 40, 40);
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '10px monospace';
            line(ctx, String((x / 48 + y / 48) % 10 | 0), x + 24, y + 28);
          }
          ctx.fillStyle = '#cabcff'; ctx.font = 'italic 13px Georgia, serif';
          line(ctx, 'мир чисел. здесь всё считается, но ничего не значит.', api.W / 2, 60);
        } else if (w === 'forest') {
          ctx.fillStyle = '#061206'; ctx.fillRect(0, 0, api.W, api.H);
          for (let i = 0; i < 60; i++) {
            const x = (i * 173) % api.W, y = 90 + (i * 97) % 400;
            ctx.fillStyle = '#0f2410'; ctx.fillRect(x, y, 14, 40);
            ctx.fillStyle = '#143218'; ctx.fillRect(x - 8, y - 18, 30, 24);
          }
          ctx.fillStyle = '#9be36b'; ctx.font = 'italic 13px Georgia, serif';
          line(ctx, 'лес. деревья смотрят. одно из них — не дерево.', api.W / 2, 60);
        } else {
          ctx.fillStyle = '#160616'; ctx.fillRect(0, 0, api.W, api.H);
          ctx.strokeStyle = 'rgba(255,77,148,0.4)';
          for (let i = 0; i < 16; i++) {
            ctx.beginPath();
            ctx.moveTo((i * 67) % api.W, 0); ctx.lineTo((i * 67 + 200) % api.W, api.H);
            ctx.stroke();
          }
          ctx.fillStyle = '#ff9dc4'; ctx.font = 'italic 13px Georgia, serif';
          line(ctx, 'неоновый мир. свет здесь громче слов.', api.W / 2, 60);
        }
        // предмет-эффект
        const wd = s.worlds[w];
        if (!wd.got) {
          const pulse = 1 + Math.sin(api.time * 4) * 0.15;
          ctx.fillStyle = w === 'numbers' ? '#cabcff' : w === 'forest' ? '#9be36b' : '#ff9dc4';
          ctx.save(); ctx.translate(wd.tx, wd.ty); ctx.scale(pulse, pulse);
          ctx.fillRect(-12, -12, 24, 24);
          ctx.restore();
          ctx.font = '11px monospace'; ctx.fillStyle = '#888';
          line(ctx, 'Z — взять', wd.tx, wd.ty + 30);
        }
        // возврат в нексус
        ctx.fillStyle = '#333'; ctx.fillRect(430, 495, 100, 34);
        ctx.strokeStyle = '#666'; ctx.strokeRect(430, 495, 100, 34);
        ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
        line(ctx, '← НЕКСУС (Z)', 480, 516);
        drawMado(ctx, s.x, s.y, s.effects);
      }
      s.fx.forEach(f => {
        ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, f.t) + ')';
        ctx.font = '700 18px Inter, sans-serif';
        line(ctx, f.text, api.W / 2, 80);
      });
      drawHud(api, 'YUME NIKKI · after Kikiyama (2004)', 'Z — действие · эффектов: ' + s.effects.length + ' / 3');
    },
  };
  function drawMado(ctx, x, y, effects) {
    ctx.fillStyle = '#3a2440'; ctx.fillRect(x - 10, y - 8, 20, 22); // платье/свитер
    ctx.fillStyle = '#f0d8c8'; ctx.fillRect(x - 8, y - 22, 16, 14);  // лицо
    ctx.fillStyle = '#4a2436'; ctx.fillRect(x - 10, y - 28, 20, 8);  // волосы
    if (effects.includes('зонтик')) { ctx.fillStyle = '#8a5cff'; ctx.fillRect(x + 12, y - 30, 3, 34); ctx.fillRect(x + 4, y - 34, 20, 6); }
    if (effects.includes('велосипед')) { ctx.strokeStyle = '#c9a13b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x - 12, y + 16, 8, 0, 6.283); ctx.arc(x + 12, y + 16, 8, 0, 6.283); ctx.stroke(); }
    if (effects.includes('фонарь')) { ctx.fillStyle = '#ffe9a3'; ctx.beginPath(); ctx.arc(x, y - 40, 6, 0, 6.283); ctx.fill(); }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- HUD и экспорт ---------- */
  function drawHud(api, title, sub) {
    const { ctx } = api;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, api.H - 26, api.W, 26);
    ctx.fillStyle = '#9a958c'; ctx.font = '11px Inter, sans-serif';
    ctx.fillText(title, 12, api.H - 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6f6a62';
    ctx.fillText(sub, api.W - 12, api.H - 9);
    ctx.restore();
  }

  return { mountGame, GAMES, hashStr };
})();
