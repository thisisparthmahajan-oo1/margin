import {
  DEFAULT_REQUEST_AGENT,
  REQUEST_REPLY_MAX,
  REQUEST_STATUSES,
  REQUEST_TEXT_MAX,
  type AddAnswerRequest,
  type CreateRequestRequest,
  type CuratorRequest,
  type RequestStatus,
  type TextQuoteAnchor,
} from '@margin/shared';
import { Hono, type Context } from 'hono';
import { isOwner, type AppEnv } from '../deps.ts';
import type { Store } from '../store.ts';

/**
 * Requests: you ask an agent (an API token) for something; it links answers and keeps a status line.
 * You create, edit, complete, reopen and delete them. The agent a request is addressed to (`for`)
 * may only reply and link answers. Everyone else gets 403.
 */
export const requestRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    if (!isOwner(c)) return c.json({ error: 'Only you can ask for something' }, 403);
    const { store } = c.var.deps;
    const body = await c.req.json<CreateRequestRequest>();
    const text = cleanText(body.text, REQUEST_TEXT_MAX);
    if (!text) return c.json({ error: `A request needs text of 1–${REQUEST_TEXT_MAX} characters` }, 400);
    const agent = body.for ?? DEFAULT_REQUEST_AGENT;
    if (!c.var.agents.includes(agent)) return c.json({ error: `No API token is called “${agent}”` }, 400);
    const anchor = body.anchor ?? null;
    if (anchor && !validAnchor(anchor)) return c.json({ error: 'The passage is missing' }, 400);
    const bookmarkId = body.bookmarkId ?? null;
    if (anchor && !bookmarkId) return c.json({ error: 'A passage needs its article' }, 400);
    if (bookmarkId && !(await store.getBookmark(bookmarkId))) return c.json({ error: 'Unknown article' }, 400);
    const { request, created } = await store.createRequest({ id: body.id, text, for: agent, bookmarkId, anchor });
    return c.json(request, created ? 201 : 200);
  })
  .patch('/:id', async (c) => {
    const { store } = c.var.deps;
    const body = await c.req.json<Record<string, unknown>>();
    const fields = (['text', 'status', 'reply'] as const).filter((k) => k in body);
    const allowed: readonly string[] = isOwner(c) ? ['text', 'status'] : ['reply'];
    if (fields.some((f) => !allowed.includes(f))) {
      return c.json({ error: isOwner(c) ? 'Only the agent writes its reply' : 'Only the person who asked can change that' }, 403);
    }
    if (fields.length !== 1) return c.json({ error: `Send one of: ${allowed.join(', ')}` }, 400);

    if (!isOwner(c)) {
      const denied = await agentDenied(c, store, c.req.param('id'));
      if (denied) return denied;
    }
    let change: { text: string } | { status: RequestStatus } | { reply: string };
    if ('text' in body) {
      const text = cleanText(body.text, REQUEST_TEXT_MAX);
      if (!text) return c.json({ error: `A request needs text of 1–${REQUEST_TEXT_MAX} characters` }, 400);
      change = { text };
    } else if ('status' in body) {
      if (!REQUEST_STATUSES.includes(body.status as RequestStatus)) {
        return c.json({ error: `status must be ${REQUEST_STATUSES.join(' or ')}` }, 400);
      }
      change = { status: body.status as RequestStatus };
    } else {
      const reply = cleanText(body.reply, REQUEST_REPLY_MAX);
      if (!reply) return c.json({ error: `A reply needs 1–${REQUEST_REPLY_MAX} characters` }, 400);
      change = { reply };
    }
    const request = await store.updateRequest(c.req.param('id'), change);
    return request ? c.json(request) : c.json({ error: 'Not found' }, 404);
  })
  .delete('/:id', async (c) => {
    if (!isOwner(c)) return c.json({ error: 'Only the person who asked can delete it' }, 403);
    return (await c.var.deps.store.deleteRequest(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
  })
  .post('/:id/answers', async (c) => {
    const { store } = c.var.deps;
    const id = c.req.param('id');
    const denied = await answerDenied(c, store, id);
    if (denied) return denied;
    const { bookmarkId } = await c.req.json<AddAnswerRequest>();
    if (!bookmarkId || !(await store.getBookmark(bookmarkId))) return c.json({ error: 'Unknown article' }, 400);
    const request = await store.addAnswer(id, bookmarkId);
    if (request === 'completed') return c.json({ error: 'This request is completed' }, 409);
    return request ? c.json(request) : c.json({ error: 'Not found' }, 404);
  });

/** Why the caller can't link an answer to this request (as a response), or null when it can. */
export async function answerDenied(c: Context<AppEnv>, store: Store, id: string) {
  if (isOwner(c)) return c.json({ error: 'Answers come from the agent you asked' }, 403);
  const denied = await agentDenied(c, store, id);
  if (denied) return denied;
  const request = (await store.getRequest(id)) as CuratorRequest;
  return request.status === 'open' ? null : c.json({ error: 'This request is completed' }, 409);
}

/** 404 for a request that doesn't exist, 403 when it isn't addressed to the calling token. */
async function agentDenied(c: Context<AppEnv>, store: Store, id: string) {
  const request = await store.getRequest(id);
  if (!request) return c.json({ error: 'Not found' }, 404);
  return request.for === c.var.caller ? null : c.json({ error: 'This request isn’t addressed to you' }, 403);
}

function cleanText(value: unknown, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
}

const validAnchor = (a: TextQuoteAnchor) =>
  typeof a.exact === 'string' && a.exact.trim() !== '' && typeof a.prefix === 'string' && typeof a.suffix === 'string';
