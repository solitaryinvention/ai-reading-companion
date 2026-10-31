import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/segments-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(process.argv.includes('--packaged')
  ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env }
  : { args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
  await app.evaluate(({ session }) => {
    globalThis.segmentCalls = 0;
    session.fromPartition('reader-network').fetch = async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
      globalThis.segmentCalls++;
      const body = JSON.parse(init.body);
      const paragraphs = JSON.parse(body.messages.at(-1).content);
      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: { content: JSON.stringify({ ends: [12, paragraphs.length] }) },
                finish_reason: 'stop',
              },
            ],
          }) +
          '\n\n',
      );
    };
  });
  await page.evaluate(
    async (files) => {
      await window.reader.importBooks(files.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) })));
      const { books } = await window.reader.snapshot();
      await window.reader.configure('api', 'fixture');
      await window.reader.settings({
        activeBook: books.find((b) => b.format === 'epub').id,
        model: 'fixture',
      });
    },
    await fixtures(),
  );
  await page.reload();
  const toggle = async enabled => {
    await page.getByTitle('连接设置', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'EPUB 自动智能分段' }).setChecked(enabled);
    await page.getByTitle('关闭设置', { exact: true }).click();
  };
  const frame = page.frameLocator('iframe.epub-document');
  await frame.locator('p').first().waitFor();
  const original = await frame.locator('body').innerText();
  assert.equal(await page.locator('.draft-word-count').count(), 0);
  assert.equal(await page.getByRole('button', { name: /智能分段/ }).count(), 0);
  await toggle(true);
  await frame.locator('[data-reader-ui="segments"] button').first().waitFor();
  assert.equal(await frame.locator('[data-reader-ui="segments"] button').count(), 2);
  await page.screenshot({ path: path.join(dir, 'epub-segments.png') });
  await frame.locator('[data-reader-ui="segments"] button').first().click();
  assert.equal(await frame.locator('body').evaluate(el => el.ownerDocument.getSelection().toString()), '');
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(copied.includes('阅读让我们停下脚步'));
  assert.ok(!copied.includes('复制'));
  await toggle(false);
  assert.equal(await frame.locator('[data-reader-ui="segments"]').count(), 0);
  assert.equal(await frame.locator('body').innerText(), original);
  await toggle(true);
  await frame.locator('[data-reader-ui="segments"] button').first().waitFor();
  assert.equal(await app.evaluate(() => globalThis.segmentCalls), 1);
  await page.reload();
  await frame.locator('[data-reader-ui="segments"] button').first().waitFor();
  await frame.locator('body').evaluate(el => el.ownerDocument.defaultView.scrollTo(0, el.scrollHeight));
  await page.getByTitle('下一页', { exact: true }).click();
  await frame.getByRole('heading', { name: '第2章 阅读的开始' }).waitFor();
  await frame.locator('[data-reader-ui="segments"] button').first().waitFor();
  assert.equal(await app.evaluate(() => globalThis.segmentCalls), 2);
  await toggle(false);
  const paragraph = frame.locator('p').first();
  await paragraph.evaluate((el) => {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const s = el.ownerDocument.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 150, clientY: 150 }));
  });
  await frame.getByRole('button', { name: '复制选中文字', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), await paragraph.innerText());
  await page.evaluate(async () => {
    const { books } = await window.reader.snapshot();
    await window.reader.settings({ activeBook: books.find((b) => b.format === 'pdf').id });
  });
  await page.reload();
  await page.locator('.pdf-sheet[data-ready="true"]').first().waitFor();
  assert.equal(await page.getByRole('button', { name: /智能分段/ }).count(), 0);
  await page
    .locator('.pdf-sheet .textLayer span')
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = document.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 150, clientY: 150 }));
    });
  await page.getByRole('button', { name: '复制选中文字', exact: true }).click();
  assert.ok((await app.evaluate(({ clipboard }) => clipboard.readText())).includes('Chapter'));
  console.log(
    'PASS: EPUB markers, exact copy, toggle restores text, cache avoids repeat calls, selection copy.',
  );
} finally {
  await app.close();
}
