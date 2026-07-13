# Blank-Slate Tools — the authoring contract

This folder is the entire plugin system. **One file = one tool.** The app
scans `tools/*.js` at startup, imports each file in isolation, and generates
its toolbar button, menu entries, and keyboard shortcut automatically. There
is no build step, no imports between files, no registration anywhere else.

You are probably an AI agent asked to build or remix a tool. Everything you
need is in this file plus `_template.js`. Do not read or modify
`core/engine.js` — tools only ever talk to the app through the `ctx` API
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
   copy, use Revert to Baseline in the app, or copy from `../baseline/`.
5. **Remixing:** COPY the file → new filename → change `manifest.id` →
   set `manifest.basedOn` to the original id → **append** your name to
   `manifest.authors` (never remove existing names — that ledger is the
   whole point). Your remix appears in the original tool's submenu.
6. **New tool:** copy `_template.js` → new filename → unique `manifest.id`,
   no `basedOn`. Your tool gets its own toolbar button / menu entry.
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
        menu: [ /* right-click items when a mything is selected */ ],
        proportionalResize: false,           // true = corner resize keeps aspect
        onDoubleClick(obj, e, ctx) {},       // optional
        onDuplicate(clone, ctx) {},          // optional: fix fields on alt-drag copies
        async onPaste(obj, ctx) {},          // optional: e.g. localize assets on cross-project paste
      },
    },

    // A modal tool (click button / press shortcut, then interact on canvas)
    tool: {
      icon: '<svg viewBox="0 0 24 24">...</svg>',   // 24-grid outline style, stroke currentColor
      title: 'My Tool (X)',
      order: 40,                    // toolbar position among tools
      shortcut: 'x',                // single lowercase letter, no modifiers
      cursor: 'crosshair',          // viewport cursor while active
      onActivate(ctx) {},           // e.g. ctx.showBar(myBarElement)
      onDeactivate(ctx) {},
      onPointerDown(e, ctx) {       // left-clicks while your tool is active
        return true;                // true = you consumed the event
      },
    },

    // Non-modal toolbar buttons (immediate actions, e.g. "Add Image")
    toolbar: [
      { icon: '<svg.../>', title: 'Add Thing', order: 10, action(ctx) {} },
    ],

    // Right-click-on-empty-canvas menu items.
    // group: items with the same group cluster together (divider between groups).
    // Use ctx.contextWorld for "create it where I clicked".
    canvasMenu: [
      { label: 'Add Thing', group: 'add', order: 1, action(ctx) {} },
      { label: 'Things', group: 'add', order: 2, submenu: [ /* items */ ] },
    ],

    // Extra keyboard shortcuts (beyond the modal tool's own)
    shortcuts: [ { key: 'j', action(ctx) {} } ],

    // App lifecycle hooks (all optional)
    onReady(ctx) {},                       // after project load + first render
    onDelete(deletedIdSet, ctx) {},        // may add ids (e.g. cascade deletes)
    onObjectsMoved(movedIdSet, ctx) {},    // during drags — keep it FAST
  };
}
```

Menu item shape (used in `menu`, `canvasMenu`, submenus, and `ctx.openMenu`):
`{ label, icon?, danger?, disabled?, action(ctx) }` or
`{ label, submenu: [items] }` or `{ divider: true }`.


## The ctx API (complete — if it's not here, you don't have it)

State
- `ctx.objects` — the live objects array (the single source of truth)
- `ctx.selectedIds` — Set of selected ids
- `ctx.project` — current project name
- `ctx.getZoom()` — current zoom factor
- `ctx.contextWorld` — world coords of the last right-click (for menu actions)

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

UI
- `ctx.showToast(msg)` — never use alert()
- `ctx.setTool(idOrNull)` — switch modal tool (null = pointer)
- `ctx.openMenu(items, x, y)` / `ctx.closeMenus()` — popup menus anywhere
- `ctx.showBar(element)` / `ctx.hideBar()` — bottom-center bar slot
- `ctx.worldEl` / `ctx.viewportEl` — mount points (only for tool overlays)

IO (all file access goes through these)
- `ctx.io.importImages({hiRes})` → `[{assetPath, width, height}]` (file picker)
- `ctx.io.dropImage(filePath)` / `ctx.io.pasteImage()` → `{assetPath, width, height}`
- `ctx.io.removeWhiteBg(assetPath)` → `{assetPath, ...}`
- `ctx.io.importExternalAsset(srcPath)` → `{path}` (localize a foreign asset)
- `ctx.io.exportJpeg(filename, dataUrl)` — save dialog
- `ctx.io.pickFolder(title)` → path — then `ctx.io.saveJpegToFolder(folder, filename, dataUrl)`
- `ctx.io.assetUrl(assetPath)` → `file://` URL for `<img src>`


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
   `authors: ['santi', 'you']` (append, don't replace).
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
