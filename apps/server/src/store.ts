import { randomUUID } from 'node:crypto';
import {
  mediaPathsIn,
  type Bookmark,
  type BookmarkSource,
  type EntityName,
  type Folder,
  type Highlight,
  type SearchHit,
  type SyncResponse,
  type TextQuoteAnchor,
  type UpdateBookmarkRequest,
} from '@margin/shared';
import type { BookmarkDoc, Collections, FolderDoc, HighlightDoc } from './db.ts';
import type { MediaStore } from './media.ts';

/**
 * Serverless instances don't share a clock, so a write stamped slightly "in the past" could land
 * after a client already synced past it. Each sync cursor therefore lags real time by this window;
 * re-delivered rows are harmless because clients upsert by id.
 */
export const SYNC_OVERLAP_MS = 10_000;
const STALE_PENDING_MS = 2 * 60_000;
/**
 * Deletion records are kept this long so every device can learn about a delete; after that they
 * expire (TTL index). A device whose last sync is older gets a full snapshot instead (`reset`).
 */
export const DELETION_RETENTION_MS = 90 * 24 * 60 * 60_000;

const now = () => Date.now();

const toBookmark = ({ _id, plainText: _text, mediaPaths: _media, ...rest }: BookmarkDoc): Bookmark => ({ id: _id, ...rest });
/** Keeps server-only fields out of query results sent to clients. */
const CLIENT_PROJECTION = { plainText: 0, mediaPaths: 0 } as const;
const toFolder = ({ _id, ...rest }: FolderDoc): Folder => ({ id: _id, ...rest });
const toHighlight = ({ _id, ...rest }: HighlightDoc): Highlight => ({ id: _id, ...rest });

export interface ExtractedContent {
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImage: string | null;
  contentHtml: string;
  plainText: string;
  wordCount: number;
  publishedAt: number | null;
}

