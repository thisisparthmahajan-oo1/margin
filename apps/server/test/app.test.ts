import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { useTestDb } from './mongo.ts';

const ctx = useTestDb();
const enqueued: string[] = [];
const app = (appToken: string | null) =>
  createApp({
    appToken,
    deps: async () => ({
      store: createStore(ctx.c),
      media: createMediaStore(ctx.db),
      ingestor: { enqueue: (id: string) => void enqueued.push(id) },
    }),
  });

describe('api', () => {
  it('requires the token except for health and media', async () => {
    const a = app('secret');
    expect((await a.request('/api/health')).status).toBe(200);
    expect((await a.request('/api/sync')).status).toBe(401);
    expect((await a.request('/api/sync', { headers: { authorization: 'Bearer secret' } })).status).toBe(200);
    expect((await a.request('/api/media/missing.png')).status).toBe(404);
  });

  it('saves a URL and queues it for download', async () => {
    const res = await app(null).request('/api/bookmarks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'example.com/post?utm_source=x' }),
    });
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ url: 'https://example.com/post?utm_source=x', canonicalUrl: 'https://example.com/post', status: 'pending' });
    expect(enqueued).toContain(b.id);
  });

  it('serves stored media with immutable caching', async () => {
    const media = createMediaStore(ctx.db);
    const path = await media.save(Buffer.from('png-bytes'), 'image/png', 'png');
    expect(await media.save(Buffer.from('png-bytes'), 'image/png', 'png')).toBe(path); // deduped
    const res = await app('secret').request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe('png-bytes');
  });
});
