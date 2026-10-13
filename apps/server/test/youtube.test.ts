import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromYouTube, playerDetails, youtubeVideoId } from '../src/extractors/youtube.ts';
import { canonicalize } from '../src/url.ts';

const watchPage = fs.readFileSync(new URL('./fixtures/youtube-watch.html', import.meta.url), 'utf8');

describe('YouTube', () => {
  it('recognises every link form and canonicalizes them to one address', () => {
    const forms = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc',
      'https://youtu.be/dQw4w9WgXcQ?si=xyz',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared',
    ];
    for (const f of forms) {
      expect(youtubeVideoId(new URL(f))).toBe('dQw4w9WgXcQ');
      expect(canonicalize(new URL(f))).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
    }
    expect(youtubeVideoId(new URL('https://www.youtube.com/@RickAstleyYT'))).toBeNull();
    expect(youtubeVideoId(new URL('https://example.com/watch?v=dQw4w9WgXcQ'))).toBeNull();
  });

  it('reads description, duration and date from the watch page', () => {
    const d = playerDetails(watchPage)!;
    expect(d.durationSeconds).toBe(213);
    expect(d.publishedAt).toBe(Date.parse('2009-10-24T23:57:33-07:00'));
    expect(d.description).toMatch(/^The official video for/);
    expect(d.description).toContain('Tricky: {"a":"};"}');
    expect(playerDetails('<html>consent page</html>')).toBeNull();
  });

  it('builds a video item: the description is the text, the thumbnail the image', () => {
    const v = fromYouTube(
      'dQw4w9WgXcQ',
      { title: 'Never Gonna Give You Up', author_name: 'Rick Astley', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
      { description: 'First line\nsecond line\n\nMore at https://example.com/x?a=1&b=2', durationSeconds: 213, publishedAt: null },
    );
    expect(v).toMatchObject({
      kind: 'video', hasVideo: true, title: 'Never Gonna Give You Up', byline: 'Rick Astley', siteName: 'YouTube',
      video: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', durationSeconds: 213 },
    });
    expect(v.html).toBe(
      '<p>First line<br>second line</p>\n<p>More at <a href="https://example.com/x?a=1&amp;b=2">https://example.com/x?a=1&amp;b=2</a></p>',
    );
    // Without the watch page (blocked), it still saves from oEmbed alone.
    expect(fromYouTube('dQw4w9WgXcQ', { title: 'T', author_name: 'A' }, null)).toMatchObject({
      video: { durationSeconds: null }, html: '', leadImage: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });
});
