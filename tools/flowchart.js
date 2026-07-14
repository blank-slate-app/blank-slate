/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE TOOL FILE — flowchart.js — boxes + connector arrows.

   BASELINE TOOL. Edit freely — a pristine copy lives in ../baseline/ and
   the app can always revert this file. To remix: copy to
   flowchart.<yourname>.js, set basedOn: 'flowchart', append your name to
   authors, and RENAME the object types.

   THE THREE INVARIANTS
   - ctx.pushUndo()      BEFORE mutating any object
   - ctx.renderObjects() AFTER adding/removing/restructuring objects
   - ctx.markDirty()     AFTER any change (schedules the auto-save)
   ONLY TOUCH ctx — the full API is in AGENTS.md.

   OBJECTS:
   - 'flowchart' — a box with a rich-text label (bold base; Ctrl+B/I/U
     while editing). fillColor = manual override; otherwise boxes color
     themselves by chain depth: the most-upstream box is full saturation,
     each downstream step desaturates (grey at depth 4+); unconnected
     boxes sit at the 25% tint. "Flip Flowchart Colors" reverses each
     chain's ramp (persisted with the project).
   - 'connector' — a curved arrow between two boxes. Stores only
     fromId/fromSide/toId/toSide; its bbox is recomputed from the live
     boxes on every render.

   INTERACTIONS: hover/select a box → 4 edge anchors; drag an anchor to
   another box to connect. Ctrl/Cmd+click an arrow / anchor / endpoint
   removes connections. Drag a selected arrow's endpoint handle to
   re-route it. Double-click a box to edit its label.
   ═══════════════════════════════════════════════════════════════════════ */

// ── MANIFEST ────────────────────────────────────────────────────────────
export const manifest = {
  id: 'flowchart',
  name: 'Flowchart',
  version: '2.0.0',
  authors: ['santi'],
  basedOn: null,
  description: 'Flowchart boxes with curved connector arrows and chain-depth coloring.',
};

