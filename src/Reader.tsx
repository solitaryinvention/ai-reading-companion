import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { EpubController } from './epub-controller';
import JSZip from 'jszip';
import {
  ChevronLeft,
  ChevronRight,
  Quote,
  Minus,
  Plus,
  Hand,
  MousePointer2,
  ScanText,
  X,
  Copy,
} from 'lucide-react';
import type { Book, SourceReference, Settings, TocItem, OcrPage, OcrProgress, SavedHighlight } from './types';
import { cleanPdfText } from './reader-utils';
import { countCharacters } from './chapter-count';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export interface ReaderHandle {
  jump(target: string | number | SourceReference): Promise<void>;
  chapter(from?: number, to?: number): Promise<SourceReference>;
}
interface Props {
  book: Book;
  onConverted: (book: Book) => Promise<void>;
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;
  onToc: (toc: TocItem[]) => void;
  onQuote: (ref: SourceReference) => void;
  onInfo: (info: {
    page: number;
    total: number;
    label: string;
    count: number;
    tocTarget?: string | number;
    from?: number;
    to?: number;
  }) => void;
  onError: (text: string) => void;
}

function PdfPage({
  doc,
  page,
  scale,
  visible,
  onSelect,
  ocr,
  onRecognize,
  highlights,
}: {
  doc: pdfjs.PDFDocumentProxy;
  page: number;
  scale: number;
  visible: boolean;
  onSelect: (ref: Omit<SourceReference, 'id' | 'bookId' | 'title' | 'label'>) => void;
  ocr?: OcrPage;
  onRecognize: () => void;
  highlights: SavedHighlight[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState({ width: 600, height: 820 });
  const size = { width: base.width * scale, height: base.height * scale };
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    let gone = false;
    void doc.getPage(page).then((p) => {
      if (!gone) {
        const v = p.getViewport({ scale: 1 });
        setBase({ width: v.width, height: v.height });
      }
    });
    return () => {
      gone = true;
    };
  }, [doc, page]);
  useEffect(() => {
    let gone = false;
    let render: pdfjs.RenderTask | undefined;
    let layer: pdfjs.TextLayer | undefined;
    if (!visible) return;
    void (async () => {
      const p = await doc.getPage(page);
      if (gone || !host.current) return;
      const viewport = p.getViewport({ scale });
      const canvas = host.current.querySelector('canvas')!;
      const textHost = host.current.querySelector('.textLayer') as HTMLDivElement;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        Math.sqrt(16000000 / (viewport.width * viewport.height)),
      );
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      render = p.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      const text = await p.getTextContent();
      if (gone) return;
      setEmpty(!text.items.some((i) => 'str' in i && i.str.trim()));
      textHost.replaceChildren();
      textHost.style.setProperty('--scale-factor', String(scale));
      textHost.style.setProperty('--total-scale-factor', String(scale));
      if (!ocr) layer = new pdfjs.TextLayer({ textContentSource: text, container: textHost, viewport });
      await Promise.all([render.promise, layer?.render()]);
      if (!gone && host.current) host.current.dataset.ready = 'true';
    })().catch((e) => {
      if (!gone) console.error('PDF page', e.message);
    });
    return () => {
      gone = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [doc, page, scale, visible, ocr]);
  return (
    <div
      className="pdf-sheet"
      data-page={page}
      ref={host}
      style={size}
      onMouseUp={() => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.toString().trim()) return;
        const range = selection.getRangeAt(0);
        if (!host.current?.contains(range.commonAncestorContainer)) return;
        const bounds = host.current.getBoundingClientRect();
        onSelect({
          text: selection.toString().trim(),
          page,
          ocr: !!ocr,
          rects: Array.from(range.getClientRects())
            .filter((r) => r.width && r.height)
            .map((r) => ({
              x: (r.x - bounds.x) / bounds.width,
              y: (r.y - bounds.y) / bounds.height,
              width: r.width / bounds.width,
              height: r.height / bounds.height,
            })),
        });
      }}
    >
      <canvas />
      {highlights.flatMap((h) =>
        (h.rects || []).map((r, i) => (
          <div
            key={h.id + ':' + i}
            className="saved-pdf-highlight"
            aria-hidden="true"
            style={{
              left: r.x * 100 + '%',
              top: r.y * 100 + '%',
              width: r.width * 100 + '%',
              height: r.height * 100 + '%',
            }}
          />
        )),
      )}
      <div className="textLayer" />
      {ocr && (
        <div className="ocr-text-layer" aria-label={`第 ${page} 页 OCR 文字层`}>
          {ocr.lines.map((line, i) => (
            <span
              key={i}
              style={{
                left: line.x * 100 + '%',
                top: line.y * 100 + '%',
                height: line.height * 100 + '%',
                fontSize: line.height * size.height + 'px',
                transform: `scaleX(${
                  (line.width * size.width) /
                  (Math.max(
                    1,
                    Array.from(line.text).reduce((n, c) => n + (/[\u3400-\u9fff]/.test(c) ? 1 : 0.55), 0),
                  ) *
                    line.height *
                    size.height)
                })`,
              }}
            >
              {line.text}
              {'\n'}
            </span>
          ))}
        </div>
      )}
      {!visible && <span className="page-placeholder">第 {page} 页</span>}
      {empty && !ocr && (
        <button className="scan-warning" onClick={onRecognize}>
          扫描页 · 点击识别文字
        </button>
      )}
      {ocr && <span className="ocr-badge">OCR 文字层 · 请核对识别结果</span>}
    </div>
  );
}

