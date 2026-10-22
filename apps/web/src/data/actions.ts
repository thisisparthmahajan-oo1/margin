import {
  applyTagChange,
  DEFAULT_REQUEST_AGENT,
  fileKeyFor,
  PDF_CONTENT_TYPE,
  uploadUrlFor,
  type Bookmark,
  type BookmarkSource,
  type Relevance,
  type RequestStatus,
  type TextQuoteAnchor,
  type UpdateBookmarkRequest,
} from '@margin/shared';
import { db, type OutboxOp } from './db.ts';
import { isPdf, pruneFiles, sha256Hex } from './files.ts';
import { pruneMedia } from './media.ts';
import { syncNow } from './sync.ts';

/**
 * Every user mutation: apply to the local mirror immediately, queue it for the server, kick a sync.
 * Works the same online and offline.
 */
async function commit(apply: () => Promise<unknown>, ...ops: OutboxOp[]) {
  await db.transaction('rw', [db.bookmarks, db.folders, db.highlights, db.tags, db.requests, db.outbox], async () => {
    await apply();
    for (const op of ops) await db.outbox.add({ op });
  });
  void syncNow();
}

/** A new item as it looks on this device until the server has processed it. */
const placeholder = (fields: Pick<Bookmark, 'id' | 'url' | 'source'> & Partial<Bookmark>): Bookmark => {
  const now = Date.now();
  return {
    canonicalUrl: fields.url, kind: 'article', status: 'pending', error: null, title: null, byline: null,
    siteName: null, excerpt: null, leadImage: null, contentHtml: null, wordCount: 0, publishedAt: null,
    hasVideo: false, file: null, video: null, audio: null, tagIds: [], suggestion: null, relevance: null, relevanceAt: null, folderId: null, likedAt: null, archivedAt: null, progress: 0,
    progressUpdatedAt: null, savedAt: now, updatedAt: now,
    ...fields,
  };
};

/** Same rules as the server's extractor registry, just enough to label the item while it downloads. */
const sourceOf = (url: string): BookmarkSource =>
  /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i.test(url)
    ? 'x'
    : /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url)
      ? 'youtube'
      : /^https?:\/\/(podcasts\.apple\.com\/.*[?&]i=\d|open\.spotify\.com\/(intl-[\w-]+\/)?episode\/)/i.test(url)
        ? 'podcast'
        : 'web';

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
  const id = crypto.randomUUID();
  await commit(() => db.bookmarks.put(placeholder({ id, url, source: sourceOf(url) })), { type: 'bookmark.create', id, url });
  return id;
}

/**
 * Adds a PDF from this device. It's readable here at once (the original is kept on the device);
 * the upload, and text extraction on the server, follow through the outbox like any other change.
 * Returns null if the file isn't a PDF.
 */
export async function savePdf(file: Blob, name: string): Promise<string | null> {
  if (!(await isPdf(file))) return null;
  const sha256 = await sha256Hex(file);
  const key = fileKeyFor(sha256);
  await db.files.put({ key, blob: file });
  const fileName = /\.pdf$/i.test(name) ? name : `${name || 'Document'}.pdf`;
  const id = crypto.randomUUID();
  const item = placeholder({
    id,
    url: uploadUrlFor(sha256),
    source: 'upload',
    kind: 'pdf',
    title: fileName.replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim() || 'Untitled PDF',
    file: { key, name: fileName, bytes: file.size, contentType: PDF_CONTENT_TYPE, pages: null },
  });
  await commit(() => db.bookmarks.put(item), { type: 'bookmark.upload', id, key, name: fileName, bytes: file.size });
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
        if (patch.relevance !== undefined) {
          b.relevance = patch.relevance;
          b.relevanceAt = now;
        }
        if (patch.progress !== undefined) {
          b.progress = patch.progress;
          b.progressUpdatedAt = now;
        }
        if (patch.addTagIds || patch.removeTagIds) b.tagIds = applyTagChange(b.tagIds, patch);
      }),
    { type: 'bookmark.update', id, patch },
  );
}

export const toggleLike = (b: Bookmark) => updateBookmark(b.id, { liked: b.likedAt === null });
/** Choosing the current verdict again clears it. */
export const setRelevance = (b: Bookmark, relevance: Relevance) =>
  updateBookmark(b.id, { relevance: b.relevance === relevance ? null : relevance });
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

/**
 * Hard delete on this device right away (article, highlights, unused images); the server and other devices follow via sync.
 * Requests asked from it are kept: they show the source as removed.
 */
export async function deleteBookmark(id: string) {
  await commit(async () => {
    await db.highlights.where('bookmarkId').equals(id).delete();
    await db.bookmarks.delete(id);
  }, { type: 'bookmark.delete', id });
  await Promise.all([pruneMedia(), pruneFiles()]);
}

/** Tries again. A file whose upload was refused (e.g. storage full) is uploaded again first. */
export async function retryBookmark(b: Bookmark) {
  const ops: OutboxOp[] =
    b.source === 'upload' && b.file
      ? [{ type: 'bookmark.upload', id: b.id, key: b.file.key, name: b.file.name, bytes: b.file.bytes }, { type: 'bookmark.retry', id: b.id }]
      : [{ type: 'bookmark.retry', id: b.id }];
  await commit(() => db.bookmarks.update(b.id, { status: 'pending', error: null }), ...ops);
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

// ---- tags ----

/** Creates a tag, or returns the existing one with that name (ignoring case), as the server does. */
export async function createTag(name: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, ' ');
  const existing = (await db.tags.toArray()).find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const now = Date.now();
  const id = crypto.randomUUID();
  await commit(() => db.tags.put({ id, name: clean, createdAt: now, updatedAt: now }), { type: 'tag.create', id, name: clean });
  return id;
}

export const renameTag = (id: string, name: string) =>
  commit(() => db.tags.update(id, { name: name.trim() }), { type: 'tag.update', id, name: name.trim() });

/** Removes the tag from every item and deletes it. */
export async function deleteTag(id: string) {
  await commit(async () => {
    await db.bookmarks.where('tagIds').equals(id).modify((b) => {
      b.tagIds = b.tagIds.filter((t) => t !== id);
    });
    await db.tags.delete(id);
  }, { type: 'tag.delete', id });
}

export const setTag = (b: Bookmark, tagId: string, on: boolean) =>
  updateBookmark(b.id, on ? { addTagIds: [tagId] } : { removeTagIds: [tagId] });

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

/** Asks the curator for something, from a passage of an article or on its own. */
export async function createRequest(text: string, from: { bookmarkId: string; anchor: TextQuoteAnchor | null } | null = null) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const bookmarkId = from?.bookmarkId ?? null;
  const anchor = from?.anchor ?? null;
  const agent = DEFAULT_REQUEST_AGENT;
  await commit(
    () =>
      db.requests.put({
        id, text, for: agent, bookmarkId, anchor, status: 'open', completedAt: null, reply: null, answers: [],
        createdAt: now, updatedAt: now,
      }),
    { type: 'request.create', id, text, bookmarkId, anchor, for: agent },
  );
  return id;
}

export const updateRequestText = (id: string, text: string) =>
  commit(() => db.requests.update(id, { text, updatedAt: Date.now() }), { type: 'request.update', id, change: { text } });

export const setRequestStatus = (id: string, status: RequestStatus) =>
  commit(
    () => db.requests.update(id, { status, completedAt: status === 'completed' ? Date.now() : null, updatedAt: Date.now() }),
    { type: 'request.update', id, change: { status } },
  );

export const deleteRequest = (id: string) => commit(() => db.requests.delete(id), { type: 'request.delete', id });
