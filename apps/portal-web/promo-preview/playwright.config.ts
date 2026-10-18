import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import base from '../../../playwright.config';

// Retain the normal isolated-schema/auth fixtures; no production DB defaults
// are added here. The API server only supports the shared fixture lifecycle.
const inherited = base.webServer ? Array.isArray(base.webServer) ? base.webServer : [base.webServer] : [];
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'preview.spec.ts',
  outputDir: fileURLToPath(new URL('../../../test-results/promotional-preview', import.meta.url)),
  use: {...base.use, baseURL: 'http://127.0.0.1:4492'},
  webServer: [...inherited.map(server => ({...server, cwd: repositoryRoot})), {
    command: 'node node_modules/vite/bin/vite.js preview --config apps/portal-web/promo-preview/vite.config.ts',
    cwd: repositoryRoot,
    url: 'http://127.0.0.1:4492',
    reuseExistingServer: false,
    timeout: 30000,
    gracefulShutdown: {signal: 'SIGTERM', timeout: 15000},
  }],
});
