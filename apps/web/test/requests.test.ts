// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No server in these tests: changes just queue in the outbox.
vi.mock('../src/data/sync.ts', () => ({ syncNow: async () => {} }));
vi.mock('../src/data/api.ts', () => ({ api: async () => Promise.reject(new Error('offline')), ApiRequestError: Error }));

const { db } = await import('../src/data/db.ts');
const { createRequest, deleteBookmark, deleteRequest, saveUrl, setRequestStatus, updateRequestText } = await import(
  '../src/data/actions.ts'
);
const { openRequestBookmarkIds, requestPreview } = await import('../src/data/queries.ts');

const anchor = { exact: 'the paging part', prefix: 'but not ', suffix: '.' };
const ops = async () => (await db.outbox.toArray()).map((e) => e.op);

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.requests.clear(), db.highlights.clear(), db.outbox.clear()]);
});

describe('requests on the device', () => {
  it('asks from a passage: saved here at once, open, for the curator, and queued for the server', async () => {
    const article = (await saveUrl('https://a.com'))!;
    const id = await createRequest('Explain the paging part', { bookmarkId: article, anchor });
    expect(await db.requests.get(id)).toMatchObject({
      text: 'Explain the paging part',
      for: 'curator',
      bookmarkId: article,
      anchor,
      status: 'open',
      reply: null,
      answers: [],
    });
    expect((await ops()).at(-1)).toEqual({
      type: 'request.create',
      id,
      text: 'Explain the paging part',
      bookmarkId: article,
      anchor,
      for: 'curator',
    });
  });

  it('asks without an article', async () => {
    const id = await createRequest('Find me a hands-on guide to semantic VAD');
    expect(await db.requests.get(id)).toMatchObject({ bookmarkId: null, anchor: null });
  });

  it('edits, completes, reopens and deletes, queuing one change each', async () => {
    const id = await createRequest('Is this available now?');
    await updateRequestText(id, 'Is it available in India?');
    await setRequestStatus(id, 'completed');
    expect(await db.requests.get(id)).toMatchObject({ text: 'Is it available in India?', status: 'completed', completedAt: expect.any(Number) });
    await setRequestStatus(id, 'open');
    expect(await db.requests.get(id)).toMatchObject({ status: 'open', completedAt: null });
    await deleteRequest(id);
    expect(await db.requests.get(id)).toBeUndefined();
    expect((await ops()).slice(1)).toEqual([
      { type: 'request.update', id, change: { text: 'Is it available in India?' } },
      { type: 'request.update', id, change: { status: 'completed' } },
      { type: 'request.update', id, change: { status: 'open' } },
      { type: 'request.delete', id },
    ]);
  });

  it('deleting the article keeps its requests', async () => {
    const article = (await saveUrl('https://a.com'))!;
    const id = await createRequest('Explain this', { bookmarkId: article, anchor });
    await deleteBookmark(article);
    expect(await db.requests.get(id)).toMatchObject({ bookmarkId: article });
  });

  it('marks only articles with an open request', async () => {
    const [a, b] = [(await saveUrl('https://a.com'))!, (await saveUrl('https://b.com'))!];
    await createRequest('Open one', { bookmarkId: a, anchor });
    await setRequestStatus(await createRequest('Done one', { bookmarkId: b, anchor }), 'completed');
    await createRequest('Not about an article');
    expect(await openRequestBookmarkIds()).toEqual(new Set([a]));
  });

  it('names a request by its first words', () => {
    expect(requestPreview('More on this, a hands-on guide please if one exists', 5)).toBe('More on this, a hands-on…');
    expect(requestPreview('  Is this available now?  ')).toBe('Is this available now?');
  });
});
