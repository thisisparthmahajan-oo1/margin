import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The R2 account id, also accepted as the full endpoint Cloudflare shows (`https://<id>.r2.cloudflarestorage.com`). */
const r2AccountId = (value: string) => value.trim().match(/^(?:https?:\/\/)?([0-9a-f]{32})(?:\.r2\.cloudflarestorage\.com)?\/?$/i)?.[1] ?? value.trim();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
  dbName: process.env.DB_NAME ?? 'margin',
  /** When set, every non-public /api request must send `Authorization: Bearer <token>`. Required in production. */
  appToken: process.env.APP_TOKEN || null,
  /** Built PWA, served by the local Node server in production mode (Vercel serves it statically). */
  webDist: path.join(repoRoot, 'apps/web/dist'),
  isProduction,
  /** Cloudflare R2 for original files (PDFs). Without it, file uploads are switched off. */
  r2:
    process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET
      ? {
          accountId: r2AccountId(process.env.R2_ACCOUNT_ID),
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
          bucket: process.env.R2_BUCKET,
        }
      : null,
  fileLimits: {
    /** Hard cap on everything stored in R2; uploads past it are refused. */
    storageBytes: Number(process.env.FILE_STORAGE_LIMIT_GB ?? 5) * 1024 ** 3,
    fileBytes: Number(process.env.FILE_MAX_MB ?? 100) * 1024 ** 2,
  },
};

export function assertProductionConfig() {
  if (config.isProduction && !config.appToken) {
    throw new Error('APP_TOKEN must be set in production; the API would otherwise be open to anyone.');
  }
}
