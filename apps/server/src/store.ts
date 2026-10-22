import { randomUUID } from 'node:crypto';
import {
  mediaPathsIn,
  type AudioRef,
  type Bookmark,
  type BookmarkKind,
  type CuratorRequest,
  type BookmarkSource,
  type EntityName,
  type Folder,
  type Highlight,
  type RequestStatus,
  type SearchHit,
  type Tag,
  type StoredFile,
  type Suggestion,
  type SyncResponse,
  type TextQuoteAnchor,
  type UpdateBookmarkRequest,
  type VideoRef,
} from '@margin/shared';
import {
  TAG_NAME_COLLATION,
  type BookmarkDoc,
  type Collections,
  type FolderDoc,
  type HighlightDoc,
  type RequestDoc,
  type TagDoc,
  type UploadDoc,
} from './db.ts';
import type { FileStore } from './files.ts';
import type { MediaStore } from './media.ts';

/**
 * Serverless instances don't share a clock, so a write stamped slightly "in the past" could land
 * after a client already synced past it. Each sync cursor therefore lags real time by this window;
 * re-delivered rows are harmless because clients upsert by id.
 */
export const SYNC_OVERLAP_MS = 10_000;
/** About how much item data one sync response carries (Vercel refuses responses over 4.5 MB). */
export const SYNC_PAGE_BYTES = 3_000_000;
const STALE_PENDING_MS = 2 * 60_000;
/** An upload reservation older than this was abandoned (signed upload URLs last 10 minutes). */
const ABANDONED_UPLOAD_MS = 60 * 60_000;
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
const toTag = ({ _id, ...rest }: TagDoc): Tag => ({ id: _id, ...rest });
const toRequest = ({ _id, ...rest }: RequestDoc): CuratorRequest => ({ id: _id, ...rest });

/** Everything processing produces for an item; written in one go when it becomes ready. */
export interface ExtractedContent {
  kind: BookmarkKind;
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImage: string | null;
  /** null: no readable text (a scanned PDF). */
  contentHtml: string | null;
  plainText: string | null;
  wordCount: number;
  publishedAt: number | null;
  hasVideo: boolean;
  file: StoredFile | null;
  video: VideoRef | null;
  audio: AudioRef | null;
}

export interface NewBookmark {
  id?: string;
  url: string;
  canonicalUrl: string;
  source: BookmarkSource;
  /** Known up front for uploaded files; links are articles until processing says otherwise. */
  kind?: BookmarkKind;
  title?: string | null;
  file?: StoredFile | null;
  folderId?: string | null;
  tagIds?: string[];
  suggestion?: Suggestion | null;
  /** Never re-save an existing item: hand it back untouched (`created: false`). */
  ifNew?: boolean;
}

