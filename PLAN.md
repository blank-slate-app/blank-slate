# Blank-Slate.app — Greenfield Build Plan

Clean rebuild of the CanvasApp desktop sketchbook around a kernel + plugin
architecture where **every tool is one self-contained, remixable file** in
`tools/`. The original app (`../_TECH Sketchbook/CanvasApp/`) stays untouched
and working; features are ported here one tool at a time.

Full product vision, non-negotiables, and the MySpace remix model:
see `../_TECH Sketchbook/CanvasApp/REBUILD-PLAN.md` (the discussion record).
The authoring contract lives in `tools/AGENTS.md` — that file and
`tools/_template.js` are what user-pointed agents read.

## Status

- [x] **S0 — Scaffold** (this commit): repo, chrome ported (main/preload/
      landing), FRC shell (canvas.html), kernel v0 (core/engine.js), tools
      contract (AGENTS.md + _template.js), baseline revive plumbing.
- [ ] **S1 — Kernel proof**: launch app, create project, verify pan/zoom/
      save/undo and the _template Block tool end to end (add, move, resize,
      snap, recolor, delete, undo, reload, placeholder when file removed).
- [ ] **S2 — Port the 8 baseline tools** from the old canvas.html, one commit
      each, easiest → hardest: `draw` → `shapes` → `eyedropper` → `markup` →
      `text` (incl. shared font picker service decision) → `flowchart` →
      `images` (crop system) → `artboards` (corner fields, renumber, export).
      Each port: live copy in `tools/`, pristine copy in `baseline/`,
      `authors: ['santi']`.
- [ ] **S3 — Export shell**: artboards tool needs per-type export renderers;
      add `exportDraw(c2d, obj, transform, ctx)` to the type contract and an
      export orchestration ctx service when `artboards` is ported.
- [ ] **S4 — Ecosystem substrate**: object tool-stamps, project.json `tools`
      dependency manifest, publish (bundle tool files + rendered previews
      into the project folder), install-on-open prompts, Fork action with
      append-only ledger, family variant submenus, minimal Tools dialog.
- [ ] **S5 — Old-project import**: open projects from the original app
      (same object model; normalizeObject migrations port with each tool).

## Porting rules

- The old app is the reference implementation — port logic 1:1 first,
  improve second. Its ARCHITECTURE.md documents every subsystem.
- The ctx API is append-only from S1 onward. Additions require updating
  BOTH `tools/AGENTS.md` and `_template.js` in the same commit.
- No object-type knowledge in the kernel, ever.
- Every commit must launch: `npm start`, create project, smoke-check.
- Old projects open at every stage; unknown types render as placeholders.

## Known deferrals

- Copy-paste asset localization for images: `onPaste` hook exists; the
  images tool implements it when ported.
- Community toolkit + online deck dashboard: after S4, separate project.
- Ledger signing: manifest shape allows it later; convention for now.
