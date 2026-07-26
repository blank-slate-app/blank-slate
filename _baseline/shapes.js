/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — shapes.js — the Rectangle (striped shape marker).

   BASELINE TOOL. Edit freely — a pristine copy lives in ../baseline/ and
   the app can always revert this file. To remix: copy to
   shapes.<yourname>.js, set basedOn: 'shapes', append your name to
   authors, and RENAME the object type (e.g. 'shape-solid').

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   OBJECT: type 'shape' — a bordered, diagonally-striped rectangle used to
   block out areas on a board. Geometry only (x/y/w/h); no extra fields.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'shapes',
  name: 'Rectangle',
  version: '2.0.0',
  authors: ['Forma Rosa Creative'],
  basedOn: null,
  description: 'Drag out striped rectangle markers.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  // Drag preview (one reusable element in world space)
  const preview = document.createElement('div');
  preview.className = 'shape-draw-preview';
  ctx.worldEl.appendChild(preview);

  return {
    // ── STYLES ─────────────────────────────────────────────────────────
    css: `
      .canvas-obj.shape-obj {
        border: 3px solid #F0C4A0;
        border-radius: 2px;
        background: repeating-linear-gradient(
          45deg,
          rgba(240, 196, 160, 0.15),
          rgba(240, 196, 160, 0.15) 2px,
          transparent 2px,
          transparent 12px
        );
      }
      .shape-draw-preview {
        position: absolute;
        display: none;
        border: 2px dashed #F0C4A0;
        background: rgba(240, 196, 160, 0.05);
        pointer-events: none;
        z-index: 9998;
      }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      shape: {
        defaults: {},
        render(obj, el) {
          el.classList.add('shape-obj');
        },
        // ── EXPORT ── (used by the artboard export shell once it lands)
        exportDraw(c2d, obj, t) {
          c2d.fillStyle = 'rgba(240, 196, 160, 0.3)';
          c2d.strokeStyle = '#F0C4A0';
          c2d.lineWidth = 2 * t.scaleX;
          c2d.fillRect(t.x, t.y, obj.w * t.scaleX, obj.h * t.scaleY);
          c2d.strokeRect(t.x, t.y, obj.w * t.scaleX, obj.h * t.scaleY);
        },
      },
    },

    // ── THE RECTANGLE (modal tool) ─────────────────────────────────────
    tool: {
      icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none"/></svg>',
      title: 'Rectangle (R)',
      family: 'Annotate',        // one rail button shared by shapes/draw/eyedropper/markup
      familyIcon: '<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
      familyOrder: 30,
      order: 1,                  // position inside the Annotate flyout
      dividerBefore: true,       // opens the annotate band on the rail
      flyoutIcon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>',
      shortcut: 'r',
      cursor: 'crosshair',

      onPointerDown(e, ctx) {
        if (e.target.closest('.resize-handle') || e.target.closest('[contenteditable="true"]')) return false;
        e.preventDefault();
        ctx.clearSelection();
        const sw = ctx.screenToWorld(e.clientX, e.clientY);
        preview.style.display = 'block';
        preview.style.left = sw.x + 'px';
        preview.style.top = sw.y + 'px';
        preview.style.width = '0px';
        preview.style.height = '0px';

        function onMove(ev) {
          const c = ctx.screenToWorld(ev.clientX, ev.clientY);
          preview.style.left = Math.min(sw.x, c.x) + 'px';
          preview.style.top = Math.min(sw.y, c.y) + 'px';
          preview.style.width = Math.abs(c.x - sw.x) + 'px';
          preview.style.height = Math.abs(c.y - sw.y) + 'px';
        }
        function onUp(ev) {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          preview.style.display = 'none';
          const ew = ctx.screenToWorld(ev.clientX, ev.clientY);
          const rw = Math.abs(ew.x - sw.x), rh = Math.abs(ew.y - sw.y);
          if (rw > 10 && rh > 10) {
            ctx.pushUndo();
            const obj = ctx.createObject({
              type: 'shape',
              x: Math.min(sw.x, ew.x), y: Math.min(sw.y, ew.y),
              w: rw, h: rh,
            });
            ctx.selectObject(obj.id);
            ctx.renderObjects();
            ctx.markDirty();
          }
          ctx.setTool(null); // one shape per activation, like the original
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return true; // consumed
      },
    },

    // ── MENUS ── entry in the shared "Annotate ▶" submenu (merged across
    // shapes/markup/draw/eyedropper), exactly like the original app
    canvasMenu: [
      {
        submenu: 'Annotate',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
        order: 90,
        dividerBefore: true,
        items: [
          {
            label: 'Rectangle',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>',
            order: 1,
            action(ctx) { ctx.setTool('shapes'); },
          },
        ],
      },
    ],
  };
}
