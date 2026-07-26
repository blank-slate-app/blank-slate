# Blank-Slate Tools — the authoring contract

This folder is the entire plugin system. **One file = one tool.** The app
scans `_tools/*.js` at startup, imports each file in isolation, and generates
its toolbar button, menu entries, and keyboard shortcut automatically. There
is no build step, no imports between files, no registration anywhere else.

You are probably an AI agent asked to build or remix a tool. Everything you
need is in this file plus `_template.js`. Do not read or modify
`js/engine.js` — tools only ever talk to the app through the `ctx` API
documented below.


## The rules

1. **One self-contained file.** No `import` statements. Everything inline:
   manifest, CSS, rendering, menus. The file must survive being copy-pasted
   into a chat window and edited by a model that has never seen this app.
2. **Only touch `ctx`.** Never `window.api`, never other tools' objects,
   never DOM outside the elements you create.
3. **The discipline triplet.** Before mutating objects call `ctx.pushUndo()`;
   after structural changes call `ctx.renderObjects()`; after any change call
   `ctx.markDirty()`. Skipping these breaks undo or loses work.
4. **Baseline files** (the 8 shipped tools) may be edited — that's the fun —
   but never deleted (they auto-revive at startup). To restore a pristine
   copy, use Revert to Baseline in the app, or copy from `../_baseline/`.
5. **Remixing:** COPY the file → new filename → change `manifest.id` →
   set `manifest.basedOn` to the original id → **append** your name to
   `manifest.authors` (never remove existing names — that ledger is the
   whole point). Where your remix APPEARS depends on what it does:
   - **Add-fork** (it creates the family's objects, e.g. Add Hi-Res
     Image): contribute items to the family's toolbar flyout and
     right-click canvas submenu. Live example: `images.hires.js`.
   - **Operate-subfamily** (it acts on EXISTING objects of the family,
     e.g. filters on images): contribute to the right-click menu of the
     object itself via `objectMenus: { image: [ ...items ] }`. It does
     NOT appear in the add menus.
