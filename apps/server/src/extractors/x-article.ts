import { httpGet } from '../http.ts';
import { ExtractionError, type ExtractedArticle, type Extractor } from './types.ts';

/**
 * X (Twitter) long-form Articles. x.com needs a logged-in session to render anything,
 * so we read the post through FxTwitter's public API, which returns the article body as
 * Draft.js content state (shape: FxEmbed `packages/atmosphere/src/types/api-schemas.ts`).
 */
const FX_API = 'https://api.fxtwitter.com/status/';
const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']);

// ---- FxTwitter response subset ----

interface FxStyleRange { offset: number; length: number; style: string }
interface FxEntityRange { offset: number; length: number; key: number }
interface FxSpan { fromIndex: number; toIndex: number; text: string }

export interface FxBlock {
  key: string;
  type: string;
  text: string;
  inlineStyleRanges: FxStyleRange[];
  entityRanges: FxEntityRange[];
  data: { urls?: FxSpan[]; mentions?: FxSpan[]; hashtags?: FxSpan[]; cashtags?: FxSpan[]; [k: string]: unknown };
}

type FxEntity =
  | { key: string; value: { type: 'MEDIA'; data: { mediaItems: { mediaId: string }[] } } }
  | { key: string; value: { type: 'MARKDOWN'; data: { markdown: string } } }
  | { key: string; value: { type: 'TWEET'; data: { tweetId: string } } }
  | { key: string; value: { type: string; data: unknown } };

interface FxMedia {
  media_id: string;
  media_info: {
    __typename: string;
    original_img_url?: string;
    media_url_https?: string;
    variants?: { url: string; bitrate?: number; content_type?: string }[];
    video_info?: { variants: { url: string; bitrate?: number; content_type?: string }[] };
  };
}

export interface FxArticle {
  id: string;
  title: string;
  preview_text: string;
  cover_media?: FxMedia;
  content: { blocks: FxBlock[]; entityMap: FxEntity[] };
  media_entities: FxMedia[];
}

interface FxTweet {
  id: string;
  url: string;
  text: string;
  created_timestamp?: number;
  author: { name: string; screen_name: string };
  media?: { photos?: { url: string }[] };
  article?: FxArticle;
}

export interface FxStatusResponse {
  code: number;
  message: string;
  tweet?: FxTweet;
}

// ---- URL matching ----

/** Post id from any X status/article link, `null` if the URL isn't an X post. */
export function parseXPostId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!X_HOSTS.has(host)) return null;
  const m = url.pathname.match(/^\/(?:i\/web|i|[A-Za-z0-9_]{1,15})\/(?:status|statuses|article)\/(\d+)/);
  return m?.[1] ?? null;
}

const isBareArticleLink = (url: URL) =>
  X_HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, '')) && url.pathname.startsWith('/i/article/');

export const xArticleExtractor: Extractor = {
  name: 'x-article',
  source: 'x',
  matches: (url) => parseXPostId(url) !== null || isBareArticleLink(url),
  async extract(url) {
    const id = parseXPostId(url);
    if (!id) {
      throw new ExtractionError(
        'This is an article-only link. Open the article on X and copy the post link (x.com/<user>/status/<id>) instead.',
      );
    }
    const res = await httpGet(FX_API + id, { accept: 'application/json' }).catch((e: Error) => {
      throw new ExtractionError(`Could not reach FxTwitter: ${e.message}`);
    });
    return fromFxStatus((await res.json()) as FxStatusResponse);
  },
};

export function fromFxStatus(body: FxStatusResponse): ExtractedArticle {
  const tweet = body.tweet;
  if (body.code !== 200 || !tweet) throw new ExtractionError(`X post unavailable: ${body.message}`);

  const byline = `${tweet.author.name} (@${tweet.author.screen_name})`;
  const publishedAt = tweet.created_timestamp ? tweet.created_timestamp * 1000 : null;
  const base = { byline, siteName: 'X', baseUrl: tweet.url, publishedAt };

  if (tweet.article) {
    const a = tweet.article;
    return {
      ...base,
      title: a.title,
      excerpt: a.preview_text || null,
      leadImage: a.cover_media ? mediaImageUrl(a.cover_media) : null,
      html: renderArticle(a),
    };
  }

  // A regular post: keep it readable rather than failing, even though Articles are the focus.
  const photos = tweet.media?.photos ?? [];
  return {
    ...base,
    title: `${tweet.author.name} on X`,
    excerpt: tweet.text.slice(0, 200),
    leadImage: photos[0]?.url ?? null,
    html:
      tweet.text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('') + photos.map((p) => `<figure><img src="${escapeAttr(p.url)}" alt=""></figure>`).join(''),
  };
}

// ---- Draft.js content state -> HTML ----

const BLOCK_TAGS: Record<string, string> = {
  'header-one': 'h2',
  'header-two': 'h3',
  'header-three': 'h4',
  blockquote: 'blockquote',
  'code-block': 'pre',
  unstyled: 'p',
};

const LIST_TAGS: Record<string, 'ul' | 'ol'> = {
  'unordered-list-item': 'ul',
  'ordered-list-item': 'ol',
};

const STYLE_TAGS: Record<string, string> = {
  Bold: 'strong',
  Italic: 'em',
  Strikethrough: 's',
  Code: 'code',
};

