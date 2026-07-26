const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// USER FOLDERS live NEXT TO THE EXE when packaged (portable zip build) —
// _tools/, _baseline/, _projects/, _decks/ stay visible, editable files a
// user (or their agent) can open directly. That IS the product. The `_`
// prefix sorts them to the top of the folder. In dev (npm start) they
// live at the app root — one level up from js/, where this file lives.
const BASE_DIR = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
const PROJECTS_DIR = path.join(BASE_DIR, '_projects');
const TOOLS_DIR = path.join(BASE_DIR, '_tools');
const BASELINE_DIR = path.join(BASE_DIR, '_baseline');
const DECKS_DIR = path.join(BASE_DIR, '_decks'); // published deck folders
const CACHE_DIR = path.join(BASE_DIR, 'cache');
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // 2.5MB
const MAX_HIRES_BYTES = 5 * 1024 * 1024;   // 5MB for hi-res imports

// First run of a packaged build: seed _tools/ and _baseline/ next to the
// exe from the copies shipped inside resources/app.
function bootstrapPackagedFolders() {
  if (!app.isPackaged) return;
  const copyDir = (src, dest) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dest, e.name);
      if (e.isDirectory()) copyDir(s, d);
      else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
    }
  };
  const shipped = path.join(process.resourcesPath, 'app');
  if (!fs.existsSync(BASELINE_DIR)) copyDir(path.join(shipped, '_baseline'), BASELINE_DIR);
  if (!fs.existsSync(TOOLS_DIR)) copyDir(path.join(shipped, '_tools'), TOOLS_DIR);
}
bootstrapPackagedFolders();

// Ensure projects + decks directories exist
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
if (!fs.existsSync(DECKS_DIR)) fs.mkdirSync(DECKS_DIR, { recursive: true });

let mainWindow;

// ── Tools folder (the plugin system) ──
// tools/ is the single flat folder users (and their agents) author in.
// baseline/ holds pristine copies of the shipped tools. A MISSING baseline
// tool is auto-revived at startup (baselines can't be deleted); an EDITED
// baseline file is respected as-is (tinkering is the point). Explicit
// revive with force restores a pristine copy on demand.
function reviveMissingBaselines() {
  if (!fs.existsSync(BASELINE_DIR)) return [];
  if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const revived = [];
  for (const f of fs.readdirSync(BASELINE_DIR)) {
    if (!f.endsWith('.js')) continue;
    const dest = path.join(TOOLS_DIR, f);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(BASELINE_DIR, f), dest);
      revived.push(f);
    }
  }
  return revived;
}

ipcMain.handle('list-tools', () => {
  if (!fs.existsSync(TOOLS_DIR)) return [];
  return fs.readdirSync(TOOLS_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('_'))
    .sort();
});

// Absolute path to the LIVE tools folder. The kernel imports tool modules
// from here (as file:// URLs) rather than via a relative '../tools/' —
// which, packaged, would silently resolve to the shipped copies inside
// resources/app instead of the user-editable files next to the exe.
ipcMain.handle('get-tools-dir', () => TOOLS_DIR);

// name = a baseline filename to force-restore, or null to force-restore ALL
// baseline tools. Returns { revived: [...] }. User files are never touched.
ipcMain.handle('revive-baseline', (_, name) => {
  if (!fs.existsSync(BASELINE_DIR)) return { revived: [] };
  if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const targets = name
    ? [name].filter(f => fs.existsSync(path.join(BASELINE_DIR, f)))
    : fs.readdirSync(BASELINE_DIR).filter(f => f.endsWith('.js'));
  const revived = [];
  for (const f of targets) {
    fs.copyFileSync(path.join(BASELINE_DIR, f), path.join(TOOLS_DIR, f));
    revived.push(f);
  }
  return { revived };
});

// Parse --project="Name" from the command line so .bat shortcuts can
// boot directly into a specific project instead of the landing page.
function getProjectFromArgs() {
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (arg.startsWith('--project=')) {
      return arg.slice('--project='.length).replace(/^["']|["']$/g, '');
    }
    if (arg === '--project') {
      const next = args[args.indexOf(arg) + 1];
      if (next) return next.replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111111',
    icon: path.join(BASE_DIR, 'icon.png'), // optional; ships later
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // both live in js/
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true, // Chromium's built-in PDF viewer (Decks panel covers + reader)
    },
    frame: true,
    titleBarStyle: 'default',
  });

  mainWindow.setMenuBarVisibility(false);

  // If launched with --project="Name" and that project exists, jump
  // straight into the canvas; otherwise show the landing page.
  // (loadFile paths resolve from the app root, where package.json lives.)
  const projectArg = getProjectFromArgs();
  if (projectArg && fs.existsSync(path.join(PROJECTS_DIR, projectArg, 'project.json'))) {
    mainWindow.loadFile('html/canvas.html', { query: { project: projectArg } });
  } else {
    mainWindow.loadFile('html/landing.html');
  }
}

app.whenReady().then(() => {
  // Replace Electron's DEFAULT menu: its hidden Edit-role accelerators
  // (Ctrl+V etc.) can intercept shortcuts before the canvas sees them,
  // and View→Reload (Ctrl+R) could drop unsaved work. Keep only DevTools.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Dev', submenu: [{ role: 'toggleDevTools' }] },
  ]));
  reviveMissingBaselines();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ── Sharing foundation ──────────────────────────────────────────────────

// The renderer resolves RELATIVE asset paths ('assets/x.jpg') against this
ipcMain.handle('get-project-dir', (_, name) => path.join(PROJECTS_DIR, name));

