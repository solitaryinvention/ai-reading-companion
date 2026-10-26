import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Book, BookAgent, Thought } from './types';
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AgentEditor({ book, onClose }: { book: Book; onClose: () => void }) {
  const [profile, setProfile] = useState<BookAgent | null>(null),
    [text, setText] = useState(''),
    [progress, setProgress] = useState(''),
    [tab, setTab] = useState<'agent' | 'progress'>('agent'),
    [message, setMessage] = useState(''),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let gone = false;
    void window.reader
      .bookAgent(book.id)
      .then((p) => {
        if (!gone) {
          setProfile(p);
          setText(p.text);
          setProgress(p.progress);
        }
      })
      .catch((e) => setMessage(errorText(e)));
    return () => {
      gone = true;
    };
  }, [book.id]);
  const save = async () => {
    setSaving(true);
    try {
      const p =
        tab === 'agent'
          ? await window.reader.saveBookAgent(book.id, text)
          : await window.reader.saveBookProgress(book.id, progress);
      setProfile(p);
      setMessage('已保存，从下一次发送起生效');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-shade">
      <div className="modal knowledge-modal" role="dialog" aria-label="本书 agent.md">
        <header>
          <div>
            <h2>本书 agent.md</h2>
            <small>{book.title}</small>
          </div>
          <button aria-label="关闭本书设置" disabled={saving} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="mode-tabs">
          <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>
            阅读提示词
          </button>
          <button className={tab === 'progress' ? 'active' : ''} onClick={() => setTab('progress')}>
            授课进度
          </button>
        </div>
        <p className="muted">
          {tab === 'agent'
            ? '默认使用你的私人读书助手提示词，可单独修改这一本书。修改不影响其他书籍。'
            : '仅记录已确认的讲解与讨论，不代表已经读完或理解。可手动修正；成功回答后由 AI 更新。'}
        </p>
        <textarea
          aria-label={tab === 'agent' ? '本书提示词' : '本书授课进度'}
          disabled={!profile || saving}
          value={tab === 'agent' ? text : progress}
          maxLength={tab === 'agent' ? 30000 : 12000}
          onChange={(e) => (tab === 'agent' ? setText(e.target.value) : setProgress(e.target.value))}
          spellCheck={false}
        />
        <small className="file-location" title={profile?.path}>
          {profile?.path}
        </small>
        <footer>
          <span role="status">{message}</span>
          {tab === 'agent' && (
            <button
              disabled={!profile || saving}
              onClick={() => {
                setText(profile!.defaultText);
                setMessage('已载入默认提示词，点击保存后生效');
              }}
            >
              恢复默认提示词
            </button>
          )}
          <button className="primary" disabled={!profile || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const fields: [keyof Thought, string][] = [
  ['title', '观点标题'],
  ['originalText', '用户原话'],
  ['bookTitle', '来源书籍'],
  ['location', '章节或位置'],
  ['reasoning', '论证过程（整理）'],
  ['support', '支持理由（整理）'],
  ['questions', '反例与未解决问题（整理）'],
  ['revision', '后续修正'],
  ['connections', '思想联系（整理）'],
  ['uses', '创作用途（整理）'],
];
export function ThoughtArchive({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Thought[]>([]),
    [file, setFile] = useState(''),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState<Partial<Thought> | null>(null),
    [message, setMessage] = useState(''),
    [saving, setSaving] = useState(false),
    [deleting, setDeleting] = useState(false);
  const refresh = async () => {
    const data = await window.reader.thoughts();
    setEntries(data.entries);
    setFile(data.path);
    return data;
  };
  useEffect(() => {
    void refresh().catch((e) => setMessage(errorText(e)));
  }, []);
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const saved = await window.reader.saveThought(editing);
      await refresh();
      setEditing(saved);
      setMessage('已保存');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-shade">
      <div className="modal knowledge-modal thought-modal" role="dialog" aria-label="长期思想档案">
        <header>
          <div>
            <h2>长期思想档案</h2>
            <small>跨书保存你的观点与假设；用户原话与 AI 整理分开记录。</small>
          </div>
          <button aria-label="关闭思想档案" disabled={saving} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="thought-workspace">
          <aside>
            <input
              aria-label="搜索思想档案"
              placeholder="搜索观点或原话"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => {
                setEditing({ title: '', originalText: '', bookTitle: '', location: '' });
                setDeleting(false);
                setMessage('');
              }}
            >
              新建思想
            </button>
            <button onClick={() => void refresh().catch((e) => setMessage(errorText(e)))}>刷新档案</button>
            <div className="thought-items">
              {entries
                .filter((t) =>
                  (t.title + ' ' + t.originalText + ' ' + t.bookTitle)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((t) => (
                  <button
                    className={editing?.id === t.id ? 'active' : ''}
                    key={t.id}
                    onClick={() => {
                      setEditing(t);
                      setDeleting(false);
                      setMessage('');
                    }}
                  >
                    <strong>{t.title}</strong>
                    <small>
                      {t.bookTitle ? t.bookTitle + ' · ' : ''}
                      {t.origin === 'conversation' ? '自动摘录' : '手动记录'}
                    </small>
                  </button>
                ))}
              {!entries.length && (
                <p className="muted">暂无记录。阅读讨论中的独立观点可自动摘录，也可手动添加。</p>
              )}
            </div>
          </aside>
          <section className="thought-editor">
            {editing ? (
              <>
                <p className="muted">
                  {editing.origin === 'conversation'
                    ? '原话逐字来自用户消息。其余字段是 AI 整理，需自行核对；不代表已认证原创性或正确性。'
                    : '记录你自己的观点；尚未明确的理由或用途可以留空。'}
                </p>
                {fields.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      aria-label={label}
                      value={String(editing[key] || '')}
                      readOnly={
                        editing.origin === 'conversation' &&
                        ['originalText', 'bookTitle', 'location'].includes(key)
                      }
                      maxLength={key === 'originalText' ? 20000 : key === 'title' ? 200 : 4000}
                      onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <div className="thought-actions">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    保存思想
                  </button>
                  {editing.id && (
                    <button disabled={saving} onClick={() => setDeleting(true)}>
                      删除思想
                    </button>
                  )}
                  {deleting && (
                    <>
                      <button
                        disabled={saving}
                        onClick={() =>
                          void window.reader
                            .removeThought(editing.id!)
                            .then(async () => {
                              await refresh();
                              setEditing(null);
                              setDeleting(false);
                              setMessage('已删除');
                            })
                            .catch((e) => setMessage(errorText(e)))
                        }
                      >
                        确认删除思想
                      </button>
                      <button onClick={() => setDeleting(false)}>取消</button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">选择一条思想查看详情，或新建记录。</p>
            )}
          </section>
        </div>
        <footer>
          <span role="status">{message}</span>
          <small className="file-location" title={file}>
            {file}
          </small>
          <button onClick={() => void window.reader.copyText(file)}>复制档案路径</button>
        </footer>
      </div>
    </div>
  );
}
