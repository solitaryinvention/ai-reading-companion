import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/chat-scroll-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(
  process.argv.includes('--packaged')
    ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env }
    : { args: ['.'], env },
);
let page;
try {
  page = await app.firstWindow();
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
  await app.evaluate(({ session }) => {
    session.fromPartition('reader-network').fetch = async (url, options) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
      globalThis.__readerScrollBody = JSON.parse(options.body);
      const encoder = new TextEncoder();
      let step = 0;
      return new Response(
        new ReadableStream({
          start(controller) {
            const send = (data) =>
              controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));
            send({
              choices: [
                { delta: { content: '这是用于验证滚动位置的长回答。\n\n'.repeat(90) }, finish_reason: null },
              ],
            });
            globalThis.__readerScrollAppend = () =>
              send({
                choices: [
                  {
                    delta: { content: '新增的回答内容应该保留用户当前阅读位置。\n\n'.repeat(30) },
                    finish_reason: null,
                  },
                ],
              });
            globalThis.__readerScrollFinish = () => {
              send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
              controller.close();
            };
          },
        }),
      );
    };
  });
  await page.evaluate(
    async (files) => {
      await window.reader.importBooks(files.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) })));
      await window.reader.configure('api', 'test-key-not-real');
      await window.reader.settings({ model: 'fixture' });
    },
    [...(await fixtures()).slice(0, 1)],
  );
  await page.reload();
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('验证生成时保持当前滚动位置');
  await page.locator('.pdf-sheet[data-ready="true"]').first().waitFor();
  await page.getByRole('checkbox', { name: '附加当前章节', exact: true }).check();
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.message.assistant .markdown')?.textContent.length > 1000,
  );
  assert.ok(await app.evaluate(() => JSON.stringify(globalThis.__readerScrollBody).includes('Chapter 1')));
  assert.equal(await page.getByText('请核对范围预览，再点击发送', { exact: true }).count(), 0);
  assert.equal(
    await page.locator('.conversation').evaluate((el) => getComputedStyle(el, '::-webkit-scrollbar').width),
    '16px',
  );
  const before = await page.locator('.conversation').evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - 100;
    return { top: el.scrollTop, length: el.textContent.length };
  });
  await app.evaluate(() => globalThis.__readerScrollAppend());
  await page.waitForFunction(
    (length) => document.querySelector('.conversation').textContent.length > length + 200,
    before.length,
  );
  const after = await page.locator('.conversation').evaluate((el) => el.scrollTop);
  assert.ok(Math.abs(after - before.top) < 2, `scroll changed ${before.top} -> ${after}`);
  const length = await page.locator('.conversation').evaluate((el) => {
    el.scrollTop = 0;
    return el.textContent.length;
  });
  await app.evaluate(() => globalThis.__readerScrollAppend());
  await page.waitForFunction(
    (length) => document.querySelector('.conversation').textContent.length > length + 100,
    length,
  );
  assert.equal(await page.locator('.conversation').evaluate((el) => el.scrollTop), 0);
  await app.evaluate(() => globalThis.__readerScrollFinish());
  await page.waitForFunction(() => !document.querySelector('.message-status.streaming'));
  console.log(
    'PASS: streaming keeps the exact scroll position near the bottom and after manually scrolling up.',
  );
} catch (error) {
  console.log(await page.locator('.conversation').innerText());
  console.log(
    await page.evaluate(async () => {
      const s = await window.reader.snapshot();
      return {
        mode: s.connection.mode,
        model: s.settings.model,
        sessions: s.sessions.map((x) => x.id),
        active: s.settings.activeBook,
      };
    }),
  );
  throw error;
} finally {
  await app.close();
}
