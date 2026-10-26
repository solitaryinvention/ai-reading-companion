import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, ChatEvent } from '../src/types';
const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke('reader:' + method, ...args);
const api: Bridge = {
  bookAgent: (id) => invoke('bookAgent', id),
  saveBookAgent: (id, text) => invoke('saveBookAgent', id, text),
  saveBookProgress: (id, text) => invoke('saveBookProgress', id, text),
  thoughts: () => invoke('thoughts'),
  saveThought: (input) => invoke('saveThought', input),
  removeThought: (id) => invoke('removeThought', id),
  highlights: (id) => invoke('highlights', id),
  saveHighlight: (ref) => invoke('saveHighlight', ref),
  removeHighlight: (bookId, id) => invoke('removeHighlight', bookId, id),
  createEpub: (bookId, pages) => invoke('createEpub', bookId, pages),
  exportEpub: (bookId) => invoke('exportEpub', bookId),
  ocrPages: (bookId) => invoke('ocrPages', bookId),
  recognizePage: (bookId, page, png, width, height) =>
    invoke('recognizePage', bookId, page, png, width, height),
  cancelOcr: () => invoke('cancelOcr'),
  onOcrProgress: (callback) => {
    const listener = (_event: unknown, data: import('../src/types').OcrProgress) => callback(data);
    ipcRenderer.on('reader:ocr-progress', listener);
    return () => ipcRenderer.removeListener('reader:ocr-progress', listener);
  },
  snapshot: () => invoke('snapshot'),
  importBooks: (files) => invoke('importBooks', files),
  removeBook: (id) => invoke('removeBook', id),
  bookBytes: (id) => invoke('bookBytes', id),
  position: (id, v) => invoke('position', id, v),
  title: (id, v) => invoke('title', id, v),
  bookDetail: (id, level) => invoke('bookDetail', id, level),
  createSession: (id) => invoke('createSession', id),
  renameSession: (id, name) => invoke('renameSession', id, name),
  messages: (id) => invoke('messages', id),
  saveDraft: (id, draft) => invoke('saveDraft', id, draft),
  settings: (value) => invoke('settings', value),
  onConnection: (callback) => {
    const listener = (_event: unknown, data: import('../src/types').ConnectionStatus) => callback(data);
    ipcRenderer.on('reader:connection', listener);
    return () => ipcRenderer.removeListener('reader:connection', listener);
  },
  login: () => invoke('login'),
  cancelLogin: () => invoke('cancelLogin'),
  logout: () => invoke('logout'),
  configure: (mode, key) => invoke('configure', mode, key),
  models: () => invoke('models'),
  openUsage: () => invoke('openUsage'),
  send: (input) => invoke('send', input),
  cancel: () => invoke('cancel'),
  copyText: (text) => invoke('copyText', text),
  onChat: (callback) => {
    const listener = (_event: unknown, data: ChatEvent) => callback(data);
    ipcRenderer.on('reader:chat', listener);
    return () => ipcRenderer.removeListener('reader:chat', listener);
  },
};
contextBridge.exposeInMainWorld('reader', api);
