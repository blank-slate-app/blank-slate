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
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'text',
  name: 'Text',
  version: '2.0.0',
  authors: ['santi'],
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
      const newText = el.textContent.trim();
      if (newText !== obj.content) ctx.pushUndo();
      obj.content = newText;
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
        },

        // ── RENDERING ──
        render(obj, el) {
          el.classList.add('text-obj', 'style-' + obj.textStyle);
          // Text grows with content: width fixed, height is a minimum
          el.style.height = 'auto';
          el.style.minHeight = obj.h + 'px';
          if (obj.content) {
            el.textContent = obj.content;
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

        // ── EXPORT ── (used by the artboard export shell once it lands)
        exportDraw(c2d, obj, t) {
          const styles = {
            label: { size: 168, weight: '700', family: 'Inter, sans-serif', color: '#f0f0f0' },
            title: { size: 42, weight: '600', family: '"Cormorant Garamond", serif', color: '#f0f0f0' },
            subtitle: { size: 24, weight: '400', family: '"Cormorant Garamond", serif', style: 'italic', color: '#cccccc' },
            description: { size: 14, weight: '400', family: '"JetBrains Mono", monospace', color: '#999999' },
          };
          const s = styles[obj.textStyle] || styles.title;
          const italic = s.style === 'italic' ? 'italic ' : '';
          const family = obj.fontFamily || s.family;
          c2d.font = `${italic}${s.weight} ${s.size * t.scaleX}px ${family}`;
          c2d.fillStyle = obj.textColor || s.color;
          c2d.textAlign = 'left';
          c2d.textBaseline = 'top';
          // Simple word-wrap inside the object's width
          const words = (obj.content || '').split(' ');
          const maxW = obj.w * t.scaleX;
          let line = '', ty = t.y;
          for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (c2d.measureText(test).width > maxW && line) {
              c2d.fillText(line, t.x, ty);
              line = word;
              ty += s.size * t.scaleX * 1.3;
            } else line = test;
          }
          if (line) c2d.fillText(line, t.x, ty);
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