// ── REGISTER ────────────────────────────────────────────────────────────
export function register(ctx) {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const FLOWCHART_COLORS = ['#F05300', '#F07A3C', '#F0A178', '#F0C9B4', '#F0F0F0'];
  const FLIP_KEY = 'flowchartFlipped';
  const flipped = () => !!ctx.state.get(FLIP_KEY);

  function darkenHex(hex, f) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ── Chain depths ─────────────────────────────────────────────────────
  // Depth of every *connected* box = distance from an upstream root,
  // following arrow direction. A box's parent is the FIRST connection
  // made into it (lowest connector id). Memoized per microtask so one
  // render pass computes it once.
  let depthsCache = null;
  function getDepths() {
    if (depthsCache) return depthsCache;
    const boxIds = new Set(ctx.objects.filter(o => o.type === 'flowchart').map(o => o.id));
    const conns = ctx.objects
      .filter(o => o.type === 'connector' && boxIds.has(o.fromId) && boxIds.has(o.toId))
      .sort((a, b) => a.id - b.id);
    const firstParent = new Map();
    const connected = new Set();
    for (const c of conns) {
      connected.add(c.fromId); connected.add(c.toId);
      if (!firstParent.has(c.toId)) firstParent.set(c.toId, c.fromId);
    }
    const depth = new Map();
    const visiting = new Set();
    function d(id) {
      if (depth.has(id)) return depth.get(id);
      const p = firstParent.get(id);
      if (p === undefined) { depth.set(id, 0); return 0; }
      if (visiting.has(id)) return 0; // cycle guard
      visiting.add(id);
      const v = d(p) + 1;
      visiting.delete(id);
      depth.set(id, v);
      return v;
    }
    const out = new Map();
    for (const id of connected) out.set(id, d(id));

    // Per-component max depth (used by the flip toggle)
    const adj = new Map();
    for (const id of connected) adj.set(id, []);
    for (const c of conns) { adj.get(c.fromId).push(c.toId); adj.get(c.toId).push(c.fromId); }
    const compMax = new Map();
    const seen = new Set();
    for (const start of connected) {
      if (seen.has(start)) continue;
      const stack = [start], members = [];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop(); members.push(id);
        for (const nb of adj.get(id)) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
      let mx = 0;
      for (const id of members) mx = Math.max(mx, out.get(id));
      for (const id of members) compMax.set(id, mx);
    }
    out.compMax = compMax;
    depthsCache = out;
    queueMicrotask(() => { depthsCache = null; });
    return out;
  }

  // manual pick (fillColor) > chain-depth colour (if connected) > 25% default
  function effectiveFill(obj) {
    if (obj.fillColor) return obj.fillColor;
    const depths = getDepths();
    const d = depths.get(obj.id);
    if (d === undefined) return FLOWCHART_COLORS[3];
    let idx = Math.min(d, 4);
    if (flipped()) {
      const maxD = (depths.compMax && depths.compMax.get(obj.id)) || 0;
      idx = Math.min(maxD, 4) - idx;
    }
    return FLOWCHART_COLORS[idx];
  }

  // ── Label rich text (bold base; italic / underline / un-bold runs) ──
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
            runs.push({ text: '\n', bold: true, italic: false, underline: false });
          } else {
            if (/^(DIV|P)$/.test(tag) && runs.length && !/\n$/.test(runs[runs.length - 1].text))
              runs.push({ text: '\n', bold: true, italic: false, underline: false });
            walk(child);
          }
        }
      }
    }
    walk(node);
    return runs;
  }

  function runsToHtml(runs) {
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
        if (!r.bold) seg = '<span class="fc-nb">' + seg + '</span>';
        html += seg;
      }
    }
    return html;
  }

  function applyFormat(cmd) {
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    try { document.execCommand(cmd, false, null); } catch (_) {}
  }

  // ── Connector geometry ───────────────────────────────────────────────
  function anchorPoint(o, side) {
    if (side === 'top') return { x: o.x + o.w / 2, y: o.y };
    if (side === 'bottom') return { x: o.x + o.w / 2, y: o.y + o.h };
    if (side === 'left') return { x: o.x, y: o.y + o.h / 2 };
    return { x: o.x + o.w, y: o.y + o.h / 2 }; // right
  }
  function sideNormal(side) {
    if (side === 'top') return { x: 0, y: -1 };
    if (side === 'bottom') return { x: 0, y: 1 };
    if (side === 'left') return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  }
  function nearestSide(o, p) {
    let best = 'top', bd = Infinity;
    for (const s of ['top', 'right', 'bottom', 'left']) {
      const a = anchorPoint(o, s);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function connectorGeometry(from, fromSide, to, toSide) {
    const p1 = anchorPoint(from, fromSide);
    const p2 = anchorPoint(to, toSide);
    const n1 = sideNormal(fromSide), n2 = sideNormal(toSide);
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const off = Math.max(40, Math.min(dist * 0.5, 160));
    return {
      p1, p2,
      c1: { x: p1.x + n1.x * off, y: p1.y + n1.y * off },
      c2: { x: p2.x + n2.x * off, y: p2.y + n2.y * off },
    };
  }

  // Populate a connector element (recomputes and stores the object's bbox).
  // Shared by the type's render() and by updateConnectors() during drags.
  function buildConnectorInto(obj, el) {
    const from = ctx.findObject(obj.fromId);
    const to = ctx.findObject(obj.toId);
    if (!from || !to || from.type !== 'flowchart' || to.type !== 'flowchart') return false;

    const g = connectorGeometry(from, obj.fromSide, to, obj.toSide);
    const PAD = 18;
    const xs = [g.p1.x, g.p2.x, g.c1.x, g.c2.x];
    const ys = [g.p1.y, g.p2.y, g.c1.y, g.c2.y];
    const minX = Math.min(...xs) - PAD, minY = Math.min(...ys) - PAD;
    const maxX = Math.max(...xs) + PAD, maxY = Math.max(...ys) + PAD;
    obj.x = minX; obj.y = minY; obj.w = maxX - minX; obj.h = maxY - minY;

    el.classList.add('connector-obj');
    el.style.left = obj.x + 'px';
    el.style.top = obj.y + 'px';
    el.style.width = obj.w + 'px';
    el.style.height = obj.h + 'px';

    const selected = ctx.selectedIds.has(obj.id);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.style.left = '0'; svg.style.top = '0';
    svg.style.width = obj.w + 'px'; svg.style.height = obj.h + 'px';

    const a = { x: g.p1.x - minX, y: g.p1.y - minY };
    const b = { x: g.p2.x - minX, y: g.p2.y - minY };
    const c1 = { x: g.c1.x - minX, y: g.c1.y - minY };
    const c2 = { x: g.c2.x - minX, y: g.c2.y - minY };
    const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    const color = selected ? '#ffd9b3' : '#F0C4A0';

    const hit = document.createElementNS(SVGNS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '16');
    hit.setAttribute('fill', 'none');
    hit.style.pointerEvents = 'stroke';
    svg.appendChild(hit);

    const curve = document.createElementNS(SVGNS, 'path');
    curve.setAttribute('d', d);
    curve.setAttribute('stroke', color);
    curve.setAttribute('stroke-width', selected ? '3.5' : '2.5');
    curve.setAttribute('fill', 'none');
    curve.setAttribute('stroke-linecap', 'round');
    curve.style.pointerEvents = 'none';
    svg.appendChild(curve);

    const ang = Math.atan2(b.y - c2.y, b.x - c2.x);
    const aLen = 13, aSpread = 0.45;
    const arrow = document.createElementNS(SVGNS, 'path');
    arrow.setAttribute('d',
      `M ${b.x - aLen * Math.cos(ang - aSpread)} ${b.y - aLen * Math.sin(ang - aSpread)} ` +
      `L ${b.x} ${b.y} ` +
      `L ${b.x - aLen * Math.cos(ang + aSpread)} ${b.y - aLen * Math.sin(ang + aSpread)} Z`);
    arrow.setAttribute('fill', color);
    arrow.setAttribute('stroke', color);
    arrow.setAttribute('stroke-width', '1.5');
    arrow.setAttribute('stroke-linejoin', 'round');
    arrow.style.pointerEvents = 'none';
    svg.appendChild(arrow);

    el.appendChild(svg);

    if (selected) {
      [['from', a], ['to', b]].forEach(([end, pt]) => {
        const h = document.createElement('div');
        h.className = 'conn-end';
        h.dataset.connId = obj.id;
        h.dataset.end = end;
        h.style.left = pt.x + 'px';
        h.style.top = pt.y + 'px';
        el.appendChild(h);
      });
    }
    return true;
  }

  // Re-render only the connector layer (cheap; used while boxes drag)
  function updateConnectors() {
    ctx.worldEl.querySelectorAll('.connector-obj').forEach(el => el.remove());
    ctx.objects.filter(o => o.type === 'connector')
      .sort((a, b) => a.zIndex - b.zIndex)
      .forEach(obj => {
        const el = document.createElement('div');
        el.className = 'canvas-obj';
        el.dataset.id = obj.id;
        el.style.zIndex = obj.zIndex;
        if (ctx.selectedIds.has(obj.id)) el.classList.add('selected');
        if (buildConnectorInto(obj, el)) ctx.worldEl.appendChild(el);
      });
  }

  function createConnector(fromId, fromSide, toId, toSide) {
    if (fromId === toId) return;
    if (ctx.objects.some(o => o.type === 'connector' &&
      o.fromId === fromId && o.toId === toId &&
      o.fromSide === fromSide && o.toSide === toSide)) return;
    ctx.pushUndo();
    const obj = ctx.createObject({ type: 'connector', fromId, fromSide, toId, toSide });
    ctx.selectObject(obj.id);
    ctx.renderObjects();
    ctx.markDirty();
  }

  function removeConnectorById(id) {
    if (!ctx.objects.some(o => o.id === id && o.type === 'connector')) return;
    ctx.pushUndo();
    const idx = ctx.objects.findIndex(o => o.id === id);
    if (idx >= 0) ctx.objects.splice(idx, 1);
    ctx.selectedIds.delete(id);
    ctx.renderObjects();
    ctx.markDirty();
  }

  function removeConnectorsAtAnchor(objId, side) {
    const ids = ctx.objects
      .filter(o => o.type === 'connector' &&
        ((o.fromId === objId && o.fromSide === side) || (o.toId === objId && o.toSide === side)))
      .map(o => o.id);
    if (!ids.length) return false;
    ctx.pushUndo();
    const set = new Set(ids);
    for (let i = ctx.objects.length - 1; i >= 0; i--) {
      if (set.has(ctx.objects[i].id)) ctx.objects.splice(i, 1);
    }
    set.forEach(cid => ctx.selectedIds.delete(cid));
    ctx.renderObjects();
    ctx.markDirty();
    return true;
  }

  // Drag a dashed preview from an anchor; drop on another box to connect.
  // onComplete(target) re-routes an existing connector instead of creating.
  function startConnectionDrag(fromId, fromSide, onComplete) {
    const fromObj = ctx.findObject(fromId);
    if (!fromObj) return;

    const preview = document.createElementNS(SVGNS, 'svg');
    Object.assign(preview.style, {
      position: 'absolute', left: '0', top: '0', width: '10px', height: '10px',
      overflow: 'visible', pointerEvents: 'none', zIndex: '9999', display: 'block',
    });
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('stroke', '#F0C4A0');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-dasharray', '6 5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    preview.appendChild(path);
    const head = document.createElementNS(SVGNS, 'path');
    head.setAttribute('fill', '#F0C4A0');
    preview.appendChild(head);
    ctx.worldEl.appendChild(preview);

    let target = null;
    let lastTargetEl = null;
    function setHighlight(el) {
      if (lastTargetEl && lastTargetEl !== el) lastTargetEl.classList.remove('conn-target');
      if (el) el.classList.add('conn-target');
      lastTargetEl = el;
    }

    function onMove(ev) {
      const w = ctx.screenToWorld(ev.clientX, ev.clientY);
      target = null;
      let targetEl = null, end = w, endSide = null;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const anchorEl = under && under.closest ? under.closest('.conn-anchor') : null;
      const fcEl = under && under.closest ? under.closest('.canvas-obj.flowchart-obj') : null;
      if (anchorEl) {
        const host = anchorEl.closest('.canvas-obj');
        const tid = parseInt(host.dataset.id);
        if (tid !== fromId) { target = { id: tid, side: anchorEl.dataset.side }; targetEl = host; }
      } else if (fcEl) {
        const tid = parseInt(fcEl.dataset.id);
        if (tid !== fromId) {
          const tObj = ctx.findObject(tid);
          if (tObj) { target = { id: tid, side: nearestSide(tObj, w) }; targetEl = fcEl; }
        }
      }
      if (target) {
        const tObj = ctx.findObject(target.id);
        end = anchorPoint(tObj, target.side);
        endSide = target.side;
      }
      setHighlight(targetEl);

      const start = anchorPoint(fromObj, fromSide);
      const n1 = sideNormal(fromSide);
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      const off = Math.max(40, Math.min(dist * 0.5, 160));
      const c1 = { x: start.x + n1.x * off, y: start.y + n1.y * off };
      let c2;
      if (endSide) { const n2 = sideNormal(endSide); c2 = { x: end.x + n2.x * off, y: end.y + n2.y * off }; }
      else { c2 = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; }
      path.setAttribute('d', `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`);
      const ang = Math.atan2(end.y - c2.y, end.x - c2.x);
      const aLen = 13, aSpread = 0.45;
      head.setAttribute('d',
        `M ${end.x - aLen * Math.cos(ang - aSpread)} ${end.y - aLen * Math.sin(ang - aSpread)} ` +
        `L ${end.x} ${end.y} ` +
        `L ${end.x - aLen * Math.cos(ang + aSpread)} ${end.y - aLen * Math.sin(ang + aSpread)} Z`);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setHighlight(null);
      preview.remove();
      if (onComplete) { onComplete(target); return; }
      if (target && target.id !== fromId) createConnector(fromId, fromSide, target.id, target.side);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function addFlowchart(wx, wy) {
    ctx.pushUndo();
    const center = (wx !== undefined) ? { x: wx, y: wy } : ctx.viewportCenter();
    const w = 170, h = 76;
    const obj = ctx.createObject({
      type: 'flowchart',
      x: center.x - w / 2, y: center.y - h / 2,
      w, h, content: '',
    });
    ctx.selectObject(obj.id);
    ctx.renderObjects();
    ctx.markDirty();
    setTimeout(() => {
      const el = ctx.worldEl.querySelector(`[data-id="${obj.id}"]`);
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, 50);
  }

  function setFlowchartColor(hex) {
    ctx.closeMenus();
    ctx.pushUndo();
    for (const sid of ctx.selectedIds) {
      const o = ctx.findObject(sid);
      if (o && o.type === 'flowchart') o.fillColor = hex || null;
    }
    ctx.renderObjects();
    ctx.markDirty();
  }

  const FC_ICON_14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="8" height="6" rx="1"/><rect x="14" y="14" width="8" height="6" rx="1"/><path d="M6 10v3a2 2 0 002 2h6"/></svg>';

  return {
    // ── STYLES ── (exact values from the original app)
    css: `
      .canvas-obj.flowchart-obj {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 10px 14px;
        border: 2px solid #C0A190;
        border-radius: 4px;
        background: #F0C9B4;
        overflow: visible;
      }
      .canvas-obj.flowchart-obj .flowchart-text {
        width: 100%;
        text-align: center;
        font-family: var(--font-sans);
        font-size: 16px;
        font-weight: 700;
        color: #2A2018;
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
        outline: none;
      }
      .canvas-obj.flowchart-obj .flowchart-text .placeholder-text { color: #9A7C66; font-weight: 700; }
      .canvas-obj.flowchart-obj .flowchart-text .fc-nb { font-weight: 400; }
      .canvas-obj.flowchart-obj .flowchart-text[contenteditable="true"] {
        cursor: text;
        user-select: text;
      }
      .conn-anchor {
        position: absolute;
        width: 13px;
        height: 13px;
        margin: -7px 0 0 -7px;
        background: #1a1a1a;
        border: 2px solid #F0C4A0;
        border-radius: 50%;
        z-index: 12;
        opacity: 0;
        transition: opacity 0.12s, transform 0.1s;
        cursor: crosshair;
      }
      .canvas-obj.flowchart-obj:hover .conn-anchor,
      .canvas-obj.flowchart-obj.selected .conn-anchor,
      .canvas-obj.flowchart-obj.conn-target .conn-anchor { opacity: 1; }
      .conn-anchor:hover { background: #F0C4A0; transform: scale(1.3); }
      .conn-anchor.ca-top { top: 0; left: 50%; }
      .conn-anchor.ca-bottom { top: 100%; left: 50%; }
      .conn-anchor.ca-left { top: 50%; left: 0; }
      .conn-anchor.ca-right { top: 50%; left: 100%; }
      .canvas-obj.flowchart-obj.conn-target { outline: 2px solid #F0C4A0; outline-offset: 2px; }

      .canvas-obj.connector-obj {
        background: transparent;
        overflow: visible;
        pointer-events: none;
      }
      .canvas-obj.connector-obj svg {
        position: absolute;
        overflow: visible;
        pointer-events: none;
      }
      .canvas-obj.connector-obj.selected { outline: none; }
      .conn-end {
        position: absolute;
        width: 12px;
        height: 12px;
        margin: -6px 0 0 -6px;
        background: #F0C4A0;
        border: 2px solid #1a1a1a;
        border-radius: 50%;
        z-index: 13;
        cursor: grab;
        pointer-events: auto;
      }
      .conn-end:hover { transform: scale(1.25); }

      .fc-color-auto { font-size: 12px; color: #b0b0b0; }
      .fc-color-swatch {
        box-sizing: border-box;
        width: 22px;
        height: 22px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.18);
        cursor: pointer;
        transition: transform 0.1s, border-color 0.1s;
      }
      .fc-color-swatch:hover { transform: scale(1.18); border-color: #F0C4A0; }
    `,

    // ── OBJECT TYPES ───────────────────────────────────────────────────
    objectTypes: {
      flowchart: {
        defaults: { content: '', fillColor: null, fontFamily: null, textColor: null },

        normalize(obj) {
          if (typeof obj.content !== 'string') obj.content = '';
        },

        // ── RENDERING ── box + rich label + 4 edge anchors
        render(obj, el) {
          el.classList.add('flowchart-obj');
          const txt = document.createElement('div');
          txt.className = 'flowchart-text';
          if (obj.content) {
            txt.innerHTML = obj.content; // canonical sanitized rich text
          } else {
            const span = document.createElement('span');
            span.className = 'placeholder-text';
            span.textContent = 'Text';
            txt.appendChild(span);
          }
          el.appendChild(txt);
          if (obj.fontFamily) txt.style.fontFamily = obj.fontFamily;
          if (obj.textColor) txt.style.color = obj.textColor;
          const fcFill = effectiveFill(obj);
          el.style.background = fcFill;
          el.style.borderColor = darkenHex(fcFill, 0.8);
          for (const side of ['top', 'right', 'bottom', 'left']) {
            const a = document.createElement('div');
            a.className = 'conn-anchor ca-' + side;
            a.dataset.side = side;
            el.appendChild(a);
          }
        },

        // Double-click → rich-text edit (Ctrl/Cmd+B / I / U format selection)
        onDoubleClick(obj, e, ctx) {
          const textEl = ctx.worldEl.querySelector(`[data-id="${obj.id}"] .flowchart-text`);
          if (!textEl) return false;
          ctx.selectObject(obj.id);
          const ph = textEl.querySelector('.placeholder-text');
          if (ph) ph.remove();
          if (!obj.content) textEl.textContent = '';
          textEl.contentEditable = 'true';
          textEl.focus();
          const range = document.createRange();
          range.selectNodeContents(textEl);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          function onBlur() {
            textEl.contentEditable = 'false';
            const runs = collectRuns(textEl);
            const plain = runs.map(r => r.text).join('').trim();
            const newContent = plain ? runsToHtml(runs) : '';
            if (newContent !== obj.content) ctx.pushUndo();
            obj.content = newContent;
            textEl.removeEventListener('blur', onBlur);
            ctx.renderObjects();
            ctx.markDirty();
          }
          textEl.addEventListener('blur', onBlur);
          textEl.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { textEl.blur(); return; }
            if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
              const k = ev.key.toLowerCase();
              if (k === 'b' || k === 'i' || k === 'u') {
                ev.preventDefault();
                applyFormat(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
              }
            }
          });
          return true;
        },

        // ── EXPORT ── rounded box + per-run styled, word-wrapped label
        exportDraw(c2d, obj, t) {
          const ox = t.x, oy = t.y;
          const ow = obj.w * t.scaleX, oh = obj.h * t.scaleY;
          const r = 4 * t.scaleX;
          c2d.beginPath();
          c2d.moveTo(ox + r, oy);
          c2d.arcTo(ox + ow, oy, ox + ow, oy + oh, r);
          c2d.arcTo(ox + ow, oy + oh, ox, oy + oh, r);
          c2d.arcTo(ox, oy + oh, ox, oy, r);
          c2d.arcTo(ox, oy, ox + ow, oy, r);
          c2d.closePath();
          const fcFill = effectiveFill(obj);
          c2d.fillStyle = fcFill;
          c2d.fill();
          c2d.strokeStyle = darkenHex(fcFill, 0.8);
          c2d.lineWidth = 2 * t.scaleX;
          c2d.stroke();

          const fSize = Math.round(16 * t.scaleX);
          const fam = obj.fontFamily || 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
          const col = obj.textColor || '#2A2018';
          const padX = 14 * t.scaleX;
          const maxW = Math.max(10, ow - padX * 2);
          const lineH = fSize * 1.35;
          const liveNode = ctx.worldEl.querySelector('.canvas-obj[data-id="' + obj.id + '"] .flowchart-text');
          let fcRuns = liveNode ? collectRuns(liveNode) : null;
          if (!fcRuns || !fcRuns.length) {
            const plain = (obj.content || '').replace(/<[^>]*>/g, '').trim();
            fcRuns = plain ? [{ text: plain, bold: true, italic: false, underline: false }] : [];
          }
          if (!fcRuns.length) return;

          const segFont = (s) => `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${fSize}px ${fam}`;
          c2d.textAlign = 'left';
          c2d.textBaseline = 'middle';
          c2d.font = `700 ${fSize}px ${fam}`;
          const spaceW = c2d.measureText(' ').width;
          const hardLines = [[]];
          let curWord = null;
          const pushWord = () => { if (curWord) { hardLines[hardLines.length - 1].push(curWord); curWord = null; } };
          for (const run of fcRuns) {
            for (const part of run.text.split(/(\s+)/)) {
              if (part === '') continue;
              if (/^\s+$/.test(part)) { pushWord(); if (part.indexOf('\n') !== -1) hardLines.push([]); }
              else { (curWord || (curWord = { segs: [] })).segs.push({ text: part, bold: run.bold, italic: run.italic, underline: run.underline }); }
            }
          }
          pushWord();
          const wordWidth = (w) => { let tw = 0; for (const s of w.segs) { c2d.font = segFont(s); tw += c2d.measureText(s.text).width; } return tw; };
          const lines = [];
          for (const hl of hardLines) {
            let cur = [], curW = 0;
            for (const w of hl) {
              const ww = wordWidth(w);
              const add = cur.length ? spaceW + ww : ww;
              if (cur.length && curW + add > maxW) { lines.push({ words: cur, width: curW }); cur = [w]; curW = ww; }
              else { cur.push(w); curW += add; }
            }
            lines.push({ words: cur, width: curW });
          }
          const startY = oy + oh / 2 - (lines.length - 1) * lineH / 2;
          lines.forEach((ln, i) => {
            const cy = startY + i * lineH;
            let cx = ox + ow / 2 - ln.width / 2;
            for (let wi = 0; wi < ln.words.length; wi++) {
              for (const s of ln.words[wi].segs) {
                c2d.font = segFont(s);
                c2d.fillStyle = col;
                c2d.fillText(s.text, cx, cy);
                const segW = c2d.measureText(s.text).width;
                if (s.underline) {
                  const uy = cy + fSize * 0.4;
                  c2d.strokeStyle = col;
                  c2d.lineWidth = Math.max(1, fSize * 0.07);
                  c2d.beginPath(); c2d.moveTo(cx, uy); c2d.lineTo(cx + segW, uy); c2d.stroke();
                }
                cx += segW;
              }
              if (wi < ln.words.length - 1) cx += spaceW;
            }
          });
          c2d.textBaseline = 'alphabetic';
        },

        // ── MENUS ── Change Color ▶ Auto + 5-step saturation swatches
        menu: () => [
          {
            label: 'Change Color',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/></svg>',
            submenu: [
              {
                html: '<div class="ctx-item fc-color-auto"><span>Auto (by chain position)</span></div>',
                onClick(e, ctx) { setFlowchartColor(null); },
              },
              {
                html: `<div class="fc-color-row">` + FLOWCHART_COLORS.map((c, i) =>
                  `<button class="fc-color-swatch" data-color="${c}" style="background:${c}" title="Color ${i + 1}"></button>`
                ).join('') + `</div>`,
                onClick(e, ctx) {
                  const btn = e.target.closest('.fc-color-swatch');
                  if (!btn) return;
                  setFlowchartColor(btn.dataset.color);
                },
              },
            ],
          },
        ],
      },

      connector: {
        defaults: { fromId: null, fromSide: 'right', toId: null, toSide: 'left' },

        normalize(obj) {
          const sides = ['top', 'right', 'bottom', 'left'];
          if (!sides.includes(obj.fromSide)) obj.fromSide = 'right';
          if (!sides.includes(obj.toSide)) obj.toSide = 'left';
        },

        // The bbox is recomputed from the live boxes on every render
        render(obj, el) {
          buildConnectorInto(obj, el);
        },

        // ── EXPORT ── curved bezier + arrowhead (recomputed from boxes)
        exportDraw(c2d, obj, t) {
          const from = ctx.findObject(obj.fromId);
          const to = ctx.findObject(obj.toId);
          if (!from || !to || from.type !== 'flowchart' || to.type !== 'flowchart') return;
          const g = connectorGeometry(from, obj.fromSide, to, obj.toSide);
          // Map world points through the object's own transform anchor
          const W = p => ({ x: t.x + (p.x - obj.x) * t.scaleX, y: t.y + (p.y - obj.y) * t.scaleY });
          const P1 = W(g.p1), P2 = W(g.p2), C1 = W(g.c1), C2 = W(g.c2);
          c2d.strokeStyle = '#F0C4A0';
          c2d.lineWidth = 2.5 * t.scaleX;
          c2d.fillStyle = '#F0C4A0';
          c2d.lineCap = 'round';
          c2d.beginPath();
          c2d.moveTo(P1.x, P1.y);
          c2d.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, P2.x, P2.y);
          c2d.stroke();
          const ang = Math.atan2(P2.y - C2.y, P2.x - C2.x);
          const aLen = 13 * t.scaleX, aSpread = 0.45;
          c2d.beginPath();
          c2d.moveTo(P2.x - aLen * Math.cos(ang - aSpread), P2.y - aLen * Math.sin(ang - aSpread));
          c2d.lineTo(P2.x, P2.y);
          c2d.lineTo(P2.x - aLen * Math.cos(ang + aSpread), P2.y - aLen * Math.sin(ang + aSpread));
          c2d.closePath();
          c2d.fill();
        },
      },
    },

    // ── RAW POINTERS ── connection interactions pre-empt select/move
    pointer: [
      // Edge anchors: Ctrl/Cmd+click removes that edge's connections;
      // plain drag pulls a new arrow.
      {
        priority: 240,
        handler(e, ctx) {
          if (e.button !== 0 || ctx.getActiveTool()) return false;
          const anchor = e.target.closest('.conn-anchor');
          if (!anchor) return false;
          e.preventDefault();
          const host = anchor.closest('.canvas-obj');
          if (!host) return true;
          const objId = parseInt(host.dataset.id), side = anchor.dataset.side;
          if (e.ctrlKey || e.metaKey) { removeConnectorsAtAnchor(objId, side); return true; }
          startConnectionDrag(objId, side);
          return true;
        },
      },
      // Endpoint handles on a selected connector: drag to re-route
      {
        priority: 245,
        handler(e, ctx) {
          if (e.button !== 0 || ctx.getActiveTool()) return false;
          const endEl = e.target.closest('.conn-end');
          if (!endEl) return false;
          e.preventDefault();
          const connId = parseInt(endEl.dataset.connId);
          const end = endEl.dataset.end; // 'from' | 'to'
          const conn = ctx.findObject(connId);
          if (!conn) return true;
          if (e.ctrlKey || e.metaKey) { removeConnectorById(connId); return true; }
          const fixedId = end === 'from' ? conn.toId : conn.fromId;
          const fixedSide = end === 'from' ? conn.toSide : conn.fromSide;
          startConnectionDrag(fixedId, fixedSide, (target) => {
            if (!target || target.id === fixedId) return;
            ctx.pushUndo();
            if (end === 'from') { conn.fromId = target.id; conn.fromSide = target.side; }
            else { conn.toId = target.id; conn.toSide = target.side; }
            ctx.renderObjects();
            ctx.markDirty();
          });
          return true;
        },
      },
      // The arrow itself: Ctrl/Cmd+click removes, plain click selects
      // (never drags — connectors are bound to their boxes).
      {
        priority: 350,
        handler(e, ctx) {
          if (e.button !== 0) return false;
          const objEl = e.target.closest('.canvas-obj.connector-obj');
          if (!objEl) return false;
          const id = parseInt(objEl.dataset.id);
          if (e.ctrlKey || e.metaKey) { removeConnectorById(id); return true; }
          ctx.selectObject(id, e.shiftKey);
          return true;
        },
      },
    ],

    // Keep arrows attached while their boxes drag
    onObjectsMoved(movedIds, ctx) {
      if (ctx.objects.some(o => o.type === 'connector')) updateConnectors();
    },

    // Deleting a box cascades to its connectors
    onDelete(deleteSet, ctx) {
      for (const o of ctx.objects) {
        if (o.type === 'connector' && (deleteSet.has(o.fromId) || deleteSet.has(o.toId))) {
          deleteSet.add(o.id);
        }
      }
    },

    // Drop connectors whose boxes vanished (e.g. edited project files)
    onReady(ctx) {
      const ids = new Set(ctx.objects.map(o => o.id));
      const dangling = ctx.objects.filter(o =>
        o.type === 'connector' && (!ids.has(o.fromId) || !ids.has(o.toId)));
      if (dangling.length) {
        const set = new Set(dangling.map(o => o.id));
        for (let i = ctx.objects.length - 1; i >= 0; i--) {
          if (set.has(ctx.objects[i].id)) ctx.objects.splice(i, 1);
        }
        ctx.renderObjects();
        ctx.markDirty();
      }
    },

    // ── TOOLBAR ── one button, like the original rail
    toolbar: [
      {
        icon: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="8" height="6" rx="1"/><rect x="14" y="14" width="8" height="6" rx="1"/><path d="M6 10v3a2 2 0 002 2h6"/><path d="M12 12l2 3-3 1"/></svg>',
        title: 'Add Flowchart Box',
        order: 25,
        action(ctx) { addFlowchart(); },
      },
    ],

    // ── MENUS ── flat items in the canvas menu, exactly like the original
    canvasMenu: [
      {
        label: 'Add Flowchart Box',
        icon: FC_ICON_14,
        order: 30,
        action(ctx) { addFlowchart(ctx.contextWorld.x, ctx.contextWorld.y); },
      },
      {
        label: 'Flip Flowchart Colors',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
        order: 31,
        checked: (ctx) => !!ctx.state.get(FLIP_KEY),
        action(ctx) {
          ctx.state.set(FLIP_KEY, !ctx.state.get(FLIP_KEY));
          ctx.renderObjects();
          ctx.markDirty();
          ctx.showToast(ctx.state.get(FLIP_KEY) ? 'Flowchart colors flipped' : 'Flowchart colors restored');
        },
      },
    ],
  };
}
