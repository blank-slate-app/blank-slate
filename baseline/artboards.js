/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — artboards.js — deck pages with corner fields.

   BASELINE TOOL. Edit freely — a pristine copy lives in ../baseline/ and
   the app can always revert this file.

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   OBJECT: type 'artboard' — { artboardLabel: 'A'…, artboardRatio:
   '1:1'|'16:9'|'17:11', artboardFields: { tl, tr, bl, br } }, each field
   { kind: 'text'|'number'|'logo', text, style, fontFamily, textColor,
   src }. Artboards always sit at zIndex 0 (behind everything).

   FIELDS: click to type; drag a field onto another corner of the same
   artboard to SWAP them; right-click a field for its menu (style, color,
   page number, logo). Renumber Pages numbers selected artboards in
   selection order — unnumbered artboards still consume a position, like
   deck pages. Match Last copies the last-selected artboard's fields onto
   the others (page numbers stay per-page).

   EXPORT: 150 DPI on canvas, 300 DPI JPEG export. The renderer draws
   every overlapping object through ctx.exportObject — each tool's own
   exportDraw — so artboards never need to know other tools' objects.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'artboards',
  name: 'Artboard',
  version: '2.0.0',
  authors: ['santi'],
  basedOn: null,
  description: 'Fixed-ratio deck pages with corner fields, renumbering and JPEG export.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const AB_CORNERS = ['tl', 'tr', 'bl', 'br'];
  const ARTBOARD_SIZES = {
    '1:1':   { w: 1500, h: 1500 },  // 10 × 10 in @150dpi
    '16:9':  { w: 2400, h: 1350 },  // 16 × 9 in
    '17:11': { w: 2550, h: 1650 },  // 17 × 11 in (tabloid)
  };
  const ARTBOARD_EXPORT_SIZES = {   // 300 DPI (2× canvas)
    '1:1':   { w: 3000, h: 3000 },
    '16:9':  { w: 4800, h: 2700 },
    '17:11': { w: 5100, h: 3300 },
  };
  const FIELD_COLORS = ['#F05300', '#F07A3C', '#F0A178', '#F0C9B4', '#F0F0F0', '#999999', '#111111'];

  function mkField(over) {
    return {
      kind: 'text', text: '', style: 'description',
      fontFamily: null, textColor: null, src: null,
      ...(over || {}),
    };
  }

  // Page numbers display with no leading zeros; empty when not a number
  function normalizePageNumber(text) {
    const digits = String(text || '').replace(/\D/g, '');
    if (!digits) return '';
    const n = parseInt(digits, 10);
    return isFinite(n) ? String(n) : '';
  }

  function sanitizeFields(o) {
    if (!o.artboardFields) {
      // Migrate legacy title (top-left) and footer (bottom-left)
      o.artboardFields = {
        tl: mkField({ text: o.artboardTitle || '', style: 'title' }),
        tr: mkField(),
        bl: mkField({ text: o.artboardFooter || '', style: 'subtitle' }),
        br: mkField(),
      };
      return;
    }
    for (const c of AB_CORNERS) {
      const f = o.artboardFields[c];
      o.artboardFields[c] = mkField(f && typeof f === 'object' ? f : {});
      const nf = o.artboardFields[c];
      if (!['text', 'number', 'logo'].includes(nf.kind)) nf.kind = 'text';
      if (!['title', 'subtitle', 'description'].includes(nf.style)) nf.style = 'description';
      nf.text = typeof nf.text === 'string' ? nf.text : '';
      if (nf.kind === 'number') nf.text = normalizePageNumber(nf.text);
      if (nf.kind === 'logo' && !nf.src) nf.kind = 'text';
    }
  }

  function nextArtboardLabel() {
    const used = new Set(ctx.objects.filter(o => o.type === 'artboard').map(o => o.artboardLabel));
    for (let i = 0; i < 26; i++) {
      const chLabel = String.fromCharCode(65 + i);
      if (!used.has(chLabel)) return chLabel;
    }
    return 'A';
  }

  function swapFields(abId, a, b) {
    if (a === b) return;
    const o = ctx.findObject(abId);
    if (!o || o.type !== 'artboard' || !o.artboardFields) return;
    ctx.pushUndo();
    const t = o.artboardFields[a];
    o.artboardFields[a] = o.artboardFields[b];
    o.artboardFields[b] = t;
    ctx.renderObjects();
    ctx.markDirty();
    ctx.showToast('Swapped fields');
  }

  function addArtboard(wx, wy) {
    ctx.pushUndo();
    const ratio = '16:9'; // default proportion
    const sz = ARTBOARD_SIZES[ratio];
    const center = (wx !== undefined) ? { x: wx, y: wy } : ctx.viewportCenter();
    const obj = ctx.createObject({
      type: 'artboard',
      x: center.x - sz.w / 2, y: center.y - sz.h / 2,
      w: sz.w, h: sz.h,
      artboardLabel: nextArtboardLabel(), artboardRatio: ratio, zIndex: 0,
    });
    ctx.selectObject(obj.id);
    ctx.renderObjects();
    ctx.markDirty();
  }

  function setRatio(ratio) {
    ctx.closeMenus();
    ctx.pushUndo();
    const sz = ARTBOARD_SIZES[ratio];
    if (!sz) return;
    for (const sid of ctx.selectedIds) {
      const o = ctx.findObject(sid);
      if (o && o.type === 'artboard') {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        o.w = sz.w; o.h = sz.h;
        o.x = cx - sz.w / 2; o.y = cy - sz.h / 2;
        o.artboardRatio = ratio;
      }
    }
    ctx.renderObjects();
    ctx.markDirty();
  }

  // ── Field font picker (tool-owned, same list as the text tool) ──────
  const GOOGLE_FONTS = [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald', 'Raleway', 'Poppins', 'Nunito', 'Merriweather',
    'Playfair Display', 'PT Sans', 'Roboto Slab', 'Source Sans Pro', 'Ubuntu', 'Noto Sans', 'Roboto Mono', 'Lora',
    'Fira Sans', 'Mulish', 'Barlow', 'DM Sans', 'Rubik', 'Work Sans', 'Quicksand', 'Karla', 'Libre Baskerville',
    'IBM Plex Sans', 'Josefin Sans', 'Cabin', 'Arimo', 'Dosis', 'Oxygen', 'Hind', 'Titillium Web', 'PT Serif',
    'Noto Serif', 'Crimson Text', 'EB Garamond', 'Source Serif Pro', 'Cormorant Garamond', 'Bitter', 'Vollkorn',
    'Spectral', 'Libre Franklin', 'Exo 2', 'Overpass', 'Assistant', 'Heebo', 'Maven Pro', 'Catamaran', 'Abel',
    'Prompt', 'Signika', 'Archivo', 'Red Hat Display', 'Manrope', 'Sora', 'Space Grotesk', 'Plus Jakarta Sans',
    'Outfit', 'Lexend', 'Figtree', 'Geist', 'Atkinson Hyperlegible', 'Bebas Neue', 'Anton', 'Black Ops One',
    'Righteous', 'Bungee', 'Fredoka One', 'Pacifico', 'Dancing Script', 'Great Vibes', 'Caveat', 'Permanent Marker',
    'Shadows Into Light', 'Patrick Hand', 'Architects Daughter', 'Indie Flower', 'Amatic SC', 'Lobster', 'Bangers',
    'Press Start 2P', 'Space Mono', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Inconsolata',
    'Anonymous Pro', 'Courier Prime'
  ];
  const loadedFonts = new Set();
  function loadGoogleFont(fontName) {
    if (loadedFonts.has(fontName)) return;
    loadedFonts.add(fontName);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:ital,wght@0,400;0,600;0,700;1,400&display=swap`;
    document.head.appendChild(link);
  }

  const fontPanel = document.createElement('div');
  fontPanel.className = 'ab-font-panel';
  fontPanel.innerHTML = `
    <input type="text" placeholder="Search fonts...">
    <div class="ab-font-list"></div>
  `;
  document.body.appendChild(fontPanel);
  const fontSearch = fontPanel.querySelector('input');
  const fontList = fontPanel.querySelector('.ab-font-list');
  let fontListBuilt = false;
  let fontTarget = null; // { objId, corner }

  function buildFontList() {
    if (fontListBuilt) return;
    fontListBuilt = true;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const f = entry.target.dataset.font;
          if (f) loadGoogleFont(f);
          observer.unobserve(entry.target);
        }
      }
    }, { root: fontList, rootMargin: '100px' });
    for (const font of GOOGLE_FONTS) {
      const item = document.createElement('div');
      item.className = 'ab-font-item';
      item.textContent = font;
      item.dataset.font = font;
      item.style.fontFamily = `"${font}", sans-serif`;
      observer.observe(item);
      item.addEventListener('click', () => {
        if (!fontTarget) { hideFontPanel(); return; }
        const o = ctx.findObject(fontTarget.objId);
        const f = o && o.type === 'artboard' && o.artboardFields ? o.artboardFields[fontTarget.corner] : null;
        if (f) {
          ctx.pushUndo();
          loadGoogleFont(font);
          f.fontFamily = `"${font}", sans-serif`;
          ctx.renderObjects();
          ctx.markDirty();
        }
        hideFontPanel();
      });
      fontList.appendChild(item);
    }
  }

  function showFontPanel(x, y, target) {
    buildFontList();
    fontTarget = target;
    fontPanel.classList.add('visible');
    if (x + 280 > window.innerWidth) x = window.innerWidth - 288;
    if (y + 420 > window.innerHeight) y = Math.max(8, window.innerHeight - 428);
    fontPanel.style.left = x + 'px';
    fontPanel.style.top = y + 'px';
    fontSearch.value = '';
    fontSearch.focus();
    fontList.querySelectorAll('.ab-font-item').forEach(i => { i.style.display = 'block'; });
  }
  function hideFontPanel() { fontPanel.classList.remove('visible'); fontTarget = null; }
  fontSearch.addEventListener('input', () => {
    const q = fontSearch.value.toLowerCase();
    fontList.querySelectorAll('.ab-font-item').forEach(item => {
      item.style.display = item.textContent.toLowerCase().includes(q) ? 'block' : 'none';
    });
  });
  document.addEventListener('mousedown', (e) => {
    if (fontPanel.classList.contains('visible') && !fontPanel.contains(e.target)) hideFontPanel();
  });

  // ── Field mutations (via the field right-click menu) ────────────────
  function mutateField(target, fn) {
    const o = ctx.findObject(target.objId);
    const f = o && o.type === 'artboard' && o.artboardFields ? o.artboardFields[target.corner] : null;
    if (!f) { ctx.closeMenus(); return; }
    ctx.pushUndo();
    fn(f);
    ctx.closeMenus();
    ctx.renderObjects();
    ctx.markDirty();
  }

  // ── Export pipeline ─────────────────────────────────────────────────
  // Filename: NNN_Document-Name_Artboard (NNN = 1-based export position)
  function exportBaseName(seq) {
    const doc = String(ctx.project || 'Project').replace(/\./g, '-');
    return `${String(seq).padStart(3, '0')}_${doc}_Artboard`;
  }

  function renderArtboardToDataUrl(ab) {
    const sz = ARTBOARD_EXPORT_SIZES[ab.artboardRatio] || ARTBOARD_EXPORT_SIZES['1:1'];
    const exportW = sz.w, exportH = sz.h;
    const scaleX = exportW / ab.w, scaleY = exportH / ab.h;

    const canvas = document.createElement('canvas');
    canvas.width = exportW; canvas.height = exportH;
    const c2d = canvas.getContext('2d');
    // Dark desk background
    c2d.fillStyle = '#1a1a1a';
    c2d.fillRect(0, 0, exportW, exportH);
    // 40px world grid, aligned to the artboard's world offset
    const gridStep = 40 * scaleX;
    c2d.strokeStyle = 'rgba(255,255,255,0.08)';
    c2d.lineWidth = 1;
    const gridOffX = ((ab.x % 40) * scaleX);
    const gridOffY = ((ab.y % 40) * scaleY);
    for (let gx = -gridOffX; gx <= exportW; gx += gridStep) {
      c2d.beginPath(); c2d.moveTo(gx, 0); c2d.lineTo(gx, exportH); c2d.stroke();
    }
    for (let gy = -gridOffY; gy <= exportH; gy += gridStep) {
      c2d.beginPath(); c2d.moveTo(0, gy); c2d.lineTo(exportW, gy); c2d.stroke();
    }

    // Every overlapping object, in z order, via each tool's own exportDraw
    const overlapping = ctx.objects.filter(o =>
      o.id !== ab.id && o.type !== 'artboard' &&
      o.x + o.w > ab.x && o.x < ab.x + ab.w &&
      o.y + o.h > ab.y && o.y < ab.y + ab.h
    ).sort((a, b) => a.zIndex - b.zIndex);

    for (const obj of overlapping) {
      c2d.save();
      c2d.beginPath();
      c2d.rect(0, 0, exportW, exportH);
      c2d.clip();
      ctx.exportObject(c2d, obj, {
        x: (obj.x - ab.x) * scaleX,
        y: (obj.y - ab.y) * scaleY,
        scaleX, scaleY,
      });
      c2d.restore();
    }

    // The four corner fields (60px inset, scaled)
    const FIELD_EXPORT_STYLES = {
      title:       { size: 42, weight: '600', family: 'serif', color: '#f0f0f0' },
      subtitle:    { size: 24, weight: '400', family: 'serif', style: 'italic', color: '#cccccc' },
      description: { size: 14, weight: '400', family: "'JetBrains Mono', monospace", color: '#999999' },
    };
    const insetX = 60 * scaleX, insetY = 60 * scaleY;
    for (const corner of AB_CORNERS) {
      const f = ab.artboardFields && ab.artboardFields[corner];
      if (!f) continue;
      const isRight = corner === 'tr' || corner === 'br';
      const isBottom = corner === 'bl' || corner === 'br';

      if (f.kind === 'logo' && f.src) {
        const logoEl = ctx.worldEl.querySelector(`.canvas-obj[data-id="${ab.id}"] .ab-field-${corner} img`);
        if (logoEl && logoEl.complete && logoEl.naturalWidth) {
          const lh = 60 * scaleY;
          const lw = lh * (logoEl.naturalWidth / logoEl.naturalHeight);
          const lx = isRight ? exportW - insetX - lw : insetX;
          const ly = isBottom ? exportH - insetY - lh : insetY;
          try { c2d.drawImage(logoEl, lx, ly, lw, lh); } catch (e) { /* skip */ }
        }
        continue;
      }

      if (!f.text) continue;
      const s = FIELD_EXPORT_STYLES[f.style] || FIELD_EXPORT_STYLES.description;
      const italic = s.style === 'italic' ? 'italic ' : '';
      const family = f.fontFamily || s.family;
      const size = s.size * scaleX;
      c2d.font = `${italic}${s.weight} ${Math.round(size)}px ${family}`;
      c2d.fillStyle = f.textColor || s.color;
      c2d.textAlign = isRight ? 'right' : 'left';
      const tx = isRight ? exportW - insetX : insetX;
      const lines = String(f.text).split('\n');
      const lineH = size * 1.3;
      if (isBottom) {
        c2d.textBaseline = 'bottom';
        let ty = exportH - insetY;
        for (let i = lines.length - 1; i >= 0; i--) { c2d.fillText(lines[i], tx, ty); ty -= lineH; }
      } else {
        c2d.textBaseline = 'top';
        let ty = insetY;
        for (const line of lines) { c2d.fillText(line, tx, ty); ty += lineH; }
      }
    }
    c2d.textAlign = 'left';

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  async function exportSelected() {
    ctx.closeMenus();
    // "In the order selected" — selectedIds preserves selection order
    const sel = [...ctx.selectedIds]
      .map(id => ctx.findObject(id))
      .filter(o => o && o.type === 'artboard');
    if (sel.length === 0) return;
    if (sel.length === 1) {
      await ctx.io.exportJpeg(exportBaseName(1), renderArtboardToDataUrl(sel[0]));
    } else {
      const folder = await ctx.io.pickFolder('Select Folder for Artboard Exports');
      if (!folder) return;
      for (let i = 0; i < sel.length; i++) {
        await ctx.io.saveJpegToFolder(folder, exportBaseName(i + 1), renderArtboardToDataUrl(sel[i]));
      }
      ctx.showToast(`Exported ${sel.length} artboard(s)`);
    }
  }

  async function exportAll() {
    ctx.closeMenus();
    // By letter order when exporting all
    const artboards = ctx.objects
      .filter(o => o.type === 'artboard')
      .sort((a, b) => (a.artboardLabel || '').localeCompare(b.artboardLabel || ''));
    if (artboards.length === 0) { ctx.showToast('No artboards to export'); return; }
    const folder = await ctx.io.pickFolder('Select Folder for Artboard Exports');
    if (!folder) return;
    for (let i = 0; i < artboards.length; i++) {
      await ctx.io.saveJpegToFolder(folder, exportBaseName(i + 1), renderArtboardToDataUrl(artboards[i]));
    }
    ctx.showToast(`Exported ${artboards.length} artboard(s)`);
  }

  const AB_ICON_14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>';

  return {
    // ── STYLES ── (exact values from the original app)
    css: `
      .canvas-obj.artboard-obj {
        border: 2px dashed #888;
        background: transparent;
        overflow: visible;
      }
      .canvas-obj.artboard-obj.selected { outline: none; border-color: #F0C4A0; }
      .artboard-label {
        position: absolute;
        top: -24px; left: 0;
        font-size: 11px;
        color: #888;
        background: #2a2a2a;
        padding: 2px 8px;
        border-radius: 3px 3px 0 0;
        font-family: var(--font-sans);
        white-space: nowrap;
        pointer-events: none;
        letter-spacing: 0.5px;
      }
      .canvas-obj.artboard-obj.selected .artboard-label { color: #F0C4A0; }

      .ab-field {
        position: absolute;
        outline: none;
        cursor: text;
        max-width: calc(50% - 75px);
        white-space: pre-wrap;
        word-break: break-word;
        color: #f0f0f0;
      }
      .ab-field-tl { top: 60px; left: 60px; }
      .ab-field-tr { top: 60px; right: 60px; text-align: right; }
      .ab-field-bl { bottom: 60px; left: 60px; }
      .ab-field-br { bottom: 60px; right: 60px; text-align: right; }
      .ab-field.style-title {
        font-family: var(--font-serif);
        font-size: 42px;
        font-weight: 600;
        color: #f0f0f0;
        line-height: 1.2;
      }
      .ab-field.style-subtitle {
        font-family: var(--font-serif);
        font-size: 24px;
        font-weight: 400;
        font-style: italic;
        color: #cccccc;
        line-height: 1.3;
      }
      .ab-field.style-description {
        font-family: var(--mono);
        font-size: 14px;
        font-weight: 400;
        color: #999999;
        line-height: 1.5;
      }
      .ab-field:empty::before {
        content: attr(data-placeholder);
        color: transparent;
        pointer-events: none;
      }
      .artboard-obj:hover .ab-field:empty::before,
      .artboard-obj.selected .ab-field:empty::before,
      .ab-field:focus:empty::before { color: #555; }
      .ab-field.ab-field-logo { cursor: default; }
      .ab-field.ab-field-logo img {
        display: block;
        height: 60px;
        width: auto;
        max-width: 100%;
        object-fit: contain;
        pointer-events: none;
      }
      .ab-field-tr.ab-field-logo img, .ab-field-br.ab-field-logo img { margin-left: auto; }
      .ab-field.ab-field-dragging { opacity: 0.35; }
      .ab-field.ab-field-drop {
        outline: 2px solid #F0C4A0;
        outline-offset: 3px;
        background: rgba(240, 196, 160, 0.12);
        border-radius: 4px;
      }

      .field-color-auto { font-size: 12px; color: #b0b0b0; }
      .field-color-swatch {
        box-sizing: border-box;
        width: 22px;
        height: 22px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.18);
        cursor: pointer;
        transition: transform 0.1s, border-color 0.1s;
      }
      .field-color-swatch:hover { transform: scale(1.18); border-color: #F0C4A0; }

      .ab-font-panel {
        display: none;
        position: fixed;
        width: 280px;
        max-height: 420px;
        background: #2a2a2a;
        border: 1px solid #3a3a3a;
        border-radius: 8px;
        padding: 8px;
        z-index: 2100;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        flex-direction: column;
        gap: 8px;
      }
      .ab-font-panel.visible { display: flex; }
      .ab-font-panel input {
        background: #1a1a1a;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        color: #e0e0e0;
        padding: 8px 10px;
        font-size: 13px;
        outline: none;
      }
      .ab-font-list { overflow-y: auto; flex: 1; }
      .ab-font-item {
        padding: 8px 10px;
        color: #ccc;
        font-size: 15px;
        border-radius: 4px;
        cursor: pointer;
      }
      .ab-font-item:hover { background: #363636; color: #fff; }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      artboard: {
        defaults: {
          artboardLabel: null, artboardRatio: '16:9',
          artboardTitle: '', artboardFooter: '', // legacy, migrated
          artboardFields: null,
        },

        normalize(obj) {
          obj.zIndex = 0; // artboards always sit behind everything
          if (!ARTBOARD_SIZES[obj.artboardRatio]) obj.artboardRatio = '1:1';
          sanitizeFields(obj);
        },

        onDuplicate(clone) {
          clone.artboardLabel = nextArtboardLabel();
          clone.zIndex = 0;
        },

        // Cross-project paste: localize logo assets
        async onPaste(obj) {
          obj.zIndex = 0;
          if (!obj.artboardFields) return;
          for (const corner of AB_CORNERS) {
            const f = obj.artboardFields[corner];
            if (f && f.kind === 'logo' && f.src) {
              try {
                const res = await ctx.io.importExternalAsset(f.src);
                if (res && res.path) f.src = res.path;
              } catch (_) { /* keep original path */ }
            }
          }
        },

        // ── RENDERING ── label chip + four corner fields
        render(obj, el) {
          el.classList.add('artboard-obj');
          const label = document.createElement('div');
          label.className = 'artboard-label';
          label.textContent = `Artboard ${obj.artboardLabel || 'A'}`;
          el.appendChild(label);

          for (const corner of AB_CORNERS) {
            const f = obj.artboardFields[corner];
            const div = document.createElement('div');
            div.className = `ab-field ab-field-${corner}`;
            div.dataset.corner = corner;

            if (f.kind === 'logo' && f.src) {
              div.classList.add('ab-field-logo');
              const img = document.createElement('img');
              img.src = ctx.io.assetUrl(f.src);
              img.draggable = false;
              div.appendChild(img);
            } else {
              div.classList.add('style-' + f.style);
              div.contentEditable = 'true';
              div.dataset.placeholder = f.kind === 'number' ? '#' : 'Text';
              div.textContent = f.text || '';
              if (f.fontFamily) { div.style.fontFamily = f.fontFamily; loadGoogleFont(f.fontFamily.replace(/^"|", .*$/g, '')); }
              if (f.textColor) div.style.color = f.textColor;
              div.addEventListener('blur', () => {
                let newText = div.textContent || '';
                if (f.kind === 'number') {
                  newText = normalizePageNumber(newText);
                  div.textContent = newText;
                }
                if (newText !== f.text) {
                  ctx.pushUndo();
                  f.text = newText;
                  ctx.markDirty();
                }
              });
              div.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') div.blur();
                if (ev.key === 'Enter') { ev.preventDefault(); div.blur(); }
              });
            }

            // Left-click edits; left-DRAG onto another field of the same
            // artboard swaps the two (5px threshold tells click from drag).
            // Right-click passes through so the field menu opens.
            div.addEventListener('mousedown', (ev) => {
              if (ev.button !== 0) return;
              ev.stopPropagation(); // don't start an artboard drag
              const abId = obj.id, srcCorner = corner, sx = ev.clientX, sy = ev.clientY;
              let dragging = false, dropTgt = null;
              const fieldUnder = (px, py) => {
                const under = document.elementFromPoint(px, py);
                const t = under && under.closest ? under.closest('.ab-field') : null;
                if (!t || t === div) return null;
                const abEl = t.closest('.canvas-obj[data-id]');
                return (abEl && parseInt(abEl.dataset.id) === abId) ? t : null;
              };
              function onMove(mv) {
                if (!dragging) {
                  if (Math.abs(mv.clientX - sx) < 5 && Math.abs(mv.clientY - sy) < 5) return;
                  dragging = true;
                  const a = document.activeElement; if (a && a.blur) a.blur();
                  const s = window.getSelection(); if (s) s.removeAllRanges();
                  div.classList.add('ab-field-dragging');
                }
                mv.preventDefault();
                const t = fieldUnder(mv.clientX, mv.clientY);
                if (dropTgt && dropTgt !== t) dropTgt.classList.remove('ab-field-drop');
                dropTgt = t;
                if (t) t.classList.add('ab-field-drop');
              }
              function onUp(uv) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                div.classList.remove('ab-field-dragging');
                if (dropTgt) dropTgt.classList.remove('ab-field-drop');
                if (!dragging) return; // was a click → normal edit
                const t = fieldUnder(uv.clientX, uv.clientY);
                if (t) swapFields(abId, srcCorner, t.dataset.corner);
              }
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            });
            el.appendChild(div);
          }
        },

        // Right-click on a corner field → the field menu (instead of the
        // object menu). Exact hierarchy of the original app.
        onContextMenu(obj, e, ctx) {
          const fieldEl = e.target.closest('.ab-field');
          if (!fieldEl) return null;
          const corner = fieldEl.dataset.corner;
          const f = obj.artboardFields && obj.artboardFields[corner];
          if (!f) return null;
          const target = { objId: obj.id, corner };
          const isLogo = f.kind === 'logo';
          const isNumber = f.kind === 'number';
          const items = [];
          if (!isLogo) {
            items.push({
              label: 'Style',
              icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
              submenu: [
                { label: 'Title', action() { mutateField(target, x => { x.style = 'title'; x.fontFamily = null; }); } },
                { label: 'Subtitle', action() { mutateField(target, x => { x.style = 'subtitle'; x.fontFamily = null; }); } },
                { label: 'Description', action() { mutateField(target, x => { x.style = 'description'; x.fontFamily = null; }); } },
                { divider: true },
                {
                  label: 'Custom Font…',
                  action(ctx2, ev) {
                    const r = ev && ev.target ? ev.target.getBoundingClientRect() : { right: window.innerWidth / 2, top: window.innerHeight / 2 };
                    showFontPanel(r.right, r.top, target);
                  },
                },
                { divider: true },
                {
                  html: '<div class="ctx-item field-color-auto" title="Reset to the style\'s default colour"><span>Default Color</span></div>',
                  onClick() { mutateField(target, x => { x.textColor = null; }); },
                },
                {
                  html: `<div class="fc-color-row">` + FIELD_COLORS.map(c =>
                    `<button class="field-color-swatch" data-field-color="${c}" style="background:${c}"></button>`
                  ).join('') + `</div>`,
                  onClick(ev) {
                    const btn = ev.target.closest('.field-color-swatch');
                    if (!btn) return;
                    mutateField(target, x => { x.textColor = btn.dataset.fieldColor; });
                  },
                },
              ],
            });
            items.push({ divider: true });
          }
          if (!isLogo && !isNumber) {
            items.push({ label: 'Make Page Number', action() { mutateField(target, x => { x.kind = 'number'; x.src = null; x.text = normalizePageNumber(x.text); }); } });
          }
          if (isNumber) {
            items.push({ label: 'Make Text', action() { mutateField(target, x => { x.kind = 'text'; x.src = null; }); } });
          }
          items.push({
            label: isLogo ? 'Replace Logo…' : 'Add Logo…',
            async action(ctx2) {
              ctx2.closeMenus();
              // hiRes import preserves PNG transparency for logos
              const results = await ctx2.io.importImages({ hiRes: true });
              if (!results || !results.length || results[0].error) return;
              mutateField(target, x => { x.kind = 'logo'; x.src = results[0].assetPath; x.text = ''; });
            },
          });
          if (isLogo) {
            items.push({ label: 'Remove Logo', action() { mutateField(target, x => { x.kind = 'text'; x.src = null; }); } });
          }
          items.push({ divider: true });
          items.push({ label: 'Clear Field', danger: true, action() { mutateField(target, x => { x.kind = 'text'; x.src = null; x.text = ''; x.fontFamily = null; x.textColor = null; }); } });
          return items;
        },

        // ── MENUS ── artboard section: Proportion ▶, Export, Renumber, Match Last
        menu: () => [
          {
            label: 'Proportion',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>',
            submenu: [
              { label: '1:1 (10×10 in)', action() { setRatio('1:1'); } },
              { label: '16:9 (16×9 in)', action() { setRatio('16:9'); } },
              { label: '17:11 Tabloid', action() { setRatio('17:11'); } },
            ],
          },
          {
            label: 'Export Artboard',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
            action() { exportSelected(); },
          },
          {
            label: 'Renumber Pages',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
            action(ctx) {
              ctx.closeMenus();
              ctx.pushUndo();
              let n = 1;
              for (const sid of ctx.selectedIds) {
                const o = ctx.findObject(sid);
                if (!o || o.type !== 'artboard') continue;
                for (const c of AB_CORNERS) {
                  const f = o.artboardFields && o.artboardFields[c];
                  if (f && f.kind === 'number') f.text = String(n);
                }
                n++; // position consumed whether or not this artboard shows a number
              }
              ctx.renderObjects();
              ctx.markDirty();
            },
          },
          {
            label: 'Match Last',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
            action(ctx) {
              ctx.closeMenus();
              const selAbIds = [...ctx.selectedIds].filter(id => {
                const o = ctx.findObject(id);
                return o && o.type === 'artboard';
              });
              if (selAbIds.length < 2) { ctx.showToast('Select 2 or more artboards to match'); return; }
              const source = ctx.findObject(selAbIds[selAbIds.length - 1]);
              if (!source || !source.artboardFields) return;
              ctx.pushUndo();
              let count = 0;
              for (const id of selAbIds) {
                if (id === source.id) continue;
                const o = ctx.findObject(id);
                if (!o || !o.artboardFields) continue;
                for (const c of AB_CORNERS) {
                  const tf = o.artboardFields[c];
                  const sf = source.artboardFields[c];
                  if (!sf) continue;
                  // Keep per-artboard page numbers
                  if ((tf && tf.kind === 'number') || sf.kind === 'number') continue;
                  o.artboardFields[c] = JSON.parse(JSON.stringify(sf));
                }
                count++;
              }
              ctx.renderObjects();
              ctx.markDirty();
              ctx.showToast(`Matched ${count} artboard${count === 1 ? '' : 's'} to last selected`);
            },
          },
        ],
      },
    },

    // ── MENUS ── flat canvas items, exactly like the original app
    canvasMenu: [
      {
        label: 'Add Artboard',
        icon: AB_ICON_14,
        order: 40,
        action(ctx) { addArtboard(ctx.contextWorld.x, ctx.contextWorld.y); },
      },
      {
        label: 'Export All Artboards',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        order: 41,
        action(ctx) { exportAll(); },
      },
      {
        label: 'Rename All Artboards',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        order: 42,
        action(ctx) {
          ctx.closeMenus();
          // Left-to-right across the canvas (ties broken top-to-bottom):
          // the far-left artboard is A, the next to its right is B, and so on.
          const artboards = ctx.objects
            .filter(o => o.type === 'artboard')
            .sort((a, b) => a.x - b.x || a.y - b.y);
          if (artboards.length === 0) return;
          ctx.pushUndo();
          artboards.forEach((ab, i) => {
            ab.artboardLabel = String.fromCharCode(65 + i);
          });
          ctx.renderObjects();
          ctx.markDirty();
        },
      },
    ],
  };
}
