// @vitest-environment node
import 'fake-indexeddb/auto';
import { fileKeyFor, type Bookmark } from '@margin/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No server in these tests: changes just queue in the outbox.
vi.mock('../src/data/sync.ts', () => ({ syncNow: async () => {} }));
vi.mock('../src/data/api.ts', () => ({ api: async () => Promise.reject(new Error('offline')), ApiRequestError: Error }));

const { db } = await import('../src/data/db.ts');
const { isPdf, pruneFiles, sha256Hex } = await import('../src/data/files.ts');
const { deleteBookmark, savePdf } = await import('../src/data/actions.ts');

const pdfBlob = (body = 'hello') => new Blob([`%PDF-1.4\n${body}`], { type: '' });

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.files.clear(), db.outbox.clear()]);
});

describe('PDFs on the device', () => {
  it('recognises PDFs by content and hashes them the way the server keys them', async () => {
    expect(await isPdf(pdfBlob())).toBe(true);
    expect(await isPdf(new Blob(['<html>'], { type: 'application/pdf' }))).toBe(false);
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('adding a PDF keeps the file here, shows the item at once, and queues the upload', async () => {
    const id = (await savePdf(pdfBlob(), 'Annual_report.pdf'))!;
    const b = (await db.bookmarks.get(id)) as Bookmark;
    const key = fileKeyFor(await sha256Hex(pdfBlob()));
    expect(b).toMatchObject({ kind: 'pdf', source: 'upload', status: 'pending', title: 'Annual report', file: { key, name: 'Annual_report.pdf' } });
    expect(await db.files.get(key)).toBeTruthy();
    expect((await db.outbox.toArray()).map((e) => e.op)).toEqual([
      { type: 'bookmark.upload', id, key, name: 'Annual_report.pdf', bytes: pdfBlob().size },
    ]);
    expect(await savePdf(new Blob(['not a pdf']), 'notes.txt')).toBeNull();
  });

  it('deleting the item removes its file from the device; files other items use stay', async () => {
    const a = (await savePdf(pdfBlob('a'), 'a.pdf'))!;
    await savePdf(pdfBlob('b'), 'b.pdf');
    await db.files.put({ key: 'files/orphan.pdf', blob: pdfBlob('orphan') });
    await pruneFiles();
    expect(await db.files.count()).toBe(2);
    await deleteBookmark(a);
    expect(await db.files.count()).toBe(1);
  });
});
