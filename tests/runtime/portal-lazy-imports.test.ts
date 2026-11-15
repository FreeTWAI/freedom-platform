import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

function staticModuleInputs(relative: string) {
  const entry = fileURLToPath(new URL(`../../apps/portal-web/src/${relative}`, import.meta.url));
  const { inputs } = buildSync({
    stdin: { contents: readFileSync(entry, 'utf8'), loader: 'tsx', sourcefile: entry, resolveDir: dirname(entry) },
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'browser',
    format: 'esm',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  }).metafile!;
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const dependency of inputs[path]?.imports ?? []) {
      if (!dependency.external && dependency.kind !== 'dynamic-import') visit(dependency.path);
    }
  };
  const root = Object.keys(inputs).find(path => path.endsWith('/' + relative)) ?? '<stdin>';
  visit(root);
  assert.ok(visited.size >= 1, `expected static graph for ${relative}`);
  return [...visited];
}

const hasSuffix = (paths: string[], suffix: string) => paths.some(path => path.endsWith(suffix));

test('PERF-12: App.tsx keeps RegisteredTools, ShareRoute, SharePage, MyContent, and HostedOrder out of static entry graph', () => {
  const paths = staticModuleInputs('App.tsx');
  for (const excluded of [
    '/frame-tools/RegisteredTools.tsx',
    '/frame-tools/FrameTool.tsx',
    '/games/MemberGameUpload.tsx',
    '/share/ShareRoute.tsx',
    '/share/SharePage.tsx',
    '/modules/MyContent.tsx',
    '/modules/HostedOrder.tsx',
  ]) {
    assert.equal(hasSuffix(paths, excluded), false, `App.tsx statically imports ${excluded}`);
  }
});

test('PERF-12: feature registry declarations lazy-load optional CommunityPanel, CommunitySearch, MyContent, and RegisteredTools', () => {
  const communityPaths = staticModuleInputs('features/community.tsx');
  for (const excluded of ['/modules/Community.tsx', '/modules/CommunitySearch.tsx', '/modules/MyContent.tsx']) {
    assert.equal(hasSuffix(communityPaths, excluded), false, `features/community.tsx statically imports ${excluded}`);
  }

  const placePaths = staticModuleInputs('features/PlaceView.tsx');
  for (const excluded of ['/frame-tools/RegisteredTools.tsx', '/frame-tools/FrameTool.tsx', '/games/MemberGameUpload.tsx']) {
    assert.equal(hasSuffix(placePaths, excluded), false, `features/PlaceView.tsx statically imports ${excluded}`);
  }
});

test('PERF-12: App.tsx keeps renderPortalFeature eager so MemberHome adds no lazy registry hop and protects lazy routes with PageLoadBoundary', () => {
  const app = readFileSync(new URL('../../apps/portal-web/src/App.tsx', import.meta.url), 'utf8');
  assert.equal(/import \{ renderPortalFeature \} from '\.\/features\/registry'/.test(app), true, 'renderPortalFeature stays eager');
  assert.equal(/const RegisteredTools\s*=\s*lazy\(/.test(app), true, 'RegisteredTools must be lazy');
  assert.equal(/const ShareRoute\s*=\s*lazy\(/.test(app), true, 'ShareRoute must be lazy');
  assert.equal(/const CommunitySearch\s*=\s*lazy\(/.test(app), true, 'CommunitySearch must be lazy');
  assert.equal(/PageLoadBoundary[^>]*><RegisteredTools/.test(app), true, 'RegisteredTools wrapped in PageLoadBoundary');
  assert.equal(/PageLoadBoundary[^>]*><CommunitySearch/.test(app), true, 'CommunitySearch wrapped in PageLoadBoundary');
  assert.equal(/PageLoadBoundary[^>]*><HostedOrderPage/.test(app), true, 'HostedOrderPage wrapped in PageLoadBoundary');
});

test('PERF-12: ShareBox.tsx keeps EventComposer out of static graph and wraps lazy EventComposer in Suspense', () => {
  const shareBoxPaths = staticModuleInputs('share/ShareBox.tsx');
  assert.equal(
    hasSuffix(shareBoxPaths, '/share/EventComposer.tsx'),
    false,
    'ShareBox.tsx statically imports /share/EventComposer.tsx',
  );
  const appPaths = staticModuleInputs('App.tsx');
  assert.equal(
    hasSuffix(appPaths, '/share/EventComposer.tsx'),
    false,
    'App.tsx statically imports /share/EventComposer.tsx via ShareBox.tsx',
  );
  const shareBox = readFileSync(new URL('../../apps/portal-web/src/share/ShareBox.tsx', import.meta.url), 'utf8');
  assert.equal(/const EventComposer\s*=\s*(?:React\.)?lazy\(/.test(shareBox), true, 'EventComposer must be lazy');
  assert.equal(/<Suspense[^>]*>[\s\S]*<EventComposer\b/.test(shareBox), true, 'EventComposer must be wrapped in Suspense');
});
