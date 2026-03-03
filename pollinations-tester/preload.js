const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getKeysInfo:    () => ipcRenderer.invoke('get-keys-info'),

  getTextModels:  () => ipcRenderer.invoke('get-text-models'),
  getImageModels: () => ipcRenderer.invoke('get-image-models'),
  getAudioModels: () => ipcRenderer.invoke('get-audio-models'),

  generateText:   (args) => ipcRenderer.invoke('generate-text',  args),
  generateImage:  (args) => ipcRenderer.invoke('generate-image', args),
  generateVideo:  (args) => ipcRenderer.invoke('generate-video', args),
  generateAudio:  (args) => ipcRenderer.invoke('generate-audio', args),

  transcribeAudio: (args)          => ipcRenderer.invoke('transcribe-audio', args),
  openFile: (filePath)             => ipcRenderer.invoke('open-file', filePath),
  saveFile: (srcPath, defaultName) => ipcRenderer.invoke('save-file', { srcPath, defaultName }),
});
