import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { OcrService } from '../electron/ocr';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker: mocks.create, OEM: { LSTM_ONLY: 1 }, PSM: { AUTO: '3' } }));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function worker() {
  return {
    setParameters: vi.fn().mockResolvedValue({}),
    terminate: vi.fn().mockResolvedValue({}),
    recognize: vi
      .fn()
      .mockResolvedValue({
        data: {
          text: '扫描原文',
          confidence: 92,
          blocks: [
            { paragraphs: [{ lines: [{ text: '扫描原文', bbox: { x0: 10, y0: 20, x1: 90, y1: 40 } }] }] },
          ],
        },
      }),
  };
}
async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reader-ocr-'));
  const store = await Store.open(dir);
  store.put('book', 'a', { id: 'a', format: 'pdf' });
  store.put('book', 'b', { id: 'b', format: 'pdf' });
  return { dir, store, service: new OcrService(dir, store, () => {}) };
}
describe('OCR lifecycle', () => {
  it('caches by book and page and returns normalized selection coordinates', async () => {
    const { dir, store, service } = await setup();
    const w = worker();
    mocks.create.mockResolvedValue(w);
    try {
      const a = await service.recognize('a', 1, png, 100, 100);
      expect(a.lines[0]).toMatchObject({ x: 0.1, y: 0.2, width: 0.8, height: 0.2 });
      await service.recognize('a', 1, png, 100, 100);
      expect(w.recognize).toHaveBeenCalledTimes(1);
      await service.recognize('b', 1, png, 100, 100);
      expect(w.recognize).toHaveBeenCalledTimes(2);
      expect(service.pages('a')).toHaveLength(1);
      expect((await Store.open(dir)).list('ocr')).toHaveLength(2);
    } finally {
      await service.cancel();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('cancels pending model initialization without saving a result, and permits a new run', async () => {
    const { dir, store, service } = await setup();
    const old = worker();
    let resolve!: (w: ReturnType<typeof worker>) => void;
    mocks.create.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    try {
      const run = service.recognize('a', 1, png, 100, 100);
      const rejection = expect(run).rejects.toThrow('已取消识别');
      await service.cancel();
      await rejection;
      resolve(old);
      await vi.waitFor(() => expect(old.terminate).toHaveBeenCalled());
      expect(store.list('ocr')).toHaveLength(0);
      const next = worker();
      mocks.create.mockResolvedValueOnce(next);
      expect((await service.recognize('a', 2, png, 100, 100)).page).toBe(2);
    } finally {
      await service.cancel();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
