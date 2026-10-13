import type { Bookmark } from '@margin/shared';
import { extractorFor, ExtractionError } from './extractors/index.ts';
import type { MediaStore } from './media.ts';
import { processPdf } from './pdf.ts';
import { processPage } from './pipeline.ts';
import type { ExtractedContent, Store } from './store.ts';
import { UploadRejected, type FileLibrary } from './uploads.ts';

/**
 * How background work outlives the request that started it:
 * - long-running Node server: just let the promise run
 * - Vercel: hand it to `waitUntil`, which keeps the function alive until it settles
 */
export type Defer = (work: Promise<unknown>) => void;

export const runInBackground: Defer = (work) => void work;

const NO_FILE_STORAGE = 'File storage isn’t set up on the server, so PDFs can’t be saved.';

/** Processes a saved item in the background. Status moves pending -> ready | failed. */
export function createIngestor(store: Store, media: MediaStore, files: FileLibrary | null, defer: Defer) {
  const inFlight = new Set<string>();

  /** An uploaded file is already in storage; a link is fetched and handled by whichever extractor matches it. */
  async function process(bookmark: Bookmark): Promise<{ content: ExtractedContent; reservedKey?: string }> {
    if (bookmark.source === 'upload') {
      if (!files || !bookmark.file) throw new ExtractionError(NO_FILE_STORAGE);
      return { content: await processPdf(await files.read(bookmark.file.key), bookmark.file) };
    }
    const url = new URL(bookmark.url);
    const raw = await extractorFor(url).extract(url);
    if (raw.kind !== 'pdf') return { content: await processPage(raw, media) };
    if (!files) throw new ExtractionError(NO_FILE_STORAGE);
    const file = await files.storeLinkedPdf(bookmark.id, raw.bytes, raw.fileName);
    return { content: await processPdf(raw.bytes, file), reservedKey: file.key };
  }

  async function run(id: string) {
    const bookmark = await store.getBookmark(id);
    if (!bookmark || inFlight.has(id)) return;
    inFlight.add(id);
    try {
      const { content, reservedKey } = await process(bookmark);
      await store.markReady(id, content);
      if (reservedKey) await files!.endUpload(reservedKey);
    } catch (e) {
      const shown = e instanceof ExtractionError || e instanceof UploadRejected;
      const message = shown ? (e as Error).message : `Could not fetch this page (${(e as Error).message})`;
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
