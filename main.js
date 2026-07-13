const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const PROJECTS_DIR = path.join(__dirname, 'projects');
const TOOLS_DIR = path.join(__dirname, 'tools');
const BASELINE_DIR = path.join(__dirname, 'baseline');
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // 2.5MB
const MAX_HIRES_BYTES = 5 * 1024 * 1024;   // 5MB for hi-res imports

// Ensure projects directory exists
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR);

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
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    titleBarStyle: 'default',
  });

  mainWindow.setMenuBarVisibility(false);

  // If launched with --project="Name" and that project exists, jump
  // straight into canvas.html; otherwise show the landing page.
  const projectArg = getProjectFromArgs();
  if (projectArg && fs.existsSync(path.join(PROJECTS_DIR, projectArg, 'project.json'))) {
    mainWindow.loadFile('canvas.html', { query: { project: projectArg } });
  } else {
    mainWindow.loadFile('landing.html');
  }
}

app.whenReady().then(() => {
  reviveMissingBaselines();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

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
ipcMain.handle('import-external-asset', (_, currentProjectName, sourceAssetPath) => {
  try {
    if (!sourceAssetPath) return { error: 'No source path' };
    const assetsDir = path.join(PROJECTS_DIR, currentProjectName, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const normSrc = path.resolve(sourceAssetPath);
    const normAssets = path.resolve(assetsDir);
    // Already inside this project's assets → keep as-is.
    if (normSrc === normAssets || normSrc.startsWith(normAssets + path.sep)) {
      return { path: sourceAssetPath };
    }
    if (!fs.existsSync(normSrc)) return { error: 'Source asset missing', path: sourceAssetPath };

    const ext = path.extname(normSrc);
    const base = path.basename(normSrc, ext);
    const destName = `${base}_${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`;
    const destPath = path.join(assetsDir, destName);
    fs.copyFileSync(normSrc, destPath);
    return { path: destPath };
  } catch (err) {
    console.error('import-external-asset error:', err);
    return { error: err.message, path: sourceAssetPath };
  }
});

// ── Navigation ──

ipcMain.handle('open-canvas', (_, projectName) => {
  mainWindow.loadFile('canvas.html', { query: { project: projectName } });
});

ipcMain.handle('go-home', () => {
  mainWindow.loadFile('landing.html');
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

  const canvasAppDir = __dirname;
  // Escape any double quotes in the project name just in case.
  const safeProject = projectName.replace(/"/g, '""');
  const batContent =
    `@echo off\r\n` +
    `title Blank-Slate - ${safeProject}\r\n` +
    `cd /d "${canvasAppDir}"\r\n` +
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
