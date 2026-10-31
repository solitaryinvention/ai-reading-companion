export interface Book {
  detailLevel?: DetailLevel;
  activeSessionId?: string;
  id: string;
  title: string;
  format: 'pdf' | 'epub';
  addedAt: string;
  lastRead: string;
  position?: ReaderPosition;
}
export type DetailLevel = 1 | 2 | 3 | 4 | 5;
export interface ReaderPosition {
  page?: number;
  offset?: number;
  cfi?: string;
}
export interface SourceReference {
  id: string;
  bookId: string;
  title: string;
  label: string;
  text: string;
  page?: number;
  cfi?: string;
  ocr?: boolean;
  rects?: { x: number; y: number; width: number; height: number }[];
}
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OcrPage {
  bookId: string;
  page: number;
  text: string;
  confidence: number;
  lines: OcrLine[];
}
export interface OcrProgress {
  bookId: string;
  page: number;
  progress: number;
  status: string;
}
export interface Draft {
  text: string;
  refs: SourceReference[];
  attach: boolean;
  from?: number;
  to?: number;
}
export interface Session {
  id: string;
  bookId: string;
  name: string;
  updatedAt: string;
  draft: Draft;
}
export interface Message {
  detailLevel?: DetailLevel;
  location?: string;
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  refs: SourceReference[];
  status: 'complete' | 'streaming' | 'cancelled' | 'failed';
  error?: string;
  createdAt: string;
}
export interface TocItem {
  wordCount?: number;
  countIncomplete?: boolean;
  label: string;
  target: string | number;
  level: number;
}
export interface Model {
  id: string;
  name: string;
}
export interface ConnectionStatus {
  loginMessage?: string;
  mode: 'chatgpt' | 'api';
  signedIn: boolean;
  planEnabled: boolean;
  email?: string;
  hasKey: boolean;
}
export interface BookAgent {
  text: string;
  defaultText: string;
  progress: string;
  path: string;
}
export interface Thought {
  id: string;
  title: string;
  originalText: string;
  bookId?: string;
  bookTitle: string;
  location: string;
  sessionId?: string;
  messageId?: string;
  reasoning: string;
  support: string;
  questions: string;
  revision: string;
  connections: string;
  uses: string;
  createdAt: string;
  updatedAt: string;
  origin: 'conversation' | 'manual';
}
export interface ChatEvent {
  notice?: string;
  requestId: string;
  sessionId: string;
  messageId: string;
  type: 'delta' | 'complete' | 'cancelled' | 'failed';
  text?: string;
  error?: string;
}
export interface Settings {
  chatFont?: string;
  smartSegments?: boolean;
  sidebar: number;
  chatRatio: number;
  collapsed: boolean;
  fontSize: number;
  readingFont?: 'serif' | 'sans';
  lineHeight: number;
  theme: 'paper' | 'white' | 'night';
  zoom: number;
  activeBook?: string;
  model?: string;
}
export interface Snapshot {
  books: Book[];
  sessions: Session[];
  settings: Settings;
  connection: ConnectionStatus;
}
export interface Bridge {
  segmentChapter(bookId: string, paragraphs: string[]): Promise<number[]>;
  bookAgent(bookId: string): Promise<BookAgent>;
  saveBookAgent(bookId: string, text: string): Promise<BookAgent>;
  saveBookProgress(bookId: string, text: string): Promise<BookAgent>;
  thoughts(): Promise<{ entries: Thought[]; path: string }>;
  saveThought(thought: Partial<Thought>): Promise<Thought>;
  removeThought(id: string): Promise<void>;
  createEpub(
    bookId: string,
    pages: { page: number; text: string; label: string; ocr: boolean }[],
  ): Promise<Book>;
  exportEpub(bookId: string): Promise<boolean>;
  ocrPages(bookId: string): Promise<OcrPage[]>;
  recognizePage(
    bookId: string,
    page: number,
    png: Uint8Array,
    width: number,
    height: number,
  ): Promise<OcrPage>;
  cancelOcr(): Promise<void>;
  onOcrProgress(callback: (event: OcrProgress) => void): () => void;
  snapshot(): Promise<Snapshot>;
  importBooks(files?: { name: string; bytes: Uint8Array }[]): Promise<{ books: Book[]; errors: string[] }>;
  removeBook(id: string): Promise<void>;
  bookBytes(id: string): Promise<Uint8Array>;
  position(id: string, value: ReaderPosition): Promise<void>;
  title(id: string, value: string): Promise<void>;
  bookDetail(id: string, level: DetailLevel): Promise<void>;
  createSession(bookId: string): Promise<Session>;
  renameSession(id: string, name: string): Promise<void>;
  messages(sessionId: string): Promise<Message[]>;
  saveDraft(sessionId: string, draft: Draft): Promise<void>;
  settings(value: Partial<Settings>): Promise<void>;
  onConnection(callback: (status: ConnectionStatus) => void): () => void;
  login(): Promise<ConnectionStatus>;
  cancelLogin(): Promise<void>;
  logout(): Promise<ConnectionStatus>;
  configure(mode: 'chatgpt' | 'api', key?: string): Promise<ConnectionStatus>;
  models(): Promise<Model[]>;
  openUsage(): Promise<void>;
  copyText(text: string): Promise<void>;
  send(input: {
    detailLevel?: DetailLevel;
    reading?: { label: string; page: number; total: number; toc: string[] };
    requestId: string;
    sessionId: string;
    model: string;
    text: string;
    refs: SourceReference[];
    chapter?: SourceReference;
    retryId?: string;
  }): Promise<void>;
  cancel(): Promise<void>;
  onChat(callback: (event: ChatEvent) => void): () => void;
}
declare global {
  interface Window {
    reader: Bridge;
  }
}
