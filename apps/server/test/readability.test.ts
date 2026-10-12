import { describe, expect, it } from 'vitest';
import { extractFromHtml } from '../src/extractors/readability.ts';

const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} has enough words, commas, and sentences to look like real article content to the scorer.</p>`).join('');

describe('readability extraction', () => {
  it('handles pages that omit the optional <head>/<body> tags', () => {
    // Minified sites (e.g. danluu.com) rely on HTML5 implied tags.
    const html = `<!DOCTYPE html><html lang=en><meta charset=utf-8><title>Implied tags</title><main><h1>Implied tags</h1>${paragraphs}</main>`;
    const a = extractFromHtml(html, 'https://example.com/post');
    expect(a.title).toBe('Implied tags');
    expect(a.html).toContain('Paragraph 7');
  });

  it('reads metadata', () => {
    const html = `<html><head><title>T</title><meta property="og:image" content="/cover.jpg"><meta property="article:published_time" content="2024-05-01T00:00:00Z"></head><body><article>${paragraphs}</article></body></html>`;
    const a = extractFromHtml(html, 'https://example.com/a/b');
    expect(a.leadImage).toBe('https://example.com/cover.jpg');
    expect(a.publishedAt).toBe(Date.parse('2024-05-01T00:00:00Z'));
  });
});
