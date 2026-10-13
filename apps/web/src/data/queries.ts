import { isInList, sortComparators, type Bookmark, type ListKey, type SortKey } from '@margin/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.ts';

export const useBookmarks = (list: ListKey, sort: SortKey) =>
  useLiveQuery(
    async () => (await db.bookmarks.toArray()).filter((b) => isInList(b, list)).sort(sortComparators[sort]),
    [JSON.stringify(list), sort],
  );

export const useBookmark = (id: string | undefined) =>
  useLiveQuery(async () => (id ? ((await db.bookmarks.get(id)) ?? null) : null), [id]);

export const useFolders = () => useLiveQuery(() => db.folders.orderBy('position').toArray(), []) ?? [];

export const useHighlights = (bookmarkId: string | undefined) =>
  useLiveQuery(
    async () => (bookmarkId ? await db.highlights.where('bookmarkId').equals(bookmarkId).sortBy('createdAt') : []),
    [bookmarkId],
  ) ?? [];

export const useHomeCount = () =>
  useLiveQuery(async () => (await db.bookmarks.toArray()).filter((b) => isInList(b, { kind: 'home' })).length, []);

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Ready items open in the reader, and so do uploaded PDFs that aren't processed (yet): their original is on the device. */
export const canOpen = (b: Bookmark) => b.status === 'ready' || (b.kind === 'pdf' && b.source === 'upload');
