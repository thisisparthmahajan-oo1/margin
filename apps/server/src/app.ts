import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { except } from 'hono/combine';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import fs from 'node:fs';
import path from 'node:path';
import type { SessionResponse, SignInRequest } from '@margin/shared';
import type { AppEnv, Deps } from './deps.ts';
import { bookmarkRoutes } from './routes/bookmarks.ts';
import { folderRoutes } from './routes/folders.ts';
import { highlightRoutes } from './routes/highlights.ts';
import { mediaRoutes } from './routes/media.ts';
import { searchRoutes } from './routes/search.ts';
import { syncRoutes } from './routes/sync.ts';
import { createSession, isValidSession, safeEqual } from './session.ts';

/**
 * Reachable without credentials: health checks, images (unguessable content-hash names, loaded by
 * <img>), and signing in. Everything else needs `Authorization: Bearer <session or APP_TOKEN>`.
 */
const PUBLIC_API = ['/api/health', '/api/media/*', '/api/session/signin'];

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

  const appToken = opts.appToken;
  if (appToken) {
    app.use(
      '/api/*',
      except(PUBLIC_API, async (c, next) => {
        const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
        // Devices send a session; scripts and tools may send APP_TOKEN itself.
        if (isValidSession(appToken, bearer) || safeEqual(bearer, appToken)) return next();
        return c.json({ error: 'Sign in again' }, 401);
      }),
    );
  }

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Sign in: trade APP_TOKEN for a device session valid for 30 days. No DB access.
  app.post('/api/session/signin', async (c) => {
    if (!appToken) return c.json<SessionResponse>({ session: null, expiresAt: null });
    const { token } = await c.req.json<SignInRequest>().catch(() => ({ token: '' }));
    if (!token || !safeEqual(token.trim(), appToken)) return c.json({ error: 'That token doesn’t match the server' }, 401);
    return c.json<SessionResponse>(createSession(appToken));
  });
  // Behind auth: 200 means the current credentials are still accepted.
  app.get('/api/session', (c) => c.json({ ok: true }));

  // Behind auth: is the database reachable? Reports the config in use and the driver's error, never credentials.
  app.get('/api/status', async (c) => {
    const uri = process.env.MONGODB_URI;
    const host = (uri ?? 'mongodb://127.0.0.1:27017 (default: MONGODB_URI not set)').replace(/\/\/[^@/]*@/, '//***@');
    try {
      await opts.deps();
      return c.json({ db: 'ok', mongodbUriSet: Boolean(uri), host });
    } catch (e) {
      const err = e as Error;
      const message = `${err.name}: ${err.message}`.replace(/\/\/[^@/\s]*@/g, '//***@');
      return c.json({ db: 'error', mongodbUriSet: Boolean(uri), host, error: message.slice(0, 500) }, 503);
    }
  });

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