// Which tool files differ from the shipped baseline (fork/new/edited =
// "unique"). Feeds the project.json tool ledger and the publish routine.
function toolStatusMap() {
  const status = {};
  if (!fs.existsSync(TOOLS_DIR)) return status;
  for (const f of fs.readdirSync(TOOLS_DIR)) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    const basePath = path.join(BASELINE_DIR, f);
    let unique = true;
    try {
      if (fs.existsSync(basePath)) {
        unique = !fs.readFileSync(path.join(TOOLS_DIR, f)).equals(fs.readFileSync(basePath));
      }
    } catch (_) { /* treat unreadable as unique */ }
    status[f] = unique;
  }
  return status;
}
ipcMain.handle('get-tool-status', () => toolStatusMap());

// Orphan sweep (run on Home, after the final save — never during a session,
// where undo could resurrect an object that references a swept file).
// keep = array of asset FILENAMES still referenced by the project.
ipcMain.handle('sweep-assets', (_, name, keep) => {
  try {
    const assetsDir = path.join(PROJECTS_DIR, name, 'assets');
    if (!fs.existsSync(assetsDir)) return { removed: 0 };
    const keepSet = new Set((keep || []).map(k => String(k).toLowerCase()));
    let removed = 0;
    for (const f of fs.readdirSync(assetsDir)) {
      const p = path.join(assetsDir, f);
      if (!fs.statSync(p).isFile()) continue;
      if (keepSet.has(f.toLowerCase())) continue;
      try { fs.unlinkSync(p); removed++; } catch (_) {}
    }
    return { removed };
  } catch (err) { return { error: err.message }; }
});

// Minimal one-JPEG-per-page PDF writer (no dependencies): enough for the
// deck preview PDF. pages = [{ buf, w, h }].
function jpegPagesToPdf(pages) {
  const chunks = [];
  let pos = 0;
  const push = (s) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; };
  const offsets = [0];
  const beginObj = (n) => { offsets[n] = pos; push(`${n} 0 obj\n`); };
  push('%PDF-1.4\n');
  const N = pages.length;
  // Object numbering: 1 catalog · 2 pages tree · then per page i(0-based):
  // 3+i*3 image, 4+i*3 content, 5+i*3 page
  beginObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const kids = pages.map((_, i) => `${5 + i * 3} 0 R`).join(' ');
  beginObj(2); push(`<< /Type /Pages /Kids [${kids}] /Count ${N} >>\nendobj\n`);
  pages.forEach((p, i) => {
    const io = 3 + i * 3, co = 4 + i * 3, po = 5 + i * 3;
    beginObj(io);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.buf.length} >>\nstream\n`);
    push(p.buf);
    push('\nendstream\nendobj\n');
    const content = `q ${p.w} 0 0 ${p.h} 0 0 cm /Im${i} Do Q`;
    beginObj(co); push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    beginObj(po); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /XObject << /Im${i} ${io} 0 R >> >> /Contents ${co} 0 R >>\nendobj\n`);
  });
  const xrefPos = pos;
  const total = 2 + N * 3 + 1;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);
  return Buffer.concat(chunks);
}

