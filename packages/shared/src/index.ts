// Domain + API types shared by the server and every client (web, extension, native).
// All timestamps are epoch milliseconds; `null` means "not set".

export type BookmarkSource = 'web' | 'x';
export type BookmarkStatus = 'pending' | 'ready' | 'failed';

export interface Bookmark {
  id: string;
  url: string;
  canonicalUrl: string;
  source: BookmarkSource;
  status: BookmarkStatus;
  error: string | null;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImage: string | null;
  contentHtml: string | null;
  wordCount: number;
  publishedAt: number | null;
  folderId: string | null;
  likedAt: number | null;
  archivedAt: number | null;
  progress: number;
  progressUpdatedAt: number | null;
  savedAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** W3C Web Annotation "TextQuoteSelector": survives re-rendering because it anchors on text, not DOM paths. */
export interface TextQuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  bookmarkId: string;
  anchor: TextQuoteAnchor;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export type EntityName = 'bookmark' | 'folder' | 'highlight';

export interface Deletion {
  entity: EntityName;
  id: string;
  deletedAt: number;
}

// ---- Lists (Instapaper's sidebar) ----

export type ListKey =
  | { kind: 'home' }
  | { kind: 'liked' }
  | { kind: 'archive' }
  | { kind: 'folder'; folderId: string };

export type SortKey = 'newest' | 'oldest' | 'shortest' | 'longest';

/** The single definition of list membership, used by server queries and client filtering alike. */
export function isInList(b: Pick<Bookmark, 'archivedAt' | 'likedAt' | 'folderId'>, list: ListKey): boolean {
  switch (list.kind) {
    case 'home':
      return b.archivedAt === null && b.folderId === null;
    case 'liked':
      return b.likedAt !== null;
    case 'archive':
      return b.archivedAt !== null;
    case 'folder':
      return b.archivedAt === null && b.folderId === list.folderId;
  }
}

export const sortComparators: Record<SortKey, (a: Bookmark, b: Bookmark) => number> = {
  newest: (a, b) => b.savedAt - a.savedAt,
  oldest: (a, b) => a.savedAt - b.savedAt,
  shortest: (a, b) => a.wordCount - b.wordCount || b.savedAt - a.savedAt,
  longest: (a, b) => b.wordCount - a.wordCount || b.savedAt - a.savedAt,
};

export const WORDS_PER_MINUTE = 230;
export const readingMinutes = (wordCount: number) => Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

// ---- API ----

export interface CreateBookmarkRequest {
  id?: string;
  url: string;
}

export interface UpdateBookmarkRequest {
  liked?: boolean;
  archived?: boolean;
  folderId?: string | null;
  progress?: number;
}

export interface CreateFolderRequest {
  id?: string;
  name: string;
}

export interface UpdateFolderRequest {
  name?: string;
  position?: number;
}

export interface CreateHighlightRequest {
  id?: string;
  bookmarkId: string;
  anchor: TextQuoteAnchor;
  note?: string | null;
}

export interface UpdateHighlightRequest {
  note: string | null;
}

export interface SyncResponse {
  /** Pass back as `since` on the next sync. */
  cursor: number;
  bookmarks: Bookmark[];
  folders: Folder[];
  highlights: Highlight[];
  deletions: Deletion[];
}

export interface SearchHit {
  bookmarkId: string;
  /** Plain text with matches wrapped in `[[` `]]`. */
  snippet: string;
}

export interface SearchResponse {
  hits: SearchHit[];
}

export interface ApiError {
  error: string;
}

// ---- Reader settings (client-local, Instapaper's "Aa" menu) ----

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'black';
export type ReaderFont = 'literata' | 'source-serif' | 'lora' | 'inter' | 'atkinson';

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  /** px */
  fontSize: number;
  lineHeight: number;
  /** max text column width in characters */
  measure: number;
}
