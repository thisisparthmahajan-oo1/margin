import { config } from './config.ts';
import { connect } from './db.ts';
import type { Deps } from './deps.ts';
import { createIngestor, type Defer } from './ingest.ts';
import { createMediaStore } from './media.ts';
import { createStore } from './store.ts';

/** The one place the server's pieces are assembled; entrypoints differ only in how background work runs. */
export async function buildDeps(defer: Defer): Promise<Deps> {
  const collections = await connect(config.mongoUri, config.dbName);
  const store = createStore(collections);
  const media = createMediaStore(collections.db);
  return { store, media, ingestor: createIngestor(store, media, defer) };
}
