import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/knowledge-' + Date.now());
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
async function agent() {
  await page.getByRole('button', { name: 'agent.md', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="本书提示词"]')?.value.length > 0,
  );
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
  for (const selector of ['.agent-entry', '.archive-entry', '.connection-button']) {
    const style = await page.locator(selector).evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        border: css.borderTopWidth,
        radius: css.borderRadius,
        height: el.getBoundingClientRect().height,
      };
    });
    assert.ok(parseFloat(style.border) > 0);
    assert.ok(parseFloat(style.radius) >= 6 && style.height >= 32);
  }
  await page.screenshot({ path: 'test-results/bounded-entry-buttons.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await agent();
  const editorStyle = await page.getByRole('textbox', { name: '本书提示词', exact: true }).evaluate((el) => {
    const css = getComputedStyle(el);
    return { color: css.color, fill: css.webkitTextFillColor, scheme: css.colorScheme };
  });
  assert.equal(editorStyle.color, 'rgb(17, 17, 17)');
  assert.equal(editorStyle.fill, 'rgb(17, 17, 17)');
  assert.equal(editorStyle.scheme, 'light');
  await page.screenshot({ path: 'test-results/agent-default-readable.png' });
  const defaultText = await page.getByRole('textbox', { name: '本书提示词', exact: true }).inputValue();
  assert.ok(defaultText.includes('不得把智能体自己的观点记录为用户的原创思想'));
  assert.ok(defaultText.includes('不以应试、考点、背诵为导向'));
  await page
    .getByRole('textbox', { name: '本书提示词', exact: true })
    .fill('A_AGENT_PRIVATE：请从历史背景展开讲解。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存，从下一次发送起生效', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭本书设置', exact: true }).click();
  await page.locator('.book-select').filter({ hasText: 'EPUB' }).click();
  await agent();
  assert.equal(
    await page.getByRole('textbox', { name: '本书提示词', exact: true }).inputValue(),
    defaultText,
  );
  await page.getByRole('textbox', { name: '本书提示词', exact: true }).fill('B_AGENT_PRIVATE：请逐段讨论。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存，从下一次发送起生效', { exact: true }).waitFor();
  await page.getByRole('button', { name: '授课进度', exact: true }).click();
  await page.getByRole('textbox', { name: '本书授课进度', exact: true }).fill('尚未讲解原文，待确认章节。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '关闭本书设置', exact: true }).click();
  await page.getByRole('button', { name: '思想档案', exact: true }).click();
  await page.getByRole('button', { name: '新建思想', exact: true }).click();
  await page.getByRole('textbox', { name: '观点标题', exact: true }).fill('手动假设');
  await page
    .getByRole('textbox', { name: '用户原话', exact: true })
    .fill('我认为选择的价值不完全来自最终结果。');
  await page.getByRole('button', { name: '保存思想', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await page.getByRole('button', { name: '关闭思想档案', exact: true }).click();
  await app.close();
  await launch();
  await page.getByRole('button', { name: '思想档案', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '手动假设' }).click();
  assert.equal(
    await page.getByRole('textbox', { name: '用户原话', exact: true }).inputValue(),
    '我认为选择的价值不完全来自最终结果。',
  );
  await page.getByRole('button', { name: '关闭思想档案', exact: true }).click();
  await page.locator('.book-select').filter({ hasText: 'PDF' }).click();
  await agent();
  assert.ok(
    (await page.getByRole('textbox', { name: '本书提示词', exact: true }).inputValue()).includes(
      'A_AGENT_PRIVATE',
    ),
  );
  await page.screenshot({ path: 'test-results/book-agent-editor.png' });
  await page.getByRole('button', { name: '关闭本书设置', exact: true }).click();
  const quote = '我的独立假设是技术会改变群体协作的边界。';
  await app.evaluate(({ session }, quote) => {
    globalThis.__knowledgeRequests = [];
    session.fromPartition('reader-network').fetch = async (url, options) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
      const body = JSON.parse(options.body);
      globalThis.__knowledgeRequests.push(body);
      const raw =
        '这是一项值得检验的假设。<reader_memory>' +
        JSON.stringify({
          thoughts: [
            { title: '技术与协作边界', originalText: quote, questions: '需要区分技术条件与制度条件' },
          ],
          progress: '已讨论用户假设；原著正文未提供，尚未讲解章节。',
        }) +
        '</reader_memory>';
      return new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: raw }, finish_reason: null }] }) +
          '\n\ndata: ' +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
          '\n\n',
      );
    };
  }, quote);
  await page.evaluate(async () => {
    await window.reader.configure('api', 'fixture-key-not-real');
    await window.reader.settings({ model: 'fixture' });
  });
  await page.reload();
  await page.getByRole('textbox', { name: '聊天输入框', exact: true }).fill(quote);
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.message.assistant .markdown')?.textContent.includes('值得检验') &&
      !document.querySelector('.message-status.streaming'),
  );
  const body = await app.evaluate(() => JSON.stringify(globalThis.__knowledgeRequests[0]));
  assert.ok(body.includes('A_AGENT_PRIVATE'));
  assert.ok(body.includes('让没有读过原文的人，也能独立读懂这次讲解'));
  assert.ok(body.includes('用户这一次明确提出的任务、提问角度和篇幅要求优先'));
  assert.ok(!body.includes('B_AGENT_PRIVATE'));
  assert.ok(
    !(await page
      .locator('.conversation')
      .innerText()
      .then((t) => t.includes('reader_memory'))),
  );
  const archive = await page.evaluate(() => window.reader.thoughts());
  assert.equal(archive.entries.length, 2);
  assert.ok(archive.entries.some((t) => t.originalText === quote && t.origin === 'conversation'));
  assert.ok(existsSync(archive.path));
  assert.ok(readFileSync(archive.path, 'utf8').includes(quote));
  await page.getByRole('button', { name: '思想档案', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '技术与协作边界' }).click();
  assert.equal(
    await page.getByRole('textbox', { name: '用户原话', exact: true }).getAttribute('readonly'),
    '',
  );
  await page.getByRole('textbox', { name: '后续修正', exact: true }).fill('需要进一步讨论制度的中介作用。');
  await page.getByRole('button', { name: '保存思想', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await page.screenshot({ path: 'test-results/long-term-thought-archive.png' });
  await page.getByRole('button', { name: '关闭思想档案', exact: true }).click();
  await agent();
  await page.getByRole('button', { name: '授课进度', exact: true }).click();
  assert.ok(
    (await page.getByRole('textbox', { name: '本书授课进度', exact: true }).inputValue()).includes(
      '原著正文未提供',
    ),
  );
  await page.getByRole('button', { name: '关闭本书设置', exact: true }).click();
  await page.evaluate(async () => {
    const s = await window.reader.snapshot();
    await window.reader.removeBook(s.books.find((b) => b.format === 'pdf').id);
  });
  assert.equal((await page.evaluate(() => window.reader.thoughts())).entries.length, 2);
  console.log(
    'PASS: visible default prompt, isolated book agents and progress, restart persistence, automatic verified user thought capture, metadata hidden, global archive survives book removal.',
  );
} finally {
  if (app) await app.close();
}
