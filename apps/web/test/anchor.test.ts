import { describe, expect, it } from 'vitest';
import { clearHighlights, describeRange, highlight, locate } from '../src/reader/anchor.ts';

const article = (html: string) => {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
};

describe('text-quote anchoring', () => {
  it('round-trips a selection spanning inline elements', () => {
    const root = article('<p>The quick <em>brown fox</em> jumps over the lazy dog.</p>');
    const range = document.createRange();
    range.setStart(root.querySelector('p')!.firstChild!, 4); // "quick"
    range.setEnd(root.querySelector('em')!.firstChild!, 5); // "brown"
    const anchor = describeRange(root, range)!;
    expect(anchor.exact).toBe('quick brown');
    expect(anchor.prefix).toBe('The ');

    // Re-render from scratch, then re-apply.
    const fresh = article('<p>The quick <em>brown fox</em> jumps over the lazy dog.</p>');
    expect(highlight(fresh, anchor, { 'data-hl': 'h1' })).toBe(true);
    const marks = [...fresh.querySelectorAll('mark[data-hl="h1"]')].map((m) => m.textContent);
    expect(marks).toEqual(['quick ', 'brown']);
    clearHighlights(fresh, 'mark[data-hl]');
    expect(fresh.innerHTML).toBe('<p>The quick <em>brown fox</em> jumps over the lazy dog.</p>');
  });

  it('disambiguates repeated text using context', () => {
    const text = 'one cat here. two cat there.';
    expect(locate(text, { exact: 'cat', prefix: 'two ', suffix: ' there' })).toEqual({ start: 18, end: 21 });
    expect(locate(text, { exact: 'cat', prefix: 'one ', suffix: ' here' })).toEqual({ start: 4, end: 7 });
  });

  it('reports highlights whose text no longer exists', () => {
    const root = article('<p>Completely different</p>');
    expect(highlight(root, { exact: 'gone', prefix: '', suffix: '' }, {})).toBe(false);
  });
});