6. **New tool:** copy `_template.js` → new filename → unique `manifest.id`,
   no `basedOn`. Your tool gets its own toolbar button / menu entry.
   (Filenames starting with `_` never load — that's why the template
   itself doesn't appear in the app.)
7. **Filename = manifest.id + `.js`.** Lowercase, hyphens allowed.
   Remix naming: `<family>.<yourname>.js` (e.g. `artboards.maya.js`).
8. **Never corrupt data you don't understand.** Objects carry fields from
   other tools; leave unknown fields alone.


## Manifest schema

```js
export const manifest = {
  id: 'my-tool',            // unique, matches filename
  name: 'My Tool',          // human label (toolbar tooltip, menus)
  version: '1.0.0',
  authors: ['yourname'],    // APPEND-ONLY ledger; never rewrite history
  basedOn: null,            // remixes: the id of the tool you forked
  description: 'One line about what this does.',
};
```


## register(ctx) — what you return

`register(ctx)` is called once at startup. Keep a reference to `ctx` in a
closure for your handlers. Return a declaration object; every key optional:

```js
export function register(ctx) {
  return {
    css: `...`,                    // injected once; prefix selectors with your type/class names

    // Object types you own: how your things render and behave
    objectTypes: {
      mything: {
        defaults: { color: '#F0C4A0' },      // merged into new/loaded objects
        normalize(obj) {},                   // optional: sanitize loaded data in place
        render(obj, el, ctx) {},             // REQUIRED: populate el (a positioned div)
        exportDraw(c2d, obj, t, ctx) {},     // draw onto a canvas 2d context for export;
                                             // t = { x, y, scaleX, scaleY } world→canvas.
                                             // Omit it and your type is skipped by
                                             // exporters and the eyedropper sampler.
        menu: [ /* right-click items when a mything is selected */ ],
        // menu may also be a function: menu(selObjs, ctx) => [ ...items ]
        // (text/flowchart/image/artboard all use the function form).
        proportionalResize: false,           // true = corner resize keeps aspect
        resizable: true,                     // false = kernel adds NO corner handles;
                                             // for types whose bbox is derived rather
                                             // than authored (connectors hug their
                                             // curve) and that render their own
                                             // selection affordances
        rotatable: true,                     // false = the 'r' rotate hotkey skips
                                             // this type (artboards, connectors).
                                             // Rotation is a KERNEL core field:
                                             // obj.rotation ∈ 0/90/180/270 (cw,
                                             // around the center) — applied as a
                                             // CSS transform on the element and a
                                             // canvas transform around exportDraw,
                                             // so types render/export unrotated
                                             // coordinates and never handle it.
        onDoubleClick(obj, e, ctx) {},       // optional
        onDuplicate(clone, ctx) {},          // optional: fix fields on alt-drag copies
        async onPaste(obj, ctx) {},          // optional: e.g. localize assets on cross-project paste
        onContextMenu(obj, e, ctx) {},       // optional: right-click on a SUB-PART of your
                                             // object (e.g. an artboard corner field);
                                             // return an items array to open that menu
                                             // instead of the type's normal one, or
                                             // null/undefined to fall through.
      },
    },

    // A modal tool (click button / press shortcut, then interact on canvas)
    tool: {
      icon: '<svg viewBox="0 0 24 24">...</svg>',   // 24-grid outline style, stroke currentColor
      title: 'My Tool (X)',
      order: 40,                    // rail position — or flyout position if in a family
      shortcut: 'x',                // single lowercase letter, no modifiers
      cursor: 'crosshair',          // viewport cursor while active
      // OPTIONAL — join a toolbar FAMILY: separate tool files sharing one
      // rail button whose hover flyout lists them (family → subfamily,
      // same hierarchy as the right-click menus). Same-name families
      // merge across files; the family button lights up when any member
      // tool is active. E.g. shapes/draw/eyedropper all sit under 'Annotate'.
      family: 'Annotate',
      familyIcon: '<svg viewBox="0 0 24 24">...</svg>', // the rail button's icon
      familyOrder: 30,              // the rail button's position
      flyoutIcon: '<svg width="14" height="14" ...>',   // this tool's row icon
      dividerBefore: true,          // opens a new band on the rail
      onActivate(ctx) {},           // e.g. ctx.showBar(myBarElement)
      onDeactivate(ctx) {},
      onPointerDown(e, ctx) {       // left-clicks while your tool is active
        return true;                // true = you consumed the event
      },
    },

    // Non-modal toolbar buttons (immediate actions, e.g. "Add Image").
    // Give a button `items` and it becomes a FAMILY button: hovering it
    // reveals a flyout with the subfamily (like Text → Label/Title/…),
    // mirroring the right-click menu hierarchy. `dividerBefore: true`
    // opens a new band on the rail.
    toolbar: [
      { icon: '<svg.../>', title: 'Add Thing', order: 10, action(ctx, e) {} },
      { icon: '<svg.../>', title: 'Thing', order: 11, items: [
        { label: 'Variant A', order: 1, action(ctx) {} },
      ] },
    ],

    // Right-click-on-empty-canvas menu contributions. Two shapes:
    //   flat item:  { label, icon, order, action, checked?, dividerBefore? }
    //   submenu:    { submenu: 'Add Text', icon, order, dividerBefore?,
    //                 items: [{ label, icon?, order, action }] }
    // Submenus with the SAME label merge across tools (that's how shapes/
    // markup/draw/eyedropper share one "Annotate ▶" submenu). Everything
    // sorts by `order`; `dividerBefore: true` draws a separator above.
    // Order bands (match the original app's arrangement):
    //   10 images · 20 text · 30 flowchart · 40 artboards/export · 90 annotate
    // Use ctx.contextWorld for "create it where I clicked".
    canvasMenu: [
      { label: 'Add Thing', icon: '<svg.../>', order: 35, action(ctx, e) {} },
      { submenu: 'Things', icon: '<svg.../>', order: 36, items: [ /* items */ ] },
    ],

    // Extra keyboard shortcuts (beyond the modal tool's own)
    shortcuts: [ { key: 'j', action(ctx) {} } ],

    // Contribute menu items to an object type you DON'T own (this is how
    // operate-subfamilies like filters appear when right-clicking an
    // image). Items merge into that type's section, sorted by `order`
    // (the owner's own items sort in the same list).
    objectMenus: {
      image: [ { label: 'My Filter…', order: 50, action(ctx) {} } ],
      // or a function: image: (selObjs, ctx) => [ ...items ]
    },

    // Double-click on an object of a type you don't own (first handler
    // to return true wins; the type owner is asked first).
    onObjectDoubleClick(obj, e, ctx) { return false; },

    // Decorator hooks — embellish objects you don't own. onObjectRender
    // runs after every object's render (e.g. apply a CSS filter to the
    // <img> inside); the export pair wraps every exportDraw (e.g. set
    // c2d.filter before an image draws and clear it after).
    onObjectRender(obj, el, ctx) {},
    onBeforeObjectExport(c2d, obj, t, ctx) {},
    onAfterObjectExport(c2d, obj, t, ctx) {},

    // Raw pointer handlers — run on viewport mousedown even in pointer
    // mode, BEFORE selection/move (priority 250 slots between the active
    // tool at 200 and resize at 300). Return true to consume the event.
    pointer: [ { priority: 250, handler(e, ctx) { return false; } } ],

    // App lifecycle hooks (all optional)
    onReady(ctx) {},                       // after project load + first render
    onDelete(deletedIdSet, ctx) {},        // may add ids (e.g. cascade deletes)
    onObjectsMoved(movedIdSet, ctx) {},    // during drags — keep it FAST
    async onPasteEmpty(ctx) { return false; }, // Ctrl+V with no object clipboard
                                           // (e.g. paste a bitmap); true = handled
  };
}
```

Menu item shape (used in `menu`, `canvasMenu` items, submenus, `ctx.openMenu`):
`{ label, icon?, danger?, disabled?, checked?, action(ctx, e) }` or
`{ label, icon?, submenu: [items] }` or `{ divider: true }` or
`{ html: '<div>…</div>', onClick(e, ctx) }` — a custom row (e.g. a color
swatch row); your CSS styles it, `onClick` delegates via `e.target`.
`checked` renders the ✓ state the original app used — it may be a boolean
OR a function `(ctx) => bool`, evaluated when the menu opens (flowchart's
"Flip Flowchart Colors" uses the function form against persisted state);
`action` receives the click event so you can anchor popups
(`e.target.getBoundingClientRect()`).
UI FIDELITY RULE: when porting or remixing anything from the original
Sketchbook app, the menu hierarchy, icons, labels, and order must match it
exactly — the architecture is new, the UI is not.


## The ctx API (complete — if it's not here, you don't have it)

State
- `ctx.objects` — the live objects array (the single source of truth)
- `ctx.selectedIds` — Set of selected ids
- `ctx.project` — current project name
- `ctx.getZoom()` — current zoom factor
- `ctx.getActiveTool()` — active modal tool id, or null (pointer)
- `ctx.contextWorld` — world coords of the last right-click (for menu actions)
- `ctx.state.get(key)` / `ctx.state.set(key, value)` — small persisted
  per-tool flags (saved with the project). Namespace keys with your tool
  id, e.g. `'flowchart.flipped'`. NEVER rename an existing key (the
  baseline flowchart tool ships `'flowchartFlipped'`) — saved projects
  carry the old key and would silently lose the setting.

Object ops
- `ctx.createObject(props)` — normalizes, assigns id + top zIndex, pushes,
  returns the object. You still call pushUndo (before) and
  renderObjects/markDirty (after) yourself.
- `ctx.findObject(id)` · `ctx.selectObject(id, additive?)` ·
  `ctx.clearSelection()` · `ctx.deleteSelected()`

Discipline
- `ctx.pushUndo()` — BEFORE any mutation
- `ctx.renderObjects()` — after structural changes
- `ctx.markDirty()` — after any change (triggers debounced save)
- `ctx.updateSelectionVisuals()` — after changing selection manually

Coordinates
- `ctx.screenToWorld(clientX, clientY)` → `{x, y}`
- `ctx.viewportCenter()` → `{x, y}` (world coords of the visible center)

Rendering services
- `ctx.exportObject(c2d, obj, {x, y, scaleX, scaleY})` — draw any object
  onto a 2d canvas via its type's `exportDraw` (returns false if the type
  has none). This is how samplers and artboard exporters see other
  tools' objects without knowing them.

