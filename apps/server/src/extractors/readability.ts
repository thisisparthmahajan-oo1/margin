import { Readability } from '@mozilla/readability';
import { parseDocument, parseFragment } from '../html.ts';
import { config } from '../config.ts';
import { httpGet } from '../http.ts';
import { podcastSignals } from './podcast.ts';
import { ExtractionError, type ExtractedArticle, type ExtractedPdf, type ExtractedPodcast, type Extractor } from './types.ts';

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

/** An article, or a podcast episode page (its show notes or transcript are the text). */
export function extractFromHtml(html: string, pageUrl: string): ExtractedArticle | ExtractedPodcast {
  const doc = parseDocument(html);
  const hasVideo = doc.querySelector(VIDEO_SELECTOR) !== null;
  const podcast = podcastSignals(doc, html);
  const meta = (selector: string) => doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;

  const leadImage = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  const published =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="date"]') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null;

  const jsonLd = jsonLdNodes(doc); // read first: Readability strips <script>s from the document it parses

  prepareForReadability(doc);
  const article = new Readability(doc).parse();
  if (!article?.content || !article.textContent?.trim()) {
    // Job boards like Ashby render in the browser, but still embed the whole posting as JSON-LD.
    const job = jobPostingArticle(jsonLd);
    if (!job) throw new ExtractionError('Could not find article content on this page');
    return {
      kind: 'article',
      hasVideo,
      ...job,
      byline: null,
      excerpt: null,
      leadImage: leadImage ? new URL(leadImage, pageUrl).href : null,
      baseUrl: pageUrl,
    };
  }

  const publishedAt = published ? Date.parse(published) : NaN;
  const siteName = article.siteName?.trim() || meta('meta[property="og:site_name"]');
  const kind = podcast
    ? ({ kind: 'podcast', audio: { provider: 'web', showName: podcast.showName ?? siteName, durationSeconds: podcast.durationSeconds } } as const)
    : ({ kind: 'article' } as const);
  return {
    ...kind,
    hasVideo,
    title: article.title?.trim() || meta('meta[property="og:title"]') || new URL(pageUrl).hostname,
    byline: article.byline?.trim() || null,
    siteName,
    excerpt: article.excerpt?.trim() || null,
    leadImage: leadImage ? new URL(leadImage, pageUrl).href : null,
    html: article.content,
    baseUrl: pageUrl,
    publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
  };
}

// ---- steering Readability ----

/** Readability's test for an element holding the byline (its `REGEXPS.byline`, plus rel/itemprop). */
const BYLINE_MARKER = /byline|author|dateline|writtenby|p-author/i;

/** Fixes for page shapes Readability misreads. Mutates `doc`. */
function prepareForReadability(doc: Document) {
  // A quote's credit ("Albert Einstein & Leopold Infeld" under an epigraph) isn't the article's author.
  // Readability would take it as the byline and cut it, and often the quote, out of the text.
  for (const el of doc.querySelectorAll('blockquote *, figcaption *, figure *, cite')) {
    if (BYLINE_MARKER.test(`${el.getAttribute('class') ?? ''} ${el.id}`)) el.removeAttribute('class');
    if (el.id && BYLINE_MARKER.test(el.id)) el.removeAttribute('id');
    if (el.getAttribute('rel') === 'author') el.removeAttribute('rel');
    if (/author/i.test(el.getAttribute('itemprop') ?? '')) el.removeAttribute('itemprop');
  }
  // A container of nothing but figures (a figure grid) looks like image clutter to Readability's
  // clean-up, which drops it whole. Lifted out of it, each figure is kept like any other.
  for (const grid of doc.querySelectorAll('div')) {
    const children = [...grid.children];
    if (children.length > 1 && children.every((c) => c.tagName === 'FIGURE')) grid.replaceWith(...children);
  }
}

// ---- job postings ----

type LdNode = Record<string, any>;

/** Every JSON-LD object on the page: top level, inside arrays, and inside @graph. */
function jsonLdNodes(doc: Document): LdNode[] {
  const nodes: LdNode[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    nodes.push(v as LdNode);
    visit((v as LdNode)['@graph']);
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent ?? ''));
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }
  return nodes;
}

/** A schema.org JobPosting as an article: a header (company, location, type) above its description. */
function jobPostingArticle(jsonLd: LdNode[]): Pick<ExtractedArticle, 'title' | 'siteName' | 'html' | 'publishedAt'> | null {
  const job = jsonLd.find((n) => [n['@type']].flat().includes('JobPosting'));
  const title = str(job?.title);
  let description = str(job?.description);
  if (!job || !title || !description) return null;
  // Some boards HTML-escape the description (`&lt;p&gt;`) instead of embedding the markup.
  if (!/<[a-z]/i.test(description) && /&lt;[a-z]/i.test(description)) description = parseFragment(description).textContent ?? '';

  const company = str(job.hiringOrganization?.name) ?? str(job.hiringOrganization);
  const locations = [job.jobLocation].flat().map((place: LdNode | null) => addressText(place?.address)).filter(present);
  const employment = [job.employmentType].flat().map(str).filter(present).map((t) => sentenceCase(t.replace(/_/g, ' ')));
  const remote = [job.jobLocationType].flat().includes('TELECOMMUTE') ? ['Remote'] : [];
  const facts = [...new Set([...locations, ...employment, ...remote])].map(escapeHtml);
  const header = [company ? `<strong>${escapeHtml(company)}</strong>` : null, ...facts].filter(Boolean).join(' · ');

  const posted = Date.parse(job.datePosted ?? '');
  return {
    title: company ? `${title} · ${company}` : title,
    siteName: company,
    html: `${header ? `<p>${header}</p>` : ''}${description}`,
    publishedAt: Number.isNaN(posted) ? null : posted,
  };
}

/** A PostalAddress (or plain string) as "Locality, Region, Country". */
function addressText(address: unknown): string | null {
  if (typeof address === 'string') return str(address);
  const a = (address ?? {}) as LdNode;
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].map(str).filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : null;
}

const present = <T>(v: T | null): v is T => v !== null;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
