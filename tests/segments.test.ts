import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { segmentChapter, validateEnds } from '../electron/segments';
vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));
describe('EPUB semantic segmentation', () => {
  it('rejects missing, duplicated, unordered and out-of-range boundaries', () => {
    for (const value of [[], [1], [2, 2], [3, 2], [0, 2], ['2'], [1.5, 2]])
      expect(() => validateEnds(value, 2)).toThrow();
    expect(validateEnds([1, 2], 2)).toEqual([1, 2]);
  });
  it.each(['api', 'chatgpt'])(
    'uses %s and caches validated boundaries only, separately from conversations',
    async (mode) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'reader-segments-'));
      try {
        const store = await Store.open(dir);
        store.put('book', 'a', { id: 'a', title: 'A', format: 'epub' });
        store.put('book', 'p', { id: 'p', title: 'P', format: 'pdf' });
        store.patchSettings({ model: 'fixture' });
        const request = vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          expect(JSON.stringify(body)).toContain('2000–6000');
          const data =
            mode === 'api'
              ? [{ choices: [{ delta: { content: '{"ends":[1,2]}' }, finish_reason: 'stop' }] }]
              : [
                  { type: 'response.output_text.delta', delta: '{"ends":[1,2]}' },
                  { type: 'response.completed' },
                ];
          return new Response(data.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
        });
        const connection = { request, status: () => ({ mode }), credential: async () => 'fixture' } as any;
        expect(await segmentChapter(store, connection, 'a', ['first', 'second'])).toEqual([1, 2]);
        expect(await segmentChapter(store, connection, 'a', ['first', 'second'])).toEqual([1, 2]);
        expect(request).toHaveBeenCalledTimes(1);
        await segmentChapter(store, connection, 'a', ['changed', 'second']);
        expect(request).toHaveBeenCalledTimes(2);
        await expect(segmentChapter(store, connection, 'p', ['text'])).rejects.toThrow('EPUB');
        expect(store.list('message')).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