UI
- `ctx.showToast(msg)` — never use alert()
- `ctx.setTool(idOrNull)` — switch modal tool (null = pointer)
- `ctx.openMenu(items, x, y)` / `ctx.closeMenus()` — popup menus anywhere
- `ctx.showBar(element)` / `ctx.hideBar()` — bottom-center bar slot
- `ctx.worldEl` / `ctx.viewportEl` — mount points (only for tool overlays)

IO (all file access goes through these)
ASSET PATHS ARE RELATIVE to the project folder (`'assets/x.jpg'`) so
projects can be renamed, moved and shared. Every io call below hands you
relative paths and accepts them back — store them verbatim on your
objects, resolve for display ONLY via `ctx.io.assetUrl`. (Legacy absolute
paths in old saves still resolve and are migrated on load.)

- `ctx.io.importImages({hiRes})` → `[{assetPath, width, height}]` (file picker)
- `ctx.io.dropImage(filePath)` / `ctx.io.pasteImage()` → `{assetPath, width, height}`
- `ctx.io.removeWhiteBg(assetPath)` → `{assetPath, ...}`
- `ctx.io.importExternalAsset(srcPath, fromProject?)` → `{path}` — localize
  a foreign asset; pass `ctx.pasteSourceProject` as `fromProject` inside
  `onPaste` so relative paths resolve against the clipboard's project
