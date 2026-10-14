import type { StoredFile } from '@margin/shared';
import { extractTextItems, getDocumentProxy, getMeta, type StructuredTextItem } from 'unpdf';
import { sanitize, textOf } from './pipeline.ts';
import { titleFromFileName } from './uploads.ts';
import type { ExtractedContent } from './store.ts';

/**
 * PDF -> readable text for Margin's reader, search and Listen. The original stays in file storage
 * for the "Original" view, so this only has to get the words right, not the layout:
 * - lines are joined into paragraphs (a bigger vertical gap or a blank line starts a new one),
 *   with words hyphenated across a line break joined again;
 * - larger-than-body lines become headings, as do short numbered lines ("3.1 Encoder Stacks");
 * - without a usable title in the metadata, the biggest heading on page 1 is the title;
 * - running headers/footers (the same line on most pages) and bare page numbers are dropped;
 * - a paragraph cut by a page break is continued.
 * A PDF with no text layer (a scan) yields `contentHtml: null`: the reader then shows only the original.
 */
export async function processPdf(bytes: Buffer, file: StoredFile): Promise<ExtractedContent> {
  let pages: StructuredTextItem[][] = [];
  let info: Record<string, unknown> = {};
  let pageCount: number | null = null;
  const metaText = (key: string) => (typeof info[key] === 'string' && (info[key] as string).trim()) || null;
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    pageCount = doc.numPages;
    info = (await getMeta(doc).catch(() => ({ info: {} }))).info;
    pages = (await extractTextItems(doc)).items;
  } catch (e) {
    console.warn(`[pdf] ${file.key}: ${(e as Error).message}`);
  }

  const blocks = pdfBlocks(pages);
  // Without a title in the metadata, the biggest heading on page 1 is the title. It's shown above the text, so not repeated in it.
  const metaTitle = usableTitle(metaText('Title'));
  const titleBlock = metaTitle ? undefined : firstPageTitle(blocks);
  const html = blocksToHtml(blocks.filter((b) => b !== titleBlock));
  const contentHtml = html ? sanitize(html) : null;
  const { plainText, wordCount } = contentHtml ? textOf(contentHtml) : { plainText: '', wordCount: 0 };

  return {
    kind: 'pdf',
    title: metaTitle ?? titleBlock?.text ?? titleFromFileName(file.name),
    byline: metaText('Author'),
    siteName: null,
    excerpt: plainText ? plainText.slice(0, 240) : null,
    leadImage: null,
    contentHtml: wordCount > 0 ? contentHtml : null,
    plainText: plainText || null,
    wordCount,
    publishedAt: null,
    hasVideo: false,
    file: { ...file, pages: pageCount },
    video: null,
    audio: null,
  };
}

/** PDF metadata titles are often junk left by the authoring tool ("Microsoft Word - draft3.docx"). */
function usableTitle(title: string | null): string | null {
  if (!title || title.length < 3) return null;
  if (/^(microsoft (word|powerpoint)|untitled|document\d*$)|\.(docx?|pptx?|tex|indd|pdf)$/i.test(title)) return null;
  return title;
}

// ---- layout -> paragraphs ----

interface Line {
  text: string;
  /** Baseline, PDF coordinates (origin bottom-left, so it decreases down the page). */
  y: number;
  fontSize: number;
  /** Preceded by an empty line. */
  afterBlank: boolean;
}

type Tag = 'p' | 'h2' | 'h3' | 'h4';
interface Block {
  tag: Tag;
  text: string;
  lines: number;
  fontSize: number;
  page: number;
  /** Baseline of the first line. */
  y: number;
}

/** "2 Background", "3.1 Encoder and Decoder Stacks", "IV. Results", "A. Proofs". */
const NUMBERED_HEADING = /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+\p{Lu}/u;
const MAX_HEADING_CHARS = 150;

