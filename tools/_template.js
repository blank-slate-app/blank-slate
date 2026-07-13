/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — copy me to start a new tool.

   WHAT THIS IS: one self-contained plugin for the Blank-Slate canvas app.
   The app scans tools/*.js at startup and auto-generates this tool's
   toolbar button, right-click menu entries, and keyboard shortcut from
   what register(ctx) returns. No build step. No imports. One file.

   HOW TO USE THIS TEMPLATE
   1. Copy to a new file: <your-tool-id>.js  (filename must equal manifest.id)
   2. Fill in the manifest. New tool → basedOn: null. Remix of an existing
      tool → basedOn: '<original-id>' and APPEND your name to authors
      (never remove names — the author ledger is append-only).
   3. Keep the section banners below; fill what you need, delete what you
      don't. Full contract & walkthroughs: see AGENTS.md in this folder.

   THE THREE INVARIANTS (breaking these breaks undo/save for the user)
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)

   ONLY TOUCH ctx. Never window.api, never other tools' internals, never
   DOM outside elements you created. The full ctx API is listed in
   AGENTS.md — if it's not listed there, you don't have it.

   This demo tool is fully working: it adds a colored "block" object via
   toolbar button, canvas menu, or the B shortcut, with a right-click menu
   to recolor it. Replace everything with your own idea.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: '_template',            // ← change me (must match filename)
  name: 'Block',              // human name shown in menus/tooltips
  version: '1.0.0',
  authors: ['you'],           // append-only ledger
  basedOn: null,              // or the id of the tool you remixed
  description: 'A colored block — the smallest possible complete tool.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const COLORS = ['#F0C4A0', '#F05300', '#8FB996', '#7A9CC6'];

  function addBlock(x, y) {
    ctx.pushUndo();
    const center = (x === undefined) ? ctx.viewportCenter() : { x, y };
    const obj = ctx.createObject({
      type: 'block',
      x: center.x - 80, y: center.y - 50,
      w: 160, h: 100,
    });
    ctx.selectObject(obj.id);
    ctx.renderObjects();
    ctx.markDirty();
  }

  return {
    // ── STYLES ─────────────────────────────────────────────────────────
    // Prefix every selector with your own class names; injected once.
    css: `
      .block-obj {
        border-radius: 4px;
        border: 1px solid rgba(0,0,0,0.25);
      }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      block: {
        defaults: { color: '#F0C4A0' },

        // Sanitize loaded/pasted data (runs on every load — be gentle,
        // preserve fields you don't recognize).
        normalize(obj) {
          if (!COLORS.includes(obj.color) && !/^#[0-9a-fA-F]{6}$/.test(obj.color || '')) {
            obj.color = '#F0C4A0';
          }
        },

        // ── RENDERING ── populate el; it is already positioned/sized.
        render(obj, el) {
          el.classList.add('block-obj');
          el.style.background = obj.color;
        },

        // ── MENUS & ACTIONS ── right-click menu when a block is selected.
        menu: [
          {
            label: 'Change Color',
            submenu: COLORS.map(c => ({
              label: c,
              action(ctx) {
                ctx.pushUndo();
                for (const id of ctx.selectedIds) {
                  const o = ctx.findObject(id);
                  if (o && o.type === 'block') o.color = c;
                }
                ctx.renderObjects();
                ctx.markDirty();
              },
            })),
          },
        ],
      },
    },

    // ── TOOLBAR ── an immediate action button (see AGENTS.md for modal
    // tools with tool: { onPointerDown } instead).
    toolbar: [
      {
        icon: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/></svg>',
        title: 'Add Block (B)',
        order: 90,
        action(ctx) { addBlock(); },
      },
    ],

    // Right-click on empty canvas → "Add Block" where the cursor is.
    canvasMenu: [
      {
        label: 'Add Block',
        group: 'add',
        order: 90,
        action(ctx) { addBlock(ctx.contextWorld.x, ctx.contextWorld.y); },
      },
    ],

    // Plain keyboard shortcut (modal tools declare shortcut inside tool:{})
    shortcuts: [
      { key: 'b', action() { addBlock(); } },
    ],
  };
}
