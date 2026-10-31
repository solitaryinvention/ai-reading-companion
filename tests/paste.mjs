import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/paste-' + Date.now()); mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(process.argv.includes('--packaged') ? { executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env } : { args: ['.'], env });
try {
  const page = await app.firstWindow(); await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
  await page.evaluate(async files => { await window.reader.importBooks(files.map(f => ({ ...f, bytes: new Uint8Array(f.bytes) }))); }, (await fixtures()).slice(0, 1));
  await page.reload();
  await app.evaluate(({ Menu, clipboard }) => { Menu.prototype.popup = function () { globalThis.pasteMenu = this; }; clipboard.writeText('粘贴测试'); });
  const input = page.getByRole('textbox', { name: '聊天输入框' });
  await input.fill('abcd');
  await input.evaluate(el => { el.focus(); el.setSelectionRange(1, 3); });
  await input.click({ button: 'right' });
  await app.evaluate(() => { const menu = globalThis.pasteMenu; if (!menu) throw Error('No input context menu'); const item = menu.items.find(item => item.label === '粘贴'); if (!item?.enabled) throw Error('Paste disabled'); item.click(); });
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="聊天输入框"]').value.includes('粘贴测试'));
  assert.ok((await input.inputValue()).includes('粘贴测试'));
  await page.reload();
  assert.ok((await input.inputValue()).includes('粘贴测试'));
  console.log('PASS: input context menu paste inserts clipboard text and persists draft.');
} finally { await app.close(); }
