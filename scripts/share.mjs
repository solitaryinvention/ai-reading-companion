import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import path from 'node:path';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `AI读书助手 Setup ${version}.exe`;
const dir = path.resolve(`release/微信分享版-${version}`);
mkdirSync(dir, { recursive: true });
copyFileSync(path.join('release', name), path.join(dir, name));
copyFileSync('docs/安装与使用说明.txt', path.join(dir, '安装与使用说明.txt'));
const hash = createHash('sha256')
  .update(readFileSync(path.join(dir, name)))
  .digest('hex');
writeFileSync(path.join(dir, 'SHA256SUMS.txt'), `${hash}  ${name}\n`, 'utf8');
const zip = new JSZip();
for (const file of [name, '安装与使用说明.txt', 'SHA256SUMS.txt']) {
  zip.file(`AI读书助手-${version}/${file}`, readFileSync(path.join(dir, file)));
}
const output = path.resolve(`release/AI读书助手-${version}-Windows-微信分享.zip`);
writeFileSync(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
const checked = await JSZip.loadAsync(readFileSync(output), { checkCRC32: true });
const installer = await checked.file(`AI读书助手-${version}/${name}`).async('nodebuffer');
if (createHash('sha256').update(installer).digest('hex') !== hash)
  throw new Error('ZIP installer checksum mismatch');
console.log(`Verified share ZIP: ${output}; SHA256 ${hash}`);
console.log(Object.keys(checked.files).join('\n'));
