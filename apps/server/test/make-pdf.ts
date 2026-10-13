/** Writes a minimal, valid PDF: each page is a list of text lines at given positions and sizes. */
export interface PdfLine {
  text: string;
  y: number;
  size?: number;
}

export function makePdf(pages: PdfLine[][], info: { title?: string; author?: string } = {}): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object numbers
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PLACEHOLDER'); // 2: pages tree, filled in below
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs = pages.map((lines) => {
    const stream = lines.map((l) => `BT /F1 ${l.size ?? 11} Tf 1 0 0 1 72 ${l.y} Tm (${esc(l.text)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
  const infoRef = add(
    `<< ${info.title ? `/Title (${esc(info.title)}) ` : ''}${info.author ? `/Author (${esc(info.author)}) ` : ''}>>`,
  );

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
