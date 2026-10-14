import 'fake-indexeddb/auto';
import type { Bookmark } from '@margin/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/data/db.ts';
import { pruneMedia } from '../src/data/media.ts';

const bookmark = (id: string, images: string[], leadImage: string | null = null): Bookmark => ({
  id, url: `https://${id}.com`, canonicalUrl: `https://${id}.com`, source: 'web', kind: 'article', status: 'ready', error: null,
  hasVideo: false, file: null, video: null, tagIds: [], suggestion: null, relevance: null, relevanceAt: null,
  title: id, byline: null, siteName: null, excerpt: null, leadImage, wordCount: 1, publishedAt: null,
  contentHtml: images.map((src) => `<img src="${src}">`).join(''),
  folderId: null, likedAt: null, archivedAt: null, progress: 0, progressUpdatedAt: null, savedAt: 0, updatedAt: 0,
});
const blob = () => new Blob(['x']);

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.media.clear()]);
});

describe('on-device image cleanup', () => {
  it('deletes images no remaining article uses and keeps shared ones', async () => {
    await db.bookmarks.bulkPut([bookmark('b', ['/api/media/shared.png'], '/api/media/b-thumb.jpg')]);
    await db.media.bulkPut([
      { path: '/api/media/only-a.png', blob: blob() }, // belonged to a deleted article
      { path: '/api/media/shared.png', blob: blob() },
      { path: '/api/media/b-thumb.jpg', blob: blob() },
    ]);
    await pruneMedia();
    expect((await db.media.toCollection().primaryKeys()).sort()).toEqual(['/api/media/b-thumb.jpg', '/api/media/shared.png']);
  });

  it('clears everything once the library is empty', async () => {
    await db.media.put({ path: '/api/media/x.png', blob: blob() });
    await pruneMedia();
    expect(await db.media.count()).toBe(0);
  });
});
