const { contextBridge, ipcRenderer } = require('electron');

const validLogLevels = new Set(['debug', 'info', 'warn', 'error']);

contextBridge.exposeInMainWorld('localApp', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getDefaultBackup: () => ipcRenderer.invoke('app:get-default-backup'),
  saveDefaultBackup: (data) => ipcRenderer.invoke('app:save-default-backup', data),
  choosePreviewImage: () => ipcRenderer.invoke('app:choose-preview-image'),
  copyPreviewImage: (payload) => ipcRenderer.invoke('app:copy-preview-image', payload),
  writeLog: (level, message) => {
    const safeLevel = validLogLevels.has(level) ? level : 'info';
    const safeMessage = typeof message === 'string' ? message : String(message ?? '');

    ipcRenderer.send('renderer:log', {
      level: safeLevel,
      message: safeMessage
    });
  },
  onLog: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, entry) => {
      callback({
        level: typeof entry?.level === 'string' ? entry.level : 'info',
        message: typeof entry?.message === 'string' ? entry.message : '',
        timestamp: typeof entry?.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
      });
    };

    ipcRenderer.on('app-log', listener);
    return () => ipcRenderer.removeListener('app-log', listener);
  }
});

contextBridge.exposeInMainWorld('forge', {
  getConfig: () => ipcRenderer.invoke('forge:get-config'),
  setRoot: (forgeRoot) => ipcRenderer.invoke('forge:set-root', forgeRoot),
  chooseRoot: () => ipcRenderer.invoke('forge:choose-root'),
  start: () => ipcRenderer.invoke('forge:start'),
  stop: () => ipcRenderer.invoke('forge:stop'),
  checkApi: () => ipcRenderer.invoke('forge:check-api'),
  openWebUi: () => ipcRenderer.invoke('forge:open-webui'),
  openImageFolder: (filePath) => ipcRenderer.invoke('forge:open-image-folder', filePath),
  openTodayOutputFolder: () => ipcRenderer.invoke('forge:open-today-output-folder'),
  getDefaults: () => ipcRenderer.invoke('forge:get-defaults'),
  cancelGeneration: () => ipcRenderer.invoke('forge:cancel-generation'),
  pauseGeneration: () => ipcRenderer.invoke('forge:pause-generation'),
  resumeGeneration: () => ipcRenderer.invoke('forge:resume-generation'),
  skipCurrentGeneration: () => ipcRenderer.invoke('forge:skip-current-generation'),
  generateImage: (payload) => ipcRenderer.invoke('forge:generate-image', payload),
  generatePreviewImage: (payload) => ipcRenderer.invoke('forge:generate-preview-image', payload),
  onImageGenerated: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, entry) => {
      callback({
        index: Number.isInteger(entry?.index) ? entry.index : 0,
        total: Number.isInteger(entry?.total) ? entry.total : 0,
        image: entry?.image || null
      });
    };

    ipcRenderer.on('forge-image-generated', listener);
    return () => ipcRenderer.removeListener('forge-image-generated', listener);
  },
  onLog: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, entry) => {
      callback({
        level: typeof entry?.level === 'string' ? entry.level : 'info',
        message: typeof entry?.message === 'string' ? entry.message : '',
        timestamp: typeof entry?.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
      });
    };

    ipcRenderer.on('forge-log', listener);
    return () => ipcRenderer.removeListener('forge-log', listener);
  },
  onStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, entry) => {
      callback({
        status: typeof entry?.status === 'string' ? entry.status : 'unknown',
        message: typeof entry?.message === 'string' ? entry.message : '',
        timestamp: typeof entry?.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
      });
    };

    ipcRenderer.on('forge-status', listener);
    return () => ipcRenderer.removeListener('forge-status', listener);
  }
});
