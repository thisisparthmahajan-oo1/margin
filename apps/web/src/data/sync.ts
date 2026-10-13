import {
  PDF_CONTENT_TYPE,
  type Bookmark,
  type Folder,
  type Highlight,
  type PrepareUploadResponse,
  type SyncResponse,
} from '@margin/shared';
import { useSyncExternalStore } from 'react';
import { api, ApiRequestError } from './api.ts';
import { db, type OutboxOp } from './db.ts';
import { downloadMissingFiles, pruneFiles } from './files.ts';
import { downloadMissingMedia, pruneMedia } from './media.ts';
import { toast } from './toast.ts';

// ---- outbox: one explicit HTTP call per op type ----

type Sender<T extends OutboxOp['type']> = (op: Extract<OutboxOp, { type: T }>) => Promise<void>;

/** The server de-duplicates by address, so the saved item may be an existing one with a different id. */
const replaceLocal = (localId: string, saved: Bookmark) =>
  db.transaction('rw', db.bookmarks, async () => {
    if (saved.id !== localId) await db.bookmarks.delete(localId);
    await db.bookmarks.put(saved);
  });

const send: { [T in OutboxOp['type']]: Sender<T> } = {
  'bookmark.create': async (op) => {
    await replaceLocal(op.id, await api<Bookmark>('POST', '/api/bookmarks', { id: op.id, url: op.url }));
  },
  // prepare (size + storage limit) -> PUT the bytes straight to file storage -> finish.
  'bookmark.upload': async (op) => {
    const blob = (await db.files.get(op.key))?.blob;
    if (!blob) throw new ApiRequestError(410, 'The file is no longer on this device. Add it again.');
    const sha256 = op.key.slice('files/'.length, -'.pdf'.length);
    const prepared = await api<PrepareUploadResponse>('POST', '/api/files/prepare', {
      bookmarkId: op.id, name: op.name, bytes: op.bytes, sha256,
    });
    if (prepared.status === 'exists') return replaceLocal(op.id, prepared.bookmark);
    const put = await fetch(prepared.putUrl, { method: 'PUT', body: blob, headers: { 'content-type': PDF_CONTENT_TYPE } });
    if (put.status >= 400 && put.status < 500) {
      throw new ApiRequestError(put.status, `File storage refused the upload (HTTP ${put.status}). Try again later.`);
    }
    if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`); // transient: retried on the next sync
    await replaceLocal(op.id, await api<Bookmark>('POST', '/api/files/finish', { bookmarkId: op.id, key: op.key, name: op.name }));
  },
  'bookmark.update': async (op) => {
    await db.bookmarks.put(await api<Bookmark>('PATCH', `/api/bookmarks/${op.id}`, op.patch));
  },
  'bookmark.delete': async (op) => api('DELETE', `/api/bookmarks/${op.id}`),
  'bookmark.retry': async (op) => {
    await db.bookmarks.put(await api<Bookmark>('POST', `/api/bookmarks/${op.id}/retry`));
  },
  'folder.create': async (op) => {
    await db.folders.put(await api<Folder>('POST', '/api/folders', { id: op.id, name: op.name }));
  },
  'folder.update': async (op) => {
    await db.folders.put(await api<Folder>('PATCH', `/api/folders/${op.id}`, { name: op.name }));
  },
  'folder.delete': async (op) => api('DELETE', `/api/folders/${op.id}`),
  'highlight.create': async (op) => {
    await db.highlights.put(
      await api<Highlight>('POST', '/api/highlights', {
        id: op.id,
        bookmarkId: op.bookmarkId,
        anchor: op.anchor,
        note: op.note,
      }),
    );
  },
  'highlight.update': async (op) => {
    await db.highlights.put(await api<Highlight>('PATCH', `/api/highlights/${op.id}`, { note: op.note }));
  },
  'highlight.delete': async (op) => api('DELETE', `/api/highlights/${op.id}`),
};

/** Refused for good: a client error, or a feature the server doesn't have (501). Anything else is retried. */
const isPermanent = (e: unknown): e is ApiRequestError =>
  e instanceof ApiRequestError &&
  ((e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) || e.status === 501);

/** What the user sees when the server refuses a change for good. Ops not listed are dropped quietly. */
const onRejected: { [T in OutboxOp['type']]?: (op: Extract<OutboxOp, { type: T }>, e: ApiRequestError) => Promise<void> } = {
  // E.g. storage full or the file is too big: the item stays, marked failed with the reason.
  'bookmark.upload': async (op, e) => {
    await db.bookmarks.update(op.id, { status: 'failed', error: e.message });
    toast(e.message, undefined, 10_000);
  },
};

async function flushOutbox() {
  for (const entry of await db.outbox.orderBy('seq').toArray()) {
    try {
      await (send[entry.op.type] as Sender<OutboxOp['type']>)(entry.op);
      await db.outbox.delete(entry.seq!);
    } catch (e) {
      if (!isPermanent(e)) throw e; // offline or server down: keep the op and retry later, in order
      console.warn('Dropping rejected change', entry.op, e);
      await db.outbox.delete(entry.seq!);
      const handle = onRejected[entry.op.type] as ((op: OutboxOp, e: ApiRequestError) => Promise<void>) | undefined;
      await handle?.(entry.op, e);
    }
  }
}

// ---- pull ----

async function pull() {
  const cursor = (await db.meta.get('syncCursor'))?.value ?? 0;
  const res = await api<SyncResponse>('GET', `/api/sync?since=${cursor}`);
  await db.transaction('rw', [db.bookmarks, db.folders, db.highlights, db.meta, db.outbox], async () => {
    // Don't overwrite optimistic local edits made while this pull was in flight; their ops are still queued.
    const dirty = new Set((await db.outbox.toArray()).map((e) => e.op.id));
    const clean = <T extends { id: string }>(rows: T[]) => rows.filter((r) => !dirty.has(r.id));

    if (res.reset) {
      // Away too long to replay deletions: the response is the whole library, so replace ours with it.
      for (const table of [db.bookmarks, db.folders, db.highlights]) {
        await table.where('id').noneOf([...dirty]).delete();
      }
    }
    await db.bookmarks.bulkPut(clean(res.bookmarks));
    await db.folders.bulkPut(clean(res.folders));
    await db.highlights.bulkPut(clean(res.highlights));
    for (const d of res.deletions) {
      const table = { bookmark: db.bookmarks, folder: db.folders, highlight: db.highlights }[d.entity];
      await table.delete(d.id);
    }
    await db.meta.put({ key: 'syncCursor', value: res.cursor });
  });
  if (res.reset || res.deletions.some((d) => d.entity === 'bookmark')) await Promise.all([pruneMedia(), pruneFiles()]);
  void downloadMissingMedia(res.bookmarks);
  void downloadMissingFiles(res.bookmarks);
}

// ---- status + scheduling ----

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized';
  lastSyncedAt: number | null;
}

let status: SyncStatus = { state: 'idle', lastSyncedAt: null };
const listeners = new Set<() => void>();
const setStatus = (s: Partial<SyncStatus>) => {
  status = { ...status, ...s };
  listeners.forEach((l) => l());
};

export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Push local changes, then pull remote ones. Calls made while a sync runs coalesce into one follow-up run. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      setStatus({ state: 'syncing' });
      try {
        await flushOutbox();
        await pull();
        setStatus({ state: 'idle', lastSyncedAt: Date.now() });
      } catch (e) {
        const state = e instanceof ApiRequestError ? (e.status === 401 ? 'unauthorized' : 'error') : 'offline';
        setStatus({ state });
        again = false;
      }
    } while (again);
  })().finally(() => {
    running = null;
    void scheduleNext();
  });
  return running;
}

/** Poll quickly while an article is still downloading on the server, otherwise once a minute. */
async function scheduleNext() {
  clearTimeout(timer);
  const hasPending = (await db.bookmarks.where('status').equals('pending').count()) > 0;
  timer = setTimeout(() => void syncNow(), hasPending ? 2_000 : 60_000);
}

let started = false;

/** Starts background syncing. Safe to call more than once (e.g. after signing in again). */
export function startSync() {
  if (started) {
    void syncNow();
    return;
  }
  started = true;
  // Catch up on images for articles synced before they could be downloaded (e.g. while offline).
  void syncNow().then(async () => {
    const all = await db.bookmarks.toArray();
    await Promise.all([downloadMissingMedia(all), downloadMissingFiles(all)]);
  });
  const kick = () => void syncNow();
  window.addEventListener('online', kick);
  window.addEventListener('focus', kick);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());
}
