// Domain + API types shared by the server and every client (web, extension, native).
// All timestamps are epoch milliseconds; `null` means "not set".

/** Where an item came from. `upload` = a file added from a device (it has no web address). */
export type BookmarkSource = 'web' | 'x' | 'youtube' | 'podcast' | 'upload';
export type BookmarkStatus = 'pending' | 'ready' | 'failed';
/**
 * What an item is, which decides how it's read: text, a PDF (text + original pages), a video
 * (watched online), or a podcast episode (listened to in its app or site).
 */
export type BookmarkKind = 'article' | 'pdf' | 'video' | 'podcast';

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

/** A podcast episode that's linked, not downloaded: the text is its show notes, and it's played where it lives. */
export interface AudioRef {
  provider: 'apple' | 'spotify' | 'web';
  showName: string | null;
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
  /** kind 'podcast': the episode's show and length. */
  audio: AudioRef | null;
  /** Tags on this item (any number, independent of its folder). */
  tagIds: string[];
  /** Set when something other than you added the item (the Daily Curator); null for items you saved. */
  suggestion: Suggestion | null;
  /** Your verdict on whether an item was worth suggesting. Separate from like, archive and delete. */
  relevance: Relevance | null;
  /** When `relevance` last changed, including being cleared. */
  relevanceAt: number | null;
  folderId: string | null;
  likedAt: number | null;
  archivedAt: number | null;
  progress: number;
  progressUpdatedAt: number | null;
  savedAt: number;
  updatedAt: number;
}

/** Who suggested an item and why. */
export interface Suggestion {
  /** The name of the API token that added it (e.g. `curator`), or `you`. */
  by: string;
  reason: string;
  at: number;
  /** The request this item answers, when the agent added it in answer to one. */
  requestId?: string;
}

export const SUGGESTION_REASON_MAX = 300;

export const RELEVANCE_VALUES = ['relevant', 'not_relevant'] as const;
export type Relevance = (typeof RELEVANCE_VALUES)[number];

