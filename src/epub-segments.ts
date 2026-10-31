import { textCount } from './text-count';

export function chapterBlocks(doc: Document) {
  const elements = Array.from(
    doc.body.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figcaption,table'),
  );
  for (const el of doc.body.querySelectorAll<HTMLElement>('div')) {
    if (!el.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figcaption,table,div')) elements.push(el);
  }
  elements.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  return elements.filter(
    (el) =>
      !el.closest('[data-reader-ui]') &&
      el.innerText.trim() &&
      !elements.some((parent) => parent !== el && parent.contains(el)) &&
      getComputedStyle(el).display !== 'none',
  );
}

/** Mark existing block ranges without wrapping or changing book DOM/CFI offsets. */
export function showSegments(doc: Document, blocks: HTMLElement[], ends: number[]) {
  const layer = doc.createElement('div');
  layer.dataset.readerUi = 'segments';
  Object.assign(layer.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '0',
    pointerEvents: 'none',
    zIndex: '5',
  });
  let start = 0;
  const marks = ends.map((end, i) => {
    const first = start;
    const text = blocks
      .slice(start, end)
      .map((el) => el.innerText)
      .join('\n\n');
    start = end;
    const mark = doc.createElement('div');
    const copy = doc.createElement('button');
    copy.textContent = `${i + 1} · ${textCount(text).toLocaleString()} 字 · 复制`;
    copy.title = '复制本段原文';
    Object.assign(copy.style, {
      pointerEvents: 'auto',
      position: 'absolute',
      top: '-6px',
      transform: 'translateY(-100%)',
      left: '4px',
      whiteSpace: 'nowrap',
      fontSize: '11px',
      border: '1px solid #8d9d83',
      borderRadius: '6px',
      background: 'var(--reader-segment-bg, #eef2e8)',
      color: 'var(--reader-segment-ink, #304332)',
      padding: '4px 8px',
      cursor: 'pointer',
    });
    copy.onclick = () => {
      void window.reader
        .copyText(text)
        .then(() => {
          copy.textContent = `第 ${i + 1} 段 · 已复制`;
        })
        .catch(() => {
          copy.textContent = '复制失败，请重试';
        });
    };
    Object.assign(mark.style, {
      position: 'absolute',
      left: '8px',
      width: '0',
      borderLeft: '2px solid #93a985',
      borderRadius: '2px',
    });
    mark.append(copy);
    layer.append(mark);
    return { mark, first, end };
  });
  doc.body.append(layer);
  const update = () =>
    marks.forEach(({ mark, first, end }) => {
      const top = blocks[first].getBoundingClientRect().top + doc.defaultView!.scrollY;
      const bottom = blocks[end - 1].getBoundingClientRect().bottom + doc.defaultView!.scrollY;
      mark.style.top = top + 'px';
      mark.style.height = Math.max(10, bottom - top) + 'px';
    });
  update();
  const observer = new ResizeObserver(update);
  observer.observe(doc.body);
  doc.defaultView?.addEventListener('resize', update);
  return () => {
    observer.disconnect();
    doc.defaultView?.removeEventListener('resize', update);
    layer.remove();
  };
}
