import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { collections, ensureIndexes, type Collections } from '../src/db.ts';

/** A throwaway MongoDB per test file; every test starts from empty collections. */
export function useTestDb() {
  let server: MongoMemoryServer;
  let client: MongoClient;
  const ctx = {} as { db: Db; c: Collections };

  beforeAll(async () => {
    server = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
    client = await new MongoClient(server.getUri()).connect();
  }, 120_000);

  beforeEach(async () => {
    ctx.db = client.db(`test_${Math.random().toString(36).slice(2)}`);
    ctx.c = collections(ctx.db);
    await ensureIndexes(ctx.c);
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  return ctx;
}
