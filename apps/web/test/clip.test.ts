import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No server in these tests: changes just queue in the outbox.
vi.mock('../src/data/sync.ts', () => ({ syncNow: async () => {} }));
vi.mock('../src/data/api.ts', () => ({ api: async () => Promise.reject(new Error('offline')), ApiRequestError: Error }));

const { db } = await import('../src/data/db.ts');
const { saveClip, saveUrl } = await import('../src/data/actions.ts');
const { bookmarkletFor, clipPage, decodeClip } = await import('../src/data/clip.ts');

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.outbox.clear()]);
});

const article = `<html><head><title>What is an FDE</title><script type="application/ld+json">{"@type":"Article"}</script>
  <script>track()</script><style>p{}</style></head><body><article><h1>What is an FDE</h1><p>Ships with customers. ✓</p>
  <svg><path/></svg><iframe src="https://ads.example/x"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe></article></body></html>`;

describe('the Save to Margin bookmarklet', () => {
  it('hands the page, stripped, to /clip, and /clip reads it back', async () => {
    document.documentElement.innerHTML = article;
    let href = '';
    await clipPage('https://margin.example', 1_500_000, document, (h) => (href = h), () => {});
    const opened = new URL(href);
    expect(opened.origin + opened.pathname).toBe('https://margin.example/clip');

    const clip = await decodeClip(opened.hash);
    expect(clip!.url).toBe(document.location.href);
    expect(clip!.html).toContain('Ships with customers. ✓');
    expect(clip!.html).toContain('application/ld+json'); // the JSON-LD extraction reads
    expect(clip!.html).toContain('youtube.com/embed'); // a player is kept
    for (const gone of ['track()', '<style', '<svg', 'ads.example']) expect(clip!.html).not.toContain(gone);
  });

  it('warns instead of opening Margin when the page is too large', async () => {
    document.documentElement.innerHTML = article;
    const go = vi.fn();
    const warn = vi.fn();
    await clipPage('https://margin.example', 10, document, go, warn);
    expect(go).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('is a self-contained javascript: address for this Margin', () => {
    const code = decodeURIComponent(bookmarkletFor('https://margin.example').replace(/^javascript:/, ''));
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain('"https://margin.example"');
  });

  it('a damaged clip is null', async () => {
    expect(await decodeClip('#u=https%3A%2F%2Fa.example&h=not-gzip')).toBeNull();
    expect(await decodeClip('#something-else')).toBeNull();
  });
});

describe('saving a clip on the device', () => {
  it('queues the page with the save', async () => {
    const id = await saveClip('https://blocked.example/post', '<p>Hi</p>');
    expect(await db.bookmarks.get(id)).toMatchObject({ url: 'https://blocked.example/post', status: 'pending' });
    expect((await db.outbox.toArray()).map((o) => o.op)).toEqual([
      { type: 'bookmark.create', id, url: 'https://blocked.example/post', html: '<p>Hi</p>' },
    ]);
  });

  it('re-reads an item that is already saved, in place', async () => {
    const id = await saveUrl('https://blocked.example/post');
    await db.bookmarks.update(id!, { status: 'failed', error: 'HTTP 403' });
    expect(await saveClip('https://blocked.example/post', '<p>Hi</p>')).toBe(id);
    expect(await db.bookmarks.count()).toBe(1);
    expect(await db.bookmarks.get(id!)).toMatchObject({ status: 'pending', error: null });
  });
});
