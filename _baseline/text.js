/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — text.js — text blocks (Label/Title/Subtitle/
   Description), double-click editing, Google Fonts picker, color options.

   BASELINE TOOL. Edit freely — a pristine copy lives in ../baseline/ and
   the app can always revert this file. To remix: copy to
   text.<yourname>.js, set basedOn: 'text', append your name to authors,
   and RENAME the object type (e.g. 'text-fancy').

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   OBJECT: type 'text' — { content, textStyle: 'label'|'title'|'subtitle'|
   'description', fontFamily: string|null (Google Font override),
   textColor: string|null (hex override; null = the style's default) }.

   content is CANONICAL RICH HTML: escaped text plus <b> (bold on light
   bases), <span class="txt-nb"> (un-bold on bold bases like Label), <i>,
   <u>, <br>. Ctrl+B/I/U work natively while editing; on blur the live DOM
   is walked back into that vocabulary so formatting persists. Legacy
   plain-text content is escaped once on load (normalize).
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'text',
  name: 'Text',
  version: '2.0.0',
  authors: ['Forma Rosa Creative'],
  basedOn: null,
  description: 'Label, Title, Subtitle and Description text blocks.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const STYLES = ['label', 'title', 'subtitle', 'description'];
  const SIZES = {
    label: { w: 1200, h: 220 },
    title: { w: 400, h: 56 },
    subtitle: { w: 350, h: 40 },
    description: { w: 300, h: 28 },
  };
  const PLACEHOLDERS = { label: 'Label', title: 'Title', subtitle: 'Subtitle', description: 'Description' };
  const COLOR_SWATCHES = ['#F05300', '#F07A3C', '#F0A178', '#F0C9B4', '#F0F0F0', '#999999', '#111111'];

  // ── Fonts ──────────────────────────────────────────────────────────
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
    link.onerror = () => console.warn(`Failed to load font: ${fontName}`);
    document.head.appendChild(link);
  }
  // The app's base faces (styles depend on them)
  loadGoogleFont('Cormorant Garamond');
  loadGoogleFont('Inter');
  loadGoogleFont('JetBrains Mono');

  // ── Font picker panel (tool-owned floating UI) ─────────────────────
  const fontPanel = document.createElement('div');
  fontPanel.className = 'text-font-panel';
  fontPanel.innerHTML = `
    <input type="text" placeholder="Search fonts...">
    <div class="text-font-list"></div>
  `;
  document.body.appendChild(fontPanel);
  const fontSearch = fontPanel.querySelector('input');
  const fontList = fontPanel.querySelector('.text-font-list');
  let fontListBuilt = false;

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
      item.className = 'text-font-item';
      item.textContent = font;
      item.dataset.font = font;
      item.style.fontFamily = `"${font}", sans-serif`;
      observer.observe(item);
      item.addEventListener('click', () => {
        ctx.pushUndo();
        loadGoogleFont(font);
        for (const sid of ctx.selectedIds) {
          const o = ctx.findObject(sid);
          if (o && o.type === 'text') o.fontFamily = `"${font}", sans-serif`;
        }
        ctx.renderObjects();
        ctx.markDirty();
        hideFontPanel();
      });
      fontList.appendChild(item);
    }
  }

  function showFontPanel(x, y) {
    buildFontList();
    fontPanel.classList.add('visible');
    if (x + 280 > window.innerWidth) x = window.innerWidth - 288;
    if (y + 420 > window.innerHeight) y = Math.max(8, window.innerHeight - 428);
    fontPanel.style.left = x + 'px';
    fontPanel.style.top = y + 'px';
    fontSearch.value = '';
    fontSearch.focus();
    fontList.querySelectorAll('.text-font-item').forEach(i => { i.style.display = 'block'; });
  }
  function hideFontPanel() { fontPanel.classList.remove('visible'); }

  fontSearch.addEventListener('input', () => {
    const q = fontSearch.value.toLowerCase();
    fontList.querySelectorAll('.text-font-item').forEach(item => {
      item.style.display = item.textContent.toLowerCase().includes(q) ? 'block' : 'none';
    });
  });
  document.addEventListener('mousedown', (e) => {
    if (fontPanel.classList.contains('visible') && !fontPanel.contains(e.target)) hideFontPanel();
  });

  // ── Rich text (persisted bold / italic / underline) ─────────────────
  // Same model as the flowchart tool's labels, base-weight aware. Each
  // tool file is self-contained, so text.js carries its own copies.
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Walk the live node into styled runs [{text, bold, italic, underline}].
  // Weight/style are inherited (read off the parent's computed style);
  // underline is not inherited, so it's detected up the ancestry.
  function collectRuns(node) {
    const runs = [];
    function underlined(el) {
      let e = el;
      while (e && e !== node.parentNode) {
        if (e.nodeType === 1) {
          if (e.tagName === 'U') return true;
          const td = getComputedStyle(e).textDecorationLine || '';
          if (td.indexOf('underline') !== -1) return true;
        }
        e = e.parentNode;
      }
      return false;
    }
    function walk(n) {
      for (const child of n.childNodes) {
        if (child.nodeType === 3) {
          const p = child.parentElement;
          if (p && p.classList.contains('placeholder-text')) continue;
          const cs = getComputedStyle(p || node);
          runs.push({
            text: child.nodeValue,
            bold: parseInt(cs.fontWeight, 10) >= 600,
            italic: cs.fontStyle.indexOf('italic') !== -1,
            underline: underlined(p || node),
          });
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === 'BR') {
            runs.push({ text: '\n', bold: false, italic: false, underline: false });
          } else {
            if (/^(DIV|P)$/.test(tag) && runs.length && !/\n$/.test(runs[runs.length - 1].text))
              runs.push({ text: '\n', bold: false, italic: false, underline: false });
            walk(child);
          }
        }
      }
    }
    walk(node);
    return runs;
  }

  // Serialize runs back to the canonical vocabulary, relative to the
  // style's base weight (Label is bold-based → un-bold = txt-nb). Italic
  // bases (Subtitle) stay italic; the flag only ever adds <i>.
  function textRunsToHtml(runs, baseBold) {
    const rs = runs.map(r => ({ ...r }));
    while (rs.length && rs[0].text.replace(/^\s+/, '') === '') rs.shift();
    if (rs.length) rs[0].text = rs[0].text.replace(/^\s+/, '');
    while (rs.length && rs[rs.length - 1].text.replace(/\s+$/, '') === '') rs.pop();
    if (rs.length) rs[rs.length - 1].text = rs[rs.length - 1].text.replace(/\s+$/, '');
    let html = '';
    for (const r of rs) {
      const pieces = r.text.split('\n');
      for (let i = 0; i < pieces.length; i++) {
        if (i > 0) html += '<br>';
        if (pieces[i] === '') continue;
        let seg = escapeHtml(pieces[i]);
        if (r.underline) seg = '<u>' + seg + '</u>';
        if (r.italic) seg = '<i>' + seg + '</i>';
        if (r.bold && !baseBold) seg = '<b>' + seg + '</b>';
        if (!r.bold && baseBold) seg = '<span class="txt-nb">' + seg + '</span>';
        html += seg;
      }
    }
    return html;
  }

  // True when content is already canonical rich HTML (vs legacy plain
  // text saved via textContent, which must be escaped once on load).
  function looksCanonicalHtml(s) {
    return /<(b|i|u|br|span class="txt-nb")>/i.test(s) || /&(amp|lt|gt);/.test(s);
  }

  // Parse canonical HTML into styled runs — string-only, used by export.
  function parseTextRuns(html) {
    const runs = [];
    let b = 0, it = 0, u = 0, nb = 0;
    for (const t of String(html || '').split(/(<[^>]+>)/)) {
      if (!t) continue;
      if (t[0] === '<') {
        const tag = t.toLowerCase();
        if (tag === '<b>') b++; else if (tag === '</b>') b = Math.max(0, b - 1);
        else if (tag === '<i>') it++; else if (tag === '</i>') it = Math.max(0, it - 1);
        else if (tag === '<u>') u++; else if (tag === '</u>') u = Math.max(0, u - 1);
        else if (tag.startsWith('<span')) nb++; else if (tag === '</span>') nb = Math.max(0, nb - 1);
        else if (tag.startsWith('<br')) runs.push({ text: '\n', bold: false, nb: false, italic: false, underline: false });
        continue;
      }
      runs.push({
        text: t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
        bold: b > 0, nb: nb > 0, italic: it > 0, underline: u > 0,
      });
    }
    return runs;
  }

  // ── Creating and editing ───────────────────────────────────────────
  function addText(style, x, y) {
    ctx.pushUndo();
    const s = SIZES[style] || SIZES.title;
    const center = (x === undefined) ? ctx.viewportCenter() : { x, y };
    const obj = ctx.createObject({
      type: 'text',
      x: center.x - s.w / 2, y: center.y - s.h / 2,
      w: s.w, h: s.h,
      content: '', textStyle: style,
    });
    ctx.selectObject(obj.id);
    ctx.renderObjects();
    ctx.markDirty();
    // Drop straight into editing
    setTimeout(() => {
      const el = ctx.worldEl.querySelector(`[data-id="${obj.id}"]`);
      if (el) startEdit(obj, el);
    }, 50);
  }

  function startEdit(obj, el) {
    const ph = el.querySelector('.placeholder-text');
    if (ph) ph.remove();
    if (!obj.content) el.textContent = '';
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function onBlur() {
      el.contentEditable = 'false';
      // Persist rich runs (bold/italic/underline survive leaving the box)
      const baseBold = parseInt(getComputedStyle(el).fontWeight, 10) >= 600;
      const newHtml = textRunsToHtml(collectRuns(el), baseBold);
      if (newHtml !== obj.content) ctx.pushUndo();
      obj.content = newHtml;
      el.removeEventListener('blur', onBlur);
      ctx.renderObjects();
      ctx.markDirty();
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') el.blur(); });
  }

  function applyToSelectedText(fn) {
    ctx.pushUndo();
    for (const sid of ctx.selectedIds) {
      const o = ctx.findObject(sid);
      if (o && o.type === 'text') fn(o);
    }
    ctx.renderObjects();
    ctx.markDirty();
  }

  function pickCustomColor() {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#f0f0f0';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    input.addEventListener('change', () => {
      applyToSelectedText(o => { o.textColor = input.value; });
      input.remove();
    });
    input.addEventListener('cancel', () => input.remove());
  }

  // Exact icons from the original Sketchbook app
  const TEXT_ICONS = {
    title: '<svg viewBox="0 0 24 24"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg>',
    subtitle: '<svg viewBox="0 0 24 24"><path d="M7 7V4h10v3" opacity="0.7"/><line x1="12" y1="4" x2="12" y2="18"/><line x1="9" y1="18" x2="15" y2="18"/></svg>',
    description: '<svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="14" x2="16" y2="14"/><line x1="4" y1="18" x2="12" y2="18"/></svg>',
    menuText: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  };

  return {
    // ── STYLES ─────────────────────────────────────────────────────────
    css: `
      .canvas-obj.text-obj {
        padding: 8px 12px;
        min-width: 80px;
        min-height: 32px;
        white-space: pre-wrap;
        word-break: break-word;
        cursor: move;
      }
      .canvas-obj.text-obj[contenteditable="true"] {
        cursor: text;
        user-select: text;
        outline: 2px solid #F0C4A0;
        outline-offset: 2px;
      }
      .canvas-obj.text-obj .placeholder-text { color: #444; pointer-events: none; }
      /* Persisted rich runs (canonical vocabulary) */
      .canvas-obj.text-obj b { font-weight: 700; }
      .canvas-obj.text-obj .txt-nb { font-weight: 400; } /* un-bold on bold bases (Label) */
      .canvas-obj.text-obj.style-label {
        font-family: var(--font-sans);
        font-size: 168px;
        font-weight: 700;
        color: #f0f0f0;
        line-height: 1.05;
      }
      .canvas-obj.text-obj.style-title {
        font-family: var(--font-serif);
        font-size: 42px;
        font-weight: 600;
        color: #f0f0f0;
        line-height: 1.2;
      }
      .canvas-obj.text-obj.style-subtitle {
        font-family: var(--font-serif);
        font-size: 24px;
        font-weight: 400;
        font-style: italic;
        color: #cccccc;
        line-height: 1.3;
      }
      .canvas-obj.text-obj.style-description {
        font-family: var(--mono);
        font-size: 14px;
        font-weight: 400;
        color: #999999;
        line-height: 1.5;
      }
      .text-font-panel {
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
      .text-font-panel.visible { display: flex; }
      .text-font-panel input {
        background: #1a1a1a;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        color: #e0e0e0;
        padding: 8px 10px;
        font-size: 13px;
        outline: none;
      }
      .text-font-panel input::placeholder { color: #666; }
      .text-font-list { overflow-y: auto; flex: 1; }
      .text-font-item {
        padding: 8px 10px;
        color: #ccc;
        font-size: 15px;
        border-radius: 4px;
        cursor: pointer;
      }
      .text-font-item:hover { background: #363636; color: #fff; }
      .fc-color-row { display: flex; gap: 6px; padding: 7px 4px; }
      .text-color-swatch {
        box-sizing: border-box;
        width: 22px; height: 22px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.18);
        cursor: pointer;
        transition: transform 0.1s, border-color 0.1s;
      }
      .text-color-swatch:hover { transform: scale(1.18); border-color: #F0C4A0; }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      text: {
        defaults: { content: '', textStyle: 'title', fontFamily: null, textColor: null },

        normalize(obj) {
          if (!STYLES.includes(obj.textStyle)) obj.textStyle = 'title';
          if (typeof obj.content !== 'string') obj.content = '';
          // Migrate legacy PLAIN content (saved via textContent) to the
          // canonical rich-HTML vocabulary — escape once, newlines → <br>.
          if (obj.content && !looksCanonicalHtml(obj.content)) {
            obj.content = escapeHtml(obj.content).replace(/\r?\n/g, '<br>');
          }
        },

        // ── RENDERING ──
        render(obj, el) {
          el.classList.add('text-obj', 'style-' + obj.textStyle);
          // Text grows with content: width fixed, height is a minimum
          el.style.height = 'auto';
          el.style.minHeight = obj.h + 'px';
          if (obj.content) {
            el.innerHTML = obj.content; // canonical rich-text HTML (b/i/u/br/txt-nb)
          } else {
            const span = document.createElement('span');
            span.className = 'placeholder-text';
            span.textContent = PLACEHOLDERS[obj.textStyle] || 'Text';
            el.appendChild(span);
          }
          if (obj.fontFamily) el.style.fontFamily = obj.fontFamily;
          if (obj.textColor) el.style.color = obj.textColor;
          if (obj.fontFamily) {
            const bare = obj.fontFamily.replace(/^"|", .*$/g, '');
            loadGoogleFont(bare);
          }
        },

        onDoubleClick(obj, e, ctx) {
          const el = ctx.worldEl.querySelector(`[data-id="${obj.id}"]`);
          if (el) { ctx.selectObject(obj.id); startEdit(obj, el); }
        },

        // ── EXPORT ── rich runs (b/i/u/br/txt-nb) + word wrap. Each run
        // measures/draws with its own font variant; <br> is a hard break;
        // underline strokes under the drawn segment.
        exportDraw(c2d, obj, t) {
          const styles = {
            label: { size: 168, weight: '700', family: 'Inter, sans-serif', color: '#f0f0f0' },
            title: { size: 42, weight: '600', family: '"Cormorant Garamond", serif', color: '#f0f0f0' },
            subtitle: { size: 24, weight: '400', family: '"Cormorant Garamond", serif', style: 'italic', color: '#cccccc' },
            description: { size: 14, weight: '400', family: '"JetBrains Mono", monospace', color: '#999999' },
          };
          const s = styles[obj.textStyle] || styles.title;
          const baseItalic = s.style === 'italic';
          const family = obj.fontFamily || s.family;
          const px = s.size * t.scaleX;
          c2d.fillStyle = obj.textColor || s.color;
          c2d.textAlign = 'left';
          c2d.textBaseline = 'alphabetic';
          const fontFor = (r) => `${(baseItalic || r.italic) ? 'italic ' : ''}${r.nb ? '400' : (r.bold ? '700' : s.weight)} ${px}px ${family}`;
          // DOM-METRIC PARITY — the export must wrap exactly like the
          // canvas: .text-obj is a border-box with 8px/12px padding, so the
          // DOM wraps at w-24px and draws from (x+12, y+8); each style has
          // its own line-height (see the css block). First baseline follows
          // the CSS line box: half-leading plus the font's ascent
          // (measured; 0.8em/0.2em fallback).
          const LINE_HEIGHTS = { label: 1.05, title: 1.2, subtitle: 1.3, description: 1.5 };
          const padX = 12 * t.scaleX, padY = 8 * t.scaleY;
          const maxW = obj.w * t.scaleX - padX * 2;
          const lineH = px * (LINE_HEIGHTS[obj.textStyle] || 1.3);
          c2d.font = fontFor({});
          const fm = c2d.measureText('Mg');
          const fbA = fm.fontBoundingBoxAscent !== undefined ? fm.fontBoundingBoxAscent : px * 0.8;
          const fbD = fm.fontBoundingBoxDescent !== undefined ? fm.fontBoundingBoxDescent : px * 0.2;
          let lineY = t.y + padY + (lineH - (fbA + fbD)) / 2 + fbA;
          let segs = [], lineW = 0;
          const flushLine = () => {
            let x = t.x + padX;
            for (const g of segs) {
              c2d.font = g.font;
              c2d.fillText(g.text, x, lineY);
              if (g.underline) {
                c2d.strokeStyle = c2d.fillStyle;
                c2d.lineWidth = Math.max(1, px * 0.05);
                c2d.beginPath();
                c2d.moveTo(x, lineY + px * 0.12);
                c2d.lineTo(x + g.w, lineY + px * 0.12);
                c2d.stroke();
              }
              x += g.w;
            }
            segs = []; lineW = 0; lineY += lineH;
          };
          for (const r of parseTextRuns(obj.content)) {
            const pieces = r.text.split('\n');
            for (let pi = 0; pi < pieces.length; pi++) {
              if (pi > 0) flushLine(); // hard break (empty flush = blank line)
              const piece = pieces[pi];
              if (piece === '') continue;
              c2d.font = fontFor(r);
              for (const token of piece.split(/(\s+)/)) {
                if (token === '') continue;
                const w = c2d.measureText(token).width;
                if (lineW + w > maxW && lineW > 0 && token.trim() !== '') flushLine();
                if (token.trim() === '' && lineW === 0) continue; // no leading spaces
                segs.push({ text: token, font: fontFor(r), underline: r.underline, w });
                lineW += w;
              }
            }
          }
          if (segs.length) flushLine();
        },

        // ── MENUS ── exact hierarchy of the original app's text section:
        // Change Style ▶ [ Label · Title · Subtitle · Description ─ Custom
        // Font… ─ Default Color · (swatch row) · Custom Color… ]
        menu: (selObjs, ctx) => [
          {
            label: 'Change Style',
            icon: TEXT_ICONS.menuText,
            submenu: [
              { label: 'Label', action() { applyToSelectedText(o => { o.textStyle = 'label'; }); } },
              { label: 'Title', action() { applyToSelectedText(o => { o.textStyle = 'title'; }); } },
              { label: 'Subtitle', action() { applyToSelectedText(o => { o.textStyle = 'subtitle'; }); } },
              { label: 'Description', action() { applyToSelectedText(o => { o.textStyle = 'description'; }); } },
              { divider: true },
              {
                label: 'Custom Font…',
                action(ctx, e) {
                  const r = e && e.target ? e.target.getBoundingClientRect() : { right: window.innerWidth / 2, top: window.innerHeight / 2 };
                  showFontPanel(r.right, r.top);
                },
              },
              { divider: true },
              {
                label: 'Default Color',
                action() { applyToSelectedText(o => { o.textColor = null; }); },
              },
              {
                html: `<div class="fc-color-row">` + COLOR_SWATCHES.map(c =>
                  `<button class="text-color-swatch" data-text-color="${c}" style="background:${c}"></button>`
                ).join('') + `</div>`,
                onClick(e, ctx) {
                  const btn = e.target.closest('.text-color-swatch');
                  if (!btn) return;
                  ctx.closeMenus();
                  const c = btn.dataset.textColor;
                  applyToSelectedText(o => { o.textColor = c; });
                },
              },
              { label: 'Custom Color…', action() { pickCustomColor(); } },
            ],
          },
        ],
      },
    },

    // ── TOOLBAR ── one Text family button; hovering reveals the subfamily
    // (Label/Title/Subtitle/Description), same hierarchy as the right-click menu
    toolbar: [
      {
        icon: TEXT_ICONS.title,
        title: 'Text',
        order: 20,
        items: [
          { label: 'Label', order: 1, action(ctx) { addText('label'); } },
          { label: 'Title', order: 2, action(ctx) { addText('title'); } },
          { label: 'Subtitle', order: 3, action(ctx) { addText('subtitle'); } },
          { label: 'Description', order: 4, action(ctx) { addText('description'); } },
        ],
      },
    ],

    // ── MENUS ── "Add Text ▶" submenu, exactly like the original app
    canvasMenu: [
      {
        submenu: 'Add Text',
        icon: TEXT_ICONS.menuText,
        order: 20,
        items: [
          { label: 'Label', order: 1, action(ctx) { addText('label', ctx.contextWorld.x, ctx.contextWorld.y); } },
          { label: 'Title', order: 2, action(ctx) { addText('title', ctx.contextWorld.x, ctx.contextWorld.y); } },
          { label: 'Subtitle', order: 3, action(ctx) { addText('subtitle', ctx.contextWorld.x, ctx.contextWorld.y); } },
          { label: 'Description', order: 4, action(ctx) { addText('description', ctx.contextWorld.x, ctx.contextWorld.y); } },
        ],
      },
    ],
  };
}
