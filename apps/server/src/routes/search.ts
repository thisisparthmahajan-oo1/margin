import type { SearchResponse } from '@margin/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';

export const searchRoutes = new Hono<AppEnv>().get('/', async (c) =>
  c.json<SearchResponse>({ hits: await c.var.deps.store.search(c.req.query('q') ?? '') }),
);
