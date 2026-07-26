# Blank-Slate.app

A desktop canvas app for moodboards and pitch decks where **every tool is a
single file you can read, edit, remix, or write from scratch** — by hand, or
by pointing an AI agent at the `_tools/` folder.

## Download (just want to use it?)

Grab the latest `Blank-Slate-<version>-win.zip` from
**[Releases](https://github.com/blank-slate-app/blank-slate/releases/latest)**,
unzip it anywhere (e.g. `Documents\Blank-Slate`), and run `Blank-Slate.exe`.
Windows SmartScreen may warn because the app isn't code-signed yet — click
**More info → Run anyway**. On first run the app creates `_projects/`,
`_tools/`, `_baseline/` and `_decks/` next to the exe: everything is plain,
editable files. Community decks and tools: the shared library lives at
[blank-slate-app/community](https://github.com/blank-slate-app/community)
and appears live in the app's Decks/Tools panels.

## Run it from source (developers)

```
npm install    # first time only — run on THIS machine (native deps: electron, sharp)
npm start
```

## The idea

- `js/engine.js` is the kernel: canvas, selection, undo, save, pan/zoom,
  and the loader that turns tool files into toolbar buttons, menus, and
  shortcuts automatically.
- `_tools/*.js` are the tools. One file each, fully self-contained. Edit one,
  relaunch, see it. Break one, the app still boots and tells you why.
  Start with `_tools/AGENTS.md` (the contract) and `_tools/_template.js`
  (copy-me skeleton).
- `_baseline/` holds pristine copies of the shipped tools. Deleted baseline
  tools auto-revive at startup; edited ones are yours until you revert.
- Projects are folders in `_projects/` (`project.json` + `assets/`), same
  format as the original CanvasApp. (The `_` folders are yours; they sort
  to the top. `js/`, `html/`, `bat/` are the app's code.)

Docs: `ARCHITECTURE.md` (whole-app map: kernel, IPC, invariants) ·
`_tools/AGENTS.md` (tool-author contract) · `COMMUNITY-SETUP.md` (the
shared GitHub catalog the Decks/Tools panels read from).
Product vision + design record:
`../_TECH Sketchbook/CanvasApp/REBUILD-PLAN.md`.

## Scripts (in `bat/` — all safe to run by double-click)

- `bat\launch.bat` — run the app in dev (npm install on first run, then Electron).
- `bat\build.bat` — package the distributable: `dist/Blank-Slate-<version>-win.zip`.
  Users unzip anywhere and run `Blank-Slate.exe`; no Node needed.
- `bat\push.bat` — commit + patch-version-bump + push the APP SOURCE to
  https://github.com/blank-slate-app/blank-slate.
- `bat\push-community.bat` — stage the sibling `_TECH Blank Slate Community`
  folder from your local `_decks/` library (via `js/publish-community.js`)
  and push the COMMUNITY CATALOG to
  https://github.com/blank-slate-app/community. The in-app Decks/Tools
  panels update within a minute.
