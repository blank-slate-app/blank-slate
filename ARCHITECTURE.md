# Blank-Slate.app — Architecture

The whole-app map: processes, kernel internals, invariants, and how the
pieces wire together. The **tool-author contract** (manifest schema, every
declaration key, the full ctx API with usage rules) lives in
`_tools/AGENTS.md` — agents pointed at `_tools/` read that, not this. When the
kernel's ctx surface or declaration keys change, `_tools/AGENTS.md`,
`_tools/_template.js`, and this file must be updated in the same commit.

Core idea: a small kernel (`js/engine.js`) that knows **nothing about any
object type**, plus a flat `_tools/` folder where every tool is one
self-contained, remixable file. Tools declare UI and behavior; the kernel
composes them. Pristine copies live in `_baseline/` and auto-revive if a tool
file is deleted (the MySpace model: edit anything, never brick the app).

## File layout

```
blank-slate app/
├── _tools/            USER SPACE (the `_` prefix sorts these four to the
│                      top): one file per tool + AGENTS.md (contract) +
│                      _template.js (never loads — `_`-prefixed FILES are
│                      skipped by the loader)
├── _baseline/         pristine byte-identical twins of the 10 real tools
├── _projects/<name>/  project.json + assets/ (imported images)
├── _decks/            local deck library: one folder per published/downloaded
│                      deck ("Title - Author"/ with manifest, PDF, images,
│                      tools — deck-internal subfolder names are part of the
│                      shared community format and stay unprefixed)
├── js/
│   ├── main.js        Electron main (CommonJS): windows, IPC, Sharp image
│   │                  pipeline, project CRUD, baseline revive, export DPI
│   ├── preload.js     contextBridge → window.api (the ONLY IPC gateway)
│   ├── engine.js      THE KERNEL (ES module, ~1450 lines) — loaded by
│   │                  canvas.html as <script type="module" src="../js/engine.js">
│   └── publish-community.js  maintainer script: stage community-repo/ from _decks/
├── html/              landing.html (project picker) · canvas.html (renderer
│                      shell: FRC chrome CSS + layout divs; no inline JS)
├── cache/             community fetch cache (preview PDFs) — safe to delete
├── bat/               launch (dev) · build (package dist/ zip) · push (app
│                      source) · push-community (community catalog, see
│                      COMMUNITY-SETUP.md). All cd to the app root first.
└── package.json       entry "js/main.js". Stays at the root — npm, Electron
                       and electron-builder all require it there. Dev root =
                       this folder (BASE_DIR = js/..); packaged root = the
                       exe's folder. (.gitignore likewise must stay at root.)
```

## Processes and IPC

`main.js` is CommonJS; the renderer is ESM (`canvas.html` boots
`js/engine.js` as a module). Tools never see `window.api` — the kernel
wraps everything they need behind `ctx` (append-only surface).

`ipcMain.handle` channels (all invoke-style, no `ipcMain.on`):

