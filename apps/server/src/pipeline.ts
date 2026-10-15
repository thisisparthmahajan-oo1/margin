import sanitizeHtml from 'sanitize-html';
import type { ExtractedArticle, ExtractedPodcast, ExtractedText, ExtractedVideo } from './extractors/index.ts';
import { parseFragment } from './html.ts';
import { httpGet } from './http.ts';
import { MEDIA_PREFIX, type MediaStore } from './media.ts';
import type { ExtractedContent } from './store.ts';

const MAX_IMAGES = 80;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_CONCURRENCY = 6;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'kbd', 'samp',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark',
    'sub', 'sup', 'small', 'abbr', 'cite', 'q', 'figure', 'figcaption', 'img', 'picture', 'video',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'aside', 'section', 'details', 'summary',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    video: ['src', 'poster', 'controls', 'preload'],
    code: ['class'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    blockquote: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' } }),
  },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'poster'],
};

/** A web page, video or podcast episode, extracted -> stored content. (PDFs go through `processPdf` in pdf.ts.) */
export async function processPage(raw: ExtractedArticle | ExtractedVideo | ExtractedPodcast, media: MediaStore): Promise<ExtractedContent> {
  const text = await processText(raw, media);
  switch (raw.kind) {
    case 'article':
      return { ...text, kind: 'article', hasVideo: raw.hasVideo, file: null, video: null, audio: null };
    case 'video':
      return { ...text, kind: 'video', hasVideo: true, file: null, video: raw.video, audio: null };
    case 'podcast':
      return { ...text, kind: 'podcast', hasVideo: false, file: null, video: null, audio: raw.audio };
  }
}

/** Absolute URLs, sanitized, images made local for offline reading. */
async function processText(raw: ExtractedText, media: MediaStore) {
  const body = parseFragment(raw.html);

  resolveUrls(body, raw.baseUrl);
  const localImages = await localizeImages(body, media);

  const contentHtml = sanitize(body.innerHTML);
  const { plainText, wordCount } = textOf(contentHtml);

  const leadImage = raw.leadImage
    ? ((await downloadImage(raw.leadImage, media)) ?? raw.leadImage)
    : (localImages.find(isThumbnailSized)?.src ?? null);

  return {
    title: raw.title,
    byline: raw.byline,
    siteName: raw.siteName,
    excerpt: raw.excerpt ?? (plainText.slice(0, 240) || null),
    leadImage,
    contentHtml,
    plainText,
    wordCount,
    publishedAt: raw.publishedAt,
  };
}

export const sanitize = (html: string) => sanitizeHtml(html, SANITIZE);

/** Search text and word count of sanitized HTML. */
export function textOf(contentHtml: string) {
  // Pad block ends with a space so adjacent paragraphs don't run together in search snippets.
  const spaced = contentHtml.replace(/<\/(p|h[1-6]|li|blockquote|pre|figcaption|td|th|dd|dt)>/g, '$& ');
  const plainText = (parseFragment(spaced).textContent ?? '').replace(/\s+/g, ' ').trim();
  return { plainText, wordCount: plainText ? plainText.split(' ').length : 0 };
}

function resolveUrls(root: HTMLElement, base: string) {
  const abs = (v: string | null) => {
    if (!v) return null;
    try {
      return new URL(v, base).href;
    } catch {
      return null;
    }
  };
  root.querySelectorAll('img').forEach((img) => {
    // Lazy-loading sites keep the real image in data-* attributes; srcset is dropped after picking the largest.
    const candidate =
      largestFromSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset')) ??
      img.getAttribute('data-src') ??
      img.getAttribute('data-original') ??
      img.getAttribute('src');
    const src = abs(candidate);
    if (src) img.setAttribute('src', src);
    else img.remove();
  });
  root.querySelectorAll('picture source').forEach((s) => s.remove());
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = abs(a.getAttribute('href'));
    if (href) a.setAttribute('href', href);
  });
}

function largestFromSrcset(srcset: string | null): string | null {
  const candidates = srcset ? parseSrcset(srcset) : [];
  return candidates.sort((a, b) => b.weight - a.weight)[0]?.url ?? null;
}

/**
 * The candidates in a srcset, parsed the way browsers do (HTML spec): a URL runs until whitespace, so
 * commas inside it are kept. Image CDNs put commas in their URLs (Substack: `w_424,c_limit,…`), which
 * a split on "," cuts into fragments.
 */
export function parseSrcset(srcset: string): { url: string; weight: number }[] {
  const candidates: { url: string; weight: number }[] = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i]!)) i++; // separators before a candidate
    const start = i;
    while (i < srcset.length && !/\s/.test(srcset[i]!)) i++;
    let url = srcset.slice(start, i);
    if (!url) break;
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, ''); // "a.jpg, b.jpg": the comma ends this candidate, no descriptor
    } else {
      const end = srcset.indexOf(',', i);
      descriptor = srcset.slice(i, end < 0 ? srcset.length : end).trim();
      i = end < 0 ? srcset.length : end + 1;
    }
    if (url) candidates.push({ url, weight: parseFloat(descriptor) || 1 });
  }
  return candidates;
}

interface LocalImage {
  src: string;
  width: number | null;
  height: number | null;
}

/** Without an og:image, the first real picture in the article is the thumbnail; skip title banners and icons. */
const isThumbnailSized = (img: LocalImage) => (img.width ?? 999) >= 200 && (img.height ?? 999) >= 120;

async function localizeImages(root: HTMLElement, media: MediaStore): Promise<LocalImage[]> {
  const imgs = [...root.querySelectorAll('img')].slice(0, MAX_IMAGES);
  const dimension = (img: HTMLImageElement, attr: string) => {
    const n = parseInt(img.getAttribute(attr) ?? '', 10);
    return Number.isFinite(n) ? n : null;
  };
  const results: (LocalImage | null)[] = new Array(imgs.length).fill(null);
  for (let i = 0; i < imgs.length; i += IMAGE_CONCURRENCY) {
    await Promise.all(
      imgs.slice(i, i + IMAGE_CONCURRENCY).map(async (img, j) => {
        const local = await downloadImage(img.getAttribute('src')!, media);
        if (!local) return;
        img.setAttribute('src', local);
        results[i + j] = { src: local, width: dimension(img, 'width'), height: dimension(img, 'height') };
      }),
    );
  }
  // Video posters too, so a video shows its frame offline (the video itself streams online).
  await Promise.all(
    [...root.querySelectorAll('video[poster]')].map(async (v) => {
      const local = await downloadImage(v.getAttribute('poster')!, media);
      if (local) v.setAttribute('poster', local);
    }),
  );
  return results.filter((r): r is LocalImage => r !== null);
}

/** Stores the image in the media store. Returns its `/api/media/...` path, or null to keep the remote URL. */
export async function downloadImage(url: string, media: MediaStore): Promise<string | null> {
  if (url.startsWith(MEDIA_PREFIX)) return url;
  try {
    const res = await httpGet(url, { accept: 'image/avif,image/webp,image/*,*/*;q=0.8', timeoutMs: 15_000 });
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    return await media.save(bytes, type, ext);
  } catch {
    return null; // keep the remote URL; it still works online
  }
}
