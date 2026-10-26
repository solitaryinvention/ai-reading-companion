import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/pdf-assets', { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm'])
  cpSync('node_modules/pdfjs-dist/' + dir, 'dist/pdf-assets/' + dir, { recursive: true });
mkdirSync('dist-electron/ocr-data', { recursive: true });
for (const lang of ['chi_sim', 'eng'])
  cpSync(
    `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    `dist-electron/ocr-data/${lang}.traineddata.gz`,
  );
