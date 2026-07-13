# Blank-Slate.app

A desktop canvas app for moodboards and pitch decks where **every tool is a
single file you can read, edit, remix, or write from scratch** — by hand, or
by pointing an AI agent at the `tools/` folder.

## Run it

```
npm install    # first time only — run on THIS machine (native deps: electron, sharp)
npm start
```

## The idea

- `core/engine.js` is the kernel: canvas, selection, undo, save, pan/zoom,
  and the loader that turns tool files into toolbar buttons, menus, and
  shortcuts automatically.
- `tools/*.js` are the tools. One file each, fully self-contained. Edit one,
  relaunch, see it. Break one, the app still boots and tells you why.
  Start with `tools/AGENTS.md` (the contract) and `tools/_template.js`
  (copy-me skeleton).
- `baseline/` holds pristine copies of the shipped tools. Deleted baseline
  tools auto-revive at startup; edited ones are yours until you revert.
- Projects are folders in `projects/` (`project.json` + `assets/`), same
  format as the original CanvasApp.

Rebuild roadmap: `PLAN.md`. Product vision + design record:
`../_TECH Sketchbook/CanvasApp/REBUILD-PLAN.md`.

## Git & GitHub (once)

Version history from the build sessions lives in `blank-slate.bundle`
(a portable git repository file — refreshed after every working-session
commit). To go native on this machine, from this folder:

```
git clone blank-slate.bundle .tmp-clone
move .tmp-clone\.git .git        (mac/linux: mv .tmp-clone/.git .git)
rmdir /s /q .tmp-clone           (mac/linux: rm -rf .tmp-clone)
git checkout main -- .           (no-op sanity check; files already match)
```

Or skip the history and start fresh (recommended — keeps personal email
out of public history): `git init -b main && git add -A && git commit -m
"S0: scaffold"`. Then:

```
git remote add origin https://github.com/blank-slate-app/blank-slate.git
git push -u origin main
```

Home: https://github.com/blank-slate-app/blank-slate
