import type { AudioRef } from '@margin/shared';
import { parseDocument } from '../html.ts';
import { httpGet } from '../http.ts';
import { plainTextHtml } from './plain-text.ts';
import { ExtractionError, type ExtractedPodcast, type Extractor } from './types.ts';

/**
 * Podcast episodes are saved, not downloaded: title, show, length, date, artwork and show notes,
 * and the episode is played in its app. Apple Podcasts and Spotify links are recognised here;
 * other podcast pages (Substack, hosted show sites) are found by the readability extractor through
 * `podcastSignals`.
 */

/** `{ show, episode }` for an Apple Podcasts episode link (`…/id<show>?i=<episode>`); null for anything else. */
export function appleEpisode(url: URL): { show: string; episode: string } | null {
  if (url.hostname.toLowerCase() !== 'podcasts.apple.com') return null;
  const show = url.pathname.match(/\/id(\d+)\/?$/)?.[1];
  const episode = url.searchParams.get('i');
  return show && episode && /^\d+$/.test(episode) ? { show, episode } : null;
}

/** The episode id of a Spotify episode link (`open.spotify.com/[intl-xx/]episode/<id>`), or null. */
export function spotifyEpisodeId(url: URL): string | null {
  if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
  return url.pathname.match(/^\/(?:intl-[\w-]+\/)?episode\/([A-Za-z0-9]{22})\/?$/)?.[1] ?? null;
}

/** One address per episode, however it was shared (Apple's slug and country, Spotify's `?si=`). */
export function podcastEpisodeUrl(url: URL): string | null {
  const apple = appleEpisode(url);
  if (apple) return `https://podcasts.apple.com/podcast/id${apple.show}?i=${apple.episode}`;
  const spotify = spotifyEpisodeId(url);
  return spotify ? `https://open.spotify.com/episode/${spotify}` : null;
}

export const podcastExtractor: Extractor = {
  name: 'podcast',
  source: 'podcast',
  matches: (url) => podcastEpisodeUrl(url) !== null,
  async extract(url) {
    const page = podcastEpisodeUrl(url)!;
    if (spotifyEpisodeId(url)) {
      // Spotify renders its pages in the browser; link-preview bots get the details as meta tags.
      const html = await (await httpGet(page, { userAgent: 'facebookexternalhit/1.1' })).text();
      return fromSpotifyPage(html, page);
    }
    const { show, episode } = appleEpisode(url)!;
    const [res, fullNotes] = await Promise.all([httpGet(page), appleFullNotes(show, episode)]);
    return fromApplePage(await res.text(), res.url || page, fullNotes);
  },
};

// ---- Apple Podcasts ----

/**
 * Apple's episode page describes the episode in schema.org JSON-LD, old episodes included, but cuts
 * the notes at 250 characters. The full notes come from the iTunes lookup when it has the episode.
 */
export function fromApplePage(html: string, pageUrl: string, fullNotes: string | null = null): ExtractedPodcast {
  const doc = parseDocument(html);
  const ld = episodeJsonLd(doc);
  const meta = metaReader(doc);
  const title = ld?.name ?? meta('og:title');
  if (!title) throw new ExtractionError('Couldn’t find this episode on Apple Podcasts. It may have been removed.');
  const notes = fullNotes?.trim() || ld?.description?.trim() || '';
  return episode(
    { provider: 'apple', showName: ld?.series ?? null, durationSeconds: ld?.durationSeconds ?? null },
    {
      title,
      siteName: 'Apple Podcasts',
      notes,
      leadImage: meta('og:image') ?? ld?.image ?? null,
      publishedAt: ld?.published ?? null,
      baseUrl: pageUrl,
    },
  );
}

/** The episode's full notes from Apple's public lookup API, which lists a show's latest 200 episodes. Best effort. */
async function appleFullNotes(show: string, episode: string): Promise<string | null> {
  try {
    const res = await httpGet(`https://itunes.apple.com/lookup?id=${show}&entity=podcastEpisode&limit=200`, { accept: 'application/json' });
    const { results } = (await res.json()) as { results: { trackId?: number; description?: string }[] };
    return results.find((r) => String(r.trackId) === episode)?.description ?? null;
  } catch {
    return null;
  }
}

// ---- Spotify ----

