import { mediaPathsIn, type Bookmark, type CuratorRequest, type Deletion, type Folder, type Highlight, type Tag } from '@margin/shared';
import { MongoClient, type Collection, type Db } from 'mongodb';

// Stored shapes: the shared domain types keyed by `_id`, plus server-only fields.

/** Server-only bookmark fields, never sent to clients. */
export interface BookmarkServerFields {
  /** Search text. */
  plainText: string | null;
  /** Stored images this article uses; an image is deleted once no bookmark lists it. */
  mediaPaths: string[];
}
export type BookmarkDoc = Omit<Bookmark, 'id'> & { _id: string } & BookmarkServerFields;
export type FolderDoc = Omit<Folder, 'id'> & { _id: string };
export type HighlightDoc = Omit<Highlight, 'id'> & { _id: string };
export type TagDoc = Omit<Tag, 'id'> & { _id: string };
export type RequestDoc = Omit<CuratorRequest, 'id'> & { _id: string };
/** `expiresAt` drives a TTL index: deletion records only need to live long enough for devices to sync them. */
export type DeletionDoc = Deletion & { _id: string; expiresAt: Date };
/**
 * Space reserved for a file a device is uploading (between prepare and finish), so concurrent uploads
 * can't together exceed the storage limit. Keyed by storage key. Abandoned ones are cleaned up on sync.
 */
export interface UploadDoc {
  _id: string;
  bookmarkId: string;
  bytes: number;
  createdAt: number;
}

export interface Collections {
  db: Db;
  bookmarks: Collection<BookmarkDoc>;
  folders: Collection<FolderDoc>;
  highlights: Collection<HighlightDoc>;
  tags: Collection<TagDoc>;
  requests: Collection<RequestDoc>;
  deletions: Collection<DeletionDoc>;
  uploads: Collection<UploadDoc>;
}

export function collections(db: Db): Collections {
  return {
    db,
    bookmarks: db.collection<BookmarkDoc>('bookmarks'),
    folders: db.collection<FolderDoc>('folders'),
    highlights: db.collection<HighlightDoc>('highlights'),
    tags: db.collection<TagDoc>('tags'),
    requests: db.collection<RequestDoc>('requests'),
    deletions: db.collection<DeletionDoc>('deletions'),
    uploads: db.collection<UploadDoc>('uploads'),
  };
}

/** Case-insensitive comparison for tag names. */
export const TAG_NAME_COLLATION = { locale: 'en', strength: 2 } as const;

export async function ensureIndexes(c: Collections) {
  await Promise.all([
    c.bookmarks.createIndex({ canonicalUrl: 1 }, { unique: true }),
    c.bookmarks.createIndex({ updatedAt: 1 }),
    c.bookmarks.createIndex({ status: 1, updatedAt: 1 }),
    c.bookmarks.createIndex({ mediaPaths: 1 }),
    c.bookmarks.createIndex({ 'file.key': 1 }, { sparse: true }),
    c.bookmarks.createIndex({ tagIds: 1 }),
    c.bookmarks.createIndex(
      { title: 'text', siteName: 'text', plainText: 'text' },
      { name: 'bookmarks_text', weights: { title: 10, siteName: 3, plainText: 1 }, default_language: 'english' },
    ),
    c.folders.createIndex({ updatedAt: 1 }),
    c.tags.createIndex({ updatedAt: 1 }),
    // One tag per name, ignoring case ("Later" and "later" are the same tag).
    c.tags.createIndex({ name: 1 }, { unique: true, collation: TAG_NAME_COLLATION }),
    c.highlights.createIndex({ updatedAt: 1 }),
    c.highlights.createIndex({ bookmarkId: 1 }),
    c.requests.createIndex({ updatedAt: 1 }),
    c.requests.createIndex({ bookmarkId: 1 }),
    c.deletions.createIndex({ deletedAt: 1 }),
    c.deletions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.uploads.createIndex({ createdAt: 1 }),
  ]);
}

/** Data fixes for documents written before a field existed. Idempotent; cheap once done. */
export async function backfill(c: Collections) {
  const missing = c.bookmarks.find({ mediaPaths: { $exists: false } }, { projection: { contentHtml: 1, leadImage: 1 } });
  for await (const doc of missing) {
    await c.bookmarks.updateOne({ _id: doc._id }, { $set: { mediaPaths: mediaPathsIn(doc.contentHtml, doc.leadImage) } });
  }
  // Items saved before PDFs and videos existed are articles.
  await c.bookmarks.updateMany(
    { kind: { $exists: false } },
    { $set: { kind: 'article', hasVideo: false, file: null, video: null } },
  );
  await c.bookmarks.updateMany({ tagIds: { $exists: false } }, { $set: { tagIds: [] } });
  await c.bookmarks.updateMany({ suggestion: { $exists: false } }, { $set: { suggestion: null } });
  await c.bookmarks.updateMany({ relevance: { $exists: false } }, { $set: { relevance: null, relevanceAt: null } });
  await c.bookmarks.updateMany({ audio: { $exists: false } }, { $set: { audio: null } });
}

/**
 * One connection per process (or per warm serverless instance), created lazily.
 * Same shape as personal-tracker's lib/db.ts.
 */
let connecting: Promise<Collections> | null = null;

export function connect(uri: string, dbName: string): Promise<Collections> {
  connecting ??= (async () => {
    const client = await new MongoClient(uri).connect();
    const c = collections(client.db(dbName));
    await ensureIndexes(c);
    await backfill(c);
    return c;
  })().catch((e) => {
    connecting = null; // let the next request retry
    throw e;
  });
  return connecting;
}
