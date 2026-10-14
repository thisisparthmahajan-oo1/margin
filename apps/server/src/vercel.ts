import { waitUntil } from '@vercel/functions';
import { getRequestListener } from '@hono/node-server';
import { createApp, lazyDeps } from './app.ts';
import { assertProductionConfig, config } from './config.ts';
import { buildDeps } from './wiring.ts';

assertProductionConfig();

// Node.js runtime (the MongoDB driver needs it). Article downloads continue after the response via waitUntil (bounded by the function's maxDuration).
const app = createApp({ deps: lazyDeps(() => buildDeps(waitUntil)), appToken: config.appToken, apiTokens: config.apiTokens });

/** Node.js (req, res) handler, as Vercel's Node launcher expects. */
export default getRequestListener(app.fetch);
