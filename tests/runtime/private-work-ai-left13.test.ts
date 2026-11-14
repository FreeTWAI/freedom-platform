import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const window: any = {
  location: {origin: 'https://fixture.invalid', pathname: '/'},
  setTimeout,
  clearTimeout,
};

const bundled = buildSync({
  stdin: {
    contents: `export {PrivateWorkAI} from './apps/portal-web/src/modules/PrivateWorkAI';`,
    resolveDir: process.cwd(),
    sourcefile: 'private-work-ai-left13-entry.ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  loader: {'.css': 'empty'},
});

const mod = {exports: {} as any};
runInNewContext(bundled.outputFiles[0].text, {
  module: mod,
  exports: mod.exports,
  crypto: webcrypto,
  Intl,
  URL,
  URLSearchParams,
  AbortController,
  Error,
  Event,
  console,
  window,
  document: {},
  navigator: {language: 'zh-TW', languages: ['zh-TW']},
  fetch: () => {throw Error('Real network forbidden');},
  setTimeout,
  clearTimeout,
  require(name: string) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime' || name === 'zod') return require(name);
    throw Error(name);
  },
});

const {PrivateWorkAI} = mod.exports;
const client: any = {sessionGeneration: 1, csrfToken: 'synthetic', async get() {return {};}};

test('LEFT-13: PrivateWorkAI links to #automation/devices and #automation/models without mounting ModelSettings inline', () => {
  window.location.pathname = '/';
  const workHtml = renderToStaticMarkup(React.createElement(PrivateWorkAI, {client}));
  assert.equal(workHtml.includes('href="#automation/devices"'), true);
  assert.equal(workHtml.includes('href="#automation/models"'), true);
  assert.equal(workHtml.includes('aria-label="裝置與連線"'), false);
  assert.equal(workHtml.includes('aria-label="模型與憑證設定"'), false);

  window.location.pathname = '/device';
  const deviceHtml = renderToStaticMarkup(React.createElement(PrivateWorkAI, {client}));
  assert.equal(deviceHtml.includes('aria-label="裝置與連線"'), true);
  assert.equal(deviceHtml.includes('aria-label="模型與憑證設定"'), false);
  assert.equal(deviceHtml.includes('href="#automation/models"'), true);
});
