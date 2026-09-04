const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopInfo', {
  version: process.versions.electron,
  platform: process.platform,
});
