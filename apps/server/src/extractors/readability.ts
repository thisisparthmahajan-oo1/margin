import { Readability } from '@mozilla/readability';
import { parseDocument } from '../html.ts';
import { config } from '../config.ts';
import { httpGet } from '../http.ts';
import { ExtractionError, type ExtractedArticle, type ExtractedPdf, type Extractor } from './types.ts';

/** Players embedded in a page. Checked before Readability, which drops them. */
const VIDEO_SELECTOR = [
  'video',
  'iframe[src*="youtube.com/embed"]',
  'iframe[src*="youtube-nocookie.com/embed"]',
  'iframe[src*="player.vimeo.com"]',
].join(',');

/** Generic article extraction for any web page (Firefox Reader View's algorithm). Links to PDFs are kept as files. */
export const readabilityExtractor: Extractor = {
  name: 'readability',
  source: 'web',
  matches: () => true,
  async extract(url) {
    const res = await httpGet(url.href, { timeoutMs: 40_000 });
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (contentType === 'application/pdf') return pdfFromResponse(res, res.url || url.href);
    if (!/html|xml/.test(contentType)) throw new ExtractionError(`Not an HTML page or PDF (${contentType || 'unknown type'})`);
    return extractFromHtml(await res.text(), res.url || url.href);
  },
};

async function pdfFromResponse(res: Response, finalUrl: string): Promise<ExtractedPdf> {
  const tooBig = () =>
    new ExtractionError(`This PDF is larger than ${Math.round(config.fileLimits.fileBytes / 1024 ** 2)} MB, the limit for one file.`);
  if (Number(res.headers.get('content-length') ?? 0) > config.fileLimits.fileBytes) throw tooBig();
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > config.fileLimits.fileBytes) throw tooBig();
  return { kind: 'pdf', bytes, fileName: fileNameOf(res, finalUrl) };
}

/** From Content-Disposition, else the last path segment of the final URL. */
function fileNameOf(res: Response, finalUrl: string): string {
  const disposition = res.headers.get('content-disposition') ?? '';
  const quoted = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if (quoted) return decodeURIComponent(quoted).trim();
  const last = decodeURIComponent(new URL(finalUrl).pathname.split('/').filter(Boolean).pop() ?? '');
  return last || 'Document.pdf';
}

export function extractFromHtml(html: string, pageUrl: string): ExtractedArticle {
  const doc = parseDocument(html);
  const hasVideo = doc.querySelector(VIDEO_SELECTOR) !== null;
  const meta = (selector: string) => doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;

  const leadImage = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  const published =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="date"]') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null;

  const article = new Readability(doc).parse();
  if (!article?.content || !article.textContent?.trim()) {
    throw new ExtractionError('Could not find article content on this page');
  }

  const publishedAt = published ? Date.parse(published) : NaN;
  return {
    kind: 'article',
    hasVideo,
    title: article.title?.trim() || meta('meta[property="og:title"]') || new URL(pageUrl).hostname,
    byline: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || meta('meta[property="og:site_name"]'),
    excerpt: article.excerpt?.trim() || null,
    leadImage: leadImage ? new URL(leadImage, pageUrl).href : null,
    html: article.content,
    baseUrl: pageUrl,
    publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
  };
}
