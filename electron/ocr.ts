import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import path from 'node:path';
import type { OcrPage, OcrProgress } from '../src/types';
import type { Store } from './store';

export class OcrService {
  private worker?: Worker;
  private loading?: Promise<Worker>;
  private generation = 0;
  private active?: { bookId: string; page: number };
  private abort?: () => void;
  constructor(
    private root: string,
    private store: Store,
    private emit: (e: OcrProgress) => void,
  ) {}
  pages(bookId: string) {
    this.store.book(bookId);
    return this.store.list<OcrPage>('ocr').filter((p) => p.bookId === bookId);
  }
  async recognize(
    bookId: string,
    page: number,
    png: Uint8Array,
    width: number,
    height: number,
  ): Promise<OcrPage> {
    const book = this.store.book(bookId);
    if (book.format !== 'pdf' || !Number.isInteger(page) || page < 1) throw new Error('无效的 PDF 页码');
    const cached = this.store.get<OcrPage>('ocr', `${bookId}:${page}`);
    if (cached) return cached;
    if (this.active) throw new Error('已有页面正在识别，请稍后再试');
    if (
      !(png instanceof Uint8Array) ||
      png.length > 64 * 1024 * 1024 ||
      !Buffer.from(png.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > 24000000
    )
      throw new Error('页面图像无效或过大');
    const generation = this.generation;
    this.active = { bookId, page };
    const cancelled = new Promise<never>((_resolve, reject) => {
      this.abort = () => reject(new Error('已取消识别'));
    });
    try {
      this.emit({ bookId, page, progress: 0, status: '正在加载离线中英文模型' });
      if (!this.worker) {
        this.loading = createWorker('chi_sim+eng', OEM.LSTM_ONLY, {
          workerPath: path.join(this.root, 'ocr-worker.cjs'),
          langPath: path.join(this.root, 'ocr-data'),
          cacheMethod: 'none',
          logger: (event) => {
            if (this.active && generation === this.generation)
              this.emit({
                bookId: this.active.bookId,
                page: this.active.page,
                progress: event.status === 'recognizing text' ? event.progress : 0,
                status: event.status === 'recognizing text' ? '正在识别文字' : '正在加载离线中英文模型',
              });
          },
          errorHandler: () => {},
        });
        const worker = await Promise.race([this.loading, cancelled]);
        if (generation !== this.generation) {
          await worker.terminate();
          throw new Error('已取消识别');
        }
        this.worker = worker;
        this.loading = undefined;
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1',
          user_defined_dpi: '220',
        });
      }
      const { data } = await Promise.race([
        this.worker.recognize(Buffer.from(png), {}, { text: true, blocks: true }),
        cancelled,
      ]);
      if (generation !== this.generation) throw new Error('已取消识别');
      const lines = (data.blocks || [])
        .flatMap((block) => block.paragraphs.flatMap((p) => p.lines))
        .filter((l) => l.text.trim())
        .map((l) => ({
          text: l.text.trim(),
          x: l.bbox.x0 / width,
          y: l.bbox.y0 / height,
          width: (l.bbox.x1 - l.bbox.x0) / width,
          height: (l.bbox.y1 - l.bbox.y0) / height,
        }));
      const result: OcrPage = { bookId, page, text: data.text.trim(), confidence: data.confidence, lines };
      if (this.store.get('book', bookId)) this.store.put('ocr', `${bookId}:${page}`, result);
      return result;
    } finally {
      if (generation === this.generation) {
        this.active = undefined;
        this.abort = undefined;
      }
    }
  }
  async cancel() {
    this.abort?.();
    this.abort = undefined;
    this.generation++;
    this.active = undefined;
    const worker = this.worker;
    this.worker = undefined;
    const loading = this.loading;
    this.loading = undefined;
    if (worker) await worker.terminate();
    else if (loading) void loading.then((w) => w.terminate()).catch(() => {});
  }
}