// PUBLISH: build the tidy shareable deck folder —
//   <Title - Author>/  manifest.json · project.json · <Title - Author>.pdf
//                      images/ (referenced assets, re-encoded ≤1MB)
//                      tools/  (only files that differ from baseline)
// payload = { title, author, objects (clean, artboards-only, relative
// paths), canvasState, pages: [{ name, dataUrl (JPEG) }] }
ipcMain.handle('publish-deck', async (_, projectName, payload) => {
  try {
    const title = String(payload.title || projectName).replace(/[<>:"/\\|?*]/g, '_').trim();
    const author = String(payload.author || 'unknown').replace(/[<>:"/\\|?*]/g, '_').trim();
    // Publish straight into the app's decks/ library — one click, appears
    // in the Decks panel immediately. That folder is also exactly what
    // gets submitted to the community repo for approval.
    const deckName = `${title} - ${author}`;
    let deckDirName = deckName, dn = 2;
    while (fs.existsSync(path.join(DECKS_DIR, deckDirName))) deckDirName = `${deckName} (${dn++})`;
    const deckDir = path.join(DECKS_DIR, deckDirName);
    fs.mkdirSync(path.join(deckDir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(deckDir, 'tools'), { recursive: true });

    // 1. Referenced images, re-encoded to ≤1MB (PNG alpha preserved)
    const MAX_PUBLISH = 1024 * 1024;
    const projAssets = path.join(PROJECTS_DIR, projectName, 'assets');
    const referenced = new Set();
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string' && /^assets[\\/]/i.test(v)) referenced.add(path.basename(v));
          else walk(v);
        }
      }
    };
    walk(payload.objects);
    for (const f of referenced) {
      const src = path.join(projAssets, f);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(deckDir, 'images', f);
      try {
        let buf = fs.readFileSync(src);
        if (buf.length > MAX_PUBLISH) {
          const meta = await sharp(src).metadata();
          const isPng = /\.png$/i.test(f) || meta.hasAlpha;
          let scale = 1, quality = 80;
          let out = buf;
          for (let tries = 0; tries < 12 && out.length > MAX_PUBLISH; tries++) {
            const w = Math.max(64, Math.round(meta.width * scale));
            out = isPng
              ? await sharp(src).resize(w).png({ compressionLevel: 9 }).toBuffer()
              : await sharp(src).resize(w).jpeg({ quality }).toBuffer();
            if (quality > 55 && !isPng) quality -= 10; else scale -= 0.12;
          }
          buf = out;
        }
        fs.writeFileSync(dest, buf);
      } catch (_) { try { fs.copyFileSync(src, dest); } catch (_) {} }
    }

    // 2. Unique tools only
    const status = toolStatusMap();
    const bundledTools = [];
    for (const f of Object.keys(status)) {
      if (!status[f]) continue;
      try {
        fs.copyFileSync(path.join(TOOLS_DIR, f), path.join(deckDir, 'tools', f));
        bundledTools.push(f);
      } catch (_) {}
    }

    // 3. Clean project file (paths already relative)
    fs.writeFileSync(path.join(deckDir, 'project.json'), JSON.stringify({
      name: title,
      created: new Date().toISOString(),
      canvasState: payload.canvasState || { panX: 0, panY: 0, zoom: 1, toolState: {} },
      tools: payload.tools || [],
      objects: payload.objects || [],
    }, null, 2));

    // 4. Preview PDF (≤5MB target: screen-scale JPEG pages)
    const pages = (payload.pages || []).map(p => {
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(p.dataUrl || '');
      return m ? { buf: Buffer.from(m[1], 'base64'), w: p.w, h: p.h } : null;
    }).filter(Boolean);
    if (pages.length) fs.writeFileSync(path.join(deckDir, `${deckName}.pdf`), jpegPagesToPdf(pages));

    // 5. Manifest (what the catalog card needs without opening anything)
    fs.writeFileSync(path.join(deckDir, 'manifest.json'), JSON.stringify({
      format: 'blank-slate-deck/1',
      title, author,
      created: new Date().toISOString(),
      appVersion: app.getVersion(),
      pages: pages.length,
      images: referenced.size,
      tools: bundledTools,
    }, null, 2));

    return { success: true, dir: deckDir, tools: bundledTools.length, images: referenced.size, pages: pages.length };
  } catch (err) { return { error: err.message }; }
});

// IMPORT: install a deck folder as a project. Tool conflict rules:
// identical file → skip · different content → install renamed as
// <id>.imported.js (NEVER overwrite, baselines included) · new → copy.
ipcMain.handle('import-deck', async () => {
  try {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a deck folder to import',
      properties: ['openDirectory'],
    });
    if (pick.canceled || !pick.filePaths.length) return { canceled: true };
    const deckDir = pick.filePaths[0];
    const projJson = path.join(deckDir, 'project.json');
    if (!fs.existsSync(projJson)) return { error: 'Not a deck folder (project.json missing)' };
    const data = JSON.parse(fs.readFileSync(projJson, 'utf-8'));
    let name = String(data.name || path.basename(deckDir)).replace(/[<>:"/\\|?*]/g, '_').trim() || 'Imported Deck';
    let unique = name, n = 2;
    while (fs.existsSync(path.join(PROJECTS_DIR, unique))) unique = `${name} (${n++})`;
    name = unique;
    const projDir = path.join(PROJECTS_DIR, name);
    fs.mkdirSync(path.join(projDir, 'assets'), { recursive: true });
    data.name = name;
    fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(data, null, 2));
    // images/ → assets/ (same filenames: the relative refs keep working)
    const imgDir = path.join(deckDir, 'images');
    if (fs.existsSync(imgDir)) {
      for (const f of fs.readdirSync(imgDir)) {
        try { fs.copyFileSync(path.join(imgDir, f), path.join(projDir, 'assets', f)); } catch (_) {}
      }
    }
    // tools/ with conflict rules
    const installed = [], skipped = [], renamed = [];
    const deckTools = path.join(deckDir, 'tools');
    if (fs.existsSync(deckTools)) {
      for (const f of fs.readdirSync(deckTools)) {
        if (!f.endsWith('.js') || f.startsWith('_')) continue;
        const src = path.join(deckTools, f);
        const dest = path.join(TOOLS_DIR, f);
        try {
          if (!fs.existsSync(dest)) { fs.copyFileSync(src, dest); installed.push(f); continue; }
          if (fs.readFileSync(src).equals(fs.readFileSync(dest))) { skipped.push(f); continue; }
          const alt = f.replace(/\.js$/, '.imported.js');
          let altPath = path.join(TOOLS_DIR, alt), i = 2;
          while (fs.existsSync(altPath)) altPath = path.join(TOOLS_DIR, f.replace(/\.js$/, `.imported-${i++}.js`));
          fs.copyFileSync(src, altPath);
          renamed.push(path.basename(altPath));
        } catch (_) {}
      }
    }
    return { success: true, name, installed, skipped, renamed };
  } catch (err) { return { error: err.message }; }
});

// ── Community catalog (the BlenderKit model) ────────────────────────────
// Every user's Decks/Tools panels are a LIVE VIEW of one shared GitHub
// repo. The repo holds deck folders + community tool files + an index.json
// describing them (hand-maintained at first, regenerated by an Action on
// merge later). Approval = the pull request into this repo.
const COMMUNITY_REPO = 'blank-slate-app/community'; // <owner>/<repo>
const COMMUNITY_BRANCH = 'main';
const COMMUNITY_RAW = `https://raw.githubusercontent.com/${COMMUNITY_REPO}/${COMMUNITY_BRANCH}/`;

async function fetchCommunity(pathInRepo, asBuffer) {
  const res = await fetch(COMMUNITY_RAW + pathInRepo.split('/').map(encodeURIComponent).join('/'), {
    headers: { 'User-Agent': 'blank-slate-app' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.json();
}

// index.json schema:
// { "decks": [{ dir, title, author, pages, images, downloads, cover, files: [...] }],
//   "tools": [{ file, name, author, description, downloads }] }
// All paths repo-relative; `files` lists every file inside the deck's dir.
ipcMain.handle('fetch-community-catalog', async () => {
  try {
    const idx = await fetchCommunity('index.json', false);
    return {
      decks: Array.isArray(idx.decks) ? idx.decks : [],
      tools: Array.isArray(idx.tools) ? idx.tools : [],
      rawBase: COMMUNITY_RAW,
      repo: COMMUNITY_REPO,
    };
  } catch (err) {
    return { offline: true, error: err.message, repo: COMMUNITY_REPO };
  }
});

// Card previews are the deck's PDF, flip-through and all — fetched ONCE
// per deck into a cache so browsing doesn't re-download on every page
// flip (the ?p= cache-buster would otherwise re-fetch a remote PDF).
ipcMain.handle('get-community-pdf', async (_, entry) => {
  try {
    if (!entry || !entry.dir || !Array.isArray(entry.files)) return { error: 'Bad catalog entry' };
    const pdfName = entry.files.find(f => String(f).toLowerCase().endsWith('.pdf'));
    if (!pdfName) return { error: 'No PDF in this deck' };
    const cacheDir = path.join(CACHE_DIR, 'community-pdfs');
    fs.mkdirSync(cacheDir, { recursive: true });
    const safe = String(entry.dir).replace(/[<>:"|?*\\/]/g, '_') + '.pdf';
    const cached = path.join(cacheDir, safe);
    if (!fs.existsSync(cached)) {
      const buf = await fetchCommunity(`decks/${entry.dir}/${pdfName}`, true);
      fs.writeFileSync(cached, buf);
    }
    const { pathToFileURL } = require('url');
    return { url: pathToFileURL(cached).href, pages: pdfPageCount(cached) };
  } catch (err) { return { error: 'Preview failed: ' + err.message }; }
});

// Download a community deck into the local decks/ cache (then the renderer
// merges it into the open project via the same import-deck-into path).
ipcMain.handle('download-community-deck', async (_, entry) => {
  try {
    if (!entry || !entry.dir || !Array.isArray(entry.files)) return { error: 'Bad catalog entry' };
    const safeDir = String(entry.dir).replace(/[<>:"|?*]/g, '_').replace(/\.\./g, '_');
    const destDir = path.join(DECKS_DIR, safeDir);
    if (!fs.existsSync(path.join(destDir, 'manifest.json'))) {
      fs.mkdirSync(destDir, { recursive: true });
      for (const f of entry.files) {
        const rel = String(f).replace(/\.\./g, '_'); // no path escapes
        const buf = await fetchCommunity(`decks/${entry.dir}/${rel}`, true);
        const out = path.join(destDir, rel.replace(/\//g, path.sep));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, buf);
      }
    }
    return { success: true, dirName: safeDir };
  } catch (err) { return { error: 'Download failed: ' + err.message }; }
});

// Install a single community tool file (same conflict rules as decks:
// identical → skip · different → renamed copy · never overwrite).
ipcMain.handle('install-community-tool', async (_, entry) => {
  try {
    if (!entry || !entry.file) return { error: 'Bad catalog entry' };
    const fname = path.basename(String(entry.file));
    if (!fname.endsWith('.js') || fname.startsWith('_')) return { error: 'Not an installable tool file' };
    const buf = await fetchCommunity(entry.file, true);
    const dest = path.join(TOOLS_DIR, fname);
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest).equals(buf)) return { success: true, file: fname, already: true };
      const alt = fname.replace(/\.js$/, '.community.js');
      let altPath = path.join(TOOLS_DIR, alt), i = 2;
      while (fs.existsSync(altPath)) altPath = path.join(TOOLS_DIR, fname.replace(/\.js$/, `.community-${i++}.js`));
      fs.writeFileSync(altPath, buf);
      return { success: true, file: path.basename(altPath), renamed: true };
    }
    fs.writeFileSync(dest, buf);
    return { success: true, file: fname };
  } catch (err) { return { error: 'Install failed: ' + err.message }; }
});

// ── Decks (side panel gallery) ──
// UI shell for the deck-sharing vision (PLAN S4): the Decks side panel in
// the canvas window lists deck PDFs living in decks/. For now decks arrive
// by dropping "Deck Name — Author.pdf" files into that folder; publishing
// from a project comes later.
// Page count without a PDF library — three cheap heuristics on the raw
// bytes, take the best: the page tree's "/Count N" (max wins: the root
// holds the total), the number of "/Type /Page" object headers, and the
// linearization dict's "/N pages" (first ~1.5KB only — elsewhere /N means
// something else). Fully compressed PDFs can hide all three → null, and
// the panel falls back to a soft cap on the arrows.
function pdfPageCount(filePath) {
  try {
    const raw = fs.readFileSync(filePath).toString('latin1');
    const candidates = [];
    let m;
    const countRe = /\/Count\s+(\d+)/g;
    while ((m = countRe.exec(raw))) candidates.push(parseInt(m[1]));
    const typePage = raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    if (typePage) candidates.push(typePage.length);
    const head = raw.slice(0, 1500);
    const lin = head.match(/\/Linearized[\s\S]{0,200}?\/N\s+(\d+)/);
    if (lin) candidates.push(parseInt(lin[1]));
    const pages = Math.max(0, ...candidates.filter(n => isFinite(n) && n > 0 && n < 10000));
    return pages > 0 ? pages : null;
  } catch (_) { return null; }
}

// Deck list for the panel — PUBLISHED DECK FOLDERS (manifest.json + PDF +
// images/ + tools/ + project.json). Legacy loose PDFs still render as
// display-only cards. Download counts arrive with the GitHub catalog.
ipcMain.handle('get-decks', () => {
  if (!fs.existsSync(DECKS_DIR)) return { dir: DECKS_DIR, decks: [] };
  const { pathToFileURL } = require('url');
  const decks = [];
  for (const entry of fs.readdirSync(DECKS_DIR, { withFileTypes: true })) {
    const full = path.join(DECKS_DIR, entry.name);
    let mtime = 0;
    try { mtime = fs.statSync(full).mtimeMs; } catch (_) {}
    if (entry.isDirectory() && fs.existsSync(path.join(full, 'manifest.json'))) {
      try {
        const man = JSON.parse(fs.readFileSync(path.join(full, 'manifest.json'), 'utf-8'));
        const pdfFile = fs.readdirSync(full).find(f => f.toLowerCase().endsWith('.pdf'));
        const importable = fs.existsSync(path.join(full, 'project.json'));
        decks.push({
          kind: 'published',
          dirName: entry.name,
          name: man.title || entry.name,
          author: man.author || 'unknown',
          url: pdfFile ? pathToFileURL(path.join(full, pdfFile)).href : null,
          pages: Number(man.pages) || null,
          toolsCount: Array.isArray(man.tools) ? man.tools.length : null,
          downloads: null, // real counts come from the online catalog
          importable,
          mtime,
        });
      } catch (_) { /* unreadable manifest: skip */ }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      const base = entry.name.slice(0, -4);
      const m = base.split(/\s+—\s+|\s+-\s+/);
      decks.push({
        kind: 'pdf',
        file: entry.name,
        name: (m[0] || base).trim(),
        author: m.length > 1 ? m.slice(1).join(' ').trim() : 'unknown',
        url: pathToFileURL(full).href,
        pages: pdfPageCount(full),
        toolsCount: null,
        downloads: null,
        importable: false,
        mtime,
      });
    }
  }
  decks.sort((a, b) => b.mtime - a.mtime);
  return { dir: DECKS_DIR, decks };
});

// DOWNLOAD (panel button): merge a published deck INTO the currently open
// project — copy its images into the project's assets (collision-safe,
// byte-identical reuse), install its tools (conflict rules as import-deck),
// and hand the renderer the deck's objects with refs remapped.
ipcMain.handle('import-deck-into', (_, currentProject, deckDirName) => {
  try {
    const deckDir = path.join(DECKS_DIR, deckDirName);
    const projJson = path.join(deckDir, 'project.json');
    if (!fs.existsSync(projJson)) return { error: 'This deck has no project file (display-only)' };
    const data = JSON.parse(fs.readFileSync(projJson, 'utf-8'));
    const assetsDir = path.join(PROJECTS_DIR, currentProject, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    // Copy images with collision safety; build a rename map for the refs
    const renameMap = {};
    const imgDir = path.join(deckDir, 'images');
    if (fs.existsSync(imgDir)) {
      for (const f of fs.readdirSync(imgDir)) {
        const src = path.join(imgDir, f);
        if (!fs.statSync(src).isFile()) continue;
        let destName = f;
        const destPath = () => path.join(assetsDir, destName);
        if (fs.existsSync(destPath())) {
          if (fs.readFileSync(src).equals(fs.readFileSync(destPath()))) { continue; } // identical: reuse
          const ext = path.extname(f), base = path.basename(f, ext);
          let i = 2;
          destName = `${base}_${i}${ext}`;
          while (fs.existsSync(destPath())) destName = `${base}_${++i}${ext}`;
          renameMap[f] = destName;
        }
        fs.copyFileSync(src, destPath());
      }
    }
    // Remap 'assets/<old>' refs whose files were renamed
    const remap = (node) => {
      if (Array.isArray(node)) { node.forEach(remap); return; }
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string' && /^assets[\\/]/i.test(v)) {
            const fname = v.split(/[\\/]/).pop();
            if (renameMap[fname]) node[k] = 'assets/' + renameMap[fname];
          } else remap(v);
        }
      }
    };
    remap(data.objects);

    // Install the deck's tools (identical → skip · different → renamed ·
    // new → copy; baselines and user files never overwritten)
    const installed = [], skipped = [], renamed = [];
    const deckTools = path.join(deckDir, 'tools');
    if (fs.existsSync(deckTools)) {
      for (const f of fs.readdirSync(deckTools)) {
        if (!f.endsWith('.js') || f.startsWith('_')) continue;
        const src = path.join(deckTools, f);
        const dest = path.join(TOOLS_DIR, f);
        try {
          if (!fs.existsSync(dest)) { fs.copyFileSync(src, dest); installed.push(f); continue; }
          if (fs.readFileSync(src).equals(fs.readFileSync(dest))) { skipped.push(f); continue; }
          const alt = f.replace(/\.js$/, '.imported.js');
          let altPath = path.join(TOOLS_DIR, alt), i = 2;
          while (fs.existsSync(altPath)) altPath = path.join(TOOLS_DIR, f.replace(/\.js$/, `.imported-${i++}.js`));
          fs.copyFileSync(src, altPath);
          renamed.push(path.basename(altPath));
        } catch (_) {}
      }
    }
    return { success: true, objects: data.objects || [], installed, skipped, renamed };
  } catch (err) { return { error: err.message }; }
});

// ── Project Management ──

ipcMain.handle('get-projects', () => {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const jsonPath = path.join(PROJECTS_DIR, d.name, 'project.json');
      let modified = null;
      try {
        const stat = fs.statSync(jsonPath);
        modified = stat.mtime.toISOString();
      } catch (_) {}
      return { name: d.name, modified };
    })
    .filter(p => p.modified !== null)
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
});

ipcMain.handle('create-project', (_, name) => {
  const safeName = name.replace(/[<>:"/\\|?*]/g, '_').trim();
  if (!safeName) return { error: 'Invalid project name' };
  const projDir = path.join(PROJECTS_DIR, safeName);
  if (fs.existsSync(projDir)) return { error: 'Project already exists' };

  fs.mkdirSync(projDir, { recursive: true });
  fs.mkdirSync(path.join(projDir, 'assets'), { recursive: true });

  const projectData = {
    name: safeName,
    created: new Date().toISOString(),
    canvasState: { panX: 0, panY: 0, zoom: 1 },
    objects: [],
  };
  fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(projectData, null, 2));
  return { success: true, name: safeName };
});

ipcMain.handle('delete-project', (_, name) => {
  const projDir = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(projDir)) {
    fs.rmSync(projDir, { recursive: true, force: true });
    return { success: true };
  }
  return { error: 'Project not found' };
});

// Rename = rename the folder + update project.json's name + REMAP every
// absolute asset path stored on objects (image content, field logo src —
// they embed the project folder, so they'd all 404 after a bare rename).
// Returns oldDir/newDir so an open canvas can remap its in-memory objects.
ipcMain.handle('rename-project', (_, oldName, newName) => {
  const safeName = String(newName || '').replace(/[<>:"/\\|?*]/g, '_').trim();
  if (!safeName) return { error: 'Invalid project name' };
  const oldDir = path.join(PROJECTS_DIR, oldName);
  const newDir = path.join(PROJECTS_DIR, safeName);
  if (!fs.existsSync(path.join(oldDir, 'project.json'))) return { error: 'Project not found' };
  if (safeName === oldName) return { success: true, name: safeName, oldDir, newDir };
  if (fs.existsSync(newDir)) return { error: 'A project with that name already exists' };
  try {
    fs.renameSync(oldDir, newDir);
  } catch (e) {
    return { error: 'Could not rename: ' + e.message };
  }
  try {
    const jsonPath = path.join(newDir, 'project.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    data.name = safeName;
    const fix = (node) => {
      if (Array.isArray(node)) { node.forEach(fix); return; }
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string' && v.startsWith(oldDir)) node[k] = newDir + v.slice(oldDir.length);
          else fix(v);
        }
      }
    };
    fix(data.objects);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  } catch (e) { /* folder is renamed; path fix is best-effort */ }
  // Self-heal desktop shortcuts: any .bat on the Desktop that launches the
  // old name is rewritten to the new one. Shortcuts saved elsewhere are
  // untouched — re-save those from the home page.
  try {
    const desktop = app.getPath('desktop');
    const oldTag = `--project="${oldName.replace(/"/g, '""')}"`;
    const newTag = `--project="${safeName.replace(/"/g, '""')}"`;
    for (const f of fs.readdirSync(desktop)) {
      if (!f.toLowerCase().endsWith('.bat')) continue;
      const p = path.join(desktop, f);
      let txt;
      try { txt = fs.readFileSync(p, 'utf-8'); } catch (_) { continue; }
      if (!txt.includes(oldTag)) continue;
      txt = txt.split(oldTag).join(newTag);
      txt = txt.split(`title Blank-Slate - ${oldName}`).join(`title Blank-Slate - ${safeName}`);
      try { fs.writeFileSync(p, txt); } catch (_) { /* skip locked files */ }
    }
  } catch (_) { /* best-effort */ }
  return { success: true, name: safeName, oldDir, newDir };
});

ipcMain.handle('load-project', (_, name) => {
  const jsonPath = path.join(PROJECTS_DIR, name, 'project.json');
  if (!fs.existsSync(jsonPath)) return { error: 'Project not found' };
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  return data;
});

ipcMain.handle('save-project', (_, name, data) => {
  const projDir = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(projDir)) return { error: 'Project folder missing' };
  fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(data, null, 2));
  return { success: true };
});

// ── Image Import with Resize ──

ipcMain.handle('import-images', async (_, projectName, options) => {
  const hiRes = !!(options && options.hiRes);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: hiRes ? 'Import Hi-Res Images' : 'Import Images',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  const assetsDir = path.join(PROJECTS_DIR, projectName, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const results = [];
  for (const srcPath of result.filePaths) {
    try {
      const imported = await processImage(srcPath, assetsDir, hiRes);
      if (imported) results.push(imported);
    } catch (err) {
      console.error('Image import error for', srcPath, err);
    }
  }
  return results;
});

async function processImage(srcPath, assetsDir, hiRes = false) {
  const ext = path.extname(srcPath).toLowerCase();
  const baseName = path.basename(srcPath, ext);
  const timestamp = Date.now();
  const destName = `${baseName}_${timestamp}${ext}`;
  const destPath = path.join(assetsDir, destName);

  const stat = fs.statSync(srcPath);

  // Hi-res branch: cap at 5MB, preserve PNG when possible (for transparency)
  if (hiRes && stat.size > MAX_HIRES_BYTES) {
    const metadata = await sharp(srcPath).metadata();
    const w = metadata.width, h = metadata.height;
    const hasAlpha = metadata.hasAlpha || metadata.channels === 4;
    let quality = 95;
    let resizeScale = 1.0;
    let buffer;

    if (hasAlpha) {
      // Preserve transparency: PNG with max compression, resize if still too big
      buffer = await sharp(srcPath).png({ compressionLevel: 9 }).toBuffer();
      while (buffer.length > MAX_HIRES_BYTES && resizeScale > 0.2) {
        resizeScale -= 0.05;
        buffer = await sharp(srcPath)
          .resize(Math.round(w * resizeScale), Math.round(h * resizeScale))
          .png({ compressionLevel: 9 }).toBuffer();
      }
      const finalPath = destPath.replace(ext, '.png');
      fs.writeFileSync(finalPath, buffer);
      const finalMeta = await sharp(buffer).metadata();
      return {
        assetPath: finalPath,
        assetName: destName.replace(ext, '.png'),
        width: finalMeta.width,
        height: finalMeta.height,
      };
    } else {
      // No transparency: JPEG, reduce quality first, then scale
      buffer = await sharp(srcPath).jpeg({ quality }).toBuffer();
      while (buffer.length > MAX_HIRES_BYTES && quality > 60) {
        quality -= 5;
        buffer = await sharp(srcPath).jpeg({ quality }).toBuffer();
      }
      while (buffer.length > MAX_HIRES_BYTES && resizeScale > 0.2) {
        resizeScale -= 0.05;
        buffer = await sharp(srcPath)
          .resize(Math.round(w * resizeScale), Math.round(h * resizeScale))
          .jpeg({ quality }).toBuffer();
      }
      const finalPath = destPath.replace(ext, '.jpg');
      fs.writeFileSync(finalPath, buffer);
      const finalMeta = await sharp(buffer).metadata();
      return {
        assetPath: finalPath,
        assetName: destName.replace(ext, '.jpg'),
        width: finalMeta.width,
        height: finalMeta.height,
      };
    }
  }

  if (!hiRes && stat.size > MAX_IMAGE_BYTES) {
    let quality = 90;
    let resizeScale = 1.0;
    let buffer;
    const metadata = await sharp(srcPath).metadata();
    const w = metadata.width, h = metadata.height;

    buffer = await sharp(srcPath).jpeg({ quality }).toBuffer();

    while (buffer.length > MAX_IMAGE_BYTES && quality > 30) {
      quality -= 10;
      buffer = await sharp(srcPath).jpeg({ quality }).toBuffer();
    }

    while (buffer.length > MAX_IMAGE_BYTES && resizeScale > 0.2) {
      resizeScale -= 0.1;
      buffer = await sharp(srcPath)
        .resize(Math.round(w * resizeScale), Math.round(h * resizeScale))
        .jpeg({ quality }).toBuffer();
    }

    const finalPath = destPath.replace(ext, '.jpg');
    fs.writeFileSync(finalPath, buffer);
    const finalMeta = await sharp(buffer).metadata();
    return {
      assetPath: finalPath,
      assetName: destName.replace(ext, '.jpg'),
      width: finalMeta.width,
      height: finalMeta.height,
    };
  } else {
    fs.copyFileSync(srcPath, destPath);
    const metadata = await sharp(srcPath).metadata();
    return {
      assetPath: destPath,
      assetName: destName,
      width: metadata.width,
      height: metadata.height,
    };
  }
}

// ── Drop Image (process a single file path) ──

ipcMain.handle('drop-image', async (_, projectName, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  if (!validExts.includes(ext)) return null;

  const assetsDir = path.join(PROJECTS_DIR, projectName, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  try {
    return await processImage(filePath, assetsDir);
  } catch (err) {
    console.error('Drop image error:', err);
    return null;
  }
});

// ── Paste Image from native clipboard ──

ipcMain.handle('paste-image', async (_, projectName) => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;

    const buffer = img.toPNG();
    if (!buffer || buffer.length === 0) return null;

    const assetsDir = path.join(PROJECTS_DIR, projectName, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const timestamp = Date.now();
    let destPath = path.join(assetsDir, `paste_${timestamp}.png`);

    if (buffer.length > MAX_IMAGE_BYTES) {
      let quality = 90;
      let resizeScale = 1.0;
      const metadata = await sharp(buffer).metadata();
      const w = metadata.width, h = metadata.height;
      let out = await sharp(buffer).jpeg({ quality }).toBuffer();
      while (out.length > MAX_IMAGE_BYTES && quality > 30) {
        quality -= 10;
        out = await sharp(buffer).jpeg({ quality }).toBuffer();
      }
      while (out.length > MAX_IMAGE_BYTES && resizeScale > 0.2) {
        resizeScale -= 0.1;
        out = await sharp(buffer)
          .resize(Math.round(w * resizeScale), Math.round(h * resizeScale))
          .jpeg({ quality }).toBuffer();
      }
      destPath = path.join(assetsDir, `paste_${timestamp}.jpg`);
      fs.writeFileSync(destPath, out);
      const finalMeta = await sharp(out).metadata();
      return { assetPath: destPath, width: finalMeta.width, height: finalMeta.height };
    } else {
      fs.writeFileSync(destPath, buffer);
      const metadata = await sharp(buffer).metadata();
      return { assetPath: destPath, width: metadata.width, height: metadata.height };
    }
  } catch (err) {
    console.error('Paste image error:', err);
    return null;
  }
});

// ── Remove White Background ──

ipcMain.handle('remove-white-bg', async (_, imagePath) => {
  try {
    const { data, info } = await sharp(imagePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const threshold = 240;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r >= threshold && g >= threshold && b >= threshold) {
        data[i + 3] = 0;
      }
    }

    // Save as PNG alongside the original
    const dir = path.dirname(imagePath);
    const base = path.basename(imagePath, path.extname(imagePath));
    const outPath = path.join(dir, `${base}_nobg.png`);

    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toFile(outPath);

    const metadata = await sharp(outPath).metadata();
    return { assetPath: outPath, width: metadata.width, height: metadata.height };
  } catch (err) {
    console.error('Remove white bg error:', err);
    return { error: err.message };
  }
});

// ── Export Artboard ──

// `filename` is the base name (no extension), e.g. "001_Project-Name_Artboard".
function safeExportName(filename) {
  return String(filename || 'Artboard').replace(/[<>:"/\\|?*]/g, '_');
}

// Print DPI stamped into exported JPEGs. The canvas renders artboards at a fixed
// pixel size; this only sets the density metadata, so a board that would read as
// 18x32in at 300dpi reads as 9x16in at 600dpi (same pixels, no re-compression).
const EXPORT_DPI = 600;

// Set a JPEG's JFIF APP0 density (dots/inch) in place — no pixel re-encode, so
// there's zero quality loss. Edits the APP0 if present, else inserts a minimal one.
function setJpegDpi(buffer, dpi) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return buffer;
  const hasJfifApp0 = buffer[2] === 0xFF && buffer[3] === 0xE0 &&
    buffer[6] === 0x4A && buffer[7] === 0x46 && buffer[8] === 0x49 && buffer[9] === 0x46 && buffer[10] === 0x00;
  if (hasJfifApp0) {
    buffer[13] = 1;                // density units: 1 = dots per inch
    buffer.writeUInt16BE(dpi, 14); // X density
    buffer.writeUInt16BE(dpi, 16); // Y density
    return buffer;
  }
  const app0 = Buffer.from([
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    (dpi >> 8) & 0xFF, dpi & 0xFF, (dpi >> 8) & 0xFF, dpi & 0xFF, 0x00, 0x00,
  ]);
  return Buffer.concat([buffer.subarray(0, 2), app0, buffer.subarray(2)]);
}

ipcMain.handle('export-artboard', async (_, filename, dataUrl) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Artboard',
    defaultPath: `${safeExportName(filename)}.jpg`,
    filters: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    fs.writeFileSync(result.filePath, setJpegDpi(Buffer.from(base64, 'base64'), EXPORT_DPI));
    return { success: true, path: result.filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('export-artboards-all', async (_, items) => {
  if (!items || items.length === 0) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Folder for Artboard Exports',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const folder = result.filePaths[0];

  const written = [];
  try {
    for (const item of items) {
      const base64 = item.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      const filename = `Artboard ${item.label}.jpg`;
      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, setJpegDpi(Buffer.from(base64, 'base64'), EXPORT_DPI));
      written.push(filePath);
    }
    return { success: true, folder, count: written.length };
  } catch (err) {
    return { error: err.message, written };
  }
});

ipcMain.handle('pick-folder', async (_, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('save-artboard-to-folder', async (_, folder, filename, dataUrl) => {
  try {
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const filePath = path.join(folder, `${safeExportName(filename)}.jpg`);
    fs.writeFileSync(filePath, setJpegDpi(Buffer.from(base64, 'base64'), EXPORT_DPI));
    return { success: true, path: filePath };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Cross-Project Clipboard ──
// Held in the main process so copied canvas objects survive navigating between
// projects (each project open reloads the renderer, wiping its JS state).
let clipboardStore = null;

ipcMain.handle('set-clipboard', (_, payload) => {
  clipboardStore = payload || null;
  return { success: true };
});

ipcMain.handle('get-clipboard', () => clipboardStore);

// Copy an asset referenced by a pasted object into the destination project's
// assets folder so the paste is self-contained. No-op (returns the same path)
// when the asset already lives inside this project's assets.
ipcMain.handle('import-external-asset', (_, currentProjectName, sourceAssetPath, fromProjectName) => {
  try {
    if (!sourceAssetPath) return { error: 'No source path' };
    const assetsDir = path.join(PROJECTS_DIR, currentProjectName, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    // Relative source paths ('assets/x.jpg') resolve against the SOURCE
    // project (cross-project paste passes it along).
    let resolvedSrc = sourceAssetPath;
    if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(String(sourceAssetPath))) {
      resolvedSrc = path.join(PROJECTS_DIR, fromProjectName || currentProjectName, String(sourceAssetPath));
    }
    const normSrc = path.resolve(resolvedSrc);
    const normAssets = path.resolve(assetsDir);
    // Already inside this project's assets → keep as-is (REUSE, don't
    // duplicate). Windows paths are case-insensitive but the same folder
    // can arrive with different casing (npm start vs .bat shortcut), so
    // compare case-insensitively there.
    const cmp = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
    if (cmp(normSrc) === cmp(normAssets) || cmp(normSrc).startsWith(cmp(normAssets + path.sep))) {
      return { path: sourceAssetPath };
    }
    if (!fs.existsSync(normSrc)) return { error: 'Source asset missing', path: sourceAssetPath };

    // Cross-project: dedupe by CONTENT — if a byte-identical file already
    // lives in this project's assets (e.g. the same image pasted twice),
    // reuse it instead of writing another timestamped copy.
    const srcBuf = fs.readFileSync(normSrc);
    for (const f of fs.readdirSync(normAssets)) {
      const p = path.join(normAssets, f);
      try {
        const st = fs.statSync(p);
        if (!st.isFile() || st.size !== srcBuf.length) continue;
        if (fs.readFileSync(p).equals(srcBuf)) return { path: p };
      } catch (_) { /* skip unreadable entries */ }
    }

    const ext = path.extname(normSrc);
    const base = path.basename(normSrc, ext);
    const destName = `${base}_${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`;
    const destPath = path.join(assetsDir, destName);
    fs.writeFileSync(destPath, srcBuf);
    return { path: destPath };
  } catch (err) {
    console.error('import-external-asset error:', err);
    return { error: err.message, path: sourceAssetPath };
  }
});

// ── Navigation ──

ipcMain.handle('open-canvas', (_, projectName) => {
  mainWindow.loadFile('html/canvas.html', { query: { project: projectName } });
});

ipcMain.handle('go-home', () => {
  mainWindow.loadFile('html/landing.html');
});

ipcMain.handle('set-title', (_, title) => {
  mainWindow.setTitle(title);
});

// ── Project Shortcut (.bat launcher) ──
// Generates a standalone .bat file that, when double-clicked from
// anywhere in the file system, launches this Electron app directly
// into the given project.
ipcMain.handle('create-shortcut', async (_, projectName) => {
  const projDir = path.join(PROJECTS_DIR, projectName);
  if (!fs.existsSync(projDir)) return { error: 'Project not found' };

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Project Shortcut',
    defaultPath: `${projectName}.bat`,
    filters: [{ name: 'Batch File', extensions: ['bat'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // Escape any double quotes in the project name just in case.
  const safeProject = projectName.replace(/"/g, '""');
  // Packaged build: launch the exe directly. Dev: npm/npx as before.
  const batContent = app.isPackaged
    ? `@echo off\r\n` +
      `title Blank-Slate - ${safeProject}\r\n` +
      `start "" "${process.execPath}" --project="${safeProject}"\r\n`
    : `@echo off\r\n` +
      `title Blank-Slate - ${safeProject}\r\n` +
      `cd /d "${BASE_DIR}"\r\n` +
      `if not exist "node_modules" (\r\n` +
      `    echo Installing dependencies... This may take a minute on first run.\r\n` +
      `    call npm install\r\n` +
      `)\r\n` +
      `call npx electron . --project="${safeProject}"\r\n`;

  try {
    fs.writeFileSync(result.filePath, batContent);
    return { success: true, path: result.filePath };
  } catch (err) {
    return { error: err.message };
  }
});
