import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
};

export function assertProductionConfig() {
  if (config.isProduction && !config.appToken) {
    throw new Error('APP_TOKEN must be set in production; the API would otherwise be open to anyone.');
  }
}
