import { parseFragment } from '../html.ts';
import { httpGet } from '../http.ts';
import { ExtractionError, type Extracted, type ExtractedArticle, type Extractor } from './types.ts';

/**
 * Hacker News items. news.ycombinator.com refuses page fetches from cloud hosts (HTTP 419),
 * so items are read through HN's official API. A link post saves the article it links to;
 * comments and text posts (Ask HN, job posts) save their own text.
 */
const HN_API = 'https://hacker-news.firebaseio.com/v0/item/';
const HN_HOSTS = new Set(['news.ycombinator.com', 'www.news.ycombinator.com']);
const itemUrl = (id: number) => `https://news.ycombinator.com/item?id=${id}`;

/** A comment's parents are walked to find its thread; real threads are far shallower than this. */
const MAX_DEPTH = 50;
const MAX_TITLE = 120;

/** The API's item shape (https://github.com/HackerNews/API#items), the fields we use. */
export interface HnItem {
  id: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number;
  title?: string;
  text?: string;
  url?: string;
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}

/** The thread a comment belongs to. */
export interface HnThread {
  id: number;
  title: string;
}

export function parseHnItemId(url: URL): number | null {
  if (!HN_HOSTS.has(url.hostname.toLowerCase()) || url.pathname !== '/item') return null;
  const id = url.searchParams.get('id') ?? '';
  return /^\d+$/.test(id) ? Number(id) : null;
}

export const hackerNewsExtractor: Extractor = {
  name: 'hacker-news',
  source: 'web',
  matches: (url) => parseHnItemId(url) !== null,
  async extract(url): Promise<Extracted> {
    const item = liveItem(await fetchItem(parseHnItemId(url)!));
    if (item.url) {
      // Loaded here, not at the top: index.ts lists this extractor, so a static import would be circular.
      const { extractorFor } = await import('./index.ts');
      const link = new URL(item.url);
      return extractorFor(link).extract(link);
    }
    return fromHnItem(item, item.type === 'comment' ? await threadOf(item) : null);
  },
};

async function fetchItem(id: number): Promise<HnItem | null> {
  const res = await httpGet(`${HN_API}${id}.json`, { accept: 'application/json' });
  return (await res.json()) as HnItem | null;
}

function liveItem(item: HnItem | null): HnItem {
  if (!item || item.deleted || item.dead) throw new ExtractionError('This Hacker News item was deleted');
  return item;
}

/** The story at the top of a comment's thread, or null if it can't be reached. */
async function threadOf(comment: HnItem): Promise<HnThread | null> {
  let item: HnItem | null = comment;
  for (let depth = 0; item?.parent && depth < MAX_DEPTH; depth++) {
    item = await fetchItem(item.parent);
    if (item && item.type !== 'comment') return item.title ? { id: item.id, title: item.title } : null;
  }
  return null;
}

/** An HN comment or text post as an article. A comment is headed by the thread it's in. */
export function fromHnItem(item: HnItem, thread: HnThread | null): ExtractedArticle {
  liveItem(item);
  const text = item.text ?? '';
  const header = thread ? `<p>In <a href="${itemUrl(thread.id)}">${escapeHtml(thread.title)}</a></p>` : '';
  return {
    kind: 'article',
    hasVideo: false,
    title: item.title?.trim() || firstLine(text) || `Comment by ${item.by ?? 'someone'}`,
    byline: item.by ?? null,
    siteName: 'Hacker News',
    excerpt: null,
    leadImage: null,
    html: header + text,
    baseUrl: itemUrl(item.id),
    publishedAt: item.time ? item.time * 1000 : null,
  };
}

/** The first paragraph of HN's HTML as plain text, cut at a word boundary. */
function firstLine(html: string): string {
  const line = (parseFragment(html.split(/<p>/i)[0] ?? '').textContent ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= MAX_TITLE) return line;
  const cut = line.slice(0, MAX_TITLE);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : MAX_TITLE)}…`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
