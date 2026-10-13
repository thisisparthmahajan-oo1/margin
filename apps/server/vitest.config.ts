import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // sanitize-html require()s the ESM-only htmlparser2. Node enables require(esm) by default from 22.12;
    // earlier 22.x need the flag. (The dev server runs on tsx and production is bundled, so only tests need this.)
    poolOptions: { forks: { execArgv: ['--experimental-require-module', '--no-warnings=ExperimentalWarning'] } },
  },
});
