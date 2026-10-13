// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No server in these tests: changes just queue in the outbox.
vi.mock('../src/data/sync.ts', () => ({ syncNow: async () => {} }));
vi.mock('../src/data/api.ts', () => ({ api: async () => Promise.reject(new Error('offline')), ApiRequestError: Error }));

const { db } = await import('../src/data/db.ts');
const { createTag, deleteTag, saveUrl, setTag } = await import('../src/data/actions.ts');

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.tags.clear(), db.outbox.clear()]);
});

describe('tags on the device', () => {
  it('reuses a tag with the same name, ignoring case', async () => {
    const id = await createTag('Don’t understand yet');
    expect(await createTag('  don’t   understand YET ')).toBe(id);
    expect(await db.tags.count()).toBe(1);
  });

  it('tags and untags at once, and queues add/remove changes (not the whole set)', async () => {
    const b = (await db.bookmarks.get((await saveUrl('https://a.com'))!))!;
    const x = await createTag('x');
    const y = await createTag('y');
    await setTag(b, x, true);
    await setTag(b, y, true);
    await setTag(b, x, false);
    expect((await db.bookmarks.get(b.id))!.tagIds).toEqual([y]);
    expect(await db.bookmarks.where('tagIds').equals(y).count()).toBe(1);
    const patches = (await db.outbox.toArray()).flatMap((e) => (e.op.type === 'bookmark.update' ? [e.op.patch] : []));
    expect(patches).toEqual([{ addTagIds: [x] }, { addTagIds: [y] }, { removeTagIds: [x] }]);
  });

  it('deleting a tag removes it from items', async () => {
    const b = (await db.bookmarks.get((await saveUrl('https://a.com'))!))!;
    const x = await createTag('x');
    await setTag(b, x, true);
    await deleteTag(x);
    expect((await db.bookmarks.get(b.id))!.tagIds).toEqual([]);
    expect(await db.tags.count()).toBe(0);
  });
});
