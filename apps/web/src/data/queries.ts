import { isInList, sortComparators, type ListKey, type SortKey } from '@margin/shared';
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
