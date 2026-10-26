import type JSZip from 'jszip';

export function hideBookNotes(doc: ParentNode) {
  for (const node of Array.from(doc.querySelectorAll('*'))) {
    const type =
      node.getAttribute('epub:type') || node.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '';
    const role = node.getAttribute('role') || '';
    if (
      type.split(/\s+/).some((t) => ['noteref', 'footnote', 'endnote', 'rearnote'].includes(t)) ||
      /^(doc-noteref|doc-footnote|doc-endnote|doc-endnotes)$/.test(role) ||
      node.hasAttribute('zy-footnote')
    ) {
      node.setAttribute('data-reader-note', 'hidden');
      node.setAttribute('aria-hidden', 'true');
    }
  }
}

/** Embed only archive-owned images: srcdoc cannot resolve a book's relative URLs. */
export async function embedBookImages(doc: Document, sectionUrl: string, zip: JSZip) {
  const missing = (label: string) =>
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100" viewBox="0 0 600 100"><rect width="600" height="100" fill="#eceee7"/><text x="300" y="56" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#7c8476">${label}</text></svg>`,
    );
  const mime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
  };
  for (const image of Array.from(doc.querySelectorAll('img,svg image'))) {
    if (image.closest('[data-reader-note]')) continue;
    const attr =
      image.tagName.toLowerCase() === 'img' ? 'src' : image.hasAttribute('href') ? 'href' : 'xlink:href';
    const source = image.getAttribute(attr) || '';
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    const parent = image.closest('p');
    // Inline footnote icons must not turn an entire prose paragraph into a centered figure.
    if (parent && !parent.textContent?.trim()) parent.classList.add('reader-media');
    if (/^(data:image\/|blob:)/i.test(source)) continue;
    let data: string | undefined;
    if (source && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(source)) {
      try {
        const url = new URL(source, new URL(sectionUrl, 'https://epub.local/'));
        const name = decodeURIComponent(url.pathname).replace(/^\//, '');
        let entry = zip.file(name);
        // Some books have mismatched case between XHTML and ZIP entries.
        if (!entry) {
          const matches = Object.keys(zip.files).filter((n) => n.toLowerCase() === name.toLowerCase());
          if (matches.length === 1) entry = zip.file(matches[0]);
        }
        const type = mime[name.split('.').pop()?.toLowerCase() || ''];
        if (entry && type) data = `data:${type};base64,` + (await entry.async('base64'));
      } catch {
        /* A malformed or absent resource gets a visible placeholder. */
      }
    }
    image.setAttribute(attr, data || missing('图片资源缺失或被阻止'));
    image.setAttribute('data-reader-image', data ? 'embedded' : 'missing');
    if (!data) image.setAttribute('aria-label', '图片资源缺失或被阻止');
  }
}
