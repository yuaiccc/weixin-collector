const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collector', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  archive: (payload) => ipcRenderer.invoke('archive', payload),
  onProgress: (callback) => ipcRenderer.on('archive-progress', (_event, value) => callback(value))
});
