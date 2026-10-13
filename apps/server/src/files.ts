import { AwsClient } from 'aws4fetch';

/**
 * Original files (PDFs), kept outside MongoDB because they're large. Keys are content-addressed
 * (`files/<sha256>.pdf`). Devices upload and download directly with short-lived signed URLs, so
 * big files never pass through the API (Vercel caps request bodies at 4.5 MB).
 */
export interface FileStore {
  /** URL a device can PUT a file of `contentType` to, for a few minutes. The size is checked afterwards (`size`). */
  presignPut(key: string, contentType: string): Promise<string>;
  /** URL a device can GET the file from, for a few minutes. */
  presignGet(key: string): Promise<string>;
  /** Size of a stored file, or null if it isn't there. */
  size(key: string): Promise<number | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Missing files are ignored. */
  remove(key: string): Promise<void>;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const SIGNED_URL_SECONDS = 600;

/** Cloudflare R2 through its S3-compatible API, signed with aws4fetch (small enough for serverless). */
export function createR2FileStore(cfg: R2Config): FileStore {
  const aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto' });
  const objectUrl = (key: string) => `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`;

  const presign = async (key: string, method: 'GET' | 'PUT', headers: Record<string, string> = {}) => {
    const url = new URL(objectUrl(key));
    url.searchParams.set('X-Amz-Expires', String(SIGNED_URL_SECONDS));
    const signed = await aws.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
    return signed.url;
  };

  const request = async (key: string, init: RequestInit & { method: string }) => {
    const res = await aws.fetch(objectUrl(key), init);
    if (!res.ok && res.status !== 404) throw new Error(`R2 ${init.method} ${key} failed: HTTP ${res.status}`);
    return res;
  };

  return {
    // Content-Type is signed, so the upload must be the declared type.
    presignPut: (key, contentType) => presign(key, 'PUT', { 'content-type': contentType }),
    presignGet: (key) => presign(key, 'GET'),
    async size(key) {
      const res = await request(key, { method: 'HEAD' });
      return res.status === 404 ? null : Number(res.headers.get('content-length') ?? 0);
    },
    async get(key) {
      const res = await request(key, { method: 'GET' });
      if (res.status === 404) throw new Error(`R2 file missing: ${key}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async put(key, bytes, contentType) {
      await request(key, { method: 'PUT', body: new Uint8Array(bytes), headers: { 'content-type': contentType } });
    },
    async remove(key) {
      await request(key, { method: 'DELETE' });
    },
  };
}

/** In-memory store for tests. */
export function createMemoryFileStore(): FileStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    presignPut: async (key) => `memory://put/${key}`,
    presignGet: async (key) => `memory://get/${key}`,
    size: async (key) => files.get(key)?.length ?? null,
    async get(key) {
      const bytes = files.get(key);
      if (!bytes) throw new Error(`file missing: ${key}`);
      return bytes;
    },
    put: async (key, bytes) => void files.set(key, bytes),
    remove: async (key) => void files.delete(key),
  };
}
