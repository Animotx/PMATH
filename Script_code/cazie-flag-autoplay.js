// ==UserScript==
// @name         Cazie's Flag Challenge Helper
// @namespace    local.cazie.flag-helper
// @version      4.1.0
// @description  Automatically start and answer flags in the updated chat-style challenge after you sign in.
// @match        https://cazie-s.onrender.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const KEY = '__cazieFlagHelper';
  if (window[KEY]) return;

  const state = { running: false, userPaused: false, autoStopped: false, busy: false, queue: [], delay: 1000, timer: 0, catalog: null, nameMap: null, pixelCache: new Map(), rectCache: new Map(), lastSubmittedFingerprint: '', fallbackIndex: Number(localStorage.getItem('cazie_flag_fallback_index') || 0) };
  const panel = document.createElement('section');
  panel.id = 'cazie-flag-helper';
  panel.setAttribute('popover', 'manual');
  panel.innerHTML = `
    <header><strong>Flag helper</strong><button type="button" data-min aria-label="Minimize">−</button></header>
    <div class="body">
      <label><input data-auto type="checkbox" checked> Identify flags automatically</label>
      <small>Captures the newest chat flag and compares colors, shapes, and reference flags. Low-confidence matches show an alternative.</small>
      <label>Optional answer queue (one per line)</label>
      <textarea data-answers rows="3" placeholder="Used instead of recognition when provided"></textarea>
      <label>Wait between actions (seconds)</label>
      <input data-delay type="number" min="1" max="120" step="1" value="1">
      <div class="buttons"><button type="button" data-start>Start</button><button type="button" data-pause disabled>Pause</button></div>
      <button type="button" data-scan>📷 Capture current flag</button>
      <div data-scan-card hidden><img data-scan-image alt="Captured flag preview"><small data-scan-result></small></div>
      <div data-status role="status">Waiting for the dashboard or flag challenge…</div>
      <ol data-log></ol>
      <small>Reference sites:
        <a href="https://www.countryflags.com/" target="_blank" rel="noopener">CountryFlags.com</a> ·
        <a href="https://flagpedia.net/" target="_blank" rel="noopener">Flagpedia</a> ·
        <a href="https://worldflags.net/" target="_blank" rel="noopener">WorldFlags.net</a> ·
        <a href="https://worldflagmap.com/" target="_blank" rel="noopener">World Flag Map</a>
      </small>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #cazie-flag-helper{position:fixed!important;inset:auto 18px 18px auto!important;z-index:2147483647!important;isolation:isolate;pointer-events:auto!important;touch-action:manipulation;width:290px;max-height:75vh;overflow:hidden;background:#fff;color:#24191c;border:1px solid #e9b8c4;border-radius:14px;box-shadow:0 8px 32px #32101c38;font:13px/1.4 system-ui,sans-serif}
    #cazie-flag-helper *{box-sizing:border-box} #cazie-flag-helper header{display:flex;justify-content:space-between;align-items:center;padding:10px 13px;background:#cc4e69;color:#fff}
    #cazie-flag-helper button{pointer-events:auto!important;cursor:pointer;border:0;border-radius:7px;padding:7px 10px;background:#cc4e69;color:white;font-weight:700} #cazie-flag-helper button:disabled{opacity:.45;cursor:default}
    #cazie-flag-helper header button{padding:0 7px;background:#ffffff30;font-size:18px} #cazie-flag-helper .body{padding:12px;overflow:auto;max-height:calc(75vh - 42px)}
    #cazie-flag-helper label{display:block;margin:8px 0 4px;font-weight:650} #cazie-flag-helper textarea,#cazie-flag-helper input{width:100%;padding:8px;border:1px solid #e8c4cc;border-radius:7px;font:inherit;background:#fffafa;color:#24191c} #cazie-flag-helper [data-auto]{width:auto;vertical-align:middle} #cazie-flag-helper small{display:block;color:#635057}
    #cazie-flag-helper .buttons{display:flex;gap:8px;margin-top:10px} #cazie-flag-helper [data-pause]{background:#6b5b60}
    #cazie-flag-helper [data-scan]{width:100%;margin-top:7px;background:#7d3548} #cazie-flag-helper [data-scan-card]{margin-top:8px;padding:7px;border:1px solid #e8c4cc;border-radius:8px;background:#fffafa} #cazie-flag-helper [data-scan-image]{display:block;width:100%;aspect-ratio:3/2;object-fit:contain;background:white;border-radius:5px} #cazie-flag-helper [data-scan-result]{margin-top:4px}
    #cazie-flag-helper [data-status]{margin-top:9px;color:#635057} #cazie-flag-helper ol{padding-left:22px;max-height:135px;overflow:auto;margin:7px 0 0} #cazie-flag-helper li{margin:4px 0;overflow-wrap:anywhere}
    #cazie-flag-helper.min .body{display:none}`;
  document.documentElement.append(style, panel);
  try { if (typeof panel.showPopover === 'function' && !panel.matches(':popover-open')) panel.showPopover(); } catch {}
  const $ = (sel) => panel.querySelector(sel);
  const status = (msg) => {
    if (state.userPaused && msg !== 'Paused.') return;
    const el = $('[data-status]');
    if (el.textContent !== msg) el.textContent = msg;
  };
  const log = (answer, result) => {
    const li = document.createElement('li');
    li.textContent = `${answer} — ${result}`;
    $('[data-log]').prepend(li);
  };
  const delay = () => new Promise((resolve) => { state.timer = window.setTimeout(resolve, state.delay); });
  function findAnswerInput() {
    const oldInput = document.querySelector('#flag-country-input');
    if (oldInput) return oldInput;
    return [...document.querySelectorAll('input[maxlength="50"][inputmode="text"]')].find((input) => {
      const placeholder = input.getAttribute('placeholder') || '';
      const form = input.closest('form');
      const hasSendButton = [...(form?.querySelectorAll('button[type="submit"]') || [])]
        .some((button) => /^send$/i.test(button.textContent.trim()));
      return hasSendButton && /country name|preparing challenge|evaluating answer|challenge completed/i.test(placeholder);
    }) || null;
  }
  const isChallenge = () => Boolean(findAnswerInput()) || [...document.querySelectorAll('h1,h2')]
    .some((el) => /Which Country Does This Flag Belong To\?/i.test(el.textContent));
  const waitFor = async (fn, timeout = 180000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end && state.running) {
      const value = fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };

  const aliasByCode = { bo:'Bolivia', cd:'Democratic Republic of the Congo', cg:'Republic of the Congo', ci:'Ivory Coast', cv:'Cape Verde', cz:'Czech Republic', gb:'United Kingdom', ir:'Iran', kp:'North Korea', kr:'South Korea', la:'Laos', md:'Moldova', mk:'North Macedonia', mm:'Myanmar', ru:'Russia', sz:'Eswatini', sy:'Syria', tw:'Taiwan', tz:'Tanzania', tr:'Turkey', us:'United States', va:'Vatican City', ve:'Venezuela', vn:'Vietnam', bn:'Brunei', fm:'Micronesia', ps:'Palestine' };
  const cacheKey = (key) => `cazie_flag_ref_${key}`;
  async function loadCatalog() {
    if (state.catalog) return state.catalog;
    const metaKey = cacheKey('flagpedia-country-list-v2');
    let nameMap;
    try { nameMap = JSON.parse(localStorage.getItem(metaKey) || 'null'); } catch {}
    if (!nameMap || typeof nameMap !== 'object') {
      status('Loading Flagpedia country list…');
      const response = await fetch('https://flagcdn.com/en/codes.json');
      if (!response.ok) throw new Error('Could not load Flagpedia country names (network/CORS).');
      nameMap = await response.json();
      try { localStorage.setItem(metaKey, JSON.stringify(nameMap)); } catch {}
    }
    state.nameMap = nameMap;
    const entries = Object.entries(nameMap).filter(([code]) => /^[a-z]{2}$/.test(code));
    let cursor = 0;
    let loaded = 0;
    const refs = new Array(entries.length);
    const worker = async () => {
      while (cursor < entries.length) {
        const i = cursor++;
        const [code, displayName] = entries[i];
        const name = aliasByCode[code] || displayName.replace(/\s*\([^)]*\)/g, '').trim();
        const variants = [];
        const sources = [
          ['flagpedia', `https://flagcdn.com/${code}.svg`],
          ['flag-icons', `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/${code}.svg`],
        ];
        for (const [source, url] of sources) {
          const key = cacheKey(`${source}-${code}`);
          let svg = null;
          try { svg = localStorage.getItem(key); } catch {}
          if (!svg) {
            try {
              const res = await fetch(url);
              if (res.ok) {
                svg = await res.text();
                if (svg.includes('<svg')) try { localStorage.setItem(key, svg); } catch {}
              }
            } catch {}
          }
          if (svg?.includes('<svg')) variants.push(svg);
        }
        if (variants.length) refs[i] = { name, code, variants };
        loaded++;
        if (loaded % 24 === 0) status(`Loading flag references… ${loaded}/${entries.length}`);
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    state.catalog = refs.filter(Boolean);
    if (!state.catalog.length) throw new Error('No reference flags loaded. Check your connection and try again.');
    return state.catalog;
  }

  async function fallbackAnswer() {
    // If the flag is rendered in an unexpected way, rotate through the full
    // available country-name list so the game still receives an answer.
    let names = state.catalog?.map((c) => c.name);
    if (!names?.length) {
      try {
        if (!state.nameMap) {
          const response = await fetch('https://flagcdn.com/en/codes.json');
          if (response.ok) state.nameMap = await response.json();
        }
        names = Object.entries(state.nameMap || {})
          .filter(([code]) => /^[a-z]{2}$/.test(code))
          .map(([code, name]) => aliasByCode[code] || name.replace(/\s*\([^)]*\)/g, '').trim());
      } catch {}
    }
    if (!names?.length) names = ['United States', 'China', 'India', 'Brazil', 'Japan', 'Nigeria', 'France', 'Italy', 'Canada', 'Australia'];
    const answer = names[state.fallbackIndex % names.length];
    state.fallbackIndex++;
    try { localStorage.setItem('cazie_flag_fallback_index', String(state.fallbackIndex)); } catch {}
    return answer;
  }

  function svgMarkupToPixels(markup) {
    return new Promise((resolve, reject) => {
      const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const root = parsed.documentElement;
      const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
        root.setAttribute('width', String(viewBox[2]));
        root.setAttribute('height', String(viewBox[3]));
        root.setAttribute('preserveAspectRatio', 'none');
        markup = new XMLSerializer().serializeToString(root);
      }
      const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const width = 120;
          const height = 80;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
          // The updated game uses a 900×600 (3:2) viewBox. Keep that shape
          // instead of squeezing flags into a square, which changes stripes,
          // crosses, and emblems enough to produce false matches.
          ctx.drawImage(image, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve(ctx.getImageData(0, 0, width, height).data);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterize a flag SVG.')); };
      image.src = url;
    });
  }

  function pixelsForSvg(markup) {
    let cached = state.pixelCache.get(markup);
    if (!cached) {
      cached = svgMarkupToPixels(markup);
      state.pixelCache.set(markup, cached);
    }
    return cached;
  }

  function rectFeatures(markup) {
    let cached = state.rectCache.get(markup);
    if (cached) return cached;
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = parsed.documentElement;
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
    if (viewBox?.length !== 4 || !(viewBox[2] > 0 && viewBox[3] > 0)) return [];
    const [minX, minY, vbWidth, vbHeight] = viewBox;
    const dimension = (value, total, fallback = 0) => {
      if (value == null || value === '') return fallback;
      const number = Number.parseFloat(value);
      if (!Number.isFinite(number)) return fallback;
      return value.trim().endsWith('%') ? number / 100 * total : number;
    };
    const color = (value) => {
      const fill = (value || '').trim().toLowerCase();
      const names = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00' };
      const normalized = names[fill] || fill;
      const shortHex = normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
      if (shortHex) return shortHex.slice(1).map((part) => parseInt(part + part, 16));
      const hex = normalized.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (hex) return hex.slice(1).map((part) => parseInt(part, 16));
      const rgb = normalized.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      return rgb ? rgb.slice(1).map(Number) : null;
    };
    cached = [...root.querySelectorAll('rect')].map((rect) => {
      const styleFill = rect.getAttribute('style')?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1];
      const rgb = color(rect.getAttribute('fill') || styleFill || '');
      const x = dimension(rect.getAttribute('x'), vbWidth, 0);
      const y = dimension(rect.getAttribute('y'), vbHeight, 0);
      const width = dimension(rect.getAttribute('width'), vbWidth, 0);
      const height = dimension(rect.getAttribute('height'), vbHeight, 0);
      if (!rgb || width <= 0 || height <= 0) return null;
      return {
        x: (x - minX) / vbWidth, y: (y - minY) / vbHeight,
        width: width / vbWidth, height: height / vbHeight, rgb,
      };
    }).filter(Boolean);
    state.rectCache.set(markup, cached);
    return cached;
  }

  function compareRectGeometry(targetRects, candidateRects) {
    if (targetRects.length < 2 || candidateRects.length < 2 ||
        Math.max(targetRects.length, candidateRects.length) / Math.min(targetRects.length, candidateRects.length) > 3) return null;
    const pairs = [];
    targetRects.forEach((target, targetIndex) => candidateRects.forEach((candidate, candidateIndex) => {
      const geometry = (Math.abs(target.x - candidate.x) + Math.abs(target.y - candidate.y) +
        Math.abs(target.width - candidate.width) + Math.abs(target.height - candidate.height)) / 4;
      const color = Math.sqrt(target.rgb.reduce((sum, channel, index) => sum + (channel - candidate.rgb[index]) ** 2, 0)) / 441.673;
      pairs.push({ targetIndex, candidateIndex, error: (geometry * 0.6 + color * 0.4) * 100 });
    }));
    pairs.sort((a, b) => a.error - b.error);
    const usedTargets = new Set();
    const usedCandidates = new Set();
    let total = 0;
    let matched = 0;
    for (const pair of pairs) {
      if (usedTargets.has(pair.targetIndex) || usedCandidates.has(pair.candidateIndex)) continue;
      usedTargets.add(pair.targetIndex);
      usedCandidates.add(pair.candidateIndex);
      total += pair.error;
      matched++;
      if (matched === Math.min(targetRects.length, candidateRects.length)) break;
    }
    const countPenalty = Math.abs(targetRects.length - candidateRects.length) / Math.max(targetRects.length, candidateRects.length) * 30;
    return (total / Math.max(1, matched)) * (matched / Math.max(targetRects.length, candidateRects.length)) + countPenalty;
  }

  function compareFlagPixels(target, candidate) {
    const width = 120;
    const height = 80;
    let colorDistance = 0;
    let edgeDistance = 0;
    let edgeSamples = 0;
    const luminance = (pixels, index) => 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const dr = target[index] - candidate[index];
        const dg = target[index + 1] - candidate[index + 1];
        const db = target[index + 2] - candidate[index + 2];
        // Euclidean RGB distance is less sensitive to one channel dominating
        // than the former sum of absolute channel errors.
        colorDistance += Math.sqrt(dr * dr + dg * dg + db * db) / 441.673;

        if (x + 1 < width) {
          const right = index + 4;
          edgeDistance += Math.abs(
            (luminance(target, index) - luminance(target, right)) -
            (luminance(candidate, index) - luminance(candidate, right))
          ) / 510;
          edgeSamples++;
        }
        if (y + 1 < height) {
          const below = index + width * 4;
          edgeDistance += Math.abs(
            (luminance(target, index) - luminance(target, below)) -
            (luminance(candidate, index) - luminance(candidate, below))
          ) / 510;
          edgeSamples++;
        }
      }
    }

    const colorError = colorDistance / (width * height) * 100;
    const patternError = edgeSamples ? edgeDistance / edgeSamples * 100 : 100;
    return colorError * 0.82 + patternError * 0.18;
  }

  function recognizeSimpleRectFlag(svg) {
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
    if (viewBox?.length !== 4 || !(viewBox[2] > 0 && viewBox[3] > 0)) return null;
    const [minX, minY, width, height] = viewBox;
    const rects = [...svg.querySelectorAll('rect')].map((rect) => {
      const styleFill = rect.getAttribute('style')?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1];
      const fill = (rect.getAttribute('fill') || styleFill || '').trim().toLowerCase();
      const numeric = (name, fallback) => {
        const raw = rect.getAttribute(name);
        const value = raw == null ? fallback : Number.parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
      };
      return {
        x: numeric('x', minX), y: numeric('y', minY),
        width: numeric('width', width), height: numeric('height', height), fill,
      };
    });
    const fullField = rects.find((rect) =>
      rect.x <= minX + width * 0.01 && rect.y <= minY + height * 0.01 &&
      rect.width >= width * 0.98 && rect.height >= height * 0.98 &&
      (rect.fill === '#d52b1e' || rect.fill === 'red')
    );
    if (!fullField || Math.abs(width - height) > Math.max(width, height) * 0.04) return null;
    const white = (fill) => fill === '#fff' || fill === '#ffffff' || fill === 'white';
    const centered = (value, size, center) => Math.abs((value + size / 2) - center) <= Math.max(width, height) * 0.025;
    const vertical = rects.some((rect) => white(rect.fill) &&
      centered(rect.x, rect.width, minX + width / 2) && centered(rect.y, rect.height, minY + height / 2) &&
      rect.width / width >= 0.12 && rect.width / width <= 0.20 && rect.height / height >= 0.50 && rect.height / height <= 0.70
    );
    const horizontal = rects.some((rect) => white(rect.fill) &&
      centered(rect.x, rect.width, minX + width / 2) && centered(rect.y, rect.height, minY + height / 2) &&
      rect.width / width >= 0.50 && rect.width / width <= 0.70 && rect.height / height >= 0.12 && rect.height / height <= 0.20
    );
    return vertical && horizontal ? 'Switzerland' : null;
  }

  function findDisplayedFlagSvg() {
    const flagFrame = [...document.querySelectorAll('div')].find((el) =>
      typeof el.className === 'string' && el.className.includes('aspect-3/2') && el.className.includes('max-w-[280px]') && el.querySelector('svg, img')
    );
    const visibleSvgs = [...document.querySelectorAll('svg[viewBox]')].filter((el) => {
      if (el.closest('#cazie-flag-helper')) return false;
      if (!el.getClientRects().length) return false;
      const viewBox = el.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      if (viewBox?.length !== 4 || !(viewBox[2] > 0 && viewBox[3] > 0)) return false;
      const cls = typeof el.className?.baseVal === 'string' ? el.className.baseVal : String(el.getAttribute('class') || '');
      if (/lucide|icon/i.test(cls)) return false;
      return true;
    });
    const inFlagFrame = flagFrame ? visibleSvgs.filter((el) => flagFrame.contains(el)) : [];
    // The updated chat challenge renders its flag in a 900×600 SVG inside the
    // bot message. Prefer that shape so chat avatars and interface icons cannot
    // be mistaken for the displayed flag.
    const exactChatFlags = visibleSvgs.filter((el) => {
      const vb = el.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      return vb?.length === 4 && vb[0] === 0 && vb[1] === 0 && vb[2] === 900 && vb[3] === 600;
    });
    const chatWrapperFlags = visibleSvgs.filter((el) => {
      const wrapper = el.parentElement;
      const rect = el.getBoundingClientRect();
      const viewBox = el.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      const isFlagShape = viewBox?.length === 4 && viewBox[2] / viewBox[3] >= 0.8 && viewBox[2] / viewBox[3] <= 1.6;
      return wrapper?.classList.contains('select-none') && wrapper.classList.contains('overflow-hidden') &&
        isFlagShape && rect.width >= 100 && rect.height >= 80 && el.querySelector('rect,path,circle,polygon,ellipse,line');
    });
    // Chat history retains old flags. Use the newest matching message SVG,
    // never the first historical match, or every answer can repeat the prior flag.
    const candidates = [...new Set([...exactChatFlags, ...chatWrapperFlags, ...inFlagFrame])]
      .sort((a, b) => {
        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
    const svg = candidates.at(-1) || visibleSvgs
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= 100 && rect.height >= 80)
      .sort((a, b) => {
        const position = a.el.compareDocumentPosition(b.el);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      })
      .at(-1)?.el;
    if (!svg) throw new Error('Could not find the displayed flag SVG.');
    return svg;
  }

  function pixelPreview(pixels) {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 120, 80), 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function recognizeFlag() {
    const svg = findDisplayedFlagSvg();
    const markup = svg.outerHTML;
    const fingerprint = fingerprintMarkup(markup);
    const target = await svgMarkupToPixels(markup);
    const preview = pixelPreview(target);
    const simpleShapeAnswer = recognizeSimpleRectFlag(svg);
    if (simpleShapeAnswer) {
      return { name: simpleShapeAnswer, confidence: 99, error: 1, ambiguous: false, alternatives: [], fingerprint, preview };
    }
    const targetRects = rectFeatures(markup);
    const refs = await loadCatalog();
    const scores = [];
    for (const ref of refs) {
      let bestError = Infinity;
      for (const variant of ref.variants) {
        try {
          const pixels = await pixelsForSvg(variant);
          let error = compareFlagPixels(target, pixels);
          const rectError = compareRectGeometry(targetRects, rectFeatures(variant));
          // Rect-level color and placement helps when the game builds flags
          // from many colored rectangles. Keep raster comparison dominant so
          // path-based artwork (stars, crescents, coats of arms) still counts.
          if (rectError !== null) error = error * 0.85 + rectError * 0.15;
          bestError = Math.min(bestError, error);
        } catch {}
      }
      if (Number.isFinite(bestError)) scores.push({ name: ref.name, error: bestError });
    }
    scores.sort((a, b) => a.error - b.error);
    const best = scores[0];
    if (!best) throw new Error('Could not compare this flag with the available references.');
    const runnerUp = scores[1];
    const similarity = Math.max(0, Math.round(100 - best.error));
    const ambiguous = best.error > 18 || (runnerUp && runnerUp.error - best.error < 2.5);
    const alternatives = scores.slice(1, 3).map((score) => ({
      name: score.name,
      confidence: Math.max(0, Math.round(100 - score.error)),
    }));
    return { name: best.name, confidence: similarity, error: best.error, ambiguous, alternatives, fingerprint, preview };
  }

  function stopWithMessage(message) {
    state.running = false;
    state.autoStopped = true;
    $('[data-start]').disabled = false;
    $('[data-pause]').disabled = true;
    status(message);
  }

  function fingerprintMarkup(markup) {
    let hash = 2166136261;
    for (let i = 0; i < markup.length; i++) {
      hash ^= markup.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  async function run() {
    if (state.busy || !state.running) return;
    state.busy = true;
    try {
      while (state.running) {
        if (!isChallenge()) { status('Open the Country Flag Challenge to begin.'); await delay(); continue; }
        const input = await waitFor(() => {
          const el = findAnswerInput();
          return el && !el.disabled && el.getClientRects().length > 0 ? el : null;
        });
        if (!input) break;
        let fingerprint = '';
        try { fingerprint = fingerprintMarkup(findDisplayedFlagSvg().outerHTML); } catch {}
        if (fingerprint && fingerprint === state.lastSubmittedFingerprint) {
          stopWithMessage('This flag was already submitted. Paused to prevent a repeated answer; wait for the next challenge, then click Start.');
          break;
        }
        let answer = state.queue.shift();
        if (!answer && $('[data-auto]').checked) {
          status('Recognizing the current flag…');
          let match;
          try {
            match = await recognizeFlag();
            fingerprint = match.fingerprint || fingerprint;
            answer = match.name;
            const nextGuess = match.alternatives[0]
              ? ` Next closest: ${match.alternatives[0].name} (${match.alternatives[0].confidence}%).`
              : '';
            status(`${match.ambiguous ? 'Low-confidence best match' : 'Flag match'}: ${answer} (${match.confidence}% color/pattern similarity).${nextGuess} Submitting…`);
          } catch (e) {
            answer = await fallbackAnswer();
            status(`Flag image unavailable (${e.message}). Submitting fallback guess “${answer}” and continuing…`);
          try { fingerprint ||= fingerprintMarkup(findDisplayedFlagSvg().outerHTML); } catch {}
          }
          if (!state.running) break;
        }
        if (!answer) { stopWithMessage('No answer queued. Enable recognition or add answers.'); break; }
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, answer);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: answer }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // React-controlled inputs can ignore synthetic edits on some builds.
        // Do not consume the queue or submit unless the displayed value sticks.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (input.value.trim() !== answer) {
          state.queue.unshift(answer);
          state.running = false;
          $('[data-start]').disabled = false;
          $('[data-pause]').disabled = true;
          status('Typing was blocked by the page. Click the game input once, then Start again.');
          break;
        }
        await delay();
        if (!state.running) break;
        const form = input.closest('form');
        const submit = form && [...form.querySelectorAll('button[type="submit"]')]
          .find((button) => !button.disabled);
        if (!submit || submit.disabled) {
          state.queue.unshift(answer);
          state.running = false;
          $('[data-start]').disabled = false;
          $('[data-pause]').disabled = true;
          status('The game did not accept the typed answer. Click its input once, then Start again.');
          break;
        }
        status(`Submitting “${answer}”…`);
        submit.click();
        state.lastSubmittedFingerprint = fingerprint;
        const result = await waitFor(() => {
          const text = [...document.querySelectorAll('[role="status"], .text-emerald-800, .text-rose-800, button')]
            .map((el) => el.textContent.trim()).find((t) => /correct|incorrect|right answer|wrong answer/i.test(t));
          const next = [...document.querySelectorAll('button')].find((button) => {
            const label = button.textContent.trim();
            return /^(Next Flag|Next Challenge)$/i.test(label) && !button.disabled && button.getClientRects().length > 0;
          });
          return next ? { text: text || 'Answer evaluated', next } : null;
        });
        if (!state.running) break;
        if (!result) {
          stopWithMessage('No result appeared after submission. Paused to prevent repeating the same flag. Click Start to retry manually.');
          break;
        }
        log(answer, result.text);
        status(`${result.text} Waiting ${state.delay / 1000}s before next flag.`);
        await delay();
        if (!state.running) break;
        result.next.click();
        status('Waiting for the next flag to load…');
        const nextInput = await waitFor(() => {
          const nextInput = findAnswerInput();
          return nextInput && !nextInput.disabled && nextInput.value === '' && nextInput.getClientRects().length > 0 ? nextInput : null;
        });
        if (!nextInput) {
          stopWithMessage('The next challenge did not become ready. Paused to avoid repeating the previous answer.');
          break;
        }
        state.lastSubmittedFingerprint = '';
        await delay();
      }
    } finally {
      state.busy = false;
      if (state.running) window.setTimeout(run, 1000);
    }
  }

  const flowClicks = new Map();
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.disabled;
  const buttonNamed = (name, scope = document) => [...scope.querySelectorAll('button[type="submit"],button')]
    .find((button) => visible(button) && button.textContent.trim().toLowerCase() === name.toLowerCase());
  const clickFlow = (key, button) => {
    if (!visible(button) || Date.now() - (flowClicks.get(key) || 0) < 5000) return false;
    flowClicks.set(key, Date.now());
    button.click();
    return true;
  };

  function autoNavigate() {
    if (document.visibilityState === 'hidden') return;

    // Authentication stays entirely user-controlled. Never fill forms, click
    // sign-in/activation controls, refresh, or retry authentication.
    const authForm = document.querySelector('input[type="password"], input[placeholder*="CAZIE-"], input[maxlength="14"]');
    if (authForm && authForm.getClientRects().length > 0) {
      if (state.running) {
        state.running = false;
        $('[data-start]').disabled = false;
        $('[data-pause]').disabled = true;
      }
      status('Sign in or activate the account manually. The helper will start after the dashboard opens.');
      return;
    }

    if (isChallenge()) {
      if (state.autoStopped || state.userPaused) return;
      if (!state.running) {
        state.running = true;
        $('[data-start]').disabled = true;
        $('[data-pause]').disabled = false;
        status('Flag challenge found. Auto-answering…');
        run();
      }
      return;
    }

    const flagTitle = [...document.querySelectorAll('h3')]
      .find((el) => el.textContent.trim().toLowerCase() === 'guess the flags');
    if (flagTitle) {
      let card = flagTitle;
      for (let i = 0; i < 8 && card && !buttonNamed('Start Earning', card); i++) card = card.parentElement;
      const start = card && buttonNamed('Start Earning', card);
      if (start && clickFlow('start-flags', start)) status('Opening Guess the Flags…');
      return;
    }

    // The signed-in app marks the selected sidebar entry with this class.
    // Start the game only when Dashboard is the active view.
    const dashboard = buttonNamed('Dashboard');
    const dashboardActive = dashboard && dashboard.className.includes('bg-[#FCDCE4]');
    if (!dashboardActive) return;
    const categories = buttonNamed('Categories');
    if (categories && clickFlow('categories', categories)) status('Opening Categories to start Guess the Flags…');
  }
  $('[data-delay]').addEventListener('change', (e) => {
    state.delay = Math.max(1000, Math.min(120000, (Number(e.target.value) || 1) * 1000));
    e.target.value = String(state.delay / 1000);
  });
  $('[data-start]').addEventListener('click', () => {
    state.queue = $('[data-answers]').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    state.autoStopped = false;
    state.lastSubmittedFingerprint = '';
    state.running = true;
    state.userPaused = false;
    $('[data-start]').disabled = true;
    $('[data-pause]').disabled = false;
    status(state.queue.length ? `${state.queue.length} queued answer(s). Starting…` : 'Starting flag recognition…');
    run();
  });
  function pauseAnswering() {
    state.running = false;
    state.userPaused = true;
    $('[data-start]').disabled = false;
    $('[data-pause]').disabled = true;
    status('Paused.');
  }
  // Capture the control click before any page-level handlers can interfere.
  panel.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-pause]')) {
      event.preventDefault();
      event.stopPropagation();
      pauseAnswering();
    }
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyP' && !event.repeat) {
      event.preventDefault();
      pauseAnswering();
    }
  }, true);
  $('[data-min]').addEventListener('click', () => panel.classList.toggle('min'));
  $('[data-scan]').addEventListener('click', async () => {
    const button = $('[data-scan]');
    button.disabled = true;
    status('Capturing the newest flag in the chat…');
    try {
      const match = await recognizeFlag();
      $('[data-scan-image]').src = match.preview;
      $('[data-scan-result]').textContent = `${match.name} — ${match.confidence}% color/pattern similarity`;
      $('[data-scan-card]').hidden = false;
      status(`Captured newest flag: ${match.name} (${match.confidence}% similarity).`);
    } catch (error) {
      status(`Flag capture failed: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
  window[KEY] = { stop: () => $('[data-pause]').click() };
  if (state.running) {
    $('[data-start]').disabled = true;
    $('[data-pause]').disabled = false;
    run();
  }
  autoNavigate();
  window.setInterval(autoNavigate, 900);
  const flowObserver = new MutationObserver(() => autoNavigate());
  flowObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
