const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getKeysInfo:    () => ipcRenderer.invoke('get-keys-info'),

  getTextModels:  () => ipcRenderer.invoke('get-text-models'),
  getImageModels: () => ipcRenderer.invoke('get-image-models'),
  getAudioModels: () => ipcRenderer.invoke('get-audio-models'),

  // Chat
  chatSend:    (args) => ipcRenderer.invoke('chat-send',   args),
  chatList:    ()     => ipcRenderer.invoke('chat-list'),
  chatLoad:    (id)   => ipcRenderer.invoke('chat-load',   id),
  chatSave:    (args) => ipcRenderer.invoke('chat-save',   args),
  chatDelete:  (id)   => ipcRenderer.invoke('chat-delete', id),
  chatRename:  (args) => ipcRenderer.invoke('chat-rename', args),

  // Generators
  generateImage:   (args) => ipcRenderer.invoke('generate-image',   args),
  generateVideo:   (args) => ipcRenderer.invoke('generate-video',   args),
  generateAudio:   (args) => ipcRenderer.invoke('generate-audio',   args),
  transcribeAudio: (args) => ipcRenderer.invoke('transcribe-audio', args),

  // File ops
  openFile:   (filePath)             => ipcRenderer.invoke('open-file',   filePath),
  openFolder: (type)                 => ipcRenderer.invoke('open-folder', type),
  saveFile:   (srcPath, defaultName) => ipcRenderer.invoke('save-file',   { srcPath, defaultName }),
});
