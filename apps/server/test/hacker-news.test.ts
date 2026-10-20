import { describe, expect, it } from 'vitest';
import { fromHnItem, parseHnItemId, type HnItem } from '../src/extractors/hacker-news.ts';
import { extractorFor } from '../src/extractors/index.ts';
import comment from './fixtures/hn-comment.json' with { type: 'json' };

describe('Hacker News URL matching', () => {
  it.each([
    ['https://news.ycombinator.com/item?id=49980680', 49980680],
    ['https://news.ycombinator.com/item?id=123#456', 123],
    ['https://news.ycombinator.com/', null],
    ['https://news.ycombinator.com/user?id=pg', null],
    ['https://news.ycombinator.com/item?id=abc', null],
    ['https://example.com/item?id=123', null],
  ])('%s -> %s', (url, id) => {
    expect(parseHnItemId(new URL(url))).toBe(id);
  });

  it('routes HN items to the Hacker News extractor', () => {
    expect(extractorFor(new URL('https://news.ycombinator.com/item?id=1')).name).toBe('hacker-news');
    expect(extractorFor(new URL('https://news.ycombinator.com/news')).name).toBe('readability');
  });
});

describe('HN item -> article', () => {
  it('heads a comment with its thread and titles it by its first line', () => {
    const a = fromHnItem(comment as HnItem, { id: 49922569, title: 'Ask HN: Who is hiring? (October 2026)' });
    expect(a).toMatchObject({
      kind: 'article',
      title: 'Coder | https://coder.com/ | Multiple roles | Multiple locations | Full-time',
      byline: 'elianahammonds',
      siteName: 'Hacker News',
      baseUrl: 'https://news.ycombinator.com/item?id=49980680',
      publishedAt: comment.time * 1000,
    });
    expect(a.html).toMatch(/^<p>In <a href="https:\/\/news\.ycombinator\.com\/item\?id=49922569">Ask HN: Who is hiring\? \(October 2026\)<\/a><\/p>Coder \| <a href=/);
    expect(a.html).toContain('Coder is an AI software development company');
  });

  it('cuts a long first line at a word', () => {
    const a = fromHnItem({ id: 1, type: 'comment', by: 'x', text: `${'word '.repeat(40)}<p>Second paragraph` }, null);
    expect(a.title.length).toBeLessThanOrEqual(121);
    expect(a.title).toMatch(/^word( word)*…$/);
  });

  it('keeps a text post’s own title and HTML', () => {
    const a = fromHnItem({ id: 2, type: 'story', by: 'pg', time: 1, title: 'Ask HN: What are you working on?', text: 'Tell us &amp; share.' }, null);
    expect(a.title).toBe('Ask HN: What are you working on?');
    expect(a.html).toBe('Tell us &amp; share.');
  });

  it('rejects deleted items', () => {
    expect(() => fromHnItem({ id: 3, type: 'comment', deleted: true }, null)).toThrow('This Hacker News item was deleted');
  });
});
