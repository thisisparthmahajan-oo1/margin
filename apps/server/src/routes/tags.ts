import type { CreateTagRequest, UpdateTagRequest } from '@margin/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';

const MAX_NAME = 60;
const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : '');

export const tagRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const { store } = c.var.deps;
    const body = await c.req.json<CreateTagRequest>();
    const name = cleanName(body.name);
    if (!name) return c.json({ error: 'Tag name is required' }, 400);
    const existing = body.id ? await store.getTag(body.id) : null;
    return c.json(existing ?? (await store.createTag({ id: body.id, name })), existing ? 200 : 201);
  })
  .patch('/:id', async (c) => {
    const name = cleanName((await c.req.json<UpdateTagRequest>()).name);
    if (!name) return c.json({ error: 'Tag name is required' }, 400);
    const tag = await c.var.deps.store.renameTag(c.req.param('id'), name);
    if (tag === 'taken') return c.json({ error: `There’s already a tag called “${name}”` }, 409);
    return tag ? c.json(tag) : c.json({ error: 'Not found' }, 404);
  })
  .delete('/:id', async (c) =>
    (await c.var.deps.store.deleteTag(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404),
  );
