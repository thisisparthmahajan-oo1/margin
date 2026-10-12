import type { Bookmark, TextQuoteAnchor, UpdateBookmarkRequest } from '@margin/shared';
import { db, type OutboxOp } from './db.ts';
import { pruneMedia } from './media.ts';
import { syncNow } from './sync.ts';

/**
 * Every user mutation: apply to the local mirror immediately, queue it for the server, kick a sync.
 * Works the same online and offline.
 */
async function commit(apply: () => Promise<unknown>, op: OutboxOp) {
  await db.transaction('rw', [db.bookmarks, db.folders, db.highlights, db.outbox], async () => {
    await apply();
    await db.outbox.add({ op });
  });
  void syncNow();
}

/** Pulls a URL out of pasted or shared text ("Look at this https://…"). */
export function findUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (match) return match[0].replace(/[).,;!?]+$/, '');
  const bare = text.trim();
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(bare) ? `https://${bare}` : null;
}

export async function saveUrl(input: string): Promise<string | null> {
  const url = findUrl(input);
  if (!url) return null;
  const now = Date.now();
  const id = crypto.randomUUID();
  const placeholder: Bookmark = {
    id, url, canonicalUrl: url, source: /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(url) ? 'x' : 'web',
    status: 'pending', error: null, title: null, byline: null, siteName: null, excerpt: null, leadImage: null,
    contentHtml: null, wordCount: 0, publishedAt: null, folderId: null, likedAt: null, archivedAt: null,
    progress: 0, progressUpdatedAt: null, savedAt: now, updatedAt: now,
  };
  await commit(() => db.bookmarks.put(placeholder), { type: 'bookmark.create', id, url });
  return id;
}

export async function updateBookmark(id: string, patch: UpdateBookmarkRequest) {
  const now = Date.now();
  await commit(
    () =>
      db.bookmarks.update(id, (b) => {
        if (patch.liked !== undefined) b.likedAt = patch.liked ? (b.likedAt ?? now) : null;
        if (patch.archived !== undefined) b.archivedAt = patch.archived ? (b.archivedAt ?? now) : null;
        if (patch.folderId !== undefined) b.folderId = patch.folderId;
        if (patch.progress !== undefined) {
          b.progress = patch.progress;
          b.progressUpdatedAt = now;
        }
      }),
    { type: 'bookmark.update', id, patch },
  );
}

export const toggleLike = (b: Bookmark) => updateBookmark(b.id, { liked: b.likedAt === null });
export const toggleArchive = (b: Bookmark) => updateBookmark(b.id, { archived: b.archivedAt === null });
export const moveToFolder = (b: Bookmark, folderId: string | null) =>
  updateBookmark(b.id, { folderId, archived: false });

/** Progress changes constantly while scrolling; collapse the queue to the latest value per article. */
export async function saveProgress(id: string, progress: number) {
  await db.transaction('rw', db.outbox, async () => {
    const stale = await db.outbox
      .filter((e) => e.op.type === 'bookmark.update' && e.op.id === id && Object.keys(e.op.patch).join() === 'progress')
      .primaryKeys();
    await db.outbox.bulkDelete(stale);
  });
  await updateBookmark(id, { progress });
}

/** Hard delete on this device right away (article, highlights, unused images); the server and other devices follow via sync. */
export async function deleteBookmark(id: string) {
  await commit(async () => {
    await db.highlights.where('bookmarkId').equals(id).delete();
    await db.bookmarks.delete(id);
  }, { type: 'bookmark.delete', id });
  await pruneMedia();
}

export async function retryBookmark(id: string) {
  await commit(() => db.bookmarks.update(id, { status: 'pending', error: null }), { type: 'bookmark.retry', id });
}

export async function createFolder(name: string) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const position = ((await db.folders.orderBy('position').last())?.position ?? -1) + 1;
  await commit(() => db.folders.put({ id, name, position, createdAt: now, updatedAt: now }), {
    type: 'folder.create',
    id,
    name,
  });
  return id;
}

export const renameFolder = (id: string, name: string) =>
  commit(() => db.folders.update(id, { name }), { type: 'folder.update', id, name });

export async function deleteFolder(id: string) {
  await commit(async () => {
    await db.bookmarks.filter((b) => b.folderId === id).modify({ folderId: null });
    await db.folders.delete(id);
  }, { type: 'folder.delete', id });
}

export async function createHighlight(bookmarkId: string, anchor: TextQuoteAnchor, note: string | null = null) {
  const now = Date.now();
  const id = crypto.randomUUID();
  await commit(() => db.highlights.put({ id, bookmarkId, anchor, note, createdAt: now, updatedAt: now }), {
    type: 'highlight.create',
    id,
    bookmarkId,
    anchor,
    note,
  });
  return id;
}

export const updateHighlightNote = (id: string, note: string | null) =>
  commit(() => db.highlights.update(id, { note }), { type: 'highlight.update', id, note });

export const deleteHighlight = (id: string) =>
  commit(() => db.highlights.delete(id), { type: 'highlight.delete', id });
