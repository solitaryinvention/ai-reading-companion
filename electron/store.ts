import initSqlJs, { type Database } from 'sql.js';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Book, Session, Message, Settings, Draft } from '../src/types';

export const emptyDraft = (): Draft => ({ text: '', refs: [], attach: false });
export const defaults: Settings = {
  sidebar: 220,
  chatRatio: 0.45,
  collapsed: false,
  fontSize: 19,
  readingFont: 'serif',
  lineHeight: 1.9,
  theme: 'paper',
  zoom: 1,
};
export class Store {
  get directory() {
    return path.dirname(this.file);
  }
  private constructor(
    public db: Database,
    private file: string,
  ) {}
  static async open(dir: string) {
    mkdirSync(dir, { recursive: true });
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const file = path.join(dir, 'library.sqlite');
    const db = new SQL.Database(existsSync(file) ? readFileSync(file) : undefined);
    db.run(
      'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))',
    );
    const store = new Store(db, file);
    for (const m of store.list<Message>('message'))
      if (m.status === 'streaming')
        store.put('message', m.id, { ...m, status: 'cancelled', error: '应用关闭，生成已中断' });
    return store;
  }
  list<T>(kind: string): T[] {
    const q = this.db.prepare('SELECT data FROM records WHERE kind=?');
    q.bind([kind]);
    const rows: T[] = [];
    while (q.step()) rows.push(JSON.parse(q.getAsObject().data as string));
    q.free();
    return rows;
  }
  get<T>(kind: string, id: string): T | undefined {
    const q = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?');
    q.bind([kind, id]);
    const row = q.step() ? (JSON.parse(q.getAsObject().data as string) as T) : undefined;
    q.free();
    return row;
  }
  put(kind: string, id: string, value: unknown) {
    this.db.run('INSERT OR REPLACE INTO records VALUES (?,?,?)', [kind, id, JSON.stringify(value)]);
    this.flush();
  }
  remove(kind: string, id: string) {
    this.db.run('DELETE FROM records WHERE kind=? AND id=?', [kind, id]);
    this.flush();
  }
  flush() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, this.db.export());
    renameSync(tmp, this.file);
  }
  settings() {
    return { ...defaults, ...this.get<Settings>('settings', 'app') };
  }
  patchSettings(value: Partial<Settings>) {
    this.put('settings', 'app', { ...this.settings(), ...value });
  }
  book(id: string) {
    const b = this.get<Book>('book', id);
    if (!b) throw new Error('书籍不存在');
    return b;
  }
  session(id: string) {
    const s = this.get<Session>('session', id);
    if (!s) throw new Error('会话不存在');
    return s;
  }
  createSession(bookId: string) {
    this.book(bookId);
    const s: Session = {
      id: randomUUID(),
      bookId,
      name: new Date().toLocaleString('zh-CN'),
      updatedAt: new Date().toISOString(),
      draft: emptyDraft(),
    };
    this.put('session', s.id, s);
    return s;
  }
  messages(id: string) {
    this.session(id);
    return this.list<Message>('message')
      .filter((x) => x.sessionId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  deleteBook(id: string) {
    this.remove('book-progress', id);
    for (const h of this.list<{ id: string; bookId: string }>('highlight').filter((h) => h.bookId === id))
      this.remove('highlight', h.id);
    for (const s of this.list<Session>('session').filter((s) => s.bookId === id)) {
      for (const m of this.messages(s.id)) this.remove('message', m.id);
      this.remove('session', s.id);
    }
    this.remove('book', id);
  }
}
