// @vitest-environment node
import 'fake-indexeddb/auto';
import { folderOrder, type Bookmark } from '@margin/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No server in these tests: changes just queue in the outbox.
vi.mock('../src/data/sync.ts', () => ({ syncNow: async () => {} }));
vi.mock('../src/data/api.ts', () => ({ api: async () => Promise.reject(new Error('offline')), ApiRequestError: Error }));

const { db } = await import('../src/data/db.ts');
const { createFolder, moveToFolder, positionBetween, reorderInFolder, saveUrl, setFolderCustomOrder } = await import('../src/data/actions.ts');

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.folders.clear(), db.outbox.clear()]);
});

const item = async (url: string) => (await db.bookmarks.get((await saveUrl(url))!))!;
const fresh = async (b: Bookmark) => (await db.bookmarks.get(b.id))!;
const queue = async (folderId: string) =>
  (await db.bookmarks.filter((b) => b.folderId === folderId).toArray()).sort(folderOrder).map((b) => b.url);

describe('a folder in your own order, on the device', () => {
  it('a dropped item goes between its neighbours, or past the end', () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(null, 0)).toBe(-1);
    expect(positionBetween(4, null)).toBe(5);
    expect(positionBetween(null, null)).toBe(0);
  });

  it('moving into a folder puts an item on top, and dragging reorders it', async () => {
    const q = await createFolder('Depth queue');
    const [a, b, c] = [await item('https://a.com/'), await item('https://b.com/'), await item('https://c.com/')];
    for (const x of [a, b, c]) await moveToFolder(await fresh(x), q);
    expect(await queue(q)).toEqual(['https://c.com/', 'https://b.com/', 'https://a.com/']); // positions -2, -1, 0

    await reorderInFolder(await fresh(a), null, await fresh(c)); // a to the top
    await reorderInFolder(await fresh(c), await fresh(b), null); // c to the bottom
    expect(await queue(q)).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/']);
    const patches = (await db.outbox.toArray()).flatMap((e) => (e.op.type === 'bookmark.update' && e.op.patch.folderPosition !== undefined ? [e.op.patch] : []));
    expect(patches).toEqual([{ folderPosition: -3 }, { folderPosition: 0 }]);

    await moveToFolder(await fresh(a), null);
    expect(await fresh(a)).toMatchObject({ folderId: null, folderPosition: null });
  });

  it('"My order" is saved on the folder and queued for the server', async () => {
    const q = await createFolder('Breadth queue');
    expect((await db.folders.get(q))!.customOrder).toBe(false);
    await setFolderCustomOrder(q, true);
    expect((await db.folders.get(q))!.customOrder).toBe(true);
    expect((await db.outbox.toArray()).at(-1)!.op).toEqual({ type: 'folder.update', id: q, patch: { customOrder: true } });
  });
});
