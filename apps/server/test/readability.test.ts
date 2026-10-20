import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFromHtml } from '../src/extractors/readability.ts';

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

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

  describe('job postings', () => {
    const page = (ld: unknown) =>
      `<html><head><title>Jobs</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><div id="root"></div></body></html>`;

    it('falls back to a JSON-LD JobPosting when the page has no visible content', () => {
      const html = page({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', name: 'Acme' },
          {
            '@type': 'JobPosting',
            title: 'Staff Engineer',
            description: '&lt;h2&gt;About us&lt;/h2&gt;&lt;p&gt;We make anvils &amp;amp; rockets.&lt;/p&gt;',
            datePosted: '2026-05-06',
            hiringOrganization: { '@type': 'Organization', name: 'Acme' },
            jobLocation: [
              { '@type': 'Place', address: { addressLocality: 'London', addressCountry: 'GB' } },
              { '@type': 'Place', address: 'Berlin' },
            ],
            employmentType: ['FULL_TIME'],
            jobLocationType: 'TELECOMMUTE',
          },
        ],
      });
      const a = extractFromHtml(html, 'https://jobs.example.com/acme/1');
      expect(a).toMatchObject({ kind: 'article', title: 'Staff Engineer · Acme', siteName: 'Acme', publishedAt: Date.parse('2026-05-06') });
      expect(a.html).toBe('<p><strong>Acme</strong> · London, GB · Berlin · Full time · Remote</p><h2>About us</h2><p>We make anvils &amp; rockets.</p>');
    });

    it('still fails when there is neither content nor a JobPosting', () => {
      expect(() => extractFromHtml(page({ '@type': 'Organization', name: 'Acme' }), 'https://example.com/')).toThrow(
        'Could not find article content on this page',
      );
    });

    it('reads a real Ashby posting', () => {
      const a = extractFromHtml(fixture('ashby-job.html'), 'https://jobs.ashbyhq.com/elevenlabs/275f43d0-b62d-401d-830c-7c1ac0e688aa');
      expect(a.title).toBe('Enterprise Solutions Engineer - USA · ElevenLabs');
      expect(a.siteName).toBe('ElevenLabs');
      expect(a.publishedAt).toBe(Date.parse('2026-05-06'));
      expect(a.html).toMatch(/^<p><strong>ElevenLabs<\/strong> · United States · Full time · Remote<\/p><h2>About ElevenLabs<\/h2>/);
    });
  });
});
