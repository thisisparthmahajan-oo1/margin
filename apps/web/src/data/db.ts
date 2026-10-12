import type { Bookmark, Folder, Highlight, UpdateBookmarkRequest, TextQuoteAnchor } from '@margin/shared';
import Dexie, { type EntityTable } from 'dexie';

/** A change made on this device that the server hasn't acknowledged yet. Flushed in `seq` order. */
export type OutboxOp =
  | { type: 'bookmark.create'; id: string; url: string }
  | { type: 'bookmark.update'; id: string; patch: UpdateBookmarkRequest }
  | { type: 'bookmark.delete'; id: string }
  | { type: 'bookmark.retry'; id: string }
  | { type: 'folder.create'; id: string; name: string }
  | { type: 'folder.update'; id: string; name: string }
  | { type: 'folder.delete'; id: string }
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

interface Meta {
  key: 'syncCursor';
  value: number;
}

/** Local mirror of the server library. The UI reads only from here, so everything works offline. */
export const db = new Dexie('margin') as Dexie & {
  bookmarks: EntityTable<Bookmark, 'id'>;
  folders: EntityTable<Folder, 'id'>;
  highlights: EntityTable<Highlight, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<Meta, 'key'>;
  media: EntityTable<MediaEntry, 'path'>;
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
