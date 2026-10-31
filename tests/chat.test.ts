import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { Chat } from '../electron/chat';
import { BookMemory } from '../electron/book-memory';
import { TEACHING_INSTRUCTIONS } from '../electron/teaching';
import type { ChatEvent } from '../src/types';
vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));
async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reader-chat-'));
  const store = await Store.open(dir);
  store.put('book', 'b', { id: 'b', title: 'Book', format: 'pdf' });
  const session = store.createSession('b');
  return { dir, store, session };
}
const response = (events: unknown[]) =>
  new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
describe('chat lifecycle', () => {
  it.each(['chatgpt', 'api'])(
    'applies shared teaching rules to existing book agents at every detail level (%s)',
    async (mode) => {
      const { dir, store, session } = await setup();
      const memory = new BookMemory(store);
      const original = '本书自定义：平静叙述，按章节顺序讲解。CUSTOM_AGENT_UNCHANGED';
      memory.saveAgent('b', original);
      memory.saveProgress('b', '已讲过第一章；用户理解程度尚未确认。');
      const profile = memory.profile('b');
      const before = readFileSync(profile.path);
      const emitted: ChatEvent[] = [];
      const payloads: any[] = [];
      const request = vi.fn(async (_url: string, init: RequestInit) => {
        payloads.push(JSON.parse(init.body as string));
        return mode === 'api'
          ? response([{ choices: [{ delta: { content: '测试回答' }, finish_reason: 'stop' }] }])
          : response([
              { type: 'response.output_text.delta', delta: '测试回答' },
              { type: 'response.completed' },
            ]);
      });
      const chat = new Chat(
        store,
        { request, status: () => ({ mode }), credential: async () => 'fixture' } as any,
        (event) => emitted.push(event),
        memory,
      );
      try {
        for (const level of [1, 2, 3, 4, 5] as const) {
          await chat.send({
            requestId: 'teach-' + level,
            sessionId: session.id,
            model: 'fixture',
            text: level === 5 ? '这次请分析作者的写作结构' : '请直接讲清这段内容',
            refs: [],
            detailLevel: level,
          });
          await vi.waitFor(() => expect(emitted.filter((e) => e.type === 'complete')).toHaveLength(level));
          const body = payloads[level - 1];
          const instructions = mode === 'api' ? body.messages[0].content : body.instructions;
          expect(instructions).toContain(TEACHING_INSTRUCTIONS);
          expect(instructions).toContain('不先总结全文');
          expect(instructions).toContain('在这段叙述中');
          expect(instructions).toContain('题辞的首字母组成 RICERCAR');
          expect(instructions).toContain('叙事内容：把事情讲下来');
          expect(instructions).toContain('理论内容：让问题、例子与概念逐步相连');
          expect(instructions).toContain('混合内容：在需要处自然切换');
          expect(instructions).toContain('概念可以随例子自然展开');
          expect(instructions).not.toContain('每一档都先讲清实际内容');
          expect(instructions).toContain(original);
          expect(instructions).toContain(`${level}/5`);
          expect(instructions).toContain('不是正文');
          expect(instructions).toContain('引用');
          const messages = mode === 'api' ? body.messages.slice(1) : body.input;
          expect(messages.at(-1).content).toBe(
            level === 5 ? '这次请分析作者的写作结构' : '请直接讲清这段内容',
          );
        }
        expect(readFileSync(profile.path)).toEqual(before);
        expect(memory.profile('b').progress).toBe(profile.progress);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  it.each(['chatgpt', 'api'])(
    'sends full context above 100k without duplicating assistant source metadata (%s)',
    async (mode) => {
      const { dir, store, session } = await setup();
      const emitted: ChatEvent[] = [];
      const original = '原文'.repeat(60000);
      const ref = { id: 'source', bookId: 'b', title: 'Book', label: '第 1 页', text: original };
      store.put('message', 'old-user', {
        id: 'old-user',
        sessionId: session.id,
        role: 'user',
        text: '上次问题',
        refs: [ref],
        status: 'complete',
        createdAt: '2026-01-01T00:00:00Z',
      });
      store.put('message', 'old-answer', {
        id: 'old-answer',
        sessionId: session.id,
        role: 'assistant',
        text: '既有回答',
        refs: [ref],
        status: 'complete',
        createdAt: '2026-01-01T00:00:01Z',
      });
      const request = vi.fn(async (_url: string, _init: RequestInit) =>
        mode === 'api'
          ? response([{ choices: [{ delta: { content: '回答' }, finish_reason: 'stop' }] }])
          : response([{ type: 'response.output_text.delta', delta: '回答' }, { type: 'response.completed' }]),
      );
      const chat = new Chat(
        store,
        { request, status: () => ({ mode }), credential: async () => 'fixture' } as any,
        (e) => emitted.push(e),
      );
      try {
        await chat.send({
          requestId: 'large',
          sessionId: session.id,
          model: 'fixture',
          text: '继续讲解',
          refs: [],
          chapter: { ...ref, id: 'chapter', text: '本次原文'.repeat(30000) },
        });
        await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('complete'));
        const payload = JSON.parse(request.mock.calls[0][1].body as string);
        const history = mode === 'api' ? payload.messages.slice(1) : payload.input;
        expect(history[0].content).toContain(original);
        expect(history[1].content).toBe('既有回答');
        expect(history[2].content).toContain('本次原文'.repeat(30000));
        expect(history[2].content).toContain('继续讲解');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  it('preserves a large question and references when the server rejects context, and retries without duplication', async () => {
    const { dir, store, session } = await setup();
    const emitted: ChatEvent[] = [];
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'context_length_exceeded', message: 'Context exceeds this model window' } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        response([{ type: 'response.output_text.delta', delta: '回答' }, { type: 'response.completed' }]),
      );
    const chat = new Chat(store, { request, credential: async () => 'fixture' } as any, (e) =>
      emitted.push(e),
    );
    try {
      const text = '问题'.repeat(55000);
      await chat.send({
        requestId: 'reject',
        sessionId: session.id,
        model: 'fixture',
        text,
        refs: [{ id: 'r', bookId: 'b', title: 'Book', label: '第 1 页', text: '原文' }],
      });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('failed'));
      expect(emitted.at(-1)?.error).toContain('Context exceeds this model window');
      const user = store.messages(session.id)[0];
      expect(user.text).toBe(text);
      expect(user.refs[0].text).toBe('原文');
      await chat.send({
        requestId: 'retry-large',
        sessionId: session.id,
        model: 'fixture',
        text: '',
        refs: [],
        retryId: user.id,
      });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('complete'));
      expect(store.messages(session.id).filter((m) => m.role === 'user')).toHaveLength(1);
      expect(JSON.parse(request.mock.calls[1][1].body).input[0].content).toContain(text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('isolates model history by book and resumes its own context', async () => {
    const { dir, store, session } = await setup();
    store.put('book', 'other', { id: 'other', title: 'Other Book', format: 'epub' });
    const other = store.createSession('other');
    const requests: any[] = [];
    const emitted: ChatEvent[] = [];
    const request = vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return response([
        { type: 'response.output_text.delta', delta: '回答' },
        { type: 'response.completed' },
      ]);
    });
    const chat = new Chat(store, { request, credential: async () => 'fixture' } as any, (e) =>
      emitted.push(e),
    );
    try {
      for (const [i, s, text] of [
        [0, session, 'A_ONLY_CONTEXT'],
        [1, other, 'B_ONLY_CONTEXT'],
        [2, session, 'A_FOLLOW_UP'],
      ] as const) {
        await chat.send({ requestId: String(i), sessionId: s.id, model: 'fixture', text, refs: [] });
        await vi.waitFor(() => expect(emitted.filter((e) => e.type === 'complete')).toHaveLength(i + 1));
      }
      expect(JSON.stringify(requests[1])).not.toContain('A_ONLY_CONTEXT');
      expect(requests[1].instructions).toContain('Other Book');
      expect(JSON.stringify(requests[2])).toContain('A_ONLY_CONTEXT');
      expect(JSON.stringify(requests[2])).not.toContain('B_ONLY_CONTEXT');
      expect(store.messages(other.id).filter((m) => m.role === 'user')).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('uses DeepSeek Chat Completions and preserves incomplete replies for retry', async () => {
    const { dir, store, session } = await setup();
    const emitted: ChatEvent[] = [];
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        response([{ choices: [{ delta: { content: '部分' }, finish_reason: 'length' }] }]),
      )
      .mockResolvedValueOnce(
        response([
          { choices: [{ delta: { reasoning_content: '内部思考' }, finish_reason: null }] },
          { choices: [{ delta: { content: '解释' }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ]),
      );
    const chat = new Chat(
      store,
      { request, status: () => ({ mode: 'api' }), credential: async () => 'deepseek-fixture' } as any,
      (e) => emitted.push(e),
    );
    try {
      await chat.send({
        requestId: 'ds1',
        sessionId: session.id,
        model: 'fixture-model',
        text: '原文问题',
        detailLevel: 5,
        refs: [],
      });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('failed'));
      expect(store.messages(session.id)[1].text).toBe('部分');
      const user = store.messages(session.id)[0];
      expect(user.detailLevel).toBe(5);
      store.put('book', 'b', { ...store.book('b'), detailLevel: 1 });
      await chat.send({
        requestId: 'ds2',
        sessionId: session.id,
        model: 'fixture-model',
        text: '',
        refs: [],
        retryId: user.id,
      });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('complete'));
      expect(store.messages(session.id)).toHaveLength(2);
      expect(store.messages(session.id)[1].text).toBe('解释');
      expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
      const payload = JSON.parse(request.mock.calls[0][1].body as string);
      expect(payload.messages[0].role).toBe('system');
      expect(payload.messages[1].content).toBe('原文问题');
      expect(payload.input).toBeUndefined();
      expect(payload.messages[0].content).toContain('5/5（深入）');
      expect(JSON.parse(request.mock.calls[1][1].body).messages[0].content).toContain('5/5（深入）');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('retains partial answers after late failures; retry does not duplicate user message', async () => {
    const { dir, store, session } = await setup();
    const emitted: ChatEvent[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response([
          { type: 'response.output_text.delta', delta: '部分回答' },
          {
            type: 'response.failed',
            response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        response([{ type: 'response.output_text.delta', delta: '完整回答' }, { type: 'response.completed' }]),
      );
    vi.stubGlobal('fetch', fetch);
    const connection = { credential: async () => 'test-token' } as any;
    const chat = new Chat(store, connection, (e) => emitted.push(e));
    try {
      await chat.send({ requestId: 'r1', sessionId: session.id, model: 'test', text: '解释', refs: [] });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('failed'));
      expect(store.messages(session.id)[1].text).toBe('部分回答');
      const user = store.messages(session.id)[0];
      await chat.send({
        requestId: 'r2',
        sessionId: session.id,
        model: 'test',
        text: '',
        refs: [],
        retryId: user.id,
      });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('complete'));
      expect(store.messages(session.id)).toHaveLength(2);
      expect(store.messages(session.id)[0].id).toBe(user.id);
      expect(store.messages(session.id)[1].text).toBe('完整回答');
      const payload = JSON.parse(fetch.mock.calls[0][1].body);
      expect(payload.store).toBe(false);
      expect(payload.stream).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('refuses cross-book references before sending any network request', async () => {
    const { dir, store, session } = await setup();
    const emitted: ChatEvent[] = [];
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const chat = new Chat(store, {} as any, (e) => emitted.push(e));
    try {
      await chat.send({
        requestId: 'r',
        sessionId: session.id,
        model: 'test',
        text: '解释',
        refs: [{ id: 'r', bookId: 'other', title: 'Other', label: 'p1', text: 'text' }],
      });
      await vi.waitFor(() => expect(emitted.at(-1)?.type).toBe('failed'));
      expect(fetch).not.toHaveBeenCalled();
      expect(store.messages(session.id)).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('marks an aborted request as cancelled and preserves the question', async () => {
    const { dir, store, session } = await setup();
    const emitted: ChatEvent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
          ),
      ),
    );
    const chat = new Chat(store, { credential: async () => 'test' } as any, (e) => emitted.push(e));
    try {
      await chat.send({ requestId: 'r', sessionId: session.id, model: 'test', text: '保留问题', refs: [] });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await chat.cancel();
      expect(emitted.at(-1)?.type).toBe('cancelled');
      expect(store.messages(session.id)[0].text).toBe('保留问题');
      expect(store.messages(session.id)[1].status).toBe('cancelled');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
