import type { CreateHighlightRequest, UpdateHighlightRequest } from '@margin/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';

export const highlightRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const { store } = c.var.deps;
    const body = await c.req.json<CreateHighlightRequest>();
    if (!body.anchor?.exact?.trim()) return c.json({ error: 'Highlight text is required' }, 400);
    if (!(await store.getBookmark(body.bookmarkId))) return c.json({ error: 'Unknown article' }, 400);
    const existing = body.id ? await store.getHighlight(body.id) : null;
    return c.json(existing ?? (await store.createHighlight(body)), existing ? 200 : 201);
  })
  .patch('/:id', async (c) => {
    const body = await c.req.json<UpdateHighlightRequest>();
    const highlight = await c.var.deps.store.updateHighlight(c.req.param('id'), body.note?.trim() || null);
    return highlight ? c.json(highlight) : c.json({ error: 'Not found' }, 404);
  })
  .delete('/:id', async (c) =>
    (await c.var.deps.store.deleteHighlight(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404),
  );
