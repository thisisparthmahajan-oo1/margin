import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractorFor } from '../src/extractors/index.ts';
import { fromApplePage, fromSpotifyPage, isoDurationSeconds } from '../src/extractors/podcast.ts';
import { extractFromHtml } from '../src/extractors/readability.ts';
import { canonicalize } from '../src/url.ts';

// Fixtures are cut down from the real pages (2026-10-14): only the tags the extractor reads.
const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('podcasts', () => {
  it('recognises Apple and Spotify episode links, and gives each episode one address', () => {
    const apple = [
      'https://podcasts.apple.com/us/podcast/dyna-2-general-purpose/id1674008350?i=1000796216260',
      'https://podcasts.apple.com/gb/podcast/dyna-2/id1674008350?i=1000796216260&uo=4',
    ];
    for (const link of apple) {
      expect(extractorFor(new URL(link)).name).toBe('podcast');
      expect(canonicalize(new URL(link))).toBe('https://podcasts.apple.com/podcast/id1674008350?i=1000796216260');
    }
    const spotify = ['https://open.spotify.com/episode/082a1V6nazH9ZZqskV1vfz?si=abc123', 'https://open.spotify.com/intl-de/episode/082a1V6nazH9ZZqskV1vfz'];
    for (const link of spotify) {
      expect(extractorFor(new URL(link)).name).toBe('podcast');
      expect(canonicalize(new URL(link))).toBe('https://open.spotify.com/episode/082a1V6nazH9ZZqskV1vfz');
    }
    // A show (not an episode) is just a web page.
    expect(extractorFor(new URL('https://podcasts.apple.com/us/podcast/latent-space/id1674008350')).name).toBe('readability');
    expect(extractorFor(new URL('https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL')).name).toBe('readability');
  });

  it('reads an Apple Podcasts episode from its schema.org data', () => {
    const ep = fromApplePage(fixture('apple-podcast-episode.html'), 'https://podcasts.apple.com/podcast/id1674008350?i=1000796216260');
    expect(ep).toMatchObject({
      kind: 'podcast',
      title: 'Dyna-2: General Purpose Physical Agents with Hour-Long Autonomy — Jason Ma, Dyna Robotics',
      byline: 'Latent Space: The AI Engineer Podcast',
      siteName: 'Apple Podcasts',
      audio: { provider: 'apple', showName: 'Latent Space: The AI Engineer Podcast', durationSeconds: 4317 },
      publishedAt: Date.parse('2026-10-13'),
    });
    expect(ep.leadImage).toMatch(/^https:\/\/is1-ssl\.mzstatic\.com\//);
    expect(ep.html).toMatch(/^<p>Watch along AIE NYC/);
    // The page cuts the notes short; the full ones from the iTunes lookup win when there are any.
    const full = fromApplePage(fixture('apple-podcast-episode.html'), 'https://x', 'Full notes.\n\nSecond paragraph.');
    expect(full.html).toBe('<p>Full notes.</p>\n<p>Second paragraph.</p>');
  });

  it('reads a Spotify episode from the tags it gives link previews', () => {
    const ep = fromSpotifyPage(fixture('spotify-episode.html'), 'https://open.spotify.com/episode/082a1V6nazH9ZZqskV1vfz');
    expect(ep).toMatchObject({
      kind: 'podcast',
      title: '#502 – Psychiatry, Insane Asylums, Mental Illness, ECT, Lobotomies, Freud & Jung',
      audio: { provider: 'spotify', showName: 'Lex Fridman Podcast', durationSeconds: 13410 },
      publishedAt: Date.parse('2026-09-17T00:42:00Z'),
    });
    expect(ep.excerpt).toMatch(/^Andrew Scull is a historian of psychiatry/); // "Listen to this episode from … on Spotify." removed
  });

  it('turns other podcast pages into episodes, with their notes as the text', () => {
    const body = '<article><h1>Episode 12</h1>' + '<p>Show notes and a long transcript of the conversation.</p>'.repeat(20) + '</article>';
    const substack = extractFromHtml(
      `<html><head><meta property="og:site_name" content="Latent.Space"><meta name="twitter:player" content="https://www.latent.space/embed/podcast/dyna?autoplay=1"></head>
       <body>${body}<script>window._preloads = JSON.parse("{\\"podcast_duration\\":4316.996}")</script></body></html>`,
      'https://www.latent.space/p/dyna',
    );
    expect(substack).toMatchObject({ kind: 'podcast', audio: { provider: 'web', showName: 'Latent.Space', durationSeconds: 4317 } });

    const ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'PodcastEpisode', duration: 'PT45M', partOfSeries: { name: 'The Show' } }] };
    const hosted = extractFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${body}</body></html>`,
      'https://show.example.com/12',
    );
    expect(hosted).toMatchObject({ kind: 'podcast', audio: { showName: 'The Show', durationSeconds: 2700 } });

    expect(extractFromHtml(`<html><body>${body}</body></html>`, 'https://example.com/post').kind).toBe('article');
  });

  it('parses ISO 8601 durations', () => {
    expect(isoDurationSeconds('PT1H11M57S')).toBe(4317);
    expect(isoDurationSeconds('PT45M')).toBe(2700);
    expect(isoDurationSeconds('PT90.4S')).toBe(90);
    expect(isoDurationSeconds('PT')).toBeNull();
    expect(isoDurationSeconds('45 minutes')).toBeNull();
    expect(isoDurationSeconds(undefined)).toBeNull();
  });
});
