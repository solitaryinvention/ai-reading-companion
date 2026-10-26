import JSZip from 'jszip';
import { createHash } from 'node:crypto';

export interface ConvertedPage {
  page: number;
  text: string;
  label: string;
  ocr: boolean;
}
const xml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );

/** Reflowable EPUB 3: stable page anchors preserve traceability to the source PDF. */
export async function createEpub(title: string, sourceId: string, pages: ConvertedPage[]) {
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.length > 20000 ||
    pages.some(
      (p, i) =>
        p.page !== i + 1 || typeof p.text !== 'string' || typeof p.label !== 'string' || p.label.length > 500,
    )
  )
    throw new Error('转换页面数据无效');
  if (pages.reduce((sum, p) => sum + p.text.length, 0) > 25000000)
    throw new Error('转换文字超过 2500 万字符，请拆分 PDF 后转换');
  if (!pages.some((p) => p.text.trim()))
    throw new Error('未提取或识别出正文，未生成空 EPUB。请检查扫描清晰度或文件是否受保护');
  const zip = new JSZip();
  const stamp = new Date('2000-01-01T00:00:00Z');
  const put = (name: string, text: string, compression: 'STORE' | 'DEFLATE' = 'DEFLATE') =>
    zip.file(name, text, { compression, date: stamp });
  put('mimetype', 'application/epub+zip', 'STORE');
  put(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const id = createHash('sha256').update(JSON.stringify({ title, sourceId, pages })).digest('hex');
  const head = (label: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><title>${xml(label)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head><body>`;
  put(
    'OEBPS/style.css',
    'body{line-height:1.9;margin:1em;}p{text-indent:2em;margin:.7em 0;}h1{font-size:1.4em}.source{font-size:.8em;color:#777;text-indent:0}',
  );
  for (const p of pages) {
    const paragraphs = p.text
      .trim()
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((t) => `<p>${xml(t).replace(/\n/g, '<br/>')}</p>`)
      .join('');
    put(
      `OEBPS/page-${p.page}.xhtml`,
      head(p.label) +
        `<section id="pdf-page-${p.page}"><h1>${xml(p.label)}</h1><p class="source">原 PDF 第 ${p.page} 页${p.ocr ? ' · OCR 识别，请核对原图' : ''}</p>${paragraphs || '<p>本页未识别出文字；请查阅原 PDF 页面。</p>'}</section></body></html>`,
    );
  }
  put(
    'OEBPS/nav.xhtml',
    head('目录') +
      `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${pages.map((p) => `<li><a href="page-${p.page}.xhtml">${xml(p.label)}</a></li>`).join('')}</ol></nav></body></html>`,
  );
  put(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${xml(title)}</text></docTitle><navMap>${pages.map((p) => `<navPoint id="p${p.page}" playOrder="${p.page}"><navLabel><text>${xml(p.label)}</text></navLabel><content src="page-${p.page}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`,
  );
  put(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:sha256:${id}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:language>zh-CN</dc:language><dc:source>urn:sha256:${xml(sourceId)}</dc:source><dc:description>由 PDF 提取为可重排文字，图片、表格与原始版式未保留，OCR 文字需核对原图。</dc:description><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${pages.map((p) => `<item id="p${p.page}" href="page-${p.page}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine toc="ncx">${pages.map((p) => `<itemref idref="p${p.page}"/>`).join('')}</spine></package>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
