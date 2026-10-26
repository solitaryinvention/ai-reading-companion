import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export async function fixtures() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Reading Test PDF');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 3; n++) {
    const p = pdf.addPage([480, 640]);
    p.drawText(`Chapter ${n}: Reading together`, {
      x: 40,
      y: 580,
      size: 20,
      font,
      color: rgb(0.2, 0.3, 0.2),
    });
    p.drawText('A book invites us to think carefully.', { x: 40, y: 530, size: 15, font });
    p.drawText('The second paragraph asks another question.', { x: 40, y: 490, size: 15, font });
  }
  pdf.addPage([480, 640]);
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>一起读书 EPUB</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
  );
  zip.file(
    'OEBPS/nav.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章 阅读的开始</a></li><li><a href="c2.xhtml">第二章 思考</a></li></ol></nav></body></html>',
  );
  for (let i = 1; i <= 2; i++)
    zip.file(
      `OEBPS/c${i}.xhtml`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i}章</title></head><body><h1>第${i}章 阅读的开始</h1><p>阅读让我们停下脚步，认真思考每一个问题。</p><p>第二个段落提醒我们，把理解与原文联系起来。</p>${'<p>一本书，是一场缓慢而深入的对话。我们可以逐段阅读，也可以反复追问。</p>'.repeat(24)}<script>window.parent.__epubScriptExecuted=true</script><img src="https://example.com/track.png" onerror="window.parent.__epubScriptExecuted=true"/></body></html>`,
    );
  return [
    { name: 'sample.pdf', bytes: Array.from(await pdf.save()) },
    { name: 'sample.epub', bytes: Array.from(await zip.generateAsync({ type: 'uint8array' })) },
  ];
}
