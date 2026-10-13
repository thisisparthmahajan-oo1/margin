import type { FileUrlResponse, FinishUploadRequest, PrepareUploadRequest } from '@margin/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../deps.ts';
import { UploadRejected, type FileLibrary } from '../uploads.ts';

/** Adding PDFs from a device, and downloading them for offline reading (see uploads.ts for the flow). */
export const fileRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    // 501, not 503: this is how the server is configured, so devices shouldn't keep retrying.
    if (!c.var.deps.files) return c.json({ error: 'File storage isn’t set up on the server, so PDFs can’t be saved.' }, 501);
    await next();
  })
  .onError((e, c) => (e instanceof UploadRejected ? c.json({ error: e.message }, e.status) : Promise.reject(e)))
  .get('/storage', async (c) => c.json(await library(c).storage()))
  .post('/prepare', async (c) => c.json(await library(c).prepare(await c.req.json<PrepareUploadRequest>())))
  .post('/finish', async (c) => {
    const { bookmark, created } = await library(c).finish(await c.req.json<FinishUploadRequest>());
    if (created) c.var.deps.ingestor.enqueue(bookmark.id);
    return c.json(bookmark, created ? 201 : 200);
  })
  .get('/url', async (c) => {
    const url = await library(c).downloadUrl(c.req.query('key') ?? '');
    return url ? c.json<FileUrlResponse>({ url }) : c.json({ error: 'Not found' }, 404);
  });

const library = (c: Context<AppEnv>): FileLibrary => c.var.deps.files!;
