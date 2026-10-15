import { describe, expect, it } from 'vitest';
import { processPage } from '../src/pipeline.ts';
import type { MediaStore } from '../src/media.ts';

const media = { put: async () => '/api/media/x.png' } as unknown as MediaStore;
const page = (html: string) =>
  processPage(
    { kind: 'article', hasVideo: false, title: 'T', byline: null, siteName: null, excerpt: null, leadImage: null, html, baseUrl: 'https://example.com/p/', publishedAt: null },
    media,
  );

describe('inline SVG', () => {
  it('turns a diagram into a note with its title and description, instead of its labels run together', async () => {
    const { contentHtml, plainText } = await page(`<p>Before.</p>
      <svg viewBox="0 0 10 10"><title>Independent encoding</title><desc>Only the state changes</desc>
        <g><text>Request state</text><text>state + question</text></g><svg><text>nested</text></svg></svg>
      <p>After.</p>`);
    expect(plainText).not.toContain('Request state');
    expect(plainText).not.toContain('nested');
    expect(plainText).toContain('Diagram: Independent encoding. Only the state changes. See it on the original page');
    expect(contentHtml).toContain('<a href="https://example.com/p/"');
  });

  it('labels an untitled diagram, and drops icons', async () => {
    const { plainText } = await page('<p>Hi <svg><path d="M0 0"/></svg>there.</p><svg><text>A</text><text>B</text></svg>');
    expect(plainText).toBe('Hi there. Diagram See it on the original page ↗');
  });
});
