import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import JSZip from 'jszip';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/themes-' + Date.now());
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
const color = (selector, property = 'backgroundColor') =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el)[p], property);
try {
  await launch();
  await page.locator('.connection-button').click();
  await page.getByLabel('界面主题', { exact: true }).selectOption('night');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'night');
  assert.equal(await color('.sidebar'), 'rgb(28, 33, 31)');
  assert.equal(await color('.modal'), 'rgb(39, 46, 42)');
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const input = (await fixtures())[1];
  const zip = await JSZip.loadAsync(new Uint8Array(input.bytes));
  zip.file(
    'OEBPS/c1.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>阅读与思考</title></head><body><h1>第一章 阅读与思考</h1><p>阅读不是匆忙地抵达最后一页，而是在文字之间，辨认自己的问题。</p><p>每一次停下来追问，都让我们更接近作者的思路，也更了解自己的判断。</p><h2>从理解，走向独立思考</h2><p>我们可以先解释一个概念，再重建它的论证，最后寻找适用的条件和可能的反例。</p></body></html>',
  );
  const bytes = [...(await zip.generateAsync({ type: 'uint8array' }))];
  await app.evaluate(({ session }) => {
    session.fromPartition('reader-network').fetch = async (url) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'theme-fixture' }] });
      const reply =
        '### 先理解，再判断\n\n这段演示文本强调，阅读不仅是获取结论，也是在理解论证的过程中形成自己的问题。\n\n- 先把概念讲清楚。\n- 再检查观点背后的理由。\n- 最后区分原文与自己的推测。';
      return new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: null }] }) +
          '\n\ndata: ' +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
          '\n\n',
      );
    };
  });
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.reader.importBooks([{ name, bytes: new Uint8Array(bytes) }]);
      await window.reader.configure('api', 'theme-test-key-not-real');
      await window.reader.settings({ model: 'theme-fixture' });
    },
    { name: '阅读与思考.epub', bytes },
  );
  await page.reload();
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('演示问题：如何理解阅读与独立思考的关系？');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.message.assistant .markdown h3').waitFor();
  const colors = { paper: 'rgb(248, 245, 237)', white: 'rgb(255, 255, 255)', night: 'rgb(32, 38, 35)' };
  for (const theme of ['night', 'white', 'paper']) {
    await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption(theme);
    await page.waitForFunction(
      ({ theme, bg }) => {
        const doc = document.querySelector('iframe')?.contentDocument;
        return (
          document.documentElement.dataset.theme === theme &&
          doc &&
          doc.defaultView.getComputedStyle(doc.body).backgroundColor === bg
        );
      },
      { theme, bg: colors[theme] },
    );
    assert.equal(await color('.reader-toolbar'), colors[theme]);
    assert.equal(
      await color('.chat-panel'),
      theme === 'night' ? 'rgb(32, 38, 35)' : theme === 'white' ? 'rgb(255, 255, 255)' : 'rgb(252, 253, 249)',
    );
    assert.equal(
      await color('.markdown', 'color'),
      theme === 'night' ? 'rgb(219, 225, 218)' : theme === 'white' ? 'rgb(37, 45, 42)' : 'rgb(48, 61, 54)',
    );
    await page.getByRole('button', { name: 'agent.md', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '本书提示词', exact: true });
    await editor.waitFor();
    assert.equal(
      await editor.evaluate((el) => getComputedStyle(el).webkitTextFillColor),
      theme === 'night' ? 'rgb(219, 225, 218)' : 'rgb(17, 17, 17)',
    );
    if (theme === 'night') await page.screenshot({ path: 'test-results/theme-night-agent.png' });
    await page.getByRole('button', { name: '关闭本书设置', exact: true }).click();
    if (await page.getByRole('button', { name: '关闭提示', exact: true }).count())
      await page.getByRole('button', { name: '关闭提示', exact: true }).click();
    await page.getByRole('textbox', { name: '聊天输入框' }).fill('继续讨论这段原文…');
    await page.getByRole('button', { name: '讲解 · 标准', exact: true }).click();
    assert.equal(await color('.detail-panel'), theme === 'night' ? 'rgb(39, 46, 42)' : 'rgb(255, 255, 255)');
    await page.screenshot({ path: `test-results/theme-${theme}.png` });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption('night');
  await page.waitForFunction(async () => (await window.reader.snapshot()).settings.theme === 'night');
  await app.close();
  await launch();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'night');
  assert.equal(await color('.sidebar'), 'rgb(28, 33, 31)');
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
  console.log(
    'PASS: empty-library theme entry, three global themes, reader parity, chat, agent editor, popup, native title bar and restart persistence.',
  );
} finally {
  await app?.close();
}