const SPOTIFY_LISTEN_PREFIX = /^Listen to this episode from .+? on Spotify\.\s*/;

export function fromSpotifyPage(html: string, pageUrl: string): ExtractedPodcast {
  const doc = parseDocument(html);
  const meta = metaReader(doc);
  const title = meta('og:title');
  if (!title) throw new ExtractionError('Couldn’t find this episode on Spotify. It may be unavailable in your region or removed.');
  // og:description is "<Show> · Episode"; the description is the show notes behind a fixed prefix.
  const showName = meta('og:description')?.split(' · ')[0]?.trim() || null;
  const notes = (meta('description') ?? '').replace(SPOTIFY_LISTEN_PREFIX, '').trim();
  const duration = Number(meta('music:duration'));
  const published = Date.parse(meta('music:release_date') ?? '');
  return episode(
    { provider: 'spotify', showName, durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null },
    {
      title,
      siteName: 'Spotify',
      notes,
      leadImage: meta('og:image'),
      publishedAt: Number.isNaN(published) ? null : published,
      baseUrl: pageUrl,
    },
  );
}

// ---- any podcast page ----

export interface PodcastSignals {
  showName: string | null;
  durationSeconds: number | null;
}

/**
 * Whether a web page is a podcast episode, and what it says about it. Recognised by schema.org
 * `PodcastEpisode` data, an `og:audio` tag, or Substack's podcast player. Null for anything else.
 */
export function podcastSignals(doc: Document, html: string): PodcastSignals | null {
  const ld = episodeJsonLd(doc);
  const meta = metaReader(doc);
  const substack = meta('twitter:player')?.includes('/embed/podcast/') ?? false;
  if (!ld && !meta('og:audio') && !substack) return null;
  // Substack keeps the length in its page data (escaped JSON): \"podcast_duration\":4316.9
  const substackDuration = Number(html.match(/\\?"podcast_duration\\?":\s*([\d.]+)/)?.[1]);
  return {
    showName: ld?.series ?? meta('og:site_name'),
    durationSeconds: ld?.durationSeconds ?? (substackDuration > 0 ? Math.round(substackDuration) : null),
  };
}

// ---- shared ----

interface EpisodeLd {
  name: string | null;
  description: string | null;
  series: string | null;
  durationSeconds: number | null;
  published: number | null;
  image: string | null;
}

/** The page's schema.org PodcastEpisode, if it has one (top level or inside @graph). */
function episodeJsonLd(doc: Document): EpisodeLd | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    type Node = Record<string, any> | null;
    const nodes = [data, ...((data as { '@graph'?: unknown[] })?.['@graph'] ?? [])].flat() as Node[];
    const ep = nodes.find((n) => [n?.['@type']].flat().includes('PodcastEpisode'));
    if (!ep) continue;
    const published = Date.parse(ep.datePublished ?? '');
    const image = typeof ep.image === 'string' ? ep.image : (ep.image?.url ?? ep.thumbnailUrl ?? null);
    return {
      name: str(ep.name),
      description: str(ep.description),
      series: str(ep.partOfSeries?.name),
      durationSeconds: isoDurationSeconds(ep.duration ?? ep.timeRequired),
      published: Number.isNaN(published) ? null : published,
      image: str(image),
    };
  }
  return null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `PT1H11M57S` -> 4317. Null when it isn't an ISO 8601 duration. */
export function isoDurationSeconds(value: unknown): number | null {
  const m = typeof value === 'string' ? value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/) : null;
  if (!m || !value || value === 'P' || value === 'PT') return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  const total = Math.round(Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s));
  return total > 0 ? total : null;
}

const metaReader = (doc: Document) => (name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() || null;

function episode(
  audio: AudioRef,
  d: { title: string; siteName: string; notes: string; leadImage: string | null; publishedAt: number | null; baseUrl: string },
): ExtractedPodcast {
  return {
    kind: 'podcast',
    audio,
    hasVideo: false,
    title: d.title,
    byline: audio.showName,
    siteName: d.siteName,
    excerpt: d.notes ? d.notes.slice(0, 240) : null,
    leadImage: d.leadImage,
    html: plainTextHtml(d.notes),
    baseUrl: d.baseUrl,
    publishedAt: d.publishedAt,
  };
}
