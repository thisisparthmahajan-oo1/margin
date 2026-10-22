import type { Context } from 'hono';
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
 * Hono context typing: every /api handler gets the connected dependencies on `c.var.deps`,
 * `c.var.caller`: the name of the API token the request used (e.g. `curator`), or `you` for your
 * own devices and APP_TOKEN, and `c.var.agents`: the names of all configured API tokens.
 */
export type AppEnv = { Variables: { deps: Deps; caller: string; agents: string[] } };

/** Who `caller` is for requests made with your own credentials. */
export const OWNER = 'you';

export const isOwner = (c: Context<AppEnv>) => c.var.caller === OWNER;
