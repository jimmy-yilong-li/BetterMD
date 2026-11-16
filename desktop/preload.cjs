const { contextBridge, ipcRenderer } = require('electron');

// 只暴露命名的笔记操作；网页拿不到 Node、shell 或任意文件读写能力。
contextBridge.exposeInMainWorld('desktop', {
  invoke: (action, args = {}) => ipcRenderer.invoke('bettermd:action', action, args),
  onEvent: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('bettermd:event', listener);
    return () => ipcRenderer.removeListener('bettermd:event', listener);
  },
});