export const Reader = forwardRef<ReaderHandle, Props>(function Reader(
  { book, settings, updateSettings, onToc, onQuote, onInfo, onError, onConverted },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const pdf = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const conversion = useRef<AbortController | null>(null);
  const [conversionStatus, setConversionStatus] = useState<{
    page: number;
    total: number;
    text: string;
    writing?: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      conversion.current?.abort();
    },
    [],
  );
  const convertPdf = async () => {
    const doc = pdf.current;
    if (!doc || conversion.current || recognizing.current) return;
    const controller = new AbortController();
    conversion.current = controller;
    const pages: { page: number; text: string; label: string; ocr: boolean }[] = [];
    try {
      const cached = await window.reader.ocrPages(book.id);
      const cache = new Map(cached.map((p) => [p.page, p]));
      for (let n = 1; n <= doc.numPages; n++) {
        controller.signal.throwIfAborted();
        setConversionStatus({ page: n, total: doc.numPages, text: '提取正文' });
        const p = await doc.getPage(n);
        let text = cleanPdfText((await p.getTextContent()).items);
        let usedOcr = false;
        if (!text.trim()) {
          usedOcr = true;
          let result = cache.get(n);
          if (!result) {
            setConversionStatus({ page: n, total: doc.numPages, text: '本地 OCR 识别扫描页' });
            const size = p.getViewport({ scale: 1 });
            const viewport = p.getViewport({
              scale: Math.min(2.5, 3200 / Math.max(size.width, size.height)),
            });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
            controller.signal.throwIfAborted();
            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('无法生成 OCR 图像'))), 'image/png'),
            );
            controller.signal.throwIfAborted();
            result = await window.reader.recognizePage(
              book.id,
              n,
              new Uint8Array(await blob.arrayBuffer()),
              canvas.width,
              canvas.height,
            );
            ocrRef.current = { ...ocrRef.current, [n]: result };
            if (alive.current) setOcrPages(ocrRef.current);
            canvas.width = canvas.height = 0;
          }
          text = result.text;
        }
        controller.signal.throwIfAborted();
        const heading = toc.current.find((item) => item.target === n)?.label;
        pages.push({
          page: n,
          text,
          label: heading ? `${heading} · 第 ${n} 页` : `第 ${n} 页`,
          ocr: usedOcr,
        });
      }
      controller.signal.throwIfAborted();
      setConversionStatus({
        page: doc.numPages,
        total: doc.numPages,
        text: '生成 EPUB 并加入书库',
        writing: true,
      });
      const converted = await window.reader.createEpub(book.id, pages);
      conversion.current = null;
      setConversionStatus(null);
      await onConverted(converted);
    } catch (e) {
      if (alive.current)
        onError(
          controller.signal.aborted
            ? '已取消转换，原 PDF 保留；已完成的 OCR 可在下次复用'
            : e instanceof Error
              ? e.message
              : '转换失败',
        );
    } finally {
      if (conversion.current === controller) conversion.current = null;
      if (alive.current) {
        setConversionStatus(null);
        setOcrProgress(null);
      }
    }
  };
  const epub = useRef<EpubController | null>(null);
  const [highlights, setHighlights] = useState<SavedHighlight[]>([]);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  useEffect(() => {
    let gone = false;
    void window.reader
      .highlights(book.id)
      .then((list) => {
        if (!gone) setHighlights(list);
      })
      .catch((e) => onError(e.message));
    return () => {
      gone = true;
    };
  }, [book.id]);
  const current = useRef({
    page: book.position?.page || 1,
    cfi: book.position?.cfi || '',
    href: '',
    label: '当前章节',
  });
  const props = useRef({ book, settings, onToc, onInfo, onError });
  props.current = { book, settings, onToc, onInfo, onError };
  const [total, setTotal] = useState(0),
    [page, setPage] = useState(book.position?.page || 1),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    epub.current?.setHighlights(highlights);
  }, [highlights, ready]);
  const [selected, setSelected] = useState<SourceReference | null>(null),
    [visible, setVisible] = useState<Set<number>>(new Set([book.position?.page || 1]));
  const [label, setLabel] = useState('正在打开…');
  const lastPosition = useRef(book.position);
  const toc = useRef<TocItem[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ocrPages, setOcrPages] = useState<Record<number, OcrPage>>({});
  const ocrRef = useRef(ocrPages);
  ocrRef.current = ocrPages;
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrPage | null>(null);
  const recognizing = useRef(false);
  const ocrRun = useRef(0);
  const alive = useRef(true);
  const [panMode, setPanMode] = useState(false),
    [spacePan, setSpacePan] = useState(false),
    [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; pointer: number } | null>(null);
  const zoomAnchor = useRef<{ page: number; x: number; y: number; rx: number; ry: number } | null>(null);
  const zoomRef = useRef(settings.zoom);
  zoomRef.current = settings.zoom;
  const changeZoom = (value: number, point?: { x: number; y: number }) => {
    setSelected(null);
    window.getSelection()?.removeAllRanges();
    const root = host.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const x = point?.x ?? bounds.x + bounds.width / 2,
      y = point?.y ?? bounds.y + bounds.height / 2;
    const sheets = Array.from(root.querySelectorAll<HTMLElement>('[data-page]'));
    const sheet =
      sheets.find((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= y && r.bottom >= y;
      }) || sheets.find((el) => Number(el.dataset.page) === current.current.page);
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      zoomAnchor.current = {
        page: Number(sheet.dataset.page),
        x,
        y,
        rx: (x - r.x) / r.width,
        ry: (y - r.y) / r.height,
      };
    }
    const zoom = Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
    zoomRef.current = zoom;
    updateSettings({ zoom });
  };
  useLayoutEffect(() => {
    const a = zoomAnchor.current,
      root = host.current;
    if (!a || !root) return;
    const sheet = root.querySelector<HTMLElement>(`[data-page="${a.page}"]`);
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      root.scrollLeft += r.x + a.rx * r.width - a.x;
      root.scrollTop += r.y + a.ry * r.height - a.y;
    }
    zoomAnchor.current = null;
  }, [settings.zoom]);
  const fitWidth = async () => {
    const root = host.current,
      doc = pdf.current;
    if (!root || !doc) return;
    const p = await doc.getPage(current.current.page);
    if (alive.current) changeZoom((root.clientWidth - 40) / p.getViewport({ scale: 1 }).width);
  };
  const recognize = async (n = current.current.page) => {
    if (!pdf.current || recognizing.current) return;
    if (ocrRef.current[n]) {
      setOcrResult(ocrRef.current[n]);
      return;
    }
    recognizing.current = true;
    const run = ++ocrRun.current;
    setOcrProgress({ bookId: book.id, page: n, progress: 0, status: '准备页面图像' });
    try {
      const p = await pdf.current.getPage(n),
        v = p.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 3200 / Math.max(v.width, v.height));
      const viewport = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('无法生成页面图像'))), 'image/png'),
      );
      if (!alive.current || !recognizing.current || run !== ocrRun.current) return;
      const result = await window.reader.recognizePage(
        book.id,
        n,
        new Uint8Array(await blob.arrayBuffer()),
        canvas.width,
        canvas.height,
      );
      if (!alive.current || run !== ocrRun.current) return;
      ocrRef.current = { ...ocrRef.current, [n]: result };
      setOcrPages(ocrRef.current);
      setOcrResult(result);
      if (!result.text) props.current.onError('本页未识别出文字，请尝试更清晰的 PDF 页面');
    } catch (e) {
      if (alive.current && recognizing.current && run === ocrRun.current)
        props.current.onError(e instanceof Error ? e.message : '文字识别失败');
    } finally {
      if (run === ocrRun.current) {
        recognizing.current = false;
        if (alive.current) setOcrProgress(null);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void window.reader
      .ocrPages(book.id)
      .then((pages) => {
        if (alive.current) {
          const map = Object.fromEntries(pages.map((p) => [p.page, p]));
          ocrRef.current = map;
          setOcrPages(map);
        }
      })
      .catch((e) => props.current.onError(e.message));
    const off = window.reader.onOcrProgress((e) => {
      if (e.bookId === book.id && recognizing.current) setOcrProgress(e);
    });
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !/INPUT|TEXTAREA|SELECT/.test((e.target as Element)?.tagName || '') &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setSpacePan(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePan(false);
    };
    const blur = () => {
      setSpacePan(false);
      setDragging(false);
      drag.current = null;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      alive.current = false;
      ocrRun.current++;
      off();
      recognizing.current = false;
      void window.reader.cancelOcr();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [book.id]);
  useEffect(() => {
    if (book.format !== 'pdf') return;
    const root = host.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      changeZoom(zoomRef.current * Math.exp(-event.deltaY * 0.002), { x: event.clientX, y: event.clientY });
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, [book.id]);
  const reportPdf = (n: number) => {
    const entries = toc.current
      .filter((t) => typeof t.target === 'number')
      .sort((a, b) => Number(a.target) - Number(b.target) || a.level - b.level);
    const item = entries.filter((t) => Number(t.target) <= n).at(-1);
    const next = entries.find((t) => Number(t.target) > n);
    props.current.onInfo({
      page: n,
      total: pdf.current?.numPages || 0,
      label: item?.label || `第 ${n} 页`,
      count: 0,
      tocTarget: item?.target,
      from: item ? Number(item.target) : n,
      to: item ? (next ? Number(next.target) - 1 : pdf.current?.numPages || n) : n,
    });
  };
  const save = (position: Book['position']) => {
    const previous = lastPosition.current;
    lastPosition.current = position;
    clearTimeout(saveTimer.current);
    const changed =
      !previous ||
      previous.page !== position?.page ||
      previous.cfi?.split('!')[0] !== position?.cfi?.split('!')[0];
    if (changed) void window.reader.position(book.id, position!);
    else saveTimer.current = setTimeout(() => void window.reader.position(book.id, position!), 300);
  };
  const quote = (value: Omit<SourceReference, 'id' | 'bookId' | 'title' | 'label'>) =>
    setSelected({
      ...value,
      id: crypto.randomUUID(),
      bookId: book.id,
      title: book.title,
      label: value.page ? `第 ${value.page} 页${value.ocr ? ' · OCR' : ''}` : current.current.label,
    });
  const jump = async (target: string | number | SourceReference) => {
    setSelected(null);
    if (pdf.current) {
      const num =
        typeof target === 'number' ? target : typeof target === 'object' ? target.page : parseInt(target);
      if (!num || num < 1 || num > pdf.current.numPages) return;
      const element = host.current?.querySelector(`[data-page="${num}"]`) as HTMLElement | null;
      element?.scrollIntoView({ block: 'start' });
      if (typeof target === 'object' && element) {
        element.querySelectorAll('.quote-highlight').forEach((e) => e.remove());
        for (const rect of target.rects || []) {
          const mark = document.createElement('div');
          mark.className = 'quote-highlight';
          Object.assign(mark.style, {
            left: rect.x * 100 + '%',
            top: rect.y * 100 + '%',
            width: rect.width * 100 + '%',
            height: rect.height * 100 + '%',
          });
          element.append(mark);
          setTimeout(() => mark.remove(), 4500);
        }
      }
    } else if (epub.current) await epub.current.jump(target);
  };
  useImperativeHandle(ref, () => ({
    jump,
    chapter: async (from, to) => {
      if (pdf.current) {
        const start = from ?? current.current.page,
          end = to ?? start;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          end < start ||
          end > pdf.current.numPages
        )
          throw new Error('请输入有效的 PDF 起止页码');
        let text = '';
        for (let n = start; n <= end; n++) {
          const p = await pdf.current.getPage(n);
          const cached = ocrRef.current[n];
          const content = cached ? cached.text : cleanPdfText((await p.getTextContent()).items);
          if (!content.trim() && !cached)
            throw new Error(`第 ${n} 页没有可提取文字，请先在该页点击“识别本页”`);
          text += `\n[第 ${n} 页${cached ? ' · OCR' : ''}]\n` + content;
        }
        if (!text.replace(/\[第 \d+ 页\]/g, '').trim())
          throw new Error('所选页面没有可用文字，请先识别扫描页');
        return {
          id: crypto.randomUUID(),
          bookId: book.id,
          title: book.title,
          label: `第 ${start}–${end} 页`,
          text,
          page: start,
        };
      }
      if (epub.current) return epub.current.chapter();
      throw new Error('书籍尚未加载完成');
    },
  }));

  useEffect(() => {
    let gone = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setLoading(true);
    setError('');
    props.current.onToc([]);
    void (async () => {
      const bytes = await window.reader.bookBytes(book.id);
      if (gone) return;
      if (book.format === 'pdf') {
        task = pdfjs.getDocument({
          data: bytes,
          cMapUrl: new URL('./pdf-assets/cmaps/', document.baseURI).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('./pdf-assets/standard_fonts/', document.baseURI).href,
        });
        const doc = await task.promise;
        if (gone) {
          await task.destroy();
          return;
        }
        pdf.current = doc;
        setTotal(doc.numPages);
        const flatten = async (items: any[], level = 0): Promise<TocItem[]> => {
          const rows: TocItem[] = [];
          for (const i of items) {
            let dest = i.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (Array.isArray(dest)) {
              const n = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
              rows.push({ label: i.title, target: n + 1, level });
            }
            rows.push(...(await flatten(i.items || [], level + 1)));
          }
          return rows;
        };
        toc.current = await flatten((await doc.getOutline()) || []);
        props.current.onToc(toc.current);
        reportPdf(book.position?.page || 1);
        setReady(true);
        setLoading(false);
        const metadata = await doc.getMetadata().catch(() => null);
        const title = (metadata?.info as any)?.Title;
        if (title && typeof title === 'string') await window.reader.title(book.id, title);
      } else {
        const zip = await JSZip.loadAsync(bytes);
        if (zip.file('META-INF/encryption.xml')) throw new Error('此 EPUB 含加密资源，第一版暂不支持');
        if (gone || !host.current) return;
        const controller = new EpubController(host.current, book, props.current.settings, {
          toc: (items) => {
            toc.current = items;
            props.current.onToc(items);
          },
          info: (info) => {
            if (gone) return;
            current.current.label = info.label;
            setLabel(info.label);
            setPage(info.page);
            setTotal(info.total);
            props.current.onInfo(info);
          },
          position: save,
          select: quote,
          error: (message) => props.current.onError(message),
        });
        epub.current = controller;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            controller.open(bytes),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => reject(new Error('EPUB 解析超时，文件可能已损坏')), 20000);
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
        if (gone) return;
        setReady(true);
        setLoading(false);
      }
    })().catch((e) => {
      if (!gone) {
        const message = '无法打开书籍：' + (e?.message || '文件损坏或格式不支持');
        setError(message);
        setLoading(false);
        props.current.onError(message);
      }
    });
    return () => {
      gone = true;
      clearTimeout(saveTimer.current);
      if (lastPosition.current) void window.reader.position(book.id, lastPosition.current);
      pdf.current = null;
      void task?.destroy();
      epub.current?.destroy();
      epub.current = null;
    };
  }, [book.id]);
  useEffect(() => {
    if (!ready || book.format !== 'pdf' || !host.current) return;
    const root = host.current;
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            e.isIntersecting ? next.add(n) : next.delete(n);
          }
          return next;
        }),
      { root, rootMargin: '900px 0px' },
    );
    root.querySelectorAll('[data-page]').forEach((el) => observer.observe(el));
    requestAnimationFrame(() => {
      const el = root.querySelector(`[data-page="${book.position?.page || 1}"]`) as HTMLElement;
      root.scrollTop = (el?.offsetTop || 0) + (book.position?.offset || 0);
    });
    return () => observer.disconnect();
  }, [ready, total]);
  useEffect(() => {
    epub.current?.apply(settings);
  }, [settings.fontSize, settings.lineHeight, settings.theme, settings.readingFont]);
  const pdfTextCounts = useRef(new Map<number, number>());
  useEffect(() => {
    const doc = pdf.current;
    if (!ready || !doc || !toc.current.length) return;
    let cancelled = false;
    void (async () => {
      const counts: { count: number; incomplete: boolean }[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        let count = pdfTextCounts.current.get(n);
        if (count === undefined) {
          count = countCharacters(cleanPdfText((await (await doc.getPage(n)).getTextContent()).items));
          pdfTextCounts.current.set(n, count);
        }
        const recognized = ocrPages[n];
        counts.push({
          count: count || (recognized ? countCharacters(recognized.text) : 0),
          incomplete: count === 0 && !recognized,
        });
        if (n % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (cancelled) return;
      toc.current = toc.current.map((item, index, rows) => {
        const start = Number(item.target);
        const end = rows
          .slice(index + 1)
          .find((next) => next.level <= item.level && Number(next.target) > start);
        const range = counts.slice(start - 1, end ? Number(end.target) - 1 : counts.length);
        return {
          ...item,
          wordCount: range.reduce((sum, p) => sum + p.count, 0),
          countIncomplete: range.some((p) => p.incomplete),
        };
      });
      props.current.onToc([...toc.current]);
    })().catch(() => {
      if (!cancelled) {
        toc.current = toc.current.map((t) => ({ ...t, countIncomplete: true }));
        props.current.onToc([...toc.current]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, ocrPages, book.id]);
  const move = (direction: number) => {
    if (pdf.current) void jump(Math.min(total, Math.max(1, page + direction)));
    else void epub.current?.move(direction).catch((e) => props.current.onError(e.message));
  };
  return (
    <section
      className={'reader-panel theme-' + settings.theme + (book.format === 'epub' ? ' epub-reader' : '')}
    >
      <header className="reader-toolbar">
        <span className="eyebrow">正在阅读 · {book.format.toUpperCase()}</span>
        <div className="toolbar-controls">
          <button aria-label="书籍划线" disabled={!ready} onClick={() => setHighlightsOpen(true)}>
            划线{highlights.length ? ` · ${highlights.length}` : ''}
          </button>
          {book.format === 'epub' && (
            <button
              title="导出 EPUB"
              onClick={() =>
                void window.reader
                  .exportEpub(book.id)
                  .then((saved) => {
                    if (saved) onError('EPUB 已导出');
                  })
                  .catch((e) => onError(e.message))
              }
            >
              导出 EPUB
            </button>
          )}
          {book.format === 'pdf' ? (
            <>
              <button title="缩小" onClick={() => changeZoom(settings.zoom - 0.1)}>
                <Minus size={15} />
              </button>
              <select
                aria-label="PDF 缩放比例"
                value={settings.zoom}
                onChange={(e) => changeZoom(Number(e.target.value))}
              >
                {Array.from(new Set([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, settings.zoom]))
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {Math.round(n * 100)}%
                    </option>
                  ))}
              </select>
              <button title="放大" onClick={() => changeZoom(settings.zoom + 0.1)}>
                <Plus size={15} />
              </button>
              <button title="适合宽度" aria-label="适合宽度" onClick={() => void fitWidth()}>
                适宽
              </button>
              <button title="实际大小" aria-label="实际大小" onClick={() => changeZoom(1)}>
                1:1
              </button>
            </>
          ) : (
            <>
              <select
                aria-label="阅读字体"
                value={settings.readingFont || 'serif'}
                onChange={(e) => updateSettings({ readingFont: e.target.value as 'serif' | 'sans' })}
              >
                <option value="serif">宋体</option>
                <option value="sans">黑体</option>
              </select>
              <select
                aria-label="字号"
                value={settings.fontSize}
                onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
              >
                {[16, 18, 19, 20, 22, 24, 28].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
              <select
                aria-label="行距"
                value={settings.lineHeight}
                onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })}
              >
                {[1.5, 1.7, 1.9, 2.2].map((n) => (
                  <option key={n} value={n}>
                    {n} 倍
                  </option>
                ))}
              </select>
            </>
          )}
          <select
            aria-label="界面主题"
            title="切换整个应用的主题"
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as Settings['theme'] })}
          >
            <option value="paper">纸色</option>
            <option value="white">明亮</option>
            <option value="night">夜间</option>
          </select>
        </div>
      </header>
      {highlightsOpen && (
        <div className="modal-shade" onClick={() => setHighlightsOpen(false)}>
          <div
            className="modal highlight-list"
            role="dialog"
            aria-label="书籍划线"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>划线 · {highlights.length}</h2>
              <button aria-label="关闭划线列表" onClick={() => setHighlightsOpen(false)}>
                <X size={18} />
              </button>
            </header>
            {!highlights.length && <p className="muted">选中原文后，点击「划线」保存。</p>}
            {highlights.map((h) => (
              <article key={h.id}>
                <button
                  className="highlight-location"
                  onClick={() => {
                    setHighlightsOpen(false);
                    void jump(h).catch((e) => onError(e.message));
                  }}
                >
                  <small>{h.label}</small>
                  <span>{h.text}</span>
                </button>
                <button
                  aria-label="删除划线"
                  onClick={() =>
                    void window.reader
                      .removeHighlight(book.id, h.id)
                      .then(() => setHighlights((list) => list.filter((x) => x.id !== h.id)))
                      .catch((e) => onError(e.message))
                  }
                >
                  删除
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
      {conversionStatus && (
        <div className="modal-shade">
          <div className="modal" role="dialog" aria-label="PDF 转 EPUB 进度">
            <h2>PDF 转 EPUB</h2>
            <p role="status">
              第 {conversionStatus.page} / {conversionStatus.total} 页 · {conversionStatus.text}
            </p>
            <progress
              max={conversionStatus.total}
              value={conversionStatus.page - (conversionStatus.writing ? 0 : 1)}
              style={{ width: '100%' }}
            />
            <p className="muted">
              在本地转换，不消耗模型额度。生成可调整字号的文字版，保留原 PDF
              页码。图片、复杂表格和原始版式暂不保留；OCR 文字请核对原图。
            </p>
            <button
              disabled={conversionStatus.writing}
              onClick={() => {
                conversion.current?.abort();
                void window.reader.cancelOcr();
              }}
            >
              取消转换
            </button>
          </div>
        </div>
      )}
      {book.format === 'pdf' && (
        <div className="pdf-tools">
          <button
            title="一键转 EPUB"
            aria-label="一键转 EPUB"
            disabled={!ready || !!ocrProgress || !!conversionStatus}
            onClick={() => void convertPdf()}
          >
            转 EPUB
          </button>
          <div role="group" aria-label="阅读工具">
            <button
              aria-pressed={!panMode}
              title="选文模式"
              aria-label="选文模式"
              className={!panMode ? 'active' : ''}
              onClick={() => setPanMode(false)}
            >
              <MousePointer2 size={14} />
              选文
            </button>
            <button
              aria-pressed={panMode}
              title="拖动模式"
              aria-label="拖动模式"
              className={panMode ? 'active' : ''}
              onClick={() => {
                setPanMode(true);
                setSelected(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <Hand size={14} />
              拖动
            </button>
          </div>
          <small>空格拖动 · Ctrl + 滚轮缩放</small>
          <button
            title="识别本页"
            aria-label="识别本页"
            disabled={!ready || !!ocrProgress}
            onClick={() => void recognize()}
          >
            <ScanText size={14} />
            {ocrPages[current.current.page] ? '查看识别文字' : '识别本页'}
          </button>
        </div>
      )}
      <div
        ref={host}
        className={
          'book-viewport ' +
          (book.format === 'pdf' ? 'pdf-viewport' : 'epub-viewport') +
          ((panMode || spacePan) && book.format === 'pdf' ? ' pan-mode' : '') +
          (dragging ? ' is-dragging' : '')
        }
        onPointerDown={(event) => {
          if (
            book.format !== 'pdf' ||
            !(panMode || spacePan || event.button === 1) ||
            ![0, 1].includes(event.button) ||
            (event.target as Element).closest('button')
          )
            return;
          event.preventDefault();
          const root = host.current!;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: root.scrollLeft,
            top: root.scrollTop,
            pointer: event.pointerId,
          };
          root.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current,
            root = host.current;
          if (!start || !root) return;
          root.scrollLeft = start.left - (event.clientX - start.x);
          root.scrollTop = start.top - (event.clientY - start.y);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          host.current?.releasePointerCapture(event.pointerId);
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onScroll={() => {
          if (book.format !== 'pdf' || !host.current) return;
          const root = host.current;
          const sheets = Array.from(root.querySelectorAll<HTMLElement>('[data-page]'));
          const currentSheet = sheets.find((el) => el.offsetTop + el.offsetHeight > root.scrollTop + 30);
          if (!currentSheet) return;
          const n = Number(currentSheet.dataset.page);
          current.current.page = n;
          setPage(n);
          save({ page: n, offset: Math.max(0, root.scrollTop - currentSheet.offsetTop) });
          setLabel(`第 ${n} 页`);
          reportPdf(n);
        }}
      >
        {book.format === 'pdf' &&
          pdf.current &&
          Array.from({ length: total }, (_, i) => (
            <PdfPage
              key={i + 1}
              doc={pdf.current!}
              page={i + 1}
              scale={settings.zoom}
              visible={visible.has(i + 1)}
              onSelect={quote}
              highlights={highlights.filter((h) => h.page === i + 1)}
              ocr={ocrPages[i + 1]}
              onRecognize={() => void recognize(i + 1)}
            />
          ))}
      </div>
      {loading && <div className="reader-overlay">正在解析书籍…</div>}
      {error && <div className="reader-overlay error">{error}</div>}
      {ocrProgress && (
        <div className="ocr-progress" role="status">
          <ScanText size={16} />
          <span>
            第 {ocrProgress.page} 页 · {ocrProgress.status} {Math.round(ocrProgress.progress * 100)}%
          </span>
          <button
            onClick={() => {
              recognizing.current = false;
              ocrRun.current++;
              setOcrProgress(null);
              void window.reader.cancelOcr();
            }}
          >
            取消
          </button>
        </div>
      )}
      {ocrResult && (
        <div className="ocr-result" role="region" aria-label="OCR 识别结果">
          <header>
            <div>
              <strong>第 {ocrResult.page} 页 · OCR 识别结果</strong>
              <small>已本地保存 · 识别可能有误，请结合原文核对</small>
            </div>
            <button title="关闭识别结果" onClick={() => setOcrResult(null)}>
              <X size={16} />
            </button>
          </header>
          <textarea aria-label="识别文字" readOnly value={ocrResult.text || '本页未识别出文字。'} />
          <footer>
            <button disabled={!ocrResult.text} onClick={() => void window.reader.copyText(ocrResult.text)}>
              <Copy size={14} />
              复制全文
            </button>
            <button
              className="primary"
              disabled={!ocrResult.text}
              onClick={() => {
                onQuote({
                  id: crypto.randomUUID(),
                  bookId: book.id,
                  title: book.title,
                  label: `第 ${ocrResult.page} 页 · OCR`,
                  text: ocrResult.text,
                  page: ocrResult.page,
                  ocr: true,
                });
                setOcrResult(null);
              }}
            >
              <Quote size={14} />
              引用识别文字
            </button>
          </footer>
        </div>
      )}
      {selected && (
        <div className="selection-bar">
          <span>
            {selected.text.length} 字 · {selected.label}
          </span>
          <button
            className="primary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onQuote(selected);
              setSelected(null);
            }}
          >
            <Quote size={14} />
            引用到聊天
          </button>
          <button
            aria-label="保存划线"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              void window.reader
                .saveHighlight(selected)
                .then((saved) => {
                  setHighlights((list) => (list.some((h) => h.id === saved.id) ? list : [...list, saved]));
                  setSelected(null);
                  window.getSelection()?.removeAllRanges();
                })
                .catch((e) => onError(e.message))
            }
          >
            划线
          </button>
          <button onClick={() => setSelected(null)}>×</button>
        </div>
      )}
      <footer className="reader-footer">
        <button title="上一页" disabled={!ready} onClick={() => move(-1)}>
          <ChevronLeft size={18} />
        </button>
        <span className="reader-location" title={book.format === 'epub' ? label : undefined}>
          {book.format === 'pdf' ? (
            <>
              <input
                aria-label="跳转页码"
                type="number"
                min="1"
                max={total}
                value={page}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setPage(n);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void jump(page);
                }}
                onBlur={() => void jump(page)}
              />{' '}
              / {total} 页
            </>
          ) : (
            <>
              {page} / {total} 节
            </>
          )}
        </span>
        <button title="下一页" disabled={!ready} onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
      </footer>
    </section>
  );
});
