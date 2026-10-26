import { _electron as electron } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/conversion-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  await launch();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1200, 1600);
    ctx.fillStyle = 'black';
    ctx.font = '42px "Microsoft YaHei"';
    ctx.fillText('扫描页面转换测试', 100, 150);
    ctx.fillText('阅读让我们认真思考每一个问题。', 100, 280);
    ctx.fillText('Reading brings new ideas.', 100, 400);
    return Array.from(
      Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (c) => c.charCodeAt(0)),
    );
  });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText('Original selectable PDF paragraph.', { x: 50, y: 700, font, size: 22 });
  const image = await doc.embedPng(new Uint8Array(png));
  doc.addPage([600, 800]).drawImage(image, { x: 0, y: 0, width: 600, height: 800 });
  const original = Array.from(await doc.save());
  await page.evaluate(
    async (bytes) => window.reader.importBooks([{ name: '混合转换测试.pdf', bytes: new Uint8Array(bytes) }]),
    original,
  );
  await app.close();
  await launch();
  const button = page.getByRole('button', { name: '一键转 EPUB', exact: true });
  await button.waitFor();
  await button.click();
  await page.getByRole('dialog', { name: 'PDF 转 EPUB 进度' }).waitFor();
  await page.getByRole('button', { name: '取消转换', exact: true }).click();
  await page.getByRole('dialog', { name: 'PDF 转 EPUB 进度' }).waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.reader.snapshot())).books.length, 1);
  await button.click();
  await page.getByRole('button', { name: '导出 EPUB', exact: true }).waitFor({ timeout: 120000 });
  const books = (await page.evaluate(() => window.reader.snapshot())).books;
  assert.equal(books.length, 2);
  const epub = books.find((b) => b.format === 'epub');
  const source = books.find((b) => b.format === 'pdf');
  const convertedBytes = await page.evaluate(
    async (id) => Array.from(await window.reader.bookBytes(id)),
    epub.id,
  );
  const exportPath = path.join(dir, 'exported.epub');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole('button', { name: '导出 EPUB', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('EPUB 已导出'));
  assert.deepEqual(Array.from(readFileSync(exportPath)), convertedBytes);
  const zip = await JSZip.loadAsync(new Uint8Array(convertedBytes));
  assert.match(await zip.file('OEBPS/page-1.xhtml').async('string'), /Original selectable PDF paragraph/);
  const scanned = await zip.file('OEBPS/page-2.xhtml').async('string');
  assert.match(scanned, /阅读/);
  assert.match(scanned, /Reading/);
  assert.match(scanned, /OCR/);
  assert.deepEqual(
    await page.evaluate(async (id) => Array.from(await window.reader.bookBytes(id)), source.id),
    original,
  );
  await page.waitForFunction(() =>
    document.querySelector('iframe')?.contentDocument?.body?.textContent?.includes('Original selectable'),
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第 2 页', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('iframe')?.contentDocument?.body?.textContent?.includes('阅读'),
  );
  await page.screenshot({ path: 'test-results/converted-epub.png' });
  await app.close();
  await launch();
  await page.getByRole('button', { name: '导出 EPUB', exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('iframe')?.contentDocument?.body?.textContent?.includes('阅读'),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: cancelled conversion creates no book; mixed PDF extracts text and real offline OCR into EPUB; original bytes preserved, table of contents and restart restoration work.',
  );
} finally {
  if (app) await app.close();
}
