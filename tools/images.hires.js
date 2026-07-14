/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — images.hires.js — Add Hi-Res Image.

   THIS FILE IS A FORK (a remix). It is the canonical example of how a
   subfamily works: `basedOn: 'images'` makes it a child of the images
   family, and because it ADDS images, it contributes its entry to the
   'Add Images' family menus — the toolbar flyout and the right-click
   canvas submenu — right beside the baseline Add Image.

   (Operate-style subfamilies — e.g. filters that act on EXISTING images —
   contribute to the right-click-an-image menu instead, via
   objectMenus: { image: [...] }. See AGENTS.md.)

   It creates ordinary 'image' objects; the images family root owns the
   type (rendering, crop, export), so this file stays tiny.

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'images.hires',
  name: 'Add Hi-Res Image',
  version: '2.0.0',
  authors: ['santi'],
  basedOn: 'images',
  description: 'Import images at original resolution (up to 5MB, PNG transparency preserved).',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  // Hi-res: no 600x500 display cap — the object takes the image's real
  // size (the importer itself caps files at 5MB, preserving PNG alpha).
  async function addHiRes(wx, wy) {
    const results = await ctx.io.importImages({ hiRes: true });
    if (!results || results.length === 0) return;
    ctx.pushUndo();
    const center = (wx !== undefined) ? { x: wx, y: wy } : ctx.viewportCenter();
    let last = null;
    results.forEach((r, i) => {
      if (!r || r.error || !r.assetPath) return;
      const w = r.width, h = r.height;
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

  return {
    // ── TOOLBAR ── joins the 'Add Images' family flyout (same title merges)
    toolbar: [
      {
        title: 'Add Images',
        order: 10,
        items: [
          { label: 'Add Hi-Res Image', order: 2, action(ctx) { addHiRes(); } },
        ],
      },
    ],

    // ── MENUS ── joins the "Add Images ▶" right-click submenu
    canvasMenu: [
      {
        submenu: 'Add Images',
        order: 10,
        items: [
          { label: 'Add Hi-Res Image', order: 2, action(ctx) { addHiRes(ctx.contextWorld.x, ctx.contextWorld.y); } },
        ],
      },
    ],
  };
}