| Group | Channels |
|---|---|
| Tools | `list-tools`, `get-tools-dir` (absolute path; the kernel imports tool modules from it as file:// URLs so the packaged app loads the LIVE files next to the exe, not the shipped seeds in resources/app), `revive-baseline` |
| Projects | `get-projects`, `create-project`, `delete-project`, `load-project`, `save-project` |
| Images (Sharp) | `import-images`, `drop-image`, `paste-image`, `remove-white-bg`, `import-external-asset` |
| Export | `export-artboard`, `export-artboards-all`, `pick-folder`, `save-artboard-to-folder` |
| Clipboard | `set-clipboard`, `get-clipboard` (cross-project copy/paste) |
| Window | `open-canvas`, `go-home`, `set-title`, `create-shortcut` |
| Decks | `get-decks` (lists _decks/*.pdf → name/author/file URL for the Decks side panel) |
| Sharing | `get-project-dir`, `get-tool-status` (unique-vs-baseline per file), `sweep-assets` (orphan cleanup on Home), `publish-deck` (tidy deck folder into _decks/: ≤1MB images, unique tools, preview PDF via a built-in JPEG-page writer, manifest), `import-deck` (folder → new project), `import-deck-into` (merge a cached deck into the OPEN project) |
| Community (BlenderKit model) | `fetch-community-catalog` (index.json from the shared GitHub repo — see COMMUNITY-SETUP.md), `download-community-deck` (raw-fetch the deck folder into the _decks/ cache), `install-community-tool` (fetch + conflict-safe install). The Decks/Tools panels are live views of this catalog; local _decks/ doubles as the offline cache and My Library. |

`preload.js` bridges all of the above 1:1, plus `getFilePath` =
`webUtils.getPathForFile` (direct synchronous call, deliberately not IPC).

**Dormant, reserved surface** (wired end-to-end, no caller yet — do not
delete): `export-artboards-all` (batch export in one IPC; the shipped
artboards tool instead loops `pick-folder` + `save-artboard-to-folder` one
artboard at a time to avoid IPC payload limits, same as the original app)
and `revive-baseline` (force-restore; the S4 Tools dialog will call it —
auto-revive of *missing* files already runs at startup without it).

## The kernel (`js/engine.js`)

Owns everything generic: tool loading, object store + normalization,
render loop, selection/move/resize/marquee, snap guides, pan/zoom, undo,
autosave, copy/paste, menus, toolbar + family flyouts, keyboard dispatch,
pointer pipeline, export orchestration, toast/indicators, and the ctx API.

It contains **zero object-type knowledge**. Anything type-specific lives in
a tool's `objectTypes` declaration. If you're adding an `if (obj.type ===`
to the kernel, you're doing it wrong.

### Tool loading

1. `window.api.listTools()` → `main.js` readdirs `_tools/*.js`, skipping
   `_`-prefixed files.
2. Kernel dynamically `import()`s each file; a file that throws is logged
   and skipped — one broken tool never takes down the app (crash isolation).
3. Registration is two-pass so toolbar families and same-label submenus
   merge correctly regardless of load order (icon adoption: a family/submenu
   takes its icon from the lowest-order contributor, or the first one that
   has an icon).
4. At startup `main.js` runs `reviveMissingBaselines()`: any baseline tool
   missing from `_tools/` is copied _baseline → _tools. Edited files are
   respected; only *missing* files revive. `.js` filter means docs in
   `_baseline/` can never leak into `_tools/`.

### Object model and project format

`_projects/<name>/project.json`:

```json
{ "name": "...", "created": "ISO", 
  "canvasState": { "panX": 0, "panY": 0, "zoom": 1, "toolState": {} },
  "objects": [ { "id": 1, "type": "...", "x": 0, "y": 0, "w": 0, "h": 0, "zIndex": 1, "rotation": 0, ... } ] }
```

**Asset paths are RELATIVE to the project folder** (`assets/x.jpg`),
resolved by the kernel's `relAsset`/`absAsset` helpers behind `ctx.io` —
tools never see absolute paths, so projects can be renamed, moved and
shared. Legacy absolute paths still resolve and migrate to relative on
load. `project.json` also carries a **tool ledger** (`tools:
[{id, version, authors, basedOn, unique}]` — `unique` = differs from the
shipped baseline), written on every save so a published deck knows exactly
which tool files to bundle. Orphaned asset files are swept when leaving a
project via Home (never mid-session — undo could resurrect references).
The publish/import loop: artboards' "Publish Deck…" builds a tidy folder
(clean artboards-only project, ≤1MB images, unique tools, ≤5MB preview
PDF, manifest.json); the Decks panel's "Import deck folder…" installs one
as a project with tool-conflict safety.

The objects array is the single source of truth — serialized as-is for
save, undo snapshots, and copy/paste. Kernel normalization coerces the
core fields (id/type/x/y/w/h/zIndex plus `rotation` — quarter turns
0/90/180/270 cw around the center, applied as a CSS transform on canvas
and a canvas transform around export; the `r` hotkey rotates the selection
unless a type declares `rotatable: false`) and **preserves all unknown
fields verbatim**; unknown types
render as gray placeholders and survive save/load untouched (a project is
never damaged by a missing tool). `toolState` holds small persisted
per-tool flags behind `ctx.state.get/set`.

Objects are DOM elements (positioned divs inside `#world`), not `<canvas>`
pixels. `renderObjects()` removes only `.canvas-obj` elements — kernel
furniture inside `#world` (`#selectRect`, `.snap-guide`) survives re-render.
Every selected object gets kernel corner resize handles unless its type
declares `resizable: false` (connectors do: their bbox is derived from the
curve, so generic handles would float in empty space — a selected connector
draws its own highlight + endpoint dots instead).

Mutation discipline (enforced by convention, documented in AGENTS.md):
`pushUndo()` BEFORE mutations, `renderObjects()` after structural changes,
`markDirty()` after any change (autosave debounces 500ms; `beforeunload`
save is best-effort only — the Home button awaits a real save).

### Coordinate spaces — the invariants

- `#viewport` fills the window minus the 52px RIGHT rail and **must never
  move** — the floating-panel look comes from `clip-path`, which trims
  paint only (`--stage-left`: 58px, or 452px while a side panel is open —
  see "Zone push" under Menus/toolbar). `screenToWorld`, zoom anchoring,
  and every pointer interaction assume this box. Rails and side panels are
  fixed elements outside it.
- `#world` carries the single pan/zoom transform
  (`translate(panX,panY) scale(zoom)`).
- **There is no canvas grid layer.** The only visible grid is the fixed
  32px peach page grid on `<body>`, reading through the translucent panel
  (`--frc-canvas-bg`, 60% black) — same as the original Sketchbook. The
  40px `GRID` constant is the INVISIBLE world snap grid. Do not paint a
  second, zoom-scaled grid over the panel; it produces the "double grid"
  artifact (removed twice now — 2026-07).
- **Placement rule:** any element positioned in WORLD coordinates
  (`obj.x/y`, `screenToWorld` output) must live INSIDE `#world`
  (`.canvas-obj`, `.snap-guide`, `#selectRect`); any element positioned
  from raw `clientX/Y` lives OUTSIDE it (context menus, `#barSlot`, toast,
  indicators). Violating this reproduces the marquee bug (2026-07: 
  `#selectRect` sat outside `#world` while the marquee set world coords on
  it — the drawn rect missed the cursor at any pan/zoom ≠ 0/1).

### Pointer pipeline

One viewport `mousedown` dispatcher runs handlers in ascending priority
until one returns true. Kernel handlers:

| Priority | Handler |
|---|---|
| 100 | pan (right/middle/space+left) and ctrl+right drag-zoom |
| 200 | active modal tool's `onPointerDown` |
| 300 | resize handles (single object + uniform group scale) |
| 400 | object select / move / alt-duplicate (with snap) |
| 500 | marquee select on empty space (world-space rect) |

Tools inject raw handlers via `decl.pointer` (default priority 250 — after
the active tool, before resize). Shipped uses: 150 crop-mode close
(images), 240/245 connector anchors/endpoint re-drag (flowchart), 250
markup note-drag, 350 connector click-select (flowchart).

### Menus, toolbar, families

The RIGHT rail starts with Home (kernel chrome: save + back to landing);
tool contributions follow after the divider. A second, LEFT rail is pure
app chrome with two buttons — Decks and Tools — each toggling a floating
side panel (Decks: card gallery of _decks/*.pdf, 16:9 landscape covers with
name + author and hover ARROWS that flip the deck's pages in place — the
card's only UI, no reader window; Tools: the installed tool files with
version, author ledger, description, and fork badges — the S4 Tools-dialog
seed). Pages render via Chromium's built-in PDF viewer (`plugins: true` on
the main window) in `pointer-events: none` iframes; flipping swaps the
iframe URL with a `?p=` cache-buster because hash-only changes don't
renavigate a plugin document. `get-decks` heuristically parses each PDF's
page count (`/Count`, `/Type /Page`, linearization `/N`) so the arrows
clamp; unparseable PDFs fall back to a soft cap of 30.

**Zone push, not overlay:** opening a panel keeps the canvas its own zone —
panel and canvas sit side by side. Mechanism (the #viewport box still never
moves): `body.panel-open` slides the painted clip's left edge from
`--stage-left` 58px to 452px (STAGE_LEFT_BASE/STAGE_LEFT_PANEL in
engine.js must match), and the kernel simultaneously pans the world by the
same +394px (`pushZone`) so content travels WITH its zone; closing reverses
it. The compensation (`stagePanComp`) is transient: `saveProject` subtracts
it, so persisted `panX` is always panel-closed-normalized. Zone-aware
geometry (`stageLeft()`/`zoneCenterX()`) keeps `viewportCenter`, `zoomAt`,
and `fitToView` centered in the VISIBLE zone in both states.

Right-click composition: canvas menu from `canvasMenu` declarations, object
menu from the type's own `menu` (array or `(selObjs, ctx) => items`
function) plus other tools' `objectMenus` contributions, all sorted by
`order`. Same-label submenus merge across files; toolbar buttons with
`items` (or modal tools with `family`) become family buttons whose hover
flyout lists the subfamily — same hierarchy as the right-click menus.
Order bands: 10 images · 20 text · 25–31 flowchart · 40–42 artboards ·
90 annotate (dividerBefore). A type may claim a right-click entirely via
`objectTypes.<type>.onContextMenu` (artboard corner fields do this).

### Keyboard

Reserved kernel keys: `f` fit-to-view, `v` pointer, `Esc`, `Delete`/
`Backspace`, `Space` pan, Ctrl+`z/y/s/a/c/v`. `f`/`v` return immediately so
they can never fall through into the tool-shortcut loop. Tool shortcuts
(single letters, no modifiers) come from `tool.shortcut` or
`decl.shortcuts`; currently taken: `r` rectangle, `m` markup, `d` pen,
`i` eyedropper. Never reuse a reserved or taken letter.

### Export pipeline

The kernel orchestrates, types draw: `ctx.exportObject(c2d, obj, t)` calls
the type's `exportDraw(c2d, obj, t, ctx)` with `t = {x, y, scaleX, scaleY}`
(world → canvas mapping), wrapped by every tool's
`onBeforeObjectExport`/`onAfterObjectExport` decorators (how filters apply
`c2d.filter` to images they don't own). Consumers: the artboards exporter
(renders overlapping objects onto its canvas at 2×) and the eyedropper
sampler (renders the clicked object offscreen to pick a pixel). Artboards
render at fixed pixel sizes (1:1 1500², 16:9 2400×1350, 17:11 2550×1650),
export at 2×, and `main.js` stamps `EXPORT_DPI = 600` into the JPEG header
(same pixels, halves the print dimensions for crisp output).

## Current tool inventory

| File | Types | Contributes |
|---|---|---|
| draw.js | drawing | Pen (Annotate 3, `d`) |
| shapes.js | shape | Rectangle (Annotate 1, `r`, dividerBefore) |
| markup.js | markup | Markup callouts (Annotate 2, `m`) |
| eyedropper.js | swatch | Eyedropper (Annotate 4, `i`) |
| text.js | text | Text family: Label/Title/Subtitle/Description |
| flowchart.js | flowchart, connector | boxes, connectors, chain-depth colors, Flip |
| images.js | image | Add Images family root; crop system; remove white bg |
| images.hires.js | — | Add Hi-Res Image (add-fork of images, `basedOn`) |
| images.filters.js | — | Filters… on image right-click (operate-subfamily: blur/grain/fade via render+export decorators) |
| artboards.js | artboard | Add/export/rename artboards, corner fields, renumber, Match Last |
| _template.js | block | never loads — authoring skeleton only |

`_baseline/` mirrors the 10 real tools byte-for-byte (verified 2026-07).

## Verifying a change

Every commit must launch: `npm start` → create/open a project → smoke:
add one object per family, move/resize/marquee, undo, save, reload, right-
click menus (canvas + object), toolbar flyouts, export one artboard. If the
change touched ctx or declaration keys: update `_tools/AGENTS.md` +
`_tools/_template.js` + this file together. If it touched a baseline tool:
copy the identical file into `_baseline/`.

Still open (from the original build plan, now retired): per-object tool
stamps, install-on-open prompts, an in-app Fork action with append-only
ledger, family variant submenus, importing projects from the original
CanvasApp, and ledger signing (manifest shape already allows it).
