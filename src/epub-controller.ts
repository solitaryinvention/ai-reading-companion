import ePub, { EpubCFI } from 'epubjs';
import type { Book, Settings, SourceReference, ReaderPosition, TocItem } from './types';
import { sanitizeDocument } from './reader-utils';
import { epubTheme } from './epub-theme';
import JSZip from 'jszip';
import { embedBookImages, hideBookNotes } from './epub-assets';
import { countChapterRange } from './chapter-count';

/** epub.js parses the archive and CFIs; a script-free iframe owns native scrolling. */
export class EpubController {
  private book = ePub('', { replacements: 'blobUrl' });
  private frame: HTMLIFrameElement;
  private section: any;
  private epoch = 0;
  private disposed = false;
  private toc: TocItem[] = [];
  private settings: Settings;
  private title = '当前章节';
  private cleanups: (() => void)[] = [];
  private highlights: SourceReference[] = [];
  setHighlights(refs: SourceReference[]) {
    this.highlights = refs;
    this.paintHighlights();
  }
  private paintHighlights() {
    const d = this.frame.contentDocument;
    if (!d || !this.section) return;
    const w = d.defaultView as any;
    if (!w?.CSS?.highlights || !w.Highlight) return;
    const ranges: Range[] = [];
    for (const ref of this.highlights) {
      try {
        if (ref.cfi && this.book.spine.get(ref.cfi)?.index === this.section.index) {
          const range = new EpubCFI(ref.cfi).toRange(d);
          if (range) ranges.push(range);
        }
      } catch {}
    }
    w.CSS.highlights.set('saved-reading', new w.Highlight(...ranges));
  }
  constructor(
    private host: HTMLElement,
    private meta: Book,
    settings: Settings,
    private callbacks: {
      toc: (t: TocItem[]) => void;
      info: (value: {
        page: number;
        total: number;
        label: string;
        count: number;
        tocTarget?: string | number;
      }) => void;
      position: (p: ReaderPosition) => void;
      select: (ref: Omit<SourceReference, 'id' | 'bookId' | 'title' | 'label'>) => void;
      error: (text: string) => void;
    },
  ) {
    // Allow trusted parent event listeners. Book scripts remain removed and blocked by script-src 'none'.
    this.settings = settings;
    this.frame = document.createElement('iframe');
    this.frame.title = 'EPUB 书籍正文';
    this.frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    this.frame.className = 'epub-document';
  }
  async open(bytes: Uint8Array) {
    const archive = await JSZip.loadAsync(bytes);
    this.book.spine.hooks.content.register(async (doc: Document, section: { url: string }) => {
      hideBookNotes(doc);
      // Resolve resources before epub.js substitutions and before removing unsafe URLs.
      await embedBookImages(doc, section.url, archive);
      sanitizeDocument(doc);
    });
    await this.book.open(bytes.buffer as ArrayBuffer, 'binary');
    await this.book.ready;
    if (this.disposed) return;
    const nav = await this.book.loaded.navigation;
    const flatten = (items: any[], level = 0): TocItem[] =>
      items.flatMap((i) => [
        { label: i.label.trim(), target: i.href, level },
        ...flatten(i.subitems || [], level + 1),
      ]);
    this.toc = flatten(nav.toc);
    if (!this.toc.length)
      this.toc = (this.book.spine as any).spineItems.map((item: any, index: number) => ({
        label: `第 ${index + 1} 节`,
        target: item.href,
        level: 0,
      }));
    this.callbacks.toc(this.toc);
    this.host.replaceChildren(this.frame);
    await this.display(this.meta.position?.cfi, this.meta.position?.offset);
    void this.countChapters().catch(() => {});
    const metadata = await this.book.loaded.metadata;
    if (metadata.title) await window.reader.title(this.meta.id, metadata.title);
  }
  private async countChapters() {
    const cache = new Map<number, Document>();
    const locate = (target: string | number) => {
      const section = this.book.spine.get(String(target));
      const hash = String(target).split('#')[1];
      return { index: section?.index ?? -1, fragment: hash ? decodeURIComponent(hash) : undefined };
    };
    for (let i = 0; i < this.toc.length && !this.disposed; i++) {
      try {
        const row = this.toc[i];
        const start = locate(row.target);
        if (start.index < 0) continue;
        const next = this.toc.slice(i + 1).find((t) => t.level <= row.level);
        const end = next
          ? locate(next.target)
          : { index: (this.book.spine as any).length, fragment: undefined };
        let count = 0;
        for (
          let index = start.index;
          index <= end.index && index < (this.book.spine as any).length;
          index++
        ) {
          if (this.disposed) return;
          if (index === end.index && !end.fragment) break;
          let doc = cache.get(index);
          if (!doc) {
            const section = (this.book.spine as any).get(index);
            doc = (await this.book.load(section.url)) as Document;
            cache.set(index, doc);
          }
          count += countChapterRange(
            doc,
            index === start.index ? start.fragment : undefined,
            index === end.index ? end.fragment : undefined,
          );
        }
        row.wordCount = count;
      } catch {
        this.toc[i].countIncomplete = true;
      }
      if (!this.disposed) this.callbacks.toc([...this.toc]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  async display(target?: string, offset?: number, highlight = false) {
    if (this.disposed) return;
    const epoch = ++this.epoch;
    const item = this.book.spine.get(target);
    if (!item) throw new Error('无法定位此章节');
    const output = await item.render(this.book.load.bind(this.book));
    if (this.disposed || epoch !== this.epoch) return;
    const doc = new DOMParser().parseFromString(output, 'text/html');
    sanitizeDocument(doc);
    const style = doc.createElement('style');
    style.id = 'reader-theme';
    style.textContent = this.css();
    doc.head.append(style);
    this.section = item;
    this.title =
      this.toc.find((i) => typeof i.target === 'string' && i.target.split('#')[0] === item.href)?.label ||
      `章节 ${item.index + 1}`;
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('章节显示超时，请重新打开书籍')), 15000);
      this.frame.onload = () => {
        clearTimeout(timer);
        if (this.disposed || epoch !== this.epoch) {
          resolve();
          return;
        }
        try {
          const d = this.frame.contentDocument!,
            w = this.frame.contentWindow!;
          this.paintHighlights();
          const onSelect = () => {
            const selection = w.getSelection();
            if (!selection?.rangeCount || !selection.toString().trim()) return;
            const range = selection.getRangeAt(0);
            if (!d.body.contains(range.commonAncestorContainer)) return;
            const stableRange = range.cloneRange();
            const textBoundary = (container: Node, offset: number, end: boolean) => {
              if (container.nodeType === Node.TEXT_NODE) return { node: container, offset };
              const child = container.childNodes[end ? offset - 1 : offset];
              if (!child) return null;
              if (child.nodeType === Node.TEXT_NODE)
                return { node: child, offset: end ? child.textContent?.length || 0 : 0 };
              const walker = d.createTreeWalker(child, NodeFilter.SHOW_TEXT);
              let node = walker.nextNode(),
                last = node;
              if (end)
                while (node) {
                  last = node;
                  node = walker.nextNode();
                }
              const text = end ? last : node;
              return text ? { node: text, offset: end ? text.textContent?.length || 0 : 0 } : null;
            };
            const start = textBoundary(range.startContainer, range.startOffset, false);
            const end = textBoundary(range.endContainer, range.endOffset, true);
            if (start && end) {
              stableRange.setStart(start.node, start.offset);
              stableRange.setEnd(end.node, end.offset);
            }
            this.callbacks.select({
              text: selection.toString().trim(),
              cfi: new EpubCFI(stableRange, item.cfiBase).toString(),
            });
          };
          const onScroll = () => {
            const candidates = this.toc.filter(
              (t) => (this.book.spine.get(String(t.target))?.index ?? -1) <= item.index,
            );
            const active =
              candidates
                .filter((t) => {
                  if (this.book.spine.get(String(t.target))?.index !== item.index) return true;
                  const hash = String(t.target).split('#')[1];
                  return (
                    !hash ||
                    (d.getElementById(decodeURIComponent(hash))?.getBoundingClientRect().top ?? Infinity) <=
                      Math.max(80, w.innerHeight * 0.2)
                  );
                })
                .at(-1) || candidates[0];
            this.title = active?.label || this.title;
            this.callbacks.info({
              page: item.index + 1,
              total: (this.book.spine as any).length,
              label: this.title,
              count: d.body.innerText.length,
              tocTarget: active?.target,
            });
            let cfi = new EpubCFI(d.body, item.cfiBase).toString();
            try {
              const range = (d as any).caretRangeFromPoint(45, 35);
              if (range && d.body.contains(range.startContainer))
                cfi = new EpubCFI(range, item.cfiBase).toString();
            } catch {}
            this.callbacks.position({ cfi, offset: w.scrollY });
          };
          const onClick = (e: MouseEvent) => {
            const anchor = (e.target as Element)?.closest('a');
            const href = anchor?.getAttribute('href');
            if (!href) return;
            e.preventDefault();
            if (href.startsWith('#')) {
              d.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
              return;
            }
            if (/^[a-z]+:|^\/\//i.test(href)) return;
            const resolved = new URL(href, 'https://epub.local' + item.url);
            const relative = (this.book as any).path.relative(resolved.pathname) + (resolved.hash || '');
            void this.display(relative).catch((err) => this.callbacks.error(err.message));
          };
          d.addEventListener('mouseup', onSelect);
          d.addEventListener('keyup', onSelect);
          d.addEventListener('click', onClick);
          w.addEventListener('scroll', onScroll, { passive: true });
          this.cleanups.push(() => {
            d.removeEventListener('mouseup', onSelect);
            d.removeEventListener('keyup', onSelect);
            d.removeEventListener('click', onClick);
            w.removeEventListener('scroll', onScroll);
          });
          this.callbacks.info({
            page: item.index + 1,
            total: (this.book.spine as any).length,
            label: this.title,
            count: d.body.innerText.length,
          });
          if (target?.startsWith('epubcfi(')) this.locate(target, highlight);
          else if (target?.includes('#'))
            d.getElementById(decodeURIComponent(target.split('#')[1]))?.scrollIntoView();
          if (offset !== undefined) w.scrollTo(0, offset);
          onScroll();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      this.frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
    });
  }
  private css() {
    return epubTheme(this.settings);
  }
  apply(settings: Settings) {
    this.settings = settings;
    const el = this.frame.contentDocument?.getElementById('reader-theme');
    if (el) el.textContent = this.css();
  }
  private locate(cfi: string, highlight: boolean) {
    const doc = this.frame.contentDocument!,
      w = this.frame.contentWindow!;
    const range = new EpubCFI(cfi).toRange(doc);
    if (!range) return;
    const node =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    node?.scrollIntoView({ block: 'center' });
    if (highlight)
      for (const r of Array.from(range.getClientRects())) {
        const mark = doc.createElement('div');
        Object.assign(mark.style, {
          position: 'absolute',
          left: r.x + w.scrollX + 'px',
          top: r.y + w.scrollY + 'px',
          width: r.width + 'px',
          height: r.height + 'px',
          background: '#e5bb4866',
          pointerEvents: 'none',
          zIndex: '1000',
        });
        doc.body.append(mark);
        setTimeout(() => mark.remove(), 4500);
      }
  }
  async jump(target: string | number | SourceReference) {
    const value =
      typeof target === 'object'
        ? target.cfi
        : typeof target === 'number'
          ? (this.book.spine as any).get(target - 1)?.href
          : target;
    if (!value) return;
    const item = this.book.spine.get(value);
    if (item?.index === this.section?.index && value.startsWith('epubcfi('))
      this.locate(value, typeof target === 'object');
    else await this.display(value, undefined, typeof target === 'object');
  }
  async move(direction: number) {
    const w = this.frame.contentWindow,
      d = this.frame.contentDocument;
    if (!w || !d) return;
    if (
      (direction > 0 && w.scrollY + w.innerHeight < d.documentElement.scrollHeight - 5) ||
      (direction < 0 && w.scrollY > 5)
    ) {
      w.scrollBy({ top: direction * w.innerHeight * 0.9, behavior: 'smooth' });
      return;
    }
    const next = direction > 0 ? this.section.next() : this.section.prev();
    if (next) await this.display(next.href, direction < 0 ? Number.MAX_SAFE_INTEGER : undefined);
  }
  chapter(): SourceReference {
    const doc = this.frame.contentDocument;
    if (!doc || !this.section) throw new Error('当前章节尚未就绪');
    return {
      id: crypto.randomUUID(),
      bookId: this.meta.id,
      title: this.meta.title,
      label: this.title,
      text: doc.body.innerText.trim(),
      cfi: new EpubCFI(doc.body, this.section.cfiBase).toString(),
    };
  }
  destroy() {
    this.disposed = true;
    this.epoch++;
    this.cleanups.forEach((fn) => fn());
    this.frame.onload = null;
    this.frame.remove();
    try {
      this.book.destroy();
    } catch {}
  }
}
