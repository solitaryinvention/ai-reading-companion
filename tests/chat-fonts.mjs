import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/fonts-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/AI读书助手.exe'), args: [], env });
try {
  const page = await app.firstWindow();
  await page.getByTitle('连接设置', { exact: true }).click();
  const select = page.getByLabel('聊天栏字体', { exact: true });
  assert.equal(await select.locator('option').count(), 6);
  for (const [id, font] of [['song', 'SimSun'], ['yahei', 'Microsoft YaHei'], ['system', 'system-ui']]) {
    await select.selectOption(id);
    assert.ok((await page.locator('.chat-panel').evaluate(el => getComputedStyle(el).fontFamily)).includes(font));
  }
  await select.selectOption('kai');
  await page.reload();
  await page.getByTitle('连接设置', { exact: true }).click();
  assert.equal(await page.getByLabel('聊天栏字体', { exact: true }).inputValue(), 'kai');
  assert.ok((await page.locator('.chat-panel').evaluate(el => getComputedStyle(el).fontFamily)).includes('KaiTi'));
  console.log('PASS: packaged font selector, immediate font family changes and restart persistence.');
} finally { await app.close(); }
