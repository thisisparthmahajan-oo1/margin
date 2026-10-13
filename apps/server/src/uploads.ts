import { createHash } from 'node:crypto';
import {
  fileKeyFor,
  formatBytes,
  PDF_CONTENT_TYPE,
  uploadUrlFor,
  type Bookmark,
  type FinishUploadRequest,
  type PrepareUploadRequest,
  type PrepareUploadResponse,
  type StorageResponse,
  type StoredFile,
} from '@margin/shared';
import type { FileStore } from './files.ts';
import type { Store } from './store.ts';

export interface FileLimits {
  /** Everything in file storage together. */
  storageBytes: number;
  /** One file. */
  fileBytes: number;
}

/** A refused upload. `status` is the HTTP status; the message is shown to the user as is. */
export class UploadRejected extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Adding files to the library, within the storage limits. Uploading takes three steps so the bytes
 * go straight from the device to file storage:
 *   1. `prepare`: checks the size and the limit, reserves the space, returns a signed upload URL;
 *   2. the device PUTs the file to that URL;
 *   3. `finish`: checks the file arrived with the reserved size, then creates the item.
 * Reserving before checking the total means two uploads at once can't both slip under the limit.
 */
export function createFileLibrary(store: Store, files: FileStore, limits: FileLimits) {
  async function reserve(key: string, bookmarkId: string, bytes: number) {
    if (bytes > limits.fileBytes) {
      throw new UploadRejected(413, `This file is ${formatBytes(bytes)}, more than the ${formatBytes(limits.fileBytes)} limit for one file.`);
    }
    await store.reserveUpload(key, bookmarkId, bytes);
    const used = await store.fileBytesInUse();
    if (used > limits.storageBytes) {
      await store.endUpload(key);
      throw new UploadRejected(
        413,
        `Storage full: ${formatBytes(used - bytes)} of ${formatBytes(limits.storageBytes)} used. Delete some PDFs to save new ones.`,
      );
    }
  }

  return {
    async storage(): Promise<StorageResponse> {
      return { usedBytes: await store.fileBytesInUse(), limitBytes: limits.storageBytes, maxFileBytes: limits.fileBytes };
    },

    async prepare(req: PrepareUploadRequest): Promise<PrepareUploadResponse> {
      if (!SHA256_HEX.test(req.sha256 ?? '') || !(req.bytes > 0) || !req.bookmarkId || !req.name) {
        throw new UploadRejected(400, 'Invalid upload');
      }
      const existing = await store.resave(uploadUrlFor(req.sha256));
      if (existing) return { status: 'exists', bookmark: existing };
      const key = fileKeyFor(req.sha256);
      await reserve(key, req.bookmarkId, req.bytes);
      return { status: 'upload', key, putUrl: await files.presignPut(key, PDF_CONTENT_TYPE) };
    },

    /** Returns the new item, which still has to be processed (`created`). */
    async finish(req: FinishUploadRequest): Promise<{ bookmark: Bookmark; created: boolean }> {
      const upload = await store.getUpload(req.key);
      if (!upload || upload.bookmarkId !== req.bookmarkId) throw new UploadRejected(400, 'This upload expired. Add the file again.');
      const bytes = await files.size(req.key);
      if (bytes !== upload.bytes) {
        await store.endUpload(req.key);
        await store.releaseFile(req.key);
        throw new UploadRejected(400, 'The file didn’t upload completely. Add it again.');
      }
      const sha256 = req.key.match(/^files\/([0-9a-f]{64})\.pdf$/)![1]!;
      const file: StoredFile = { key: req.key, name: req.name, bytes, contentType: PDF_CONTENT_TYPE, pages: null };
      const saved = await store.saveBookmark({
        id: req.bookmarkId,
        url: uploadUrlFor(sha256),
        canonicalUrl: uploadUrlFor(sha256),
        source: 'upload',
        kind: 'pdf',
        title: titleFromFileName(req.name),
        file,
      });
      await store.endUpload(req.key);
      return saved;
    },

    /** Keeps a PDF that a saved link pointed to. The caller ends the reservation once the item is ready. */
    async storeLinkedPdf(bookmarkId: string, bytes: Buffer, name: string): Promise<StoredFile> {
      const key = fileKeyFor(createHash('sha256').update(bytes).digest('hex'));
      await reserve(key, bookmarkId, bytes.length);
      await files.put(key, bytes, PDF_CONTENT_TYPE);
      return { key, name, bytes: bytes.length, contentType: PDF_CONTENT_TYPE, pages: null };
    },

    endUpload: (key: string) => store.endUpload(key),

    read: (key: string) => files.get(key),

    /** Signed download link for a file that belongs to an item; null otherwise. */
    async downloadUrl(key: string): Promise<string | null> {
      return (await store.isFileInUse(key)) ? files.presignGet(key) : null;
    },
  };
}

export type FileLibrary = ReturnType<typeof createFileLibrary>;

export const titleFromFileName = (name: string) => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled PDF';
