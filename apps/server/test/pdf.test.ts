import { describe, expect, it } from 'vitest';
import { processPdf } from '../src/pdf.ts';
import { makePdf } from './make-pdf.ts';

const file = (name = 'Annual_report.pdf') => ({
  key: 'files/x.pdf', name, bytes: 1, contentType: 'application/pdf' as const, pages: null,
});

describe('processPdf', () => {
  it('turns pages into headings and paragraphs, dropping running headers and page numbers', async () => {
    const header = (n: number) => [{ text: 'ACME Quarterly Report', y: 760, size: 9 }, { text: String(n), y: 40, size: 9 }];
    const pdf = makePdf(
      [
        [
          ...header(1),
          { text: 'Introduction', y: 700, size: 20 },
          { text: 'The first paragraph starts here and contin-', y: 670 },
          { text: 'ues on the next line.', y: 656 },
          { text: 'A second paragraph after a gap.', y: 620 },
          { text: 'This one runs onto the', y: 100 },
        ],
        [...header(2), { text: 'next page without stopping.', y: 700 }],
        [...header(3), { text: 'Last page.', y: 700 }],
      ],
      { title: 'Quarterly Report', author: 'ACME' },
    );

    const c = await processPdf(pdf, file());
    expect(c.kind).toBe('pdf');
    expect(c.title).toBe('Quarterly Report');
    expect(c.byline).toBe('ACME');
    expect(c.file?.pages).toBe(3);
    expect(c.contentHtml).toContain('<h2>Introduction</h2>');
    expect(c.contentHtml).toContain('<p>The first paragraph starts here and continues on the next line.</p>');
    expect(c.contentHtml).toContain('<p>A second paragraph after a gap.</p>');
    expect(c.contentHtml).toContain('<p>This one runs onto the next page without stopping.</p>');
    expect(c.contentHtml).not.toContain('ACME Quarterly Report');
    expect(c.plainText).not.toMatch(/\b[23]\b/);
    expect(c.wordCount).toBeGreaterThan(20);
  });

  it('without a metadata title, uses the biggest heading at the top of page 1; finds numbered headings', async () => {
    const c = await processPdf(
      makePdf([
        [
          { text: 'A Paper About Margins', y: 720, size: 18 },
          { text: 'A note set in large print that runs on and on and is certainly not a heading at all', y: 690, size: 14 },
          { text: 'because it keeps going over several lines of the page, which headings never do, really.', y: 674, size: 14 },
          { text: '2.1 Wide Margins', y: 640 },
          ...Array.from({ length: 12 }, (_, i) => ({ text: `Body text about margins, line ${i + 1} of a real paragraph`, y: 610 - i * 14 })),
          { text: 'arXiv:0000.00000v1 [cs.XX] stamp', y: 200, size: 20 },
        ],
      ]),
      file('paper.pdf'),
    );
    expect(c.title).toBe('A Paper About Margins');
    expect(c.contentHtml).not.toContain('A Paper About Margins');
    expect(c.contentHtml).toContain('<h4>2.1 Wide Margins</h4>');
    expect(c.contentHtml).toMatch(/<p>A note set in large print .* really\.<\/p>/);
  });

  it('keeps a PDF without text as original-only, titled from the file name', async () => {
    const c = await processPdf(makePdf([[], []], { title: 'Microsoft Word - draft3.docx' }), file('Scan_2024.pdf'));
    expect(c.contentHtml).toBeNull();
    expect(c.wordCount).toBe(0);
    expect(c.file?.pages).toBe(2);
    expect(c.title).toBe('Scan 2024');
  });

  it('survives a broken file', async () => {
    const c = await processPdf(Buffer.from('not a pdf'), file('Broken.pdf'));
    expect(c.contentHtml).toBeNull();
    expect(c.file?.pages).toBeNull();
    expect(c.title).toBe('Broken');
  });
});
