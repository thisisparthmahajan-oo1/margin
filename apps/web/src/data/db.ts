import type { Bookmark, Folder, Highlight, Tag, UpdateBookmarkRequest, TextQuoteAnchor } from '@margin/shared';
import Dexie, { type EntityTable } from 'dexie';

/** A change made on this device that the server hasn't acknowledged yet. Flushed in `seq` order. */
export type OutboxOp =
  | { type: 'bookmark.create'; id: string; url: string }
  | { type: 'bookmark.update'; id: string; patch: UpdateBookmarkRequest }
  | { type: 'bookmark.delete'; id: string }
  | { type: 'bookmark.retry'; id: string }
  /** A file added on this device; its bytes wait in `files` under `key` until uploaded. */
  | { type: 'bookmark.upload'; id: string; key: string; name: string; bytes: number }
  | { type: 'folder.create'; id: string; name: string }
  | { type: 'folder.update'; id: string; name: string }
  | { type: 'folder.delete'; id: string }
  | { type: 'tag.create'; id: string; name: string }
  | { type: 'tag.update'; id: string; name: string }
  | { type: 'tag.delete'; id: string }
  | { type: 'highlight.create'; id: string; bookmarkId: string; anchor: TextQuoteAnchor; note: string | null }
  | { type: 'highlight.update'; id: string; note: string | null }
  | { type: 'highlight.delete'; id: string };

export interface OutboxEntry {
  seq?: number;
  op: OutboxOp;
}

/** An article image kept on the device so articles render fully offline (no service worker needed). */
export interface MediaEntry {
  path: string;
  blob: Blob;
}

/** An original file (PDF) kept on the device, under its storage key. */
export interface FileEntry {
  key: string;
  blob: Blob;
}

interface Meta {
  key: 'syncCursor';
  value: number;
}

/** Local mirror of the server library. The UI reads only from here, so everything works offline. */
export const db = new Dexie('margin') as Dexie & {
  bookmarks: EntityTable<Bookmark, 'id'>;
  folders: EntityTable<Folder, 'id'>;
  tags: EntityTable<Tag, 'id'>;
  highlights: EntityTable<Highlight, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<Meta, 'key'>;
  media: EntityTable<MediaEntry, 'path'>;
  files: EntityTable<FileEntry, 'key'>;
};

db.version(1).stores({
  bookmarks: 'id, canonicalUrl, savedAt, updatedAt, status',
  folders: 'id, position',
  highlights: 'id, bookmarkId, createdAt',
  outbox: '++seq',
  meta: 'key',
});

db.version(2).stores({
  media: 'path',
});

db.version(3)
  .stores({ files: 'key' })
  .upgrade((tx) =>
    // Items saved before PDFs and videos existed are articles.
    tx
      .table<Bookmark>('bookmarks')
      .toCollection()
      .modify((b) => {
        b.kind ??= 'article';
        b.hasVideo ??= false;
        b.file ??= null;
        b.video ??= null;
      }),
  );

db.version(4)
  .stores({
    bookmarks: 'id, canonicalUrl, savedAt, updatedAt, status, *tagIds',
    tags: 'id, name',
  })
  .upgrade((tx) =>
    tx
      .table<Bookmark>('bookmarks')
      .toCollection()
      .modify((b) => {
        b.tagIds ??= [];
      }),
  );

db.version(5)
  .stores({})
  .upgrade((tx) =>
    tx
      .table<Bookmark>('bookmarks')
      .toCollection()
      .modify((b) => {
        b.suggestion ??= null;
      }),
  );

db.version(6)
  .stores({})
  .upgrade((tx) =>
    tx
      .table<Bookmark>('bookmarks')
      .toCollection()
      .modify((b) => {
        b.relevance ??= null;
        b.relevanceAt ??= null;
      }),
  );

db.version(7)
  .stores({})
  .upgrade((tx) =>
    tx
      .table<Bookmark>('bookmarks')
      .toCollection()
      .modify((b) => {
        b.audio ??= null;
      }),
  );
