import { describe, expect, it } from 'vitest';
import { extractorFor } from '../src/extractors/index.ts';
import { fromFxStatus, parseXPostId, type FxStatusResponse } from '../src/extractors/x-article.ts';
import fixture from './fixtures/fx-article.json' with { type: 'json' };

describe('X URL matching', () => {
  it.each([
    ['https://x.com/writer/status/1900000000000000001', '1900000000000000001'],
    ['https://twitter.com/writer/status/123?s=20&t=abc', '123'],
    ['https://mobile.twitter.com/writer/status/123/photo/1', '123'],
    ['https://x.com/i/web/status/123', '123'],
    ['https://x.com/writer/article/123', '123'],
    ['https://example.com/writer/status/123', null],
    ['https://x.com/writer', null],
  ])('%s -> %s', (url, id) => {
    expect(parseXPostId(new URL(url))).toBe(id);
  });

  it('routes X posts to the X extractor and everything else to readability', () => {
    expect(extractorFor(new URL('https://x.com/a/status/1')).name).toBe('x-article');
    expect(extractorFor(new URL('https://x.com/i/article/1')).name).toBe('x-article');
    expect(extractorFor(new URL('https://paulgraham.com/greatwork.html')).name).toBe('readability');
  });
});

describe('FxTwitter article -> HTML', () => {
  const article = fromFxStatus(fixture as unknown as FxStatusResponse);

  it('maps metadata', () => {
    expect(article.title).toBe('On Writing Long Posts');
    expect(article.byline).toBe('A Writer (@writer)');
    expect(article.leadImage).toBe('https://pbs.twimg.com/media/cover.jpg');
    expect(article.publishedAt).toBe(1741000000_000);
  });

  it('renders inline styles, headings and grouped lists', () => {
    expect(article.html).toContain('<p>Hello <strong>bold</strong> and <em>italic</em> world.</p>');
    expect(article.html).toContain('<h2>A heading</h2>');
    expect(article.html).toContain('<ul><li>first</li>\n<li>second</li></ul>');
  });

  it('renders media, code and embedded posts from atomic blocks', () => {
    expect(article.html).toContain('<img src="https://pbs.twimg.com/media/inline.jpg"');
    expect(article.html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
    expect(article.html).toContain('href="https://x.com/i/status/123"');
  });

  it('links urls and mentions and escapes text', () => {
    expect(article.html).toContain('<a href="https://example.com">example.com</a>');
    expect(article.html).toContain('<a href="https://x.com/jack">@jack</a>');
    expect(article.html).toContain('&lt;script&gt;');
  });

  it('rejects unavailable posts', () => {
    expect(() => fromFxStatus({ code: 404, message: 'NOT_FOUND' })).toThrow(/unavailable/);
  });
});
