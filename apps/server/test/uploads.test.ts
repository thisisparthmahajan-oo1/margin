import { createHash } from 'node:crypto';
import { fileKeyFor } from '@margin/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createMemoryFileStore } from '../src/files.ts';
import { createMediaStore } from '../src/media.ts';
import { createStore } from '../src/store.ts';
import { createFileLibrary, UploadRejected } from '../src/uploads.ts';
import { useTestDb } from './mongo.ts';

const ctx = useTestDb();
const setup = (limits = { storageBytes: 100, fileBytes: 80 }) => {
  const files = createMemoryFileStore();
  const store = createStore(ctx.c, createMediaStore(ctx.db), files);
  return { files, store, library: createFileLibrary(store, files, limits) };
};
const pdf = (text: string) => {
  const bytes = Buffer.from(text);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
};

/** prepare -> device PUT -> finish, as a device does it. */
async function upload(s: ReturnType<typeof setup>, text: string, bookmarkId = crypto.randomUUID()) {
  const { bytes, sha256 } = pdf(text);
  const prepared = await s.library.prepare({ bookmarkId, name: 'Paper.pdf', bytes: bytes.length, sha256 });
  if (prepared.status === 'exists') return prepared.bookmark;
  await s.files.put(prepared.key, bytes, 'application/pdf');
  return (await s.library.finish({ bookmarkId, key: prepared.key, name: 'Paper.pdf' })).bookmark;
}

const rejection = (p: Promise<unknown>) => p.then(() => null, (e: UploadRejected) => ({ status: e.status, message: e.message }));

describe('file uploads', () => {
  it('creates a pending PDF item, and finds it again when the same file is added twice', async () => {
    const s = setup();
    const first = await upload(s, 'pdf-one');
    expect(first).toMatchObject({ kind: 'pdf', source: 'upload', status: 'pending', title: 'Paper' });
    expect(first.file).toMatchObject({ key: fileKeyFor(pdf('pdf-one').sha256), bytes: 7, pages: null });

    await s.store.updateBookmark(first.id, { archived: true });
    const again = await upload(s, 'pdf-one');
    expect(again.id).toBe(first.id);
    expect(again.archivedAt).toBeNull(); // back on Home
  });

  it('refuses a file over the per-file limit and anything past the storage limit', async () => {
    const s = setup();
    expect(await rejection(upload(s, 'x'.repeat(81)))).toMatchObject({ status: 413, message: /limit for one file/ });
    await upload(s, 'a'.repeat(60));
    expect(await rejection(upload(s, 'b'.repeat(60)))).toMatchObject({ status: 413, message: /Storage full/ });
    expect(await s.library.storage()).toEqual({ usedBytes: 60, limitBytes: 100, maxFileBytes: 80 });
  });

  it('two uploads at once cannot both get past the limit', async () => {
    const s = setup();
    const results = await Promise.all(
      ['c', 'd'].map((ch) => {
        const { bytes, sha256 } = pdf(ch.repeat(60));
        return rejection(s.library.prepare({ bookmarkId: ch, name: `${ch}.pdf`, bytes: bytes.length, sha256 }));
      }),
    );
    expect(results.filter((r) => r === null).length).toBeLessThanOrEqual(1);
  });

  it('finish rejects a file that never arrived or arrived incomplete', async () => {
    const s = setup();
    const { bytes, sha256 } = pdf('complete-file');
    const prepared = await s.library.prepare({ bookmarkId: 'b1', name: 'a.pdf', bytes: bytes.length, sha256 });
    if (prepared.status !== 'upload') throw new Error('expected upload');
    expect(await rejection(s.library.finish({ bookmarkId: 'b1', key: prepared.key, name: 'a.pdf' }))).toMatchObject({ status: 400 });

    const again = await s.library.prepare({ bookmarkId: 'b2', name: 'a.pdf', bytes: bytes.length, sha256 });
    if (again.status !== 'upload') throw new Error('expected upload');
    await s.files.put(again.key, Buffer.from('short'), 'application/pdf');
    expect(await rejection(s.library.finish({ bookmarkId: 'b2', key: again.key, name: 'a.pdf' }))).toMatchObject({ status: 400 });
    expect(s.files.files.has(again.key)).toBe(false);
    expect(await s.library.storage()).toMatchObject({ usedBytes: 0 });
  });

  it('deleting the item deletes the file; only files that belong to an item can be downloaded', async () => {
    const s = setup();
    const b = await upload(s, 'to-delete');
    expect(await s.library.downloadUrl(b.file!.key)).toContain(b.file!.key);
    expect(await s.library.downloadUrl('files/someone-elses.pdf')).toBeNull();
    await s.store.deleteBookmark(b.id);
    expect(s.files.files.size).toBe(0);
    expect(await s.library.downloadUrl(b.file!.key)).toBeNull();
  });

  it('cleans up uploads that were never finished', async () => {
    const s = setup();
    const { bytes, sha256 } = pdf('abandoned');
    const prepared = await s.library.prepare({ bookmarkId: 'b', name: 'a.pdf', bytes: bytes.length, sha256 });
    if (prepared.status !== 'upload') throw new Error('expected upload');
    await s.files.put(prepared.key, bytes, 'application/pdf');
    await ctx.c.uploads.updateOne({ _id: prepared.key }, { $set: { createdAt: Date.now() - 2 * 60 * 60_000 } });

    await s.store.cleanUpAbandonedUploads();
    expect(s.files.files.size).toBe(0);
    expect(await s.library.storage()).toMatchObject({ usedBytes: 0 });
  });

  it('API: storage-full is a 413 with the message; no file storage is a 501', async () => {
    const s = setup({ storageBytes: 10, fileBytes: 10 });
    const deps = (files: typeof s.library | null) => async () => ({
      store: s.store, media: createMediaStore(ctx.db), files, ingestor: { enqueue: () => {} },
    });
    const body = JSON.stringify({ bookmarkId: 'b', name: 'big.pdf', bytes: 50, sha256: 'a'.repeat(64) });
    const post = (files: typeof s.library | null) =>
      createApp({ appToken: null, deps: deps(files) }).request('/api/files/prepare', {
        method: 'POST', body, headers: { 'content-type': 'application/json' },
      });

    const full = await post(s.library);
    expect(full.status).toBe(413);
    expect((await full.json()).error).toMatch(/limit for one file/);
    expect((await post(null)).status).toBe(501);
  });
});
