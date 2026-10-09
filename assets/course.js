/* ============================================================
   COURSE PAGE — список уроков + страница урока с живым модулем
   ============================================================ */
const $ = (id) => document.getElementById(id);
let moduleApi = null;

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function renderGrid() {
  const grid = $('courseGrid');
  grid.innerHTML = '';
  COURSE.forEach((lesson, idx) => {
    const card = document.createElement('div');
    card.className = 'course-card';
    card.innerHTML = `
      <div class="num">УРОК ${lesson.num}</div>
      <h4>${lesson.title}</h4>
      <p class="summary">${lesson.summary}</p>
      <div class="tags">${lesson.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
    `;
    card.addEventListener('click', () => { location.hash = '#/' + idx; });
    grid.appendChild(card);
  });
}

function labUrl(st) {
  const url = new URL('lab.html', location.href);
  url.searchParams.set('algo', st.state.algorithm);
  url.searchParams.set('seed', st.state.seed);
  for (const p of ALGORITHMS[st.state.algorithm].params) {
    if (p.type === 'select') continue;
    url.searchParams.set(p.id, String(st.state.params[p.id]));
  }
  return url.toString();
}

function destroyModule() {
  if (moduleApi) { moduleApi.remove(); moduleApi = null; }
}

/* Модуль урока — карточки без канвы: текст + (микрофон с линией в уроке 01) + «Открыть в Лабе» */
function moduleControlsHtml(lesson) {
  const openLab = lesson.moduleOpenLab === false
    ? ''
    : '<a class="btn btn-ghost" id="lmOpenLab" href="#">Открыть в Лабе ↗</a>';
  const actions = openLab ? `<div class="lm-actions">${openLab}</div>` : '';
  const note = lesson.moduleNote ? `<p class="lm-note">${lesson.moduleNote}</p>` : '';
  if (lesson.moduleMode === 'sensors') {
    const micRow = `
      <div class="mic-switch" id="lmMicSwitch">
        <button id="lmMic" class="mic-pill" aria-pressed="false">
          <span class="icon">🎤</span>
          <span>Включить микрофон</span>
        </button>
        <div class="mic-blow" aria-hidden="true">
          <svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="20" cy="30" r="13"/>
            <path d="M31 27 l7 3 -7 3"/>
            <path class="blow-line bl1" d="M44 22 q11 -2 22 1"/>
            <path class="blow-line bl2" d="M44 30 q12 0 24 0"/>
            <path class="blow-line bl3" d="M44 38 q11 2 22 -1"/>
            <rect x="74" y="10" width="14" height="42" rx="3"/>
            <line x1="78" y1="46" x2="84" y2="46"/>
          </svg>
          <span class="mic-blow-caption">подуйте<br />в микрофон</span>
        </div>
        <div class="mic-eq" id="lmMicEq">
          <canvas class="eq-line" id="lmEqCanvas"></canvas>
        </div>
      </div>
      <p class="sensor-hint">бас слева · верхи справа — линия рисует ваш звук</p>`;
    return `${note}${micRow}${actions}`;
  }
  return `${note}${actions}`;
}

