import type { CreateFolderRequest, UpdateFolderRequest } from '@margin/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';

export const folderRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const { store } = c.var.deps;
    const body = await c.req.json<CreateFolderRequest>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'Folder name is required' }, 400);
    const existing = body.id ? await store.getFolder(body.id) : null;
    return c.json(existing ?? (await store.createFolder({ id: body.id, name })), existing ? 200 : 201);
  })
  .patch('/:id', async (c) => {
    const body = await c.req.json<UpdateFolderRequest>();
    const folder = await c.var.deps.store.updateFolder(c.req.param('id'), {
      name: body.name?.trim() || undefined,
      position: body.position,
    });
    return folder ? c.json(folder) : c.json({ error: 'Not found' }, 404);
  })
  .delete('/:id', async (c) =>
    (await c.var.deps.store.deleteFolder(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404),
  );
