import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { AppEnv } from '../deps.ts';

export const mediaRoutes = new Hono<AppEnv>().get('/:file', async (c) => {
  const file = await c.var.deps.media.open(c.req.param('file'));
  if (!file) return c.json({ error: 'Not found' }, 404);
  // Content-addressed: the bytes behind a name never change.
  c.header('content-type', file.contentType);
  c.header('content-length', String(file.length));
  c.header('cache-control', 'public, max-age=31536000, immutable');
  return stream(c, async (out) => {
    for await (const chunk of file.stream()) await out.write(chunk as Uint8Array);
  });
});
