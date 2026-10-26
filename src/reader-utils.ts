export function cleanPdfText(
  items: { str?: string; hasEOL?: boolean; transform?: number[]; type?: string }[],
) {
  let output = '',
    lastY: number | undefined;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 20) output += '\n\n';
    output += item.str + (item.hasEOL ? '\n' : ' ');
    lastY = y;
  }
  return output
    .replace(/([\u3400-\u9fff]) *\n *(?=[\u3400-\u9fff])/g, '$1')
    .replace(/ +\n/g, '\n')
    .trim();
}
export function sanitizeDocument(doc: Document) {
  doc
    .querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv="refresh"],link[rel="import"]')
    .forEach((x) => x.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (
        /^on/i.test(attr.name) ||
        attr.name === 'srcdoc' ||
        (/^(href|src|xlink:href|action)$/i.test(attr.name) &&
          /^(?:https?:|\/\/|javascript:|file:)/i.test(attr.value.trim()))
      )
        el.removeAttribute(attr.name);
    }
  });
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute(
    'content',
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' blob:; font-src data: blob:; script-src 'none'; connect-src 'none'; form-action 'none'",
  );
  doc.head?.prepend(meta);
}
