import { isInList, type AlreadySavedResponse, type Bookmark } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { parseApiTokens } from '../src/config.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

// What the Daily Curator relies on: its own token, creating items already filed and explained,
// and never re-saving (and so moving) something that's already in the library.
const ctx = useTestDb();
const CURATOR = 'curator-secret-0123456789';
const store = () => createStore(ctx.c, createMediaStore(ctx.db), null);
const app = () =>
  createApp({
    appToken: 'owner-secret',
    apiTokens: { curator: CURATOR },
    deps: async () => ({ store: store(), media: createMediaStore(ctx.db), files: null, ingestor: { enqueue: () => {} } }),
  });
const send = (token: string, method: string, path: string, body?: unknown) =>
  app().request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });

describe('curator API', () => {
  it('named tokens are accepted on their own, and can’t sign devices in', async () => {
    expect((await send(CURATOR, 'GET', '/api/sync?since=0')).status).toBe(200);
    expect((await send('curator', 'GET', '/api/sync?since=0')).status).toBe(401);
    const signin = await app().request('/api/session/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: CURATOR }),
    });
    expect(signin.status).toBe(401);
  });

  it('creates an item already in a folder, tagged, with a suggestion credited to the token', async () => {
    const folder = await store().createFolder({ name: 'Automated Feed' });
    const tag = await store().createTag({ name: 'AI' });
    const res = await send(CURATOR, 'POST', '/api/bookmarks', {
      url: 'https://example.com/evals',
      folderId: folder.id,
      addTagIds: [tag.id],
      suggestion: { reason: '  Extends the evaluator piece you highlighted.  ' },
      ifNew: true,
    });
    expect(res.status).toBe(201);
    const b = (await res.json()) as Bookmark;
    expect(b.folderId).toBe(folder.id);
    expect(b.tagIds).toEqual([tag.id]);
    expect(b.suggestion).toMatchObject({ by: 'curator', reason: 'Extends the evaluator piece you highlighted.' });
    expect(isInList(b, { kind: 'home' })).toBe(false);
    // Devices get it through sync.
    const sync = await (await send('owner-secret', 'GET', '/api/sync?since=0')).json();
    expect(sync.bookmarks[0].suggestion.by).toBe('curator');
  });

  it('your own suggestions are credited to you', async () => {
    const res = await send('owner-secret', 'POST', '/api/bookmarks', { url: 'https://example.com/a', suggestion: { reason: 'For the team' } });
    expect(((await res.json()) as Bookmark).suggestion?.by).toBe('you');
  });

  it('ifNew never re-saves: 409 with the existing item, which stays where it is', async () => {
    const folder = await store().createFolder({ name: 'Reading' });
    const { bookmark: mine } = await store().saveBookmark({ url: 'https://example.com/x', canonicalUrl: 'https://example.com/x', source: 'web' });
    await store().updateBookmark(mine.id, { folderId: folder.id });
    const before = (await store().getBookmark(mine.id))!;

    const res = await send(CURATOR, 'POST', '/api/bookmarks', { url: 'https://www.example.com/x?utm_source=feed', ifNew: true });
    expect(res.status).toBe(409);
    const body = (await res.json()) as AlreadySavedResponse;
    expect(body.bookmark.id).toBe(mine.id);
    expect(await store().getBookmark(mine.id)).toEqual(before);

    // Without ifNew, saving again still re-saves (moves it to the top of Home), as before.
    expect((await send(CURATOR, 'POST', '/api/bookmarks', { url: 'https://example.com/x' })).status).toBe(200);
    expect((await store().getBookmark(mine.id))!.folderId).toBeNull();
  });

  it('rejects unknown folders and tags, and missing or over-long reasons', async () => {
    const post = (extra: object) => send(CURATOR, 'POST', '/api/bookmarks', { url: 'https://example.com/new', ...extra });
    expect((await post({ folderId: 'nope' })).status).toBe(400);
    expect((await post({ addTagIds: ['nope'] })).status).toBe(400);
    expect((await post({ suggestion: { reason: ' ' } })).status).toBe(400);
    expect((await post({ suggestion: { reason: 'x'.repeat(301) } })).status).toBe(400);
    expect((await post({ suggestion: { reason: 'x'.repeat(300) } })).status).toBe(201);
  });

  it('API_TOKENS parses name=secret pairs and refuses weak or malformed ones', () => {
    expect(parseApiTokens('')).toEqual({});
    expect(parseApiTokens(` curator=${CURATOR} , other=${CURATOR}x`)).toEqual({ curator: CURATOR, other: `${CURATOR}x` });
    expect(() => parseApiTokens('curator=short')).toThrow();
    expect(() => parseApiTokens(CURATOR)).toThrow();
  });
});
