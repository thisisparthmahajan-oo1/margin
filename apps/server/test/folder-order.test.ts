import { folderOrder, type Bookmark } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { backfill } from '../src/db.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

const ctx = useTestDb();
const store = () => createStore(ctx.c, createMediaStore(ctx.db), null);
const save = async (url: string, folderId: string | null = null) =>
  (await store().saveBookmark({ url, canonicalUrl: url, source: 'web', folderId })).bookmark;
const api = () =>
  createApp({
    appToken: null,
    deps: async () => ({ store: store(), media: createMediaStore(ctx.db), files: null, ingestor: { enqueue: () => {} } }),
  });
const send = (method: string, path: string, body: unknown) =>
  api().request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const order = async (folderId: string) =>
  (await ctx.c.bookmarks.find({ folderId }).toArray()).map((d) => ({ ...d, id: d._id }) as unknown as Bookmark).sort(folderOrder).map((b) => b.url);

describe('a folder in your own order', () => {
  it('new arrivals join the bottom, whether saved into the folder or moved there', async () => {
    const q = await store().createFolder({ name: 'Depth queue' });
    expect(q.customOrder).toBe(false);
    const a = await save('https://a.com', q.id);
    const b = await save('https://b.com', q.id);
    const c = await save('https://c.com');
    expect([a.folderPosition, b.folderPosition, c.folderPosition]).toEqual([0, 1, null]);

    await store().updateBookmark(a.id, { folderPosition: 1.5 }); // dragged below b
    expect(await order(q.id)).toEqual(['https://b.com', 'https://a.com']);
    await store().updateBookmark(c.id, { folderId: q.id });
    expect(await order(q.id)).toEqual(['https://b.com', 'https://a.com', 'https://c.com']);
  });

  it('leaving a folder, or the folder going, clears the position; a move outside a folder is ignored', async () => {
    const q = await store().createFolder({ name: 'Breadth queue' });
    const a = await save('https://a.com', q.id);
    const b = await save('https://b.com', q.id);
    expect((await store().updateBookmark(a.id, { folderId: null }))!.folderPosition).toBeNull();
    expect((await store().updateBookmark(a.id, { folderPosition: 3 }))!.folderPosition).toBeNull();
    // Staying in the same folder keeps the place.
    expect((await store().updateBookmark(b.id, { folderId: q.id }))!.folderPosition).toBe(1);
    await store().deleteFolder(q.id);
    expect((await store().getBookmark(b.id))!).toMatchObject({ folderId: null, folderPosition: null });
  });

  it('the API checks a position and the "My order" switch', async () => {
    const q = await store().createFolder({ name: 'Depth queue' });
    const a = await save('https://a.com', q.id);
    expect((await send('PATCH', `/api/bookmarks/${a.id}`, { folderPosition: 'top' })).status).toBe(400);
    expect((await send('PATCH', `/api/folders/${q.id}`, { customOrder: 'yes' })).status).toBe(400);
    const res = await send('PATCH', `/api/folders/${q.id}`, { customOrder: true });
    expect(await res.json()).toMatchObject({ customOrder: true, name: 'Depth queue' });
    const sync = await store().changesSince(0);
    expect(sync.folders.find((f) => f.id === q.id)!.customOrder).toBe(true);
  });

  it('items filed before this existed get positions in the order they were saved', async () => {
    const q = await store().createFolder({ name: 'Old folder' });
    const [a, b, c] = [await save('https://a.com', q.id), await save('https://b.com', q.id), await save('https://c.com')];
    await ctx.c.bookmarks.updateMany({}, { $unset: { folderPosition: '' } });
    await ctx.c.folders.updateMany({}, { $unset: { customOrder: '' } });
    await ctx.c.bookmarks.updateOne({ _id: a.id }, { $set: { savedAt: b.savedAt + 1 } }); // a saved after b
    await backfill(ctx.c);
    expect((await store().getBookmark(b.id))!.folderPosition).toBe(0);
    expect((await store().getBookmark(a.id))!.folderPosition).toBe(1);
    expect((await store().getBookmark(c.id))!.folderPosition).toBeNull();
    expect((await store().getFolder(q.id))!.customOrder).toBe(false);
  });
});
