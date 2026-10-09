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

/* Панель управления модуля: датчики (урок 01) или ползунки (остальные) */
function moduleControlsHtml(lesson) {
  if (lesson.moduleMode === 'sensors') {
    const sensors = lesson.moduleSensors || ['mic', 'tilt'];
    const micRow = sensors.includes('mic') ? `
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
      </div>` : '';
    const tiltRow = sensors.includes('tilt') ? `
      <div class="sensor-row">
        <button id="lmTilt" class="sensor-btn">
          <span class="icon">📱</span>
          <span>Наклон</span>
          <span class="state">off</span>
        </button>
        <div class="tilt-pad"><div class="tilt-dot" id="lmTiltDot"></div></div>
      </div>` : '';
    const hints = [];
    if (sensors.includes('mic')) hints.push('bass → сложность · mid → мутация · treble → плотность');
    if (sensors.includes('tilt')) hints.push('наклон → сложность');
    const regenBtn = lesson.moduleRegen === false
      ? ''
      : '<button class="btn btn-primary" id="lmRegen">🎲 Пересоздать</button>';
    const saveBtn = lesson.moduleSave === false
      ? ''
      : '<button class="btn btn-ghost" id="lmSave">＋ Сохранить</button>';
    const openLab = lesson.moduleOpenLab === false
      ? ''
      : '<a class="btn btn-ghost" id="lmOpenLab" href="#">Открыть в Лабе ↗</a>';
    return `
      <p class="lm-note">${lesson.moduleNote}</p>
      ${micRow}
      ${tiltRow}
      <p class="sensor-hint">${hints.join(' · ')}</p>
      <div class="lm-actions">
        ${regenBtn}
        ${saveBtn}
        ${openLab}
      </div>
    `;
  }
  if (lesson.moduleMode === 'seed') {
    const saveBtn = lesson.moduleSave === false
      ? ''
      : '<button class="btn btn-ghost" id="lmSave">＋ Сохранить</button>';
    const openLab = lesson.moduleOpenLab === false
      ? ''
      : '<a class="btn btn-ghost" id="lmOpenLab" href="#">Открыть в Лабе ↗</a>';
    const extraActions = (saveBtn || openLab)
      ? `<div class="lm-actions">${saveBtn}${openLab}</div>`
      : '';
    return `
      <p class="lm-note">${lesson.moduleNote}</p>
      <div class="lm-actions">
        <button class="btn btn-ghost" id="lmRegen">🎲 Случайный seed</button>
      </div>
      <div class="seed-row">
        <input id="lmSeedInput" class="seed-input" type="text" maxlength="32"
               placeholder="Ваш seed: слово, имя, дата…" autocomplete="off" spellcheck="false" />
        <button class="btn btn-primary" id="lmApplySeed">Применить</button>
      </div>
      <p class="sensor-hint">Один и тот же seed — одна и та же работа. Измените хоть символ — и мир станет другим.</p>
      ${extraActions}
    `;
  }
  const defRegen = lesson.moduleRegen === false
    ? ''
    : '<button class="btn btn-primary" id="lmRegen">🎲 Пересоздать</button>';
  const defOpenLab = lesson.moduleOpenLab === false
    ? ''
    : '<a class="btn btn-ghost" id="lmOpenLab" href="#">Открыть в Лабе ↗</a>';
  const defActions = (defRegen || defOpenLab)
    ? `<div class="lm-actions">${defRegen}${defOpenLab}</div>`
    : '';
  return `
    <div id="lmControls"></div>
    ${defActions}
  `;
}

function saveModuleToGallery() {
  const thumb = moduleApi.snapshot();
  if (!thumb) return;
  const items = loadGallery();
  items.unshift({
    seed: moduleApi.state.seed,
    algorithm: moduleApi.state.algorithm,
    config: { ...moduleApi.state.params },
    spectrum: 0,
    ts: Date.now(),
    thumb,
  });
  saveGallery(items.slice(0, 24));
  showToast('Сохранено в коллекцию (см. Лабораторию)');
}

