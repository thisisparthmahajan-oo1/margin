import { config } from './config.ts';
import { connect } from './db.ts';
import type { Deps } from './deps.ts';
import { createR2FileStore } from './files.ts';
import { createIngestor, type Defer } from './ingest.ts';
import { createMediaStore } from './media.ts';
import { createStore } from './store.ts';
import { createFileLibrary } from './uploads.ts';

/** The one place the server's pieces are assembled; entrypoints differ only in how background work runs. */
export async function buildDeps(defer: Defer): Promise<Deps> {
  const collections = await connect(config.mongoUri, config.dbName);
  const media = createMediaStore(collections.db);
  const fileStore = config.r2 ? createR2FileStore(config.r2) : null;
  const store = createStore(collections, media, fileStore);
  const files = fileStore ? createFileLibrary(store, fileStore, config.fileLimits) : null;
  return { store, media, files, ingestor: createIngestor(store, media, files, defer) };
}
