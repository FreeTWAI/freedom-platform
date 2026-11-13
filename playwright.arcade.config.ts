import { defineConfig } from '@playwright/test';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import config from './playwright.config';

const dist = process.env.FREEDOM_ARCADE_DIST;
if (!dist?.trim()) {
  throw new Error('FREEDOM_ARCADE_DIST is required: FREEDOM_ARCADE_DIST=/absolute/path/to/guild-games/dist npm run test:e2e:arcade');
}
try {
  accessSync(resolve(dist, 'index.html'), constants.R_OK);
} catch {
  throw new Error('Arcade build missing: FREEDOM_ARCADE_DIST must point to a readable standalone guild-games build containing index.html.');
}

// The default Playwright and hosted CI *.spec.ts discovery excludes this file.
export default defineConfig(config, {
  testMatch: 'guild-tools-arcade.opt-in.ts',
});
