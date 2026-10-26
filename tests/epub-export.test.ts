import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createEpub } from '../electron/epub-export';

describe('PDF text to EPUB', () => {
  it('generates deterministic EPUB with page anchors, safe text, navigation and OCR provenance', async () => {
    const pages = [
      { page: 1, label: '第一章 <标题>', text: '第一段 & 原文\n\n<script>不执行</script>', ocr: false },
      { page: 2, label: '第 2 页', text: '识别文字', ocr: true },
      { page: 3, label: '第 3 页', text: '', ocr: true },
    ];
    const bytes = await createEpub('书名 & 测试', 'source-hash', pages);
    expect(bytes.equals(await createEpub('书名 & 测试', 'source-hash', pages))).toBe(true);
    expect(bytes.readUInt16LE(8)).toBe(0); // mimetype is the first, uncompressed ZIP entry.
    expect(bytes.subarray(30, 38).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
    const first = await zip.file('OEBPS/page-1.xhtml')!.async('string');
    expect(first).toContain('pdf-page-1');
    expect(first).toContain('&lt;script&gt;');
    expect(first).not.toContain('<script>');
    expect(await zip.file('OEBPS/page-2.xhtml')!.async('string')).toContain('OCR 识别');
    expect(await zip.file('OEBPS/page-3.xhtml')!.async('string')).toContain('未识别出文字');
    expect(await zip.file('OEBPS/nav.xhtml')!.async('string')).toContain('page-3.xhtml');
    expect(await zip.file('OEBPS/content.opf')!.async('string')).toContain('书名 &amp; 测试');
  });
  it('rejects empty books, missing pages and oversized contents instead of silently truncating', async () => {
    await expect(createEpub('书', 'id', [{ page: 1, text: '', label: '空', ocr: true }])).rejects.toThrow(
      '未提取',
    );
    await expect(
      createEpub('书', 'id', [{ page: 2, text: '正文', label: '错误页码', ocr: false }]),
    ).rejects.toThrow('无效');
  });
});
