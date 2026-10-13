import type { Ingestor } from './ingest.ts';
import type { MediaStore } from './media.ts';
import type { Store } from './store.ts';
import type { FileLibrary } from './uploads.ts';

export interface Deps {
  store: Store;
  media: MediaStore;
  /** null when file storage (R2) isn't configured: saving PDFs is switched off. */
  files: FileLibrary | null;
  ingestor: Ingestor;
}

/** Hono context typing: every /api handler gets the connected dependencies on `c.var.deps`. */
export type AppEnv = { Variables: { deps: Deps } };
