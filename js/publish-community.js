// Stage the community package from the local _decks/ library.
// Run via bat\push-community.bat (or, from the app root: node js/publish-community.js).
//
// The community package is its OWN project folder — the sibling
// "_TECH Blank Slate Community" — which is the local working copy of
// github.com/blank-slate-app/community (README, CONTRIBUTING, AGENTS.md
// live there and are curated by hand; this script never touches them).
//
// - Copies every PUBLISHED deck folder (has manifest.json) from _decks/
//   into <community>/decks/<name>/
// - Regenerates <community>/index.json from what is actually on disk
//   (file lists included — the app downloads files individually over
//   raw.githubusercontent.com)
// - Preserves any existing downloads counts in index.json
// - Lists any .js files in <community>/community-tools/ as tools
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // this file lives in js/
const DECKS_DIR = path.join(ROOT, '_decks');
const REPO_DIR = path.join(ROOT, '..', '_TECH Blank Slate Community');
const REPO_DECKS = path.join(REPO_DIR, 'decks');
const REPO_TOOLS = path.join(REPO_DIR, 'community-tools');

fs.mkdirSync(REPO_DECKS, { recursive: true });
fs.mkdirSync(REPO_TOOLS, { recursive: true });

// Previous index (to keep hand-maintained download counts)
let prev = { decks: [], tools: [] };
try { prev = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'index.json'), 'utf-8')); } catch (_) {}
const prevDeckDl = Object.fromEntries((prev.decks || []).map(d => [d.dir, d.downloads || 0]));
const prevToolDl = Object.fromEntries((prev.tools || []).map(t => [t.file, t.downloads || 0]));

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function listFiles(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(p, rel));
    else out.push(rel);
  }
  return out.sort();
}

// 1. Copy published deck folders across
const decks = [];
if (fs.existsSync(DECKS_DIR)) {
  for (const e of fs.readdirSync(DECKS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const src = path.join(DECKS_DIR, e.name);
    if (!fs.existsSync(path.join(src, 'manifest.json'))) continue;
    copyDir(src, path.join(REPO_DECKS, e.name));
    console.log(`staged deck: ${e.name}`);
  }
}

// 2. Build index entries from the STAGED folders (so repo state = index)
for (const e of fs.readdirSync(REPO_DECKS, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const dir = path.join(REPO_DECKS, e.name);
  let man = {};
  try { man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')); } catch (_) {}
  decks.push({
    dir: e.name,
    title: man.title || e.name,
    author: man.author || 'unknown',
    pages: Number(man.pages) || null,
    images: Number(man.images) || null,
    toolsCount: Array.isArray(man.tools) ? man.tools.length : 0,
    downloads: prevDeckDl[e.name] || 0,
    files: listFiles(dir, ''),
  });
}

// 3. Community tools
const tools = [];
for (const f of fs.readdirSync(REPO_TOOLS)) {
  if (!f.endsWith('.js') || f.startsWith('_')) continue;
  const file = `community-tools/${f}`;
  let name = f.replace(/\.js$/, ''), author = 'unknown', description = '';
  try {
    const src = fs.readFileSync(path.join(REPO_TOOLS, f), 'utf-8');
    const mName = /name:\s*['"`]([^'"`]+)['"`]/.exec(src);
    const mAuth = /authors:\s*\[\s*['"`]([^'"`]+)['"`]/.exec(src);
    const mDesc = /description:\s*['"`]([^'"`]+)['"`]/.exec(src);
    if (mName) name = mName[1];
    if (mAuth) author = mAuth[1];
    if (mDesc) description = mDesc[1];
  } catch (_) {}
  tools.push({ file, name, author, description, downloads: prevToolDl[file] || 0 });
}

fs.writeFileSync(path.join(REPO_DIR, 'index.json'), JSON.stringify({ decks, tools }, null, 2));

console.log(`index.json: ${decks.length} deck(s), ${tools.length} tool(s)`);
