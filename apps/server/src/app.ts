import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { except } from 'hono/combine';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import fs from 'node:fs';
import path from 'node:path';
import type { AppEnv, Deps } from './deps.ts';
import { bookmarkRoutes } from './routes/bookmarks.ts';
import { folderRoutes } from './routes/folders.ts';
import { highlightRoutes } from './routes/highlights.ts';
import { mediaRoutes } from './routes/media.ts';
import { searchRoutes } from './routes/search.ts';
import { syncRoutes } from './routes/sync.ts';

/** Reachable without the token: health checks, and images (unguessable content-hash names, loaded by <img>). */
const PUBLIC_API = ['/api/health', '/api/media/*'];

export interface AppOptions {
  /** Resolves the connected dependencies; called per request, expected to cache. */
  deps: () => Promise<Deps>;
  appToken: string | null;
  /** Serve the built PWA from this directory (local production mode; Vercel serves it statically). */
  webDist?: string;
}

export function createApp(opts: AppOptions) {
  const app = new Hono<AppEnv>();

  // Native apps and the browser extension call the API cross-origin.
  app.use('/api/*', cors());

  if (opts.appToken) app.use('/api/*', except(PUBLIC_API, bearerAuth({ token: opts.appToken })));

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.use('/api/*', async (c, next) => {
    c.set('deps', await opts.deps());
    await next();
  });

  app.route('/api/bookmarks', bookmarkRoutes);
  app.route('/api/folders', folderRoutes);
  app.route('/api/highlights', highlightRoutes);
  app.route('/api/search', searchRoutes);
  app.route('/api/sync', syncRoutes);
  app.route('/api/media', mediaRoutes);

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    const root = path.relative(process.cwd(), opts.webDist);
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' })); // SPA fallback
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse(); // e.g. 401 from bearerAuth
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}

/** Builds the dependency graph once per process / warm instance. */
export function lazyDeps(build: () => Promise<Deps>): () => Promise<Deps> {
  let deps: Promise<Deps> | null = null;
  return () =>
    (deps ??= build().catch((e) => {
      deps = null;
      throw e;
    }));
}
