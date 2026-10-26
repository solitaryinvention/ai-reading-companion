import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { BookMemory, visibleReply } from '../electron/book-memory';
import { Chat } from '../electron/chat';
import type { Message, ChatEvent } from '../src/types';
vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));
async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reader-memory-'));
  const store = await Store.open(dir);
  store.put('book', 'a', { id: 'a', title: '书 A', format: 'epub' });
  store.put('book', 'b', { id: 'b', title: '书 B', format: 'pdf' });
  return { dir, store, memory: new BookMemory(store) };
}
describe('book agents and independent thought archive', () => {
  it('isolates editable agents and progress; preserves shared archive after removing a book', async () => {
    const { dir, store, memory } = await setup();
    try {
      const initial = memory.profile('a');
      expect(initial.text).toContain('不得把智能体自己的观点');
      memory.saveAgent('a', 'A 专属提示词');
      memory.saveProgress('a', '第一章已讲解，概念仍需确认');
      expect(memory.profile('b').text).toBe(initial.defaultText);
      expect(memory.profile('b').progress).toBe('');
      const t = memory.saveThought({
        title: '个人假设',
        originalText: '我认为有些价值来自尚未实现的选择。',
        reasoning: '需要进一步讨论',
      });
      const reopened = new BookMemory(await Store.open(dir));
      expect(reopened.profile('a').text).toBe('A 专属提示词');
      expect(reopened.archive().entries[0].id).toBe(t.id);
      memory.removeProfile('a');
      store.deleteBook('a');
      expect(memory.archive().entries).toHaveLength(1);
      expect(readFileSync(memory.archive().path, 'utf8')).toContain('个人假设');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('archives only literal user statements, rejects model/book quotes and protects provenance', async () => {
    const { dir, store, memory } = await setup();
    try {
      const book = store.book('a');
      const user: Message = {
        id: 'm',
        sessionId: 's',
        role: 'user',
        text: '我的假设是制度会改变人们能够想象的未来。',
        refs: [
          {
            id: 'r',
            bookId: 'a',
            title: '书 A',
            label: '第一章',
            text: '这是作者在书中提出的一条原文观点。',
          },
        ],
        status: 'complete',
        createdAt: '',
      };
      const raw =
        '<reader_memory>' +
        JSON.stringify({
          thoughts: [
            { title: '制度与想象', originalText: user.text, questions: '需要检验因果方向' },
            { title: 'AI 冒充', originalText: '这是模型自己新提出的一条原创思想。' },
            { title: '书中观点', originalText: user.refs[0].text },
          ],
          progress: '已讨论制度与想象，原著尚未提供',
        }) +
        '</reader_memory>';
      expect(memory.commit(raw, user, book, '第一章', '').count).toBe(1);
      expect(memory.commit(raw, user, book, '第一章', '').count).toBe(0);
      const thought = memory.archive().entries[0];
      memory.saveThought({ ...thought, originalText: '改写原话', revision: '后来我修改了观点' });
      expect(memory.archive().entries[0].originalText).toBe(user.text);
      expect(memory.profile('a').progress).toContain('原著尚未提供');
      expect(visibleReply('正常回答<reader_mem')).toBe('正常回答');
      expect(visibleReply('正常回答' + raw)).toBe('正常回答');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each(['api', 'chatgpt'])('injects per-book agent and hides memory metadata for %s', async (mode) => {
    const { dir, store, memory } = await setup();
    try {
      memory.saveAgent('a', 'A_ONLY_AGENT');
      memory.saveAgent('b', 'B_ONLY_AGENT');
      const session = store.createSession('a');
      const emitted: ChatEvent[] = [];
      let payload: any;
      const quote = '我提出的假设是技术会改变群体协作的边界。';
      const raw =
        '这是对该假设的分析。<reader_memory>' +
        JSON.stringify({
          thoughts: [{ title: '技术与协作', originalText: quote }],
          progress: '讨论假设，未讲解书中章节',
        }) +
        '</reader_memory>';
      const request = vi.fn(async (_url, init) => {
        payload = JSON.parse(init.body);
        if (mode === 'chatgpt')
          return new Response(
            'data: ' +
              JSON.stringify({ type: 'response.output_text.delta', delta: raw }) +
              '\n\ndata: ' +
              JSON.stringify({ type: 'response.completed' }) +
              '\n\n',
          );
        return new Response(
          ['这是对该假设的分析。<reader_me', raw.slice('这是对该假设的分析。<reader_me'.length)]
            .map(
              (delta) =>
                'data: ' +
                JSON.stringify({ choices: [{ delta: { content: delta }, finish_reason: null }] }) +
                '\n\n',
            )
            .join('') +
            'data: ' +
            JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
            '\n\n',
        );
      });
      const chat = new Chat(
        store,
        { request, status: () => ({ mode }), credential: async () => 'fixture' } as any,
        (e) => emitted.push(e),
        memory,
      );
      await chat.send({ requestId: 'r', sessionId: session.id, model: 'fixture', text: quote, refs: [] });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('complete'));
      expect(JSON.stringify(payload)).toContain('A_ONLY_AGENT');
      expect(JSON.stringify(payload)).not.toContain('B_ONLY_AGENT');
      expect(store.messages(session.id)[1].text).toBe('这是对该假设的分析。');
      expect(
        emitted
          .filter((e) => e.type === 'delta')
          .map((e) => e.text)
          .join(''),
      ).not.toContain('reader_memory');
      expect(memory.archive().entries).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