- `ctx.io.getFilePath(file)` → real filesystem path of a dropped File object
- `ctx.io.exportJpeg(filename, dataUrl)` — save dialog
- `ctx.io.pickFolder(title)` → path — then `ctx.io.saveJpegToFolder(folder, filename, dataUrl)`
- `ctx.io.assetUrl(assetPath)` → `file://` URL for `<img src>`
- `ctx.io.publishDeck(payload)` — builds the shareable deck folder (used by
  the artboards tool's "Publish Deck…"; see its publishDeck() for the shape)
- `ctx.pasteSourceProject` — non-null only while a paste is running: the
  project the clipboard came from


## Walkthrough: build a new tool

1. Copy `_template.js` → `confetti.js`.
2. Set `manifest.id = 'confetti'`, your name in `authors`.
3. Fill in the sections you need; delete the ones you don't.
4. Relaunch the app (or reopen the project). Your tool appears on the
   toolbar/menus automatically. If it doesn't, check the console — a toast
   lists tools that failed to load and why.

## Walkthrough: remix an existing tool

1. Copy e.g. `draw.js` → `draw.neon.js`.
2. `manifest.id = 'draw.neon'`, `basedOn = 'draw'`,
   `authors: ['Forma Rosa Creative', 'you']` (append, don't replace).
3. Change what you want (colors, defaults, rendering, new menu items).
4. If your remix defines object types, RENAME them (`drawing` → `drawing-neon`)
   — the first tool to register a type name wins; duplicates are ignored.
5. Relaunch. Your remix nests under the original's menu entry.

## Verifying your work

- Launch: `npm start` (from the app folder), open any project.
- Your button/menu/shortcut should simply be there.
- Test the discipline: do your action, Ctrl+Z must cleanly undo it,
  reload the project and your objects must come back.
- Break glass: delete your file — the app must boot fine without it, and
  your objects (if any were saved) render as labeled placeholders, not crashes.
