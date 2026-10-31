/** Installed by the trusted reader, never by book scripts. */
export function installSelectionCopy(doc: Document) {
  let button: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    button?.remove();
    button = undefined;
  };
  const up = (event: MouseEvent) => {
    if ((event.target as Element)?.closest('[data-reader-ui]')) return;
    const selected = doc.getSelection();
    if (!selected?.toString().trim() || (doc === document && !selected.anchorNode?.parentElement?.closest('.pdf-sheet,.conversation'))) return;
    event.preventDefault();
    clearTimeout(timer);
    timer = setTimeout(() => {
      const selection = doc.getSelection();
      const text = selection?.toString();
      clear();
      if (!text?.trim() || !selection?.rangeCount) return;
      const node = selection.anchorNode?.parentElement;
      if (doc === document && !node?.closest('.pdf-sheet,.conversation')) return;
      if (node?.closest('textarea,input,[data-reader-ui]')) return;
      button = doc.createElement('button');
      button.dataset.readerUi = 'copy';
      button.textContent = '⧉ 复制';
      button.setAttribute('aria-label', '复制选中文字');
      Object.assign(button.style, {
        position: 'fixed',
        zIndex: '2147483647',
        left: Math.max(8, Math.min(event.clientX + 4, (doc.defaultView?.innerWidth || 600) - 90)) + 'px',
        top: Math.max(8, Math.min(event.clientY + 4, (doc.defaultView?.innerHeight || 600) - 44)) + 'px',
        padding: '8px 16px',
        border: '1px solid #b6c2b3',
        borderRadius: '8px',
        background: '#f8faf6',
        color: '#263d2b',
        cursor: 'pointer',
        fontSize: '14px',
        boxShadow: '0 3px 12px #0002',
      });
      button.onpointerdown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      button.onclick = () => {
        void window.reader
          .copyText(text)
          .then(clear)
          .catch(() => {
            if (button) button.textContent = '复制失败';
          });
      };
      doc.body.append(button);
    }, 0);
  };
  const down = (event: Event) => {
    if (!(event.target as Element)?.closest('[data-reader-ui]')) clear();
  };
  doc.addEventListener('contextmenu', up);
  doc.addEventListener('pointerdown', down);
  doc.defaultView?.addEventListener('scroll', clear, true);
  return () => {
    clearTimeout(timer);
    clear();
    doc.removeEventListener('contextmenu', up);
    doc.removeEventListener('pointerdown', down);
    doc.defaultView?.removeEventListener('scroll', clear, true);
  };
}

export function readerBodyText(doc: Document) {
  const ui = Array.from(doc.querySelectorAll<HTMLElement>('[data-reader-ui]'));
  const previous = ui.map((el) => el.style.display);
  ui.forEach((el) => {
    el.style.display = 'none';
  });
  const text = doc.body.innerText;
  ui.forEach((el, i) => {
    el.style.display = previous[i];
  });
  return text;
}
