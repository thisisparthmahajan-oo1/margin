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

/**
 * Hono context typing: every /api handler gets the connected dependencies on `c.var.deps`, and
 * `c.var.caller`: the name of the API token the request used (e.g. `curator`), or `you` for your
 * own devices and APP_TOKEN.
 */
export type AppEnv = { Variables: { deps: Deps; caller: string } };

/** Who `caller` is for requests made with your own credentials. */
export const OWNER = 'you';
