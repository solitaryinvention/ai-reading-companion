import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  Library,
  MessageSquare,
  List,
  Plus,
  Search,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Square,
  Copy,
  RefreshCw,
  X,
  FileText,
  Quote,
  Trash2,
  Pencil,
  Sparkles,
  Check,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { Reader, type ReaderHandle } from './Reader';
import { AgentEditor, ThoughtArchive } from './KnowledgePanels';
import { DetailControl } from './DetailControl';
import { chatFonts, chatFontFamily } from './chat-fonts';
import { ConversationScroll } from './ConversationScroll';
import { normalizeDetail } from './detail-level';
import type {
  Snapshot,
  Book,
  Session,
  Message,
  Draft,
  SourceReference,
  Settings,
  Model,
  TocItem,
  ConnectionStatus,
} from './types';
const blank = (): Draft => ({ text: '', refs: [], attach: false });
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e);
export function App() {
  const [agentBook, setAgentBook] = useState<Book | null>(null),
    [archiveOpen, setArchiveOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null),
    [active, setActive] = useState(''),
    [sid, setSid] = useState(''),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState<Draft>(blank);
  const [models, setModels] = useState<Model[]>([]),
    [settingsOpen, setSettingsOpen] = useState(false),
    [tab, setTab] = useState<'books' | 'toc' | 'chats'>('books'),
    [search, setSearch] = useState(''),
    [toc, setToc] = useState<TocItem[]>([]);
  const [toast, setToast] = useState(''),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [preview, setPreview] = useState<SourceReference | null>(null),
    [preparing, setPreparing] = useState(false);
  const [info, setInfo] = useState<{
    page: number;
    total: number;
    label: string;
    count: number;
    tocTarget?: string | number;
    from?: number;
    to?: number;
  }>({ page: 1, total: 0, label: '当前章节', count: 0 });
  const [confirm, setConfirm] = useState<Book | null>(null),
    [rename, setRename] = useState<Session | null>(null),
    [newName, setNewName] = useState('');
  const reader = useRef<ReaderHandle>(null),
    chatScroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(active),
    sidRef = useRef(sid),
    draftRef = useRef(draft),
    request = useRef<{ id: string; sid: string; draft: Draft } | null>(null);
  const selectionEpoch = useRef(0),
    sessionEpoch = useRef(0);
  const preparingSend = useRef(false);
  const book = data?.books.find((b) => b.id === active),
    session = data?.sessions.find((s) => s.id === sid);
  const notify = (text: string) => setToast(text);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = data?.settings.theme || 'paper';
  }, [data?.settings.theme]);
  const refresh = async () => {
    const next = await window.reader.snapshot();
    setData(next);
    return next;
  };
  const loadModels = async () => {
    try {
      setModels([]);
      const list = await window.reader.models();
      if (list.length) {
        const state = await window.reader.snapshot();
        if (!list.some((m) => m.id === state.settings.model)) {
          await window.reader.settings({ model: state.connection.mode === 'chatgpt' ? list[0].id : '' });
          await refresh();
        }
      }
      setModels(list);
    } catch (e) {
      setModels([]);
      notify(errorText(e));
    }
  };
  const selectSession = async (s: Session) => {
    if (s.bookId !== activeRef.current) return;
    const epoch = ++sessionEpoch.current;
    await window.reader.cancel();
    if (epoch !== sessionEpoch.current || s.bookId !== activeRef.current) return;
    sidRef.current = s.id;
    setSid(s.id);
    setMessages([]);
    draftRef.current = s.draft || blank();
    setDraft(draftRef.current);
    setPreview(null);
    const rows = await window.reader.messages(s.id);
    if (epoch === sessionEpoch.current && sidRef.current === s.id) setMessages(rows);
  };
  const selectBook = async (b: Book, state = data) => {
    if (!state) return;
    const epoch = ++selectionEpoch.current;
    ++sessionEpoch.current;
    await window.reader.cancel();
    if (epoch !== selectionEpoch.current) return;
    activeRef.current = b.id;
    setActive(b.id);
    sidRef.current = '';
    setSid('');
    setMessages([]);
    draftRef.current = blank();
    setDraft(draftRef.current);
    setPreview(null);
    setToc([]);
    setInfo({ page: b.position?.page || 1, total: 0, label: '当前章节', count: 0 });
    await window.reader.settings({ activeBook: b.id });
    const latest = await window.reader.snapshot();
    if (epoch !== selectionEpoch.current) return;
    const selectedBook = latest.books.find((item) => item.id === b.id);
    const sessions = latest.sessions
      .filter((s) => s.bookId === b.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const s =
      sessions.find((s) => s.id === selectedBook?.activeSessionId) ||
      sessions[0] ||
      (await window.reader.createSession(b.id));
    if (epoch !== selectionEpoch.current) return;
    await selectSession(s);
    if (epoch === selectionEpoch.current) await refresh();
  };
  useEffect(() => {
    if (!window.reader) {
      notify('请通过桌面应用启动：npm start');
      return;
    }
    void refresh()
      .then(async (state) => {
        const b = state.books.find((b) => b.id === state.settings.activeBook) || state.books[0];
        if (b) await selectBook(b, state);
        if (state.connection.hasKey || state.connection.planEnabled) void loadModels();
      })
      .catch((e) => notify(errorText(e)));
    return window.reader.onChat((event) => {
      const req = request.current;
      if (!req || req.id !== event.requestId) return;
      if (sidRef.current === event.sessionId && event.type === 'delta')
        setMessages((prev) => {
          const found = prev.some((m) => m.id === event.messageId);
          return found
            ? prev.map((m) => (m.id === event.messageId ? { ...m, text: m.text + (event.text || '') } : m))
            : [
                ...prev,
                {
                  id: event.messageId,
                  sessionId: event.sessionId,
                  role: 'assistant',
                  text: event.text || '',
                  refs: [],
                  status: 'streaming',
                  createdAt: new Date().toISOString(),
                },
              ];
        });
      if (event.type !== 'delta') {
        setBusy(false);
        request.current = null;
        if (event.type === 'failed' && sidRef.current === req.sid && !draftRef.current.text && !draftRef.current.refs.length) {
          setDraft(req.draft);
          draftRef.current = req.draft;
          void window.reader.saveDraft(req.sid, req.draft);
        }
        if (event.error) notify(event.error);
        if (event.notice) notify(event.notice);
        if (sidRef.current === event.sessionId)
          void window.reader.messages(event.sessionId).then((rows) => {
            if (sidRef.current === event.sessionId && !request.current) setMessages(rows);
          });
        void refresh();
      }
    });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 7500);
    return () => clearTimeout(timer);
  }, [toast]);
  const editDraft = (next: Draft) => {
    setDraft(next);
    draftRef.current = next;
    setPreview(null);
    setData((prev) =>
      prev
        ? {
            ...prev,
            sessions: prev.sessions.map((s) => (s.id === sidRef.current ? { ...s, draft: next } : s)),
          }
        : prev,
    );
    if (sidRef.current) void window.reader.saveDraft(sidRef.current, next).catch((e) => notify(errorText(e)));
  };
  const updateSettings = (patch: Partial<Settings>) => {
    setData((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev));
    void window.reader.settings(patch).catch((e) => notify(errorText(e)));
  };
  const importBooks = async (files?: { name: string; bytes: Uint8Array }[]) => {
    setImporting(true);
    try {
      const result = await window.reader.importBooks(files);
      const state = await refresh();
      if (result.books[0]) await selectBook(result.books[0], state);
      if (result.errors.length) notify(result.errors.join('\n'));
      else if (result.books.length) notify(`已导入 ${result.books.length} 本书`);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setImporting(false);
    }
  };
  const newSession = async () => {
    if (!book) return;
    try {
      await window.reader.cancel();
      const s = await window.reader.createSession(book.id);
      await refresh();
      await selectSession(s);
      setTab('chats');
    } catch (e) {
      notify(errorText(e));
    }
  };
  const prepare = async () => {
    setPreparing(true);
    try {
      const chapter = await reader.current!.chapter(draft.from, draft.to);
      setPreview(chapter);
      return chapter;
    } catch (e) {
      notify(errorText(e));
      return null;
    } finally {
      setPreparing(false);
    }
  };
  const send = async (retryId?: string) => {
    if (!session || !book || session.bookId !== book.id || busy || preparingSend.current) return;
    if (!data?.settings.model) {
      setSettingsOpen(true);
      notify('请先连接账户并选择模型');
      return;
    }
    if (!retryId && !draft.text.trim() && !draft.refs.length) return;
    const submittedDraft = structuredClone(draft);
    const detailLevel = normalizeDetail(book.detailLevel);
    submittedDraft.attach = false;
    const req = { id: crypto.randomUUID(), sid: session.id, draft: submittedDraft };
    request.current = req;
    if (!retryId) editDraft(blank());
    setBusy(true);
    try {
      await window.reader.send({
        requestId: req.id,
        sessionId: session.id,
        model: data.settings.model,
        text: submittedDraft.text,
        refs: submittedDraft.refs,
        detailLevel,
        retryId,
        reading: { label: info.label, page: info.page, total: info.total, toc: toc.map((t) => t.label) },
      });
      const rows = await window.reader.messages(session.id);
      if (sidRef.current === session.id && request.current?.id === req.id)
        setMessages((previous) =>
          rows.map((row) => {
            const streamed = previous.find((message) => message.id === row.id);
            return streamed && streamed.text.length > row.text.length ? { ...row, text: streamed.text } : row;
          }),
        );
    } catch (e) {
      if (!retryId && sidRef.current === session.id && !draftRef.current.text && !draftRef.current.refs.length) editDraft(submittedDraft);
      setBusy(false);
      request.current = null;
      notify(errorText(e));
    }
  };
  const resize = (which: 'sidebar' | 'chat', event: React.PointerEvent) => {
    event.preventDefault();
    const start = event.clientX;
    const initial = data!.settings;
    const available = window.innerWidth - (initial.collapsed ? 0 : initial.sidebar) - 10;
    const move = (e: PointerEvent) => {
      const delta = e.clientX - start;
      if (which === 'sidebar')
        updateSettings({ sidebar: Math.min(340, Math.max(180, initial.sidebar + delta)) });
      else
        updateSettings({ chatRatio: Math.min(0.68, Math.max(0.3, initial.chatRatio + delta / available)) });
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  };
  const connectionLabel =
    data?.connection.mode === 'api'
      ? data.connection.hasKey
        ? 'DeepSeek · 独立计费'
        : 'API 未连接'
      : data?.connection.planEnabled
        ? 'ChatGPT 已连接'
        : data?.connection.signedIn
          ? '已登录 · 套餐未授权'
          : '连接 ChatGPT';
  if (!data)
    return (
      <div className="boot">
        <BookOpen size={40} />
        <h2>AI 读书助手</h2>
        <p>{toast || '正在打开本地书库…'}</p>
      </div>
    );
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={async (e) => {
        e.preventDefault();
        const files = await Promise.all(
          Array.from(e.dataTransfer.files).map(async (f) => ({
            name: f.name,
            bytes: new Uint8Array(await f.arrayBuffer()),
          })),
        );
        if (files.length) void importBooks(files);
      }}
    >
      {!data.settings.collapsed && (
        <>
          <aside className="sidebar" style={{ width: data.settings.sidebar }}>
            <div className="brand">
              <strong>书库</strong>
              <button
                title="折叠左栏"
                className="icon-button collapse"
                onClick={() => updateSettings({ collapsed: true })}
              >
                <PanelLeftClose size={17} />
              </button>
            </div>
            <button className="import-button" disabled={importing} onClick={() => void importBooks()}>
              <Plus size={17} />
              {importing ? '正在导入…' : '导入书籍'}
            </button>
            <nav className="tabs">
              <button className={tab === 'books' ? 'active' : ''} onClick={() => setTab('books')}>
                <Library size={16} />
                书库
              </button>
              <button className={tab === 'toc' ? 'active' : ''} onClick={() => setTab('toc')}>
                <List size={16} />
                目录
              </button>
              <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
                <MessageSquare size={16} />
                对话
              </button>
            </nav>
            <div className="sidebar-content">
              {tab === 'books' && (
                <>
                  <label className="search">
                    <Search size={15} />
                    <input
                      placeholder="搜索书籍"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <div className="section-label">
                    我的书籍 <span>{data.books.length}</span>
                  </div>
                  {data.books
                    .filter((b) => b.title.toLowerCase().includes(search.toLowerCase()))
                    .map((b) => (
                      <div className={'book-row ' + (active === b.id ? 'selected' : '')} key={b.id}>
                        <button
                          className="book-select"
                          onClick={() => void selectBook(b).catch((e) => notify(errorText(e)))}
                        >
                          <div className={'book-spine ' + b.format}>
                            <BookOpen size={20} />
                          </div>
                          <div>
                            <strong>{b.title}</strong>
                            <small>
                              {b.format.toUpperCase()} · {new Date(b.lastRead).toLocaleDateString('zh-CN')}
                            </small>
                          </div>
                        </button>
                        <button
                          className="delete-book"
                          title={'删除 ' + b.title}
                          onClick={() => setConfirm(b)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  {!data.books.length && (
                    <p className="sidebar-empty">
                      导入第一本书，
                      <br />
                      从一段原文开始。
                    </p>
                  )}
                </>
              )}
              {tab === 'toc' && (
                <>
                  <div className="section-label">书籍目录</div>
                  {toc.map((item, i) => (
                    <button
                      className={
                        'toc-row' +
                        (item.target === info.tocTarget && item.label === info.label ? ' current' : '')
                      }
                      aria-current={
                        item.target === info.tocTarget && item.label === info.label ? 'location' : undefined
                      }
                      aria-label={item.label}
                      title="字数不计空白、包含标点；脚注不计入，扫描 PDF 需先识别"
                      key={i}
                      style={{ paddingLeft: 12 + item.level * 12 }}
                      onClick={() =>
                        void reader.current?.jump(item.target).catch((e) => notify(errorText(e)))
                      }
                    >
                      <span>{item.label}</span>
                      <small>
                        {item.wordCount === undefined
                          ? item.countIncomplete
                            ? '无法统计'
                            : '统计中…'
                          : `${item.wordCount.toLocaleString()} 字${item.countIncomplete ? ' · 含未识别页' : ''}`}
                      </small>
                    </button>
                  ))}
                  {!toc.length && (
                    <p className="sidebar-empty">
                      {book?.format === 'pdf'
                        ? '此 PDF 没有目录，可在右下方输入页码跳转。'
                        : '打开书籍后显示目录。'}
                    </p>
                  )}
                </>
              )}
              {tab === 'chats' && (
                <>
                  <button className="new-chat" disabled={!book} onClick={() => void newSession()}>
                    <Plus size={15} />
                    新建对话
                  </button>
                  {data.sessions
                    .filter((s) => s.bookId === active)
                    .map((s) => (
                      <div key={s.id} className={'session-row ' + (s.id === sid ? 'selected' : '')}>
                        <button onClick={() => void selectSession(s)}>
                          <MessageSquare size={14} />
                          <span>{s.name}</span>
                        </button>
                        <button
                          title="重命名会话"
                          onClick={() => {
                            setRename(s);
                            setNewName(s.name);
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    ))}
                </>
              )}
            </div>
            <button className="archive-entry" onClick={() => setArchiveOpen(true)}>
              思想档案
            </button>
            <button className="connection-button" onClick={() => setSettingsOpen(true)}>
              <span
                className={
                  'status-dot ' +
                  ((data.connection.mode === 'api' ? data.connection.hasKey : data.connection.planEnabled)
                    ? 'connected'
                    : '')
                }
              />
              <span>{connectionLabel}</span>
              <SettingsIcon size={17} />
            </button>
          </aside>
          <div className="splitter" onPointerDown={(e) => resize('sidebar', e)} />
        </>
      )}
      <main className="workspace">
        <section className="chat-panel" style={{ flexBasis: `${data.settings.chatRatio * 100}%`, fontFamily: chatFontFamily(data.settings.chatFont) }}>
          <header className="chat-header">
            <div className="chat-title">
              {data.settings.collapsed && (
                <button title="展开左栏" onClick={() => updateSettings({ collapsed: false })}>
                  <PanelLeftOpen size={18} />
                </button>
              )}
              <div>
                <h1>{book?.title || '对话'}</h1>
              </div>
            </div>
            <button className="agent-entry" disabled={!book} onClick={() => book && setAgentBook(book)}>
              agent.md
            </button>
            <button title="连接设置" className="model-badge" onClick={() => setSettingsOpen(true)}>
              <Sparkles size={13} />
              {models.find((m) => m.id === data.settings.model)?.name || '连接模型'}
            </button>
          </header>
          <ConversationScroll viewportRef={chatScroll}>
            {messages.map((m, index) => (
              <article key={m.id} className={'message ' + m.role}>
                <div className="message-heading">
                  <span className={'avatar ' + m.role}>
                    {m.role === 'user' ? '你' : <Sparkles size={14} />}
                  </span>
                  <strong>{m.role === 'user' ? '我的提问' : '阅读助手'}</strong>
                  <button
                    title="复制消息"
                    onClick={() => void window.reader.copyText(m.text).then(() => notify('已复制'))}
                  >
                    <Copy size={13} />
                  </button>
                </div>
                {m.role === 'user' &&
                  m.refs.map((r) => (
                    <button
                      className="message-quote"
                      key={r.id}
                      onClick={() => void reader.current?.jump(r).catch((e) => notify(errorText(e)))}
                    >
                      <span>
                        <Quote size={12} />
                        {r.title} · {r.label}
                      </span>
                      <p>{r.text.length > 350 ? r.text.slice(0, 350) + '…' : r.text}</p>
                    </button>
                  ))}
                <div className="markdown">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) =>
                      url.startsWith('source:') ? url : /^https?:/.test(url) ? url : ''
                    }
                    components={{
                      a: ({ href, children }) => {
                        const source = href?.startsWith('source:')
                          ? m.refs.find((r) => r.id === href.slice(7))
                          : undefined;
                        return source ? (
                          <button className="source-link" onClick={() => void reader.current?.jump(source)}>
                            {children} ↗
                          </button>
                        ) : (
                          <span>{children}</span>
                        );
                      },
                    }}
                  >
                    {m.text || (m.status === 'streaming' ? '正在思考…' : '')}
                  </Markdown>
                </div>
                {m.status !== 'complete' && (
                  <div className={'message-status ' + m.status}>
                    {m.status === 'streaming' ? (
                      <span className="typing">正在生成…</span>
                    ) : (
                      <>
                        {m.error || '生成已中断'}
                        {index === messages.length - 1 && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              const user = [...messages.slice(0, index)]
                                .reverse()
                                .find((x) => x.role === 'user');
                              if (user) void send(user.id);
                            }}
                          >
                            <RefreshCw size={12} />
                            重试
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </ConversationScroll>
          <div className="composer-area">
            {draft.refs.length > 0 && (
              <div className="draft-quotes">
                {draft.refs.map((r) => (
                  <div key={r.id} className="draft-quote">
                    <button className="quote-info" onClick={() => void reader.current?.jump(r)}>
                      <Quote size={13} />
                      <span>
                        {r.label} · {r.text.slice(0, 50)}
                        {r.text.length > 50 ? '…' : ''}
                      </span>
                    </button>
                    <button
                      title="移除引用"
                      onClick={() => editDraft({ ...draft, refs: draft.refs.filter((x) => x.id !== r.id) })}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="composer">
              <textarea
                ref={input}
                aria-label="聊天输入框"
                placeholder={book ? '粘贴原文，写下你的问题…' : '先导入一本 PDF 或 EPUB 书籍…'}
                disabled={!book || !session || session.bookId !== book.id}
                value={draft.text}
                onChange={(e) => editDraft({ ...draft, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <DetailControl
                  key={book?.id || 'empty'}
                  value={book?.detailLevel}
                  disabled={!book}
                  onChange={(level) => {
                    if (!book) return;
                    const id = book.id;
                    setData(
                      (previous) =>
                        previous && {
                          ...previous,
                          books: previous.books.map((item) =>
                            item.id === id ? { ...item, detailLevel: level } : item,
                          ),
                        },
                    );
                    void window.reader.bookDetail(id, level).catch((e) => {
                      notify(errorText(e));
                      void refresh();
                    });
                  }}
                />
                {busy ? (
                  <button
                    className="send-button stop"
                    title="停止生成"
                    onClick={() => void window.reader.cancel()}
                  >
                    <Square size={16} />
                  </button>
                ) : (
                  <button
                    title="发送问题"
                    className="send-button"
                    disabled={!book || preparing || (!draft.text.trim() && !draft.refs.length)}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
        <div className="splitter" onPointerDown={(e) => resize('chat', e)} />
        <div className="reading-column">
          {book ? (
            <Reader
              onConverted={async (converted) => {
                const state = await refresh();
                await selectBook(converted, state);
                notify('EPUB 已加入书库。可调整字号、复制原文，也可点击右上角导出 EPUB');
              }}
              key={book.id}
              ref={reader}
              book={book}
              settings={data.settings}
              updateSettings={updateSettings}
              onToc={setToc}
              onQuote={(r) => {
                editDraft({ ...draftRef.current, refs: [...draftRef.current.refs, r] });
                input.current?.focus();
              }}
              onInfo={setInfo}
              onError={notify}
            />
          ) : (
            <div className="reader-empty">
              <button className="primary" onClick={() => void importBooks()}>
                <Plus size={17} />
                导入第一本书
              </button>
            </div>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button title="关闭提示" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {settingsOpen && (
        <ConnectionDialog
          theme={data.settings.theme}
          chatFont={data.settings.chatFont || 'system'}
          onChatFont={(chatFont) => updateSettings({ chatFont })}
          smartSegments={!!data.settings.smartSegments}
          onSmartSegments={(smartSegments) => updateSettings({ smartSegments })}
          onTheme={(theme) => updateSettings({ theme })}
          status={data.connection}
          models={models}
          selected={data.settings.model || ''}
          onModel={(model) => updateSettings({ model })}
          onClose={() => setSettingsOpen(false)}
          onStatus={(status) => {
            updateSettings({ model: '' });
            setModels([]);
            setData((prev) => (prev ? { ...prev, connection: status } : prev));
            void loadModels();
          }}
          onRefresh={loadModels}
          notify={notify}
        />
      )}
      {agentBook && <AgentEditor book={agentBook} onClose={() => setAgentBook(null)} />}
      {archiveOpen && <ThoughtArchive onClose={() => setArchiveOpen(false)} />}
      {confirm && (
        <div className="modal-shade">
          <div role="dialog" aria-label="删除书籍" className="modal compact">
            <h2>从书库移除？</h2>
            <p>将删除《{confirm.title}》在应用中的副本、阅读进度和聊天记录。原始文件保留。</p>
            <div className="modal-actions">
              <button onClick={() => setConfirm(null)}>取消</button>
              <button
                className="danger"
                onClick={async () => {
                  try {
                    await window.reader.removeBook(confirm.id);
                    const state = await refresh();
                    if (active === confirm.id) {
                      setActive('');
                      setSid('');
                      activeRef.current = '';
                      sidRef.current = '';
                      draftRef.current = blank();
                      setMessages([]);
                      setDraft(blank());
                      if (state.books[0]) await selectBook(state.books[0], state);
                    }
                    setConfirm(null);
                  } catch (e) {
                    notify(errorText(e));
                  }
                }}
              >
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}
      {rename && (
        <div className="modal-shade">
          <form
            className="modal compact"
            onSubmit={async (e) => {
              e.preventDefault();
              await window.reader.renameSession(rename.id, newName);
              await refresh();
              setRename(null);
            }}
          >
            <h2>重命名对话</h2>
            <input
              autoFocus
              aria-label="会话名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setRename(null)}>
                取消
              </button>
              <button className="primary" disabled={!newName.trim()}>
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ConnectionDialog({
  chatFont,
  onChatFont,
  smartSegments,
  onSmartSegments,
  theme,
  onTheme,
  status,
  models,
  selected,
  onModel,
  onClose,
  onStatus,
  onRefresh,
  notify,
}: {
  chatFont: string;
  onChatFont: (font: string) => void;
  smartSegments: boolean;
  onSmartSegments: (enabled: boolean) => void;
  theme: Settings['theme'];
  onTheme: (theme: Settings['theme']) => void;
  status: ConnectionStatus;
  models: Model[];
  selected: string;
  onModel: (id: string) => void;
  onClose: () => void;
  onStatus: (s: ConnectionStatus) => void;
  onRefresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [pending, setPending] = useState(false),
    [key, setKey] = useState(''),
    [mode, setMode] = useState(status.mode),
    [connectionMessage, setConnectionMessage] = useState(status.loginMessage || '');
  useEffect(
    () =>
      window.reader.onConnection((next) => {
        setConnectionMessage(next.loginMessage || '');
      }),
    [],
  );
  const action = async (fn: () => Promise<ConnectionStatus>) => {
    setPending(true);
    try {
      onStatus(await fn());
    } catch (e) {
      setConnectionMessage(errorText(e));
      notify(errorText(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="modal-shade">
      <div className="modal" role="dialog" aria-label="连接与设置">
        <header>
          <div>
            <span className="eyebrow">模型连接</span>
            <h2>设置</h2>
          </div>
          <button
            title="关闭设置"
            onClick={() => {
              if (pending) void window.reader.cancelLogin();
              onClose();
            }}
          >
            <X size={20} />
          </button>
        </header>
        <div className="appearance-setting">
          <label htmlFor="app-theme">界面主题</label>
          <select id="app-theme" value={theme} onChange={(e) => onTheme(e.target.value as Settings['theme'])}>
            <option value="paper">纸色</option>
            <option value="white">明亮</option>
            <option value="night">夜间</option>
          </select>
        </div>
        <p className="muted">
          书籍保存在本地；发送问题或启用智能分段时，相关文字会传给你选择的模型。
        </p>
        <div className="setting-row">
          <label htmlFor="chat-font">聊天栏字体</label>
          <select id="chat-font" value={chatFont} onChange={event => onChatFont(event.target.value)}>
            {chatFonts.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
          </select>
        </div>
        <p style={{ fontFamily: chatFontFamily(chatFont), fontSize: 16, lineHeight: 1.8 }}>阅读让我们停下脚步，认真思考每一个问题。ABC 123</p>
        <p className="muted">只改变中间聊天栏；字体未安装时使用系统替代字体。</p>
        <label><input type="checkbox" checked={smartSegments} onChange={event => onSmartSegments(event.target.checked)} /> EPUB 自动智能分段</label>
        <p className="muted">开启后进入每个章节自动分析，使用当前模型额度；已有结果直接读取本地缓存。PDF 不参与分段。</p>
        <div className="mode-tabs">
          <button className={mode === 'chatgpt' ? 'active' : ''} onClick={() => setMode('chatgpt')}>
            ChatGPT 套餐
          </button>
          <button className={mode === 'api' ? 'active' : ''} onClick={() => setMode('api')}>
            DeepSeek API Key · 独立计费
          </button>
        </div>
        {mode === 'chatgpt' ? (
          <div className="connection-card">
            <h3>
              <Sparkles size={18} />
              使用你的 ChatGPT 账户
            </h3>
            <p>通过官方浏览器授权连接。可用模型与套餐用量以你的账户权限为准。</p>
            <div className="account-state">
              <span className={'status-dot ' + (status.planEnabled ? 'connected' : '')} />
              {status.signedIn ? status.email || '已登录账户' : '尚未登录'}
              {status.signedIn && <small>{status.planEnabled ? '套餐使用已授权' : '套餐使用未授权'}</small>}
            </div>
            <div className="connection-actions">
              <button
                className="primary"
                disabled={pending}
                onClick={() => void action(() => window.reader.login())}
              >
                {pending ? '等待浏览器授权…' : status.signedIn ? '重新授权 ChatGPT' : '使用 ChatGPT 登录'}
              </button>
              {pending && <button onClick={() => void window.reader.cancelLogin()}>取消登录</button>}
              {status.signedIn && (
                <>
                  <button
                    disabled={pending}
                    onClick={() => void action(() => window.reader.configure('chatgpt'))}
                  >
                    使用此连接
                  </button>
                  <button
                    disabled={pending}
                    title="退出 ChatGPT"
                    onClick={() => void action(() => window.reader.logout())}
                  >
                    <LogOut size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="connection-card">
            <h3>配置 DeepSeek API Key</h3>
            <p>DeepSeek API 使用单独计费，不包含在 ChatGPT 订阅内。不会自动切换计费方式。</p>
            <input
              aria-label="API Key"
              type="password"
              autoComplete="off"
              placeholder={
                status.hasKey ? '已有已加密保存的 Key；留空可继续使用' : '输入你的 DeepSeek API Key'
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="primary"
              disabled={pending || (!key.trim() && !status.hasKey)}
              onClick={() =>
                void action(async () => {
                  const result = await window.reader.configure('api', key || undefined);
                  setKey('');
                  return result;
                })
              }
            >
              保存并使用 API
            </button>
          </div>
        )}
        {connectionMessage && (
          <p role="status" className="connection-card">
            {connectionMessage}
          </p>
        )}
        <label className="model-select-label">
          当前模型
          <div>
            <select aria-label="当前模型" value={selected} onChange={(e) => onModel(e.target.value)}>
              <option value="">连接后选择可用模型</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button title="刷新模型" disabled={pending} onClick={() => void onRefresh()}>
              <RefreshCw size={16} />
            </button>
          </div>
        </label>
        <div className="settings-footer">
          <span>正在使用：{status.mode === 'api' ? 'DeepSeek · 独立计费' : 'ChatGPT 套餐'}</span>
          <button onClick={() => void window.reader.openUsage()}>
            <ExternalLink size={14} />
            管理用量与连接
          </button>
        </div>
      </div>
    </div>
  );
}
