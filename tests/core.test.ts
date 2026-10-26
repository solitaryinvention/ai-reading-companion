import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { events } from '../electron/stream';
import { wireText } from '../electron/chat';
import type { Book, Message } from '../src/types';
vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));
describe('persistent library', () => {
  it('isolates books, restores drafts and interrupts unfinished answers', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reader-test-'));
    try {
      const store = await Store.open(dir);
      const book = (id: string): Book => ({
        id,
        title: id,
        format: 'pdf',
        addedAt: '2026',
        lastRead: '2026',
      });
      store.put('book', 'a', book('a'));
      store.put('book', 'b', book('b'));
      const a = store.createSession('a'),
        b = store.createSession('b');
      store.put('session', a.id, { ...a, draft: { text: '尚未发送', refs: [], attach: false } });
      const message: Message = {
        id: 'm',
        sessionId: a.id,
        role: 'assistant',
        text: '一部分回答',
        refs: [],
        status: 'streaming',
        createdAt: '2026',
      };
      store.put('message', message.id, message);
      expect(store.messages(b.id)).toHaveLength(0);
      const restored = await Store.open(dir);
      expect(restored.session(a.id).draft.text).toBe('尚未发送');
      expect(restored.messages(a.id)[0].status).toBe('cancelled');
      restored.deleteBook('a');
      expect(restored.get('book', 'a')).toBeUndefined();
      expect(restored.session(b.id).bookId).toBe('b');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('Responses streaming', () => {
  it('decodes split unicode, CRLF and a late failure', async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"response.output_text.delta","delta":"中文"}\r\n\r\ndata: {"type":"response.failed","code":"limit"}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const results = [];
    for await (const e of events(stream)) results.push(e);
    expect(results).toEqual([
      { type: 'response.output_text.delta', delta: '中文' },
      { type: 'response.failed', code: 'limit' },
    ]);
  });
  it('keeps source ids separate from user text', () => {
    expect(
      wireText('解释', [{ id: 'ref-1', bookId: 'a', title: '书', label: '第 2 页', text: '原文', page: 2 }]),
    ).toContain('source_id="ref-1"');
  });
});
