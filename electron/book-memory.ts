import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { BookAgent, Thought, Message, Book } from '../src/types';
import type { Store } from './store';
import { DEFAULT_AGENT } from './default-agent';
import { LEGACY_DEFAULT_AGENT } from './legacy-default-agent';
import { PREVIOUS_DEFAULT_AGENT } from './previous-default-agent';
import { DEFAULT_AGENT_055 } from './default-agent-055';

const bounded = (value: unknown, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export const MEMORY_TAG = '<reader_memory>';
/** Hold incomplete delimiter prefixes so metadata never flashes into the conversation. */
export function visibleReply(raw: string, final = false) {
  const start = raw.indexOf(MEMORY_TAG);
  if (start >= 0) return raw.slice(0, start).trimEnd();
  if (!final)
    for (let n = MEMORY_TAG.length - 1; n > 0; n--)
      if (raw.endsWith(MEMORY_TAG.slice(0, n))) return raw.slice(0, -n);
  return raw;
}
export class BookMemory {
  constructor(private store: Store) {}
  private file(bookId: string, name: string) {
    this.store.book(bookId);
    if (!/^[\w-]{1,128}$/.test(bookId)) throw new Error('无效书籍标识');
    const dir = path.join(this.store.directory, 'book-agents', bookId);
    mkdirSync(dir, { recursive: true });
    return path.join(dir, name);
  }
  private write(file: string, text: string) {
    writeFileSync(file + '.tmp', text, 'utf8');
    renameSync(file + '.tmp', file);
  }
  profile(bookId: string): BookAgent {
    const file = this.file(bookId, 'agent.md');
    if (!existsSync(file)) this.write(file, DEFAULT_AGENT);
    const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    // Migrate only the exact known template, never a user's edited profile.
    if (
      [LEGACY_DEFAULT_AGENT, PREVIOUS_DEFAULT_AGENT, DEFAULT_AGENT_055].some(
        (template) => normalize(readFileSync(file, 'utf8')) === normalize(template),
      )
    )
      this.write(file, DEFAULT_AGENT);
    return {
      text: readFileSync(file, 'utf8'),
      defaultText: DEFAULT_AGENT,
      progress: this.store.get<{ text: string }>('book-progress', bookId)?.text || '',
      path: file,
    };
  }
  saveAgent(bookId: string, text: string) {
    if (typeof text !== 'string' || text.length > 30000) throw new Error('提示词最多 30,000 字符');
    this.write(this.file(bookId, 'agent.md'), text);
    return this.profile(bookId);
  }
  saveProgress(bookId: string, text: string) {
    if (typeof text !== 'string' || text.length > 12000) throw new Error('授课进度最多 12,000 字符');
    this.write(this.file(bookId, 'progress.md'), text);
    this.store.put('book-progress', bookId, { text, updatedAt: new Date().toISOString() });
    return this.profile(bookId);
  }
  archive() {
    const dir = path.join(this.store.directory, 'thought-archive');
    mkdirSync(dir, { recursive: true });
    const entries = this.store
      .list<Thought>('thought')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const file = path.join(dir, '思想档案.md');
    const content =
      '# 长期思想档案\n\n用户原话与 AI 整理分开保存。自动摘录仅表示发现了独立观点，不是原创性或正确性的认证。\n\n' +
      entries
        .map(
          (t) =>
            `## ${t.title}\n\n编号：${t.id}\n来源：${t.bookTitle || '手动记录'} · ${t.location || '位置未确认'}\n\n### 用户原话\n\n${t.originalText}\n\n### 整理与后续补充\n\n${[
              ['论证过程', t.reasoning],
              ['支持理由', t.support],
              ['反例与未解决问题', t.questions],
              ['后续修正', t.revision],
              ['思想联系', t.connections],
              ['创作用途', t.uses],
            ]
              .filter((x) => x[1])
              .map(([k, v]) => `**${k}**\n\n${v}`)
              .join('\n\n')}\n`,
        )
        .join('\n---\n\n');
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) this.write(file, content);
    return { entries, path: file };
  }
  saveThought(input: Partial<Thought>) {
    const previous = input.id ? this.store.get<Thought>('thought', input.id) : undefined;
    if (input.id && !previous) throw new Error('思想条目不存在，请刷新档案');
    if (!input.title?.trim() || !input.originalText?.trim()) throw new Error('请填写标题与用户原话');
    if (input.title.length > 200 || input.originalText.length > 20000) throw new Error('标题或原话过长');
    const now = new Date().toISOString();
    const thought: Thought = {
      id: previous?.id || randomUUID(),
      title: bounded(input.title, 200),
      originalText: bounded(input.originalText, 20000),
      bookId: previous?.bookId,
      bookTitle: bounded(input.bookTitle, 300),
      location: bounded(input.location, 500),
      sessionId: previous?.sessionId,
      messageId: previous?.messageId,
      reasoning: bounded(input.reasoning),
      support: bounded(input.support),
      questions: bounded(input.questions),
      revision: bounded(input.revision),
      connections: bounded(input.connections),
      uses: bounded(input.uses),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      origin: previous?.origin || 'manual',
    };
    if (previous?.origin === 'conversation') {
      thought.originalText = previous.originalText;
      thought.bookTitle = previous.bookTitle;
      thought.location = previous.location;
    }
    this.store.put('thought', thought.id, thought);
    this.archive();
    return thought;
  }
  removeThought(id: string) {
    this.store.remove('thought', id);
    this.archive();
  }
  removeProfile(bookId: string) {
    const file = this.file(bookId, 'agent.md');
    for (const name of ['agent.md', 'progress.md']) {
      const target = path.join(path.dirname(file), name);
      if (existsSync(target)) unlinkSync(target);
    }
    try {
      rmdirSync(path.dirname(file));
    } catch {
      /* Keep any user-added supporting files. */
    }
  }
  commit(raw: string, user: Message, book: Book, location: string, previousProgress: string) {
    const index = raw.indexOf(MEMORY_TAG);
    if (index < 0)
      return { count: 0, warning: '回答已保存，但模型未返回思想档案或进度更新；可在软件内手动补记' };
    const end = raw.indexOf('</reader_memory>', index);
    if (end < 0 || end - index > 30000)
      return { count: 0, warning: '回答已保存，思想档案未更新：附加数据不完整' };
    let data: any;
    try {
      const json = raw
        .slice(index + MEMORY_TAG.length, end)
        .trim()
        .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
      data = JSON.parse(json);
    } catch {
      return { count: 0, warning: '回答已保存，思想档案未更新：附加数据无法解析' };
    }
    if (!data || typeof data !== 'object') return { count: 0 };
    let count = 0;
    if (Array.isArray(data.thoughts))
      for (const entry of data.thoughts.slice(0, 3)) {
        const quote = bounded(entry?.originalText, 20000);
        const title = bounded(entry?.title, 200);
        // Model-generated claims cannot create a user-origin record without a literal current-user quote.
        if (!title || quote.length < 4 || !user.text.includes(quote)) continue;
        if (user.refs.some((ref) => ref.text.includes(quote))) continue;
        const id = createHash('sha256')
          .update(book.id + '\n' + quote)
          .digest('hex');
        if (this.store.get('thought', id)) continue;
        const now = new Date().toISOString();
        const thought: Thought = {
          id,
          title,
          originalText: quote,
          bookId: book.id,
          bookTitle: book.title,
          location,
          sessionId: user.sessionId,
          messageId: user.id,
          reasoning: bounded(entry.reasoning),
          support: bounded(entry.support),
          questions: bounded(entry.questions),
          revision: bounded(entry.revision),
          connections: bounded(entry.connections),
          uses: bounded(entry.uses),
          createdAt: now,
          updatedAt: now,
          origin: 'conversation',
        };
        this.store.put('thought', id, thought);
        count++;
      }
    if (count) this.archive();
    if (
      typeof data.progress === 'string' &&
      data.progress.trim() &&
      this.profile(book.id).progress === previousProgress
    )
      this.saveProgress(book.id, data.progress.slice(0, 12000));
    return { count };
  }
}

export const MEMORY_INSTRUCTIONS = `
在正常回答末尾追加一个 <reader_memory>JSON</reader_memory> 数据块，用户界面会隐藏它。JSON 结构：{"thoughts":[{"title":"观点标题","originalText":"本次用户输入中的逐字原话","reasoning":"论证过程","support":"支持理由","questions":"反例与待解问题","revision":"后续修正","connections":"思想联系","uses":"创作用途"}],"progress":"本书授课进度的简短完整更新"}。
仅在本次用户确实提出自己的独立思想、质疑或假设时记录，最多3条；普通提问、复述原著、引用文字、你提出的观点一律不记，thoughts 可为空。originalText 必须逐字来自本次用户自己写的话，绝不能来自 book_excerpt。没有可靠信息的字段留空，不编造出处或推断用户已经掌握概念。progress 只记录本会话可确认的已讲解内容、当前位置、核心概念、待解问题和讨论成果；未知写明未知，保留之前尚未解决的问题。仅已成功完成的回答才会入档；其他书籍完整聊天不在本会话中共享。
档案整理字段尽量各用一两句，不为凑齐字段推断用户没说过的论证、修正或创作用途；回答正文仍需完整讲解，不受档案简洁要求限制。
`;
