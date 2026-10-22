import type { Bookmark, CuratorRequest, SyncResponse } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

// Requests: you ask, the agent a request is addressed to answers, and only you close it.
const ctx = useTestDb();
const OWNER = 'owner-secret';
const CURATOR = 'curator-secret-0123456789';
const SCOUT = 'scout-secret-0123456789ab';
const store = () => createStore(ctx.c, createMediaStore(ctx.db), null);
const app = () =>
  createApp({
    appToken: OWNER,
    apiTokens: { curator: CURATOR, scout: SCOUT },
    deps: async () => ({ store: store(), media: createMediaStore(ctx.db), files: null, ingestor: { enqueue: () => {} } }),
  });
const send = (token: string, method: string, path: string, body?: unknown) =>
  app().request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

const anchor = { exact: 'the paging part', prefix: 'I get most of this but not ', suffix: '.' };
const saveItem = async (url = 'https://example.com/a') => (await store().saveBookmark({
  url,
  canonicalUrl: url,
  source: 'web',
  folderId: null,
  tagIds: [],
  suggestion: null,
  ifNew: false,
})).bookmark;
const ask = async (body: Record<string, unknown> = { text: 'Find me a hands-on guide to semantic VAD' }) => {
  const res = await send(OWNER, 'POST', '/api/requests', body);
  expect(res.status).toBe(201);
  return (await res.json()) as CuratorRequest;
};
const sync = () => json<SyncResponse>(send(OWNER, 'GET', '/api/sync?since=0'));

describe('requests: what you can do', () => {
  it('asks from a passage, addressed to the curator by default', async () => {
    const article = await saveItem();
    const r = await ask({ id: 'r1', text: '  Explain the paging part  ', bookmarkId: article.id, anchor });
    expect(r).toMatchObject({
      id: 'r1',
      text: 'Explain the paging part',
      for: 'curator',
      bookmarkId: article.id,
      anchor,
      status: 'open',
      completedAt: null,
      reply: null,
      answers: [],
    });
    // The same id again (an outbox retry) returns the request instead of making another.
    const again = await send(OWNER, 'POST', '/api/requests', { id: 'r1', text: 'Explain the paging part' });
    expect(again.status).toBe(200);
    expect((await sync()).requests.map((x) => x.id)).toEqual(['r1']);
  });

  it('edits, completes, reopens and deletes, and each change syncs', async () => {
    const r = await ask();
    const edited = await json<CuratorRequest>(send(OWNER, 'PATCH', `/api/requests/${r.id}`, { text: 'Any semantic VAD guide' }));
    expect(edited.text).toBe('Any semantic VAD guide');
    expect(edited.updatedAt).toBeGreaterThanOrEqual(r.updatedAt);

    const done = await json<CuratorRequest>(send(OWNER, 'PATCH', `/api/requests/${r.id}`, { status: 'completed' }));
    expect(done.status).toBe('completed');
    expect(done.completedAt).toEqual(expect.any(Number));
    const reopened = await json<CuratorRequest>(send(OWNER, 'PATCH', `/api/requests/${r.id}`, { status: 'open' }));
    expect(reopened).toMatchObject({ status: 'open', completedAt: null });

    expect((await send(OWNER, 'DELETE', `/api/requests/${r.id}`)).status).toBe(204);
    const s = await sync();
    expect(s.requests).toEqual([]);
    expect(s.deletions).toContainEqual(expect.objectContaining({ entity: 'request', id: r.id }));
  });

  it('validates text, status, the agent and the article', async () => {
    expect((await send(OWNER, 'POST', '/api/requests', { text: '   ' })).status).toBe(400);
    expect((await send(OWNER, 'POST', '/api/requests', { text: 'x'.repeat(1001) })).status).toBe(400);
    expect((await send(OWNER, 'POST', '/api/requests', { text: 'x'.repeat(1000) })).status).toBe(201);
    expect((await send(OWNER, 'POST', '/api/requests', { text: 'Hi', for: 'nobody' })).status).toBe(400);
    expect((await send(OWNER, 'POST', '/api/requests', { text: 'Hi', bookmarkId: 'missing' })).status).toBe(400);
    expect((await send(OWNER, 'POST', '/api/requests', { text: 'Hi', anchor })).status).toBe(400); // passage without article
    const r = await ask();
    expect((await send(OWNER, 'PATCH', `/api/requests/${r.id}`, { status: 'done' })).status).toBe(400);
    expect((await send(OWNER, 'PATCH', `/api/requests/${r.id}`, { text: 'a', status: 'completed' })).status).toBe(400);
    expect((await send(OWNER, 'PATCH', '/api/requests/missing', { text: 'a' })).status).toBe(404);
  });

  it('can address another agent', async () => {
    expect((await ask({ text: 'Track this company', for: 'scout' })).for).toBe('scout');
  });
});