export function createStore(c: Collections, media: Pick<MediaStore, 'remove'>) {
  const recordDeletion = (entity: EntityName, id: string) => {
    const t = now();
    return c.deletions.replaceOne(
      { _id: `${entity}:${id}` },
      { entity, id, deletedAt: t, expiresAt: new Date(t + DELETION_RETENTION_MS) },
      { upsert: true },
    );
  };

  /** Deletes each image no remaining bookmark uses (images are shared between articles by content hash). */
  const releaseMedia = async (paths: string[]) => {
    for (const path of paths) {
      const stillUsed = await c.bookmarks.findOne({ mediaPaths: path }, { projection: { _id: 1 } });
      if (!stillUsed) await media.remove(path);
    }
  };

  const getBookmark = async (id: string) => {
    const doc = await c.bookmarks.findOne({ _id: id });
    return doc ? toBookmark(doc) : null;
  };
  const getFolder = async (id: string) => {
    const doc = await c.folders.findOne({ _id: id });
    return doc ? toFolder(doc) : null;
  };
  const getHighlight = async (id: string) => {
    const doc = await c.highlights.findOne({ _id: id });
    return doc ? toHighlight(doc) : null;
  };

  return {
    getBookmark,
    getFolder,
    getHighlight,

    /**
     * Instapaper semantics: saving a URL you already have moves it back to the top of Home
     * instead of creating a duplicate. Returns `created: false` in that case.
     */
    async saveBookmark(input: { id?: string; url: string; canonicalUrl: string; source: BookmarkSource }) {
      const t = now();
      const existing = await c.bookmarks.findOneAndUpdate(
        { canonicalUrl: input.canonicalUrl },
        { $set: { savedAt: t, archivedAt: null, folderId: null, updatedAt: t } },
        { returnDocument: 'after' },
      );
      if (existing) return { bookmark: toBookmark(existing), created: false };

      const doc: BookmarkDoc = {
        _id: input.id ?? randomUUID(),
        url: input.url,
        canonicalUrl: input.canonicalUrl,
        source: input.source,
        status: 'pending',
        error: null,
        title: null,
        byline: null,
        siteName: null,
        excerpt: null,
        leadImage: null,
        contentHtml: null,
        plainText: null,
        mediaPaths: [],
        wordCount: 0,
        publishedAt: null,
        folderId: null,
        likedAt: null,
        archivedAt: null,
        progress: 0,
        progressUpdatedAt: null,
        savedAt: t,
        updatedAt: t,
      };
      await c.bookmarks.insertOne(doc);
      return { bookmark: toBookmark(doc), created: true };
    },

    async markPending(id: string) {
      await c.bookmarks.updateOne({ _id: id }, { $set: { status: 'pending', error: null, updatedAt: now() } });
    },

    async markFailed(id: string, error: string) {
      await c.bookmarks.updateOne({ _id: id }, { $set: { status: 'failed', error, updatedAt: now() } });
    },

    /** Stores extracted content. On a re-download, images the old version used and the new one doesn't are released. */
    async markReady(id: string, content: ExtractedContent) {
      const mediaPaths = mediaPathsIn(content.contentHtml, content.leadImage);
      const previous = await c.bookmarks.findOneAndUpdate(
        { _id: id },
        { $set: { ...content, mediaPaths, status: 'ready', error: null, updatedAt: now() } },
        { projection: { mediaPaths: 1 } },
      );
      await releaseMedia((previous?.mediaPaths ?? []).filter((p) => !mediaPaths.includes(p)));
    },

    /** Bookmarks whose background fetch was lost (e.g. a serverless instance was frozen). */
    async stalePendingIds(): Promise<string[]> {
      const docs = await c.bookmarks
        .find({ status: 'pending', updatedAt: { $lt: now() - STALE_PENDING_MS } }, { projection: { _id: 1 } })
        .toArray();
      return docs.map((d) => d._id);
    },

    async updateBookmark(id: string, patch: UpdateBookmarkRequest): Promise<Bookmark | null> {
      const current = await c.bookmarks.findOne({ _id: id });
      if (!current) return null;
      const t = now();
      const set: Partial<BookmarkDoc> = { updatedAt: t };
      if (patch.liked !== undefined) set.likedAt = patch.liked ? (current.likedAt ?? t) : null;
      if (patch.archived !== undefined) set.archivedAt = patch.archived ? (current.archivedAt ?? t) : null;
      if (patch.folderId !== undefined) set.folderId = patch.folderId;
      if (patch.progress !== undefined) {
        set.progress = Math.min(1, Math.max(0, patch.progress));
        set.progressUpdatedAt = t;
      }
      const doc = await c.bookmarks.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
      return doc ? toBookmark(doc) : null;
    },

    /** Hard delete: the article, its highlights, and any images no other article uses. */
    async deleteBookmark(id: string): Promise<boolean> {
      const deleted = await c.bookmarks.findOneAndDelete({ _id: id }, { projection: { mediaPaths: 1 } });
      if (!deleted) return false;
      const highlights = await c.highlights.find({ bookmarkId: id }, { projection: { _id: 1 } }).toArray();
      await c.highlights.deleteMany({ bookmarkId: id });
      await Promise.all([...highlights.map((h) => recordDeletion('highlight', h._id)), recordDeletion('bookmark', id)]);
      await releaseMedia(deleted.mediaPaths ?? []);
      return true;
    },

    async createFolder(input: { id?: string; name: string }): Promise<Folder> {
      const t = now();
      const last = await c.folders.find().sort({ position: -1 }).limit(1).next();
      const doc: FolderDoc = {
        _id: input.id ?? randomUUID(),
        name: input.name,
        position: (last?.position ?? -1) + 1,
        createdAt: t,
        updatedAt: t,
      };
      await c.folders.insertOne(doc);
      return toFolder(doc);
    },

    async updateFolder(id: string, patch: { name?: string; position?: number }): Promise<Folder | null> {
      const set: Partial<FolderDoc> = { updatedAt: now() };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.position !== undefined) set.position = patch.position;
      const doc = await c.folders.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
      return doc ? toFolder(doc) : null;
    },

    /** Articles in a deleted folder go back to Home (as in Instapaper), so they're bumped for sync. */
    async deleteFolder(id: string): Promise<boolean> {
      const { deletedCount } = await c.folders.deleteOne({ _id: id });
      if (!deletedCount) return false;
      await c.bookmarks.updateMany({ folderId: id }, { $set: { folderId: null, updatedAt: now() } });
      await recordDeletion('folder', id);
      return true;
    },

    async createHighlight(input: { id?: string; bookmarkId: string; anchor: TextQuoteAnchor; note?: string | null }) {
      const t = now();
      const doc: HighlightDoc = {
        _id: input.id ?? randomUUID(),
        bookmarkId: input.bookmarkId,
        anchor: input.anchor,
        note: input.note ?? null,
        createdAt: t,
        updatedAt: t,
      };
      await c.highlights.insertOne(doc);
      return toHighlight(doc);
    },

    async updateHighlight(id: string, note: string | null): Promise<Highlight | null> {
      const doc = await c.highlights.findOneAndUpdate(
        { _id: id },
        { $set: { note, updatedAt: now() } },
        { returnDocument: 'after' },
      );
      return doc ? toHighlight(doc) : null;
    },

    async deleteHighlight(id: string): Promise<boolean> {
      const { deletedCount } = await c.highlights.deleteOne({ _id: id });
      if (deletedCount) await recordDeletion('highlight', id);
      return deletedCount > 0;
    },

    /**
     * Everything changed after `since`. The returned cursor lags by SYNC_OVERLAP_MS (see above).
     * A cursor older than DELETION_RETENTION_MS gets a full snapshot with `reset: true`.
     */
    async changesSince(requestedSince: number): Promise<SyncResponse> {
      const t = now();
      const reset = requestedSince > 0 && requestedSince < t - DELETION_RETENTION_MS;
      const since = reset ? 0 : requestedSince;
      const changed = { updatedAt: { $gt: since } };
      const [bookmarks, folders, highlights, deletions] = await Promise.all([
        c.bookmarks.find(changed, { projection: CLIENT_PROJECTION }).toArray(),
        c.folders.find(changed).toArray(),
        c.highlights.find(changed).toArray(),
        reset ? [] : c.deletions.find({ deletedAt: { $gt: since } }).toArray(),
      ]);
      return {
        cursor: Math.max(t - SYNC_OVERLAP_MS, since),
        reset,
        bookmarks: bookmarks.map((d) => toBookmark(d as BookmarkDoc)),
        folders: folders.map(toFolder),
        highlights: highlights.map(toHighlight),
        deletions: deletions.map(({ entity, id, deletedAt }) => ({ entity, id, deletedAt })),
      };
    },

    async search(query: string, limit = 50): Promise<SearchHit[]> {
      const terms = searchTerms(query);
      if (!terms.length) return [];
      const docs = await c.bookmarks
        .find(
          // Quoting each term makes MongoDB require all of them (unquoted terms are OR-ed).
          { $text: { $search: terms.map((t) => `"${t}"`).join(' ') } },
          { projection: { _id: 1, plainText: 1, score: { $meta: 'textScore' } } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .toArray();
      return docs.map((d) => ({ bookmarkId: d._id, snippet: snippet(d.plainText ?? '', terms) }));
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export function searchTerms(input: string): string[] {
  return input.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** ~200 chars of text around the first matching term, with term matches wrapped in `[[ ]]`. */
export function snippet(text: string, terms: string[], radius = 100): string {
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
  const first = text.search(pattern);
  const at = first === -1 ? 0 : first;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  const body = text.slice(start, end).replace(pattern, '[[$1]]');
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}
