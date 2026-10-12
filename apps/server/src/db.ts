import type { Bookmark, Deletion, Folder, Highlight } from '@margin/shared';
import { MongoClient, type Collection, type Db } from 'mongodb';

/** Stored shapes: the shared domain types keyed by `_id`, plus server-only fields. */
export type BookmarkDoc = Omit<Bookmark, 'id'> & { _id: string; plainText: string | null };
export type FolderDoc = Omit<Folder, 'id'> & { _id: string };
export type HighlightDoc = Omit<Highlight, 'id'> & { _id: string };
export type DeletionDoc = Deletion & { _id: string };

export interface Collections {
  db: Db;
  bookmarks: Collection<BookmarkDoc>;
  folders: Collection<FolderDoc>;
  highlights: Collection<HighlightDoc>;
  deletions: Collection<DeletionDoc>;
}

export function collections(db: Db): Collections {
  return {
    db,
    bookmarks: db.collection<BookmarkDoc>('bookmarks'),
    folders: db.collection<FolderDoc>('folders'),
    highlights: db.collection<HighlightDoc>('highlights'),
    deletions: db.collection<DeletionDoc>('deletions'),
  };
}

export async function ensureIndexes(c: Collections) {
  await Promise.all([
    c.bookmarks.createIndex({ canonicalUrl: 1 }, { unique: true }),
    c.bookmarks.createIndex({ updatedAt: 1 }),
    c.bookmarks.createIndex({ status: 1, updatedAt: 1 }),
    c.bookmarks.createIndex(
      { title: 'text', siteName: 'text', plainText: 'text' },
      { name: 'bookmarks_text', weights: { title: 10, siteName: 3, plainText: 1 }, default_language: 'english' },
    ),
    c.folders.createIndex({ updatedAt: 1 }),
    c.highlights.createIndex({ updatedAt: 1 }),
    c.highlights.createIndex({ bookmarkId: 1 }),
    c.deletions.createIndex({ deletedAt: 1 }),
  ]);
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
    return c;
  })().catch((e) => {
    connecting = null; // let the next request retry
    throw e;
  });
  return connecting;
}