function pdfBlocks(pages: StructuredTextItem[][]): Block[] {
  const linesByPage = pages.map(toLines);
  const repeated = runningLines(linesByPage);
  const bodySize = medianFontSize(linesByPage.flat());

  const blocks: Block[] = [];
  let current: Block | null = null;
  linesByPage.forEach((lines, page) => {
    // A paragraph continues onto the next page unless it visibly ended; headings never do.
    if (current && (current.tag !== 'p' || /[.!?:"”)]\s*$/.test(current.text))) current = null;
    let prev: Line | null = null;
    for (const line of lines) {
      if (repeated.has(normalize(line.text)) || /^\s*(page\s*)?\d{1,4}\s*$/i.test(line.text)) continue;
      const tag = headingTag(line, bodySize) ?? 'p';
      const gap = prev ? prev.y - line.y : 0;
      const continues =
        current !== null &&
        current.tag === tag &&
        !line.afterBlank &&
        // a big gap, or a jump up (the next column), starts a new block
        (prev === null || (gap >= 0 && gap <= prev.fontSize * 1.75));
      if (continues) {
        current!.text = joinLines(current!.text, line.text);
        current!.lines++;
      } else {
        current = { tag, text: line.text, lines: 1, fontSize: line.fontSize, page, y: line.y };
        blocks.push(current);
      }
      prev = line;
    }
  });

  for (const b of blocks) {
    b.text = b.text.replace(/\s+/g, ' ').trim();
    // Large print that reads as sentences is a paragraph, not a heading.
    if (b.tag !== 'p' && (b.text.length > MAX_HEADING_CHARS || /[.,;]$/.test(b.text))) b.tag = 'p';
    else if (b.tag === 'p' && b.lines === 1 && b.text.length <= 80 && NUMBERED_HEADING.test(b.text) && !/[.,;:]$/.test(b.text)) {
      b.tag = 'h4';
    }
  }

  return blocks;
}

/** The biggest heading in the top half of page 1 (lower down it's more likely a stamp or a figure label). */
function firstPageTitle(blocks: Block[]): Block | undefined {
  const firstPage = blocks.filter((b) => b.page === 0);
  const top = Math.max(...firstPage.map((b) => b.y));
  return firstPage.filter((b) => b.tag === 'h2' && b.y >= top / 2).sort((a, b) => b.fontSize - a.fontSize)[0];
}

const blocksToHtml = (blocks: Block[]) => blocks.map((b) => `<${b.tag}>${escapeHtml(b.text)}</${b.tag}>`).join('\n');

function toLines(items: StructuredTextItem[]): Line[] {
  const lines: Line[] = [];
  let text = '';
  let y = 0;
  let fontSize = 0;
  let afterBlank = false;
  const finish = () => {
    if (text.trim()) {
      lines.push({ text: text.trim(), y, fontSize, afterBlank });
      afterBlank = false;
    } else if (lines.length) afterBlank = true;
    text = '';
  };
  for (const item of items) {
    // pdf.js marks a line break with an empty item placed on the *next* line: it only ends the line.
    if (item.str) {
      if (!text) {
        y = item.y;
        fontSize = item.fontSize;
      }
      text += item.str;
      fontSize = Math.max(fontSize, item.fontSize);
    }
    if (item.hasEOL) finish();
  }
  finish();
  return lines;
}

const normalize = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/** Lines (normalized, digits ignored) that appear on at least half the pages: running headers and footers. */
function runningLines(pages: Line[][]): Set<string> {
  if (pages.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => normalize(l.text)));
    for (const key of edges) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= pages.length / 2).map(([key]) => key));
}

/** The body text size: the median font size by amount of text (not by line, so short lines don't skew it). */
function medianFontSize(lines: Line[]): number {
  const sized = lines.map((l) => ({ size: l.fontSize, chars: l.text.length })).sort((a, b) => a.size - b.size);
  let remaining = sized.reduce((sum, l) => sum + l.chars, 0) / 2;
  for (const l of sized) if ((remaining -= l.chars) <= 0) return l.size;
  return 0;
}

/** Size class of a line; whether a block of them really is a heading is decided once its lines are joined. */
function headingTag(line: Line, bodySize: number): 'h2' | 'h3' | null {
  if (!bodySize) return null;
  if (line.fontSize >= bodySize * 1.6) return 'h2';
  if (line.fontSize >= bodySize * 1.2) return 'h3';
  return null;
}

/** Joins wrapped lines; "exam-" + "ple" becomes "example". */
function joinLines(text: string, next: string): string {
  if (/[a-z]-$/.test(text) && /^[a-z]/.test(next)) return text.slice(0, -1) + next;
  return `${text} ${next}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
