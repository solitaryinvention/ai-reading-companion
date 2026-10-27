import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import initSqlJs from 'sql.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/removed-highlights-' + Date.now());
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
  const imported = await page.evaluate(
    async (files) => window.reader.importBooks(files.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) }))),
    await fixtures(),
  );
  await app.close();
  const SQL = await initSqlJs();
  const file = path.join(dir, 'library.sqlite');
  const db = new SQL.Database(readFileSync(file));
  const book = imported.books.find((b) => b.format === 'pdf');
  db.run('INSERT INTO records VALUES (?,?,?)', [
    'highlight',
    'legacy-highlight',
    JSON.stringify({
      id: 'legacy-highlight',
      bookId: book.id,
      page: 1,
      text: 'Legacy text',
      rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.1 }],
    }),
  ]);
  writeFileSync(file, db.export());
  db.close();
  await launch();
  for (const format of ['PDF', 'EPUB']) {
    await page.locator('.book-select').filter({ hasText: format }).click();
    if (format === 'PDF') await page.locator('.pdf-sheet[data-ready="true"]').first().waitFor();
    else
      await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('p'));
    assert.equal(await page.getByRole('button', { name: '书籍划线', exact: true }).count(), 0);
    assert.equal(await page.locator('.saved-pdf-highlight,.selection-bar').count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          'highlights' in window.reader ||
          'saveHighlight' in window.reader ||
          'removeHighlight' in window.reader,
      ),
      false,
    );
  }
  await app.close();
  app = null;
  const check = new SQL.Database(readFileSync(file));
  assert.equal(check.exec("SELECT COUNT(*) FROM records WHERE kind='highlight'")[0].values[0][0], 1);
  check.close();
  console.log(
    'PASS: highlight entry, overlays and floating selection bar removed; legacy records retained and IPC removed.',
  );
} finally {
  await app?.close();
}
