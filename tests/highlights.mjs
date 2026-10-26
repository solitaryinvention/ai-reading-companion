import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/highlights-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
async function launch() {
  app = await electron.launch(
    process.argv.includes('--packaged')
      ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env }
      : { args: ['.'], env },
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  await launch();
  await page.evaluate(
    async (input) => window.reader.importBooks(input.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) }))),
    await fixtures(),
  );
  await app.close();
  await launch();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.locator('.pdf-sheet[data-ready="true"] .textLayer span').first().waitFor();
  await page.evaluate(() => {
    const span = document.querySelector('.pdf-sheet .textLayer span');
    const r = document.createRange();
    r.selectNodeContents(span);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '保存划线', exact: true }).click();
  await page.locator('.saved-pdf-highlight').first().waitFor();
  const state = await page.evaluate(() => window.reader.snapshot());
  const pdf = state.books.find((b) => b.format === 'pdf'),
    epub = state.books.find((b) => b.format === 'epub');
  assert.equal((await page.evaluate((id) => window.reader.highlights(id), pdf.id)).length, 1);
  assert.equal((await page.evaluate((id) => window.reader.highlights(id), epub.id)).length, 0);
  await page.locator('.book-select').filter({ hasText: 'EPUB' }).click();
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('p'));
  await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument;
    const r = d.createRange();
    r.selectNodeContents(d.querySelector('p'));
    const s = d.defaultView.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    d.querySelector('p').dispatchEvent(new d.defaultView.MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '保存划线', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('iframe').contentWindow.CSS.highlights.get('saved-reading')?.size === 1,
  );
  await page.getByRole('combobox', { name: '字号', exact: true }).selectOption('24');
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelector('iframe').contentWindow.CSS.highlights.get('saved-reading')][0]
        .toString()
        .includes('认真思考每一个问题'),
    ),
  );
  await app.close();
  await launch();
  await page.waitForFunction(
    () => document.querySelector('iframe')?.contentWindow.CSS.highlights.get('saved-reading')?.size === 1,
  );
  await page.screenshot({ path: 'test-results/persistent-highlight.png' });
  await page.getByRole('button', { name: '书籍划线', exact: true }).click();
  await page.getByRole('button', { name: '删除划线', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('iframe').contentWindow.CSS.highlights.get('saved-reading')?.size === 0,
  );
  await page.getByRole('button', { name: '关闭划线列表', exact: true }).click();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.locator('.saved-pdf-highlight').first().waitFor();
  await page.getByRole('button', { name: '书籍划线', exact: true }).click();
  await page.getByRole('button', { name: '删除划线', exact: true }).click();
  assert.equal((await page.evaluate((id) => window.reader.highlights(id), pdf.id)).length, 0);
  console.log(
    'PASS: PDF and EPUB native selection highlights, book isolation, font reflow, restart restoration and deletion.',
  );
} finally {
  if (app) await app.close();
}
