// Domain + API types shared by the server and every client (web, extension, native).
// All timestamps are epoch milliseconds; `null` means "not set".

/** Where an item came from. `upload` = a file added from a device (it has no web address). */
export type BookmarkSource = 'web' | 'x' | 'youtube' | 'upload';
export type BookmarkStatus = 'pending' | 'ready' | 'failed';
/** What an item is, which decides how it's read: text, a PDF (text + original pages), or a video (watched online). */
export type BookmarkKind = 'article' | 'pdf' | 'video';

/** An original file kept in file storage (Cloudflare R2). */
export interface StoredFile {
  /** Content-addressed storage key, `files/<sha256>.pdf`; also the key of the copy on each device. */
  key: string;
  name: string;
  bytes: number;
  contentType: 'application/pdf';
  pages: number | null;
}

/** A video that's linked, not downloaded. */
export interface VideoRef {
  provider: 'youtube';
  videoId: string;
  durationSeconds: number | null;
}

export interface Bookmark {
  id: string;
  url: string;
  canonicalUrl: string;
  source: BookmarkSource;
  kind: BookmarkKind;
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
  /** Contains playable video (YouTube, or an X post/Article with videos): labelled and listed under Videos. */
  hasVideo: boolean;
  /** kind 'pdf': the original file. */
  file: StoredFile | null;
  /** kind 'video': what the player needs. */
  video: VideoRef | null;
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
  | { kind: 'pdfs' }
  | { kind: 'videos' }
  | { kind: 'folder'; folderId: string };

export type SortKey = 'newest' | 'oldest' | 'shortest' | 'longest';

/** The single definition of list membership, used by server queries and client filtering alike. */
export function isInList(
  b: Pick<Bookmark, 'archivedAt' | 'likedAt' | 'folderId' | 'kind' | 'hasVideo'>,
  list: ListKey,
): boolean {
  switch (list.kind) {
    case 'home':
      return b.archivedAt === null && b.folderId === null;
    case 'liked':
      return b.likedAt !== null;
    case 'archive':
      return b.archivedAt !== null;
    case 'pdfs':
      return b.archivedAt === null && b.kind === 'pdf';
    case 'videos':
      return b.archivedAt === null && b.hasVideo;
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

/** Server paths of stored article images, e.g. `/api/media/<hash>.png`. */
export const MEDIA_PATH_PATTERN = /\/api\/media\/[\w.-]+/g;

/** Every stored image an article uses (body + thumbnail). Drives image cleanup on server and devices. */
export function mediaPathsIn(contentHtml: string | null, leadImage: string | null): string[] {
  return [...new Set([...(contentHtml?.match(MEDIA_PATH_PATTERN) ?? []), ...(leadImage?.match(MEDIA_PATH_PATTERN) ?? [])])];
}

export const WORDS_PER_MINUTE = 230;
export const readingMinutes = (wordCount: number) => Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

/** How long an item is, in the unit that fits it: "12 min", "24 pages", "1 h 5 min video". Null if not known yet. */
export function lengthLabel(b: Pick<Bookmark, 'kind' | 'wordCount' | 'file' | 'video'>): string | null {
  switch (b.kind) {
    case 'pdf':
      return b.file?.pages ? `${b.file.pages} ${b.file.pages === 1 ? 'page' : 'pages'}` : null;
    case 'video':
      return b.video?.durationSeconds ? `${formatDuration(b.video.durationSeconds)} video` : 'Video';
    case 'article':
      return `${readingMinutes(b.wordCount)} min`;
  }
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ---- Files ----

export const PDF_CONTENT_TYPE = 'application/pdf';
/** Storage key for a file, from the hex SHA-256 of its bytes. */
export const fileKeyFor = (sha256: string) => `files/${sha256}.pdf`;
/** The address an uploaded file is saved under; saving the same file again finds it, like saving a link again. */
export const uploadUrlFor = (sha256: string) => `upload:${sha256}`;

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
  /**
   * The client's cursor is older than the server keeps deletion records for, so deletions may have
   * been missed. This response is a full snapshot: replace the local library with it.
   */
  reset: boolean;
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

/** Step 1 of adding a file: the server checks size and the storage limit, and reserves the space. */
export interface PrepareUploadRequest {
  bookmarkId: string;
  name: string;
  bytes: number;
  /** Hex SHA-256 of the file. */
  sha256: string;
}

export type PrepareUploadResponse =
  /** This file is already in the library; it was moved back to the top of Home. */
  | { status: 'exists'; bookmark: Bookmark }
  /** PUT the bytes to `putUrl` (with `content-type: application/pdf`), then call finish. */
  | { status: 'upload'; key: string; putUrl: string };

/** Step 3: the file is in storage; create the item. */
export interface FinishUploadRequest {
  bookmarkId: string;
  key: string;
  name: string;
}

export interface FileUrlResponse {
  /** Short-lived signed download link. */
  url: string;
}

export interface StorageResponse {
  usedBytes: number;
  limitBytes: number;
  maxFileBytes: number;
}

export interface SignInRequest {
  /** The server's APP_TOKEN. */
  token: string;
}

/** A device session. Both null when the server has no APP_TOKEN (open server, e.g. local dev). */
export interface SessionResponse {
  session: string | null;
  expiresAt: number | null;
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
