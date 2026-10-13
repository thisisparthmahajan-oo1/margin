import type { Bookmark, FileUrlResponse } from '@margin/shared';
import { api } from './api.ts';
import { db } from './db.ts';

/** Original files (PDFs) on this device, keyed like file storage: `files/<sha256>.pdf`. */

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** By content, not name or type: shared files often arrive as application/octet-stream. */
export async function isPdf(blob: Blob): Promise<boolean> {
  return new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) === '%PDF-';
}

export const fileKeysOf = (bookmarks: Bookmark[]) => [...new Set(bookmarks.flatMap((b) => (b.file ? [b.file.key] : [])))];

/** Downloads the originals of items whose file isn't on this device yet (e.g. added on another device). */
export async function downloadMissingFiles(bookmarks: Bookmark[]) {
  const wanted = fileKeysOf(bookmarks.filter((b) => b.status !== 'failed'));
  if (!wanted.length) return;
  const have = await db.files.bulkGet(wanted);
  for (const key of wanted.filter((_, i) => !have[i])) {
    try {
      const { url } = await api<FileUrlResponse>('GET', `/api/files/url?key=${encodeURIComponent(key)}`);
      const res = await fetch(url);
      if (res.ok) await db.files.put({ key, blob: await res.blob() });
    } catch {
      // offline, or not uploaded yet: try again on the next sync
    }
  }
}

/** Deletes files on this device that no remaining item uses. */
export async function pruneFiles() {
  const used = new Set(fileKeysOf(await db.bookmarks.toArray()));
  const unused = (await db.files.toCollection().primaryKeys()).filter((key) => !used.has(key));
  if (unused.length) await db.files.bulkDelete(unused);
}

export async function fileBlob(key: string): Promise<Blob | null> {
  return (await db.files.get(key))?.blob ?? null;
}

/** Bytes of originals kept on this device. */
export async function deviceFileBytes(): Promise<number> {
  let total = 0;
  await db.files.each((f) => (total += f.blob.size));
  return total;
}
