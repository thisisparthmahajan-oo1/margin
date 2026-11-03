import { CLIP_HTML_MAX, type Bookmark } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createIngestor, type ClippedPage } from '../src/ingest.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

// The "Save to Margin" bookmarklet: the browser hands over the page, so a site that blocks Margin can still be saved.
const ctx = useTestDb();
const work: Promise<unknown>[] = [];
const enqueued: { id: string; clipped?: ClippedPage }[] = [];
const app = () =>
  createApp({
    appToken: null,
    deps: async () => {
      const media = createMediaStore(ctx.db);
      const store = createStore(ctx.c, media, null);
      const ingestor = createIngestor(store, media, null, (w) => void work.push(w));
      return {
        store,
        media,
        files: null,
        ingestor: {
          enqueue: (id: string, clipped?: ClippedPage) => {
            enqueued.push({ id, clipped });
            // Only clipped pages are read here; anything else would fetch from the network.
            if (clipped) ingestor.enqueue(id, clipped);
          },
        },
      };
    },
  });
const save = async (body: Record<string, unknown>) =>
  app().request('/api/bookmarks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const settled = async (id: string) => {
  await Promise.all(work.splice(0));
  return (await (await app().request(`/api/bookmarks/${id}`)).json()) as Bookmark;
};

const page = (heading: string) => `<!doctype html><html><head><title>${heading}</title></head><body><article>
  <h1>${heading}</h1>
  ${'<p>A forward deployed engineer works with customers to ship the product where it is used, and this paragraph is long enough to count as content.</p>'.repeat(6)}
</article></body></html>`;

describe('saving a page the browser handed over', () => {
  it('reads the clipped copy instead of fetching the link', async () => {
    const res = await save({ url: 'https://blocked.invalid/what-is-fde', html: page('What is a forward deployed engineer') });
    expect(res.status).toBe(201);
    const b = await settled(((await res.json()) as Bookmark).id);
    expect(b).toMatchObject({ status: 'ready', title: 'What is a forward deployed engineer' });
    expect(b.contentHtml).toContain('works with customers');
  });

  it('re-reads an address that is already saved, even a ready one', async () => {
    const first = (await (await save({ url: 'https://blocked.invalid/post', html: page('First copy') })).json()) as Bookmark;
    await settled(first.id);
    const res = await save({ url: 'https://blocked.invalid/post', html: page('Second copy') });
    expect(res.status).toBe(200);
    expect(await settled(first.id)).toMatchObject({ id: first.id, status: 'ready', title: 'Second copy' });
  });

  it('ignores the copy for links with their own extractor', async () => {
    const res = await save({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html: page('Not used') });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as Bookmark;
    expect(enqueued.find((e) => e.id === id)).toEqual({ id, clipped: undefined });
  });

  it('turns away a page that is too large, saving nothing', async () => {
    const res = await save({ url: 'https://blocked.invalid/huge', html: 'x'.repeat(CLIP_HTML_MAX + 1) });
    expect(res.status).toBe(413);
    expect((await save({ url: 'https://blocked.invalid/odd', html: 42 })).status).toBe(400);
    const sync = await (await app().request('/api/sync?since=0')).json();
    expect(sync.bookmarks).toEqual([]);
  });
});
