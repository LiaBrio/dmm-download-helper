'use strict';

const path = require('node:path');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  // Paths
  getWebviewPreloadPath: () => `file://${path.join(__dirname, 'webview-preload.cjs')}`,

  // Download management
  submitDownload: (payload) => ipcRenderer.invoke('downloader:submit', payload),
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  cancelTask: (taskId) => ipcRenderer.invoke('tasks:cancel', taskId),

  // Settings
  chooseDownloadDir: () => ipcRenderer.invoke('download-dir:choose'),

  // Utilities
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openPath: (filePath) => ipcRenderer.invoke('app:open-path', filePath),
  openPopup: (url) => ipcRenderer.invoke('popup:open', url),
  closePopups: () => ipcRenderer.invoke('popup:close-all'),

  // Events
  onTaskUpdated: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('task:updated', listener);
    return () => ipcRenderer.removeListener('task:updated', listener);
  },
  onPopupSessions: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('popup:sessions', listener);
    return () => ipcRenderer.removeListener('popup:sessions', listener);
  },
});
