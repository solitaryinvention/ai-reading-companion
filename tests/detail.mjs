import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/detail-' + Date.now());
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
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  await launch();
  await page.evaluate(
    async (files) => window.reader.importBooks(files.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) }))),
    await fixtures(),
  );
  await app.close();
  await launch();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.getByRole('button', { name: '讲解 · 标准', exact: true }).click();
  const panel = page.getByRole('group', { name: '讲解详略', exact: true });
  await panel.getByRole('button', { name: '深入', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.reader.snapshot()).books.find((b) => b.format === 'pdf').detailLevel === 5,
  );
  await page.screenshot({ path: 'test-results/detail-selector.png' });
  const box = await panel.boundingBox();
  const size =
    page.viewportSize() || (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  assert.ok(box.y >= 0 && box.x >= 0 && box.x + box.width <= size.width);
  await page.getByRole('slider', { name: '讲解详略档位' }).focus();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: '讲解 · 极简', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await panel.count(), 0);
  await page.waitForFunction(
    async () => (await window.reader.snapshot()).books.find((b) => b.format === 'pdf').detailLevel === 1,
  );
  await page.locator('.book-select').filter({ hasText: 'EPUB' }).click();
  await page.getByRole('button', { name: '讲解 · 标准', exact: true }).waitFor();
  await app.close();
  await launch();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.getByRole('button', { name: '讲解 · 极简', exact: true }).waitFor();
  console.log(
    'PASS: five-level popup, keyboard selection, no clipping, book isolation and restart persistence.',
  );
} finally {
  await app?.close();
}
