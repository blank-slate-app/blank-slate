/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — draw.js — the Pen (freehand drawing).

   BASELINE TOOL. Edit freely — a pristine copy lives in ../baseline/ and
   the app can always revert this file. To remix instead of editing:
   copy to draw.<yourname>.js, set basedOn: 'draw', append your name to
   authors, and RENAME the object type (e.g. 'drawing-neon').

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   OBJECT: type 'drawing' — { points: [{x,y}...] in local coords,
   strokeColor, strokeWidth, viewW, viewH }. viewW/viewH freeze the
   coordinate space at creation so resizing the box stretches the stroke
   naturally (the original app distorted here; this is the faithful fix).
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'draw',
  name: 'Pen',
  version: '2.0.0',
  authors: ['santi'],
  basedOn: null,
  description: 'Freehand pen strokes with color and width.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  let drawColor = '#F0C4A0';
  let drawSize = 4;

  // ── The bottom bar (color + width) ───────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'draw-bar';
  bar.innerHTML = `
    <label class="draw-bar-swatch">
      <input type="color" value="${drawColor}">
    </label>
    <div class="draw-bar-preview"><div class="draw-bar-dot"></div></div>
    <input type="range" min="2" max="20" value="${drawSize}">
  `;
  const colorInput = bar.querySelector('input[type="color"]');
  const sizeInput = bar.querySelector('input[type="range"]');
  const sizeDot = bar.querySelector('.draw-bar-dot');
  function refreshDot() {
    sizeDot.style.width = drawSize + 'px';
    sizeDot.style.height = drawSize + 'px';
    sizeDot.style.background = drawColor;
  }
  colorInput.addEventListener('input', () => { drawColor = colorInput.value; refreshDot(); });
  sizeInput.addEventListener('input', () => { drawSize = parseInt(sizeInput.value, 10); refreshDot(); });
  refreshDot();

  function svgPathD(points) {
    if (!points || points.length < 1) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
    return d;
  }

  return {
    // ── STYLES ─────────────────────────────────────────────────────────
    css: `
      .drawing-obj svg { display: block; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
      .draw-bar {
        display: flex; align-items: center; gap: 12px;
        background: #171614; border: 1px solid #29251f; border-radius: 8px;
        padding: 8px 14px; box-shadow: 0 6px 20px rgba(0,0,0,0.4);
      }
      .draw-bar-swatch input[type="color"] {
        width: 28px; height: 28px; border: none; border-radius: 4px;
        background: none; cursor: pointer; padding: 0;
      }
      .draw-bar-preview {
        width: 24px; height: 24px; display: flex;
        align-items: center; justify-content: center;
      }
      .draw-bar-dot { border-radius: 50%; }
      .draw-bar input[type="range"] { width: 110px; accent-color: #F0C9B4; cursor: pointer; }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      drawing: {
        defaults: { points: [], strokeColor: '#F0C4A0', strokeWidth: 4, viewW: null, viewH: null },

        normalize(obj) {
          obj.points = Array.isArray(obj.points)
            ? obj.points.filter(p => p && isFinite(p.x) && isFinite(p.y))
            : [];
          obj.strokeWidth = Math.min(40, Math.max(1, Number(obj.strokeWidth) || 4));
          if (!/^#[0-9a-fA-F]{6}$/.test(obj.strokeColor || '')) obj.strokeColor = '#F0C4A0';
          // Legacy drawings (old app) have no frozen view size — adopt the
          // current box so they render exactly as saved.
          if (!isFinite(obj.viewW) || obj.viewW <= 0) obj.viewW = obj.w;
          if (!isFinite(obj.viewH) || obj.viewH <= 0) obj.viewH = obj.h;
        },

        // ── RENDERING ──
        render(obj, el) {
          el.classList.add('drawing-obj');
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', `0 0 ${obj.viewW} ${obj.viewH}`);
          svg.setAttribute('preserveAspectRatio', 'none');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', svgPathD(obj.points));
          path.setAttribute('stroke', obj.strokeColor);
          path.setAttribute('stroke-width', obj.strokeWidth);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          svg.appendChild(path);
          el.appendChild(svg);
        },

        // ── EXPORT ── (used by the artboard export shell once it lands)
        exportDraw(c2d, obj, t) {
          if (!obj.points || obj.points.length < 2) return;
          const sx = (obj.w / obj.viewW) * t.scaleX;
          const sy = (obj.h / obj.viewH) * t.scaleY;
          c2d.strokeStyle = obj.strokeColor;
          c2d.lineWidth = obj.strokeWidth * Math.min(sx, sy);
          c2d.lineCap = 'round';
          c2d.lineJoin = 'round';
          c2d.beginPath();
          c2d.moveTo(t.x + obj.points[0].x * sx, t.y + obj.points[0].y * sy);
          for (let i = 1; i < obj.points.length; i++) {
            c2d.lineTo(t.x + obj.points[i].x * sx, t.y + obj.points[i].y * sy);
          }
          c2d.stroke();
        },
      },
    },

    // ── THE PEN (modal tool) ───────────────────────────────────────────
    tool: {
      icon: '<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
      title: 'Draw (D)',
      family: 'Annotate',        // one rail button shared by shapes/draw/eyedropper/markup
      familyIcon: '<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
      familyOrder: 30,
      order: 3,                  // position inside the Annotate flyout
      flyoutIcon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
      shortcut: 'd',
      cursor: 'crosshair',

      onActivate(ctx) { ctx.showBar(bar); },
      onDeactivate(ctx) { ctx.hideBar(); },

      onPointerDown(e, ctx) {
        // Let resize handles / text editing win even while the pen is active
        if (e.target.closest('.resize-handle') || e.target.closest('[contenteditable="true"]')) return false;
        e.preventDefault();
        ctx.clearSelection();

        const points = [{ x: 0, y: 0 }];
        const sw = ctx.screenToWorld(e.clientX, e.clientY);
        let minX = sw.x, minY = sw.y, maxX = sw.x, maxY = sw.y;

        // Live preview stroke in world space
        const previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        previewSvg.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:9999';
        const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        previewPath.setAttribute('stroke', drawColor);
        previewPath.setAttribute('stroke-width', drawSize);
        previewPath.setAttribute('fill', 'none');
        previewPath.setAttribute('stroke-linecap', 'round');
        previewPath.setAttribute('stroke-linejoin', 'round');
        previewSvg.appendChild(previewPath);
        ctx.worldEl.appendChild(previewSvg);

        function onMove(ev) {
          const c = ctx.screenToWorld(ev.clientX, ev.clientY);
          points.push({ x: c.x - sw.x, y: c.y - sw.y });
          if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y;
          if (c.x > maxX) maxX = c.x; if (c.y > maxY) maxY = c.y;
          let d = `M ${sw.x} ${sw.y}`;
          for (let i = 1; i < points.length; i++) d += ` L ${sw.x + points[i].x} ${sw.y + points[i].y}`;
          previewPath.setAttribute('d', d);
        }

        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          previewSvg.remove();

          if (points.length < 2) return;
          const pad = drawSize;
          const bx = minX - pad, by = minY - pad;
          const bw = (maxX - minX) + pad * 2;
          const bh = (maxY - minY) + pad * 2;
          if (bw < 2 || bh < 2) return;

          const localPts = points.map(p => ({
            x: (sw.x + p.x) - bx,
            y: (sw.y + p.y) - by,
          }));

          ctx.pushUndo();
          const obj = ctx.createObject({
            type: 'drawing',
            x: bx, y: by, w: bw, h: bh,
            viewW: bw, viewH: bh,
            points: localPts,
            strokeColor: drawColor,
            strokeWidth: drawSize,
          });
          ctx.selectObject(obj.id);
          ctx.renderObjects();
          ctx.markDirty();
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
            label: 'Pen',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
            order: 3,
            action(ctx) { ctx.setTool('draw'); },
          },
        ],
      },
    ],
  };
}
