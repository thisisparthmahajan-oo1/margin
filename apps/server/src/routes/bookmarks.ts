import type { CreateBookmarkRequest, UpdateBookmarkRequest } from '@margin/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { extractorFor } from '../extractors/index.ts';
import { canonicalize, parseUserUrl } from '../url.ts';

export const bookmarkRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const { store, ingestor } = c.var.deps;
    const body = await c.req.json<CreateBookmarkRequest>();
    const url = parseUserUrl(body.url ?? '');
    if (!url) return c.json({ error: 'That doesn’t look like a web address' }, 400);
    const { bookmark, created } = await store.saveBookmark({
      id: body.id,
      url: url.href,
      canonicalUrl: canonicalize(url),
      source: extractorFor(url).source,
    });
    if (created || bookmark.status === 'failed') {
      if (!created) await store.markPending(bookmark.id);
      ingestor.enqueue(bookmark.id);
    }
    return c.json(await store.getBookmark(bookmark.id), created ? 201 : 200);
  })
  .get('/:id', async (c) => {
    const bookmark = await c.var.deps.store.getBookmark(c.req.param('id'));
    return bookmark ? c.json(bookmark) : c.json({ error: 'Not found' }, 404);
  })
  .patch('/:id', async (c) => {
    const { store } = c.var.deps;
    const patch = await c.req.json<UpdateBookmarkRequest>();
    if (patch.folderId && !(await store.getFolder(patch.folderId))) return c.json({ error: 'Unknown folder' }, 400);
    if (patch.addTagIds?.length && !(await store.tagsExist(patch.addTagIds))) return c.json({ error: 'Unknown tag' }, 400);
    const bookmark = await store.updateBookmark(c.req.param('id'), patch);
    return bookmark ? c.json(bookmark) : c.json({ error: 'Not found' }, 404);
  })
  .delete('/:id', async (c) =>
    (await c.var.deps.store.deleteBookmark(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404),
  )
  .post('/:id/retry', async (c) => {
    const { store, ingestor } = c.var.deps;
    const id = c.req.param('id');
    if (!(await store.getBookmark(id))) return c.json({ error: 'Not found' }, 404);
    await store.markPending(id);
    ingestor.enqueue(id);
    return c.json(await store.getBookmark(id));
  });
