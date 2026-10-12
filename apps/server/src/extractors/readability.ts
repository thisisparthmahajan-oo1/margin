import { Readability } from '@mozilla/readability';
import { parseDocument } from '../html.ts';
import { httpGet } from '../http.ts';
import { ExtractionError, type ExtractedArticle, type Extractor } from './types.ts';

/** Generic article extraction for any web page (Firefox Reader View's algorithm). */
export const readabilityExtractor: Extractor = {
  name: 'readability',
  source: 'web',
  matches: () => true,
  async extract(url) {
    const res = await httpGet(url.href);
    const contentType = res.headers.get('content-type') ?? '';
    if (!/html|xml/i.test(contentType)) throw new ExtractionError(`Not an HTML page (${contentType || 'unknown type'})`);
    return extractFromHtml(await res.text(), res.url || url.href);
  },
};

export function extractFromHtml(html: string, pageUrl: string): ExtractedArticle {
  const doc = parseDocument(html);
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
