import { describe, expect, it } from 'vitest';
import { canonicalize, parseUserUrl } from '../src/url.ts';

describe('url', () => {
  it('accepts urls without a scheme and rejects non-http', () => {
    expect(parseUserUrl('example.com/a')?.href).toBe('https://example.com/a');
    expect(parseUserUrl('javascript:alert(1)')).toBeNull();
    expect(parseUserUrl('not a url')).toBeNull();
  });

  it('collapses share-link variants to one canonical form', () => {
    const c = (u: string) => canonicalize(new URL(u));
    expect(c('http://www.Example.com/post/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/post?a=1&b=2');
    expect(c('https://twitter.com/u/status/1?s=20&t=abc')).toBe('https://x.com/u/status/1');
    expect(c('https://example.com/search?s=keep')).toBe('https://example.com/search?s=keep');
  });
});
