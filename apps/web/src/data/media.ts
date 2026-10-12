import { mediaPathsIn, type Bookmark } from '@margin/shared';
import { API_BASE } from './config.ts';
import { db } from './db.ts';

const CONCURRENCY = 4;

export const isMediaPath = (src: string) => src.startsWith('/api/media/');

export const mediaPathsOf = (b: Bookmark): string[] => (b.status === 'ready' ? mediaPathsIn(b.contentHtml, b.leadImage) : []);

/** Downloads any images these bookmarks reference that aren't on the device yet. Best effort. */
export async function downloadMissingMedia(bookmarks: Bookmark[]) {
  const wanted = [...new Set(bookmarks.flatMap(mediaPathsOf))];
  if (!wanted.length) return;
  const have = await db.media.bulkGet(wanted);
  const missing = wanted.filter((_, i) => !have[i]);
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async (path) => {
        try {
          const res = await fetch(API_BASE + path);
          if (res.ok) await db.media.put({ path, blob: await res.blob() });
        } catch {
          // offline or server unreachable: try again on the next sync
        }
      }),
    );
  }
}

/**
 * Deletes on-device images that no remaining article uses, e.g. after an article was deleted here
 * or on another device. Images are shared between articles, so usage is computed across the library.
 */
export async function pruneMedia() {
  const used = new Set((await db.bookmarks.toArray()).flatMap(mediaPathsOf));
  const unused = (await db.media.toCollection().primaryKeys()).filter((path) => !used.has(path));
  if (!unused.length) return;
  await db.media.bulkDelete(unused);
  for (const path of unused) {
    const url = objectUrls.get(path);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(path);
  }
}

const objectUrls = new Map<string, string>();

/** Displayable URL for an image path: the on-device copy if we have it, else the server URL. */
export async function resolveMedia(src: string): Promise<string> {
  if (!isMediaPath(src)) return src;
  const cached = objectUrls.get(src);
  if (cached) return cached;
  const entry = await db.media.get(src);
  if (!entry) return API_BASE + src;
  const url = URL.createObjectURL(entry.blob);
  objectUrls.set(src, url);
  return url;
}

/** Points every stored-image <img>/<video poster> inside `root` at its on-device copy. */
export async function localizeMedia(root: HTMLElement) {
  await Promise.all(
    [...root.querySelectorAll<HTMLImageElement>('img[src^="/api/media/"]')].map(async (img) => {
      img.src = await resolveMedia(img.getAttribute('src')!);
    }),
  );
  await Promise.all(
    [...root.querySelectorAll<HTMLVideoElement>('video[poster^="/api/media/"]')].map(async (v) => {
      v.poster = await resolveMedia(v.getAttribute('poster')!);
    }),
  );
}
