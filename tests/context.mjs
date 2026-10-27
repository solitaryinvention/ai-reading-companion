import { _electron as electron } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/context-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 160; n++) {
  const p = pdf.addPage([480, 640]);
  for (let line = 0; line < 24; line++)
    p.drawText(`Page ${n}: Full original context should never be truncated.`, {
      x: 30,
      y: 600 - line * 22,
      size: 10,
      font,
    });
  if (n === 160) p.drawText('LAST_PAGE_MARKER', { x: 30, y: 40, size: 10, font });
}
const bytes = [...(await pdf.save())];
const app = await electron.launch(
  process.argv.includes('--packaged')
    ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env }
    : { args: ['.'], env },
);
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
  await app.evaluate(({ session }) => {
    session.fromPartition('reader-network').fetch = async (url, options) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'context-fixture' }] });
      globalThis.__contextBody = JSON.parse(options.body);
      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: '完整原文已收到（模拟测试）' }, finish_reason: 'stop' }],
          }) +
          '\n\n',
      );
    };
  });
  await page.evaluate(async (bytes) => {
    await window.reader.importBooks([{ name: 'large-context.pdf', bytes: new Uint8Array(bytes) }]);
    await window.reader.configure('api', 'context-fixture-not-real');
    await window.reader.settings({ model: 'context-fixture' });
  }, bytes);
  await page.reload();
  await page.locator('.pdf-sheet[data-ready="true"]').first().waitFor();
  await page.getByRole('checkbox', { name: '附加当前章节', exact: true }).check();
  await page.getByRole('spinbutton', { name: '起始页', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: '结束页', exact: true }).fill('160');
  await page.getByRole('button', { name: '预览范围', exact: true }).click();
  await page.locator('.context-preview').waitFor();
  await page.getByRole('textbox', { name: '聊天输入框' }).fill('解释完整原文');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByText('完整原文已收到（模拟测试）', { exact: true }).waitFor();
  const content = await app.evaluate(() => globalThis.__contextBody.messages[1].content);
  assert.ok(content.length > 100000, content.length);
  assert.ok(content.includes('[第 160 页]') && content.includes('LAST_PAGE_MARKER'));
  console.log(
    `PASS: 160 PDF pages, ${content.length} characters extracted and sent without local context cap or truncation.`,
  );
} finally {
  await app.close();
}
