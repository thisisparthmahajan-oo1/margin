import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';

export const syncRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const { store, ingestor } = c.var.deps;
  // Clients poll this while articles download, which makes it the natural place to recover
  // fetches that were lost (e.g. a serverless instance frozen mid-download).
  (await store.stalePendingIds()).forEach((id) => ingestor.enqueue(id));
  await store.cleanUpAbandonedUploads();
  const since = Number(c.req.query('since') ?? 0) || 0;
  return c.json(await store.changesSince(since));
});
