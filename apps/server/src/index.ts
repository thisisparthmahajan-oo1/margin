import { serve } from '@hono/node-server';
import os from 'node:os';
import { createApp, lazyDeps } from './app.ts';
import { assertProductionConfig, config } from './config.ts';
import { runInBackground } from './ingest.ts';
import { buildDeps } from './wiring.ts';

assertProductionConfig();

const deps = lazyDeps(() => buildDeps(runInBackground));
const app = createApp({ deps, appToken: config.appToken, apiTokens: config.apiTokens, webDist: config.isProduction ? config.webDist : undefined });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log(`Margin API on http://localhost:${port}${lan ? `  (LAN: http://${lan}:${port})` : ''}`);
  console.log(`MongoDB: ${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')} / ${config.dbName}${config.appToken ? '  · token auth on' : ''}`);
  deps().catch((e) => console.error('MongoDB connection failed:', e.message));
});
