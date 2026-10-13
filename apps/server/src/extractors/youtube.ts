import { httpGet } from '../http.ts';
import { ExtractionError, type ExtractedVideo, type Extractor } from './types.ts';

/**
 * YouTube links are saved, not downloaded: title, channel, thumbnail and description, plus what the
 * player needs. oEmbed is the reliable source; the watch page adds description, duration and date
 * when YouTube serves it (best effort).
 */
const YT_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);
const VIDEO_ID = /^[\w-]{11}$/;

/** The video id from any YouTube link form, `null` if the URL isn't a YouTube video. */
export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null | undefined = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (YT_HOSTS.has(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export const watchUrl = (videoId: string) => `https://youtube.com/watch?v=${videoId}`;

export const youtubeExtractor: Extractor = {
  name: 'youtube',
  source: 'youtube',
  matches: (url) => youtubeVideoId(url) !== null,
  async extract(url) {
    const videoId = youtubeVideoId(url)!;
    const page = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedRes = await httpGet(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`, {
      accept: 'application/json',
    }).catch(() => {
      throw new ExtractionError('This video is private, was removed, or can’t be embedded');
    });
    const oembed = (await oembedRes.json()) as OEmbed;
    const details = await httpGet(page)
      .then(async (res) => playerDetails(await res.text()))
      .catch(() => null);
    return fromYouTube(videoId, oembed, details);
  },
};

// ---- sources ----

export interface OEmbed {
  title: string;
  author_name: string;
  thumbnail_url?: string;
}

/** The parts of the watch page's `ytInitialPlayerResponse` we use. */
export interface PlayerDetails {
  description: string;
  durationSeconds: number | null;
  publishedAt: number | null;
}

/** Reads `ytInitialPlayerResponse` out of the watch page HTML. Null when it isn't there (consent page, bot check). */
export function playerDetails(html: string): PlayerDetails | null {
  const json = embeddedJson(html, 'ytInitialPlayerResponse');
  if (!json) return null;
  try {
    const data = JSON.parse(json) as {
      videoDetails?: { shortDescription?: string; lengthSeconds?: string };
      microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string } };
    };
    const length = Number(data.videoDetails?.lengthSeconds);
    const mf = data.microformat?.playerMicroformatRenderer;
    const published = Date.parse(mf?.publishDate ?? mf?.uploadDate ?? '');
    return {
      description: data.videoDetails?.shortDescription ?? '',
      durationSeconds: Number.isFinite(length) && length > 0 ? length : null,
      publishedAt: Number.isNaN(published) ? null : published,
    };
  } catch {
    return null;
  }
}

/** The object literal assigned to `name` in an inline script, found by matching braces (it contains `};` in strings). */
function embeddedJson(html: string, name: string): string | null {
  const at = html.search(new RegExp(`${name}\\s*=\\s*\\{`));
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

export function fromYouTube(videoId: string, oembed: OEmbed, details: PlayerDetails | null): ExtractedVideo {
  const description = details?.description.trim() ?? '';
  return {
    kind: 'video',
    video: { provider: 'youtube', videoId, durationSeconds: details?.durationSeconds ?? null },
    hasVideo: true,
    title: oembed.title,
    byline: oembed.author_name,
    siteName: 'YouTube',
    excerpt: description ? description.slice(0, 240) : null,
    leadImage: oembed.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    html: descriptionHtml(description),
    baseUrl: watchUrl(videoId),
    publishedAt: details?.publishedAt ?? null,
  };
}

/** Plain-text description -> paragraphs, with its links made clickable. */
function descriptionHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${linkify(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const linkify = (text: string) =>
  text
    .split(/(https?:\/\/[^\s<>"]+)/g)
    .map((part, i) => (i % 2 ? `<a href="${escapeHtml(part).replace(/"/g, '&quot;')}">${escapeHtml(part)}</a>` : escapeHtml(part)))
    .join('');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
