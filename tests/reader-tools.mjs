import { _electron as electron } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/ocr-profile-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch(
    process.argv.includes('--packaged')
      ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env }
      : { args: ['.'], env },
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(25000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  await launch();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1700;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1200, 1700);
    ctx.fillStyle = 'black';
    ctx.font = 'bold 46px "Microsoft YaHei"';
    ctx.fillText('扫描书籍阅读测试', 100, 150);
    ctx.font = '36px "Microsoft YaHei"';
    [
      '阅读让我们认真思考每一个问题。',
      '第二个段落帮助我们理解原文。',
      'Reading brings new ideas.',
      'A book is a conversation with the author.',
    ].forEach((t, i) => ctx.fillText(t, 100, 270 + i * 110));
    return Array.from(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (x) => x.charCodeAt(0)));
  });
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(new Uint8Array(png));
  for (let i = 0; i < 3; i++) {
    const p = pdf.addPage([600, 850]);
    p.drawImage(image, { x: 0, y: 0, width: 600, height: 850 });
  }
  await page.evaluate(
    async (bytes) => window.reader.importBooks([{ name: '扫描识别测试.pdf', bytes: new Uint8Array(bytes) }]),
    Array.from(await pdf.save()),
  );
  await app.close();
  await launch();
  await page.locator('.scan-warning').first().waitFor();
  await page.getByRole('button', { name: '识别本页', exact: true }).click();
  await page.getByRole('region', { name: 'OCR 识别结果' }).waitFor({ timeout: 120000 });
  const text = await page.getByRole('textbox', { name: '识别文字', exact: true }).inputValue();
  console.log('OCR text:', text);
  assert.match(text, /阅读/);
  assert.match(text, /Reading/i);
  assert.ok((await page.locator('[data-page="1"] .ocr-text-layer span').count()) > 3);
  await page.getByRole('button', { name: '复制全文', exact: true }).click();
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(clipboard, text);
  await page.screenshot({ path: 'test-results/ocr-result.png' });
  await page.getByRole('button', { name: '关闭识别结果', exact: true }).click();
  const lines = page.locator('[data-page="1"] .ocr-text-layer span');
  const a = await lines.nth(1).boundingBox(),
    b = await lines.nth(2).boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.getByRole('button', { name: '引用到聊天', exact: true }).waitFor();
  await page.keyboard.press('Control+c');
  await page.getByRole('textbox', { name: '聊天输入框' }).click();
  await page.keyboard.press('Control+v');
  assert.ok((await page.getByRole('textbox', { name: '聊天输入框' }).inputValue()).includes('阅读'));
  await page.getByRole('button', { name: '引用到聊天', exact: true }).click();
  assert.match(await page.locator('.draft-quote').innerText(), /OCR/);
  await page.getByRole('checkbox', { name: '附加当前章节' }).check();
  await page.getByRole('button', { name: '预览范围', exact: true }).click();
  await page.locator('.context-preview').waitFor();
  await page.getByRole('combobox', { name: 'PDF 缩放比例', exact: true }).selectOption('2');
  await page.getByRole('button', { name: '拖动模式', exact: true }).click();
  const bounds = await page.locator('.pdf-viewport').boundingBox();
  const before = await page
    .locator('.pdf-viewport')
    .evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7 - 120, bounds.y + bounds.height * 0.5 - 100, {
    steps: 12,
  });
  await page.mouse.up();
  const after = await page.locator('.pdf-viewport').evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
  assert.ok(after.x > before.x + 50);
  assert.ok(after.y > before.y + 50);
  await page.getByRole('button', { name: '选文模式', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '选文模式', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  await page.waitForFunction(() => {
    const sheet = document.querySelector('.pdf-sheet'),
      root = document.querySelector('.pdf-viewport');
    return sheet.clientWidth <= root.clientWidth && sheet.clientWidth > root.clientWidth - 65;
  });
  await page.getByRole('combobox', { name: 'PDF 缩放比例', exact: true }).selectOption('0.25');
  assert.equal(await page.getByRole('combobox', { name: 'PDF 缩放比例', exact: true }).inputValue(), '0.25');
  await page.getByRole('combobox', { name: 'PDF 缩放比例', exact: true }).selectOption('4');
  assert.equal(await page.getByRole('combobox', { name: 'PDF 缩放比例', exact: true }).inputValue(), '4');
  await page.getByRole('button', { name: '实际大小', exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="PDF 缩放比例"]').value) > 1);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),
    1,
  );
  await page.mouse.click(bounds.x + bounds.width - 15, bounds.y + 30);
  await page.keyboard.down('Space');
  await page.locator('.pdf-viewport.pan-mode').waitFor();
  await page.keyboard.up('Space');
  await page.waitForFunction(() => !document.querySelector('.pdf-viewport.pan-mode'));
  await page.screenshot({ path: 'test-results/zoom-pan.png' });
  await app.close();
  await launch();
  await page.locator('.ocr-text-layer span').first().waitFor();
  const cached = await page.evaluate(async () => {
    const s = await window.reader.snapshot();
    return window.reader.ocrPages(s.books[0].id);
  });
  assert.equal(cached.length, 1);
  assert.match(cached[0].text, /阅读/);
  await page.getByRole('button', { name: '识别本页', exact: true }).click();
  await page.getByRole('region', { name: 'OCR 识别结果' }).waitFor();
  assert.equal(await page.locator('.ocr-progress').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real offline Chinese/English OCR, page text layer selection/clipboard, OCR quote/chapter, cached restart, 25–400% zoom, fit width, drag, space pan, Ctrl-wheel.',
  );
} catch (error) {
  console.error(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: 'test-results/reader-tools-failure.png' }).catch(() => {});
    console.log(await page.locator('body').innerText());
  }
  throw error;
} finally {
  if (app) await app.close();
}