export function renderArticle(article: FxArticle): string {
  const entities = new Map(article.content.entityMap.map((e) => [Number(e.key), e]));
  const media = new Map(article.media_entities.map((m) => [m.media_id, m]));
  // Draft.js stores list items as sibling blocks; they're grouped into <ul>/<ol> afterwards.
  const parts: { list: 'ul' | 'ol' | null; html: string }[] = [];

  for (const block of article.content.blocks) {
    const list = LIST_TAGS[block.type];
    if (list) {
      parts.push({ list, html: `<li>${renderInline(block)}</li>` });
    } else if (block.type === 'atomic') {
      parts.push(...block.entityRanges.map((r) => ({ list: null, html: renderEntity(entities.get(r.key), media) })));
    } else if (block.text.trim()) {
      const tag = BLOCK_TAGS[block.type] ?? 'p';
      parts.push({ list: null, html: `<${tag}>${renderInline(block)}</${tag}>` });
    }
  }

  const out: string[] = [];
  parts.forEach((part, i) => {
    const prev = parts[i - 1]?.list ?? null;
    const next = parts[i + 1]?.list ?? null;
    out.push(
      (part.list && part.list !== prev ? `<${part.list}>` : '') +
        part.html +
        (part.list && part.list !== next ? `</${part.list}>` : ''),
    );
  });
  return out.join('\n');
}

function renderEntity(entity: FxEntity | undefined, media: Map<string, FxMedia>): string {
  if (!entity) return '';
  const { value } = entity;
  switch (value.type) {
    case 'MEDIA': {
      const item = (value.data as { mediaItems: { mediaId: string }[] }).mediaItems[0];
      const m = item && media.get(item.mediaId);
      return m ? renderMedia(m) : '';
    }
    case 'MARKDOWN': {
      const markdown = (value.data as { markdown: string }).markdown;
      const fence = markdown.match(/^```([^\n]*)\n([\s\S]*?)\n?```\s*$/);
      return fence
        ? `<pre><code${fence[1]?.trim() ? ` class="language-${escapeAttr(fence[1].trim())}"` : ''}>${escapeHtml(fence[2] ?? '')}</code></pre>`
        : `<pre>${escapeHtml(markdown)}</pre>`;
    }
    case 'TWEET': {
      const tweetId = (value.data as { tweetId: string }).tweetId;
      const href = `https://x.com/i/status/${tweetId}`;
      return `<blockquote class="embedded-post"><p><a href="${href}">Embedded post on X</a></p></blockquote>`;
    }
    default:
      return '';
  }
}

function mediaImageUrl(m: FxMedia): string | null {
  return m.media_info.original_img_url ?? m.media_info.media_url_https ?? null;
}

function renderMedia(m: FxMedia): string {
  if (m.media_info.__typename === 'ApiImage') {
    const src = mediaImageUrl(m);
    return src ? `<figure><img src="${escapeAttr(src)}" alt=""></figure>` : '';
  }
  const variants = m.media_info.variants ?? m.media_info.video_info?.variants ?? [];
  const best = variants
    .filter((v) => v.url && !v.url.includes('.m3u8'))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const poster = m.media_info.media_url_https;
  if (!best) return poster ? `<figure><img src="${escapeAttr(poster)}" alt=""></figure>` : '';
  return `<figure><video controls preload="none" src="${escapeAttr(best.url)}"${
    poster ? ` poster="${escapeAttr(poster)}"` : ''
  }></video></figure>`;
}

interface InlineLink { from: number; to: number; href: string }

function inlineLinks(block: FxBlock): InlineLink[] {
  const d = block.data;
  const spans = (list: FxSpan[] | undefined, href: (s: FxSpan) => string) =>
    (Array.isArray(list) ? list : []).map((s) => ({ from: s.fromIndex, to: s.toIndex, href: href(s) }));
  return [
    ...spans(d.urls, (s) => (/^https?:\/\//i.test(s.text) ? s.text : `https://${s.text}`)),
    ...spans(d.mentions, (s) => `https://x.com/${s.text}`),
    ...spans(d.hashtags, (s) => `https://x.com/hashtag/${s.text}`),
    ...spans(d.cashtags, (s) => `https://x.com/search?q=%24${s.text}`),
  ];
}

/** Splits text at every style/link boundary and wraps each run in the tags active over it. */
function renderInline(block: FxBlock): string {
  const { text } = block;
  const links = inlineLinks(block);
  const cuts = new Set([0, text.length]);
  for (const r of block.inlineStyleRanges) cuts.add(r.offset).add(r.offset + r.length);
  for (const l of links) cuts.add(l.from).add(l.to);
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const [start, end] = [points[i]!, points[i + 1]!];
    let run = escapeHtml(text.slice(start, end)).replace(/\n/g, '<br>');
    for (const r of block.inlineStyleRanges) {
      const tag = STYLE_TAGS[r.style];
      if (tag && r.offset <= start && end <= r.offset + r.length) run = `<${tag}>${run}</${tag}>`;
    }
    const link = links.find((l) => l.from <= start && end <= l.to);
    html += link ? `<a href="${escapeAttr(link.href)}">${run}</a>` : run;
  }
  return html;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');