describe('requests: what the agent can do', () => {
  it('replies and links answers, including items already in the library, once each and in order', async () => {
    const r = await ask();
    const first = await saveItem('https://example.com/vad-docs');
    const second = await saveItem('https://example.com/vad-blog');

    const replied = await json<CuratorRequest>(
      send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { reply: '  Added 2 docs; nothing hands-on yet, still looking  ' }),
    );
    expect(replied.reply).toEqual({ text: 'Added 2 docs; nothing hands-on yet, still looking', updatedAt: expect.any(Number) });

    for (const id of [first.id, second.id, first.id]) {
      expect((await send(CURATOR, 'POST', `/api/requests/${r.id}/answers`, { bookmarkId: id })).status).toBe(200);
    }
    const [synced] = (await sync()).requests;
    expect(synced!.answers.map((a) => a.bookmarkId)).toEqual([first.id, second.id]);
    expect(synced!.status).toBe('open'); // answering never closes it
  });

  it('can’t create, edit, complete or delete requests', async () => {
    const r = await ask();
    expect((await send(CURATOR, 'POST', '/api/requests', { text: 'Hi' })).status).toBe(403);
    expect((await send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { text: 'Changed' })).status).toBe(403);
    expect((await send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { status: 'completed' })).status).toBe(403);
    expect((await send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { reply: 'Done', status: 'completed' })).status).toBe(403);
    expect((await send(CURATOR, 'DELETE', `/api/requests/${r.id}`)).status).toBe(403);
    expect((await sync()).requests[0]).toMatchObject({ text: r.text, status: 'open' });
  });

  it('you can’t write the agent’s reply or answers', async () => {
    const r = await ask();
    const item = await saveItem();
    expect((await send(OWNER, 'PATCH', `/api/requests/${r.id}`, { reply: 'Done' })).status).toBe(403);
    expect((await send(OWNER, 'POST', `/api/requests/${r.id}/answers`, { bookmarkId: item.id })).status).toBe(403);
    const res = await send(OWNER, 'POST', '/api/bookmarks', { url: 'https://example.com/b', suggestion: { reason: 'Mine', requestId: r.id } });
    expect(res.status).toBe(403);
  });

  it('another agent gets 403 on a request not addressed to it', async () => {
    const r = await ask(); // for: curator
    const item = await saveItem();
    expect((await send(SCOUT, 'PATCH', `/api/requests/${r.id}`, { reply: 'Mine now' })).status).toBe(403);
    expect((await send(SCOUT, 'POST', `/api/requests/${r.id}/answers`, { bookmarkId: item.id })).status).toBe(403);
    const res = await send(SCOUT, 'POST', '/api/bookmarks', { url: 'https://example.com/b', suggestion: { reason: 'R', requestId: r.id } });
    expect(res.status).toBe(403);
    expect((await sync()).bookmarks.map((b) => b.url)).toEqual([item.url]); // nothing saved
  });

  it('a completed request takes no new answers, by either route, and nothing is saved', async () => {
    const r = await ask();
    const item = await saveItem();
    await send(OWNER, 'PATCH', `/api/requests/${r.id}`, { status: 'completed' });
    expect((await send(CURATOR, 'POST', `/api/requests/${r.id}/answers`, { bookmarkId: item.id })).status).toBe(409);
    const res = await send(CURATOR, 'POST', '/api/bookmarks', {
      url: 'https://example.com/late',
      suggestion: { reason: 'Late', requestId: r.id },
      ifNew: true,
    });
    expect(res.status).toBe(409);
    const s = await sync();
    expect(s.requests[0]!.answers).toEqual([]);
    expect(s.bookmarks.map((b) => b.url)).toEqual([item.url]);
    // It still takes a reply (e.g. "closed, thanks").
    expect((await send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { reply: 'Noted.' })).status).toBe(200);
  });

  it('validates answers and replies', async () => {
    const r = await ask();
    expect((await send(CURATOR, 'POST', `/api/requests/${r.id}/answers`, { bookmarkId: 'missing' })).status).toBe(400);
    expect((await send(CURATOR, 'POST', '/api/requests/missing/answers', { bookmarkId: 'x' })).status).toBe(404);
    expect((await send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { reply: 'x'.repeat(301) })).status).toBe(400);
    expect((await send(CURATOR, 'PATCH', `/api/requests/${r.id}`, { reply: 'x'.repeat(300) })).status).toBe(200);
  });
});

describe('requests: answering by saving', () => {
  it('a new suggestion with a requestId is linked as an answer and remembers the request', async () => {
    const r = await ask();
    const res = await send(CURATOR, 'POST', '/api/bookmarks', {
      url: 'https://example.com/guide',
      suggestion: { reason: 'A hands-on guide', requestId: r.id },
      ifNew: true,
    });
    expect(res.status).toBe(201);
    const b = (await res.json()) as Bookmark;
    expect(b.suggestion).toMatchObject({ by: 'curator', reason: 'A hands-on guide', requestId: r.id });
    expect((await sync()).requests[0]!.answers).toEqual([{ bookmarkId: b.id, addedAt: expect.any(Number) }]);
  });

  it('on the ifNew 409 nothing is linked; the agent links the existing item itself', async () => {
    const r = await ask();
    const existing = await saveItem('https://example.com/guide');
    const res = await send(CURATOR, 'POST', '/api/bookmarks', {
      url: 'https://example.com/guide',
      suggestion: { reason: 'A hands-on guide', requestId: r.id },
      ifNew: true,
    });
    expect(res.status).toBe(409);
    expect((await sync()).requests[0]!.answers).toEqual([]);
    expect((await send(CURATOR, 'POST', `/api/requests/${r.id}/answers`, { bookmarkId: existing.id })).status).toBe(200);
    expect((await sync()).requests[0]!.answers.map((a) => a.bookmarkId)).toEqual([existing.id]);
  });

  it('an unknown requestId is a 400 and saves nothing', async () => {
    const res = await send(CURATOR, 'POST', '/api/bookmarks', { url: 'https://example.com/x', suggestion: { reason: 'R', requestId: 'missing' } });
    expect(res.status).toBe(400);
    expect((await sync()).bookmarks).toEqual([]);
  });

  it('deleting the article a request was asked from keeps the request', async () => {
    const article = await saveItem();
    const r = await ask({ text: 'Explain the paging part', bookmarkId: article.id, anchor });
    expect((await send(OWNER, 'DELETE', `/api/bookmarks/${article.id}`)).status).toBe(204);
    expect((await sync()).requests).toEqual([expect.objectContaining({ id: r.id, bookmarkId: article.id, anchor })]);
  });
});
