/* ═══════════════════════════════════════════════════════════════════════
   BLANK-SLATE KERNEL (core/engine.js)

   The kernel owns everything generic: state, undo, save/load, selection,
   move/resize/marquee, pan/zoom/snap, the render loop, the pointer
   pipeline, generated toolbar/menus/shortcuts, the tool loader, toast.

   Tools own everything specific. A tool is ONE file in ../tools/ that
   exports { manifest, register(ctx) } and never touches anything except
   the ctx API handed to it. See tools/AGENTS.md for the full contract.

   RULES THAT KEEP THIS FILE SANE
   - No object-type-specific logic in the kernel. Ever. If a change needs
     to know what a "drawing" or an "artboard" is, it belongs in a tool.
   - The ctx API is append-only once shipped. Tools in the wild depend on it.
   - Unknown object types render as placeholders and their data is
     preserved verbatim — a missing tool must never corrupt a project.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Boot guard ─────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const projectName = params.get('project');
if (!projectName) window.location.href = 'landing.html';

// ── DOM refs ───────────────────────────────────────────────────────────
const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const gridLayer = document.getElementById('gridLayer');
const toolbar = document.getElementById('toolbar');
const barSlot = document.getElementById('barSlot');
const selectRect = document.getElementById('selectRect');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const zoomIndicator = document.getElementById('zoomIndicator');
const saveIndicator = document.getElementById('saveIndicator');

// ── State ──────────────────────────────────────────────────────────────
const GRID = 40;
let objects = [];
let nextId = 1;
const selectedIds = new Set();
let panX = 0, panY = 0, zoom = 1;
let undoStack = [];
let redoStack = [];
let dirty = false;
let saveTimer = null;
let spaceDown = false;
let activeToolId = null;     // null = pointer
let contextWorld = { x: 0, y: 0 }; // world coords of the last context menu
let toolState = {};          // per-tool persisted flags (canvasState.toolState)

// ── Registry ───────────────────────────────────────────────────────────
// families: id → { manifest, decl, variants: [{manifest, decl}] }
// types:    object type → { def, toolId }
const registry = {
  families: new Map(),
  types: new Map(),
  loadErrors: [],           // { file, error }
  pending: [],              // [manifest, decl] awaiting family resolution

  add(manifest, decl) { this.pending.push({ manifest, decl }); },

  // Two-pass: files load in any order; variants attach to their family
  // afterwards. A variant whose family is missing becomes its own family.
  resolve() {
    for (const t of this.pending.filter(p => !p.manifest.basedOn)) {
      this.families.set(t.manifest.id, { ...t, variants: [] });
    }
    for (const t of this.pending.filter(p => p.manifest.basedOn)) {
      const familyId = String(t.manifest.basedOn).split('@')[0];
      const fam = this.families.get(familyId);
      if (fam) fam.variants.push(t);
      else this.families.set(t.manifest.id, { ...t, variants: [] });
    }
    // Object types (variant types register too; first registration wins)
    for (const t of this.pending) {
      for (const [type, def] of Object.entries(t.decl.objectTypes || {})) {
        if (!this.types.has(type)) this.types.set(type, { def, toolId: t.manifest.id });
        else console.warn(`Object type "${type}" already registered; ${t.manifest.id}'s duplicate ignored`);
      }
    }
    this.pending = [];
  },

  typeDef(type) { const e = this.types.get(type); return e ? e.def : null; },

  allTools() {
    const out = [];
    for (const fam of this.families.values()) { out.push(fam); out.push(...fam.variants); }
    return out;
  },

  tool(id) { return this.allTools().find(t => t.manifest.id === id) || null; },
};

// ── Object model ───────────────────────────────────────────────────────
// Core normalization only. Unknown fields are ALWAYS preserved (projects
// must survive tools being absent). Type-specific rules live in the
// type's own normalize() hook.
function normalizeObject(obj) {
  const o = { ...obj };
  o.id = Number(o.id) || 0;
  o.type = String(o.type || 'unknown');
  o.x = Number(o.x) || 0;
  o.y = Number(o.y) || 0;
  o.w = Number(o.w) || 200;
  o.h = Number(o.h) || 150;
  o.zIndex = Number(o.zIndex) || 1;
  const entry = registry.types.get(o.type);
  if (entry) {
    const withDefaults = { ...(entry.def.defaults || {}), ...o };
    if (entry.def.normalize) entry.def.normalize(withDefaults);
    return withDefaults;
  }
  return o; // unknown type: keep verbatim, renders as placeholder
}

function recalcNextId() {
  nextId = objects.length ? Math.max(...objects.map(o => o.id)) + 1 : 1;
}

// ── Transform / coordinates ────────────────────────────────────────────
function applyTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  const gs = GRID * zoom;
  gridLayer.style.backgroundSize = `${gs}px ${gs}px`;
  gridLayer.style.backgroundPosition = `${panX % gs}px ${panY % gs}px`;
  zoomIndicator.textContent = `${Math.round(zoom * 100)}%`;
}

function screenToWorld(sx, sy) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

function viewportCenter() {
  return screenToWorld((window.innerWidth - 52) / 2, window.innerHeight / 2);
}

function zoomAt(f) {
  const vw = (window.innerWidth - 52) / 2, vh = window.innerHeight / 2;
  const wx = (vw - panX) / zoom, wy = (vh - panY) / zoom;
  zoom = Math.min(5, Math.max(0.1, zoom * f));
  panX = vw - wx * zoom; panY = vh - wy * zoom;
  applyTransform();
}

function fitToView() {
  if (objects.length === 0) { zoom = 1; panX = 0; panY = 0; applyTransform(); return; }
  const minX = Math.min(...objects.map(o => o.x));
  const minY = Math.min(...objects.map(o => o.y));
  const maxX = Math.max(...objects.map(o => o.x + o.w));
  const maxY = Math.max(...objects.map(o => o.y + o.h));
  const vw = window.innerWidth - 52, vh = window.innerHeight;
  const pad = 80;
  zoom = Math.min(5, Math.max(0.1, Math.min(
    (vw - pad * 2) / Math.max(1, maxX - minX),
    (vh - pad * 2) / Math.max(1, maxY - minY)
  )));
  panX = (vw - (maxX + minX) * zoom) / 2;
  panY = (vh - (maxY + minY) * zoom) / 2;
  applyTransform();
}

// ── Undo / save ────────────────────────────────────────────────────────
function pushUndo() {
  undoStack.push(JSON.stringify(objects));
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(objects));
  objects = JSON.parse(undoStack.pop()).map(normalizeObject);
  recalcNextId(); selectedIds.clear(); renderObjects(); markDirty();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(objects));
  objects = JSON.parse(redoStack.pop()).map(normalizeObject);
  recalcNextId(); selectedIds.clear(); renderObjects(); markDirty();
}

function markDirty() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 500);
}

async function saveProject() {
  if (!dirty) return;
  dirty = false;
  await window.api.saveProject(projectName, {
    name: projectName,
    canvasState: { panX, panY, zoom, toolState: JSON.parse(JSON.stringify(toolState)) },
    objects: JSON.parse(JSON.stringify(objects)),
  });
  saveIndicator.classList.add('show');
  setTimeout(() => saveIndicator.classList.remove('show'), 1200);
}

// ── Render loop ────────────────────────────────────────────────────────
// Full rebuild (proven simple + fast enough at this scale). Dispatches to
// the object type's render(); unknown types render as placeholders.
function renderObjects() {
  world.querySelectorAll('.canvas-obj').forEach(el => el.remove());
  const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);

  for (const obj of sorted) {
    const el = document.createElement('div');
    el.className = 'canvas-obj';
    el.dataset.id = obj.id;
    el.style.left = obj.x + 'px';
    el.style.top = obj.y + 'px';
    el.style.width = obj.w + 'px';
    el.style.height = obj.h + 'px';
    el.style.zIndex = obj.zIndex;
    if (selectedIds.has(obj.id)) el.classList.add('selected');

    const entry = registry.types.get(obj.type);
    if (entry) {
      try {
        entry.def.render(obj, el, ctx);
      } catch (err) {
        console.error(`render() failed for type "${obj.type}"`, err);
        renderPlaceholder(obj, el, `${obj.type} (render error)`);
      }
    } else {
      renderPlaceholder(obj, el, `${obj.type} — tool not installed`);
    }

    for (const pos of ['tl', 'tr', 'bl', 'br']) {
      const h = document.createElement('div');
      h.className = `resize-handle rh-${pos}`;
      h.dataset.handle = pos;
      el.appendChild(h);
    }
    world.appendChild(el);
  }
}

function renderPlaceholder(obj, el, label) {
  el.classList.add('placeholder-obj');
  const span = document.createElement('span');
  span.textContent = label;
  el.appendChild(span);
}

function updateSelectionVisuals() {
  world.querySelectorAll('.canvas-obj').forEach(el => {
    el.classList.toggle('selected', selectedIds.has(parseInt(el.dataset.id)));
  });
}

function selectObject(id, additive = false) {
  if (id === null) { selectedIds.clear(); updateSelectionVisuals(); return; }
  if (additive) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  } else {
    selectedIds.clear(); selectedIds.add(id);
  }
  updateSelectionVisuals();
}

function deleteSelected() {
  if (selectedIds.size === 0) return;
  pushUndo();
  const del = new Set(selectedIds);
  for (const t of registry.allTools()) {
    if (t.decl.onDelete) { try { t.decl.onDelete(del, ctx); } catch (e) { console.error(e); } }
  }
  objects = objects.filter(o => !del.has(o.id));
  selectedIds.clear();
  renderObjects(); markDirty();
}

// ── Snap ───────────────────────────────────────────────────────────────
let guideEls = [];
function clearGuides() { guideEls.forEach(g => g.remove()); guideEls = []; }
function showGuide(orientation, pos) {
  const g = document.createElement('div');
  g.className = `snap-guide ${orientation}`;
  if (orientation === 'horizontal') g.style.top = pos + 'px';
  else g.style.left = pos + 'px';
  world.appendChild(g);
  guideEls.push(g);
}

function snapObject(obj) {
  const TOL = 8 / zoom;
  clearGuides();
  let x = obj.x, y = obj.y;
  const xs = [obj.x, obj.x + obj.w / 2, obj.x + obj.w];
  const ys = [obj.y, obj.y + obj.h / 2, obj.y + obj.h];
  const candX = [], candY = [];
  for (const o of objects) {
    if (selectedIds.has(o.id)) continue;
    candX.push(o.x, o.x + o.w / 2, o.x + o.w);
    candY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  for (const gx of xs) { const g = Math.round(gx / GRID) * GRID; candX.push(g); }
  for (const gy of ys) { const g = Math.round(gy / GRID) * GRID; candY.push(g); }

  let bestDX = Infinity, snapX = null;
  for (let i = 0; i < xs.length; i++) for (const c of candX) {
    const d = c - xs[i];
    if (Math.abs(d) < TOL && Math.abs(d) < Math.abs(bestDX)) { bestDX = d; snapX = c; }
  }
  let bestDY = Infinity, snapY = null;
  for (let i = 0; i < ys.length; i++) for (const c of candY) {
    const d = c - ys[i];
    if (Math.abs(d) < TOL && Math.abs(d) < Math.abs(bestDY)) { bestDY = d; snapY = c; }
  }
  if (snapX !== null && isFinite(bestDX)) { x += bestDX; showGuide('vertical', snapX); }
  if (snapY !== null && isFinite(bestDY)) { y += bestDY; showGuide('horizontal', snapY); }
  return { x, y };
}

// ── Pointer pipeline ───────────────────────────────────────────────────
// One mousedown listener; handlers run in ascending priority order until
// one returns true. Priorities:
//   100 pan modes (space / middle / right+zoom)
//   200 active modal tool (tool.onPointerDown)
//   2xx tool raw handlers (tools may register e.g. 250 to pre-empt select)
//   300 resize handles
//   400 object select/move/alt-duplicate
//   500 marquee
const pointerHandlers = [];
function registerPointerHandler(priority, handler) {
  pointerHandlers.push({ priority, handler });
  pointerHandlers.sort((a, b) => a.priority - b.priority);
}

viewport.addEventListener('mousedown', (e) => {
  for (const { handler } of pointerHandlers) {
    try { if (handler(e)) return; } catch (err) { console.error('pointer handler error', err); }
  }
});

viewport.addEventListener('contextmenu', (e) => e.preventDefault());

// -- 100: pan (right-drag, middle, space+left; ctrl+right = vertical zoom)
function startPan(e) {
  e.preventDefault();
  viewport.classList.add('panning');
  const sx = e.clientX, sy = e.clientY, ox = panX, oy = panY;
  function onMove(ev) { panX = ox + ev.clientX - sx; panY = oy + ev.clientY - sy; applyTransform(); }
  function onUp(ev) {
    viewport.classList.remove('panning');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (ev.button === 2 && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) showContextMenu(ev);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

registerPointerHandler(100, (e) => {
  if (e.button === 2 && e.ctrlKey) {
    e.preventDefault();
    const sy = e.clientY, sz = zoom;
    const cx = (window.innerWidth - 52) / 2, cy = window.innerHeight / 2;
    const wx = (cx - panX) / zoom, wy = (cy - panY) / zoom;
    function onMove(ev) {
      zoom = Math.min(5, Math.max(0.1, sz * Math.pow(2, -(ev.clientY - sy) / 200)));
      panX = cx - wx * zoom; panY = cy - wy * zoom;
      applyTransform();
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return true;
  }
  if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceDown)) { startPan(e); return true; }
  return false;
});

// -- 200: the active modal tool gets first claim on left-clicks
registerPointerHandler(200, (e) => {
  if (e.button !== 0 || !activeToolId) return false;
  const tool = registry.tool(activeToolId);
  if (tool && tool.decl.tool && tool.decl.tool.onPointerDown) {
    return !!tool.decl.tool.onPointerDown(e, ctx);
  }
  return false;
});

// -- 300: resize handles (single + uniform group scale)
registerPointerHandler(300, (e) => {
  if (e.button !== 0) return false;
  const handle = e.target.closest('.resize-handle');
  const objEl = e.target.closest('.canvas-obj');
  if (!handle || !objEl) return false;
  e.preventDefault(); e.stopPropagation();
  const id = parseInt(objEl.dataset.id);
  const obj = objects.find(o => o.id === id);
  if (!obj) return true;
  pushUndo();
  if (!selectedIds.has(id)) selectObject(id);

  const sx = e.clientX, sy = e.clientY;
  const ox = obj.x, oy = obj.y, ow = obj.w, oh = obj.h;
  const hp = handle.dataset.handle;
  const typeDef = registry.typeDef(obj.type);
  const keepAspect = !!(typeDef && typeDef.proportionalResize);
  const ar = ow / oh;

  const groupIds = Array.from(selectedIds).filter(sid => sid !== id);
  const isGroup = groupIds.length > 0;
  const origins = new Map();
  if (isGroup) for (const sid of selectedIds) {
    const so = objects.find(o => o.id === sid);
    if (so) origins.set(sid, { x: so.x, y: so.y, w: so.w, h: so.h });
  }
  const anchorX = hp.includes('l') ? ox + ow : ox;
  const anchorY = hp.includes('t') ? oy + oh : oy;

  function onMove(ev) {
    const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
    let nx = ox, ny = oy, nw = ow, nh = oh;
    if (hp.includes('r')) nw = ow + dx;
    if (hp.includes('l')) { nx = ox + dx; nw = ow - dx; }
    if (hp.includes('b')) nh = oh + dy;
    if (hp.includes('t')) { ny = oy + dy; nh = oh - dy; }
    if (isGroup || keepAspect || ev.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) {
        nh = nw / ar; if (hp.includes('t')) ny = oy + oh - nh;
      } else {
        nw = nh * ar; if (hp.includes('l')) nx = ox + ow - nw;
      }
    }
    obj.x = nx; obj.y = ny; obj.w = Math.max(20, nw); obj.h = Math.max(20, nh);

    if (isGroup) {
      const scale = obj.w / ow;
      if (isFinite(scale) && scale > 0) {
        for (const sid of groupIds) {
          const so = objects.find(o => o.id === sid);
          const orig = origins.get(sid);
          if (!so || !orig) continue;
          so.w = orig.w * scale;
          so.h = orig.h * scale;
          so.x = anchorX + (orig.x - anchorX) * scale;
          so.y = anchorY + (orig.y - anchorY) * scale;
        }
      }
    }
    renderObjects(); markDirty();
  }
  function onUp() { clearGuides(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  return true;
});

// -- 400: select / move / alt-duplicate
registerPointerHandler(400, (e) => {
  if (e.button !== 0) return false;
  const objEl = e.target.closest('.canvas-obj');
  if (!objEl) return false;
  if (e.target.closest('[contenteditable="true"]')) return true; // typing, not dragging
  e.preventDefault();
  let id = parseInt(objEl.dataset.id);
  let obj = objects.find(o => o.id === id);
  if (!obj) return true;

  if (e.shiftKey) { selectObject(id, true); return true; }

  pushUndo();

  if (e.altKey) {
    const srcIds = selectedIds.has(id) ? Array.from(selectedIds) : [id];
    const dupes = [];
    for (const sid of srcIds) {
      const src = objects.find(o => o.id === sid);
      if (!src) continue;
      const clone = normalizeObject({
        ...JSON.parse(JSON.stringify(src)),
        id: nextId++,
        zIndex: Math.max(...objects.map(o => o.zIndex), 0) + 1,
      });
      const typeDef = registry.typeDef(clone.type);
      if (typeDef && typeDef.onDuplicate) { try { typeDef.onDuplicate(clone, ctx); } catch (err) { console.error(err); } }
      dupes.push(clone);
    }
    objects.push(...dupes);
    selectedIds.clear();
    dupes.forEach(d => selectedIds.add(d.id));
    id = dupes[0].id;
    obj = objects.find(o => o.id === id);
    renderObjects();
  }

  if (!selectedIds.has(id)) selectObject(id);

  const sx = e.clientX, sy = e.clientY;
  const origins = new Map();
  for (const sid of selectedIds) {
    const so = objects.find(o => o.id === sid);
    if (so) origins.set(sid, { x: so.x, y: so.y });
  }

  function onMove(ev) {
    const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom;
    obj.x = origins.get(id).x + dx;
    obj.y = origins.get(id).y + dy;
    const snapped = snapObject(obj);
    const sdx = snapped.x - origins.get(id).x;
    const sdy = snapped.y - origins.get(id).y;
    for (const [sid, orig] of origins) {
      const so = objects.find(o => o.id === sid);
      if (so) { so.x = orig.x + sdx; so.y = orig.y + sdy; }
    }
    for (const sid of selectedIds) {
      const so = objects.find(o => o.id === sid);
      const el = world.querySelector(`[data-id="${sid}"]`);
      if (so && el) { el.style.left = so.x + 'px'; el.style.top = so.y + 'px'; }
    }
    for (const t of registry.allTools()) {
      if (t.decl.onObjectsMoved) { try { t.decl.onObjectsMoved(selectedIds, ctx); } catch (err) { console.error(err); } }
    }
    markDirty();
  }
  function onUp() { clearGuides(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  return true;
});

// -- 500: marquee select on empty space
registerPointerHandler(500, (e) => {
  if (e.button !== 0) return false;
  if (!e.shiftKey) selectObject(null);
  const sw = screenToWorld(e.clientX, e.clientY);
  let dragged = false;
  selectRect.style.display = 'none';

  function onMove(ev) {
    dragged = true;
    const c = screenToWorld(ev.clientX, ev.clientY);
    const rx = Math.min(sw.x, c.x), ry = Math.min(sw.y, c.y);
    const rw = Math.abs(c.x - sw.x), rh = Math.abs(c.y - sw.y);
    selectRect.style.display = 'block';
    selectRect.style.left = rx + 'px'; selectRect.style.top = ry + 'px';
    selectRect.style.width = rw + 'px'; selectRect.style.height = rh + 'px';
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    selectRect.style.display = 'none';
    if (!dragged) return;
    const c = screenToWorld(ev.clientX, ev.clientY);
    const rx = Math.min(sw.x, c.x), ry = Math.min(sw.y, c.y);
    const rw = Math.abs(c.x - sw.x), rh = Math.abs(c.y - sw.y);
    if (rw < 5 && rh < 5) return;
    for (const obj of objects) {
      if (obj.x + obj.w > rx && obj.x < rx + rw && obj.y + obj.h > ry && obj.y < ry + rh) {
        selectedIds.add(obj.id);
      }
    }
    updateSelectionVisuals();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  return true;
});

// Wheel zoom at cursor
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const nz = Math.min(5, Math.max(0.1, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  const wx = (e.clientX - panX) / zoom, wy = (e.clientY - panY) / zoom;
  zoom = nz; panX = e.clientX - wx * zoom; panY = e.clientY - wy * zoom;
  applyTransform();
}, { passive: false });

// Double-click dispatch: the type owner gets it first; then any tool's
// decl.onObjectDoubleClick(obj, e, ctx) (first to return true wins) —
// this lets subfamily files own interactions on types they don't own
// (e.g. images.crop opens crop mode on double-clicked images).
viewport.addEventListener('dblclick', (e) => {
  const objEl = e.target.closest('.canvas-obj');
  if (!objEl) return;
  const obj = objects.find(o => o.id === parseInt(objEl.dataset.id));
  if (!obj) return;
  const def = registry.typeDef(obj.type);
  if (def && def.onDoubleClick) {
    try { if (def.onDoubleClick(obj, e, ctx)) return; } catch (err) { console.error(err); }
  }
  for (const t of registry.allTools()) {
    if (t.decl.onObjectDoubleClick) {
      try { if (t.decl.onObjectDoubleClick(obj, e, ctx)) return; } catch (err) { console.error(err); }
    }
  }
});

// ── Menus (generated) ──────────────────────────────────────────────────
// Generic popup builder — also exposed to tools as ctx.ui.openMenu.
// items: { label, icon?, danger?, disabled?, checked?, action?(ctx, e) } |
//        { label, icon?, submenu: [items] } |
//        { html, onClick?(e, ctx) }   ← custom row (e.g. color swatches)
//        { divider: true }
let openMenuEl = null;

function closeMenus() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}

function buildMenuInto(menuEl, items) {
  for (const item of items) {
    if (item.divider) {
      const d = document.createElement('div');
      d.className = 'ctx-divider';
      menuEl.appendChild(d);
      continue;
    }
    if (item.html) {
      const row = document.createElement('div');
      row.innerHTML = item.html;
      const el = row.children.length === 1 ? row.firstElementChild : row;
      if (item.onClick) el.addEventListener('click', (e) => item.onClick(e, ctx));
      menuEl.appendChild(el);
      continue;
    }
    if (item.submenu) {
      const sub = document.createElement('div');
      sub.className = 'ctx-sub';
      const trigger = document.createElement('div');
      trigger.className = 'ctx-item';
      trigger.innerHTML = (item.icon || '') + `<span>${item.label}</span><span class="arrow">&#9654;</span>`;
      sub.appendChild(trigger);
      const subMenu = document.createElement('div');
      subMenu.className = 'ctx-sub-menu';
      buildMenuInto(subMenu, item.submenu);
      sub.appendChild(subMenu);
      menuEl.appendChild(sub);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
    // checked may be a function — evaluated fresh every time the menu opens
    const checkedVal = typeof item.checked === 'function' ? item.checked(ctx) : item.checked;
    el.innerHTML = (item.icon || '') + `<span>${item.label}</span>` +
      (item.checked !== undefined ? `<span class="check" style="display:${checkedVal ? 'inline' : 'none'}">&#10003;</span>` : '');
    if (!item.disabled && item.action) {
      el.addEventListener('click', (e) => { closeMenus(); item.action(ctx, e); });
    }
    menuEl.appendChild(el);
  }
}

function openMenu(items, x, y) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  buildMenuInto(menu, items);
  document.body.appendChild(menu);
  menu.style.display = 'block';
  if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
  if (y + menu.offsetHeight > window.innerHeight) y = Math.max(8, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  openMenuEl = menu;
  return menu;
}

document.addEventListener('mousedown', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenus();
});

// Canvas menu = every tool's canvasMenu contributions, grouped and ordered.
// Object menu = per-type sections for the selected types + the core tail.
function showContextMenu(e) {
  const wp = screenToWorld(e.clientX, e.clientY);
  contextWorld = wp;
  const objEl = e.target.closest('.canvas-obj');

  if (objEl) {
    const id = parseInt(objEl.dataset.id);
    const obj = objects.find(o => o.id === id);
    // A type may claim this right-click entirely (e.g. artboard corner
    // fields open their own field menu instead of the object menu).
    if (obj) {
      const def = registry.typeDef(obj.type);
      if (def && def.onContextMenu) {
        try {
          const custom = def.onContextMenu(obj, e, ctx);
          if (custom && custom.length) { openMenu(custom, e.clientX, e.clientY); return; }
        } catch (err) { console.error('onContextMenu hook failed', err); }
      }
    }
    if (!selectedIds.has(id)) selectObject(id);
    openMenu(buildObjectMenuItems(), e.clientX, e.clientY);
  } else {
    openMenu(buildCanvasMenuItems(), e.clientX, e.clientY);
  }
}

// Canvas menu composition. A tool contributes either:
//   flat item:   { label, icon, order, action, checked?, dividerBefore? }
//   submenu:     { submenu: 'Add Text', icon, order, dividerBefore?, items: [...] }
// Submenu contributions with the same `submenu` label MERGE across tools
// (the Annotate submenu is filled by shapes/markup/draw/eyedropper together):
// parent icon comes from the lowest-order contributor, items concatenate
// sorted by their own order. Everything sorts into one list by `order`.
// Order bands (convention, keeps the original app's arrangement):
//   10 images · 20 text · 30 flowchart · 40 artboards/export · 90 annotate
function buildCanvasMenuItems() {
  const flats = [];
  const subs = new Map(); // label → { icon, order, dividerBefore, items: [] }
  for (const t of registry.allTools()) {
    for (const c of (t.decl.canvasMenu || [])) {
      if (c.submenu) {
        let s = subs.get(c.submenu);
        if (!s) { s = { label: c.submenu, icon: c.icon, order: c.order || 0, dividerBefore: !!c.dividerBefore, items: [] }; subs.set(c.submenu, s); }
        if ((c.order || 0) < s.order) { s.order = c.order || 0; if (c.icon) s.icon = c.icon; }
        else if (!s.icon && c.icon) s.icon = c.icon; // adopt an icon regardless of load order
        if (c.dividerBefore) s.dividerBefore = true;
        s.items.push(...(c.items || []));
      } else {
        flats.push(c);
      }
    }
  }
  const entries = [...flats];
  for (const s of subs.values()) {
    s.items.sort((a, b) => (a.order || 0) - (b.order || 0));
    entries.push({ label: s.label, icon: s.icon, order: s.order, dividerBefore: s.dividerBefore, submenu: s.items });
  }
  if (entries.length === 0) return [{ label: 'No tools installed', disabled: true }];
  entries.sort((a, b) => (a.order || 0) - (b.order || 0));
  const items = [];
  for (const e of entries) {
    if (e.dividerBefore && items.length) items.push({ divider: true });
    items.push(e);
  }
  return items;
}

function buildObjectMenuItems() {
  const selObjs = objects.filter(o => selectedIds.has(o.id));
  const typesInSelection = [...new Set(selObjs.map(o => o.type))];
  const items = [];

  for (const type of typesInSelection) {
    const typeSel = selObjs.filter(o => o.type === type);
    let section = [];
    // The type owner's section first…
    const def = registry.typeDef(type);
    if (def && def.menu) {
      const owned = typeof def.menu === 'function' ? def.menu(typeSel, ctx) : def.menu;
      section.push(...owned.map(i => ({ ...i, _mo: i.order || 0 })));
    }
    // …then contributions from OTHER tools (decl.objectMenus[type]) — this
    // is how subfamily files (images.crop, images.nobg…) and remixes add
    // items to an object type they don't own. Sorted by item `order`.
    for (const t of registry.allTools()) {
      const contrib = t.decl.objectMenus && t.decl.objectMenus[type];
      if (!contrib) continue;
      const resolved = typeof contrib === 'function' ? contrib(typeSel, ctx) : contrib;
      section.push(...resolved.map(i => ({ ...i, _mo: i.order || 0 })));
    }
    if (section.length) {
      section.sort((a, b) => a._mo - b._mo);
      items.push(...section);
      items.push({ divider: true });
    }
  }

  // Core tail: align / arrange / z-order / delete (type-agnostic)
  items.push({
    label: 'Align',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="4" y2="20"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>',
    submenu: [
      {
        html: `<label class="ctx-item align-respace-check" title="On: also redistribute into an even row/column. Off: only align edges, keeping current spacing."><input type="checkbox" ${respaceChecked ? 'checked' : ''}><span>Respace</span></label>`,
        onClick(e) {
          const cb = e.currentTarget ? e.currentTarget.querySelector('input') : null;
          setTimeout(() => { if (cb) respaceChecked = cb.checked; }, 0);
        },
      },
      { divider: true },
      { label: 'Align Left', action: () => alignSelected('left') },
      { label: 'Align Right', action: () => alignSelected('right') },
      { label: 'Align Top', action: () => alignSelected('top') },
      { label: 'Align Bottom', action: () => alignSelected('bottom') },
      { label: 'Align Top + Bottom', action: () => alignTopBottom() },
      { divider: true },
      { label: 'Arrange in Grid', action: () => arrangeGrid() },
    ]
  });
  items.push({ label: 'Bring to Front', action: () => reorderSelected(true) });
  items.push({ label: 'Send to Back', action: () => reorderSelected(false) });
  items.push({ divider: true });
  items.push({ label: 'Delete', danger: true, action: () => deleteSelected() });
  return items;
}

// "Respace" (on by default): align tools also redistribute into an even
// row/column. Off: only align the edge, leaving the other-axis position.
let respaceChecked = true;

function alignSelected(edge) {
  const sel = objects.filter(o => selectedIds.has(o.id));
  if (sel.length < 2) return;
  pushUndo();
  const gap = 20;
  if (edge === 'left' || edge === 'right') {
    const targetX = edge === 'left'
      ? Math.min(...sel.map(o => o.x))
      : Math.max(...sel.map(o => o.x + o.w));
    if (respaceChecked) {
      const centerY = (Math.min(...sel.map(o => o.y)) + Math.max(...sel.map(o => o.y + o.h))) / 2;
      const totalH = sel.reduce((s, o) => s + o.h, 0) + gap * (sel.length - 1);
      sel.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      let curY = centerY - totalH / 2;
      sel.forEach(o => {
        o.x = edge === 'left' ? targetX : targetX - o.w;
        o.y = curY; curY += o.h + gap;
      });
    } else {
      sel.forEach(o => { o.x = edge === 'left' ? targetX : targetX - o.w; });
    }
  } else {
    const targetY = edge === 'top'
      ? Math.min(...sel.map(o => o.y))
      : Math.max(...sel.map(o => o.y + o.h));
    if (respaceChecked) {
      const centerX = (Math.min(...sel.map(o => o.x)) + Math.max(...sel.map(o => o.x + o.w))) / 2;
      const totalW = sel.reduce((s, o) => s + o.w, 0) + gap * (sel.length - 1);
      sel.sort((a, b) => (a.x - b.x) || (a.y - b.y));
      let curX = centerX - totalW / 2;
      sel.forEach(o => {
        o.y = edge === 'top' ? targetY : targetY - o.h;
        o.x = curX; curX += o.w + gap;
      });
    } else {
      sel.forEach(o => { o.y = edge === 'top' ? targetY : targetY - o.h; });
    }
  }
  renderObjects(); markDirty();
}

// Align Top + Bottom: match every object's height to the tallest by scaling
// PROPORTIONALLY (aspect preserved), align tops so bottoms line up too, and
// (with Respace) re-flow into a centered row. Artboards are excluded (their
// dimensions are ratio-locked).
function alignTopBottom() {
  const sel = objects.filter(o => selectedIds.has(o.id) && o.type !== 'artboard');
  if (sel.length < 2) return;
  pushUndo();
  const gap = 20;
  const H = Math.max(...sel.map(o => o.h));
  const minY = Math.min(...sel.map(o => o.y));
  const centerX = (Math.min(...sel.map(o => o.x)) + Math.max(...sel.map(o => o.x + o.w))) / 2;
  sel.forEach(o => {
    const scale = H / o.h;
    o.w = Math.max(1, Math.round(o.w * scale));
    o.h = H;
  });
  if (respaceChecked) {
    sel.sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const totalW = sel.reduce((s, o) => s + o.w, 0) + gap * (sel.length - 1);
    let curX = centerX - totalW / 2;
    sel.forEach(o => { o.y = minY; o.x = curX; curX += o.w + gap; });
  } else {
    sel.forEach(o => { o.y = minY; });
  }
  renderObjects(); markDirty();
}

function arrangeGrid() {
  const sel = objects.filter(o => selectedIds.has(o.id));
  if (sel.length < 2) return;
  pushUndo();
  const cols = Math.ceil(Math.sqrt(sel.length));
  const cellW = Math.max(...sel.map(o => o.w)) + 24;
  const cellH = Math.max(...sel.map(o => o.h)) + 24;
  const startX = Math.min(...sel.map(o => o.x));
  const startY = Math.min(...sel.map(o => o.y));
  sel.forEach((o, i) => {
    o.x = startX + (i % cols) * cellW;
    o.y = startY + Math.floor(i / cols) * cellH;
  });
  renderObjects(); markDirty();
}

function reorderSelected(toFront) {
  pushUndo();
  let i = 1;
  if (toFront) {
    const mz = Math.max(...objects.map(o => o.zIndex), 0);
    for (const sid of selectedIds) { const o = objects.find(x => x.id === sid); if (o) o.zIndex = mz + i++; }
  } else {
    const mz = Math.min(...objects.map(o => o.zIndex), 0);
    for (const sid of selectedIds) { const o = objects.find(x => x.id === sid); if (o) o.zIndex = mz - i++; }
  }
  renderObjects(); markDirty();
}

// ── Toolbar (generated) ────────────────────────────────────────────────
// Layout mirrors the original Sketchbook rail exactly:
//   home · divider · add-buttons · divider · modal tools · divider ·
//   save · spacer · zoom in/out/reset
// Tool entries declare `order` (bands: 10s adds, 30+ modal tools) and may
// set `dividerBefore: true` to open a new band.
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M9 21V12h6v9"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  zoomReset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9"/><polyline points="3 3 3 8 8 8"/></svg>',
};

function makeToolbarButton(icon, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.title = title;
  btn.innerHTML = icon;
  btn.addEventListener('click', onClick);
  return btn;
}

function toolbarDivider() {
  const d = document.createElement('div');
  d.className = 'toolbar-divider';
  return d;
}

function buildToolbar() {
  toolbar.innerHTML = '';
  toolbar.appendChild(makeToolbarButton(ICONS.home, 'Home', async () => {
    if (dirty) await saveProject();
    window.api.goHome();
  }));
  toolbar.appendChild(toolbarDivider());

  // Tool contributions. Families merge ACROSS tool files, mirroring the
  // right-click menus: separate files (shapes/draw/eyedropper…) can all
  // sit under one rail button ("Annotate") whose hover flyout lists them.
  //   toolbar action entry:  { icon, title, order, dividerBefore?, action }
  //   toolbar family entry:  { icon, title, order, dividerBefore?, items }
  //                          — entries with the same `title` merge
  //   modal tool in family:  tool: { family: 'Annotate', familyIcon,
  //                          familyOrder, order (flyout position), … }
  const standalone = [];
  const families = new Map(); // name → { icon, order, dividerBefore, items }
  function familyOf(name) {
    let f = families.get(name);
    if (!f) { f = { title: name, icon: null, order: Infinity, dividerBefore: false, items: [] }; families.set(name, f); }
    return f;
  }
  for (const t of registry.allTools()) {
    for (const b of (t.decl.toolbar || [])) {
      if (b.items && b.items.length) {
        const f = familyOf(b.title || t.manifest.name);
        if ((b.order || 0) < f.order) { f.order = b.order || 0; if (b.icon) f.icon = b.icon; }
        else if (!f.icon && b.icon) f.icon = b.icon; // adopt an icon regardless of load order
        if (b.dividerBefore) f.dividerBefore = true;
        f.items.push(...b.items);
      } else {
        standalone.push({ ...b, _toolId: t.manifest.id });
      }
    }
    if (t.decl.tool) {
      const tt = t.decl.tool;
      if (tt.family) {
        const f = familyOf(tt.family);
        const fOrder = tt.familyOrder !== undefined ? tt.familyOrder : (tt.order || 0);
        if (fOrder < f.order) { f.order = fOrder; if (tt.familyIcon || tt.icon) f.icon = tt.familyIcon || tt.icon; }
        else if (!f.icon && (tt.familyIcon || tt.icon)) f.icon = tt.familyIcon || tt.icon;
        if (tt.dividerBefore) f.dividerBefore = true;
        f.items.push({
          label: tt.title || t.manifest.name,
          icon: tt.flyoutIcon || '',
          order: tt.order || 0,
          modal: true,
          _toolId: t.manifest.id,
        });
      } else {
        standalone.push({
          icon: tt.icon,
          title: tt.title || t.manifest.name,
          order: tt.order || 0,
          dividerBefore: !!tt.dividerBefore,
          modal: true,
          _toolId: t.manifest.id,
        });
      }
    }
  }
  const entries = [...standalone];
  for (const f of families.values()) {
    f.items.sort((a, b) => (a.order || 0) - (b.order || 0));
    entries.push({ icon: f.icon, title: f.title, order: f.order === Infinity ? 0 : f.order, dividerBefore: f.dividerBefore, items: f.items, family: true });
  }
  entries.sort((a, b) => (a.order || 0) - (b.order || 0));

  let placedAny = false;
  for (const entry of entries) {
    if (entry.dividerBefore && placedAny) toolbar.appendChild(toolbarDivider());
    const btn = makeToolbarButton(entry.icon || ICONS.save, entry.items ? '' : (entry.title || entry._toolId), (e) => {
      if (entry.modal) setTool(activeToolId === entry._toolId ? null : entry._toolId);
      else if (entry.action) entry.action(ctx, e);
    });
    if (entry.modal) btn.dataset.toolId = entry._toolId;

    // Family flyout: hovering the button reveals its subfamily entries
    // (Text → Label/Title/…, Annotate → Rectangle/Pen/Eyedropper),
    // mirroring the right-click menu's family → subfamily hierarchy.
    if (entry.items && entry.items.length) {
      const wrap = document.createElement('div');
      wrap.className = 'tool-wrap';
      if (entry.title) btn.removeAttribute('title'); // flyout labels it
      wrap.appendChild(btn);
      const flyout = document.createElement('div');
      flyout.className = 'tool-flyout';
      if (entry.title) {
        const head = document.createElement('div');
        head.className = 'tool-flyout-title';
        head.textContent = entry.title;
        flyout.appendChild(head);
      }
      for (const item of entry.items) {
        const row = document.createElement('div');
        row.className = 'ctx-item';
        row.innerHTML = (item.icon || '') + `<span>${item.label}</span>`;
        if (item.modal) {
          row.dataset.toolId = item._toolId;
          row.addEventListener('click', () => setTool(activeToolId === item._toolId ? null : item._toolId));
        } else {
          row.addEventListener('click', (e) => { item.action(ctx, e); });
        }
        flyout.appendChild(row);
      }
      wrap.appendChild(flyout);
      toolbar.appendChild(wrap);
    } else {
      toolbar.appendChild(btn);
    }
    placedAny = true;
  }

  toolbar.appendChild(toolbarDivider());
  toolbar.appendChild(makeToolbarButton(ICONS.save, 'Save (Ctrl+S)', () => { dirty = true; saveProject(); }));

  const spacer = document.createElement('div');
  spacer.className = 'toolbar-spacer';
  toolbar.appendChild(spacer);

  toolbar.appendChild(makeToolbarButton(ICONS.zoomIn, 'Zoom In', () => zoomAt(1.2)));
  toolbar.appendChild(makeToolbarButton(ICONS.zoomOut, 'Zoom Out', () => zoomAt(1 / 1.2)));
  toolbar.appendChild(makeToolbarButton(ICONS.zoomReset, 'Reset View', () => { zoom = 1; panX = 0; panY = 0; applyTransform(); }));
}

function updateToolbarActive() {
  toolbar.querySelectorAll('.tool-btn[data-tool-id]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.toolId === activeToolId);
  });
  // Flyout rows for modal tools + their family button light up together
  toolbar.querySelectorAll('.tool-flyout [data-tool-id]').forEach(row => {
    row.classList.toggle('active', row.dataset.toolId === activeToolId);
  });
  toolbar.querySelectorAll('.tool-wrap').forEach(wrap => {
    const anyActive = !!wrap.querySelector(`.tool-flyout [data-tool-id="${activeToolId}"]`);
    const btn = wrap.querySelector('.tool-btn');
    if (btn && !btn.dataset.toolId) btn.classList.toggle('active', anyActive);
  });
}

// ── Tool lifecycle ─────────────────────────────────────────────────────
function setTool(toolId) {
  if (activeToolId) {
    const prev = registry.tool(activeToolId);
    if (prev && prev.decl.tool) {
      if (prev.decl.tool.onDeactivate) { try { prev.decl.tool.onDeactivate(ctx); } catch (e) { console.error(e); } }
      if (prev.decl.tool.cursor) viewport.style.cursor = '';
    }
  }
  hideBar();
  activeToolId = toolId;
  if (toolId) {
    const t = registry.tool(toolId);
    if (t && t.decl.tool) {
      if (t.decl.tool.cursor) viewport.style.cursor = t.decl.tool.cursor;
      if (t.decl.tool.onActivate) { try { t.decl.tool.onActivate(ctx); } catch (e) { console.error(e); } }
    }
  }
  updateToolbarActive();
}

// ── Bars (bottom-center slot for tool UIs) ─────────────────────────────
function showBar(el) { barSlot.innerHTML = ''; barSlot.appendChild(el); }
function hideBar() { barSlot.innerHTML = ''; }

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toastMsg.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ── Keyboard ───────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const inEdit = e.target.closest('[contenteditable]') || /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  if (e.code === 'Space' && !inEdit) { e.preventDefault(); spaceDown = true; viewport.classList.add('panning'); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !inEdit) deleteSelected();
  if (e.key === 'Escape') { selectObject(null); closeMenus(); setTool(null); }
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !inEdit) fitToView();
  if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !inEdit) setTool(null);
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !inEdit) { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !inEdit) { e.preventDefault(); redo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); dirty = true; saveProject(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inEdit) {
    e.preventDefault();
    objects.forEach(o => selectedIds.add(o.id));
    updateSelectionVisuals();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !inEdit) copySelected();
  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !inEdit) pasteClipboard();

  // Tool shortcuts from the registry (single letters, no modifiers)
  if (!inEdit && !e.ctrlKey && !e.metaKey && !e.altKey) {
    for (const t of registry.allTools()) {
      if (t.decl.tool && t.decl.tool.shortcut === e.key) {
        setTool(activeToolId === t.manifest.id ? null : t.manifest.id);
        return;
      }
      for (const sc of (t.decl.shortcuts || [])) {
        if (sc.key === e.key) { sc.action(ctx); return; }
      }
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; viewport.classList.remove('panning'); }
});

// ── Copy / paste (cross-project, via main process) ─────────────────────
async function copySelected() {
  const sel = objects.filter(o => selectedIds.has(o.id));
  if (!sel.length) return;
  await window.api.setClipboard({ project: projectName, objects: JSON.parse(JSON.stringify(sel)) });
  showToast(`Copied ${sel.length} object${sel.length > 1 ? 's' : ''}`);
}

async function pasteClipboard() {
  const payload = await window.api.getClipboard();
  if (!payload || !payload.objects || !payload.objects.length) {
    // No object clipboard — offer the paste to tools (e.g. images pastes
    // a bitmap from the native clipboard, like the original app).
    for (const t of registry.allTools()) {
      if (t.decl.onPasteEmpty) {
        try { if (await t.decl.onPasteEmpty(ctx)) return; } catch (err) { console.error(err); }
      }
    }
    return;
  }
  pushUndo();
  const pasted = [];
  for (const src of payload.objects) {
    const clone = normalizeObject({
      ...JSON.parse(JSON.stringify(src)),
      id: nextId++,
      x: src.x + 20, y: src.y + 20,
      zIndex: Math.max(...objects.map(o => o.zIndex), 0) + 1,
    });
    const def = registry.typeDef(clone.type);
    if (def && def.onPaste) {
      try { await def.onPaste(clone, ctx); } catch (err) { console.error('onPaste hook failed', err); }
    }
    objects.push(clone);
    pasted.push(clone);
  }
  selectedIds.clear();
  pasted.forEach(o => selectedIds.add(o.id));
  renderObjects(); markDirty();
}

// ── ctx: the ONLY surface tools may touch ──────────────────────────────
// Append-only once shipped. Keep it small enough to describe in a tool
// file's header comment.
const ctx = {
  // state (read; mutate via the ops below or with pushUndo around edits)
  get objects() { return objects; },
  get selectedIds() { return selectedIds; },
  get project() { return projectName; },
  getZoom: () => zoom,
  getActiveTool: () => activeToolId,
  // Small persisted per-tool flags, saved inside canvasState.toolState.
  // Namespace your keys with your tool id (e.g. 'flowchart.flipped').
  state: {
    get: (key) => toolState[key],
    set: (key, value) => { toolState[key] = value; markDirty(); },
  },

  // object ops
  createObject(props) {
    const obj = normalizeObject({
      zIndex: Math.max(...objects.map(o => o.zIndex), 0) + 1,
      ...props,
      id: nextId++,
    });
    objects.push(obj);
    return obj;
  },
  findObject: (id) => objects.find(o => o.id === id) || null,
  selectObject,
  clearSelection: () => selectObject(null),
  deleteSelected,

  // lifecycle discipline
  pushUndo,
  markDirty,
  renderObjects,
  updateSelectionVisuals,

  // coordinates
  screenToWorld,
  viewportCenter,
  get contextWorld() { return contextWorld; },

  // ui
  showToast,
  setTool,
  openMenu,
  closeMenus,
  showBar,
  hideBar,
  worldEl: world,
  viewportEl: viewport,

  // rendering services
  // Draw any object onto a 2d canvas via its type's exportDraw
  // (t = { x, y, scaleX, scaleY } — the object's target rect/scale).
  exportObject(c2d, obj, t) {
    const def = registry.typeDef(obj.type);
    if (def && def.exportDraw) {
      try { def.exportDraw(c2d, obj, t, ctx); } catch (err) { console.error(`exportDraw failed for "${obj.type}"`, err); }
      return true;
    }
    return false;
  },

  // io (mediated main-process access — tools never see window.api)
  io: {
    importImages: (opts) => window.api.importImages(projectName, opts),
    dropImage: (filePath) => window.api.dropImage(projectName, filePath),
    pasteImage: () => window.api.pasteImage(projectName),
    removeWhiteBg: (assetPath) => window.api.removeWhiteBg(assetPath),
    importExternalAsset: (srcPath) => window.api.importExternalAsset(projectName, srcPath),
    getFilePath: (file) => window.api.getFilePath(file), // real path of a dropped File

    exportJpeg: (filename, dataUrl) => window.api.exportArtboard(filename, dataUrl),
    pickFolder: (title) => window.api.pickFolder(title),
    saveJpegToFolder: (folder, filename, dataUrl) => window.api.saveArtboardToFolder(folder, filename, dataUrl),
    assetUrl: (assetPath) => 'file://' + String(assetPath).replace(/\\/g, '/'),
  },
};

// ── Tool loader ────────────────────────────────────────────────────────
// Every file loads in isolation: a broken tool disables itself, reports
// why, and the rest of the app carries on. This is a tinkerer's app —
// syntax errors are Tuesday, not an emergency.
async function loadTools() {
  let files = [];
  try { files = await window.api.listTools(); }
  catch (err) { console.error('listTools failed', err); }

  for (const file of files) {
    try {
      const mod = await import(`../tools/${file}?t=${Date.now()}`);
      if (!mod.manifest || !mod.manifest.id) throw new Error('missing exported manifest.id');
      if (typeof mod.register !== 'function') throw new Error('missing exported register(ctx)');
      const decl = mod.register(ctx) || {};
      if (decl.css) {
        const style = document.createElement('style');
        style.dataset.tool = mod.manifest.id;
        style.textContent = decl.css;
        document.head.appendChild(style);
      }
      // Raw pointer handlers: interactions that must run even in pointer
      // mode (e.g. flowchart connection anchors pre-empting object move).
      for (const p of (decl.pointer || [])) {
        registerPointerHandler(p.priority || 250, (e) => {
          try { return !!p.handler(e, ctx); } catch (err) { console.error(`pointer handler (${mod.manifest.id})`, err); return false; }
        });
      }
      registry.add(mod.manifest, decl);
    } catch (err) {
      console.error(`Tool "${file}" failed to load:`, err);
      registry.loadErrors.push({ file, error: err.message });
    }
  }
  registry.resolve();

  if (registry.loadErrors.length) {
    const names = registry.loadErrors.map(e => e.file).join(', ');
    showToast(`${registry.loadErrors.length} tool(s) failed to load: ${names} — see console`);
  }
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  window.api.setTitle(`Blank-Slate — ${projectName}`);

  await loadTools();
  buildToolbar();

  const data = await window.api.loadProject(projectName);
  if (data && !data.error) {
    objects = (data.objects || []).map(normalizeObject);
    recalcNextId();
    if (data.canvasState) {
      panX = Number(data.canvasState.panX) || 0;
      panY = Number(data.canvasState.panY) || 0;
      zoom = Number(data.canvasState.zoom) || 1;
      toolState = (data.canvasState.toolState && typeof data.canvasState.toolState === 'object')
        ? data.canvasState.toolState : {};
      // Legacy: the original app stored flowchartFlipped at the top level
      if (data.canvasState.flowchartFlipped !== undefined && toolState.flowchartFlipped === undefined) {
        toolState.flowchartFlipped = !!data.canvasState.flowchartFlipped;
      }
    }
  } else {
    showToast('Could not load project');
  }

  applyTransform();
  renderObjects();

  for (const t of registry.allTools()) {
    if (t.decl.onReady) { try { t.decl.onReady(ctx); } catch (e) { console.error(e); } }
  }
}

window.addEventListener('beforeunload', () => { if (dirty) saveProject(); });

init();
