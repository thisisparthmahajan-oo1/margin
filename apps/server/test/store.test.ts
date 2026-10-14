import { isInList, type Bookmark } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { backfill } from '../src/db.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore, snippet, SYNC_OVERLAP_MS } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

const ctx = useTestDb();
const store = () => createStore(ctx.c, createMediaStore(ctx.db), null);
const save = async (url: string) => (await store().saveBookmark({ url, canonicalUrl: url, source: 'web' })).bookmark;
const content = (title: string, text: string) => ({
  kind: 'article' as const, hasVideo: false, file: null, video: null, audio: null,
  title, byline: null, siteName: 'Site', excerpt: null, leadImage: null,
  contentHtml: `<p>${text}</p>`, plainText: text, wordCount: text.split(' ').length, publishedAt: null,
});

describe('store', () => {
  it('backfill makes items saved before PDFs/videos existed plain articles', async () => {
    const a = await save('https://old.com');
    await ctx.c.bookmarks.updateOne({ _id: a.id }, { $unset: { kind: '', hasVideo: '', file: '', video: '' } });
    await backfill(ctx.c);
    expect(await store().getBookmark(a.id)).toMatchObject({ kind: 'article', hasVideo: false, file: null, video: null });
  });

  it('re-saving an existing URL bumps it back to Home instead of duplicating', async () => {
    const a = await save('https://a.com');
    await store().updateBookmark(a.id, { archived: true });
    const again = await store().saveBookmark({ url: 'https://a.com', canonicalUrl: 'https://a.com', source: 'web' });
    expect(again.created).toBe(false);
    expect(again.bookmark.id).toBe(a.id);
    expect(isInList(again.bookmark, { kind: 'home' })).toBe(true);
  });

  it('never exposes server-only fields', async () => {
    const a = await save('https://a.com');
    await store().markReady(a.id, content('T', 'body text'));
    const b = (await store().getBookmark(a.id))!;
    expect(b).not.toHaveProperty('plainText');
    expect(b).not.toHaveProperty('_id');
    expect((await store().changesSince(0)).bookmarks[0]).not.toHaveProperty('plainText');
  });

  it('derives Instapaper lists from timestamps and folder', async () => {
    const folder = await store().createFolder({ name: 'Essays' });
    const b = (await store().updateBookmark((await save('https://b.com')).id, { liked: true, folderId: folder.id }))!;
    const lists = (x: Bookmark) =>
      [...(['home', 'liked', 'archive'] as const).filter((k) => isInList(x, { kind: k })), ...(isInList(x, { kind: 'folder', folderId: folder.id }) ? ['folder'] : [])];
    expect(lists(b)).toEqual(['liked', 'folder']);
    expect(lists((await store().updateBookmark(b.id, { archived: true }))!)).toEqual(['liked', 'archive']);
  });

  it('deleting a folder returns its articles to Home and leaves a tombstone', async () => {
    const folder = await store().createFolder({ name: 'F' });
    const b = (await store().updateBookmark((await save('https://c.com')).id, { folderId: folder.id }))!;
    await store().deleteFolder(folder.id);
    expect((await store().getBookmark(b.id))!.folderId).toBeNull();
    expect((await store().changesSince(0)).deletions).toEqual([expect.objectContaining({ entity: 'folder', id: folder.id })]);
  });

  it('sync cursor lags by the overlap window so late writes are not missed', async () => {
    const before = Date.now();
    const a = await save('https://a.com');
    const first = await store().changesSince(0);
    expect(first.bookmarks.map((b) => b.id)).toEqual([a.id]);
    expect(first.cursor).toBeLessThanOrEqual(before - SYNC_OVERLAP_MS + 50);
    // Re-delivered on the next pull (idempotent for clients), together with new deletions.
    const h = await store().createHighlight({ bookmarkId: a.id, anchor: { exact: 'x', prefix: '', suffix: '' } });
    await store().deleteBookmark(a.id);
    const second = await store().changesSince(first.cursor);
    expect(second.bookmarks).toEqual([]);
    expect(second.deletions.map((d) => `${d.entity}:${d.id}`).sort()).toEqual([`bookmark:${a.id}`, `highlight:${h.id}`].sort());
  });

  it('pages a large sync without losing or splitting items, and keeps reset on the first page', async () => {
    const old = Date.now() - 60 * 60_000;
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push((await save(`https://a.com/${i}`)).id);
    // Three items share each timestamp; a page must never split such a group.
    for (const [i, id] of ids.entries()) await ctx.c.bookmarks.updateOne({ _id: id }, { $set: { updatedAt: old + Math.floor(i / 3) } });
    const page = (since: number) => store().changesSince(since, { pageBytes: 1 });

    const seen: string[] = [];
    let since = 0;
    const pages = [];
    for (let res = await page(since); ; res = await page(since)) {
      pages.push(res);
      seen.push(...res.bookmarks.map((b) => b.id));
      expect(new Set(res.bookmarks.map((b) => b.updatedAt)).size).toBe(1); // one whole group per page
      since = res.cursor;
      if (!res.more) break;
    }
    expect(pages.map((p) => p.bookmarks.length)).toEqual([3, 3, 3]);
    expect(seen.sort()).toEqual([...ids].sort());
    expect(pages.at(-1)!.cursor).toBeGreaterThan(old); // back to the normal cursor once caught up

    // Small libraries come in one page, exactly as before.
    expect(await store().changesSince(0)).toMatchObject({ more: false });

    // A cursor past deletion retention: the first page is the reset, later pages aren't.
    const first = await store().changesSince(1, { pageBytes: 1 });
    expect(first).toMatchObject({ reset: true, more: true });
    expect((await store().changesSince(first.cursor, { pageBytes: 1 })).reset).toBe(false);
  });

  it('finds stale pending bookmarks for recovery', async () => {
    const a = await save('https://a.com');
    expect(await store().stalePendingIds()).toEqual([]);
    await ctx.c.bookmarks.updateOne({ _id: a.id }, { $set: { updatedAt: Date.now() - 5 * 60_000 } });
    expect(await store().stalePendingIds()).toEqual([a.id]);
  });

  it('full-text search requires every word and returns a marked snippet', async () => {
    const a = await save('https://a.com');
    const b = await save('https://b.com');
    await store().markReady(a.id, content('Gardening', 'Tomatoes need plenty of sunlight and water'));
    await store().markReady(b.id, content('Weather', 'Sunlight today, rain tomorrow'));
    expect((await store().search('sunlight')).map((h) => h.bookmarkId).sort()).toEqual([a.id, b.id].sort());
    const hits = await store().search('tomatoes sunlight');
    expect(hits.map((h) => h.bookmarkId)).toEqual([a.id]);
    expect(hits[0]!.snippet).toContain('[[Tomatoes]]');
    expect(await store().search('"); db.drop(')).toEqual([]);
  });
});

describe('snippet', () => {
  it('centres on the first match and marks all terms', () => {
    const text = `${'x'.repeat(300)} the quick fox ${'y'.repeat(300)}`;
    const s = snippet(text, ['quick', 'fox']);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('the [[quick]] [[fox]]');
  });
});
