const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  deleteProject: (name) => ipcRenderer.invoke('delete-project', name),
  renameProject: (oldName, newName) => ipcRenderer.invoke('rename-project', oldName, newName),
  loadProject: (name) => ipcRenderer.invoke('load-project', name),
  saveProject: (name, data) => ipcRenderer.invoke('save-project', name, data),
  importImages: (projectName, options) => ipcRenderer.invoke('import-images', projectName, options),
  dropImage: (projectName, filePath) => ipcRenderer.invoke('drop-image', projectName, filePath),
  pasteImage: (projectName) => ipcRenderer.invoke('paste-image', projectName),
  openCanvas: (projectName) => ipcRenderer.invoke('open-canvas', projectName),
  goHome: () => ipcRenderer.invoke('go-home'),
  setTitle: (title) => ipcRenderer.invoke('set-title', title),
  createShortcut: (projectName) => ipcRenderer.invoke('create-shortcut', projectName),
  exportArtboard: (filename, dataUrl) => ipcRenderer.invoke('export-artboard', filename, dataUrl),
  exportArtboardsAll: (items) => ipcRenderer.invoke('export-artboards-all', items),
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  saveArtboardToFolder: (folder, filename, dataUrl) => ipcRenderer.invoke('save-artboard-to-folder', folder, filename, dataUrl),
  removeWhiteBg: (imagePath) => ipcRenderer.invoke('remove-white-bg', imagePath),
  // Cross-project clipboard (persists in the main process across navigation)
  setClipboard: (payload) => ipcRenderer.invoke('set-clipboard', payload),
  getClipboard: () => ipcRenderer.invoke('get-clipboard'),
  importExternalAsset: (projectName, sourceAssetPath, fromProjectName) => ipcRenderer.invoke('import-external-asset', projectName, sourceAssetPath, fromProjectName),
  // ── Sharing foundation ──
  getProjectDir: (name) => ipcRenderer.invoke('get-project-dir', name),
  getToolStatus: () => ipcRenderer.invoke('get-tool-status'),
  sweepAssets: (name, keep) => ipcRenderer.invoke('sweep-assets', name, keep),
  publishDeck: (projectName, payload) => ipcRenderer.invoke('publish-deck', projectName, payload),
  importDeck: () => ipcRenderer.invoke('import-deck'),
  importDeckInto: (currentProject, deckDirName) => ipcRenderer.invoke('import-deck-into', currentProject, deckDirName),
  // ── Community catalog (live GitHub view) ──
  fetchCommunityCatalog: () => ipcRenderer.invoke('fetch-community-catalog'),
  getCommunityPdf: (entry) => ipcRenderer.invoke('get-community-pdf', entry),
  downloadCommunityDeck: (entry) => ipcRenderer.invoke('download-community-deck', entry),
  installCommunityTool: (entry) => ipcRenderer.invoke('install-community-tool', entry),
  // Real path of a dropped File (needed with contextIsolation).
  // webUtils.getPathForFile requires Electron 29+; on Electron 28 it is
  // undefined and the legacy File.path property still exists — use
  // whichever is available so drag & drop works on both.
  getFilePath: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') return webUtils.getPathForFile(file);
    } catch (_) { /* fall through */ }
    return file && file.path ? file.path : '';
  },
  // ── Tools folder (the plugin system) ──
  listTools: () => ipcRenderer.invoke('list-tools'),
  getToolsDir: () => ipcRenderer.invoke('get-tools-dir'),
  reviveBaseline: (name) => ipcRenderer.invoke('revive-baseline', name),
  // ── Decks (side panel gallery) ──
  getDecks: () => ipcRenderer.invoke('get-decks'),
});
