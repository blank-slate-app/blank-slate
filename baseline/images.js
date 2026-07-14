/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — images.js — the Add Images family.

   BASELINE TOOL — the images FAMILY ROOT. It owns the 'image' object type
   (rendering, the crop system, white-background removal) and the standard
   Add Image flow. Edit freely — a pristine copy lives in ../baseline/.

   SUBFAMILIES live in their own files with basedOn: 'images':
   - ADD-forks (they add images) contribute to the 'Add Images' family
     menus — see images.hires.js, the canonical example.
   - OPERATE-subfamilies (they act on existing images, e.g. filters)
     contribute to the right-click-an-image menu instead, via
     objectMenus: { image: [...] } — see AGENTS.md.

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   OBJECT: type 'image' — { content: asset path, crop: {x,y,w,h}|null }.
   crop is ALWAYS percentages (0-100) of the FULL image. The full image's
   display size is derived from the crop fractions (never stored), and
   the box aspect self-heals to the crop region's aspect on load — so
   outlines always hug the image exactly (moodboard alignment).

   CROP MODE (double-click an image): the frame stays FIXED on the canvas;
   dragging slides the image behind it. Corner handles resize the frame
   (Shift locks ratio). Enter/Apply commits, Esc/Cancel exits, Reset
   restores the full image in place.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'images',
  name: 'Add Images',
  version: '2.0.0',
  authors: ['santi'],
  basedOn: null,
  description: 'Import, drop and paste images; crop to formats; remove white backgrounds.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const IMG_ICON_24 = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  const IMG_ICON_14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  const CROP_ICON_14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
  const NOBG_ICON_14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

  let shouldResize = false;   // the Crop submenu's "Resize" checkbox state
  let cropState = null;       // { objId, fullW, fullH, ix, iy, rx, ry, rw, rh }

  // ── Crop model helpers (crop = % of the FULL image, always) ─────────
  function fullImageSize(obj) {
    if (!obj.crop) return { w: obj.w, h: obj.h };
    return { w: obj.w / (obj.crop.w / 100), h: obj.h / (obj.crop.h / 100) };
  }

  function resetImageCrop(obj) {
    if (!obj.crop) return;
    const full = fullImageSize(obj);
    obj.x -= (obj.crop.x / 100) * full.w;
    obj.y -= (obj.crop.y / 100) * full.h;
    obj.w = full.w;
    obj.h = full.h;
    obj.crop = null;
  }

  function applyImageCropStyles(obj, img) {
    if (obj.crop) {
      img.className = 'cropped';
      const sx = 100 / obj.crop.w, sy = 100 / obj.crop.h;
      img.style.width = (sx * 100) + '%';
      img.style.height = (sy * 100) + '%';
      img.style.left = -(obj.crop.x * sx) + '%';
      img.style.top = -(obj.crop.y * sy) + '%';
    } else {
      img.className = 'uncropped';
      img.style.width = ''; img.style.height = '';
      img.style.left = ''; img.style.top = '';
    }
  }

  // Box aspect must equal the visible crop-region aspect, or outlines
  // don't hug the image. Self-heals legacy/imported data on image load.
  function healImageAspect(obj, img) {
    if (!img.naturalWidth || !img.naturalHeight) return;
    if (!ctx.objects.includes(obj)) return;
    const c = obj.crop;
    const regionAspect = c
      ? ((c.w / 100) * img.naturalWidth) / ((c.h / 100) * img.naturalHeight)
      : img.naturalWidth / img.naturalHeight;
    if (!isFinite(regionAspect) || regionAspect <= 0) return;
    const boxAspect = obj.w / obj.h;
    if (Math.abs(boxAspect - regionAspect) / regionAspect > 0.005) {
      obj.h = Math.round(obj.w / regionAspect);
      const el = ctx.worldEl.querySelector(`[data-id="${obj.id}"]`);
      if (el) el.style.height = obj.h + 'px';
      ctx.markDirty();
    }
  }

  // ── Adding images ────────────────────────────────────────────────────
  function capStandard(w, h) {
    if (w > 600) { const s = 600 / w; w = 600; h = Math.round(h * s); }
    if (h > 500) { const s = 500 / h; h = Math.round(h * s); w = Math.round(w * s); }
    return { w, h };
  }

  async function addImages(wx, wy) {
    const results = await ctx.io.importImages({ hiRes: false });
    if (!results || results.length === 0) return;
    ctx.pushUndo();
    const center = (wx !== undefined) ? { x: wx, y: wy } : ctx.viewportCenter();
    let last = null;
    results.forEach((r, i) => {
      if (!r || r.error || !r.assetPath) return;
      const { w, h } = capStandard(r.width, r.height);
      last = ctx.createObject({
        type: 'image',
        x: center.x - w / 2 + i * 30, y: center.y - h / 2 + i * 30,
        w, h, content: r.assetPath,
      });
    });
    if (last) ctx.selectObject(last.id);
    ctx.renderObjects();
    ctx.markDirty();
  }

  // Drag & drop image files onto the canvas (30px stagger, like the original)
  ctx.viewportEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  ctx.viewportEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const center = ctx.viewportCenter();
    ctx.pushUndo();
    let count = 0, last = null;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      let filePath;
      try { filePath = ctx.io.getFilePath(file); } catch (_) {}
      if (!filePath) continue;
      const result = await ctx.io.dropImage(filePath);
      if (!result || !result.assetPath) continue;
      const { w, h } = capStandard(result.width, result.height);
      last = ctx.createObject({
        type: 'image',
        x: center.x - w / 2 + count * 30,
        y: center.y - h / 2 + count * 30,
        w, h, content: result.assetPath,
      });
      count++;
    }
    if (last) { ctx.selectObject(last.id); ctx.renderObjects(); ctx.markDirty(); }
  });

  // ── Inline crop (frame fixed on canvas; image slides behind it) ─────
  const cropBar = document.createElement('div');
  cropBar.className = 'img-crop-bar';
  cropBar.innerHTML = `
    <span>Crop</span>
    <button class="crop-apply">Apply</button>
    <button class="crop-reset">Reset</button>
    <button class="crop-cancel">Cancel</button>
  `;
  document.body.appendChild(cropBar);
  const cropApplyBtn = cropBar.querySelector('.crop-apply');
  const cropResetBtn = cropBar.querySelector('.crop-reset');
  const cropCancelBtn = cropBar.querySelector('.crop-cancel');

  function openInlineCrop(obj) {
    if (cropState) {
      if (cropState.objId === obj.id) return;
      closeCrop();
    }
    const el = ctx.worldEl.querySelector(`[data-id="${obj.id}"]`);
    if (!el) return;

    ctx.selectObject(obj.id);
    el.classList.add('cropping');
    el.classList.remove('selected');

    const wrapper = el.querySelector('.img-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    const src = ctx.io.assetUrl(obj.content);

    const fullImg = document.createElement('img');
    fullImg.src = src;
    fullImg.className = 'crop-full-img';
    fullImg.draggable = false;
    wrapper.appendChild(fullImg);

    const cRect = document.createElement('div');
    cRect.className = 'crop-rect';
    wrapper.appendChild(cRect);

    const clipDiv = document.createElement('div');
    clipDiv.className = 'crop-img-clip';
    cRect.appendChild(clipDiv);

    const cImg = document.createElement('img');
    cImg.src = src;
    cImg.draggable = false;
    clipDiv.appendChild(cImg);

    for (const pos of ['tl', 'tr', 'bl', 'br']) {
      const h = document.createElement('div');
      h.className = `crop-handle ch-${pos}`;
      h.dataset.handle = pos;
      cRect.appendChild(h);
    }

    const full = fullImageSize(obj);
    cropState = {
      objId: obj.id,
      fullW: full.w, fullH: full.h,
      ix: obj.crop ? -(obj.crop.x / 100) * full.w : 0,
      iy: obj.crop ? -(obj.crop.y / 100) * full.h : 0,
      rx: 0, ry: 0, rw: obj.w, rh: obj.h,
    };
    const S = cropState;
    cropBar.classList.add('visible');

    function updateCrop() {
      fullImg.style.left = S.ix + 'px';
      fullImg.style.top = S.iy + 'px';
      fullImg.style.width = S.fullW + 'px';
      fullImg.style.height = S.fullH + 'px';
      cRect.style.left = S.rx + 'px';
      cRect.style.top = S.ry + 'px';
      cRect.style.width = S.rw + 'px';
      cRect.style.height = S.rh + 'px';
      cImg.style.width = S.fullW + 'px';
      cImg.style.height = S.fullH + 'px';
      cImg.style.left = (S.ix - S.rx) + 'px';
      cImg.style.top = (S.iy - S.ry) + 'px';
    }
    updateCrop();

    function clampImage() {
      S.ix = Math.min(S.rx, Math.max(S.rx + S.rw - S.fullW, S.ix));
      S.iy = Math.min(S.ry, Math.max(S.ry + S.rh - S.fullH, S.iy));
    }

    // Drag anywhere (inside the frame or on the ghost) → slide the image
    wrapper.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.crop-handle') || ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const sx = ev.clientX, sy = ev.clientY;
      const oix = S.ix, oiy = S.iy;
      const zoom = ctx.getZoom();
      function onMove(mv) {
        S.ix = oix + (mv.clientX - sx) / zoom;
        S.iy = oiy + (mv.clientY - sy) / zoom;
        clampImage();
        updateCrop();
      }
      function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Handles resize the frame (free; Shift locks ratio; clamped to image)
    cRect.querySelectorAll('.crop-handle').forEach(h => {
      h.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const sx = ev.clientX, sy = ev.clientY;
        const orx = S.rx, ory = S.ry, orw = S.rw, orh = S.rh;
        const ratio = orw / orh;
        const pos = h.dataset.handle;
        const MIN = 20;
        const zoom = ctx.getZoom();
        function onMove(mv) {
          const dx = (mv.clientX - sx) / zoom, dy = (mv.clientY - sy) / zoom;
          let rx = orx, ry = ory, rw = orw, rh = orh;
          if (pos.includes('r')) rw = orw + dx;
          if (pos.includes('l')) { rx = orx + dx; rw = orw - dx; }
          if (pos.includes('b')) rh = orh + dy;
          if (pos.includes('t')) { ry = ory + dy; rh = orh - dy; }
          if (mv.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) { rh = rw / ratio; if (pos.includes('t')) ry = ory + orh - rh; }
            else { rw = rh * ratio; if (pos.includes('l')) rx = orx + orw - rw; }
          }
          if (rw < MIN) { if (pos.includes('l')) rx = orx + orw - MIN; rw = MIN; }
          if (rh < MIN) { if (pos.includes('t')) ry = ory + orh - MIN; rh = MIN; }
          if (rx < S.ix) { rw -= S.ix - rx; rx = S.ix; }
          if (ry < S.iy) { rh -= S.iy - ry; ry = S.iy; }
          if (rx + rw > S.ix + S.fullW) rw = S.ix + S.fullW - rx;
          if (ry + rh > S.iy + S.fullH) rh = S.iy + S.fullH - ry;
          S.rx = rx; S.ry = ry; S.rw = Math.max(MIN, rw); S.rh = Math.max(MIN, rh);
          updateCrop();
        }
        function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function closeCrop() {
    if (!cropState) return;
    const el = ctx.worldEl.querySelector(`[data-id="${cropState.objId}"]`);
    if (el) el.classList.remove('cropping');
    cropState = null;
    cropBar.classList.remove('visible');
    ctx.renderObjects();
  }

  cropApplyBtn.addEventListener('click', () => {
    if (!cropState) return;
    const obj = ctx.findObject(cropState.objId);
    if (!obj) { closeCrop(); return; }
    const S = cropState;
    ctx.pushUndo();
    const nx = ((S.rx - S.ix) / S.fullW) * 100;
    const ny = ((S.ry - S.iy) / S.fullH) * 100;
    const nw = (S.rw / S.fullW) * 100;
    const nh = (S.rh / S.fullH) * 100;
    if (nw >= 99.9 && nh >= 99.9) {
      obj.crop = null;
    } else {
      obj.crop = {
        x: Math.max(0, Math.min(100 - nw, nx)),
        y: Math.max(0, Math.min(100 - nh, ny)),
        w: Math.min(100, nw),
        h: Math.min(100, nh),
      };
    }
    obj.x += S.rx;
    obj.y += S.ry;
    obj.w = S.rw;
    obj.h = S.rh;
    closeCrop();
    ctx.markDirty();
  });

  cropResetBtn.addEventListener('click', () => {
    if (!cropState) return;
    const obj = ctx.findObject(cropState.objId);
    if (obj && obj.crop) {
      ctx.pushUndo();
      resetImageCrop(obj);
      ctx.markDirty();
    }
    closeCrop();
  });

  cropCancelBtn.addEventListener('click', () => closeCrop());

  // Crop keyboard: Enter applies, Escape cancels
  document.addEventListener('keydown', (e) => {
    if (!cropState) return;
    const inEdit = e.target.closest('[contenteditable]') || /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Enter' && !inEdit) { e.preventDefault(); cropApplyBtn.click(); }
    if (e.key === 'Escape') closeCrop();
  });

  // ── Crop to format (always a centered window of the FULL image) ─────
  function applyCropRatio(ratio) {
    ctx.closeMenus();
    ctx.pushUndo();
    const [rw, rh] = ratio;
    const targetRatio = rw / rh;

    let finalW, finalH;
    if (shouldResize) {
      if (targetRatio < 1) { finalW = 500; finalH = Math.round(500 / targetRatio); }
      else { finalH = 500; finalW = Math.round(500 * targetRatio); }
    }

    for (const sid of ctx.selectedIds) {
      const o = ctx.findObject(sid);
      if (!o || o.type !== 'image') continue;
      const full = fullImageSize(o);
      const fullRatio = full.w / full.h;

      let cropWPct, cropHPct;
      if (fullRatio > targetRatio) {
        cropHPct = 100;
        cropWPct = (targetRatio / fullRatio) * 100;
      } else {
        cropWPct = 100;
        cropHPct = (fullRatio / targetRatio) * 100;
      }

      o.crop = (cropWPct >= 99.9 && cropHPct >= 99.9) ? null : {
        x: (100 - cropWPct) / 2,
        y: (100 - cropHPct) / 2,
        w: cropWPct,
        h: cropHPct,
      };

      // Keep the visible center stable while the box takes the new format
      const cx0 = o.x + o.w / 2, cy0 = o.y + o.h / 2;
      if (shouldResize) {
        o.w = finalW; o.h = finalH;
      } else {
        o.w = Math.round(full.w * (cropWPct / 100));
        o.h = Math.round(full.h * (cropHPct / 100));
      }
      o.x = Math.round(cx0 - o.w / 2);
      o.y = Math.round(cy0 - o.h / 2);
    }
    ctx.renderObjects();
    ctx.markDirty();
  }

  async function removeWhiteBg() {
    ctx.closeMenus();
    for (const sid of ctx.selectedIds) {
      const o = ctx.findObject(sid);
      if (o && o.type === 'image' && o.content) {
        const result = await ctx.io.removeWhiteBg(o.content);
        if (result && result.assetPath) {
          ctx.pushUndo();
          o.content = result.assetPath;
          ctx.renderObjects();
          ctx.markDirty();
        }
      }
    }
  }

  return {
    // ── STYLES ── (exact values from the original app)
    css: `
      .canvas-obj .img-wrapper {
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
      }
      .canvas-obj .img-wrapper img {
        display: block;
        pointer-events: none;
      }
      .canvas-obj .img-wrapper img.uncropped {
        width: 100%;
        height: 100%;
        object-fit: fill; /* box aspect always equals image aspect (heal) */
      }
      .canvas-obj .img-wrapper img.cropped {
        position: absolute;
      }
      .canvas-obj.cropping {
        outline: none;
        z-index: 9000 !important;
        overflow: visible;
      }
      .canvas-obj.cropping .img-wrapper {
        overflow: visible;
        cursor: grab;
      }
      .crop-full-img {
        position: absolute;
        pointer-events: auto;
        opacity: 0.35;
        max-width: none;
        cursor: grab;
      }
      .crop-rect {
        position: absolute;
        border: 2px solid #F0C4A0;
        cursor: grab;
        z-index: 2;
        overflow: visible;
      }
      .crop-img-clip {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      .crop-rect img {
        position: absolute;
        pointer-events: none;
        max-width: none;
      }
      .crop-handle {
        position: absolute;
        width: 14px;
        height: 14px;
        background: #F0C4A0;
        border: 2px solid #1a1a1a;
        border-radius: 2px;
        z-index: 3;
      }
      .crop-handle.ch-tl { top: -7px; left: -7px; cursor: nw-resize; }
      .crop-handle.ch-tr { top: -7px; right: -7px; cursor: ne-resize; }
      .crop-handle.ch-bl { bottom: -7px; left: -7px; cursor: sw-resize; }
      .crop-handle.ch-br { bottom: -7px; right: -7px; cursor: se-resize; }

      .img-crop-bar {
        display: none;
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: #2a2a2a;
        border: 1px solid #3a3a3a;
        border-radius: 10px;
        padding: 8px 14px;
        z-index: 1001;
        gap: 8px;
        align-items: center;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        font-family: var(--font-sans);
        white-space: nowrap;
      }
      .img-crop-bar.visible { display: flex; }
      .img-crop-bar span {
        color: #888;
        font-size: 12px;
        margin-right: 4px;
      }
      .img-crop-bar button {
        padding: 6px 14px;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        font-family: var(--font-sans);
        cursor: pointer;
        font-weight: 500;
      }
      .img-crop-bar .crop-apply { background: #F0C4A0; color: #1a1a1a; }
      .img-crop-bar .crop-apply:hover { background: #f5d4b8; }
      .img-crop-bar .crop-reset { background: #333; color: #ccc; }
      .img-crop-bar .crop-reset:hover { background: #444; }
      .img-crop-bar .crop-cancel { background: transparent; color: #888; border: 1px solid #444 !important; }
      .img-crop-bar .crop-cancel:hover { background: #2a2a2a; color: #ccc; }

      .img-resize-check { cursor: pointer; gap: 8px; }
      .img-resize-check input {
        accent-color: #F0C4A0;
        width: 14px; height: 14px;
        cursor: pointer;
      }
      .img-resize-check span { font-size: 12px; color: #888; }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      image: {
        defaults: { content: '', crop: null },
        proportionalResize: true,

        normalize(obj) {
          // Sanitize crop — always percentages (0-100) of the FULL image
          if (obj.crop) {
            let cw = Number(obj.crop.w), ch = Number(obj.crop.h);
            let cx = Number(obj.crop.x), cy = Number(obj.crop.y);
            if (!isFinite(cw) || !isFinite(ch) || cw <= 0.5 || ch <= 0.5) {
              obj.crop = null;
            } else {
              cw = Math.min(cw, 100); ch = Math.min(ch, 100);
              cx = Math.max(0, Math.min(isFinite(cx) ? cx : 0, 100 - cw));
              cy = Math.max(0, Math.min(isFinite(cy) ? cy : 0, 100 - ch));
              obj.crop = (cw >= 99.9 && ch >= 99.9) ? null : { x: cx, y: cy, w: cw, h: ch };
            }
          }
        },

        // ── RENDERING ──
        render(obj, el) {
          const wrapper = document.createElement('div');
          wrapper.className = 'img-wrapper';
          const img = document.createElement('img');
          img.draggable = false;
          applyImageCropStyles(obj, img);
          img.onload = () => healImageAspect(obj, img);
          img.src = ctx.io.assetUrl(obj.content);
          if (img.complete) healImageAspect(obj, img);
          wrapper.appendChild(img);
          el.appendChild(wrapper);
        },

        onDoubleClick(obj) { openInlineCrop(obj); },

        // Cross-project paste: localize the asset into this project
        async onPaste(obj) {
          if (!obj.content) return;
          try {
            const res = await ctx.io.importExternalAsset(obj.content);
            if (res && res.path) obj.content = res.path;
          } catch (_) { /* keep original path; absolute paths still resolve */ }
        },

        // ── EXPORT ── crop-aware draw from the live DOM image
        exportDraw(c2d, obj, t) {
          const imgEl = ctx.worldEl.querySelector(`[data-id="${obj.id}"] img`);
          if (!imgEl || !imgEl.complete || !imgEl.naturalWidth) return;
          const ow = obj.w * t.scaleX, oh = obj.h * t.scaleY;
          try {
            if (obj.crop) {
              const sx = (obj.crop.x / 100) * imgEl.naturalWidth;
              const sy = (obj.crop.y / 100) * imgEl.naturalHeight;
              const sw = (obj.crop.w / 100) * imgEl.naturalWidth;
              const sh = (obj.crop.h / 100) * imgEl.naturalHeight;
              c2d.drawImage(imgEl, sx, sy, sw, sh, t.x, t.y, ow, oh);
            } else {
              c2d.drawImage(imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight, t.x, t.y, ow, oh);
            }
          } catch (_) { /* cross-origin or decode issue: skip */ }
        },

        // ── MENUS ── exact hierarchy of the original app's image section:
        // Crop ▶ [ Resize ☐ ─ 3:4 · 4:3 · 3:5 · 5:3 · 9:16 · 16:9 · 1:1 ─
        // Reset Crop ], Remove White Background
        menu: () => [
          {
            label: 'Crop',
            icon: CROP_ICON_14,
            submenu: [
              {
                html: `<label class="ctx-item img-resize-check"><input type="checkbox" ${shouldResize ? 'checked' : ''}><span>Resize</span></label>`,
                onClick(e) {
                  const cb = e.currentTarget ? e.currentTarget.querySelector('input') : null;
                  setTimeout(() => { if (cb) shouldResize = cb.checked; }, 0);
                },
              },
              { divider: true },
              { label: '3:4 Portrait', action() { applyCropRatio([3, 4]); } },
              { label: '4:3 Landscape', action() { applyCropRatio([4, 3]); } },
              { label: '3:5 Portrait', action() { applyCropRatio([3, 5]); } },
              { label: '5:3 Landscape', action() { applyCropRatio([5, 3]); } },
              { label: '9:16 Portrait', action() { applyCropRatio([9, 16]); } },
              { label: '16:9 Landscape', action() { applyCropRatio([16, 9]); } },
              { label: '1:1 Square', action() { applyCropRatio([1, 1]); } },
              { divider: true },
              {
                label: 'Reset Crop',
                action(ctx) {
                  ctx.pushUndo();
                  for (const sid of ctx.selectedIds) {
                    const o = ctx.findObject(sid);
                    if (o && o.type === 'image') resetImageCrop(o);
                  }
                  ctx.renderObjects();
                  ctx.markDirty();
                },
              },
            ],
          },
          { label: 'Remove White Background', icon: NOBG_ICON_14, action() { removeWhiteBg(); } },
        ],
      },
    },

    // ── RAW POINTER ── clicking outside the cropping image exits crop mode
    pointer: [
      {
        priority: 150,
        handler(e) {
          if (!cropState) return false;
          const objEl = e.target.closest('.canvas-obj');
          if (objEl && parseInt(objEl.dataset.id) === cropState.objId) return false; // crop UI owns it
          if (e.target.closest('.img-crop-bar')) return false;
          closeCrop();
          return false; // let normal processing continue after closing
        },
      },
    ],

    // Ctrl+V with no object clipboard → paste a bitmap from the OS clipboard
    async onPasteEmpty(ctx) {
      const result = await ctx.io.pasteImage();
      if (!result || !result.assetPath) return false;
      ctx.pushUndo();
      const { w, h } = capStandard(result.width, result.height);
      const center = ctx.viewportCenter();
      const obj = ctx.createObject({
        type: 'image',
        x: center.x - w / 2, y: center.y - h / 2,
        w, h, content: result.assetPath,
      });
      ctx.selectObject(obj.id);
      ctx.renderObjects();
      ctx.markDirty();
      return true;
    },

    // ── TOOLBAR ── the Add Images family (hover → subfamily). Forks like
    // images.hires.js contribute their own items into this same family.
    toolbar: [
      {
        icon: IMG_ICON_24,
        title: 'Add Images',
        order: 10,
        items: [
          { label: 'Add Image', icon: IMG_ICON_14, order: 1, action(ctx) { addImages(); } },
        ],
      },
    ],

    // ── MENUS ── "Add Images ▶" submenu, exactly like the original app
    canvasMenu: [
      {
        submenu: 'Add Images',
        icon: IMG_ICON_14,
        order: 10,
        items: [
          { label: 'Add Image', order: 1, action(ctx) { addImages(ctx.contextWorld.x, ctx.contextWorld.y); } },
        ],
      },
    ],
  };
}
