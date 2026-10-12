import { extractorFor, ExtractionError } from './extractors/index.ts';
import type { MediaStore } from './media.ts';
import { processArticle } from './pipeline.ts';
import type { Store } from './store.ts';

/**
 * How background work outlives the request that started it:
 * - long-running Node server: just let the promise run
 * - Vercel: hand it to `waitUntil`, which keeps the function alive until it settles
 */
export type Defer = (work: Promise<unknown>) => void;

export const runInBackground: Defer = (work) => void work;

/** Fetches + processes a saved bookmark in the background. Status moves pending -> ready | failed. */
export function createIngestor(store: Store, media: MediaStore, defer: Defer) {
  const inFlight = new Set<string>();

  async function run(id: string) {
    const bookmark = await store.getBookmark(id);
    if (!bookmark || inFlight.has(id)) return;
    inFlight.add(id);
    try {
      const url = new URL(bookmark.url);
      const raw = await extractorFor(url).extract(url);
      await store.markReady(id, await processArticle(raw, media));
    } catch (e) {
      const message = e instanceof ExtractionError ? e.message : `Could not fetch this page (${(e as Error).message})`;
      console.warn(`[ingest] ${bookmark.url}: ${(e as Error).message}`);
      if (await store.getBookmark(id)) await store.markFailed(id, message);
    } finally {
      inFlight.delete(id);
    }
  }

  return {
    enqueue(id: string) {
      defer(run(id));
    },
  };
}

export type Ingestor = ReturnType<typeof createIngestor>;
