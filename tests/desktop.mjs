import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dataDir = path.resolve('test-results/profile-' + Date.now());
mkdirSync(dataDir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
async function launch() {
  app = await electron.launch(
    process.argv.includes('--packaged')
      ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env }
      : { args: ['.'], env },
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('renderer:', m.text());
  });
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  await launch();
  await page.screenshot({ path: 'test-results/empty.png' });
  const books = await fixtures();
  const imported = await page.evaluate(
    async (files) => window.reader.importBooks(files.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) }))),
    books,
  );
  assert.equal(imported.errors.length, 0);
  assert.equal(imported.books.length, 2);
  const duplicate = await page.evaluate(
    async (f) => window.reader.importBooks([{ ...f, bytes: new Uint8Array(f.bytes) }]),
    books[0],
  );
  assert.equal(duplicate.books[0].id, imported.books[0].id);
  await app.close();
  await launch();
  await page.locator('.reader-overlay').waitFor({ state: 'hidden' });
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.locator('[data-page="1"][data-ready="true"]').waitFor();
  const spans = page.locator('.textLayer span');
  const box1 = await spans.nth(1).boundingBox();
  const box2 = await spans.nth(2).boundingBox();
  assert.ok(box1 && box2);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.move(box1.x + 1, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width - 1, box2.y + box2.height / 2, { steps: 20 });
    await page.mouse.up();
    if ((await page.evaluate(() => getSelection()?.toString() || '')).includes('book invites')) break;
  }
  assert.equal(await page.locator('.selection-bar').count(), 0);
  assert.equal(await page.getByRole('button', { name: '书籍划线', exact: true }).count(), 0);
  await page.keyboard.press('Control+c');
  await page.getByRole('textbox', { name: '聊天输入框' }).click();
  await page.keyboard.press('Control+v');
  const pasted = await page.getByRole('textbox', { name: '聊天输入框' }).inputValue();
  assert.ok(pasted.includes('book invites'), pasted);
  assert.equal(await page.locator('.draft-quote').count(), 0);
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('请解释这段原文');
  await page.getByRole('checkbox', { name: '附加当前章节' }).check();
  await page.getByRole('button', { name: '预览范围', exact: true }).click();
  await page.locator('.context-preview').waitFor();
  assert.match(await page.locator('.context-preview').innerText(), /第 1–1 页/);
  await page.screenshot({ path: 'test-results/pdf.png' });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="跳转页码"]').value === '2');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByText('此 PDF 没有目录，可在右下方输入页码跳转。').waitFor();
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await page.locator('.book-select').filter({ hasText: 'EPUB' }).click();
  console.log('stage: EPUB selected');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('p'));
  console.log('stage: EPUB body visible');
  assert.equal(
    await page.evaluate(
      () => document.querySelector('iframe').contentDocument.querySelectorAll('script').length,
    ),
    0,
  );
  assert.equal(await page.evaluate(() => window.__epubScriptExecuted), undefined);
  await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument;
    const s = d.createElement('script');
    s.textContent = 'window.parent.__epubScriptExecuted=true';
    d.body.append(s);
    s.remove();
  });
  assert.equal(await page.evaluate(() => window.__epubScriptExecuted), undefined);
  console.log('stage: EPUB script checks');
  const [a, b] = await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    const origin = frame.getBoundingClientRect();
    return Array.from(frame.contentDocument.querySelectorAll('p'))
      .slice(0, 2)
      .map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.x + origin.x, y: r.y + origin.y, width: r.width, height: r.height };
      });
  });
  assert.ok(a && b);
  console.log('stage: EPUB geometry', a, b);
  await page.mouse.move(a.x + 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 5, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
  console.log('stage: EPUB drag');
  assert.equal(await page.locator('.selection-bar').count(), 0);
  await page.keyboard.press('Control+c');
  await page.getByRole('textbox', { name: '聊天输入框' }).click();
  await page.keyboard.press('Control+v');
  assert.ok((await page.getByRole('textbox', { name: '聊天输入框' }).inputValue()).includes('我们'));
  assert.equal(await page.locator('.draft-quote').count(), 0);
  console.log('stage: EPUB native copy');
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('EPUB 草稿应该保存');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 思考', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
      '第2章 阅读的开始',
  );
  await page.screenshot({ path: 'test-results/epub.png' });
  await page.waitForFunction(async () => {
    const s = await window.reader.snapshot();
    return s.books.find((b) => b.format === 'epub')?.position?.cfi?.startsWith('epubcfi(/6/4');
  });
  await app.close();
  await launch();
  await page.waitForFunction(
    () =>
      document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
      '第2章 阅读的开始',
  );
  assert.equal(await page.getByRole('textbox', { name: '聊天输入框' }).inputValue(), 'EPUB 草稿应该保存');
  assert.equal(await page.locator('.draft-quote').count(), 0);
  await page.locator('button[title="连接设置"]').click();
  await page.getByRole('dialog', { name: '连接与设置' }).waitFor();
  assert.equal(await page.evaluate(() => 'accessToken' in window.reader || 'key' in window.reader), false);
  await page.screenshot({ path: 'test-results/settings.png' });
  // Test-only transport: no external API calls and no real credentials.
  await app.evaluate(({ session }) => {
    globalThis.__readerTestMode = 'complete';
    session.fromPartition('reader-network').fetch = async (url, options) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
      const failed = globalThis.__readerTestMode === 'fail';
      const body = JSON.parse(options.body);
      globalThis.__readerTestBody = body;
      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: '测试传输回答：原文强调了认真阅读。' }, finish_reason: null }],
          }) +
          '\n\n' +
          'data: ' +
          JSON.stringify(
            failed
              ? {
                  error: { code: 'insufficient_balance' },
                }
              : { choices: [{ delta: {}, finish_reason: 'stop' }] },
          ) +
          '\n\n',
      );
    };
  });
  await page.getByRole('button', { name: 'DeepSeek API Key · 独立计费', exact: true }).click();
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('test-key-not-a-real-credential');
  await page.getByRole('button', { name: '保存并使用 API', exact: true }).click();
  await page.getByRole('combobox', { name: '当前模型', exact: true }).selectOption('fixture-model');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('解释原文');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.message.assistant .markdown')?.textContent?.includes('测试传输回答'),
  );
  await page.waitForFunction(() => !document.querySelector('.message-status.streaming'));
  assert.equal(await page.getByRole('textbox', { name: '聊天输入框' }).inputValue(), '');
  await app.evaluate(() => {
    globalThis.__readerTestMode = 'fail';
  });
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('保留失败问题');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.locator('.message-status.failed').waitFor();
  assert.equal(await page.getByRole('textbox', { name: '聊天输入框' }).inputValue(), '保留失败问题');
  await app.evaluate(() => {
    globalThis.__readerTestMode = 'complete';
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('.message-status.failed') &&
      !document.querySelector('.message-status.streaming'),
  );
  assert.equal(await page.locator('.message.user').count(), 2);
  await page.screenshot({ path: 'test-results/chat.png' });
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.chat-header h1')?.textContent.includes('Reading Test PDF'),
  );
  assert.equal(await page.locator('.message.user').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '聊天输入框' }).inputValue(), '请解释这段原文');
  await page.locator('.book-select').filter({ hasText: 'EPUB' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 2);
  assert.equal(await page.getByRole('textbox', { name: '聊天输入框' }).inputValue(), '');
  await page.locator('.book-row.selected .delete-book').click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await page.waitForFunction(async () => (await window.reader.snapshot()).books.length === 1);
  await page.locator('.reader-toolbar').filter({ hasText: 'PDF' }).waitFor();
  assert.equal(await page.locator('.book-row').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: PDF/EPUB selection, clipboard, quotes, range preview, navigation, restart recovery, EPUB scripts blocked, settings.',
  );
} catch (error) {
  console.error(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
    console.log(await page.locator('body').innerText());
    console.log(await page.locator('.book-viewport').innerHTML());
    console.log(
      'frames',
      page.frames().map((f) => f.url()),
    );
    console.log(errors);
  }
  throw error;
} finally {
  if (app) await app.close();
}
