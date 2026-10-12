// Produces a Vercel Build Output API v3 bundle in .vercel/output:
//   static/        the PWA (same origin as the API)
//   functions/api  the whole API as one Node.js function (esbuild bundle)
// Spec: https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const fn = path.join(out, 'functions/api.func');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });

// 1. PWA, talking to the API on its own origin.
execSync('npm -w @margin/web run build', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_API_URL: '' } });
fs.cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });

// 2. API function.
await build({
  entryPoints: [path.join(root, 'apps/server/src/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  // Optional MongoDB driver add-ons we don't use (Kerberos, client-side encryption, compression, AWS auth).
  external: [
    'kerberos', '@mongodb-js/zstd', 'snappy', 'mongodb-client-encryption', '@aws-sdk/credential-providers',
    'gcp-metadata', 'socks', 'aws4',
  ],
  logLevel: 'warning',
});
fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

// 3. Routing: API -> function, then static files, then SPA fallback.
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/sw\\.js', headers: { 'cache-control': 'no-cache' }, continue: true },
        { src: '/api/(.*)', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log(`Vercel output ready: ${path.relative(root, out)}`);
