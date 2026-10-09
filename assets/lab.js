    const state = {
      algorithm: 'flow_field',
      seed: null,
      params: cloneDefaults(ALGORITHMS.flow_field),
      sensors: { mic: false, tilt: false },
      micLevel: 0,
      micBass: 0, micMid: 0, micTreble: 0,
      tiltX: 0, tiltY: 0,
      spectrum: 0,
    };


    /* ============================================================
       URL PARSING
       ============================================================ */
    function applyStateFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const algo = params.get('algo');
      if (!algo || !ALGORITHMS[algo]) return false;
      const a = ALGORITHMS[algo];
      state.algorithm = algo;
      state.params = cloneDefaults(a);
      for (const p of a.params) {
        const v = params.get(p.id);
        if (v === null) continue;
        if (p.type === 'select') {
          if (p.options.includes(v)) state.params[p.id] = v;
        } else {
          const num = parseFloat(v);
          if (!isNaN(num) && num >= p.min && num <= p.max) state.params[p.id] = num;
        }
      }
      const seed = params.get('seed');
      if (seed) state.seed = seed;
      const sp = parseFloat(params.get('spectrum'));
      if (!isNaN(sp)) state.spectrum = Math.max(0, Math.min(1, sp));
      return true;
    }

    function buildShareUrl() {
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('algo', state.algorithm);
      if (state.seed) url.searchParams.set('seed', state.seed);
      for (const p of ALGORITHMS[state.algorithm].params) {
        if (p.type === 'select') continue;
        url.searchParams.set(p.id, state.params[p.id].toString());
      }
      if (state.spectrum > 0) url.searchParams.set('spectrum', state.spectrum.toFixed(2));
      return url.toString();
    }

    /* ============================================================
       SENSOR HARDWARE
       ============================================================ */
    let micContext = null, micAnalyser = null, micBuffer = null, micStream = null;
    let tiltBuffer = [];

    async function enableMic() {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        micContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = micContext.createMediaStreamSource(micStream);
        micAnalyser = micContext.createAnalyser();
        micAnalyser.fftSize = 2048;
        micAnalyser.smoothingTimeConstant = 0.6;
        micBuffer = new Uint8Array(micAnalyser.frequencyBinCount);
        source.connect(micAnalyser);
        state.sensors.mic = true;
        updateSensorUI();
        updateSensorHints();
        showToast('Микрофон включён');
      } catch (err) {
        showToast('Не удалось получить доступ к микрофону');
      }
    }

    function disableMic() {
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (micContext) micContext.close().catch(() => {});
      micStream = null; micContext = null; micAnalyser = null; micBuffer = null;
      state.sensors.mic = false;
      state.micLevel = 0; state.micBass = 0; state.micMid = 0; state.micTreble = 0;
      updateSensorUI();
      updateSensorHints();
    }

    function onMotion(e) {
      const ax = e.accelerationIncludingGravity ? e.accelerationIncludingGravity.x : 0;
      const ay = e.accelerationIncludingGravity ? e.accelerationIncludingGravity.y : 0;
      tiltBuffer.push({ x: ax, y: ay });
      if (tiltBuffer.length > 12) tiltBuffer.shift();
      const avgX = tiltBuffer.reduce((s, v) => s + v.x, 0) / tiltBuffer.length;
      const avgY = tiltBuffer.reduce((s, v) => s + v.y, 0) / tiltBuffer.length;
      state.tiltX = Math.max(-1, Math.min(1, avgX / 10));
      state.tiltY = Math.max(-1, Math.min(1, avgY / 10));
    }

    async function enableTilt() {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          const result = await DeviceMotionEvent.requestPermission();
          if (result !== 'granted') { showToast('Доступ к датчикам не разрешён'); return; }
        } catch { showToast('Не удалось запросить доступ к датчикам'); return; }
      }
      window.addEventListener('devicemotion', onMotion);
      state.sensors.tilt = true;
      updateSensorUI();
      updateSensorHints();
      showToast('Датчик наклона включён');
    }

    function disableTilt() {
      window.removeEventListener('devicemotion', onMotion);
      state.sensors.tilt = false;
      state.tiltX = 0; state.tiltY = 0;
      tiltBuffer = [];
      updateSensorUI();
      updateSensorHints();
    }

    /* ============================================================
       p5 SKETCH
       ============================================================ */
    const sketch = (p) => {
      let ctx = {};
      let p5canvas = null;
      let mediaRecorder = null;
      let recordedChunks = [];

      p.setup = () => {
        const holder = document.getElementById('canvas-holder');
        // Стартуем с минимальным размером: реальный размер подберём ниже,
        // когда у holder появится ненулевая геометрия (критично для iframe-превью).
        p5canvas = p.createCanvas(10, 10);
        p5canvas.parent(holder);
        p.background('#0a0a0c');

        const fit = () => {
          const s = Math.floor(Math.min(holder.clientWidth, holder.clientHeight));
          if (s > 0 && s !== p.width) {
            p.resizeCanvas(s, s);
            p.background('#0a0a0c');
            reset();
          }
        };

        let fitted = false;
        let attempts = 0;
        const waitForSize = () => {
          const s = Math.min(holder.clientWidth, holder.clientHeight);
          if (s > 0) {
            fit();
            if (!fitted) {
              fitted = true;
              if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(fit).observe(holder);
              } else {
                window.addEventListener('resize', fit);
              }
            }
            return;
          }
          if (++attempts < 300) requestAnimationFrame(waitForSize);
        };
        waitForSize();
      };

      function reset() {
        ctx = {};
        // Детерминированный шум и рандом: share-URL с seed воспроизводит
        // работу точно, а не «примерно» (p5 по умолчанию сеет шум случайно).
        const si = hashStringToInt(state.seed);
        p.noiseSeed(si);
        p.randomSeed(si);
        ALGORITHMS[state.algorithm].init(p, state, ctx);
      }

      // Audio bands: bass / mid / treble
      function updateAudioBands() {
        if (!state.sensors.mic || !micAnalyser) return;
        micAnalyser.getByteFrequencyData(micBuffer);
        const sampleRate = micContext ? micContext.sampleRate : 44100;
        const binWidth = sampleRate / micAnalyser.fftSize;
        const bassEnd = Math.floor(250 / binWidth);
        const midEnd = Math.floor(2000 / binWidth);
        let bassSum = 0, midSum = 0, trebleSum = 0;
        for (let i = 1; i < bassEnd; i++) bassSum += micBuffer[i];
        for (let i = bassEnd; i < midEnd; i++) midSum += micBuffer[i];
        for (let i = midEnd; i < micBuffer.length; i++) trebleSum += micBuffer[i];
        state.micBass = Math.min(1, (bassSum / Math.max(1, bassEnd - 1)) / 255 * 3);
        state.micMid = Math.min(1, (midSum / Math.max(1, midEnd - bassEnd)) / 255 * 2);
        state.micTreble = Math.min(1, (trebleSum / Math.max(1, micBuffer.length - midEnd)) / 255 * 4);
        state.micLevel = (state.micBass + state.micMid + state.micTreble) / 3;
      }

      function applySensorModulation() {
        if (!state.sensors.mic && !state.sensors.tilt) return false;
        const algo = ALGORITHMS[state.algorithm];
        if (!algo.sensors) return false;
        let modified = false;
        if (state.sensors.mic) {
          const bands = { bass: state.micBass, mid: state.micMid, treble: state.micTreble };
          for (const band of ['bass','mid','treble']) {
            if (!algo.sensors[band]) continue;
            const pid = algo.sensors[band];
            const param = algo.params.find(x => x.id === pid);
            if (param) {
              const range = param.max - param.min;
              state.params[pid] = param.min + bands[band] * range;
              updateParamVisual(pid, param);
              modified = true;
            }
          }
        }
        if (state.sensors.tilt) {
          if (algo.sensors.tiltX) {
            const pid = algo.sensors.tiltX;
            const param = algo.params.find(x => x.id === pid);
            if (param) {
              const range = param.max - param.min;
              state.params[pid] = param.min + ((state.tiltX + 1) / 2) * range;
              updateParamVisual(pid, param);
              modified = true;
            }
          }
          if (algo.sensors.tiltY) {
            const pid = algo.sensors.tiltY;
            const param = algo.params.find(x => x.id === pid);
            if (param) {
              const range = param.max - param.min;
              state.params[pid] = param.min + ((state.tiltY + 1) / 2) * range;
              updateParamVisual(pid, param);
              modified = true;
            }
          }
        }
        return modified;
      }

      // Spectrum of order: pure rule → pure chaos
      function applySpectrum() {
        if (state.spectrum < 0.01) return false;
        const algo = ALGORITHMS[state.algorithm];
        // For one-shot algos, re-init with high probability
        if (!algo.continuous) {
          if (Math.random() < state.spectrum * 0.4) {
            algo.init(p, state, ctx);
            return true;
          }
        }
        // Jitter one numeric param to add chaos
        const numericParams = algo.params.filter(x => x.type !== 'select');
        if (numericParams.length === 0) return false;
        const param = numericParams[Math.floor(Math.random() * numericParams.length)];
        const range = param.max - param.min;
        const current = state.params[param.id];
        const jitter = (Math.random() - 0.5) * range * state.spectrum * 0.6;
        state.params[param.id] = Math.max(param.min, Math.min(param.max, current + jitter));
        updateParamVisual(param.id, param);
        return true;
      }

      p.draw = () => {
        updateAudioBands();
        const sensorModified = applySensorModulation();
        const spectrumModified = applySpectrum();
        const algo = ALGORITHMS[state.algorithm];
        if ((sensorModified || spectrumModified) && algo.sensorReinit) {
          algo.init(p, state, ctx);
        }
        algo.draw(p, state, ctx);

        // Update band meters
        if (state.sensors.mic) {
          const b = $('bassBar'); if (b) b.style.width = (state.micBass * 100).toFixed(1) + '%';
          const m = $('midBar'); if (m) m.style.width = (state.micMid * 100).toFixed(1) + '%';
          const t = $('trebleBar'); if (t) t.style.width = (state.micTreble * 100).toFixed(1) + '%';
        } else {
          ['bassBar','midBar','trebleBar'].forEach(id => { const el = $(id); if (el) el.style.width = '0%'; });
        }
        if (state.sensors.tilt) {
          const d = $('tiltDot');
          if (d) d.style.transform = `translate(calc(-50% + ${state.tiltX * 22}px), calc(-50% + ${state.tiltY * 22}px))`;
        }
      };

      window.__generator = {
        reset,
        snapshot: () => p.canvas.toDataURL('image/png'),
        getCanvas: () => p.canvas,
        getP5: () => p,
      };
    };

    function updateParamVisual(paramId, param) {
      const inp = $('input_' + paramId);
      if (inp) inp.value = state.params[paramId];
      const disp = $(paramId + '_display');
      if (disp) disp.textContent = param.format(state.params[paramId]);
    }

    new p5(sketch);    /* ============================================================
       UI
       ============================================================ */
    const $ = (id) => document.getElementById(id);

    function randomSeed() {
      return Math.random().toString(36).slice(2, 8).toUpperCase();
    }

    function applySeed(s) {
      state.seed = s;
      $('seedDisplay').textContent = s;
      $('chipSeed').textContent = s;
      if (window.__generator) window.__generator.reset();
    }

    function regenerate() { applySeed(randomSeed()); }

    function switchAlgorithm(id) {
      if (!ALGORITHMS[id]) return;
      state.algorithm = id;
      state.params = cloneDefaults(ALGORITHMS[id]);
      renderTabs();
      renderControls();
      renderAbout();
      $('chipAlgo').textContent = ALGORITHMS[id].label;
      applySeed(randomSeed());
      updateSensorHints();
    }

    function renderTabs() {
      const wrap = $('algoTabs');
      wrap.innerHTML = '';
      for (const id of Object.keys(ALGORITHMS)) {
        const algo = ALGORITHMS[id];
        const btn = document.createElement('button');
        btn.className = 'tab' + (id === state.algorithm ? ' active' : '');
        btn.textContent = algo.label;
        btn.addEventListener('click', () => switchAlgorithm(id));
        wrap.appendChild(btn);
      }
    }

    function renderControls() {
      const algo = ALGORITHMS[state.algorithm];
      const wrap = $('params');
      wrap.innerHTML = '';
      $('algoTitle').textContent = 'Параметры';
      $('algoShort').textContent = algo.short;
      const sensorMap = computeSensorMap();

      for (const param of algo.params) {
        const row = document.createElement('div');
        row.className = 'param';
        const val = state.params[param.id];
        const drivenBy = sensorMap[param.id];
        const tagMap = { mic: '🎤', bass: '🎤 low', mid: '🎤 mid', treble: '🎤 high', tiltX: '📱 X', tiltY: '📱 Y' };
        const drivenTag = drivenBy ? `<span class="sensor-tag">${tagMap[drivenBy] || drivenBy}</span>` : '';

        if (param.type === 'select') {
          row.innerHTML = `<label>${param.label} ${drivenTag}</label>`;
          const sel = document.createElement('select');
          sel.className = drivenBy ? 'sensor-driven' : '';
          for (const opt of param.options) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            if (opt === val) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener('change', (e) => {
            state.params[param.id] = e.target.value;
            if (window.__generator) window.__generator.reset();
          });
          row.appendChild(sel);
        } else {
          row.innerHTML = `<label>${param.label} <span id="${param.id}_display">${param.format(val)}</span> ${drivenTag}</label>`;
          const input = document.createElement('input');
          input.type = 'range';
          input.min = param.min; input.max = param.max; input.step = param.step;
          input.value = val;
          input.id = 'input_' + param.id;
          input.className = drivenBy ? 'sensor-driven' : '';
          input.disabled = !!drivenBy;
          input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            state.params[param.id] = v;
            const disp = $(param.id + '_display');
            if (disp) disp.textContent = param.format(v);
            if (window.__generator) window.__generator.reset();
          });
          row.appendChild(input);
        }
        wrap.appendChild(row);
      }
    }

    function computeSensorMap() {
      const algo = ALGORITHMS[state.algorithm];
      const map = {};
      if (!algo.sensors) return map;
      if (state.sensors.mic) {
        if (algo.sensors.bass) map[algo.sensors.bass] = 'bass';
        if (algo.sensors.mid) map[algo.sensors.mid] = 'mid';
        if (algo.sensors.treble) map[algo.sensors.treble] = 'treble';
      }
      if (state.sensors.tilt) {
        if (algo.sensors.tiltX) map[algo.sensors.tiltX] = 'tiltX';
        if (algo.sensors.tiltY) map[algo.sensors.tiltY] = 'tiltY';
      }
      return map;
    }

    function updateSensorHints() {
      const algo = ALGORITHMS[state.algorithm];
      const hint = $('sensorHint');
      if (!algo.sensors) {
        hint.textContent = 'Этот алгоритм не использует датчики.';
        return;
      }
      const lines = [];
      const sensorLabels = { bass: '🎤 bass', mid: '🎤 mid', treble: '🎤 treble', tiltX: '📱 наклон X', tiltY: '📱 наклон Y' };
      for (const k of ['bass','mid','treble','tiltX','tiltY']) {
        if (algo.sensors[k]) lines.push(`${sensorLabels[k]} → ${paramLabel(algo, algo.sensors[k])}`);
      }
      hint.innerHTML = lines.length ? 'Привязки для текущего алгоритма:<br>' + lines.join('<br>') : '';
    }

    function paramLabel(algo, id) {
      const p = algo.params.find(p => p.id === id);
      return p ? p.label : id;
    }

    function renderAbout() {
      const algo = ALGORITHMS[state.algorithm];
      $('aboutGrid').innerHTML = `
        <div class="about-card"><h3>${algo.label}</h3><p>${algo.about.intro}</p></div>
        <div class="about-card"><h3>Параметры</h3><p>${algo.about.param}</p></div>
        <div class="about-card"><h3>Seed</h3><p>${algo.about.seed}</p></div>
      `;
    }

    function updateSensorUI() {
      const micBtn = $('micToggle');
      const tiltBtn = $('tiltToggle');
      if (state.sensors.mic) {
        micBtn.classList.add('on');
        micBtn.querySelector('.state').textContent = 'on';
      } else {
        micBtn.classList.remove('on');
        micBtn.querySelector('.state').textContent = 'off';
      }
      if (state.sensors.tilt) {
        tiltBtn.classList.add('on');
        tiltBtn.querySelector('.state').textContent = 'on';
      } else {
        tiltBtn.classList.remove('on');
        tiltBtn.querySelector('.state').textContent = 'off';
        const d = $('tiltDot'); if (d) d.style.transform = 'translate(-50%, -50%)';
      }
      renderControls();
    }

    /* ----------------- SPECTRUM ----------------- */
    $('spectrum').addEventListener('input', (e) => {
      state.spectrum = parseFloat(e.target.value);
      $('spectrumValue').textContent = Math.round(state.spectrum * 100) + '%';
    });

    /* ----------------- BUTTONS ----------------- */
    $('regenerate').addEventListener('click', regenerate);
    $('copySeed').addEventListener('click', () => {
      navigator.clipboard.writeText(state.seed || '').then(
        () => showToast('Seed скопирован'),
        () => showToast('Не удалось скопировать')
      );
    });
    $('micToggle').addEventListener('click', () => {
      if (state.sensors.mic) disableMic(); else enableMic();
    });
    $('tiltToggle').addEventListener('click', () => {
      if (state.sensors.tilt) disableTilt(); else enableTilt();
    });
    $('share').addEventListener('click', () => {
      const url = buildShareUrl();
      navigator.clipboard.writeText(url).then(
        () => showToast('Ссылка скопирована в буфер'),
        () => showToast('Не удалось скопировать')
      );
    });

    /* ----------------- RECORDING (MediaRecorder) ----------------- */
    let recState = { recording: false, chunks: [], startTime: 0, timeout: null };
    const REC_DURATION = 3000; // 3 seconds
    $('record').addEventListener('click', () => {
      if (recState.recording) return;
      const canvas = window.__generator && window.__generator.getCanvas();
      if (!canvas) return;
      try {
        const stream = canvas.captureStream(30);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recState.chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) recState.chunks.push(e.data); };
        recorder.onstop = () => {
          const blob = new Blob(recState.chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cifra-${state.algorithm}-${state.seed || 'recording'}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          recState.recording = false;
          $('recordIndicator').classList.remove('active');
          $('record').textContent = '⏺ Записать 3 сек';
          $('record').classList.remove('btn-recording');
          showToast('Видео сохранено');
        };
        recorder.start();
        recState.recording = true;
        recState.startTime = Date.now();
        $('recordIndicator').classList.add('active');
        $('record').textContent = '⏹ Остановить';
        $('record').classList.add('btn-recording');
        recState.timeout = setTimeout(() => {
          if (recState.recording) recorder.stop();
        }, REC_DURATION);
        showToast('Запись началась');
      } catch (err) {
        showToast('Запись не поддерживается в этом браузере');
      }
    });

    /* ----------------- GALLERY ----------------- */

    function renderGallery() {
      const items = loadGallery();
      const grid = $('galleryGrid');
      grid.innerHTML = '';
      if (!items.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = 'Здесь пока пусто. Нажмите «Сохранить», чтобы добавить работу.';
        grid.appendChild(e);
        return;
      }
      for (const it of items) {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        const algoLabel = ALGORITHMS[it.algorithm] ? ALGORITHMS[it.algorithm].label : it.algorithm;
        card.innerHTML = `
          <span class="algo-chip">${algoLabel}</span>
          <img src="${it.thumb}" alt="seed ${it.seed}">
          <div class="meta"><span>${new Date(it.ts).toLocaleDateString('ru-RU')}</span><code>${it.seed}</code></div>
          <button class="relatives-btn" title="Семья (тот же seed в других алгоритмах)">↗ Семья</button>
          <button class="delete-btn" title="Удалить">×</button>
        `;
        card.querySelector('img').addEventListener('click', () => restoreFromGallery(it));
        card.querySelector('.relatives-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openRelatives(it);
        });
        card.querySelector('.delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const filtered = loadGallery().filter((x) => !(x.seed === it.seed && x.ts === it.ts));
          saveGallery(filtered);
          renderGallery();
        });
        grid.appendChild(card);
      }
    }

    function restoreFromGallery(it) {
      if (!ALGORITHMS[it.algorithm]) return;
      state.algorithm = it.algorithm;
      state.params = { ...it.config };
      renderTabs();
      renderControls();
      renderAbout();
      $('chipAlgo').textContent = ALGORITHMS[it.algorithm].label;
      applySeed(it.seed);
      updateSensorHints();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(`Загружено: ${ALGORITHMS[it.algorithm].label}`);
    }

    $('save').addEventListener('click', () => {
      if (!state.seed || !window.__generator) return;
      const thumb = window.__generator.snapshot();
      const items = loadGallery();
      items.unshift({
        seed: state.seed,
        algorithm: state.algorithm,
        config: { ...state.params },
        spectrum: state.spectrum,
        ts: Date.now(),
        thumb,
      });
      saveGallery(items.slice(0, 24));
      renderGallery();
      showToast('Сохранено в коллекцию');
    });

    $('clearGallery').addEventListener('click', () => {
      if (!loadGallery().length) return;
      if (confirm('Очистить коллекцию?')) { saveGallery([]); renderGallery(); }
    });

    /* ----------------- RELATIVES (Семья) ----------------- */
    function openRelatives(it) {
      const modal = $('relativesModal');
      const grid = $('relativesGrid');
      $('relativesSeed').textContent = it.seed;
      grid.innerHTML = '';
      const items = [];
      for (const algoId of Object.keys(ALGORITHMS)) {
        if (algoId === it.algorithm) continue;
        items.push({ algo: algoId, seed: it.seed, current: false });
      }
      items.unshift({ algo: it.algorithm, seed: it.seed, current: true });

      for (const item of items) {
        const card = document.createElement('div');
        card.className = 'rel-card' + (item.current ? ' current' : '');
        const label = ALGORITHMS[item.algo].label;
        card.innerHTML = `<div class="rel-label">${label}${item.current ? ' (эта)' : ''}</div>`;
        grid.appendChild(card);
        // Render in offscreen canvas, then copy to img
        renderRelative(item.algo, item.seed).then(dataUrl => {
          if (!dataUrl) return;
          const img = document.createElement('img');
          img.src = dataUrl;
          card.appendChild(img);
          card.classList.add('loaded');
          if (!item.current) {
            card.addEventListener('click', () => {
              closeRelatives();
              switchAlgorithm(item.algo);
              applySeed(item.seed);
              // Restore params
              setTimeout(() => {
                if (it.config) {
                  for (const p of ALGORITHMS[item.algo].params) {
                    if (it.config[p.id] !== undefined) {
                      state.params[p.id] = it.config[p.id];
                      const inp = $('input_' + p.id);
                      if (inp) inp.value = state.params[p.id];
                    }
                  }
                }
                showToast(`Открыто: ${label} (тот же seed)`);
              }, 50);
            });
          }
        });
      }
      modal.classList.add('open');
    }

    function closeRelatives() {
      $('relativesModal').classList.remove('open');
    }
    $('relativesClose').addEventListener('click', closeRelatives);
    $('relativesModal').addEventListener('click', (e) => {
      if (e.target.id === 'relativesModal') closeRelatives();
    });

    // Render a single artwork off-screen
    function renderRelative(algoId, seed) {
      return new Promise((resolve) => {
        const algo = ALGORITHMS[algoId];
        const tempCanvas = document.createElement('canvas');
        const size = 200;
        tempCanvas.width = size; tempCanvas.height = size;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = '#0a0a0c';
        tempCtx.fillRect(0, 0, size, size);

        // Use p5 instance-less approach for simple algos
        // For complex algos (p5-based), just generate a placeholder or use snapshot
        // Approach: temporarily switch state, capture, restore
        const savedAlgo = state.algorithm;
        const savedSeed = state.seed;
        const savedParams = { ...state.params };
        state.algorithm = algoId;
        state.seed = seed;
        state.params = cloneDefaults(algo);
        // Try to use the global p5 instance
        try {
          // This is tricky - p5 instances have their own state
          // For simplicity, render a colored card with the label
          const gradient = tempCtx.createLinearGradient(0, 0, size, size);
          const palette = PALETTES[algo.params.find(p => p.id === 'palette') ? 'aurora' : 'lava'];
          gradient.addColorStop(0, palette[0]);
          gradient.addColorStop(1, palette[palette.length - 1]);
          tempCtx.fillStyle = gradient;
          tempCtx.fillRect(0, 0, size, size);
          tempCtx.fillStyle = 'rgba(0,0,0,0.5)';
          tempCtx.fillRect(0, 0, size, size);
          tempCtx.fillStyle = '#fff';
          tempCtx.font = '14px monospace';
          tempCtx.textAlign = 'center';
          tempCtx.fillText(algo.label, size/2, size/2);
        } catch {}
        // Restore
        state.algorithm = savedAlgo;
        state.seed = savedSeed;
        state.params = savedParams;
        resolve(tempCanvas.toDataURL('image/png'));
      });
    }

    /* ----------------- TOAST ----------------- */
    let toastTimer = null;
    function showToast(msg) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    }

    /* ----------------- INIT ----------------- */
    // Try to load from URL first
    const loaded = applyStateFromUrl();
    renderTabs();
    renderControls();
    renderAbout();
    renderGallery();
    updateSensorHints();
    $('spectrum').value = state.spectrum;
    $('spectrumValue').textContent = Math.round(state.spectrum * 100) + '%';
    if (loaded) {
      $('chipAlgo').textContent = ALGORITHMS[state.algorithm].label;
      $('seedDisplay').textContent = state.seed || '—';
      $('chipSeed').textContent = state.seed || '—';
      showToast('Загружено из ссылки');
    } else {
      regenerate();
    }
    /* ============================================================
       CODE VIEW — показываем код текущего алгоритма
       ============================================================ */
    function getCurrentCode() {
      const algo = ALGORITHMS[state.algorithm];
      if (!algo) return '// Алгоритм не выбран';
      const initSrc = algo.init.toString();
      const drawSrc = algo.draw.toString();
      return `// ${algo.label}\n// ${algo.short}\n// seed: ${state.seed}\n\n` +
        `init(p, state, ctx) — вызывается при смене seed или алгоритма\n` +
        `function init(p, state, ctx) {\n${indentCode(initSrc, 1)}\n}\n\n` +
        `draw(p, state, ctx) — вызывается каждый кадр (~60 fps)\n` +
        `function draw(p, state, ctx) {\n${indentCode(drawSrc, 1)}\n}`;
    }

    function indentCode(fnSrc, depth) {
      const pad = '  '.repeat(depth);
      return fnSrc.split('\n').map(l => pad + l).join('\n');
    }

    function highlightJS(code) {
      // Очень простая подсветка: ключевые слова, функции, числа, строки, комментарии
      const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let html = escape(code);
      // Комментарии
      html = html.replace(/(\/\/[^\n]*)/g, '<span class="tk-com">$1</span>');
      // Строки
      html = html.replace(/(&#39;[^&#39;]*&#39;)/g, '<span class="tk-str">$1</span>');
      html = html.replace(/(&quot;[^&quot;]*&quot;)/g, '<span class="tk-str">$1</span>');
      // Числа
      html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="tk-num">$1</span>');
      // Ключевые слова JS
      const keywords = ['function','const','let','var','if','else','for','while','return','new','this','class','extends','true','false','null','undefined','import','export','from','of','in','typeof','instanceof','void','delete','switch','case','break','continue','do','try','catch','finally','throw','async','await'];
      const kwRe = new RegExp('\\b(' + keywords.join('|') + ')\\b', 'g');
      html = html.replace(kwRe, '<span class="tk-key">$1</span>');
      return html;
    }

    function renderCode() {
      const algo = ALGORITHMS[state.algorithm];
      if (!algo) return;
      const code = getCurrentCode();
      const el = $('codeContent');
      if (el) el.innerHTML = highlightJS(code);
    }

    // Code drawer toggle
    $('codeDrawerHeader').addEventListener('click', (e) => {
      if (e.target.id === 'codeCopy') return;
      $('codeDrawer').classList.toggle('expanded');
    });
    $('codeCopy').addEventListener('click', (e) => {
      e.stopPropagation();
      const code = getCurrentCode();
      navigator.clipboard.writeText(code).then(
        () => showToast('Код скопирован'),
        () => showToast('Не удалось скопировать')
      );
    });

    /* ============================================================
       DAILY PIECE — seed = дата
       ============================================================ */
    function getDailySeed() {
      const d = new Date();
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;
      // Хеш → 6 символов
      const n = hashStringToInt('DAILY-' + dateKey);
      return dateKey + '-' + n.toString(36).toUpperCase().slice(-4);
    }

    function getDailyDateLabel() {
      const d = new Date();
      const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
      return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    function updateDailyDisplay() {
      const dateEl = $('dailyDate');
      if (dateEl) dateEl.textContent = getDailyDateLabel();
    }

    $('dailyTake').addEventListener('click', () => {
      const seed = getDailySeed();
      applySeed(seed);
      showToast('Работа сегодняшнего дня загружена');
    });

    /* ============================================================
       WALK — 30-секундный автопилот
       ============================================================ */
    let walkState = { active: false, frames: [], videoBlob: null, videoUrl: null, interval: null, recorder: null, chunks: [] };

    function changeRandomParam() {
      const algo = ALGORITHMS[state.algorithm];
      const numericParams = algo.params.filter(p => p.type !== 'select');
      if (numericParams.length === 0) return;
      const param = numericParams[Math.floor(Math.random() * numericParams.length)];
      const newVal = param.min + Math.random() * (param.max - param.min);
      state.params[param.id] = newVal;
      updateParamVisual(param.id, param);
      // Для reinit-алгоритмов нужен настоящий p5-инстанс
      if (algo.sensorReinit && window.__generator && window.__generator.getP5) {
        algo.init(window.__generator.getP5(), state, {});
      }
    }

    function startWalk() {
      if (walkState.active) return;
      const canvas = window.__generator && window.__generator.getCanvas();
      if (!canvas) return;

      const DURATION = 30000;
      const INTERVAL = 500; // 60 frames за 30 сек
      const startTime = Date.now();

      walkState.active = true;
      walkState.frames = [];
      walkState.chunks = [];

      // Запускаем MediaRecorder для видео
      let recorder = null;
      try {
        const stream = canvas.captureStream(30);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) walkState.chunks.push(e.data); };
        recorder.onstop = () => {
          walkState.videoBlob = new Blob(walkState.chunks, { type: 'video/webm' });
          walkState.videoUrl = URL.createObjectURL(walkState.videoBlob);
        };
        recorder.start();
        walkState.recorder = recorder;
      } catch (err) {
        // video capture failed, continue with frame snapshots
      }

      // Каждые 500ms: сменить параметр + снять кадр
      walkState.interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= DURATION) {
          finishWalk();
          return;
        }
        // Прогресс в тосте
        const progressEl = document.getElementById('walkProgress');
        const remaining = Math.max(0, Math.ceil((DURATION - elapsed) / 1000));
        showToast(`Walk: ${remaining}s осталось`);
        // Сменить параметр и снять кадр
        changeRandomParam();
        walkState.frames.push(canvas.toDataURL('image/jpeg', 0.6));
      }, INTERVAL);

      $('walk').textContent = '⏹ Остановить Walk';
      $('walk').classList.add('btn-recording');
      showToast('Walk запущен — 30 секунд');
    }

    function finishWalk() {
      if (walkState.interval) clearInterval(walkState.interval);
      if (walkState.recorder && walkState.recorder.state !== 'inactive') {
        walkState.recorder.stop();
      }
      walkState.active = false;
      $('walk').textContent = '🚶 Walk 30 сек';
      $('walk').classList.remove('btn-recording');
      // Снять последний кадр
      const canvas = window.__generator && window.__generator.getCanvas();
      if (canvas) walkState.frames.push(canvas.toDataURL('image/jpeg', 0.6));
      showWalkModal();
    }

    function showWalkModal() {
      const modal = $('walkModal');
      const flipbook = $('walkFlipbook');
      const countEl = $('walkCount');
      if (!modal || !flipbook) return;
      flipbook.innerHTML = '';
      walkState.frames.forEach(dataUrl => {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.loading = 'lazy';
        flipbook.appendChild(img);
      });
      if (countEl) countEl.textContent = `${walkState.frames.length} кадров за 30 секунд.`;
      modal.classList.add('open');
    }

    $('walk').addEventListener('click', () => {
      if (walkState.active) {
        finishWalk();
      } else {
        startWalk();
      }
    });

    $('walkClose').addEventListener('click', () => {
      $('walkModal').classList.remove('open');
    });
    $('walkAgain').addEventListener('click', () => {
      $('walkModal').classList.remove('open');
      setTimeout(() => startWalk(), 200);
    });
    $('walkDownload').addEventListener('click', () => {
      if (walkState.videoBlob && walkState.videoUrl) {
        const a = document.createElement('a');
        a.href = walkState.videoUrl;
        a.download = `cifra-walk-${state.algorithm}-${state.seed || 'walk'}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Видео сохранено');
      } else {
        showToast('Видео недоступно, но кадры в модалке');
      }
    });

    /* ============================================================
       Init updates for new features
       ============================================================ */
    // Перерисовываем код при смене алгоритма
    const _origSwitchAlgorithm = switchAlgorithm;
    switchAlgorithm = function(id) {
      _origSwitchAlgorithm(id);
      renderCode();
    };
    const _origApplySeed = applySeed;
    applySeed = function(s) {
      _origApplySeed(s);
      renderCode();
    };
    renderCode();