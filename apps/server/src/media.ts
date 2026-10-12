import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { GridFSBucket, type Db } from 'mongodb';

/** Path clients use to fetch a stored image. */
export const MEDIA_PREFIX = '/api/media/';

/**
 * Article images in GridFS. Files are named by content hash, so the same image saved by
 * several articles (or re-saved) is stored once and the URL never changes.
 */
export function createMediaStore(db: Db) {
  const bucket = new GridFSBucket(db, { bucketName: 'media' });

  return {
    /** Stores the bytes and returns their public path (`/api/media/<hash>.<ext>`). */
    async save(bytes: Buffer, contentType: string, ext: string): Promise<string> {
      const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
      const existing = await bucket.find({ filename }).limit(1).hasNext();
      if (!existing) {
        await new Promise<void>((resolve, reject) => {
          Readable.from(bytes)
            .pipe(bucket.openUploadStream(filename, { metadata: { contentType } }))
            .on('finish', () => resolve())
            .on('error', reject);
        });
      }
      return MEDIA_PREFIX + filename;
    },

    async open(filename: string) {
      const file = await bucket.find({ filename }).limit(1).next();
      if (!file) return null;
      return {
        contentType: (file.metadata?.contentType as string | undefined) ?? 'application/octet-stream',
        length: file.length,
        stream: () => bucket.openDownloadStream(file._id),
      };
    },
  };
}

export type MediaStore = ReturnType<typeof createMediaStore>;
