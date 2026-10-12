import type { Ingestor } from './ingest.ts';
import type { MediaStore } from './media.ts';
import type { Store } from './store.ts';

export interface Deps {
  store: Store;
  media: MediaStore;
  ingestor: Ingestor;
}

/** Hono context typing: every /api handler gets the connected dependencies on `c.var.deps`. */
export type AppEnv = { Variables: { deps: Deps } };
