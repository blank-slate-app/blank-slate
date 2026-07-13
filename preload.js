const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  deleteProject: (name) => ipcRenderer.invoke('delete-project', name),
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
  importExternalAsset: (projectName, sourceAssetPath) => ipcRenderer.invoke('import-external-asset', projectName, sourceAssetPath),
  // Get real file path from a dropped File object (needed with contextIsolation)
  getFilePath: (file) => webUtils.getPathForFile(file),
  // ── Tools folder (the plugin system) ──
  listTools: () => ipcRenderer.invoke('list-tools'),
  reviveBaseline: (name) => ipcRenderer.invoke('revive-baseline', name),
});
