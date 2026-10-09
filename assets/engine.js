    /* ============================================================
       PALETTES
       ============================================================ */
    const PALETTES = {
      aurora: ['#06d6a0', '#118ab2', '#073b4c', '#ef476f', '#ffd166'],
      lava:   ['#590d22', '#a4133c', '#c9184a', '#ff4d6d', '#ff8fa3', '#ffb3c1'],
      ocean:  ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'],
      forest: ['#1b4332', '#2d6a4f', '#40916c', '#74c69d', '#b7e4c7'],
      mono:   ['#111111', '#333333', '#666666', '#999999', '#dddddd'],
      duotone:['#79A0FF', '#ffd166'],
    };

    /* ============================================================
       COMMON HELPERS
       ============================================================ */
    function hashStringToInt(s) {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
    function hexToRgb(hex) {
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function mulberry32(a) {
      return function () {
        let t = (a += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function stepLife(ctx) {
      const { cols, rows, grid, next } = ctx;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = (x + dx + cols) % cols;
              const ny = (y + dy + rows) % rows;
              n += grid[ny * cols + nx];
            }
          }
          const alive = grid[y * cols + x];
          next[y * cols + x] = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
        }
      }
      ctx.grid = next;
      ctx.next = grid;
    }

    /* ============================================================
       ALGORITHMS
       ============================================================ */
    const ALGORITHMS = {

      flow_field: {
        label: 'Flow Field',
        short: 'Поток частиц по шумовому полю.',
        sensorReinit: false,
        sensors: { bass: 'complexity', mid: 'mutation', treble: 'density', tiltY: 'complexity' },
        about: {
          intro: 'Частицы движутся по полю, которое построено на основе шума Перлина.',
          param: 'bass → сложность, mid → мутация, treble → плотность.',
          seed: 'Зерно задаёт стартовое состояние.',
        },
        params: [
          { id: 'complexity', label: 'Сложность', min: 0.001, max: 0.020, step: 0.0005, default: 0.006, format: v => v.toFixed(4) },
          { id: 'density', label: 'Плотность', min: 100, max: 3000, step: 50, default: 900, format: v => Math.round(v).toString() },
          { id: 'mutation', label: 'Мутация', min: 0, max: 1, step: 0.05, default: 0.3, format: v => v.toFixed(2) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'aurora', options: ['aurora','lava','ocean','forest','mono'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const palette = PALETTES[state.params.palette] || PALETTES.aurora;
          ctx.particles = [];
          ctx.palette = palette;
          ctx.z = rng() * 1000;
          for (let i = 0; i < state.params.density; i++) {
            ctx.particles.push({
              x: rng() * p.width, y: rng() * p.height,
              life: 60 + rng() * 240, age: 0,
              colorIdx: Math.floor(rng() * palette.length),
            });
          }
          ctx.tick = 0;
        },
        draw(p, state, ctx) {
          p.noStroke();
          p.fill(10, 10, 12, 18);
          p.rect(0, 0, p.width, p.height);
          const rng = mulberry32(hashStringToInt(state.seed) + ctx.tick);
          const complexity = state.params.complexity;
          const mutation = state.params.mutation;
          for (const pt of ctx.particles) {
            const n = p.noise(pt.x * complexity, pt.y * complexity, ctx.z);
            const angle = n * Math.PI * 4;
            pt.x += Math.cos(angle) * 1.2;
            pt.y += Math.sin(angle) * 1.2;
            pt.age++;
            if (rng() < mutation * 0.04) {
              pt.x += (rng() - 0.5) * 20;
              pt.y += (rng() - 0.5) * 20;
            }
            const col = p.color(ctx.palette[pt.colorIdx]);
            col.setAlpha(140);
            p.fill(col);
            p.circle(pt.x, pt.y, 1.5);
            if (pt.age > pt.life || pt.x < 0 || pt.x > p.width || pt.y < 0 || pt.y > p.height) {
              pt.x = rng() * p.width; pt.y = rng() * p.height;
              pt.age = 0; pt.life = 60 + rng() * 240;
              pt.colorIdx = Math.floor(rng() * ctx.palette.length);
            }
          }
          ctx.z += 0.002; ctx.tick++;
        },
      },

      curl_noise: {
        label: 'Curl Noise',
        short: 'Безвихревое поле — частицы плывут ровнее.',
        sensorReinit: false,
        sensors: { bass: 'scale', mid: 'speed', treble: 'count', tiltY: 'scale' },
        about: {
          intro: 'Тот же шум Перлина, только поле скоростей получают из «curl» — поворота градиента.',
          param: 'bass → масштаб, mid → скорость, treble → кол-во частиц.',
          seed: 'Зерно определяет начальную фазу шума.',
        },
        params: [
          { id: 'count', label: 'Частиц', min: 100, max: 2000, step: 50, default: 600, format: v => Math.round(v).toString() },
          { id: 'speed', label: 'Скорость', min: 0.3, max: 4, step: 0.1, default: 1.5, format: v => v.toFixed(1) },
          { id: 'scale', label: 'Масштаб', min: 0.002, max: 0.02, step: 0.0005, default: 0.005, format: v => v.toFixed(4) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'ocean', options: ['ocean','aurora','forest','lava','mono'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.particles = [];
          ctx.z = rng() * 1000;
          ctx.palette = PALETTES[state.params.palette] || PALETTES.ocean;
          for (let i = 0; i < state.params.count; i++) {
            ctx.particles.push({
              x: rng() * p.width, y: rng() * p.height,
              life: 80 + rng() * 200, age: 0,
              colorIdx: Math.floor(rng() * ctx.palette.length),
            });
          }
          ctx.tick = 0;
        },
        draw(p, state, ctx) {
          p.noStroke();
          p.fill(10, 10, 12, 14);
          p.rect(0, 0, p.width, p.height);
          const rng = mulberry32(hashStringToInt(state.seed) + ctx.tick);
          const scale = state.params.scale;
          const speed = state.params.speed;
          const eps = 1.5;
          for (const pt of ctx.particles) {
            const ny = p.noise(pt.x * scale, (pt.y + eps) * scale, ctx.z);
            const n0 = p.noise(pt.x * scale, pt.y * scale, ctx.z);
            const dy = (ny - n0) / eps;
            const nx = p.noise((pt.x + eps) * scale, pt.y * scale, ctx.z);
            const dx = (nx - n0) / eps;
            pt.x += dy * speed * 50;
            pt.y += -dx * speed * 50;
            pt.age++;
            const col = p.color(ctx.palette[pt.colorIdx]);
            col.setAlpha(140);
            p.fill(col);
            p.circle(pt.x, pt.y, 1.5);
            if (pt.age > pt.life || pt.x < 0 || pt.x > p.width || pt.y < 0 || pt.y > p.height) {
              pt.x = rng() * p.width; pt.y = rng() * p.height;
              pt.age = 0; pt.life = 80 + rng() * 200;
              pt.colorIdx = Math.floor(rng() * ctx.palette.length);
            }
          }
          ctx.z += 0.002; ctx.tick++;
        },
      },

      perlin_noise: {
        label: 'Perlin Noise',
        short: 'Сам шум Перлина — сравните с белым шумом random.',
        sensorReinit: false,
        about: {
          intro: 'Классический градиентный шум Кена Перлина: случайные значения в узлах сетки, плавно смешанные между собой.',
          param: 'Масштаб — «зум» по полю шума; октавы — слои детализации; затухание — вклад каждого следующего слоя.',
          seed: 'Зерно смещает поле: свой seed — свой «рельеф» шума.',
        },
        params: [
          { id: 'type', label: 'Тип', type: 'select', default: 'perlin', options: ['perlin', 'random'] },
          { id: 'scale', label: 'Масштаб', min: 0.005, max: 0.3, step: 0.005, default: 0.04, format: v => v.toFixed(3) },
          { id: 'octaves', label: 'Октавы', min: 1, max: 8, step: 1, default: 4, format: v => Math.round(v).toString() },
          { id: 'falloff', label: 'Затухание', min: 0, max: 1, step: 0.05, default: 0.5, format: v => v.toFixed(2) },
          { id: 'colors', label: 'Цвет', type: 'select', default: 'gray', options: ['gray', 'aurora', 'lava', 'ocean', 'forest'] },
        ],
        init(p, state, ctx) {
          ctx.rendered = false;
        },
        draw(p, state, ctx) {
          if (ctx.rendered) return;
          ctx.rendered = true;
          const type = state.params.type;
          const scale = state.params.scale;
          const oct = Math.max(1, Math.round(state.params.octaves));
          const fall = state.params.falloff;
          const rng = mulberry32(hashStringToInt(state.seed));
          const ox = rng() * 2048, oy = rng() * 2048;
          const palRGB = state.params.colors === 'gray'
            ? null
            : (PALETTES[state.params.colors] || PALETTES.aurora).map(hexToRgb);

          // Рендерим в пониженном разрешении и растягиваем: шум непрерывный,
          // поэтому визуально не отличить, а считается за миллисекунды.
          const R = Math.min(280, Math.max(64, Math.floor(p.width / 2)));
          const RH = Math.max(64, Math.round(R * p.height / p.width));
          const off = document.createElement('canvas');
          off.width = R; off.height = RH;
          const c2 = off.getContext('2d');
          const img = c2.createImageData(R, RH);
          const d = img.data;

          p.noiseDetail(oct, fall);
          let i = 0;
          for (let y = 0; y < RH; y++) {
            for (let x = 0; x < R; x++) {
              const raw = type === 'random' ? rng() : p.noise(ox + x * scale, oy + y * scale);
              const v = Math.max(0, Math.min(1, raw));
              let r, g, b;
              if (palRGB) {
                const pos = v * (palRGB.length - 1);
                const i0 = Math.floor(pos), f = pos - i0;
                const cA = palRGB[i0], cB = palRGB[Math.min(palRGB.length - 1, i0 + 1)];
                r = cA[0] + (cB[0] - cA[0]) * f;
                g = cA[1] + (cB[1] - cA[1]) * f;
                b = cA[2] + (cB[2] - cA[2]) * f;
              } else {
                r = g = b = v * 255;
              }
              d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = 255;
            }
          }
          // noiseDetail — глобальная настройка p5: возвращаем дефолт,
          // чтобы не сломать другие алгоритмы на этой странице.
          p.noiseDetail(4, 0.5);
          c2.putImageData(img, 0, 0);
          // Растягиваем на весь холст напрямую через контекст (в backing-пикселях,
          // с identity-трансформом — так надёжнее, чем через p5 image()).
          const c2d = p.drawingContext;
          const dens = p.pixelDensity();
          c2d.save();
          c2d.setTransform(1, 0, 0, 1, 0, 0);
          c2d.imageSmoothingEnabled = type !== 'random'; // белый шум — чёткими «квадратиками»
          c2d.imageSmoothingQuality = 'high';
          c2d.drawImage(off, 0, 0, p.width * dens, p.height * dens);
          c2d.restore();
        },
      },

      wave_interference: {
        label: 'Wave Interference',
        short: 'Сумма синусоид от нескольких источников.',
        sensorReinit: true,
        sensors: { bass: 'wavelength', mid: 'amplitude', treble: 'sources', tiltX: 'wavelength' },
        about: {
          intro: 'Несколько «источников» излучают синусоидальные волны.',
          param: 'bass → длина волны, mid → амплитуда, treble → кол-во источников.',
          seed: 'Стартовые позиции источников случайны по seed.',
        },
        params: [
          { id: 'sources', label: 'Источники', min: 2, max: 10, step: 1, default: 5, format: v => Math.round(v).toString() },
          { id: 'wavelength', label: 'Длина волны', min: 15, max: 80, step: 1, default: 35, format: v => Math.round(v).toString() + 'px' },
          { id: 'amplitude', label: 'Амплитуда', min: 0.2, max: 1, step: 0.05, default: 0.6, format: v => v.toFixed(2) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'ocean', options: ['ocean','lava','aurora','mono','duotone'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.sources = [];
          for (let i = 0; i < state.params.sources; i++) {
            ctx.sources.push({ x: rng() * p.width, y: rng() * p.height, phase: rng() * Math.PI * 2 });
          }
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const wl = state.params.wavelength;
          const amp = state.params.amplitude;
          const palette = PALETTES[state.params.palette] || PALETTES.ocean;
          const sources = ctx.sources;
          const step = 4;
          p.noStroke();
          for (let y = 0; y < p.height; y += step) {
            for (let x = 0; x < p.width; x += step) {
              let sum = 0;
              for (let i = 0; i < sources.length; i++) {
                const s = sources[i];
                const dx = x - s.x;
                const dy = y - s.y;
                const d = Math.sqrt(dx*dx + dy*dy);
                sum += Math.sin(d * Math.PI * 2 / wl + s.phase);
              }
              sum = (sum / sources.length) * amp;
              const v = (sum + 1) / 2;
              const idx = Math.floor(v * palette.length) % palette.length;
              p.fill(palette[Math.max(0, idx)]);
              p.rect(x, y, step, step);
            }
          }
          ctx.drawn = true;
        },
      },

      truchet: {
        label: 'Truchet Tiles',
        short: 'Сетка из квадратов со случайными дугами.',
        sensorReinit: true,
        sensors: { bass: 'thickness' },
        about: {
          intro: 'Классический мотив Себастьяна Трюше: квадратная сетка, в каждой ячейке — две дуги.',
          param: 'bass → толщина.',
          seed: 'Один seed — один конкретный узор.',
        },
        params: [
          { id: 'tileSize', label: 'Размер плитки', min: 16, max: 96, step: 2, default: 48, format: v => Math.round(v).toString() + 'px' },
          { id: 'thickness', label: 'Толщина', min: 0.04, max: 0.4, step: 0.01, default: 0.12, format: v => v.toFixed(2) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'duotone', options: ['duotone','mono','lava','ocean'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const tile = state.params.tileSize;
          ctx.tileSize = tile;
          ctx.cols = Math.ceil(p.width / tile) + 1;
          ctx.rows = Math.ceil(p.height / tile) + 1;
          ctx.palette = PALETTES[state.params.palette] || PALETTES.duotone;
          ctx.tiles = [];
          for (let y = 0; y < ctx.rows; y++) {
            for (let x = 0; x < ctx.cols; x++) {
              ctx.tiles.push({ x: x * tile, y: y * tile, orient: rng() < 0.5 ? 0 : 1 });
            }
          }
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = ctx.palette;
          const t = ctx.tileSize;
          const th = state.params.thickness * t;
          p.stroke(palette[0]);
          p.strokeWeight(th);
          p.strokeCap(p.ROUND);
          p.noFill();
          for (const tile of ctx.tiles) {
            if (tile.orient === 0) {
              p.arc(tile.x, tile.y, t, t, 0, Math.PI / 2);
              p.arc(tile.x + t, tile.y + t, t, t, Math.PI, Math.PI * 1.5);
            } else {
              p.arc(tile.x + t, tile.y, t, t, Math.PI / 2, Math.PI);
              p.arc(tile.x, tile.y + t, t, t, Math.PI * 1.5, Math.PI * 2);
            }
          }
          ctx.drawn = true;
        },
      },

      phyllotaxis: {
        label: 'Phyllotaxis',
        short: 'Спираль Фибоначчи из точек.',
        sensorReinit: true,
        sensors: { bass: 'angle', mid: 'dotSize', treble: 'scale', tiltX: 'angle' },
        about: {
          intro: 'Спираль Фибоначчи из точек.',
          param: 'bass → угол, mid → размер точки, treble → масштаб.',
          seed: 'От seed не зависит.',
        },
        params: [
          { id: 'angle', label: 'Угол', min: 130, max: 145, step: 0.1, default: 137.5, format: v => v.toFixed(1) + '°' },
          { id: 'scale', label: 'Масштаб', min: 0.5, max: 12, step: 0.1, default: 4.5, format: v => v.toFixed(1) },
          { id: 'dotSize', label: 'Точка', min: 1, max: 10, step: 0.5, default: 2.5, format: v => v.toFixed(1) + 'px' },
          { id: 'count', label: 'Кол-во', min: 200, max: 2500, step: 50, default: 1200, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'aurora', options: ['aurora','lava','ocean','forest','duotone'] },
        ],
        init(p, state, ctx) { ctx.drawn = false; },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.aurora;
          const angle = state.params.angle * Math.PI / 180;
          const scale = state.params.scale;
          const dotSize = state.params.dotSize;
          const n = Math.floor(state.params.count);
          p.noStroke();
          for (let i = 0; i < n; i++) {
            const r = scale * Math.sqrt(i);
            const a = i * angle;
            const x = p.width / 2 + r * Math.cos(a);
            const y = p.height / 2 + r * Math.sin(a);
            const col = p.color(palette[i % palette.length]);
            p.fill(col);
            p.circle(x, y, dotSize);
          }
          ctx.drawn = true;
        },
      },

      game_of_life: {
        label: 'Game of Life',
        short: 'Клеточный автомат Конвея.',
        sensorReinit: false,
        sensors: { bass: 'speed', mid: 'density', treble: 'trail', tiltX: 'trail' },
        about: {
          intro: 'Сетка клеток, каждая — живая или мёртвая.',
          param: 'bass → скорость, mid → плотность, treble → шлейф.',
          seed: 'Стартовая позиция случайна по seed.',
        },
        params: [
          { id: 'cellSize', label: 'Размер клетки', min: 4, max: 24, step: 1, default: 10, format: v => Math.round(v).toString() + 'px' },
          { id: 'density', label: 'Плотность', min: 0.05, max: 0.6, step: 0.01, default: 0.22, format: v => (v * 100).toFixed(0) + '%' },
          { id: 'speed', label: 'Скорость', min: 0, max: 20, step: 1, default: 4, format: v => v.toFixed(0) + (parseFloat(v) === 0 ? ' (пауза)' : '') },
          { id: 'trail', label: 'Шлейф', min: 0, max: 0.6, step: 0.02, default: 0.0, format: v => (v * 100).toFixed(0) + '%' },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'mono', options: ['mono','lava','ocean','forest','duotone'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const cs = state.params.cellSize;
          ctx.cellSize = cs;
          ctx.cols = Math.floor(p.width / cs);
          ctx.rows = Math.floor(p.height / cs);
          ctx.grid = new Uint8Array(ctx.cols * ctx.rows);
          for (let i = 0; i < ctx.grid.length; i++) ctx.grid[i] = rng() < state.params.density ? 1 : 0;
          ctx.next = new Uint8Array(ctx.cols * ctx.rows);
          ctx.palette = PALETTES[state.params.palette] || PALETTES.mono;
          ctx.tick = 0;
        },
        draw(p, state, ctx) {
          const speed = Math.floor(state.params.speed);
          for (let s = 0; s < speed; s++) stepLife(ctx);
          const trail = state.params.trail;
          p.noStroke();
          if (trail > 0) {
            p.fill(10, 10, 12, Math.floor(trail * 255));
            p.rect(0, 0, p.width, p.height);
          } else {
            p.background('#0a0a0c');
          }
          const cs = ctx.cellSize;
          const palette = ctx.palette;
          for (let y = 0; y < ctx.rows; y++) {
            for (let x = 0; x < ctx.cols; x++) {
              if (ctx.grid[y * ctx.cols + x]) {
                const col = p.color(palette[(x + y + ctx.tick) % palette.length]);
                p.fill(col);
                p.rect(x * cs, y * cs, cs - 1, cs - 1);
              }
            }
          }
          ctx.tick++;
        },
      },

      maze: {
        label: 'Maze',
        short: 'Лабиринт через recursive backtracker.',
        sensorReinit: true,
        sensors: { bass: 'cellSize', mid: 'thickness' },
        about: {
          intro: 'Recursive backtracker: копает коридор, натыкается на тупик, возвращается.',
          param: 'bass → размер клетки, mid → толщина.',
          seed: 'Случайные развилки определяются seed.',
        },
        params: [
          { id: 'cellSize', label: 'Размер клетки', min: 10, max: 40, step: 2, default: 18, format: v => Math.round(v).toString() + 'px' },
          { id: 'thickness', label: 'Толщина стен', min: 1, max: 4, step: 0.5, default: 1.5, format: v => v.toFixed(1) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'mono', options: ['mono','lava','ocean','forest','duotone'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const cs = state.params.cellSize;
          ctx.cellSize = cs;
          ctx.cols = Math.floor(p.width / cs);
          ctx.rows = Math.floor(p.height / cs);
          ctx.walls = [];
          for (let y = 0; y < ctx.rows; y++) {
            ctx.walls.push([]);
            for (let x = 0; x < ctx.cols; x++) {
              ctx.walls[y].push({ top: true, right: true, visited: false });
            }
          }
          const stack = [{ x: 0, y: 0 }];
          ctx.walls[0][0].visited = true;
          while (stack.length) {
            const cur = stack[stack.length - 1];
            const opts = [];
            if (cur.y > 0 && !ctx.walls[cur.y - 1][cur.x].visited) opts.push({ x: cur.x, y: cur.y - 1, dir: 'top' });
            if (cur.x < ctx.cols - 1 && !ctx.walls[cur.y][cur.x + 1].visited) opts.push({ x: cur.x + 1, y: cur.y, dir: 'right' });
            if (cur.y < ctx.rows - 1 && !ctx.walls[cur.y + 1][cur.x].visited) opts.push({ x: cur.x, y: cur.y + 1, dir: 'down' });
            if (cur.x > 0 && !ctx.walls[cur.y][cur.x - 1].visited) opts.push({ x: cur.x - 1, y: cur.y, dir: 'left' });
            if (!opts.length) { stack.pop(); continue; }
            const next = opts[Math.floor(rng() * opts.length)];
            ctx.walls[cur.y][cur.x][next.dir] = false;
            const opp = { top: 'down', right: 'left', down: 'top', left: 'right' }[next.dir];
            ctx.walls[next.y][next.x][opp] = false;
            ctx.walls[next.y][next.x].visited = true;
            stack.push(next);
          }
          ctx.palette = PALETTES[state.params.palette] || PALETTES.mono;
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const cs = ctx.cellSize;
          const th = state.params.thickness;
          p.stroke(ctx.palette[1] || '#fff');
          p.strokeWeight(th);
          p.strokeCap(p.SQUARE);
          for (let y = 0; y < ctx.rows; y++) {
            for (let x = 0; x < ctx.cols; x++) {
              const w = ctx.walls[y][x];
              const px = x * cs, py = y * cs;
              if (w.top) p.line(px, py, px + cs, py);
              if (w.right) p.line(px + cs, py, px + cs, py + cs);
              if (y === ctx.rows - 1) p.line(px, py + cs, px + cs, py + cs);
              if (x === 0) p.line(px, py, px, py + cs);
            }
          }
          ctx.drawn = true;
        },
      },

      spirograph: {
        label: 'Spirograph',
        short: 'Гипотрохоида — карандаш внутри катящегося круга.',
        sensorReinit: true,
        sensors: { bass: 'R', mid: 'r', treble: 'd', tiltX: 'r' },
        about: {
          intro: 'Маленький круг радиуса r катится внутри большого R.',
          param: 'bass → R, mid → r, treble → d.',
          seed: 'Стартовая фаза по seed.',
        },
        params: [
          { id: 'R', label: 'R (внешний)', min: 60, max: 300, step: 5, default: 200, format: v => Math.round(v).toString() },
          { id: 'r', label: 'r (внутр.)', min: 15, max: 180, step: 1, default: 60, format: v => Math.round(v).toString() },
          { id: 'd', label: 'd (карандаш)', min: 10, max: 180, step: 1, default: 80, format: v => Math.round(v).toString() },
          { id: 'turns', label: 'Обороты', min: 1, max: 25, step: 1, default: 12, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'duotone', options: ['duotone','lava','ocean','forest','aurora'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.phase = rng() * Math.PI * 2;
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.duotone;
          const R = state.params.R, r = state.params.r, d = state.params.d, turns = state.params.turns;
          const cx = p.width / 2, cy = p.height / 2;
          p.noFill();
          p.stroke(palette[0]);
          p.strokeWeight(1.2);
          p.beginShape();
          const steps = 1500;
          for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * turns * Math.PI * 2;
            const x = cx + (R - r) * Math.cos(t + ctx.phase) + d * Math.cos(((R - r) / r) * t + ctx.phase);
            const y = cy + (R - r) * Math.sin(t + ctx.phase) - d * Math.sin(((R - r) / r) * t + ctx.phase);
            p.vertex(x, y);
          }
          p.endShape();
          ctx.drawn = true;
        },
      },

      pythagoras: {
        label: 'Pythagoras Tree',
        short: 'Рекурсивные квадраты с прямоугольными треугольниками.',
        sensorReinit: true,
        sensors: { bass: 'depth', mid: 'angle', treble: 'size', tiltX: 'depth' },
        about: {
          intro: 'Классическое фрактальное дерево.',
          param: 'bass → глубина, mid → угол, treble → размер.',
          seed: 'Стартовое зерно.',
        },
        params: [
          { id: 'depth', label: 'Глубина', min: 3, max: 11, step: 1, default: 8, format: v => Math.round(v).toString() },
          { id: 'angle', label: 'Угол', min: 20, max: 70, step: 1, default: 45, format: v => Math.round(v).toString() + '°' },
          { id: 'size', label: 'Размер', min: 80, max: 300, step: 10, default: 180, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'forest', options: ['forest','lava','ocean','aurora','duotone'] },
        ],
        init(p, state, ctx) { ctx.drawn = false; },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.forest;
          const depth = Math.round(state.params.depth);
          const alpha = state.params.angle * Math.PI / 180;
          const baseSize = state.params.size;
          const cx = p.width / 2;
          const baseY = p.height - 20;
          const x1 = cx - baseSize / 2;
          const x2 = cx + baseSize / 2;
          p.noStroke();
          const drawSquare = (x1, y1, x2, y2, lvl) => {
            if (lvl <= 0) return;
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx*dx + dy*dy);
            const nx = -dy / len, ny = dx / len;
            const baseAngle = Math.atan2(dy, dx);
            const leftAngle = baseAngle - (Math.PI/2 - alpha);
            const rightAngle = baseAngle + (Math.PI/2 - alpha);
            const leftLen = len * Math.cos(Math.PI/2 - alpha);
            const rightLen = len * Math.cos(alpha);
            p.fill(palette[lvl % palette.length]);
            p.beginShape();
            p.vertex(x1, y1); p.vertex(x2, y2);
            p.vertex(x2 + nx * len, y2 + ny * len);
            p.vertex(x1 + nx * len, y1 + ny * len);
            p.endShape(p.CLOSE);
            const lx2 = x1 + leftLen * Math.cos(leftAngle);
            const ly2 = y1 + leftLen * Math.sin(leftAngle);
            const rx2 = x2 + rightLen * Math.cos(rightAngle);
            const ry2 = y2 + rightLen * Math.sin(rightAngle);
            drawSquare(x1, y1, lx2, ly2, lvl - 1);
            drawSquare(x2, y2, rx2, ry2, lvl - 1);
          };
          drawSquare(x1, baseY, x2, baseY, depth);
          ctx.drawn = true;
        },
      },

      barnsley: {
        label: 'Barnsley Fern',
        short: 'Папоротник Барнсли — классический IFS.',
        sensorReinit: true,
        sensors: { bass: 'points' },
        about: {
          intro: 'IFS из четырёх аффинных преобразований с разными вероятностями.',
          param: 'bass → кол-во точек.',
          seed: 'Стартовое зерно.',
        },
        params: [
          { id: 'points', label: 'Точки', min: 20000, max: 200000, step: 5000, default: 80000, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'forest', options: ['forest','mono','lava','ocean','duotone'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.drawn = false;
          ctx.points = [];
          let x = 0, y = 0;
          const N = Math.floor(state.params.points);
          for (let i = 0; i < N; i++) {
            const r = rng();
            let nx, ny;
            if (r < 0.85) { nx = 0.85*x + 0.04*y; ny = -0.04*x + 0.85*y + 1.6; }
            else if (r < 0.92) { nx = 0.2*x - 0.26*y; ny = 0.23*x + 0.22*y + 1.6; }
            else if (r < 0.99) { nx = -0.15*x + 0.28*y; ny = 0.26*x + 0.24*y + 0.44; }
            else { nx = 0; ny = 0.16*y; }
            x = nx; y = ny;
            ctx.points.push({ x, y });
          }
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const pt of ctx.points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
          ctx.minX = minX; ctx.maxX = maxX; ctx.minY = minY; ctx.maxY = maxY;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.forest;
          const rangeX = ctx.maxX - ctx.minX;
          const rangeY = ctx.maxY - ctx.minY;
          const scale = Math.min(p.width / rangeX, p.height / rangeY) * 0.85;
          const offsetX = (p.width - rangeX * scale) / 2 - ctx.minX * scale;
          const offsetY = p.height - 30;
          const c2d = p.drawingContext;
          c2d.fillStyle = palette[Math.floor(palette.length / 2)];
          for (let i = 0; i < ctx.points.length; i++) {
            const pt = ctx.points[i];
            const x = offsetX + pt.x * scale;
            const y = offsetY - pt.y * scale;
            c2d.fillRect(x, y, 1, 1);
          }
          ctx.drawn = true;
        },
      },

      lorenz: {
        label: 'Lorenz',
        short: 'Аттрактор Лоренца — знаменитая «бабочка».',
        sensorReinit: true,
        sensors: { bass: 'sigma', mid: 'rho', treble: 'beta', tiltX: 'sigma' },
        about: {
          intro: 'Система трёх дифференциальных уравнений, открытая Эдвардом Лоренцом в 1963 году.',
          param: 'bass → σ, mid → ρ, treble → β.',
          seed: 'Стартовая точка по seed.',
        },
        params: [
          { id: 'sigma', label: 'σ', min: 1, max: 30, step: 0.5, default: 10, format: v => v.toFixed(1) },
          { id: 'rho', label: 'ρ', min: 1, max: 60, step: 0.5, default: 28, format: v => v.toFixed(1) },
          { id: 'beta', label: 'β', min: 0.5, max: 8, step: 0.1, default: 2.667, format: v => v.toFixed(2) },
          { id: 'iterations', label: 'Итерации', min: 1000, max: 15000, step: 500, default: 6000, format: v => Math.round(v).toString() },
          { id: 'scale', label: 'Масштаб', min: 4, max: 25, step: 0.5, default: 14, format: v => v.toFixed(1) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'lava', options: ['lava','ocean','forest','aurora','mono'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const dt = 0.01, rho = state.params.rho, sigma = state.params.sigma, beta = state.params.beta;
          const N = Math.floor(state.params.iterations);
          let x = (rng() - 0.5) * 20, y = (rng() - 0.5) * 20, z = rng() * 30 + 10;
          ctx.points = [];
          for (let i = 0; i < N; i++) {
            const dx = sigma * (y - x);
            const dy = x * (rho - z) - y;
            const dz = x * y - beta * z;
            x += dx * dt; y += dy * dt; z += dz * dt;
            ctx.points.push({ x, y, z });
          }
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const pt of ctx.points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
          ctx.minX = minX; ctx.maxX = maxX; ctx.minY = minY; ctx.maxY = maxY;
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.lava;
          const cx = (ctx.minX + ctx.maxX) / 2;
          const cy = (ctx.minY + ctx.maxY) / 2;
          const range = Math.max(ctx.maxX - ctx.minX, ctx.maxY - ctx.minY);
          const factor = state.params.scale * Math.min(p.width, p.height) / range;
          p.noFill();
          p.strokeWeight(1);
          for (let i = 0; i < ctx.points.length - 1; i++) {
            const t1 = i / ctx.points.length;
            const col = p.color(palette[Math.floor(t1 * palette.length) % palette.length]);
            p.stroke(col);
            const x1 = p.width / 2 + (ctx.points[i].x - cx) * factor;
            const y1 = p.height / 2 + (ctx.points[i].y - cy) * factor;
            const x2 = p.width / 2 + (ctx.points[i + 1].x - cx) * factor;
            const y2 = p.height / 2 + (ctx.points[i + 1].y - cy) * factor;
            p.line(x1, y1, x2, y2);
          }
          ctx.drawn = true;
        },
      },

      clifford: {
        label: 'Clifford',
        short: 'Аттрактор Клиффорда — ещё одна 2D-система.',
        sensorReinit: true,
        sensors: { bass: 'a', mid: 'b', treble: 'c', tiltX: 'b' },
        about: {
          intro: 'Двухмерное отображение Клиффорда-Пиковера.',
          param: 'bass → a, mid → b, treble → c.',
          seed: 'Стартовая точка по seed.',
        },
        params: [
          { id: 'a', label: 'a', min: -3, max: 3, step: 0.05, default: 1.5, format: v => v.toFixed(2) },
          { id: 'b', label: 'b', min: -3, max: 3, step: 0.05, default: -1.8, format: v => v.toFixed(2) },
          { id: 'c', label: 'c', min: -3, max: 3, step: 0.05, default: 1.6, format: v => v.toFixed(2) },
          { id: 'd', label: 'd', min: -3, max: 3, step: 0.05, default: 0.9, format: v => v.toFixed(2) },
          { id: 'iterations', label: 'Итерации', min: 20000, max: 150000, step: 5000, default: 60000, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'lava', options: ['lava','ocean','forest','aurora','mono'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const a = state.params.a, b = state.params.b, c = state.params.c, d = state.params.d;
          const N = Math.floor(state.params.iterations);
          ctx.points = [];
          let x = (rng() - 0.5) * 2, y = (rng() - 0.5) * 2;
          for (let i = 0; i < N; i++) {
            const nx = Math.sin(a * y) + c * Math.cos(a * x);
            const ny = Math.sin(b * x) + d * Math.cos(b * y);
            x = nx; y = ny;
            ctx.points.push({ x, y });
          }
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const pt of ctx.points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
          ctx.minX = minX; ctx.maxX = maxX; ctx.minY = minY; ctx.maxY = maxY;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette];
          const range = Math.max(ctx.maxX - ctx.minX, ctx.maxY - ctx.minY);
          const scale = (p.width * 0.9) / range;
          const cx = (ctx.minX + ctx.maxX) / 2;
          const cy = (ctx.minY + ctx.maxY) / 2;
          const c2d = p.drawingContext;
          for (let i = 0; i < ctx.points.length; i++) {
            const pt = ctx.points[i];
            const x = p.width/2 + (pt.x - cx) * scale;
            const y = p.height/2 + (pt.y - cy) * scale;
            const t = i / ctx.points.length;
            c2d.fillStyle = palette[Math.floor(t * palette.length) % palette.length];
            c2d.fillRect(x, y, 1, 1);
          }
          ctx.drawn = true;
        },
      },

      boids: {
        label: 'Boids',
        short: 'Стая птиц по правилам Рейнольдса.',
        sensorReinit: false,
        sensors: { bass: 'separation', mid: 'alignment', treble: 'cohesion', tiltX: 'alignment' },
        about: {
          intro: 'Три правила Рейнольдса: разделение, выравнивание, сплочённость.',
          param: 'bass → разделение, mid → выравнивание, treble → сплочённость.',
          seed: 'Стартовые позиции по seed.',
        },
        params: [
          { id: 'count', label: 'Кол-во', min: 30, max: 400, step: 10, default: 150, format: v => Math.round(v).toString() },
          { id: 'separation', label: 'Разделение', min: 0, max: 3, step: 0.1, default: 1.5, format: v => v.toFixed(1) },
          { id: 'alignment', label: 'Выравнивание', min: 0, max: 3, step: 0.1, default: 1.0, format: v => v.toFixed(1) },
          { id: 'cohesion', label: 'Сплочённость', min: 0, max: 3, step: 0.1, default: 0.8, format: v => v.toFixed(1) },
          { id: 'speed', label: 'Скорость', min: 0.5, max: 5, step: 0.1, default: 2.0, format: v => v.toFixed(1) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'aurora', options: ['aurora','lava','ocean','forest','mono'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.boids = [];
          for (let i = 0; i < state.params.count; i++) {
            const angle = rng() * Math.PI * 2;
            ctx.boids.push({ x: rng() * p.width, y: rng() * p.height, vx: Math.cos(angle) * 2, vy: Math.sin(angle) * 2 });
          }
          ctx.palette = PALETTES[state.params.palette] || PALETTES.aurora;
        },
        draw(p, state, ctx) {
          p.noStroke();
          p.fill(10, 10, 12, 25);
          p.rect(0, 0, p.width, p.height);
          const sep = state.params.separation, ali = state.params.alignment, coh = state.params.cohesion, speed = state.params.speed;
          const R = 40, sepR = 15;
          for (const b of ctx.boids) {
            let cx = 0, cy = 0, cvx = 0, cvy = 0, count = 0;
            let sfx = 0, sfy = 0, sepCount = 0;
            for (const o of ctx.boids) {
              if (o === b) continue;
              const dx = o.x - b.x, dy = o.y - b.y;
              const d2 = dx*dx + dy*dy;
              if (d2 < R*R) {
                cx += o.x; cy += o.y;
                cvx += o.vx; cvy += o.vy;
                count++;
                if (d2 < sepR*sepR && d2 > 0.01) {
                  sfx -= dx / d2; sfy -= dy / d2; sepCount++;
                }
              }
            }
            if (count > 0) {
              cx /= count; cy /= count;
              cvx /= count; cvy /= count;
              b.vx += (cvx - b.vx) * 0.05 * ali;
              b.vy += (cvy - b.vy) * 0.05 * ali;
              b.vx += (cx - b.x) * 0.001 * coh;
              b.vy += (cy - b.y) * 0.001 * coh;
            }
            if (sepCount > 0) { b.vx += sfx * 0.5 * sep; b.vy += sfy * 0.5 * sep; }
            const sp = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
            if (sp > speed) { b.vx = b.vx/sp*speed; b.vy = b.vy/sp*speed; }
            b.x += b.vx; b.y += b.vy;
            if (b.x < 0) b.x += p.width; if (b.x > p.width) b.x -= p.width;
            if (b.y < 0) b.y += p.height; if (b.y > p.height) b.y -= p.height;
            const colIdx = Math.max(0, Math.min(ctx.palette.length - 1, Math.floor((sp / speed) * (ctx.palette.length - 1))));
            const col = p.color(ctx.palette[colIdx]);
            p.fill(col);
            p.circle(b.x, b.y, 2.5);
          }
        },
      },

      reaction_diffusion: {
        label: 'Reaction-Diffusion',
        short: 'Модель Грея-Скотта.',
        sensorReinit: false,
        sensors: { bass: 'feed', mid: 'kill', treble: 'steps', tiltX: 'kill' },
        about: {
          intro: 'Два реагента диффундируют и взаимодействуют.',
          param: 'bass → feed, mid → kill, treble → шаги.',
          seed: 'Стартовые «семена» по seed.',
        },
        params: [
          { id: 'feed', label: 'Feed', min: 0.01, max: 0.1, step: 0.001, default: 0.037, format: v => v.toFixed(3) },
          { id: 'kill', label: 'Kill', min: 0.04, max: 0.07, step: 0.001, default: 0.06, format: v => v.toFixed(3) },
          { id: 'steps', label: 'Шаги/кадр', min: 1, max: 25, step: 1, default: 6, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'lava', options: ['lava','ocean','forest','mono','duotone'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          const res = 100;
          ctx.res = res;
          ctx.cellSize = Math.floor(p.width / res);
          ctx.A = new Float32Array(res * res);
          ctx.B = new Float32Array(res * res);
          ctx.A2 = new Float32Array(res * res);
          ctx.B2 = new Float32Array(res * res);
          for (let i = 0; i < ctx.A.length; i++) ctx.A[i] = 1;
          for (let i = 0; i < 15; i++) {
            const cx = Math.floor(rng() * res);
            const cy = Math.floor(rng() * res);
            const r = 3 + rng() * 5;
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                if (dx*dx + dy*dy <= r*r) {
                  const x = (cx + dx + res) % res;
                  const y = (cy + dy + res) % res;
                  ctx.B[y * res + x] = 1;
                }
              }
            }
          }
          ctx.palette = PALETTES[state.params.palette] || PALETTES.lava;
        },
        draw(p, state, ctx) {
          const res = ctx.res, feed = state.params.feed, kill = state.params.kill, steps = Math.floor(state.params.steps);
          const DA = 1.0, DB = 0.5, dt = 1.0;
          const A = ctx.A, B = ctx.B, A2 = ctx.A2, B2 = ctx.B2;
          for (let s = 0; s < steps; s++) {
            for (let y = 0; y < res; y++) {
              for (let x = 0; x < res; x++) {
                const idx = y * res + x;
                const a = A[idx], b = B[idx];
                let lapA = -a, lapB = -b;
                lapA += A[((y-1+res)%res)*res+x] * 0.2;
                lapA += A[((y+1)%res)*res+x] * 0.2;
                lapA += A[y*res+(x-1+res)%res] * 0.2;
                lapA += A[y*res+(x+1)%res] * 0.2;
                lapA += A[((y-1+res)%res)*res+(x-1+res)%res] * 0.05;
                lapA += A[((y-1+res)%res)*res+(x+1)%res] * 0.05;
                lapA += A[((y+1)%res)*res+(x-1+res)%res] * 0.05;
                lapA += A[((y+1)%res)*res+(x+1)%res] * 0.05;
                lapB += B[((y-1+res)%res)*res+x] * 0.2;
                lapB += B[((y+1)%res)*res+x] * 0.2;
                lapB += B[y*res+(x-1+res)%res] * 0.2;
                lapB += B[y*res+(x+1)%res] * 0.2;
                lapB += B[((y-1+res)%res)*res+(x-1+res)%res] * 0.05;
                lapB += B[((y-1+res)%res)*res+(x+1)%res] * 0.05;
                lapB += B[((y+1)%res)*res+(x-1+res)%res] * 0.05;
                lapB += B[((y+1)%res)*res+(x+1)%res] * 0.05;
                const reaction = a * b * b;
                A2[idx] = a + (DA * lapA - reaction + feed * (1 - a)) * dt;
                B2[idx] = b + (DB * lapB + reaction - (kill + feed) * b) * dt;
              }
            }
            A.set(A2); B.set(B2);
          }
          const cs = ctx.cellSize;
          const palette = ctx.palette;
          const c2d = p.drawingContext;
          for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
              const v = Math.max(0, Math.min(1, B[y*res+x] * 2.5));
              const idx = Math.floor(v * (palette.length - 1));
              c2d.fillStyle = palette[idx];
              c2d.fillRect(x * cs, y * cs, cs, cs);
            }
          }
        },
      },

      mandelbrot: {
        label: 'Mandelbrot',
        short: 'Множество Мандельброта — попиксельный рендер.',
        sensorReinit: true,
        sensors: { bass: 'zoom', mid: 'centerX', treble: 'centerY' },
        about: {
          intro: 'Классический фрактал: для каждой точки итерируется z = z² + c.',
          param: 'bass → зум, mid → центр X, treble → центр Y.',
          seed: 'Стартовое зерно.',
        },
        params: [
          { id: 'centerX', label: 'Центр X', min: -2.5, max: 1, step: 0.01, default: -0.5, format: v => v.toFixed(2) },
          { id: 'centerY', label: 'Центр Y', min: -1.5, max: 1.5, step: 0.01, default: 0, format: v => v.toFixed(2) },
          { id: 'zoom', label: 'Зум', min: 0.5, max: 5, step: 0.05, default: 1, format: v => v.toFixed(2) },
          { id: 'iterations', label: 'Итерации', min: 30, max: 150, step: 5, default: 70, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'lava', options: ['lava','ocean','forest','aurora','mono'] },
        ],
        init(p, state, ctx) { ctx.drawn = false; },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          const c2d = p.drawingContext;
          const palette = PALETTES[state.params.palette] || PALETTES.lava;
          const maxIter = Math.floor(state.params.iterations);
          const w = p.width, h = p.height;
          const scale = 3 / w / state.params.zoom;
          const cx = state.params.centerX, cy = state.params.centerY;
          const step = 4;
          for (let py = 0; py < h; py += step) {
            for (let px = 0; px < w; px += step) {
              const x0 = (px - w/2) * scale + cx;
              const y0 = (py - h/2) * scale + cy;
              let x = 0, y = 0, x2s = 0, iter = 0;
              while (x2s + y*y < 4 && iter < maxIter) {
                const xn = x2s - y*y + x0;
                y = 2*x*y + y0;
                x = xn;
                x2s = x*x;
                iter++;
              }
              if (iter === maxIter) c2d.fillStyle = '#000000';
              else {
                const t = iter / maxIter;
                c2d.fillStyle = palette[Math.floor(t * (palette.length - 1))];
              }
              c2d.fillRect(px, py, step, step);
            }
          }
          ctx.drawn = true;
        },
      },

      julia: {
        label: 'Julia',
        short: 'Множество Жюлиа.',
        sensorReinit: true,
        sensors: { bass: 'zoom', mid: 'cX', treble: 'cY', tiltX: 'cX', tiltY: 'cY' },
        about: {
          intro: 'Та же итерация z = z² + c, но c фиксировано.',
          param: 'bass → зум, mid → cX, treble → cY.',
          seed: 'Стартовая позиция.',
        },
        params: [
          { id: 'cX', label: 'cX', min: -1.5, max: 1.5, step: 0.01, default: -0.7, format: v => v.toFixed(2) },
          { id: 'cY', label: 'cY', min: -1.5, max: 1.5, step: 0.01, default: 0.27, format: v => v.toFixed(2) },
          { id: 'zoom', label: 'Зум', min: 0.5, max: 5, step: 0.05, default: 1, format: v => v.toFixed(2) },
          { id: 'iterations', label: 'Итерации', min: 30, max: 150, step: 5, default: 70, format: v => Math.round(v).toString() },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'lava', options: ['lava','ocean','forest','aurora','mono'] },
        ],
        init(p, state, ctx) { ctx.drawn = false; },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          const c2d = p.drawingContext;
          const palette = PALETTES[state.params.palette] || PALETTES.lava;
          const maxIter = Math.floor(state.params.iterations);
          const w = p.width, h = p.height;
          const cx = state.params.cX, cy = state.params.cY;
          const scale = 3 / w / state.params.zoom;
          const step = 4;
          for (let py = 0; py < h; py += step) {
            for (let px = 0; px < w; px += step) {
              let x = (px - w/2) * scale;
              let y = (py - h/2) * scale;
              let iter = 0;
              while (x*x + y*y < 4 && iter < maxIter) {
                const xt = x*x - y*y + cx;
                y = 2*x*y + cy;
                x = xt;
                iter++;
              }
              if (iter === maxIter) c2d.fillStyle = '#000000';
              else {
                const t = iter / maxIter;
                c2d.fillStyle = palette[Math.floor(t * (palette.length - 1))];
              }
              c2d.fillRect(px, py, step, step);
            }
          }
          ctx.drawn = true;
        },
      },

      voronoi: {
        label: 'Voronoi',
        short: 'Диаграмма Вороного.',
        sensorReinit: true,
        sensors: { bass: 'points', mid: 'jitter' },
        about: {
          intro: 'N случайных точек разбивают плоскость на ячейки.',
          param: 'bass → кол-во точек, mid → случайность.',
          seed: 'Координаты по seed.',
        },
        params: [
          { id: 'points', label: 'Точек', min: 5, max: 60, step: 1, default: 18, format: v => Math.round(v).toString() },
          { id: 'jitter', label: 'Случайность', min: 0, max: 1, step: 0.05, default: 0.4, format: v => v.toFixed(2) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'forest', options: ['forest','lava','ocean','aurora','mono','duotone'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.sites = [];
          for (let i = 0; i < state.params.points; i++) {
            ctx.sites.push({ x: rng() * p.width, y: rng() * p.height, colorIdx: rng() });
          }
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.forest;
          const jitter = state.params.jitter;
          const c2d = p.drawingContext;
          const step = 6;
          for (let y = 0; y < p.height; y += step) {
            for (let x = 0; x < p.width; x += step) {
              let minD = Infinity, closestIdx = 0;
              for (let i = 0; i < ctx.sites.length; i++) {
                const pt = ctx.sites[i];
                const dx = x - pt.x, dy = y - pt.y;
                const d = dx*dx + dy*dy;
                if (d < minD) { minD = d; closestIdx = i; }
              }
              const cidx = Math.floor((ctx.sites[closestIdx].colorIdx + jitter * Math.random()) * palette.length);
              c2d.fillStyle = palette[cidx % palette.length];
              c2d.fillRect(x, y, step, step);
            }
          }
          p.noStroke();
          for (const pt of ctx.sites) {
            p.fill(palette[Math.floor(pt.colorIdx * palette.length) % palette.length]);
            p.circle(pt.x, pt.y, 4);
          }
          ctx.drawn = true;
        },
      },

      lsystem: {
        label: 'L-systems',
        short: 'Деревья и папоротники.',
        sensorReinit: true,
        sensors: { bass: 'iterations', mid: 'angle', treble: 'angle' },
        about: {
          intro: 'Алфавит + аксиома + правила = фрактальная структура.',
          param: 'bass → итерации, mid → угол, treble → угол.',
          seed: 'Стартовая фаза по seed.',
        },
        params: [
          { id: 'iterations', label: 'Итерации', min: 2, max: 6, step: 1, default: 4, format: v => Math.round(v).toString() },
          { id: 'angle', label: 'Угол', min: 10, max: 45, step: 1, default: 25, format: v => Math.round(v).toString() + '°' },
          { id: 'preset', label: 'Пресет', type: 'select', default: 'tree', options: ['tree','bush','fern','weed'] },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'forest', options: ['forest','lava','ocean','aurora','mono'] },
        ],
        init(p, state, ctx) {
          const presets = {
            tree:  { axiom: 'F', rules: { 'F': 'F[+F]F[-F]F' } },
            bush:  { axiom: 'F', rules: { 'F': 'FF+[+F-F-F]-[-F+F+F]' } },
            fern:  { axiom: 'X', rules: { 'X': 'F[+X]F[-X]+X', 'F': 'FF' } },
            weed:  { axiom: 'F', rules: { 'F': 'F[+FF][-FF]F[-F][+F]F' } },
          };
          const pr = presets[state.params.preset] || presets.tree;
          let str = pr.axiom;
          for (let i = 0; i < state.params.iterations; i++) {
            let next = '';
            for (const ch of str) next += pr.rules[ch] || ch;
            str = next;
          }
          ctx.commands = str;
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.forest;
          const angle = state.params.angle * Math.PI / 180;
          const stepLen = Math.max(2, Math.min(p.width, p.height) * 0.85 / Math.pow(3, state.params.iterations));
          let x = p.width / 2, y = p.height - 20, dir = -Math.PI / 2;
          const stack = [];
          let depth = 0;
          p.strokeCap(p.ROUND);
          for (const ch of ctx.commands) {
            if (ch === 'F') {
              const nx = x + Math.cos(dir) * stepLen;
              const ny = y + Math.sin(dir) * stepLen;
              p.stroke(palette[Math.min(palette.length - 1, Math.floor(depth / 2))]);
              p.strokeWeight(Math.max(1, 4 - depth * 0.5));
              p.line(x, y, nx, ny);
              x = nx; y = ny;
            } else if (ch === '+') { dir += angle; }
            else if (ch === '-') { dir -= angle; }
            else if (ch === '[') { stack.push({ x, y, dir, depth }); depth++; }
            else if (ch === ']') { const s = stack.pop(); x = s.x; y = s.y; dir = s.dir; depth = s.depth; }
          }
          ctx.drawn = true;
        },
      },

      penrose: {
        label: 'Penrose',
        short: 'Апериодическая мозаика.',
        sensorReinit: true,
        sensors: { bass: 'iterations', mid: 'scale', treble: 'rot' },
        about: {
          intro: 'Мозаика из тонких и толстых ромбов.',
          param: 'bass → итерации, mid → масштаб, treble → поворот.',
          seed: 'Стартовое зерно.',
        },
        params: [
          { id: 'iterations', label: 'Итерации', min: 2, max: 6, step: 1, default: 4, format: v => Math.round(v).toString() },
          { id: 'scale', label: 'Масштаб', min: 1, max: 5, step: 0.2, default: 2.5, format: v => v.toFixed(1) },
          { id: 'rot', label: 'Поворот', min: 0, max: 360, step: 5, default: 0, format: v => v.toFixed(0) + '°' },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'duotone', options: ['duotone','lava','ocean','forest','aurora'] },
        ],
        init(p, state, ctx) {
          const PHI = (1 + Math.sqrt(5)) / 2;
          const iters = Math.round(state.params.iterations);
          let triangles = [];
          for (let i = 0; i < 10; i++) {
            const a1 = i * Math.PI / 5, a2 = (i + 1) * Math.PI / 5;
            triangles.push({ type: 0, A: { x: 0, y: 0 }, B: { x: Math.cos(a1), y: Math.sin(a1) }, C: { x: Math.cos(a2), y: Math.sin(a2) } });
          }
          for (let it = 0; it < iters; it++) {
            const next = [];
            for (const t of triangles) {
              const A = t.A, B = t.B, C = t.C;
              if (t.type === 0) {
                const P = { x: A.x + (B.x - A.x) / PHI, y: A.y + (B.y - A.y) / PHI };
                const Q = { x: B.x + (C.x - B.x) / PHI, y: B.y + (C.y - B.y) / PHI };
                next.push({ type: 0, A: A, B: P, C: C });
                next.push({ type: 0, A: P, B: Q, C: C });
                next.push({ type: 1, A: P, B: B, C: Q });
              } else {
                const R = { x: C.x + (A.x - C.x) / PHI, y: C.y + (A.y - C.y) / PHI };
                next.push({ type: 0, A: R, B: B, C: C });
                next.push({ type: 1, A: R, B: B, C: A });
              }
            }
            triangles = next;
          }
          ctx.triangles = triangles;
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.duotone;
          const scale = state.params.scale * Math.min(p.width, p.height) / 2.2;
          const cx = p.width / 2, cy = p.height / 2;
          const rot = state.params.rot * Math.PI / 180;
          const cosR = Math.cos(rot), sinR = Math.sin(rot);
          const xf = (pt) => ({ x: cx + (pt.x * cosR - pt.y * sinR) * scale, y: cy + (pt.x * sinR + pt.y * cosR) * scale });
          p.noStroke();
          for (const t of ctx.triangles) {
            const A = xf(t.A), B = xf(t.B), C = xf(t.C);
            const col = (t.type === 0) ? (palette[1] || palette[0]) : palette[0];
            p.fill(col);
            p.beginShape();
            p.vertex(A.x, A.y); p.vertex(B.x, B.y); p.vertex(C.x, C.y);
            p.endShape(p.CLOSE);
          }
          ctx.drawn = true;
        },
      },

      lissajous: {
        label: 'Lissajous',
        short: 'Кривые Лиссажу.',
        sensorReinit: true,
        sensors: { bass: 'freqX', mid: 'freqY', treble: 'phase', tiltX: 'freqY' },
        about: {
          intro: 'X = sin(a·t + δ), Y = sin(b·t).',
          param: 'bass → freqX, mid → freqY, treble → фаза.',
          seed: 'Стартовая фаза по seed.',
        },
        params: [
          { id: 'freqX', label: 'Частота X', min: 1, max: 12, step: 1, default: 3, format: v => Math.round(v).toString() },
          { id: 'freqY', label: 'Частота Y', min: 1, max: 12, step: 1, default: 4, format: v => Math.round(v).toString() },
          { id: 'phase', label: 'Фаза', min: 0, max: Math.PI * 2, step: 0.1, default: Math.PI / 2, format: v => v.toFixed(2) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'duotone', options: ['duotone','lava','ocean','forest','aurora'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.phaseOffset = rng() * Math.PI * 2;
          ctx.drawn = false;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.duotone;
          const a = state.params.freqX, b = state.params.freqY;
          const phase = state.params.phase + ctx.phaseOffset;
          const cx = p.width / 2, cy = p.height / 2;
          const size = Math.min(p.width, p.height) * 0.42;
          p.noFill();
          p.stroke(palette[0]);
          p.strokeWeight(1.2);
          p.beginShape();
          const steps = 2000;
          for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            p.vertex(cx + size * Math.sin(a * t), cy + size * Math.sin(b * t + phase));
          }
          p.endShape();
          ctx.drawn = true;
        },
      },

      dla: {
        label: 'DLA',
        short: 'Диффузионно-ограниченная агрегация.',
        sensorReinit: true,
        sensors: { bass: 'particles', mid: 'stickiness' },
        about: {
          intro: 'Частицы блуждают случайно, прилипают к кластеру.',
          param: 'bass → частицы, mid → прилипание.',
          seed: 'Стартовое зерно.',
        },
        params: [
          { id: 'particles', label: 'Частиц', min: 100, max: 2000, step: 100, default: 600, format: v => Math.round(v).toString() },
          { id: 'stickiness', label: 'Прилипание', min: 0.3, max: 1, step: 0.05, default: 0.85, format: v => v.toFixed(2) },
          { id: 'palette', label: 'Палитра', type: 'select', default: 'lava', options: ['lava','ocean','forest','aurora','mono'] },
        ],
        init(p, state, ctx) {
          const rng = mulberry32(hashStringToInt(state.seed));
          ctx.drawn = false;
          const cx = Math.floor(p.width / 2), cy = Math.floor(p.height / 2);
          ctx.grid = new Uint8Array(p.width * p.height);
          ctx.grid[cy * p.width + cx] = 1;
          ctx.cx = cx; ctx.cy = cy;
          ctx.rng = rng;
          ctx.maxRadius = Math.min(p.width, p.height) * 0.45;
          ctx.placed = 0;
        },
        draw(p, state, ctx) {
          if (ctx.drawn) return;
          p.background('#0a0a0c');
          const palette = PALETTES[state.params.palette] || PALETTES.lava;
          const stickiness = state.params.stickiness;
          const target = Math.floor(state.params.particles);
          const w = p.width, h = p.height;
          const grid = ctx.grid, cx = ctx.cx, cy = ctx.cy, maxR = ctx.maxRadius, rng = ctx.rng;
          let added = 0;
          while (ctx.placed < target && added < 30) {
            const angle = rng() * Math.PI * 2;
            const r = maxR + rng() * 30;
            let x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
            let steps = 0;
            const maxSteps = 5000;
            while (steps < maxSteps) {
              const xi = Math.floor(x), yi = Math.floor(y);
              if (xi < 0 || xi >= w || yi < 0 || yi >= h) break;
              let touching = false;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const nx = xi + dx, ny = yi + dy;
                  if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny * w + nx]) { touching = true; break; }
                }
                if (touching) break;
              }
              if (touching) {
                if (rng() < stickiness) { grid[yi * w + xi] = 1; ctx.placed++; added++; }
                break;
              }
              const dir = rng();
              if (dir < 0.25) x++; else if (dir < 0.5) x--; else if (dir < 0.75) y++; else x--;
              steps++;
              const dxC = x - cx, dyC = y - cy;
              if (dxC*dxC + dyC*dyC > maxR * maxR * 1.5) break;
            }
          }
          p.noStroke();
          for (let i = 0; i < grid.length; i++) {
            if (grid[i]) {
              const px = i % w, py = Math.floor(i / w);
              const d = Math.sqrt((px-cx)*(px-cx) + (py-cy)*(py-cy));
              const t = d / maxR;
              p.fill(palette[Math.min(palette.length - 1, Math.floor(t * palette.length))]);
              p.rect(px, py, 1, 1);
            }
          }
          if (ctx.placed >= target) ctx.drawn = true;
        },
      },
    };

    /* ============================================================
       SHARED HELPERS для страниц
       ============================================================ */
    function cloneDefaults(algo) {
      const out = {};
      for (const p of algo.params) out[p.id] = p.default;
      return out;
    }

    function randomSeed() {
      return Math.random().toString(36).slice(2, 8).toUpperCase();
    }

    /* Автономный генеративный модуль: свой p5-инстанс + своё состояние.
       Используется на странице урока. */
    function createModuleSketch(st) {
      return (p) => {
        st.p = p;
        let ctx = {};
        p.setup = () => {
          const holder = st.holder;
          const cnv = p.createCanvas(10, 10);
          cnv.parent(holder);
          p.background('#0a0a0c');
          const fit = () => {
            const s = Math.floor(Math.min(holder.clientWidth, holder.clientHeight));
            if (s > 0 && s !== p.width) {
              p.resizeCanvas(s, s);
              p.background('#0a0a0c');
              reset();
            }
          };
          let fitted = false, attempts = 0;
          const waitForSize = () => {
            const s = Math.min(holder.clientWidth, holder.clientHeight);
            if (s > 0) {
              fit();
              if (!fitted) {
                fitted = true;
                if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(holder);
                else window.addEventListener('resize', fit);
              }
              return;
            }
            if (++attempts < 300) requestAnimationFrame(waitForSize);
          };
          waitForSize();
        };
        let ready = false;
        function reset() {
          ctx = {};
          // Чистый холст + детерминированный шум: один и тот же seed должен
          // давать в точности ту же работу, даже после перезагрузки страницы.
          // (p5 иначе инициализирует шум Перлина через Math.random.)
          p.background(10, 10, 12);
          const si = hashStringToInt(st.state.seed);
          p.noiseSeed(si);
          p.randomSeed(si);
          ALGORITHMS[st.state.algorithm].init(p, st.state, ctx);
          ready = true;
        }
        st.reset = reset;
        st.snapshot = () => p.canvas.toDataURL('image/png');
        p.draw = () => {
          if (!ready) return;
          if (st.modulate) st.modulate();
          const algo = ALGORITHMS[st.state.algorithm];
          const spMod = applyModuleSpectrum(st, p, ctx);
          if (spMod && algo.sensorReinit) algo.init(p, st.state, ctx);
          algo.draw(p, st.state, ctx);
        };
      };
    }

    /* Спектр порядка: чистое правило → чистый хаос (модульная версия). */
    function applyModuleSpectrum(st, p, ctx) {
      const state = st.state;
      if (!state.spectrum || state.spectrum < 0.01) return false;
      const algo = ALGORITHMS[state.algorithm];
      if (!algo.continuous) {
        if (Math.random() < state.spectrum * 0.4) {
          algo.init(p, state, ctx);
          return true;
        }
      }
      const numericParams = algo.params.filter(x => x.type !== 'select');
      if (numericParams.length === 0) return false;
      const param = numericParams[Math.floor(Math.random() * numericParams.length)];
      const range = param.max - param.min;
      const current = state.params[param.id];
      const jitter = (Math.random() - 0.5) * range * state.spectrum * 0.6;
      state.params[param.id] = Math.max(param.min, Math.min(param.max, current + jitter));
      return true;
    }

    /* Монтирует модуль в holder. Возвращает { state, reset, remove }. */
    function mountModule(holder, algoId, preset, seed) {
      const algo = ALGORITHMS[algoId];
      const state = {
        algorithm: algoId,
        seed: seed || randomSeed(),
        params: cloneDefaults(algo),
        sensors: { mic: false, tilt: false },
        spectrum: 0,
      };
      for (const [k, v] of Object.entries(preset || {})) {
        if (state.params[k] !== undefined) state.params[k] = v;
      }
      const st = { holder, state, reset: null };
      setupModuleModulation(st);
      const inst = new p5(createModuleSketch(st));
      return {
        state,
        _st: st,
        reset: () => { if (st.reset) st.reset(); },
        snapshot: () => (st.snapshot ? st.snapshot() : null),
        remove: () => { disableModuleSensors(st); inst.remove(); },
      };
    }

    /* Универсальный конструктор контролов параметров (без датчиков). */
    function buildModuleControls(wrap, state, onChange, hideParams) {
      const algo = ALGORITHMS[state.algorithm];
      const hidden = new Set(hideParams || []);
      wrap.innerHTML = '';
      for (const param of algo.params) {
        if (hidden.has(param.id)) continue;
        const row = document.createElement('div');
        row.className = 'param';
        const val = state.params[param.id];
        if (param.type === 'select') {
          row.innerHTML = `<label>${param.label}</label>`;
          const sel = document.createElement('select');
          for (const opt of param.options) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            if (opt === val) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener('change', (e) => {
            state.params[param.id] = e.target.value;
            onChange();
          });
          row.appendChild(sel);
        } else {
          const disp = document.createElement('span');
          disp.textContent = param.format(val);
          const lab = document.createElement('label');
          lab.textContent = param.label + ' ';
          lab.appendChild(disp);
          row.appendChild(lab);
          const input = document.createElement('input');
          input.type = 'range';
          input.min = param.min; input.max = param.max; input.step = param.step;
          input.value = val;
          input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            state.params[param.id] = v;
            disp.textContent = param.format(v);
            onChange();
          });
          row.appendChild(input);
        }
        wrap.appendChild(row);
      }
    }


    /* ============================================================
       MODULE SENSORS — микрофон и наклон для модуля урока
       ============================================================ */
    function setupModuleModulation(st) {
      st.mic = null; // { ctx, an, buf, stream }
      st.tiltBuffer = [];
      st.bars = null; // { bass, mid, treble, dot } — DOM-элементы, опционально
      st.eqCanvas = null; // <canvas> для тонкой линии-эквалайзера, опционально
      st.onMotion = (e) => {
        const ax = e.accelerationIncludingGravity ? e.accelerationIncludingGravity.x : 0;
        const ay = e.accelerationIncludingGravity ? e.accelerationIncludingGravity.y : 0;
        st.tiltBuffer.push({ x: ax, y: ay });
        if (st.tiltBuffer.length > 12) st.tiltBuffer.shift();
        const avgX = st.tiltBuffer.reduce((a, v) => a + v.x, 0) / st.tiltBuffer.length;
        const avgY = st.tiltBuffer.reduce((a, v) => a + v.y, 0) / st.tiltBuffer.length;
        st.state.tiltX = Math.max(-1, Math.min(1, avgX / 10));
        st.state.tiltY = Math.max(-1, Math.min(1, avgY / 10));
      };
      st.modulate = () => {
        const s = st.state;
        if (!s.sensors.mic && !s.sensors.tilt) return;
        const algo = ALGORITHMS[s.algorithm];
        if (!algo.sensors) return;
        if (s.sensors.mic && st.mic) {
          const an = st.mic.an, buf = st.mic.buf;
          an.getByteFrequencyData(buf);
          const sampleRate = st.mic.ctx ? st.mic.ctx.sampleRate : 44100;
          const binWidth = sampleRate / an.fftSize;
          const bassEnd = Math.floor(250 / binWidth);
          const midEnd = Math.floor(2000 / binWidth);
          let bassSum = 0, midSum = 0, trebleSum = 0;
          for (let i = 1; i < bassEnd; i++) bassSum += buf[i];
          for (let i = bassEnd; i < midEnd; i++) midSum += buf[i];
          for (let i = midEnd; i < buf.length; i++) trebleSum += buf[i];
          s.micBass = Math.min(1, (bassSum / Math.max(1, bassEnd - 1)) / 255 * 3);
          s.micMid = Math.min(1, (midSum / Math.max(1, midEnd - bassEnd)) / 255 * 2);
          s.micTreble = Math.min(1, (trebleSum / Math.max(1, buf.length - midEnd)) / 255 * 4);
          // Тонкая стохастическая линия-эквалайзер: лог-полосы по пикам
          if (st.eqCanvas) {
            const c = st.eqCanvas;
            const dpr = window.devicePixelRatio || 1;
            const w = c.clientWidth, h = c.clientHeight;
            if (w > 0 && h > 0) {
              if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
              const c2 = c.getContext('2d');
              c2.setTransform(dpr, 0, 0, dpr, 0, 0);
              c2.clearRect(0, 0, w, h);
              const N = 64, bins = buf.length;
              c2.beginPath();
              for (let bi = 0; bi < N; bi++) {
                const lo = Math.max(1, Math.floor(Math.pow(bins, bi / N)));
                const hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (bi + 1) / N)));
                let mx = 0;
                for (let j = lo; j < hi; j++) { if (buf[j] > mx) mx = buf[j]; }
                const v = Math.min(1, (mx / 255) * 1.3);
                const x = (bi / (N - 1)) * w;
                const y = h - 2 - v * (h - 4);
                if (bi === 0) c2.moveTo(x, y); else c2.lineTo(x, y);
              }
              c2.strokeStyle = 'rgba(121, 160, 255, 0.85)';
              c2.lineWidth = 1.5;
              c2.lineJoin = 'round';
              c2.stroke();
            }
          }
        }
        let modified = false;
        if (s.sensors.mic) {
          const bands = { bass: s.micBass, mid: s.micMid, treble: s.micTreble };
          for (const band of ['bass', 'mid', 'treble']) {
            const pid = algo.sensors[band];
            if (!pid) continue;
            const param = algo.params.find(x => x.id === pid);
            if (param) {
              s.params[pid] = param.min + bands[band] * (param.max - param.min);
              modified = true;
            }
          }
        }
        if (s.sensors.tilt) {
          for (const axis of ['tiltX', 'tiltY']) {
            const pid = algo.sensors[axis];
            if (!pid) continue;
            const param = algo.params.find(x => x.id === pid);
            if (param) {
              s.params[pid] = param.min + ((s[axis] + 1) / 2) * (param.max - param.min);
              modified = true;
            }
          }
        }
        if (modified && algo.sensorReinit && st.reset) st.reset();
        if (st.bars) {
          if (st.bars.bass) st.bars.bass.style.width = ((s.micBass || 0) * 100).toFixed(1) + '%';
          if (st.bars.mid) st.bars.mid.style.width = ((s.micMid || 0) * 100).toFixed(1) + '%';
          if (st.bars.treble) st.bars.treble.style.width = ((s.micTreble || 0) * 100).toFixed(1) + '%';
          if (st.bars.dot) st.bars.dot.style.transform =
            'translate(calc(-50% + ' + (s.tiltX * 22) + 'px), calc(-50% + ' + (s.tiltY * 22) + 'px))';
        }
      };
    }

    async function enableModuleMic(st, onOk, onErr) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        // На iOS/Safari контекст может стартовать suspended даже после жеста
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0.6;
        source.connect(an);
        st.mic = { ctx, an, buf: new Uint8Array(an.frequencyBinCount), stream };
        st.state.sensors.mic = true;
        if (onOk) onOk();
      } catch (err) {
        if (onErr) onErr(err);
      }
    }

    function disableModuleMic(st) {
      if (st.mic) {
        st.mic.stream.getTracks().forEach(t => t.stop());
        st.mic.ctx.close().catch(() => {});
        st.mic = null;
      }
      st.state.sensors.mic = false;
      st.state.micBass = 0; st.state.micMid = 0; st.state.micTreble = 0;
      if (st.bars) ['bass', 'mid', 'treble'].forEach(k => { if (st.bars[k]) st.bars[k].style.width = '0%'; });
      if (st.eqCanvas) {
        const c2 = st.eqCanvas.getContext('2d');
        c2.clearRect(0, 0, st.eqCanvas.width, st.eqCanvas.height);
      }
    }

    async function enableModuleTilt(st, onOk, onErr) {
      if (typeof DeviceMotionEvent === 'undefined') { if (onErr) onErr(); return; }
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          const result = await DeviceMotionEvent.requestPermission();
          if (result !== 'granted') { if (onErr) onErr(); return; }
        } catch { if (onErr) onErr(); return; }
      }
      window.addEventListener('devicemotion', st.onMotion);
      st.state.sensors.tilt = true;
      if (onOk) onOk();
    }

    function disableModuleTilt(st) {
      window.removeEventListener('devicemotion', st.onMotion);
      st.state.sensors.tilt = false;
      st.state.tiltX = 0; st.state.tiltY = 0;
      st.tiltBuffer = [];
      if (st.bars && st.bars.dot) st.bars.dot.style.transform = 'translate(-50%, -50%)';
    }

    function disableModuleSensors(st) {
      disableModuleMic(st);
      disableModuleTilt(st);
    }

    /* ============================================================
       GALLERY STORAGE — общая коллекция (лаборатория + уроки)
       ============================================================ */
    const STORAGE_KEY = 'cifra-gallery-v6';
    function loadGallery() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
    function saveGallery(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
