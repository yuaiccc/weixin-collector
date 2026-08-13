const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collector', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  fetchArticles: (payload) => ipcRenderer.invoke('fetch-articles', payload),
  archiveSelected: (payload) => ipcRenderer.invoke('archive-selected', payload),
  searchLibrary: (payload) => ipcRenderer.invoke('search-library', payload),
  archive: (payload) => ipcRenderer.invoke('archive', payload),
  onFetchProgress: (callback) => ipcRenderer.on('fetch-progress', (_event, value) => callback(value)),
  onProgress: (callback) => ipcRenderer.on('archive-progress', (_event, value) => callback(value))
});
