import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import JSZip from 'jszip';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve('test-results/epub-layout-' + Date.now());
mkdirSync(dir, { recursive: true });
const env = { ...process.env, READER_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
async function launch() {
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '导入书籍', exact: true }).waitFor();
}
try {
  const input = (await fixtures())[1];
  const zip = await JSZip.loadAsync(new Uint8Array(input.bytes));
  zip.file(
    'OEBPS/c1.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>阅读的节奏</title></head><body><h1 style="font-size:52px">第一章 阅读的节奏</h1><h2 style="font-size:48px"><span style="font-size:48px">让文字慢下来，让理解深一点</span></h2><p style="font-size:30px;line-height:1.1">一本书的意义，并不只在于它讲述了多少知识。有时候，恰好是一个普通的句子，让我们停下来，重新看看熟悉的生活。</p><p>阅读并不是匆忙地抵达最后一页。我们沿着作者的思路向前，也把自己的经验放在字里行间。那些没有立即理解的地方，值得多留一点时间。</p><h3>一、在段落之间，留一点呼吸</h3><p>翻开一页，读完一段，再问自己：作者在这里想表达什么？这个观点有什么依据？慢一点，并不意味着收获更少，而是让每一次理解都有机会生根。</p><p>我们可以选择一种舒服的字号，也可以换一盏柔和的灯。让阅读成为一件愿意长久做下去的小事。</p><blockquote><p>读书，是与另一个人的思想相遇，也是与自己的内心对话。</p></blockquote>${'<p>当一个问题暂时没有答案，不妨先把它留在心里。下一次重读，我们也许会看见新的线索。</p>'.repeat(8)}</body></html>`,
  );
  zip.file(
    'OEBPS/images/图 表.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9lEAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const chapter = await zip.file('OEBPS/c1.xhtml').async('string');
  zip.file(
    'OEBPS/c1.xhtml',
    chapter.replace(
      '</body>',
      '<p id="alignment-test" style="text-align-last:justify;letter-spacing:20px">景气的 CI 指数</p><p><img id="local-image" src="images/图%20表.PNG" alt="书内图"/></p><p><img id="missing-image" src="images/missing.jpg"/></p><p><img id="remote-image" src="https://example.com/remote.png"/></p></body>',
    ),
  );
  await launch();
  await page.evaluate(
    async (bytes) => window.reader.importBooks([{ name: '阅读排版测试.epub', bytes: new Uint8Array(bytes) }]),
    Array.from(await zip.generateAsync({ type: 'uint8array' })),
  );
  await app.close();
  await launch();
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('h2'));
  const geometry = await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument,
      w = d.defaultView;
    const p = w.getComputedStyle(d.querySelector('p')),
      h2 = w.getComputedStyle(d.querySelector('h2'));
    return {
      body: parseFloat(w.getComputedStyle(d.body).fontSize),
      paragraph: parseFloat(p.fontSize),
      heading: parseFloat(h2.fontSize),
      indent: parseFloat(p.textIndent),
      width: d.body.getBoundingClientRect().width,
      background: w.getComputedStyle(d.documentElement).backgroundColor,
    };
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('iframe')?.contentDocument?.querySelector('#local-image');
    return img?.complete && img.naturalWidth > 0;
  });
  const resources = await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument;
    return {
      last: d.defaultView.getComputedStyle(d.querySelector('#alignment-test')).textAlignLast,
      spacing: d.defaultView.getComputedStyle(d.querySelector('#alignment-test')).letterSpacing,
      local: d.querySelector('#local-image').dataset.readerImage,
      missing: d.querySelector('#missing-image').dataset.readerImage,
      remote: d.querySelector('#remote-image').dataset.readerImage,
    };
  });
  assert.equal(resources.last, 'auto');
  assert.ok(parseFloat(resources.spacing) < 1);
  assert.equal(resources.local, 'embedded');
  assert.equal(resources.missing, 'missing');
  assert.equal(resources.remote, 'missing');
  assert.equal(await page.getByText('把不懂的，聊明白。', { exact: true }).count(), 0);
  assert.equal(await page.getByText('与好书，慢慢聊', { exact: true }).count(), 0);
  await page.screenshot({ path: 'test-results/minimal-reading.png' });
  assert.equal(geometry.body, 19);
  assert.equal(geometry.paragraph, 19);
  assert.ok(geometry.heading < 25);
  assert.equal(geometry.indent, 38);
  assert.ok(geometry.width <= 760);
  await page.locator('.reader-panel').screenshot({ path: 'test-results/epub-reading-layout.png' });
  await page.getByRole('combobox', { name: '阅读字体', exact: true }).selectOption('sans');
  await page.waitForFunction(() =>
    document
      .querySelector('iframe')
      .contentDocument.defaultView.getComputedStyle(document.querySelector('iframe').contentDocument.body)
      .fontFamily.includes('Microsoft YaHei'),
  );
  await page.getByRole('combobox', { name: '阅读背景', exact: true }).selectOption('night');
  await page.waitForFunction(() => {
    const d = document.querySelector('iframe').contentDocument;
    return d.defaultView.getComputedStyle(d.documentElement).backgroundColor === 'rgb(32, 35, 34)';
  });
  await page.locator('.reader-panel').screenshot({ path: 'test-results/epub-reading-night.png' });
  await app.close();
  await launch();
  await page.getByRole('combobox', { name: '阅读字体', exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '阅读字体', exact: true }).inputValue(), 'sans');
  assert.equal(await page.getByRole('combobox', { name: '阅读背景', exact: true }).inputValue(), 'night');
  console.log(
    'PASS: publisher oversized fonts normalized, readable text width and indent, font switching, night background and persisted preferences.',
  );
} finally {
  if (app) await app.close();
}
