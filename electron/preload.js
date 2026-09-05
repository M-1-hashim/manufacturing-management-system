const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopInfo', {
  version: process.versions.electron,
  platform: process.platform,
});

// مدیریت اتصال دیتابیس به هاست اشتراکی — بدون نیاز به جستجوی دستی فایل
contextBridge.exposeInMainWorld('dbConnection', {
  info: () => ipcRenderer.invoke('db-connection:info'),
  save: (payload) => ipcRenderer.invoke('db-connection:save', payload),
  reset: () => ipcRenderer.invoke('db-connection:reset'),
  openFolder: () => ipcRenderer.invoke('db-connection:openFolder'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
});
