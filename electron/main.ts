import { app, BrowserWindow, dialog, ipcMain, session, shell, clipboard, nativeTheme, Menu } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store';
import { Connection } from './auth';
import { Chat } from './chat';
import { segmentChapter } from './segments';
import { BookMemory } from './book-memory';
import { normalizeDetail } from '../src/detail-level';
import { OcrService } from './ocr';
import { createEpub, type ConvertedPage } from './epub-export';
import type { Book, Session, Settings, Draft } from '../src/types';
const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.READER_DATA_DIR) app.setPath('userData', process.env.READER_DATA_DIR);
let chat: Chat;
let connection: Connection;
let ocr: OcrService;
app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  mkdirSync(path.join(dir, 'books'), { recursive: true });
  const store = await Store.open(dir);
  const memory = new BookMemory(store);
  for (const book of store.list<Book>('book')) memory.profile(book.id);
  memory.archive();
  // Dedicated Chromium session uses Windows proxies without relaxing renderer restrictions.
  const transport = session.fromPartition('reader-network');
  connection = new Connection(
    dir,
    (url, init) => transport.fetch(url as string, init),
    (status) => {
      if (!win.isDestroyed()) win.webContents.send('reader:connection', status);
    },
  );
  nativeTheme.themeSource = store.settings().theme === 'night' ? 'dark' : 'light';
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1000,
    minHeight: 650,
    title: 'AI 读书助手',
    backgroundColor: store.settings().theme === 'night' ? '#191d1c' : '#f7f6f2',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { label: '剪切', enabled: params.editFlags.canCut, click: () => win.webContents.cut() },
      { label: '复制', enabled: params.editFlags.canCopy, click: () => win.webContents.copy() },
      { label: '粘贴', enabled: params.editFlags.canPaste, click: () => win.webContents.paste() },
      { type: 'separator' },
      { label: '全选', click: () => win.webContents.selectAll() },
    ]).popup({ window: win });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  // No renderer or EPUB document may contact remote hosts. AI requests run in the main process.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    if (url.protocol === 'file:') {
      const relative = path.relative(path.resolve(here, '../dist'), fileURLToPath(url));
      callback({ cancel: relative.startsWith('..') || path.isAbsolute(relative) });
      return;
    }
    callback({ cancel: !['file:', 'blob:', 'data:', 'devtools:'].includes(url.protocol) });
  });
  chat = new Chat(store, connection, (event) => {
    if (!win.isDestroyed()) win.webContents.send('reader:chat', event);
  });
  ocr = new OcrService(here.replace('app.asar', 'app.asar.unpacked'), store, (event) => {
    if (!win.isDestroyed()) win.webContents.send('reader:ocr-progress', event);
  });
  const bookPath = (id: string) => {
    const b = store.book(id);
    return path.join(dir, 'books', b.id + '.' + b.format);
  };
  const handlers: Record<string, (...args: any[]) => any> = {
    segmentChapter: (id: string, paragraphs: string[]) => segmentChapter(store, connection, id, paragraphs),
    bookAgent: (id: string) => memory.profile(id),
    saveBookAgent: (id: string, text: string) => memory.saveAgent(id, text),
    saveBookProgress: (id: string, text: string) => memory.saveProgress(id, text),
    thoughts: () => memory.archive(),
    saveThought: (input: Partial<import('../src/types').Thought>) => memory.saveThought(input),
    removeThought: (id: string) => memory.removeThought(id),
    createEpub: async (bookId: string, pages: ConvertedPage[]) => {
      const source = store.book(bookId);
      if (source.format !== 'pdf') throw new Error('仅支持 PDF 转 EPUB');
      const bytes = await createEpub(source.title + '（PDF 转换）', source.id, pages);
      store.book(bookId); // Conversion must not resurrect a removed source book.
      const id = createHash('sha256').update(bytes).digest('hex');
      const existing = store.get<Book>('book', id);
      if (existing) return existing;
      const now = new Date().toISOString();
      const book: Book = {
        id,
        title: source.title + '（PDF 转换）',
        format: 'epub',
        addedAt: now,
        lastRead: now,
      };
      writeFileSync(path.join(dir, 'books', id + '.epub'), bytes);
      store.put('book', id, book);
      store.createSession(id);
      return book;
    },
    exportEpub: async (bookId: string) => {
      const book = store.book(bookId);
      if (book.format !== 'epub') throw new Error('请选择 EPUB 书籍');
      const result = await dialog.showSaveDialog(win, {
        title: '导出 EPUB',
        defaultPath: book.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.epub',
        filters: [{ name: 'EPUB 书籍', extensions: ['epub'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const source = bookPath(bookId);
      if (path.resolve(result.filePath).toLowerCase() !== path.resolve(source).toLowerCase())
        writeFileSync(result.filePath, readFileSync(source));
      return true;
    },
    ocrPages: (bookId: string) => ocr.pages(bookId),
    recognizePage: (bookId: string, page: number, png: Uint8Array, width: number, height: number) =>
      ocr.recognize(bookId, page, png, width, height),
    cancelOcr: () => ocr.cancel(),
    snapshot: () => ({
      books: store.list<Book>('book').sort((a, b) => b.lastRead.localeCompare(a.lastRead)),
      sessions: store.list<Session>('session').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      settings: store.settings(),
      connection: connection.status(),
    }),
    importBooks: async (files?: { name: string; bytes: Uint8Array }[]) => {
      if (!files) {
        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: '书籍', extensions: ['pdf', 'epub'] }],
        });
        files = result.canceled
          ? []
          : result.filePaths.map((file) => ({ name: path.basename(file), bytes: readFileSync(file) }));
      }
      const books: Book[] = [],
        errors: string[] = [];
      for (const file of files) {
        try {
          const ext = path.extname(file.name).toLowerCase().slice(1);
          if (ext !== 'pdf' && ext !== 'epub') throw new Error('仅支持 PDF 和 EPUB');
          const bytes = Buffer.from(file.bytes);
          if (bytes.length > 250 * 1024 * 1024) throw new Error('文件超过 250 MB');
          if (
            (ext === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) ||
            (ext === 'epub' && bytes.subarray(0, 2).toString() !== 'PK')
          )
            throw new Error('文件内容与格式不符或文件已损坏');
          const id = createHash('sha256').update(bytes).digest('hex');
          const existing = store.get<Book>('book', id);
          if (existing) {
            books.push(existing);
            continue;
          }
          const b: Book = {
            id,
            title: path.basename(file.name, path.extname(file.name)),
            format: ext,
            addedAt: new Date().toISOString(),
            lastRead: new Date().toISOString(),
          };
          writeFileSync(path.join(dir, 'books', id + '.' + ext), bytes);
          store.put('book', id, b);
          store.createSession(id);
          books.push(b);
        } catch (e) {
          errors.push(file.name + '：' + (e instanceof Error ? e.message : '导入失败'));
        }
      }
      return { books, errors };
    },
    removeBook: async (id: string) => {
      await ocr.cancel();
      await chat.cancel();
      const file = bookPath(id);
      memory.removeProfile(id);
      store.deleteBook(id);
      for (const p of ocrRecords(id)) store.remove('ocr', `${id}:${p.page}`);
      if (existsSync(file)) unlinkSync(file);
    },
    bookBytes: (id: string) => new Uint8Array(readFileSync(bookPath(id))),
    position: (id: string, value: Book['position']) => {
      const b = store.get<Book>('book', id);
      if (!b) return; // A final scroll event can arrive after this book was removed.
      store.put('book', id, { ...b, position: value, lastRead: new Date().toISOString() });
    },
    title: (id: string, value: string) => {
      const b = store.book(id);
      if (value.trim()) store.put('book', id, { ...b, title: value.trim().slice(0, 300) });
    },
    bookDetail: (id: string, level: unknown) => {
      const book = store.book(id);
      if (normalizeDetail(level) !== level) throw new Error('无效的讲解档位');
      store.put('book', id, { ...book, detailLevel: level });
    },
    createSession: (bookId: string) => store.createSession(bookId),
    renameSession: (id: string, name: string) => {
      const s = store.session(id);
      if (name.trim()) store.put('session', id, { ...s, name: name.trim().slice(0, 100) });
    },
    messages: (id: string) => {
      const s = store.get<Session>('session', id);
      if (!s) return [];
      store.put('session', id, { ...s, updatedAt: new Date().toISOString() });
      const book = store.book(s.bookId);
      store.put('book', book.id, { ...book, activeSessionId: id });
      return store.messages(id);
    },
    saveDraft: (id: string, draft: Draft) => {
      const s = store.session(id);
      store.put('session', id, { ...s, draft });
    },
    settings: (value: Partial<Settings>) => {
      if (value.theme !== undefined && !['paper', 'white', 'night'].includes(value.theme))
        throw new Error('无效主题');
      store.patchSettings(value);
      if (value.theme) {
        nativeTheme.themeSource = value.theme === 'night' ? 'dark' : 'light';
        win.setBackgroundColor(
          value.theme === 'night' ? '#191d1c' : value.theme === 'white' ? '#ffffff' : '#f7f6f2',
        );
      }
    },
    login: async () => {
      const status = await connection.login();
      win.show();
      win.focus();
      return status;
    },
    cancelLogin: () => connection.cancelLogin(),
    logout: async () => {
      await chat.cancel();
      return connection.logout();
    },
    configure: async (mode: 'api' | 'chatgpt', key?: string) => {
      await chat.cancel();
      return connection.configure(mode, key);
    },
    models: () => connection.models(),
    openUsage: () =>
      shell.openExternal(
        connection.status().mode === 'chatgpt'
          ? 'https://chatgpt.com/settings/usage'
          : 'https://platform.deepseek.com/usage',
      ),
    send: (input: Parameters<Chat['send']>[0]) => chat.send(input),
    cancel: () => chat.cancel(),
    copyText: (text: string) => {
      if (typeof text !== 'string') throw new Error('无效文本');
      clipboard.writeText(text);
    },
  };
  function ocrRecords(bookId: string) {
    return store.list<import('../src/types').OcrPage>('ocr').filter((p) => p.bookId === bookId);
  }
  for (const [name, handler] of Object.entries(handlers))
    ipcMain.handle('reader:' + name, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('不允许的调用来源');
      return handler(...args);
    });
  await win.loadURL(pathToFileURL(path.join(here, '../dist/index.html')).toString());
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  connection?.cancelLogin();
  void ocr?.cancel();
});
