import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/navigation-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
async function launch() {
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  const files = await fixtures();
  const pdf = await PDFDocument.load(new Uint8Array(files[0].bytes));
  const outline = pdf.context.obj({ Type: 'Outlines', Count: 2 });
  const root = pdf.context.register(outline);
  const a = pdf.context.obj({
    Title: PDFHexString.fromText('PDF 第一节'),
    Parent: root,
    Dest: [pdf.getPage(0).ref, PDFName.of('Fit')],
  });
  const b = pdf.context.obj({
    Title: PDFHexString.fromText('PDF 第二节'),
    Parent: root,
    Dest: [pdf.getPage(2).ref, PDFName.of('Fit')],
  });
  const ar = pdf.context.register(a),
    br = pdf.context.register(b);
  a.set(PDFName.of('Next'), br);
  b.set(PDFName.of('Prev'), ar);
  outline.set(PDFName.of('First'), ar);
  outline.set(PDFName.of('Last'), br);
  pdf.catalog.set(PDFName.of('Outlines'), root);
  files[0].bytes = Array.from(await pdf.save());
  const zip = await JSZip.loadAsync(new Uint8Array(files[1].bytes));
  const first = await zip.file('OEBPS/c1.xhtml').async('string');
  zip.file(
    'OEBPS/c1.xhtml',
    first
      .replace('<html ', '<html xmlns:epub="http://www.idpf.org/2007/ops" ')
      .replace(
        '</body>',
        '<p>正文中的注意事项应保留。<sup><a epub:type="noteref" href="#n1"><img zy-footnote="脚注内容" src="missing-note.png"/></a></sup></p><aside epub:type="footnote" id="n1"><p>需要隐藏的脚注内容</p></aside><p role="doc-endnote">需要隐藏的尾注</p></body>',
      ),
  );
  files[1].bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }));
  await launch();
  await page.evaluate(
    async (input) => window.reader.importBooks(input.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) }))),
    files,
  );
  await app.close();
  await launch();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.toc-row small').length === 2 &&
      Array.from(document.querySelectorAll('.toc-row small')).every((n) => /[\d,]+ 字/.test(n.textContent)),
  );
  assert.ok(
    (await page.getByRole('button', { name: 'PDF 第一节', exact: true }).innerText()).match(/[1-9][\d,]* 字/),
  );
  assert.ok(
    (await page.getByRole('button', { name: 'PDF 第二节', exact: true }).innerText()).includes('含未识别页'),
  );
  await page.getByRole('button', { name: 'PDF 第二节', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="跳转页码"]').value === '3');
  assert.equal(
    await page.locator('.toc-row[aria-current="location"]').getAttribute('aria-label'),
    'PDF 第二节',
  );
  await page.getByRole('spinbutton', { name: '跳转页码', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: '跳转页码', exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelector('input[aria-label="跳转页码"]').value === '2');
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await page.locator('.book-select').filter({ hasText: 'EPUB' }).click();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 思考', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
      '第2章 阅读的开始',
  );
  await page.getByRole('button', { name: '第一章 阅读的开始', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
      '第1章 阅读的开始',
  );
  const beforeButtons = await page.locator('.reader-footer > button').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
  );
  assert.equal(await page.locator('.reader-footer button').count(), 2);
  await page.getByRole('button', { name: '第二章 思考', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
      '第2章 阅读的开始',
  );
  const afterButtons = await page.locator('.reader-footer > button').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
  );
  assert.deepEqual(afterButtons, beforeButtons);
  await page.getByRole('button', { name: '第一章 阅读的开始', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
      '第1章 阅读的开始',
  );
  const notes = await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument;
    return {
      display: Array.from(d.querySelectorAll('[data-reader-note]')).map(
        (n) => d.defaultView.getComputedStyle(n).display,
      ),
      text: d.body.innerText,
    };
  });
  assert.ok(notes.display.length >= 4);
  assert.ok(notes.display.every((d) => d === 'none'));
  assert.ok(notes.text.includes('正文中的注意事项应保留'));
  assert.ok(!notes.text.includes('需要隐藏的'));
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.toc-row small')).every((n) => /[\d,]+ 字/.test(n.textContent)),
  );
  const activeRow = page.locator('.toc-row[aria-current="location"]');
  assert.equal(await activeRow.getAttribute('aria-label'), '第一章 阅读的开始');
  const expectedCharacters = Array.from(notes.text.replace(/\s/g, '')).length;
  const shownCharacters = Number((await activeRow.locator('small').innerText()).replace(/[^\d]/g, ''));
  assert.equal(shownCharacters, expectedCharacters);
  await page.getByRole('button', { name: '第二章 思考', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.toc-row[aria-current="location"]')?.getAttribute('aria-label') ===
      '第二章 思考',
  );
  await page.screenshot({ path: 'test-results/toc-word-count.png' });
  assert.equal(await page.getByRole('button', { name: '阅读导航', exact: true }).count(), 0);
  console.log(
    'PASS: PDF page and chapter jump, EPUB sidebar chapters and word counts, fixed footer, hidden notes, no overview button.',
  );
} finally {
  if (app) await app.close();
}