/* Автономный микрофон с линией-эквалайзером (без канвы): pill → getUserMedia → тонкая линия */
function wireMicCard() {
  const micSwitch = $('lmMicSwitch');
  const micBtn = $('lmMic');
  const canvas = $('lmEqCanvas');
  if (!micBtn || !canvas) return;
  let mic = null, raf = 0;

  const setUi = (on) => {
    if (micSwitch) micSwitch.classList.toggle('on', on);
    micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  const stop = () => {
    if (mic) {
      mic.stream.getTracks().forEach(t => t.stop());
      mic.ctx.close().catch(() => {});
      mic = null;
    }
    cancelAnimationFrame(raf);
    const c2 = canvas.getContext('2d');
    c2.clearRect(0, 0, canvas.width, canvas.height);
    setUi(false);
  };

  const loop = () => {
    if (!mic) return;
    mic.an.getByteFrequencyData(mic.buf);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 0 && h > 0) {
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const c2 = canvas.getContext('2d');
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.clearRect(0, 0, w, h);
      const N = 64, bins = mic.buf.length;
      c2.beginPath();
      for (let bi = 0; bi < N; bi++) {
        const lo = Math.max(1, Math.floor(Math.pow(bins, bi / N)));
        const hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (bi + 1) / N)));
        let mx = 0;
        for (let j = lo; j < hi; j++) { if (mic.buf[j] > mx) mx = mic.buf[j]; }
        const v = Math.min(1, (mx / 255) * 1.3);
        const x = (bi / (N - 1)) * w;
        const y = h - 2 - v * (h - 4);
        if (bi === 0) c2.moveTo(x, y); else c2.lineTo(x, y);
      }
      c2.strokeStyle = 'rgba(121, 160, 255, 0.85)';
      c2.lineWidth = 1.5; c2.lineJoin = 'round'; c2.stroke();
    }
    raf = requestAnimationFrame(loop);
  };

  micBtn.addEventListener('click', async () => {
    if (mic) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.6;
      source.connect(an);
      mic = { ctx, an, stream, buf: new Uint8Array(an.frequencyBinCount) };
      setUi(true);
      showToast('Микрофон включён — подуйте!');
      loop();
    } catch (err) {
      showToast('Нет доступа к микрофону');
    }
  });

  // вызывается при смене урока
  return stop;
}
function showLesson(idx) {
  const lesson = COURSE[idx];
  if (!lesson) { location.hash = '#/'; return; }
  const algo = ALGORITHMS[lesson.algo];
  $('courseListView').style.display = 'none';
  const view = $('lessonView');
  view.style.display = 'block';

  const prevBtn = idx === 0
    ? '<span class="btn btn-ghost" style="opacity:.4;pointer-events:none">← Назад</span>'
    : `<a class="btn btn-ghost" href="#/${idx - 1}">← Урок ${COURSE[idx - 1].num}</a>`;
  const nextBtn = idx === COURSE.length - 1
    ? '<span class="btn btn-ghost" style="opacity:.4;pointer-events:none">Далее →</span>'
    : `<a class="btn btn-ghost" href="#/${idx + 1}">Урок ${COURSE[idx + 1].num} →</a>`;

  view.innerHTML = `
    <a class="back-link" href="#/">← Все уроки</a>
    <div class="lesson-content lesson-page">
      <div class="lesson-num">УРОК ${lesson.num} из ${String(COURSE.length).padStart(2, '0')}</div>
      <h2>${lesson.title}</h2>
      <p class="lesson-summary">${lesson.summary}</p>
      <div class="lesson-body">${lesson.body}</div>

      <div class="lesson-module">
        <div class="lm-head">
          <h4>${lesson.moduleTitle || 'Попробуйте сами'}</h4>
          <span class="lm-meta">${algo.label} · seed <span id="lmSeed">—</span></span>
        </div>
        ${moduleControlsHtml(lesson)}
      </div>

      <div class="exercise">
        <h5>Задание</h5>
        <p>${lesson.exercise}</p>
      </div>

      <div class="lesson-actions">
        <div class="nav-buttons">${prevBtn}${nextBtn}</div>
        ${lesson.extLink ? `<a class="btn btn-ghost lesson-extlink" href="${lesson.extLink.url}" target="_blank" rel="noopener">${lesson.extLink.label} ↗</a>` : ''}
      </div>
    </div>
  `;
  window.scrollTo({ top: 0 });

  // Карточный модуль: статическое состояние (seed + пресет), канвы нет.
  // Вся интерактивность — по кнопке «Открыть в Лабе».
  const startSeed = 'LESSON-' + lesson.num;
  const params = cloneDefaults(algo);
  for (const [k, v] of Object.entries(lesson.preset || {})) {
    if (params[k] !== undefined) params[k] = v;
  }
  moduleApi = {
    state: {
      algorithm: lesson.algo,
      seed: startSeed,
      params,
      sensors: { mic: false, tilt: false },
      spectrum: 0,
    },
    reset() {},
    snapshot() { return null; },
    remove() {},
  };
  window.__lessonModule = moduleApi; // отладочный доступ, как window.__generator в Лабе
  const seedEl = $('lmSeed');
  seedEl.textContent = moduleApi.state.seed;

  const syncLabLink = () => { const a = $('lmOpenLab'); if (a) a.href = labUrl(moduleApi); };
  syncLabLink();

  if (lesson.moduleMode === 'sensors') {
    const stopMic = wireMicCard();
    const baseRemove = moduleApi.remove;
    moduleApi.remove = () => { stopMic(); baseRemove(); };
  }
}

function showList() {
  destroyModule();
  $('lessonView').style.display = 'none';
  $('courseListView').style.display = 'block';
}

function route() {
  const m = location.hash.match(/^#\/(\d+)$/);
  destroyModule();
  if (m) showLesson(parseInt(m[1], 10));
  else showList();
}

renderGrid();
window.addEventListener('hashchange', route);
route();
