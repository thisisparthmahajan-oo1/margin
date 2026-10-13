import { describe, expect, it } from 'vitest';
import { createMediaStore } from '../src/media.ts';
import { createStore, DELETION_RETENTION_MS } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

const ctx = useTestDb();
const setup = () => {
  const media = createMediaStore(ctx.db);
  return { media, store: createStore(ctx.c, media, null) };
};
const article = (title: string, images: string[], leadImage: string | null = null) => ({
  kind: 'article' as const, hasVideo: false, file: null, video: null,
  title, byline: null, siteName: null, excerpt: null, leadImage, plainText: title, wordCount: 1, publishedAt: null,
  contentHtml: images.map((src) => `<img src="${src}">`).join(''),
});
const exists = async (path: string) => (await createMediaStore(ctx.db).open(path.split('/').pop()!)) !== null;

describe('hard delete', () => {
  it('removes the article, its highlights and the images only it used; shared images stay', async () => {
    const { media, store } = setup();
    const own = await media.save(Buffer.from('only-a'), 'image/png', 'png');
    const shared = await media.save(Buffer.from('shared'), 'image/png', 'png');
    const thumb = await media.save(Buffer.from('thumb-a'), 'image/jpeg', 'jpg');

    const a = (await store.saveBookmark({ url: 'https://a.com', canonicalUrl: 'https://a.com', source: 'web' })).bookmark;
    const b = (await store.saveBookmark({ url: 'https://b.com', canonicalUrl: 'https://b.com', source: 'web' })).bookmark;
    await store.markReady(a.id, article('A', [own, shared], thumb));
    await store.markReady(b.id, article('B', [shared]));
    await store.createHighlight({ bookmarkId: a.id, anchor: { exact: 'A', prefix: '', suffix: '' } });

    expect(await store.deleteBookmark(a.id)).toBe(true);
    expect(await store.getBookmark(a.id)).toBeNull();
    expect(await ctx.c.highlights.countDocuments({ bookmarkId: a.id })).toBe(0);
    expect(await exists(own)).toBe(false);
    expect(await exists(thumb)).toBe(false);
    expect(await exists(shared)).toBe(true); // still used by B

    await store.deleteBookmark(b.id);
    expect(await exists(shared)).toBe(false);
  });

  it('re-downloading an article releases images the new version no longer uses', async () => {
    const { media, store } = setup();
    const before = await media.save(Buffer.from('old'), 'image/png', 'png');
    const after = await media.save(Buffer.from('new'), 'image/png', 'png');
    const a = (await store.saveBookmark({ url: 'https://a.com', canonicalUrl: 'https://a.com', source: 'web' })).bookmark;
    await store.markReady(a.id, article('A', [before]));
    await store.markReady(a.id, article('A', [after]));
    expect(await exists(before)).toBe(false);
    expect(await exists(after)).toBe(true);
  });

  it('never sends server-only fields to clients', async () => {
    const { store } = setup();
    const a = (await store.saveBookmark({ url: 'https://a.com', canonicalUrl: 'https://a.com', source: 'web' })).bookmark;
    await store.markReady(a.id, article('A', ['/api/media/x.png']));
    const synced = (await store.changesSince(0)).bookmarks[0]!;
    expect(synced).not.toHaveProperty('mediaPaths');
    expect(synced).not.toHaveProperty('plainText');
    expect(await store.getBookmark(a.id)).not.toHaveProperty('mediaPaths');
  });
});

describe('deletion records', () => {
  it('expire after the retention period (TTL)', async () => {
    const { store } = setup();
    const a = (await store.saveBookmark({ url: 'https://a.com', canonicalUrl: 'https://a.com', source: 'web' })).bookmark;
    await store.deleteBookmark(a.id);
    const record = await ctx.c.deletions.findOne({ id: a.id });
    expect(record!.expiresAt.getTime() - record!.deletedAt).toBe(DELETION_RETENTION_MS);
    const ttl = (await ctx.c.deletions.indexes()).find((i) => i.key.expiresAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(0);
  });

  it('a device that has been away longer than the retention period gets a full snapshot', async () => {
    const { store } = setup();
    const a = (await store.saveBookmark({ url: 'https://a.com', canonicalUrl: 'https://a.com', source: 'web' })).bookmark;
    const stale = await store.changesSince(Date.now() - DELETION_RETENTION_MS - 60_000);
    expect(stale.reset).toBe(true);
    expect(stale.bookmarks.map((b) => b.id)).toEqual([a.id]);
    expect(stale.deletions).toEqual([]);
    expect((await store.changesSince(Date.now() - 60_000)).reset).toBe(false);
  });
});
