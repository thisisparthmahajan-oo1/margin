// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';

const calls: [string, string, unknown][] = [];
vi.mock('../src/data/api.ts', () => ({
  api: async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body]);
    if (path.startsWith('/api/sync')) return { cursor: 0, more: false, reset: false, bookmarks: [], folders: [], highlights: [], tags: [], requests: [], deletions: [] };
    return { id: 'f1', name: 'Renamed', position: 0, customOrder: false, createdAt: 0, updatedAt: 0 };
  },
  ApiRequestError: class extends Error {},
  NetworkError: class extends Error {},
}));

const { db } = await import('../src/data/db.ts');
const { syncNow } = await import('../src/data/sync.ts');

it('a rename queued by an older version (a name, no patch) still reaches the server', async () => {
  await db.outbox.add({ op: { type: 'folder.update', id: 'f1', name: 'Renamed' } });
  await db.outbox.add({ op: { type: 'folder.update', id: 'f1', patch: { customOrder: true } } });
  await syncNow();
  expect(calls.filter(([m]) => m === 'PATCH')).toEqual([
    ['PATCH', '/api/folders/f1', { name: 'Renamed' }],
    ['PATCH', '/api/folders/f1', { customOrder: true }],
  ]);
});
