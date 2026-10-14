import {
  RELEVANCE_VALUES,
  SUGGESTION_REASON_MAX,
  type AlreadySavedResponse,
  type CreateBookmarkRequest,
  type Suggestion,
  type UpdateBookmarkRequest,
} from '@margin/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import type { Store } from '../store.ts';
import { extractorFor } from '../extractors/index.ts';
import { canonicalize, parseUserUrl } from '../url.ts';

export const bookmarkRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const { store, ingestor } = c.var.deps;
    const body = await c.req.json<CreateBookmarkRequest>();
    const url = parseUserUrl(body.url ?? '');
    if (!url) return c.json({ error: 'That doesn’t look like a web address' }, 400);
    const invalid = await invalidPlacement(store, body.folderId, body.addTagIds);
    if (invalid) return c.json({ error: invalid }, 400);
    let suggestion: Suggestion | null = null;
    if (body.suggestion) {
      const reason = body.suggestion.reason?.trim() ?? '';
      if (!reason || reason.length > SUGGESTION_REASON_MAX) {
        return c.json({ error: `A suggestion needs a reason of 1–${SUGGESTION_REASON_MAX} characters` }, 400);
      }
      suggestion = { by: c.var.caller, reason, at: Date.now() };
    }
    const { bookmark, created } = await store.saveBookmark({
      id: body.id,
      url: url.href,
      canonicalUrl: canonicalize(url),
      source: extractorFor(url).source,
      folderId: body.folderId ?? null,
      tagIds: [...new Set(body.addTagIds ?? [])],
      suggestion,
      ifNew: body.ifNew === true,
    });
    if (!created && body.ifNew) return c.json<AlreadySavedResponse>({ error: 'Already saved', bookmark }, 409);
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
    const invalid = await invalidPlacement(store, patch.folderId, patch.addTagIds);
    if (invalid) return c.json({ error: invalid }, 400);
    if (patch.relevance != null && !RELEVANCE_VALUES.includes(patch.relevance)) {
      return c.json({ error: `relevance must be ${RELEVANCE_VALUES.join(', ')} or null` }, 400);
    }
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

/** Why a folder or tags can't be applied (they don't exist), or null when they can. */
async function invalidPlacement(store: Store, folderId: string | null | undefined, tagIds: string[] | undefined) {
  if (folderId && !(await store.getFolder(folderId))) return 'Unknown folder';
  if (tagIds?.length && !(await store.tagsExist(tagIds))) return 'Unknown tag';
  return null;
}
