/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — markup.js — revision cloud + leader + note.

   BASELINE TOOL. Edit freely — a pristine copy lives in ../baseline/ and
   the app can always revert this file. To remix: copy to
   markup.<yourname>.js, set basedOn: 'markup', append your name to
   authors, and RENAME the object type (e.g. 'markup-blue').

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   FLOW (identical to the original): activate (M) → step 1: drag a red
   rectangle around the area → step 2: click where the note should sit →
   type the note. Drag the note text later to re-route the leader arrow;
   double-click the note to edit it.

   OBJECT: type 'markup' — { cloud: {rx,ry,rw,rh}, leader: {tx,ty},
   markupText } — all in local (object-relative) coordinates.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'markup',
  name: 'Markup',
  version: '2.0.0',
  authors: ['santi'],
  basedOn: null,
  description: 'Revision clouds with a leader arrow and an editable note.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const RED = '#ff4444';
  let build = null; // null | { step: 1 } | { step: 2, rx, ry, rw, rh }

  // Step indicator bar (bottom-center slot)
  const bar = document.createElement('div');
  bar.className = 'markup-bar';
  bar.innerHTML = `
    <div class="step-num">1</div>
    <span class="step-text">Draw rectangle around area</span>
  `;
  const stepNum = bar.querySelector('.step-num');
  const stepText = bar.querySelector('.step-text');
  function setStep(n, text) { stepNum.textContent = String(n); stepText.textContent = text; }

  // Drag preview (red dashed)
  const preview = document.createElement('div');
  preview.className = 'markup-draw-preview';
  ctx.worldEl.appendChild(preview);

  // Cloud path: arc bumps along the rectangle edges (shared by render+export)
  function cloudPathD(c, arcR) {
    let d = '';
    const cx1 = c.rx, cy1 = c.ry, cx2 = c.rx + c.rw, cy2 = c.ry + c.rh;
    for (let x = cx1; x < cx2; x += arcR * 2) {
      const end = Math.min(x + arcR * 2, cx2);
      d += d ? '' : `M ${cx1} ${cy1}`;
      d += ` A ${arcR} ${arcR} 0 0 1 ${end} ${cy1}`;
    }
    for (let y = cy1; y < cy2; y += arcR * 2) {
      const end = Math.min(y + arcR * 2, cy2);
      d += ` A ${arcR} ${arcR} 0 0 1 ${cx2} ${end}`;
    }
    for (let x = cx2; x > cx1; x -= arcR * 2) {
      const end = Math.max(x - arcR * 2, cx1);
      d += ` A ${arcR} ${arcR} 0 0 1 ${end} ${cy2}`;
    }
    for (let y = cy2; y > cy1; y -= arcR * 2) {
      const end = Math.max(y - arcR * 2, cy1);
      d += ` A ${arcR} ${arcR} 0 0 1 ${cx1} ${end}`;
    }
    return d + ' Z';
  }

  // Leader geometry: text corner → cloud edge (shared by render+export)
  function leaderGeometry(c, l) {
    const cloudCx = c.rx + c.rw / 2, cloudCy = c.ry + c.rh / 2;
    const textAnchor = { x: l.tx, y: l.ty + 20 };
    const dx = textAnchor.x - cloudCx, dy = textAnchor.y - cloudCy;
    const GAP = 14;
    let arrowEnd;
    if (Math.abs(dx) === 0 && Math.abs(dy) === 0) {
      arrowEnd = { x: cloudCx, y: c.ry - GAP };
    } else {
      const scaleX = dx !== 0 ? (c.rw / 2) / Math.abs(dx) : Infinity;
      const scaleY = dy !== 0 ? (c.rh / 2) / Math.abs(dy) : Infinity;
      const s = Math.min(scaleX, scaleY);
      const edgeX = cloudCx + dx * s, edgeY = cloudCy + dy * s;
      const toDist = Math.hypot(dx, dy);
      arrowEnd = {
        x: edgeX + (dx / toDist) * GAP,
        y: edgeY + (dy / toDist) * GAP,
      };
    }
    const mx = (textAnchor.x + arrowEnd.x) / 2, my = (textAnchor.y + arrowEnd.y) / 2;
    const dist = Math.hypot(arrowEnd.x - textAnchor.x, arrowEnd.y - textAnchor.y) || 1;
    const perpX = -(arrowEnd.y - textAnchor.y) / dist, perpY = (arrowEnd.x - textAnchor.x) / dist;
    const curvature = Math.min(dist * 0.25, 60);
    const cp = { x: mx + perpX * curvature, y: my + perpY * curvature };
    return { textAnchor, arrowEnd, cp, cloudCx };
  }

  function startEditNote(obj, textEl) {
    textEl.contentEditable = 'true';
    if (!obj.markupText) textEl.textContent = '';
    textEl.focus();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    function onBlur() {
      textEl.contentEditable = 'false';
      const newT = textEl.textContent.trim();
      if (newT !== obj.markupText) ctx.pushUndo();
      obj.markupText = newT || 'Note';
      textEl.removeEventListener('blur', onBlur);
      ctx.renderObjects();
      ctx.markDirty();
    }
    textEl.addEventListener('blur', onBlur);
    textEl.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') textEl.blur(); });
  }

  return {
    // ── STYLES ── (exact values from the original app)
    css: `
      .canvas-obj.markup-obj {
        background: transparent;
        overflow: visible;
      }
      .canvas-obj.markup-obj svg {
        position: absolute;
        overflow: visible;
        stroke-linecap: round;
        stroke-linejoin: round;
        fill: none;
        pointer-events: none;
      }
      .canvas-obj.markup-obj .markup-text {
        position: absolute;
        color: ${'#ff4444'};
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 500;
        padding: 2px 4px;
        background: transparent;
        border: none;
        white-space: pre-wrap;
        word-break: break-word;
        min-width: 40px;
        min-height: 20px;
        line-height: 1.4;
        cursor: move;
      }
      .canvas-obj.markup-obj .markup-text[contenteditable="true"] {
        cursor: text;
        user-select: text;
        outline: 1px dashed #ff4444;
        outline-offset: 2px;
      }
      .markup-draw-preview {
        position: absolute;
        display: none;
        border: 2px dashed #ff4444;
        background: rgba(255,68,68,0.05);
        pointer-events: none;
        z-index: 9998;
      }
      .markup-bar {
        display: flex;
        background: #2a2a2a;
        border: 1px solid #3a3a3a;
        border-radius: 10px;
        padding: 8px 18px;
        align-items: center;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        font-family: var(--font-sans);
        color: #999;
        font-size: 13px;
        gap: 8px;
      }
      .markup-bar .step-num {
        background: #ff4444;
        color: #fff;
        width: 20px; height: 20px;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 600;
      }
    `,

    // ── OBJECT TYPE ────────────────────────────────────────────────────
    objectTypes: {
      markup: {
        defaults: { cloud: null, leader: null, markupText: '' },

        normalize(obj) {
          if (obj.cloud && !(isFinite(obj.cloud.rx) && isFinite(obj.cloud.rw))) obj.cloud = null;
          if (obj.leader && !(isFinite(obj.leader.tx) && isFinite(obj.leader.ty))) obj.leader = null;
          if (typeof obj.markupText !== 'string') obj.markupText = '';
        },

        // ── RENDERING ── revision cloud + curved leader + note text
        render(obj, el) {
          if (!obj.cloud || !obj.leader) return;
          el.classList.add('markup-obj');
          const c = obj.cloud, l = obj.leader;

          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.style.left = '0'; svg.style.top = '0';
          svg.style.width = obj.w + 'px'; svg.style.height = obj.h + 'px';

          const cloudPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          cloudPath.setAttribute('d', cloudPathD(c, 10));
          cloudPath.setAttribute('stroke', RED);
          cloudPath.setAttribute('stroke-width', '2');
          cloudPath.setAttribute('fill', 'none');
          svg.appendChild(cloudPath);

          const g = leaderGeometry(c, l);
          const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          curve.setAttribute('d', `M ${g.textAnchor.x} ${g.textAnchor.y} Q ${g.cp.x} ${g.cp.y} ${g.arrowEnd.x} ${g.arrowEnd.y}`);
          curve.setAttribute('stroke', RED);
          curve.setAttribute('stroke-width', '2');
          curve.setAttribute('fill', 'none');
          svg.appendChild(curve);

          const angle = Math.atan2(g.arrowEnd.y - g.cp.y, g.arrowEnd.x - g.cp.x);
          const aLen = 12, aSpread = 0.35;
          const ah1x = g.arrowEnd.x - aLen * Math.cos(angle - aSpread);
          const ah1y = g.arrowEnd.y - aLen * Math.sin(angle - aSpread);
          const ah2x = g.arrowEnd.x - aLen * Math.cos(angle + aSpread);
          const ah2y = g.arrowEnd.y - aLen * Math.sin(angle + aSpread);
          const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          arrow.setAttribute('d', `M ${ah1x} ${ah1y} L ${g.arrowEnd.x} ${g.arrowEnd.y} L ${ah2x} ${ah2y} Z`);
          arrow.setAttribute('stroke', RED);
          arrow.setAttribute('stroke-width', '1.5');
          arrow.setAttribute('fill', RED);
          svg.appendChild(arrow);

          el.appendChild(svg);

          // Note text — right-aligned when it sits left of the cloud
          const textDiv = document.createElement('div');
          textDiv.className = 'markup-text';
          textDiv.style.top = l.ty + 'px';
          textDiv.style.width = 'max-content';
          textDiv.style.maxWidth = '250px';
          if (l.tx < g.cloudCx) {
            textDiv.style.left = l.tx + 'px';
            textDiv.style.transform = 'translateX(-100%)';
            textDiv.style.textAlign = 'right';
          } else {
            textDiv.style.left = l.tx + 'px';
            textDiv.style.textAlign = 'left';
          }
          textDiv.textContent = obj.markupText || 'Note';
          el.appendChild(textDiv);
        },

        onDoubleClick(obj, e, ctx) {
          const textEl = ctx.worldEl.querySelector(`[data-id="${obj.id}"] .markup-text`);
          if (!textEl) return false;
          ctx.selectObject(obj.id);
          startEditNote(obj, textEl);
          return true;
        },

        // ── EXPORT ── same geometry, scaled (unique var names on purpose —
        // dx/dy shadowing in this renderer bit us once in the original app)
        exportDraw(c2d, obj, t) {
          if (!obj.cloud || !obj.leader) return;
          const c = obj.cloud, l = obj.leader;
          const X = (v) => t.x + v * t.scaleX;
          const Y = (v) => t.y + v * t.scaleY;
          c2d.strokeStyle = RED;
          c2d.fillStyle = RED;
          c2d.lineWidth = 2 * t.scaleX;
          c2d.lineCap = 'round';
          c2d.lineJoin = 'round';

          // Cloud arcs
          const arcR = 10 * t.scaleX;
          const ccx1 = X(c.rx), ccy1 = Y(c.ry);
          const ccx2 = X(c.rx + c.rw), ccy2 = Y(c.ry + c.rh);
          c2d.beginPath();
          c2d.moveTo(ccx1, ccy1);
          for (let px = ccx1; px < ccx2; px += arcR * 2) {
            const end = Math.min(px + arcR * 2, ccx2);
            c2d.arc((px + end) / 2, ccy1, (end - px) / 2, Math.PI, 0, false);
          }
          for (let py = ccy1; py < ccy2; py += arcR * 2) {
            const end = Math.min(py + arcR * 2, ccy2);
            c2d.arc(ccx2, (py + end) / 2, (end - py) / 2, -Math.PI / 2, Math.PI / 2, false);
          }
          for (let px = ccx2; px > ccx1; px -= arcR * 2) {
            const end = Math.max(px - arcR * 2, ccx1);
            c2d.arc((px + end) / 2, ccy2, (px - end) / 2, 0, Math.PI, false);
          }
          for (let py = ccy2; py > ccy1; py -= arcR * 2) {
            const end = Math.max(py - arcR * 2, ccy1);
            c2d.arc(ccx1, (py + end) / 2, (py - end) / 2, Math.PI / 2, -Math.PI / 2, false);
          }
          c2d.stroke();

          // Leader curve + arrowhead (geometry in local coords, then scaled)
          const g = leaderGeometry(c, l);
          c2d.beginPath();
          c2d.moveTo(X(g.textAnchor.x), Y(g.textAnchor.y));
          c2d.quadraticCurveTo(X(g.cp.x), Y(g.cp.y), X(g.arrowEnd.x), Y(g.arrowEnd.y));
          c2d.stroke();

          const ang = Math.atan2(Y(g.arrowEnd.y) - Y(g.cp.y), X(g.arrowEnd.x) - X(g.cp.x));
          const aLen = 12 * t.scaleX, aSpread = 0.35;
          c2d.beginPath();
          c2d.moveTo(X(g.arrowEnd.x) - aLen * Math.cos(ang - aSpread), Y(g.arrowEnd.y) - aLen * Math.sin(ang - aSpread));
          c2d.lineTo(X(g.arrowEnd.x), Y(g.arrowEnd.y));
          c2d.lineTo(X(g.arrowEnd.x) - aLen * Math.cos(ang + aSpread), Y(g.arrowEnd.y) - aLen * Math.sin(ang + aSpread));
          c2d.closePath();
          c2d.fill();

          // Word-wrapped note text
          const fontSize = 14 * t.scaleX;
          c2d.font = `500 ${fontSize}px Inter, -apple-system, sans-serif`;
          const words = String(obj.markupText || 'Note').split(' ');
          const maxW = 250 * t.scaleX;
          const rightAlign = l.tx < (c.rx + c.rw / 2);
          c2d.textAlign = rightAlign ? 'right' : 'left';
          c2d.textBaseline = 'top';
          let line = '', lineY = Y(l.ty) + 2 * t.scaleY;
          const tx0 = X(l.tx);
          for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (c2d.measureText(test).width > maxW && line) {
              c2d.fillText(line, tx0, lineY);
              line = word;
              lineY += fontSize * 1.4;
            } else line = test;
          }
          if (line) c2d.fillText(line, tx0, lineY);
          c2d.textAlign = 'left';
        },
      },
    },

    // ── THE MARKUP TOOL (modal, 3 steps) ───────────────────────────────
    tool: {
      icon: '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
      title: 'Markup (M)',
      family: 'Annotate',
      familyIcon: '<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
      familyOrder: 30,
      order: 2,                  // Annotate flyout: Rectangle · Markup · Pen · Eyedropper
      flyoutIcon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>',
      shortcut: 'm',
      cursor: 'crosshair',

      onActivate(ctx) {
        build = null;
        setStep(1, 'Draw rectangle around area');
        ctx.showBar(bar);
      },
      onDeactivate(ctx) {
        build = null;
        preview.style.display = 'none';
        ctx.hideBar();
      },

      onPointerDown(e, ctx) {
        if (e.target.closest('.resize-handle') || e.target.closest('[contenteditable="true"]')) return false;

        // Step 1: drag the revision-cloud rectangle
        if (!build || build.step === 1) {
          e.preventDefault();
          ctx.clearSelection();
          build = { step: 1 };
          const sw = ctx.screenToWorld(e.clientX, e.clientY);
          preview.style.display = 'block';
          preview.style.left = sw.x + 'px';
          preview.style.top = sw.y + 'px';
          preview.style.width = '0px';
          preview.style.height = '0px';

          function onMove(ev) {
            const cpt = ctx.screenToWorld(ev.clientX, ev.clientY);
            preview.style.left = Math.min(sw.x, cpt.x) + 'px';
            preview.style.top = Math.min(sw.y, cpt.y) + 'px';
            preview.style.width = Math.abs(cpt.x - sw.x) + 'px';
            preview.style.height = Math.abs(cpt.y - sw.y) + 'px';
          }
          function onUp(ev) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            preview.style.display = 'none';
            const ew = ctx.screenToWorld(ev.clientX, ev.clientY);
            const rw = Math.abs(ew.x - sw.x), rh = Math.abs(ew.y - sw.y);
            if (rw < 10 || rh < 10) { build = null; return; }
            build = {
              step: 2,
              rx: Math.min(sw.x, ew.x), ry: Math.min(sw.y, ew.y),
              rw, rh,
            };
            setStep(2, 'Click where to place the note');
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return true;
        }

        // Step 2: click to place the note; create the object and edit
        if (build && build.step === 2) {
          e.preventDefault();
          const tw = ctx.screenToWorld(e.clientX, e.clientY);
          const PAD = 20;
          const allX = [build.rx, build.rx + build.rw, tw.x, tw.x + 150];
          const allY = [build.ry, build.ry + build.rh, tw.y, tw.y + 30];
          const bx = Math.min(...allX) - PAD;
          const by = Math.min(...allY) - PAD;
          const bx2 = Math.max(...allX) + PAD;
          const by2 = Math.max(...allY) + PAD;

          ctx.pushUndo();
          const obj = ctx.createObject({
            type: 'markup',
            x: bx, y: by, w: bx2 - bx, h: by2 - by,
            cloud: {
              rx: build.rx - bx,
              ry: build.ry - by,
              rw: build.rw,
              rh: build.rh,
            },
            leader: { tx: tw.x - bx, ty: tw.y - by },
            markupText: '',
          });
          ctx.selectObject(obj.id);
          ctx.renderObjects();
          ctx.markDirty();

          setTimeout(() => {
            const textEl = ctx.worldEl.querySelector(`[data-id="${obj.id}"] .markup-text`);
            if (textEl) startEditNote(obj, textEl);
          }, 50);

          build = null;
          setStep(1, 'Draw rectangle around area');
          return true;
        }
        return true;
      },
    },

    // ── RAW POINTER ── drag the note text to re-route the leader (works
    // in pointer mode, pre-empting object move — priority 250)
    pointer: [
      {
        priority: 250,
        handler(e, ctx) {
          if (e.button !== 0) return false;
          const markupTextEl = e.target.closest('.markup-text');
          if (!markupTextEl || markupTextEl.isContentEditable) return false;
          const objEl = e.target.closest('.canvas-obj');
          if (!objEl) return false;
          const obj = ctx.findObject(parseInt(objEl.dataset.id));
          if (!obj || obj.type !== 'markup' || !obj.leader) return false;

          e.preventDefault();
          ctx.pushUndo();
          ctx.selectObject(obj.id);
          const sx = e.clientX, sy = e.clientY;
          const origTx = obj.leader.tx, origTy = obj.leader.ty;
          const zoom = ctx.getZoom();

          function onMove(ev) {
            const ddx = (ev.clientX - sx) / zoom;
            const ddy = (ev.clientY - sy) / zoom;
            obj.leader.tx = origTx + ddx;
            obj.leader.ty = origTy + ddy;

            // Expand the bounding box if the note moved outside it
            const PAD = 20;
            const allX = [obj.cloud.rx, obj.cloud.rx + obj.cloud.rw, obj.leader.tx, obj.leader.tx + 150];
            const allY = [obj.cloud.ry, obj.cloud.ry + obj.cloud.rh, obj.leader.ty, obj.leader.ty + 30];
            const minX = Math.min(...allX) - PAD, minY = Math.min(...allY) - PAD;
            const maxX = Math.max(...allX) + PAD, maxY = Math.max(...allY) + PAD;
            const shiftX = minX < 0 ? minX : 0;
            const shiftY = minY < 0 ? minY : 0;
            if (shiftX < 0 || shiftY < 0) {
              obj.x += shiftX;
              obj.y += shiftY;
              obj.cloud.rx -= shiftX;
              obj.cloud.ry -= shiftY;
              obj.leader.tx -= shiftX;
              obj.leader.ty -= shiftY;
            }
            obj.w = Math.max(obj.w, maxX - minX);
            obj.h = Math.max(obj.h, maxY - minY);

            ctx.renderObjects();
            ctx.markDirty();
          }
          function onUp() {
            // Tighten the bounding box around cloud + note
            const PAD = 20;
            const c = obj.cloud, l = obj.leader;
            const allX = [c.rx, c.rx + c.rw, l.tx, l.tx + 150];
            const allY = [c.ry, c.ry + c.rh, l.ty, l.ty + 30];
            const minX = Math.min(...allX) - PAD, minY = Math.min(...allY) - PAD;
            const maxX = Math.max(...allX) + PAD, maxY = Math.max(...allY) + PAD;
            obj.x += minX;
            obj.y += minY;
            obj.cloud.rx -= minX;
            obj.cloud.ry -= minY;
            obj.leader.tx -= minX;
            obj.leader.ty -= minY;
            obj.w = maxX - minX;
            obj.h = maxY - minY;
            ctx.renderObjects();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return true;
        },
      },
    ],

    // ── MENUS ── entry in the shared "Annotate ▶" submenu
    canvasMenu: [
      {
        submenu: 'Annotate',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
        order: 90,
        dividerBefore: true,
        items: [
          {
            label: 'Markup',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>',
            order: 2,
            action(ctx) { ctx.setTool('markup'); },
          },
        ],
      },
    ],
  };
}
