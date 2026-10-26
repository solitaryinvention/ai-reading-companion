import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { Chat } from '../electron/chat';
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
      const payload = JSON.parse(request.mock.calls[0][1].body);
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
