import { describe, expect, it } from 'vitest';
import { extractorFor } from '../src/extractors/index.ts';
import { fromWorkableJob, parseWorkableUrl, type WorkableJob } from '../src/extractors/workable.ts';
import job from './fixtures/workable-job.json' with { type: 'json' };

const PAGE = 'https://apply.workable.com/raydar/j/123243A7E7/';

describe('Workable URL matching', () => {
  it.each([
    ['https://apply.workable.com/j/123243A7E7', { account: null, shortcode: '123243A7E7' }],
    ['https://apply.workable.com/raydar/j/123243A7E7/', { account: 'raydar', shortcode: '123243A7E7' }],
    ['https://apply.workable.com/raydar/j/123243A7E7/apply', { account: 'raydar', shortcode: '123243A7E7' }],
    ['https://raydar.workable.com/j/123243A7E7', { account: 'raydar', shortcode: '123243A7E7' }],
    ['https://apply.workable.com/raydar/', null],
    ['https://apply.workable.com/api/v2/accounts/raydar', null],
    ['https://www.workable.com/j/123243A7E7', null],
    ['https://example.com/j/123243A7E7', null],
  ])('%s', (url, ref) => {
    expect(parseWorkableUrl(new URL(url))).toEqual(ref);
  });

  it('routes Workable jobs to the Workable extractor', () => {
    expect(extractorFor(new URL('https://apply.workable.com/j/123243A7E7')).name).toBe('workable');
    expect(extractorFor(new URL('https://apply.workable.com/raydar/')).name).toBe('readability');
  });
});

describe('Workable job -> article', () => {
  it('heads the posting with its facts, then description, requirements and benefits', () => {
    const a = fromWorkableJob(job as WorkableJob, 'Raydar', PAGE);
    expect(a).toMatchObject({
      kind: 'article',
      title: 'Staff Software Engineer · Raydar',
      siteName: 'Raydar',
      baseUrl: PAGE,
      publishedAt: Date.parse('2026-08-07T00:00:00.000Z'),
    });
    expect(a.html).toMatch(
      /^<p><strong>Raydar<\/strong> · London, England, United Kingdom · Full-time · On-site · £150,000–£250,000 \/ year<\/p><p>About the company/,
    );
    const at = (s: string) => a.html.indexOf(s);
    expect(at('<h2>Requirements</h2>')).toBeGreaterThan(at('About the company'));
    expect(at('<h2>Benefits</h2>')).toBeGreaterThan(at('<h2>Requirements</h2>'));
  });

  it('leaves out what the posting doesn’t state', () => {
    const a = fromWorkableJob({ title: 'Engineer', description: '<p>Build things</p>', remote: true }, null, PAGE);
    expect(a.title).toBe('Engineer');
    expect(a.html).toBe('<p>Remote</p><p>Build things</p>');
  });

  it('a posting with no text at all is an error', () => {
    expect(() => fromWorkableJob({ title: 'Engineer' }, 'Raydar', PAGE)).toThrow('no description');
  });
});
