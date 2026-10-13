import { applyTagChange, filterByTag, isInList } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

const ctx = useTestDb();
const store = () => createStore(ctx.c, createMediaStore(ctx.db), null);
const save = async (url: string) => (await store().saveBookmark({ url, canonicalUrl: url, source: 'web' })).bookmark;
const api = () =>
  createApp({
    appToken: null,
    deps: async () => ({ store: store(), media: createMediaStore(ctx.db), files: null, ingestor: { enqueue: () => {} } }),
  });
const send = async (method: string, path: string, body?: unknown): Promise<Response> =>
  api().request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('tags', () => {
  it('new items have no tags; names are unique ignoring case', async () => {
    expect((await save('https://a.com')).tagIds).toEqual([]);
    const later = await store().createTag({ name: 'Don’t understand yet' });
    expect((await store().createTag({ name: 'don’t understand YET' })).id).toBe(later.id);
    const other = await store().createTag({ name: 'Re-read' });
    expect(await store().renameTag(other.id, 'DON’T UNDERSTAND YET')).toBe('taken');
    expect(await store().renameTag(other.id, 'Re-read later')).toMatchObject({ name: 'Re-read later' });
  });

  it('adding and removing merges changes from different devices', async () => {
    const b = await save('https://a.com');
    const [x, y, z] = await Promise.all(['x', 'y', 'z'].map((name) => store().createTag({ name })));
    await store().updateBookmark(b.id, { addTagIds: [x!.id, z!.id] }); // phone
    await store().updateBookmark(b.id, { addTagIds: [y!.id] }); // laptop, unaware of the phone's change
    await store().updateBookmark(b.id, { removeTagIds: [z!.id] });
    expect((await store().getBookmark(b.id))!.tagIds.sort()).toEqual([x!.id, y!.id].sort());
  });

  it('deleting a tag removes it from items, and devices learn both through sync', async () => {
    const b = await save('https://a.com');
    const tag = await store().createTag({ name: 'later' });
    await store().updateBookmark(b.id, { addTagIds: [tag.id] });
    const before = Date.now() - 1;
    expect(await store().deleteTag(tag.id)).toBe(true);
    const sync = await store().changesSince(before - 20_000);
    expect(sync.deletions).toContainEqual(expect.objectContaining({ entity: 'tag', id: tag.id }));
    expect(sync.bookmarks.find((x) => x.id === b.id)!.tagIds).toEqual([]);
  });

  it('API: create, tag an item, reject unknown tags, rename clash is 409', async () => {
    const b = await save('https://a.com');
    const created = await send('POST', '/api/tags', { name: '  Hard   one ' });
    expect(created.status).toBe(201);
    const tag = await created.json();
    expect(tag.name).toBe('Hard one');
    expect((await send('PATCH', `/api/bookmarks/${b.id}`, { addTagIds: [tag.id] })).status).toBe(200);
    expect((await send('PATCH', `/api/bookmarks/${b.id}`, { addTagIds: ['nope'] })).status).toBe(400);
    await send('POST', '/api/tags', { name: 'Other' });
    expect((await send('PATCH', `/api/tags/${tag.id}`, { name: 'other' })).status).toBe(409);
    expect((await send('GET', '/api/sync?since=0').then((r) => r.json())).tags).toHaveLength(2);
  });
});

describe('tag lists and filters', () => {
  const item = (tagIds: string[], archivedAt: number | null = null, folderId: string | null = null) => ({
    tagIds, archivedAt, folderId, likedAt: null, kind: 'article' as const, hasVideo: false,
  });

  it('a tag list has unarchived items with the tag, in any folder', () => {
    expect(isInList(item(['t'], null, 'f'), { kind: 'tag', tagId: 't' })).toBe(true);
    expect(isInList(item(['t'], 1), { kind: 'tag', tagId: 't' })).toBe(false);
    expect(isInList(item([]), { kind: 'tag', tagId: 't' })).toBe(false);
  });

  it('filters any list by a tag, and applies changes like the server', () => {
    const items = [item(['t']), item([]), item(['t', 'u'])];
    expect(filterByTag(items, 't')).toHaveLength(2);
    expect(filterByTag(items, null)).toHaveLength(3);
    expect(applyTagChange(['a', 'b'], { addTagIds: ['b', 'c'], removeTagIds: ['a'] })).toEqual(['b', 'c']);
  });
});
