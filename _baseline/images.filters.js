/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — images.filters.js — Filters for images.

   THIS FILE IS AN OPERATE-SUBFAMILY of the images family: it acts on
   EXISTING images, so its UI lives on the right-click-an-image menu
   ("Filters…"), not in the Add Images menus. It never touches the image
   object type itself — it decorates rendering and export through the
   onObjectRender / onBeforeObjectExport hooks. Delete this file and
   images simply render unfiltered; the filter data on objects survives.

   To remix (new filter types!): copy to images.filters.<yourname>.js,
   set basedOn: 'images.filters', append your name to authors, and add
   your primitive to the ensureImageFilter chain + a slider row.

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   DATA: obj.filters = ordered stack [{ type: 'blur'|'grain'|'fade',
   amount }], applied first-to-last. Neutral amounts (0 for blur/grain,
   50 for fade — fade is bipolar: <50 darkens, >50 lightens) are dropped
   from the stack. DISPLAY uses one composed SVG <filter> per image (CSS
   url(#…) on the <img>). EXPORT deliberately does NOT use c2d.filter =
   url(#…): Chromium's canvas-2d reference filters are unreliable
   (feComposite/feBlend named inputs can resolve empty — a fade floods the
   whole export gray and filtered images can vanish). Export repaints the
   image through drawImageWithFilters(), a canvas-native pipeline with
   identical semantics, via the onBefore/onAfterObjectExport hooks.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'images.filters',
  name: 'Filters',
  version: '2.0.0',
  authors: ['Forma Rosa Creative'],
  basedOn: 'images',
  description: 'Blur, grain and fade filter stacks on images, with live sliders.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const FILTER_NEUTRAL = { blur: 0, grain: 0, fade: 50 };
  const FTYPES = ['blur', 'grain', 'fade'];
  const filterNeutral = (type) => (type in FILTER_NEUTRAL ? FILTER_NEUTRAL[type] : 0);

  // SVG defs container (holds one <filter> per filtered image)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;';
  document.body.appendChild(defs);

  // Ordered, active-only, deduped; migrates the legacy scalar `blur`.
  function sanitizeFilters(o) {
    let flist = Array.isArray(o.filters) ? o.filters : [];
    const seenF = new Set();
    flist = flist
      .filter(f => f && FTYPES.includes(f.type))
      .map(f => {
        let amt = Number(f.amount);
        if (!isFinite(amt)) amt = filterNeutral(f.type);
        amt = f.type === 'fade' ? Math.max(0, Math.min(100, amt)) : Math.max(0, amt);
        return { type: f.type, amount: amt };
      })
      .filter(f => f.amount !== filterNeutral(f.type))
      .filter(f => (seenF.has(f.type) ? false : (seenF.add(f.type), true)));
    if (flist.length === 0 && Number(o.blur) > 0) flist = [{ type: 'blur', amount: Math.max(0, Number(o.blur)) }];
    o.filters = flist;
    delete o.blur; // legacy scalar, folded into filters
  }

  function activeFilters(obj) {
    return Array.isArray(obj.filters) ? obj.filters.filter(f => f && f.amount !== filterNeutral(f.type)) : [];
  }

  // EXPORT-SAFE filter rendering (see the DATA note in the header): draws
  // the image onto a bounded offscreen and applies the stack in order with
  // canvas-native ops — blur = native blur() function, grain = pixel-noise
  // overlay re-masked to the current alpha, fade = alpha-clipped fill
  // (identical semantics to the display SVG's feFlood + in + over).
  function drawImageWithFilters(target, imgEl, obj, srcRect, dx, dy, dw, dh, scale) {
    const list = activeFilters(obj);
    const blurTotal = list.filter(f => f.type === 'blur').reduce((a, f) => a + f.amount * scale, 0);
    const pad = Math.ceil(blurTotal * 3); // room for the blur halo
    const W = Math.max(1, Math.ceil(dw + pad * 2));
    const H = Math.max(1, Math.ceil(dh + pad * 2));
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d');
    if (srcRect) o.drawImage(imgEl, srcRect.x, srcRect.y, srcRect.w, srcRect.h, pad, pad, dw, dh);
    else o.drawImage(imgEl, pad, pad, dw, dh);
    for (const f of list) {
      if (f.type === 'blur') {
        // Re-rasterize through the native blur() (matches feGaussianBlur)
        const snap = document.createElement('canvas');
        snap.width = W; snap.height = H;
        snap.getContext('2d').drawImage(off, 0, 0);
        o.save();
        o.clearRect(0, 0, W, H);
        o.filter = `blur(${(f.amount * scale).toFixed(2)}px)`;
        o.drawImage(snap, 0, 0);
        o.restore();
      } else if (f.type === 'grain') {
        // Gray noise centred on 128 with contrast k, overlay-blended,
        // then re-masked to the running alpha (same curve as display).
        const k = Math.min(1, (f.amount / 100) * 0.6);
        const snap = document.createElement('canvas');
        snap.width = W; snap.height = H;
        snap.getContext('2d').drawImage(off, 0, 0);
        const gs = Math.max(1, Math.round(scale)); // grain size tracks export scale
        const NW = Math.max(1, Math.ceil(W / gs)), NH = Math.max(1, Math.ceil(H / gs));
        const noise = document.createElement('canvas');
        noise.width = NW; noise.height = NH;
        const nctx = noise.getContext('2d');
        const idata = nctx.createImageData(NW, NH);
        const d = idata.data;
        for (let p = 0; p < d.length; p += 4) {
          const v = Math.round(128 + (Math.random() - 0.5) * 255 * k);
          d[p] = d[p + 1] = d[p + 2] = v;
          d[p + 3] = 255;
        }
        nctx.putImageData(idata, 0, 0);
        o.globalCompositeOperation = 'overlay';
        o.imageSmoothingEnabled = false;
        o.drawImage(noise, 0, 0, NW, NH, 0, 0, NW * gs, NH * gs);
        o.imageSmoothingEnabled = true;
        o.globalCompositeOperation = 'destination-in';
        o.drawImage(snap, 0, 0);
        o.globalCompositeOperation = 'source-over';
      } else if (f.type === 'fade') {
        // Bipolar tint clipped to the image alpha
        const op = Math.abs(f.amount - 50) / 50;
        o.globalCompositeOperation = 'source-atop';
        o.fillStyle = f.amount < 50 ? `rgba(0,0,0,${op.toFixed(4)})` : `rgba(255,255,255,${op.toFixed(4)})`;
        o.fillRect(0, 0, W, H);
        o.globalCompositeOperation = 'source-over';
      }
    }
    target.drawImage(off, dx - pad, dy - pad);
  }

  // Build/refresh the composed <filter> for an image; returns `url(#id)`
  // or '' when inactive. `scale` grows pixel sizes for the 2x export;
  // `suffix` keeps display and export defs separate.
  function ensureImageFilter(obj, scale, suffix) {
    const fid = `imgfx-${obj.id}${suffix || ''}`;
    let filterEl = document.getElementById(fid);
    const list = activeFilters(obj);
    if (list.length === 0) { if (filterEl) filterEl.remove(); return ''; }
    const s = scale || 1;
    if (!filterEl) {
      filterEl = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filterEl.setAttribute('id', fid);
      defs.appendChild(filterEl);
    }
    filterEl.setAttribute('x', '-20%'); filterEl.setAttribute('y', '-20%');
    filterEl.setAttribute('width', '140%'); filterEl.setAttribute('height', '140%');
    filterEl.setAttribute('color-interpolation-filters', 'sRGB');
    let inp = 'SourceGraphic', html = '';
    list.forEach((f, i) => {
      const out = `fx${i}`;
      if (f.type === 'blur') {
        html += `<feGaussianBlur in="${inp}" stdDeviation="${(f.amount * s).toFixed(2)}" result="${out}"/>`;
      } else if (f.type === 'grain') {
        // Monochrome film grain: turbulence → gray noise centred on 0.5
        // with contrast k (= intensity) → overlay-blended onto the result.
        const k = Math.min(1, (f.amount / 100) * 0.6);
        const off = (0.5 * (1 - k)).toFixed(4);
        const freq = (0.9 / s).toFixed(3);
        html += `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${obj.id}" stitchTiles="stitch" result="gnR${i}"/>`;
        html += `<feColorMatrix in="gnR${i}" type="matrix" values="${k} 0 0 0 ${off} ${k} 0 0 0 ${off} ${k} 0 0 0 ${off} 0 0 0 0 1" result="gnG${i}"/>`;
        html += `<feBlend in="${inp}" in2="gnG${i}" mode="overlay" result="${out}"/>`;
      } else if (f.type === 'fade') {
        // Bipolar tint: 50 = neutral; below → black overlay, above → white,
        // opacity |amount-50|/50, clipped to the image's alpha.
        const v = f.amount;
        const color = v < 50 ? '#000000' : '#ffffff';
        const op = (Math.abs(v - 50) / 50).toFixed(4);
        html += `<feFlood flood-color="${color}" flood-opacity="${op}" result="fdF${i}"/>`;
        html += `<feComposite in="fdF${i}" in2="${inp}" operator="in" result="fdC${i}"/>`;
        html += `<feComposite in="fdC${i}" in2="${inp}" operator="over" result="${out}"/>`;
      } else {
        html += `<feOffset in="${inp}" dx="0" dy="0" result="${out}"/>`;
      }
      inp = out;
    });
    filterEl.innerHTML = html;
    return `url(#${fid})`;
  }

  // Apply the display filter to an image element (also the live preview).
  function applyImageFilters(obj, img) {
    const el = img || ctx.worldEl.querySelector(`.canvas-obj[data-id="${obj.id}"] img`);
    if (el) el.style.filter = ensureImageFilter(obj, 1, '');
  }

  // ── The sliders panel (exact layout/values of the original) ─────────
  const panel = document.createElement('div');
  panel.className = 'img-filter-panel';
  panel.innerHTML = `
    <div class="fp-title"><span>Filters</span><button class="fp-reset" title="Clear all filters on the selected image(s)">Reset</button></div>
    <div class="fp-row">
      <div class="fp-head"><span>Blur</span><span class="fp-val" data-val="blur">0</span></div>
      <input type="range" data-filter="blur" min="0" max="20" step="0.5" value="0">
    </div>
    <div class="fp-row">
      <div class="fp-head"><span>Grain</span><span class="fp-val" data-val="grain">0</span></div>
      <input type="range" data-filter="grain" min="0" max="100" step="1" value="0">
    </div>
    <div class="fp-row">
      <div class="fp-head"><span>Fade</span><span class="fp-val" data-val="fade">50</span></div>
      <input type="range" data-filter="fade" min="0" max="100" step="1" value="50">
    </div>
    <div class="fp-order">No filters applied</div>
  `;
  document.body.appendChild(panel);
  const sliders = {};
  const vals = {};
  panel.querySelectorAll('input[type=range]').forEach(inp => { sliders[inp.dataset.filter] = inp; });
  panel.querySelectorAll('.fp-val').forEach(v => { vals[v.dataset.val] = v; });
  const fpOrder = panel.querySelector('.fp-order');
  const fpReset = panel.querySelector('.fp-reset');
  let filterUndoTimer = null;

  function selectedImages() {
    return [...ctx.selectedIds].map(id => ctx.findObject(id)).filter(o => o && o.type === 'image');
  }

  // Add/update/remove a filter, preserving insertion order; neutral drops.
  function setFilterOnObj(o, type, amount) {
    if (!Array.isArray(o.filters)) o.filters = [];
    const idx = o.filters.findIndex(f => f.type === type);
    if (amount !== filterNeutral(type)) {
      if (idx >= 0) o.filters[idx].amount = amount;   // keep its place in the stack
      else o.filters.push({ type, amount });          // newly set → top (applied last)
    } else if (idx >= 0) {
      o.filters.splice(idx, 1);                        // back to neutral → drop
    }
  }

  function fpAmount(o, type) {
    const f = (o.filters || []).find(x => x.type === type);
    return f ? f.amount : filterNeutral(type);
  }

  function updateOrderLabel(o) {
    const list = activeFilters(o);
    fpOrder.innerHTML = list.length
      ? 'Order: <b>' + list.map(f => f.type).join('</b> &rarr; <b>') + '</b>'
      : 'No filters applied';
  }

  // Live slider → every selected image; undo coalesced per drag.
  function onFilterSlider(type, amount) {
    const imgs = selectedImages();
    if (imgs.length === 0) return;
    if (!filterUndoTimer) ctx.pushUndo();
    clearTimeout(filterUndoTimer);
    filterUndoTimer = setTimeout(() => { filterUndoTimer = null; }, 600);
    for (const o of imgs) { setFilterOnObj(o, type, amount); applyImageFilters(o); }
    updateOrderLabel(imgs[0]);
    ctx.markDirty();
  }

  for (const type of FTYPES) {
    sliders[type].addEventListener('input', () => {
      vals[type].textContent = (+sliders[type].value).toString();
      onFilterSlider(type, +sliders[type].value);
    });
  }

  function resetSliders() {
    for (const type of FTYPES) {
      sliders[type].value = filterNeutral(type);
      vals[type].textContent = (+sliders[type].value).toString();
    }
  }

  fpReset.addEventListener('click', () => {
    const imgs = selectedImages();
    if (imgs.length === 0) return;
    if (!imgs.some(o => activeFilters(o).length > 0)) { resetSliders(); return; }
    filterUndoTimer = null; // end any in-progress slider undo group
    ctx.pushUndo();
    for (const o of imgs) { o.filters = []; applyImageFilters(o); }
    resetSliders();
    if (imgs[0]) updateOrderLabel(imgs[0]);
    ctx.markDirty();
  });

  function showPanel(anchorRect) {
    const imgs = selectedImages();
    if (imgs.length === 0) return;
    ctx.closeMenus();
    const primary = imgs[0]; // sliders reflect the first selected image
    for (const type of FTYPES) {
      sliders[type].value = fpAmount(primary, type);
      vals[type].textContent = (+sliders[type].value).toString();
    }
    updateOrderLabel(primary);
    panel.classList.add('visible');
    let x = anchorRect.right + 4, y = anchorRect.top;
    if (x + 230 > window.innerWidth) x = window.innerWidth - 234;
    if (y + 170 > window.innerHeight) y = window.innerHeight - 174;
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }
  function hidePanel() { panel.classList.remove('visible'); }
  document.addEventListener('mousedown', (e) => {
    if (panel.classList.contains('visible') && !panel.contains(e.target)) hidePanel();
  });

  return {
    // ── STYLES ── (exact values from the original app)
    css: `
      .img-filter-panel {
        display: none;
        position: fixed;
        background: #2a2a2a;
        border: 1px solid #3a3a3a;
        border-radius: 8px;
        padding: 14px;
        z-index: 2001;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        width: 230px;
        font-family: var(--font-sans);
      }
      .img-filter-panel.visible { display: block; }
      .img-filter-panel .fp-title { color: #eee; font-size: 13px; font-weight: 600; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .img-filter-panel .fp-reset {
        background: none; border: none; cursor: pointer;
        color: #888; font-family: var(--font-sans); font-size: 11px; font-weight: 500;
        padding: 2px 4px; border-radius: 3px; transition: color 0.12s;
      }
      .img-filter-panel .fp-reset:hover { color: #F0C4A0; }
      .img-filter-panel .fp-row { margin-bottom: 12px; }
      .img-filter-panel .fp-head { display: flex; justify-content: space-between; font-size: 12px; color: #bbb; margin-bottom: 5px; }
      .img-filter-panel .fp-val { color: #F0C4A0; font-variant-numeric: tabular-nums; }
      .img-filter-panel input[type=range] {
        width: 100%; height: 4px; -webkit-appearance: none; appearance: none;
        background: #444; border-radius: 2px; outline: none; cursor: pointer; accent-color: #F0C4A0;
      }
      .img-filter-panel input[type=range]::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
        background: #F0C4A0; cursor: pointer; border: none;
      }
      .img-filter-panel .fp-order { font-size: 11px; color: #777; margin-top: 4px; border-top: 1px solid #3a3a3a; padding-top: 8px; }
      .img-filter-panel .fp-order b { color: #aaa; font-weight: 600; }
    `,

    // ── MENUS ── "Filters…" on the image right-click menu (after the
    // owner's Crop / Remove White Background section)
    objectMenus: {
      image: [
        {
          label: 'Filters…',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
          order: 30,
          action(ctx, e) {
            const r = e && e.target ? e.target.getBoundingClientRect() : { right: window.innerWidth / 2, top: window.innerHeight / 2 };
            showPanel(r);
          },
        },
      ],
    },

    // ── DECORATORS ── apply the filter chain wherever images appear
    onObjectRender(obj, el) {
      if (obj.type !== 'image') return;
      const img = el.querySelector('img');
      if (img) img.style.filter = ensureImageFilter(obj, 1, '');
    },
    // EXPORT: hide the images tool's own draw (alpha 0), then repaint the
    // image through the export-safe canvas-native pipeline. Never uses
    // c2d.filter = url(#…) — see the header's DATA note.
    onBeforeObjectExport(c2d, obj, t, ctx) {
      if (obj.type !== 'image' || activeFilters(obj).length === 0) return;
      c2d.save();
      c2d.globalAlpha = 0; // the unfiltered exportDraw becomes invisible
    },
    onAfterObjectExport(c2d, obj, t, ctx) {
      if (obj.type !== 'image' || activeFilters(obj).length === 0) return;
      c2d.restore();
      const imgEl = ctx.worldEl.querySelector(`.canvas-obj[data-id="${obj.id}"] img`);
      if (!imgEl || !imgEl.complete || !imgEl.naturalWidth) return;
      try {
        const srcRect = obj.crop ? {
          x: (obj.crop.x / 100) * imgEl.naturalWidth,
          y: (obj.crop.y / 100) * imgEl.naturalHeight,
          w: (obj.crop.w / 100) * imgEl.naturalWidth,
          h: (obj.crop.h / 100) * imgEl.naturalHeight,
        } : null;
        drawImageWithFilters(c2d, imgEl, obj, srcRect, t.x, t.y, obj.w * t.scaleX, obj.h * t.scaleY, t.scaleX);
      } catch (_) { /* decode/cross-origin issue: leave unfiltered spot empty */ }
    },

    // Sanitize filter stacks on load (incl. the legacy `blur` scalar)
    onReady(ctx) {
      for (const o of ctx.objects) {
        if (o.type === 'image') sanitizeFilters(o);
      }
    },
  };
}