function wireSeedControls(lesson, syncLabLink) {
  const input = $('lmSeedInput');
  input.value = moduleApi.state.seed;

  const apply = () => {
    const v = input.value.trim().replace(/\s+/g, '-');
    if (!v) {
      showToast('Введите seed — любые буквы и цифры');
      input.focus();
      return;
    }
    input.value = v;
    moduleApi.state.seed = v;
    $('lmSeed').textContent = v;
    moduleApi.reset();
    syncLabLink();
  };
  $('lmApplySeed').addEventListener('click', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  input.addEventListener('focus', () => input.select());

  const saveBtn = $('lmSave');
  if (saveBtn) saveBtn.addEventListener('click', saveModuleToGallery);
}

function wireSensorControls(lesson, syncLabLink) {
  const st = moduleApi._st;
  st.bars = { dot: $('lmTiltDot') };
  st.eqCanvas = $('lmEqCanvas');

  const micSwitch = $('lmMicSwitch');
  const micBtn = $('lmMic');
  const setMicUi = (on) => {
    if (micSwitch) micSwitch.classList.toggle('on', on);
    if (micBtn) micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  if (micBtn) micBtn.addEventListener('click', () => {
    enableModuleMic(st,
      () => { setMicUi(true); showToast('Микрофон включён — подуйте!'); },
      () => showToast('Нет доступа к микрофону'));
  });
  const tiltBtn = $('lmTilt');
  const setBtn = (btn, on) => {
    btn.classList.toggle('on', on);
    btn.querySelector('.state').textContent = on ? 'on' : 'off';
  };
  if (tiltBtn) tiltBtn.addEventListener('click', () => {
    if (moduleApi.state.sensors.tilt) {
      disableModuleTilt(st);
      setBtn(tiltBtn, false);
    } else {
      enableModuleTilt(st,
        () => { setBtn(tiltBtn, true); showToast('Датчик наклона включён'); },
        () => showToast('Наклон доступен только на телефоне'));
    }
  });
  // Параметры постоянно меняются датчиками — обновляем ссылку в Лаб перед уходом
  const openLabLink = $('lmOpenLab');
  if (openLabLink) openLabLink.addEventListener('click', syncLabLink);

  const saveBtn = $('lmSave');
  if (saveBtn) saveBtn.addEventListener('click', saveModuleToGallery);
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
        <div class="lm-body">
          <div class="lm-canvas" id="lmCanvas"></div>
          ${lesson.moduleSpectrum ? `
          <div class="spectrum-bar lm-spectrum">
            <span class="label left">Pure rule</span>
            <input type="range" id="lmSpectrum" min="0" max="1" step="0.01" value="0" />
            <span class="label right">Pure chaos</span>
            <span class="spectrum-value" id="lmSpectrumValue">0%</span>
          </div>` : ''}
          <div>
            ${moduleControlsHtml(lesson)}
          </div>
        </div>
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

  // Живой генеративный модуль: алгоритм урока, пресет урока.
  // Урок про seed стартует со случайного зерна — его и показываем в поле ввода.
  const startSeed = lesson.moduleMode === 'seed' ? randomSeed() : 'LESSON-' + lesson.num;
  moduleApi = mountModule($('lmCanvas'), lesson.algo, lesson.preset, startSeed);
  window.__lessonModule = moduleApi; // отладочный доступ, как window.__generator в Лабе
  const seedEl = $('lmSeed');
  seedEl.textContent = moduleApi.state.seed;

  const syncLabLink = () => { const a = $('lmOpenLab'); if (a) a.href = labUrl(moduleApi); };
  syncLabLink();

  if (lesson.moduleMode === 'sensors') {
    wireSensorControls(lesson, syncLabLink);
  } else if (lesson.moduleMode === 'seed') {
    wireSeedControls(lesson, syncLabLink);
  } else {
    buildModuleControls($('lmControls'), moduleApi.state, () => {
      moduleApi.reset();
      syncLabLink();
    }, lesson.moduleHideParams);
  }

  const spSlider = $('lmSpectrum');
  if (spSlider) {
    spSlider.addEventListener('input', (e) => {
      moduleApi.state.spectrum = parseFloat(e.target.value);
      const v = $('lmSpectrumValue');
      if (v) v.textContent = Math.round(moduleApi.state.spectrum * 100) + '%';
    });
  }

  const regenBtn = $('lmRegen');
  if (regenBtn) regenBtn.addEventListener('click', () => {
    moduleApi.state.seed = randomSeed();
    seedEl.textContent = moduleApi.state.seed;
    const si = $('lmSeedInput');
    if (si) si.value = moduleApi.state.seed;
    moduleApi.reset();
    syncLabLink();
  });
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