export interface Folder {
  id: string;
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** A label for where an item stands, e.g. "don't understand yet". Unlike folders, an item can have many. */
export interface Tag {
  id: string;
  name: string;
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

/**
 * Something you asked an agent (an API token, e.g. `curator`) to find or explain. One-off, not a
 * standing interest: the agent links answers and keeps a status line until you mark it completed.
 */
export interface CuratorRequest {
  id: string;
  /** Trimmed, 1–REQUEST_TEXT_MAX characters. Only you can change it. */
  text: string;
  /** The API token name it's addressed to. */
  for: string;
  /** Set when asked from an article. Kept when that article is deleted. */
  bookmarkId: string | null;
  /** Set when asked from a passage. */
  anchor: TextQuoteAnchor | null;
  status: RequestStatus;
  completedAt: number | null;
  /** The agent's status line (REQUEST_REPLY_MAX characters at most). */
  reply: { text: string; updatedAt: number } | null;
  /** Items the agent linked as answers, in the order it linked them. */
  answers: RequestAnswer[];
  createdAt: number;
  /** Bumped by any change, including the agent's. */
  updatedAt: number;
}

export const REQUEST_STATUSES = ['open', 'completed'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface RequestAnswer {
  bookmarkId: string;
  addedAt: number;
}

export const REQUEST_TEXT_MAX = 1000;
export const REQUEST_REPLY_MAX = 300;
/** Who requests are addressed to when the client doesn't say. */
export const DEFAULT_REQUEST_AGENT = 'curator';

export type EntityName = 'bookmark' | 'folder' | 'highlight' | 'tag' | 'request';

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
  | { kind: 'podcasts' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'tag'; tagId: string };

export type SortKey = 'newest' | 'oldest' | 'shortest' | 'longest';

/** The single definition of list membership, used by server queries and client filtering alike. */
export function isInList(
  b: Pick<Bookmark, 'archivedAt' | 'likedAt' | 'folderId' | 'kind' | 'hasVideo' | 'tagIds'>,
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
    case 'podcasts':
      return b.archivedAt === null && b.kind === 'podcast';
    case 'folder':
      return b.archivedAt === null && b.folderId === list.folderId;
    case 'tag':
      return b.archivedAt === null && b.tagIds.includes(list.tagId);
  }
}

/** Narrows any list to items with a tag (e.g. a folder's "don't understand yet" items). No tag: unchanged. */
export const filterByTag = <T extends Pick<Bookmark, 'tagIds'>>(items: T[], tagId: string | null): T[] =>
  tagId ? items.filter((b) => b.tagIds.includes(tagId)) : items;

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
export function lengthLabel(b: Pick<Bookmark, 'kind' | 'wordCount' | 'file' | 'video' | 'audio'>): string | null {
  switch (b.kind) {
    case 'pdf':
      return b.file?.pages ? `${b.file.pages} ${b.file.pages === 1 ? 'page' : 'pages'}` : null;
    case 'video':
      return b.video?.durationSeconds ? `${formatDuration(b.video.durationSeconds)} video` : 'Video';
    case 'podcast':
      return b.audio?.durationSeconds ? `${formatDuration(b.audio.durationSeconds)} episode` : 'Podcast';
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
  /** Applied only when the item is created, so it never shows in Home on the way. */
  folderId?: string | null;
  addTagIds?: string[];
  /** Why it was suggested. Who suggested it comes from the credentials the request was sent with. */
  suggestion?: {
    reason: string;
    /** An open request addressed to this token: the item is linked to it as an answer (not on a 409). */
    requestId?: string;
  };
  /** Never re-save: when the address is already saved, answer 409 (`AlreadySavedResponse`) and leave that item alone. */
  ifNew?: boolean;
}

/** The 409 answer to a create with `ifNew` when the address is already saved. */
export interface AlreadySavedResponse extends ApiError {
  bookmark: Bookmark;
}

export interface UpdateBookmarkRequest {
  liked?: boolean;
  archived?: boolean;
  folderId?: string | null;
  progress?: number;
  /**
   * Tags are added and removed rather than replaced, so tagging an item on two devices at once
   * merges instead of one change overwriting the other.
   */
  addTagIds?: string[];
  removeTagIds?: string[];
  /** null clears it. */
  relevance?: Relevance | null;
}

/** Applies a tag change to an item's tags; the server and devices both use this. */
export function applyTagChange(tagIds: string[], patch: Pick<UpdateBookmarkRequest, 'addTagIds' | 'removeTagIds'>): string[] {
  const removed = new Set(patch.removeTagIds ?? []);
  return [...new Set([...tagIds, ...(patch.addTagIds ?? [])])].filter((id) => !removed.has(id));
}

export interface CreateFolderRequest {
  id?: string;
  name: string;
}

export interface UpdateFolderRequest {
  name?: string;
  position?: number;
}

export interface CreateTagRequest {
  id?: string;
  name: string;
}

export interface UpdateTagRequest {
  name: string;
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

export interface CreateRequestRequest {
  id?: string;
  text: string;
  bookmarkId?: string | null;
  anchor?: TextQuoteAnchor | null;
  /** Defaults to DEFAULT_REQUEST_AGENT; must be the name of a configured API token. */
  for?: string;
}

/** One kind of change per call: yours (`text`, `status`) or the agent's (`reply`). */
export type UpdateRequestRequest = { text: string } | { status: RequestStatus } | { reply: string };

export interface AddAnswerRequest {
  bookmarkId: string;
}

export interface SyncResponse {
  /** Pass back as `since` on the next sync. */
  cursor: number;
  /**
   * The client's cursor is older than the server keeps deletion records for, so deletions may have
   * been missed. This response is a full snapshot: replace the local library with it.
   */
  reset: boolean;
  /**
   * More changed items than fit in one response: sync again from `cursor` straight away for the
   * rest. (A client that waits for its next regular sync still gets everything, just later.)
   */
  more: boolean;
  bookmarks: Bookmark[];
  folders: Folder[];
  highlights: Highlight[];
  tags: Tag[];
  /** All of them, completed included. */
  requests: CuratorRequest[];
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