export function createStore(c: Collections, media: Pick<MediaStore, 'remove'>, files: Pick<FileStore, 'remove'> | null) {
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

  /** Deletes a stored file once no item uses it and no upload has it reserved (same bytes = same key). */
  const releaseFile = async (key: string | undefined) => {
    if (!key || !files) return;
    const [usedBy, reserved] = await Promise.all([
      c.bookmarks.findOne({ 'file.key': key }, { projection: { _id: 1 } }),
      c.uploads.findOne({ _id: key }),
    ]);
    if (!usedBy && !reserved) await files.remove(key);
  };

  /** Instapaper semantics: saving something you already have moves it back to the top of Home. Null if it's new. */
  const resave = async (canonicalUrl: string): Promise<Bookmark | null> => {
    const t = now();
    const existing = await c.bookmarks.findOneAndUpdate(
      { canonicalUrl },
      { $set: { savedAt: t, archivedAt: null, folderId: null, updatedAt: t } },
      { returnDocument: 'after', projection: CLIENT_PROJECTION },
    );
    return existing ? toBookmark(existing as BookmarkDoc) : null;
  };

  const findByCanonicalUrl = async (canonicalUrl: string) => {
    const doc = await c.bookmarks.findOne({ canonicalUrl }, { projection: CLIENT_PROJECTION });
    return doc ? toBookmark(doc as BookmarkDoc) : null;
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
  const getRequest = async (id: string) => {
    const doc = await c.requests.findOne({ _id: id });
    return doc ? toRequest(doc) : null;
  };

  return {
    getBookmark,
    getFolder,
    getHighlight,
    getRequest,
    releaseFile,

    resave,

    /** Saves a new item, or re-saves an existing one with the same address (`created: false`). */
    async saveBookmark(input: NewBookmark) {
      const existing = input.ifNew ? await findByCanonicalUrl(input.canonicalUrl) : await resave(input.canonicalUrl);
      if (existing) return { bookmark: existing, created: false };
      const t = now();

      const doc: BookmarkDoc = {
        _id: input.id ?? randomUUID(),
        url: input.url,
        canonicalUrl: input.canonicalUrl,
        source: input.source,
        kind: input.kind ?? 'article',
        status: 'pending',
        error: null,
        title: input.title ?? null,
        byline: null,
        siteName: null,
        excerpt: null,
        leadImage: null,
        contentHtml: null,
        plainText: null,
        mediaPaths: [],
        wordCount: 0,
        publishedAt: null,
        hasVideo: false,
        file: input.file ?? null,
        video: null,
        audio: null,
        tagIds: input.tagIds ?? [],
        suggestion: input.suggestion ?? null,
        relevance: null,
        relevanceAt: null,
        folderId: input.folderId ?? null,
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

    /** Stores processed content. On a re-download, images and files the old version used and the new one doesn't are released. */
    async markReady(id: string, content: ExtractedContent) {
      const mediaPaths = mediaPathsIn(content.contentHtml, content.leadImage);
      const previous = await c.bookmarks.findOneAndUpdate(
        { _id: id },
        { $set: { ...content, mediaPaths, status: 'ready', error: null, updatedAt: now() } },
        { projection: { mediaPaths: 1, file: 1 } },
      );
      await releaseMedia((previous?.mediaPaths ?? []).filter((p) => !mediaPaths.includes(p)));
      if (previous?.file && previous.file.key !== content.file?.key) await releaseFile(previous.file.key);
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
      if (patch.relevance !== undefined) {
        set.relevance = patch.relevance;
        set.relevanceAt = t;
      }
      if (patch.progress !== undefined) {
        set.progress = Math.min(1, Math.max(0, patch.progress));
        set.progressUpdatedAt = t;
      }
      if (patch.addTagIds?.length || patch.removeTagIds?.length) {
        // One atomic update (union, then difference), so concurrent changes from other devices merge.
        await c.bookmarks.updateOne({ _id: id }, [
          {
            $set: {
              tagIds: {
                $setDifference: [
                  { $setUnion: [{ $ifNull: ['$tagIds', []] }, { $literal: patch.addTagIds ?? [] }] },
                  { $literal: patch.removeTagIds ?? [] },
                ],
              },
            },
          },
        ]);
      }
      const doc = await c.bookmarks.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
      return doc ? toBookmark(doc) : null;
    },

    /** Hard delete: the item, its highlights, its file, and any images no other item uses. */
    async deleteBookmark(id: string): Promise<boolean> {
      const deleted = await c.bookmarks.findOneAndDelete({ _id: id }, { projection: { mediaPaths: 1, file: 1 } });
      if (!deleted) return false;
      const highlights = await c.highlights.find({ bookmarkId: id }, { projection: { _id: 1 } }).toArray();
      await c.highlights.deleteMany({ bookmarkId: id });
      await Promise.all([...highlights.map((h) => recordDeletion('highlight', h._id)), recordDeletion('bookmark', id)]);
      await releaseMedia(deleted.mediaPaths ?? []);
      await releaseFile(deleted.file?.key);
      return true;
    },

    // ---- file storage accounting ----

    /** Bytes in file storage: every distinct stored file plus space reserved by uploads in progress. */
    async fileBytesInUse(): Promise<number> {
      const [stored] = await c.bookmarks
        .aggregate<{ bytes: number }>([
          { $match: { 'file.key': { $type: 'string' } } },
          { $group: { _id: '$file.key', bytes: { $first: '$file.bytes' } } },
          { $group: { _id: null, bytes: { $sum: '$bytes' } } },
        ])
        .toArray();
      const storedKeys = await c.bookmarks.distinct('file.key');
      const [reserved] = await c.uploads
        .aggregate<{ bytes: number }>([
          { $match: { _id: { $nin: storedKeys } } },
          { $group: { _id: null, bytes: { $sum: '$bytes' } } },
        ])
        .toArray();
      return (stored?.bytes ?? 0) + (reserved?.bytes ?? 0);
    },

    /** Whether any item uses this stored file (devices may only download files that belong to an item). */
    async isFileInUse(key: string): Promise<boolean> {
      return (await c.bookmarks.findOne({ 'file.key': key }, { projection: { _id: 1 } })) !== null;
    },

    /** Reserves space for an upload; replaces an earlier reservation of the same file. */
    async reserveUpload(key: string, bookmarkId: string, bytes: number) {
      await c.uploads.replaceOne({ _id: key }, { bookmarkId, bytes, createdAt: now() }, { upsert: true });
    },

    getUpload: (key: string): Promise<UploadDoc | null> => c.uploads.findOne({ _id: key }),

    async endUpload(key: string) {
      await c.uploads.deleteOne({ _id: key });
    },

    /** Drops reservations of uploads that never finished, and their files if nothing uses them. */
    async cleanUpAbandonedUploads() {
      const stale = await c.uploads.find({ createdAt: { $lt: now() - ABANDONED_UPLOAD_MS } }).toArray();
      for (const upload of stale) {
        await c.uploads.deleteOne({ _id: upload._id });
        await releaseFile(upload._id);
      }
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

    getTag: async (id: string) => {
      const doc = await c.tags.findOne({ _id: id });
      return doc ? toTag(doc) : null;
    },

    /** Whether every id is an existing tag. */
    async tagsExist(ids: string[]): Promise<boolean> {
      const unique = [...new Set(ids)];
      return (await c.tags.countDocuments({ _id: { $in: unique } })) === unique.length;
    },

    /** Creates a tag, or returns the existing one with that name (names are unique, ignoring case). */
    async createTag(input: { id?: string; name: string }): Promise<Tag> {
      const existing = await c.tags.findOne({ name: input.name }, { collation: TAG_NAME_COLLATION });
      if (existing) return toTag(existing);
      const t = now();
      const doc: TagDoc = { _id: input.id ?? randomUUID(), name: input.name, createdAt: t, updatedAt: t };
      try {
        await c.tags.insertOne(doc);
      } catch (e) {
        // Created at the same moment from another device: use that one.
        const winner = await c.tags.findOne({ name: input.name }, { collation: TAG_NAME_COLLATION });
        if ((e as { code?: number }).code === 11000 && winner) return toTag(winner);
        throw e;
      }
      return toTag(doc);
    },

    /** Renames a tag. Null if it doesn't exist; 'taken' if another tag already has the name. */
    async renameTag(id: string, name: string): Promise<Tag | null | 'taken'> {
      const clash = await c.tags.findOne({ name, _id: { $ne: id } }, { collation: TAG_NAME_COLLATION });
      if (clash) return 'taken';
      const doc = await c.tags.findOneAndUpdate({ _id: id }, { $set: { name, updatedAt: now() } }, { returnDocument: 'after' });
      return doc ? toTag(doc) : null;
    },

    /** Removes the tag from every item (bumped so devices sync the change) and deletes it. */
    async deleteTag(id: string): Promise<boolean> {
      const { deletedCount } = await c.tags.deleteOne({ _id: id });
      if (!deletedCount) return false;
      await c.bookmarks.updateMany({ tagIds: id }, { $pull: { tagIds: id }, $set: { updatedAt: now() } });
      await recordDeletion('tag', id);
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

    /** Creates a request; with an id that already exists, returns that request (`created: false`). */
    async createRequest(input: Pick<CuratorRequest, 'text' | 'for' | 'bookmarkId' | 'anchor'> & { id?: string }) {
      const t = now();
      const doc: RequestDoc = {
        _id: input.id ?? randomUUID(),
        text: input.text,
        for: input.for,
        bookmarkId: input.bookmarkId,
        anchor: input.anchor,
        status: 'open',
        completedAt: null,
        reply: null,
        answers: [],
        createdAt: t,
        updatedAt: t,
      };
      try {
        await c.requests.insertOne(doc);
      } catch (e) {
        // Sent twice (an outbox retry): the first one stands.
        const existing = (e as { code?: number }).code === 11000 ? await getRequest(doc._id) : null;
        if (existing) return { request: existing, created: false };
        throw e;
      }
      return { request: toRequest(doc), created: true };
    },

    /** Your changes (text, status) or the agent's (reply). Null if the request doesn't exist. */
    async updateRequest(
      id: string,
      change: { text: string } | { status: RequestStatus } | { reply: string },
    ): Promise<CuratorRequest | null> {
      const t = now();
      const set: Partial<RequestDoc> =
        'text' in change
          ? { text: change.text }
          : 'status' in change
            ? { status: change.status, completedAt: change.status === 'completed' ? t : null }
            : { reply: { text: change.reply, updatedAt: t } };
      const doc = await c.requests.findOneAndUpdate({ _id: id }, { $set: { ...set, updatedAt: t } }, { returnDocument: 'after' });
      return doc ? toRequest(doc) : null;
    },

    async deleteRequest(id: string): Promise<boolean> {
      const { deletedCount } = await c.requests.deleteOne({ _id: id });
      if (deletedCount) await recordDeletion('request', id);
      return deletedCount > 0;
    },

    /**
     * Links an item to an open request as an answer. Linking the same item again changes nothing.
     * 'completed' when the request no longer takes answers; null when it doesn't exist.
     */
    async addAnswer(id: string, bookmarkId: string): Promise<CuratorRequest | 'completed' | null> {
      const t = now();
      const doc = await c.requests.findOneAndUpdate(
        { _id: id, status: 'open', 'answers.bookmarkId': { $ne: bookmarkId } },
        { $push: { answers: { bookmarkId, addedAt: t } }, $set: { updatedAt: t } },
        { returnDocument: 'after' },
      );
      if (doc) return toRequest(doc);
      const current = await getRequest(id);
      if (!current) return null;
      return current.status === 'open' ? current : 'completed'; // open: it was already an answer
    },

    /**
     * Everything changed after `since`. The returned cursor lags by SYNC_OVERLAP_MS (see above).
     * A cursor older than DELETION_RETENTION_MS gets a full snapshot with `reset: true`.
     *
     * Items come in pages of about `pageBytes` (oldest change first), so a full sync of a large library
     * stays under the hosting response limit. A cut page sets `more` and a cursor at its last item;
     * items sharing that item's `updatedAt` are never split across pages. Folders, tags, highlights, requests and
     * deletions are small and always sent in full (the next page may repeat some; applying them is idempotent).
     */
    async changesSince(requestedSince: number, { pageBytes = SYNC_PAGE_BYTES } = {}): Promise<SyncResponse> {
      const t = now();
      const reset = requestedSince > 0 && requestedSince < t - DELETION_RETENTION_MS;
      const since = reset ? 0 : requestedSince;
      const changed = { updatedAt: { $gt: since } };

      const bookmarks: Bookmark[] = [];
      let bytes = 0;
      let more = false;
      const changedItems = c.bookmarks.find(changed, { projection: CLIENT_PROJECTION }).sort({ updatedAt: 1, _id: 1 });
      for await (const doc of changedItems) {
        const last = bookmarks.at(-1);
        // Cut only between distinct updatedAt values, and only where the cursor still moves forward.
        if (last && bytes >= pageBytes && doc.updatedAt > last.updatedAt && last.updatedAt > since) {
          more = true;
          break;
        }
        const b = toBookmark(doc as BookmarkDoc);
        bookmarks.push(b);
        bytes += JSON.stringify(b).length;
      }
      await changedItems.close();

      const [folders, highlights, tags, requests, deletions] = await Promise.all([
        c.folders.find(changed).toArray(),
        c.highlights.find(changed).toArray(),
        c.tags.find(changed).toArray(),
        c.requests.find(changed).toArray(),
        reset ? [] : c.deletions.find({ deletedAt: { $gt: since } }).toArray(),
      ]);
      const settled = Math.max(t - SYNC_OVERLAP_MS, since);
      return {
        // A cut page resumes after its last item, but never ahead of the overlap window.
        cursor: more ? Math.min(bookmarks.at(-1)!.updatedAt, settled) : settled,
        reset,
        more,
        bookmarks,
        folders: folders.map(toFolder),
        highlights: highlights.map(toHighlight),
        tags: tags.map(toTag),
        requests: requests.map(toRequest),
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
