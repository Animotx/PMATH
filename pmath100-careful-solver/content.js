(() => {
  'use strict';

  // The broad @match fixes installations where the game uses HTTP, another
  // hostname, a local file, or a slightly different route. Stay dormant on
  // unrelated pages.
  const pageLooksLikeGame = /(?:pmath|math.?problem)/i.test(location.href)
    || document.querySelector('#captchaImage, #captchaForm, #captchaInput');
  if (!pageLooksLikeGame) return;

  console.info('[PMath Solver 1.2.0] userscript loaded on', location.href);

  const CONFIG = Object.freeze({
    pollMs: 250,
    readyDelayMinMs: 850,
    readyDelayMaxMs: 1350,
    skipDelayMs: 650,
    maxDistance: 0.34,
    minMargin: 0.055,
    whiteFloor: 180,
  });

  // 24x36 normalized glyph masks learned from the exact font used by the game.
  // Each six-hex-digit group is one 24-pixel row.
  const TEMPLATE_HEX = Object.freeze({
    '0': '000000000000003e0000ff0000ff8003e3c00380e00700e00700700600700c00381c00381c00381c00381c00181c00181c00181c00183c00181c00181c00181c00181c00381c00381c00380c00380600300700700700e00380e003e3c001ffc000ff00007e00000000000000',
    '1': '000000000000000100000f00003f0000ff0000e70000c700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000700000000000000',
    '2': '000000000000001fc000ffe001fff007f0f81f00381e00380400180000180000380000380000380000300000e00000c00001c00003c0000300000700000600000c00001c0000180000380000300000e00001e00001c00001c00007000007fff80ffff81ffff8000000000000',
    '3': '000000000000007e00007f0001ffc007e7e00781e00700e00700f00700700f00700600700000f00000e00001e00007e0001fc0001fc00003e00001e00000f80000380000380000383800183800183c00181c00381c00381e00f80f00e00781e003ffc000ff00000000000000',
    '4': '000000000000000180000380000380000380000780001f80001f80003d8000398000318000e18001c18001c18001c1800181800701800fdff00ffff01ffff00003c0000180000180000180000180000180000180000180000180000180000180000180000180000000000000',
    '5': '00000000000003fff803fff807fff80700000700000600000600000e00000e00000c00001c00001c00001c00001cfc001fff801fffc03c01e00000f00000780000380000380000380000380000383800383800383c00383c00f01f03e01fffc007ff8003ff00000000000000',
    '6': '0000000000000000c00003c0000380000700001c0000380000300000e00001c00001c000039c0003ff0007ffc007c3e00fc0e01f00781e00381e00381e00381e00181c00181c00181c00181c00181e00381e00380e00380e00380780e003e3e001ffc000ffc0000000000000',
    '7': '0000000000001ffff81ffff81ffff81e00700000e00000c00001c00001c0000380000380000300000600000e00000c00001c00001c00001c00001c0000180000380000300000700000700000700000600000600000600000e00000e00000e00000e00000e000000000000000',
    '8': '000000000000007e0001ff8001ff8003e3c003c3e00e00700e00780e00780e00780e00780e00700700e00780e003efe001ff8003ffc007e7e00f81f01e00783c00783c00383c00183800183800183c00383c00383e00781e00780f00f007e7e003ffc001ff80000000000000',
    '9': '000000000000007e0001ff8003ffc003c3e00700f00f00780e00381c00381c00381c00181c00183c00181c00181c00381c00381c00380e00780700f80780f803e7f800fff0007fe00000e00001c00003c0000380000700000e00003c0000380000e00003c000000000000000',
    '+': '000000000000000000000000000000000000000000000000001800001c00001e00001e00001e00001e00001e00001e001ffffc1ffffc3ffffc3ffffc001e00001e00001e00001e00001e00001e00001e00001e00000000000000000000000000000000000000000000000000',
    '-': '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003ffffc3ffffc3ffffc3ffffc0ffff8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    'x': '0000000000000000003c000c1c001c1c001c0e003c0700380380700380e003c0e003c1c000e3c000e3c0007380003f00003e00003c00001c00003e00003f0000778000738000e3c001c1c003c0e003c0e00380700700380e003c0e003c1c001c000000000000000000000000',
  });

  const templates = Object.entries(TEMPLATE_HEX).map(([char, hex]) => {
    const mask = new Uint8Array(24 * 36);
    for (let y = 0; y < 36; y++) {
      const row = Number.parseInt(hex.slice(y * 6, y * 6 + 6), 16);
      for (let x = 0; x < 24; x++) mask[y * 24 + x] = (row >>> (23 - x)) & 1;
    }
    return { char, mask };
  });

  const state = {
    running: true,
    correct: 0,
    wrong: 0,
    skipped: 0,
    current: null,
    timer: 0,
    outcomeKey: '',
  };

  const $ = (selector) => document.querySelector(selector);
  const randomDelay = () => CONFIG.readyDelayMinMs
    + Math.random() * (CONFIG.readyDelayMaxMs - CONFIG.readyDelayMinMs);

  function makeController() {
    document.querySelector('#pm100-solver-panel')?.remove();
    const root = document.createElement('section');
    root.id = 'pm100-solver-panel';
    root.dataset.version = '1.2.0';
    root.innerHTML = `
      <div class="pm-head"><span>∑ Careful Solver</span><span class="pm-dot"></span></div>
      <button class="pm-toggle" type="button">Start</button>
      <div class="pm-grid">
        <div><b data-stat="correct">0</b><small>Correct</small></div>
        <div><b data-stat="wrong">0</b><small>Wrong</small></div>
        <div><b data-stat="skipped">0</b><small>Skipped</small></div>
      </div>
      <div class="pm-expression">—</div>
      <div class="pm-status">Stopped</div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      #pm100-solver-panel{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:248px;padding:12px;border:1px solid #334155;border-radius:14px;background:#0f172a;color:#e2e8f0;box-shadow:0 16px 42px #0008;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none}
      #pm100-solver-panel .pm-head{display:flex;align-items:center;justify-content:space-between;margin:-4px -2px 10px;padding:4px 2px 8px;cursor:move;font-weight:750;font-size:14px;border-bottom:1px solid #334155}
      #pm100-solver-panel .pm-dot{width:9px;height:9px;border-radius:50%;background:#64748b;box-shadow:0 0 0 3px #64748b22}
      #pm100-solver-panel.running .pm-dot{background:#22c55e;box-shadow:0 0 0 3px #22c55e33}
      #pm100-solver-panel .pm-toggle{width:100%;border:0;border-radius:9px;padding:9px 12px;background:#22c55e;color:#052e16;font-weight:800;cursor:pointer}
      #pm100-solver-panel.running .pm-toggle{background:#f59e0b;color:#451a03}
      #pm100-solver-panel .pm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:10px 0}
      #pm100-solver-panel .pm-grid div{padding:7px 3px;text-align:center;border-radius:8px;background:#1e293b}
      #pm100-solver-panel .pm-grid b,#pm100-solver-panel .pm-grid small{display:block}
      #pm100-solver-panel .pm-grid b{font-size:18px;color:#fff}
      #pm100-solver-panel .pm-grid small{font-size:10px;color:#94a3b8}
      #pm100-solver-panel .pm-expression{padding:7px 8px;border-radius:7px;background:#020617;color:#7dd3fc;font:700 14px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #pm100-solver-panel .pm-status{min-height:18px;margin-top:7px;color:#cbd5e1;font-size:11px;white-space:normal}
    `;
    document.head.append(style);
    document.body.append(root);

    root.querySelector('.pm-toggle').addEventListener('click', () => {
      state.running = !state.running;
      if (!state.running) cancelCurrent('Stopped');
      else {
        state.current = null;
        setStatus('Watching for a clear problem…');
        tick();
      }
      render();
    });

    const head = root.querySelector('.pm-head');
    let drag = null;
    head.addEventListener('pointerdown', (event) => {
      const rect = root.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', (event) => {
      if (!drag) return;
      root.style.left = `${Math.max(0, Math.min(innerWidth - root.offsetWidth, event.clientX - drag.dx))}px`;
      root.style.top = `${Math.max(0, Math.min(innerHeight - root.offsetHeight, event.clientY - drag.dy))}px`;
    });
    head.addEventListener('pointerup', () => { drag = null; });
    return root;
  }

  const panel = makeController();

  function render() {
    panel.classList.toggle('running', state.running);
    panel.querySelector('.pm-toggle').textContent = state.running ? 'Stop' : 'Start';
    for (const name of ['correct', 'wrong', 'skipped']) {
      panel.querySelector(`[data-stat="${name}"]`).textContent = String(state[name]);
    }
  }

  function setStatus(text, expression) {
    panel.querySelector('.pm-status').textContent = text;
    if (expression !== undefined) panel.querySelector('.pm-expression').textContent = expression || '—';
  }

  function cancelCurrent(message) {
    clearTimeout(state.timer);
    state.timer = 0;
    state.current = null;
    setStatus(message, '—');
  }

  function imageKey(data, src) {
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 64) {
      hash ^= data[i] + (data[i + 1] << 8) + (data[i + 2] << 16);
      hash = Math.imul(hash, 16777619);
    }
    return `${src}|${hash >>> 0}`;
  }

  function findTileRuns(data, width, height) {
    const y = Math.floor(height / 2);
    const runs = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      let active = false;
      if (x < width) {
        const p = (y * width + x) * 4;
        active = data[p] + data[p + 1] + data[p + 2] > 100;
      }
      if (active && start < 0) start = x;
      if (!active && start >= 0) {
        if (x - start > width * 0.03) runs.push([start, x]);
        start = -1;
      }
    }
    return runs;
  }

  function normalizeGlyph(data, width, height, x0, x1) {
    const points = [];
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * width + x) * 4;
        if (data[p] >= CONFIG.whiteFloor && data[p + 1] >= CONFIG.whiteFloor && data[p + 2] >= CONFIG.whiteFloor) {
          points.push([x, y]);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    if (points.length < 8) return null;

    const sourceW = maxX - minX + 1;
    const sourceH = maxY - minY + 1;
    const scale = Math.min(20 / sourceW, 32 / sourceH);
    const targetW = Math.max(1, Math.floor(sourceW * scale + 0.5));
    const targetH = Math.max(1, Math.floor(sourceH * scale + 0.5));
    const raw = new Uint8Array(sourceW * sourceH);
    for (const [x, y] of points) raw[(y - minY) * sourceW + (x - minX)] = 1;

    const out = new Uint8Array(24 * 36);
    const offsetX = Math.floor((24 - targetW) / 2);
    const offsetY = Math.floor((36 - targetH) / 2);
    for (let y = 0; y < targetH; y++) {
      const sy = Math.min(sourceH - 1, Math.floor(y * sourceH / targetH));
      for (let x = 0; x < targetW; x++) {
        const sx = Math.min(sourceW - 1, Math.floor(x * sourceW / targetW));
        out[(offsetY + y) * 24 + offsetX + x] = raw[sy * sourceW + sx];
      }
    }
    return out;
  }

  function shiftedIoUDistance(a, b) {
    let best = 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let intersection = 0;
        let union = 0;
        for (let y = 0; y < 36; y++) {
          const by = y - dy;
          for (let x = 0; x < 24; x++) {
            const bx = x - dx;
            const av = a[y * 24 + x];
            const bv = bx >= 0 && bx < 24 && by >= 0 && by < 36 ? b[by * 24 + bx] : 0;
            if (av || bv) union++;
            if (av && bv) intersection++;
          }
        }
        best = Math.min(best, 1 - intersection / Math.max(1, union));
      }
    }
    return best;
  }

  function classify(mask) {
    const scores = templates
      .map((template) => ({ char: template.char, distance: shiftedIoUDistance(mask, template.mask) }))
      .sort((a, b) => a.distance - b.distance);
    const best = scores[0];
    const margin = scores[1].distance - best.distance;
    if (best.distance > CONFIG.maxDistance || margin < CONFIG.minMargin) {
      return { ok: false, char: '?', distance: best.distance, margin };
    }
    return { ok: true, char: best.char, distance: best.distance, margin };
  }

  function solveImage(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const key = imageKey(pixels.data, image.currentSrc || image.src);
    const runs = findTileRuns(pixels.data, canvas.width, canvas.height);
    if (runs.length < 5 || runs.length > 14) throw new Error(`unexpected tile count (${runs.length})`);

    const tokens = [];
    const recognized = [];
    for (const [x0, x1] of runs) {
      const mask = normalizeGlyph(pixels.data, canvas.width, canvas.height, x0, x1);
      if (!mask) {
        tokens.push(null);
        recognized.push('·');
        continue;
      }
      const result = classify(mask);
      if (!result.ok) {
        throw new Error(`uncertain glyph (distance ${result.distance.toFixed(3)}, margin ${result.margin.toFixed(3)})`);
      }
      tokens.push(result.char);
      recognized.push(result.char);
    }

    const operatorIndexes = tokens
      .map((token, index) => ['+', '-', 'x'].includes(token) ? index : -1)
      .filter((index) => index >= 0);
    if (operatorIndexes.length !== 1) throw new Error('could not isolate one operator');
    const opIndex = operatorIndexes[0];
    const leftTokens = tokens.slice(0, opIndex).filter(Boolean);
    const rightTokens = tokens.slice(opIndex + 1).filter(Boolean);
    if (!leftTokens.length || !rightTokens.length) throw new Error('missing operand');
    if (![...leftTokens, ...rightTokens].every((token) => /^\d$/.test(token))) {
      throw new Error('non-digit inside an operand');
    }

    const leftText = leftTokens.join('');
    const rightText = rightTokens.join('');
    const left = BigInt(leftText);
    const right = BigInt(rightText);
    let answer;
    if (tokens[opIndex] === '+') answer = left + right;
    else if (tokens[opIndex] === '-') answer = left - right;
    else answer = left * right;

    return {
      key,
      answer: answer.toString(),
      expression: `${leftText} ${tokens[opIndex] === 'x' ? '×' : tokens[opIndex]} ${rightText}`,
      debug: recognized.join(' '),
      submitted: false,
      skipped: false,
      readySeenAt: 0,
      submitAt: 0,
    };
  }

  function scheduleSkip(key, reason) {
    clearTimeout(state.timer);
    setStatus(`Skipping: ${reason}`, 'Uncertain image');
    state.timer = window.setTimeout(() => {
      if (!state.running || !state.current || state.current.key !== key || state.current.skipped) return;
      const skip = $('#skipBtn');
      if (!skip || skip.disabled) return;
      state.current.skipped = true;
      state.skipped++;
      render();
      skip.click();
    }, CONFIG.skipDelayMs);
  }

  function submitCurrent() {
    const current = state.current;
    const input = $('#captchaInput');
    const form = $('#captchaForm');
    const button = $('#submitBtn');
    if (!state.running || !current || current.submitted || !input || !form || !button) return;
    if (input.disabled || button.disabled) {
      current.readySeenAt = 0;
      current.submitAt = 0;
      setStatus('Solved; waiting for the game timer…', `${current.expression} = ${current.answer}`);
      return;
    }

    if (!current.readySeenAt) {
      current.readySeenAt = performance.now();
      current.submitAt = current.readySeenAt + randomDelay();
      clearTimeout(state.timer);
      state.timer = window.setTimeout(tick, Math.max(0, current.submitAt - performance.now()));
      setStatus('Timer ready; verifying before submit…', `${current.expression} = ${current.answer}`);
      return;
    }

    if (performance.now() < current.submitAt) return;

    input.value = current.answer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    current.submitted = true;
    setStatus('Submitted; awaiting result…', `${current.expression} = ${current.answer}`);
    if (typeof form.requestSubmit === 'function') form.requestSubmit(button);
    else button.click();
  }

  function inspectOutcome() {
    const current = state.current;
    if (!current || !current.submitted || state.outcomeKey === current.key) return;
    const text = ($('#statusBox')?.textContent || '').toLowerCase();
    if (text.includes('correct')) {
      state.correct++;
      state.outcomeKey = current.key;
      setStatus('Correct. Waiting for the next problem.', `${current.expression} = ${current.answer}`);
      render();
    } else if (text.includes('wrong') || text.includes('incorrect')) {
      state.wrong++;
      state.outcomeKey = current.key;
      setStatus('Wrong response recorded; continuing.', `${current.expression} = ${current.answer}`);
      render();
    }
  }

  function tick() {
    if (!state.running) return;
    inspectOutcome();

    const image = $('#captchaImage');
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
      setStatus('Waiting for the problem image…');
      return;
    }

    try {
      const solved = solveImage(image);
      if (!state.current || state.current.key !== solved.key) {
        clearTimeout(state.timer);
        state.current = solved;
        setStatus('Recognized with strict confidence.', `${solved.expression} = ${solved.answer}`);
      }
      submitCurrent();
    } catch (error) {
      // Obtain a stable image key even when OCR fails, so one image is skipped once.
      let fallbackKey = image.currentSrc || image.src;
      try {
        const c = document.createElement('canvas');
        c.width = image.naturalWidth; c.height = image.naturalHeight;
        const cx = c.getContext('2d'); cx.drawImage(image, 0, 0);
        fallbackKey = imageKey(cx.getImageData(0, 0, c.width, c.height).data, fallbackKey);
      } catch (_) { /* A tainted canvas is also an uncertain image. */ }
      if (!state.current || state.current.key !== fallbackKey) {
        state.current = { key: fallbackKey, submitted: false, skipped: false };
        scheduleSkip(fallbackKey, error.message);
      }
    }
  }

  const outcomeObserver = new MutationObserver(() => inspectOutcome());
  const statusBox = $('#statusBox');
  if (statusBox) outcomeObserver.observe(statusBox, { subtree: true, childList: true, characterData: true });

  window.setInterval(tick, CONFIG.pollMs);
  render();
  setStatus('Auto-started; watching for a clear problem…');
  tick();
})();
