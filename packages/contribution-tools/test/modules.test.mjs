import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkModules, createModule, isModuleSourcePath, listModules, readModuleCatalog, runModuleCommand } from '../modules.mjs';
import { validateDescriptor } from '../context.mjs';
import { sha256 } from '../io.mjs';
import { fixtureRoot, put, pretty } from './fixtures.mjs';

const descriptor = (id = 'shared', overrides = {}) => ({
  format: 'freedom.module/v1', module_id: id, owner_role: 'foundation',
  owned_paths: [`packages/${id}/**`], public_exports: [`packages/${id}/index.ts`],
  dependencies: [], contract_families: [], client_profiles: ['member'],
  instructions: ['AGENTS.md'], invariants: ['no-secrets-in-artifacts'], tests: ['runtime.full'], surfaces: [], ...overrides,
});
async function fixture(t) {
  const root = await fixtureRoot(t);
  for (const path of ['AGENTS.md', 'CONTRIBUTING.md', 'README.md']) await put(root, path, '# Synthetic contributor fixture\n');
  await put(root, 'package.json', pretty({ name: 'freedom-platform', type: 'module' }));
  await put(root, '.gitignore', '.freedom/\nnode_modules/\n');
  await put(root, 'packages/shared/freedom.module.json', pretty(descriptor()));
  await put(root, 'packages/shared/index.ts', 'export const fixture = true;\n');
  await mkdir(join(root, 'modules'));
  await mkdir(join(root, 'tests/runtime'), { recursive: true });
  const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['-c', 'init.templateDir=', 'init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic module baseline']);
  return { root, git };
}

async function writeDescriptor(root, id, overrides) {
  await put(root, `packages/${id}/freedom.module.json`, pretty(descriptor(id, overrides)));
  await put(root, `packages/${id}/index.ts`, 'export const fixture = true;\n');
}

test('module catalog finds implicit descriptor ownership, exact paths and parent/leaf overlap', async t => {
  const f = await fixture(t);
  await writeDescriptor(f.root, 'leaf', { owned_paths: ['apps/portal-web/src/Example.tsx'], dependencies: ['shared'] });
  await writeDescriptor(f.root, 'shell', { owned_paths: ['apps/portal-web/src/**'], dependencies: ['leaf'] });
  await put(f.root, 'apps/portal-web/src/Example.tsx', 'export const fixture = true;\n');
  const match = await listModules(f.root, { path: 'apps/portal-web/src/Example.tsx' });
  assert.deepEqual(match.owners, ['leaf', 'shell']);
  assert.equal(match.total_modules, 3);
  assert.deepEqual((await listModules(f.root, { path: 'packages/leaf/freedom.module.json' })).owners, ['leaf']);
  assert.equal((await listModules(f.root, { moduleId: 'leaf' })).modules[0].dependencies[0], 'shared');
  await assert.rejects(listModules(f.root, { moduleId: 'missing' }), { code: 'unknown_module_scope' });
  assert.deepEqual((await listModules(f.root, { path: 'modules/unclaimed/service.ts' })).owners, []);
});


test('catalog and ownership reflect unstaged tracked deletions', async t => {
  const f = await fixture(t);
  await writeDescriptor(f.root, 'retired', { owned_paths: ['packages/retired/**'] });
  f.git(['add', 'packages/retired']);
  await unlink(join(f.root, 'packages/retired/freedom.module.json'));
  await unlink(join(f.root, 'packages/retired/index.ts'));
  const catalog = await readModuleCatalog(f.root);
  assert.deepEqual(catalog.modules.map(module => module.module_id), ['shared']);
  assert(!catalog.files.some(path => path.startsWith('packages/retired/')));
  assert.equal((await checkModules(f.root)).status, 'passed');
});

test('module-check reports actual unmapped source and keeps its verification scope explicit', async t => {
  const f = await fixture(t);
  await put(f.root, 'apps/portal-web/src/Orphan.tsx', 'export const fixture = true;\n');
  const report = await checkModules(f.root);
  assert.equal(report.status, 'failed');
  assert.equal(report.coverage_kind, 'descriptor-and-source-ownership');
  assert.deepEqual(report.unknown_paths, ['apps/portal-web/src/Orphan.tsx']);
  assert(report.not_checked.includes('imports'));
  assert(report.not_checked.includes('authorization'));
  assert.equal(report.merge_authorized, false);
  assert.equal(report.execution_authorized, false);
  const scoped = await checkModules(f.root, { paths: ['packages/shared/index.ts'] });
  assert.equal(scoped.status, 'passed');
  assert.deepEqual(scoped.source_scope, { requested_paths: ['packages/shared/index.ts'] });
});

test('module-check permits shared ownership and diagnoses references plus dependency cycles', async t => {
  const f = await fixture(t);
  await writeDescriptor(f.root, 'a', { owned_paths: ['packages/a/**', 'apps/portal-web/src/**'], dependencies: ['b'] });
  await writeDescriptor(f.root, 'b', { owned_paths: ['packages/b/**', 'apps/portal-web/src/Page.tsx'], dependencies: ['a'] });
  await put(f.root, 'apps/portal-web/src/Page.tsx', 'export const fixture = true;\n');
  let report = await checkModules(f.root);
  assert(report.issues.some(issue => issue.code === 'module_dependency_cycle'));
  assert.deepEqual(report.shared_ownership, [{ path: 'apps/portal-web/src/Page.tsx', modules: ['a', 'b'] }]);
  await writeDescriptor(f.root, 'a', { owned_paths: ['packages/a/**', 'apps/portal-web/src/**'], dependencies: ['absent'], public_exports: ['packages/a/missing.ts'] });
  report = await checkModules(f.root);
  assert(report.issues.some(issue => issue.code === 'module_dependency_missing' && issue.dependency === 'absent'));
  assert(report.issues.some(issue => issue.code === 'artifact_missing' && issue.path === 'packages/a/missing.ts'));
});

test('source scope includes production fixtures and excludes only documented source categories', () => {
  for (const path of ['modules/new/service.ts', 'apps/portal-web/src/Panel.tsx', 'packages/helpers/index.mjs', 'modules/new/fixtures/catalog.ts', 'modules/new/styles.css', 'apps/portal-web/public/go.js', 'apps/portal-web/public/shops.css']) {
    assert.equal(isModuleSourcePath(path), true, path);
  }
  for (const path of ['tests/runtime/new.test.ts', 'packages/helpers/test/example.mjs', 'modules/new/item.test.ts', 'modules/new/vendor/example.js', 'apps/platform-api/src/generated/runtime-text.ts', 'apps/portal-web/public/assets/example.js', 'packages/helpers/types.d.ts']) {
    assert.equal(isModuleSourcePath(path), false, path);
  }
});

test('dry-run and scaffold produce the same complete descriptors and executable pure service', async t => {
  const f = await fixture(t), options = { id: 'community-calendar', owner: 'community', dependencies: ['shared'] };
  const plan = await createModule(f.root, { ...options, dryRun: true });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.runtime_registered, false);
  await assert.rejects(lstat(join(f.root, 'modules/community-calendar')), { code: 'ENOENT' });
  const created = await createModule(f.root, options);
  assert.equal(created.status, 'created');
  for (const file of plan.files) {
    const actual = await readFile(join(f.root, file.path));
    assert.equal(actual.toString('utf8'), file.content);
    assert.equal(sha256(actual), file.sha256);
    assert.deepEqual(created.files.find(item => item.path === file.path), { path: file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  const module = (await listModules(f.root, { moduleId: options.id })).modules[0];
  const { descriptor_path, ...data } = module;
  validateDescriptor(data);
  assert.deepEqual(data.tests, ['runtime.full']);
  assert.deepEqual(data.surfaces, []);
  assert.deepEqual(data.public_exports, ['modules/community-calendar/index.ts']);
  assert.equal((await checkModules(f.root)).status, 'passed');
  const { normalizeInput } = await import(pathToFileURL(join(f.root, 'modules/community-calendar/service.ts')).href);
  assert.deepEqual(normalizeInput({ title: '  公會活動  ' }), { title: '公會活動' });
  assert.deepEqual(normalizeInput({ title: '🙂'.repeat(120) }), { title: '🙂'.repeat(120) });
  for (const value of [null, [], {}, { title: 5 }, { title: ' ' }, { title: '字'.repeat(121) }]) assert.throws(() => normalizeInput(value));
});

test('scaffold refuses existing module IDs and files before any write', async t => {
  const f = await fixture(t);
  await assert.rejects(createModule(f.root, { id: 'shared', owner: 'community' }), { code: 'module_already_exists' });
  await put(f.root, 'tests/runtime/new-feature.test.ts', '// existing user work\n');
  await assert.rejects(createModule(f.root, { id: 'new-feature', owner: 'community' }), { code: 'module_destination_exists' });
  assert.equal(await readFile(join(f.root, 'tests/runtime/new-feature.test.ts'), 'utf8'), '// existing user work\n');
  await assert.rejects(lstat(join(f.root, 'modules/new-feature')), { code: 'ENOENT' });
});

test('scaffold rejects traversal, reserved names, malformed roles and unknown dependencies', async t => {
  const f = await fixture(t);
  for (const id of ['../escape', 'a/b', '/absolute', 'two--parts', 'UPPER', 'a'.repeat(65), 'con']) {
    await assert.rejects(createModule(f.root, { id, owner: 'community' }));
  }
  await assert.rejects(createModule(f.root, { id: 'example', owner: 'owner\nother' }), { code: 'invalid_module_owner' });
  await assert.rejects(createModule(f.root, { id: 'example', owner: 'community', dependencies: ['missing'] }), { code: 'module_dependency_missing' });
  await assert.rejects(createModule(f.root, { id: 'example', owner: 'community', dependencies: ['shared', 'shared'] }), { code: 'invalid_arguments' });
  await assert.rejects(lstat(join(f.root, 'modules/example')), { code: 'ENOENT' });
});

test('scaffold rejects case collisions and pre-existing ownership reservations', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'modules/New-feature'));
  await assert.rejects(createModule(f.root, { id: 'new-feature', owner: 'community' }), { code: 'module_destination_exists' });
  await writeDescriptor(f.root, 'reserved', { owned_paths: ['packages/reserved/**', 'modules/reserved-feature/**'] });
  await assert.rejects(createModule(f.root, { id: 'reserved-feature', owner: 'community' }), { code: 'module_path_already_owned' });
  await assert.rejects(lstat(join(f.root, 'modules/reserved-feature')), { code: 'ENOENT' });
});

test('scaffold rejects symlinked output parents without writing through them', async t => {
  const f = await fixture(t), outside = await fixtureRoot(t);
  await rename(join(f.root, 'tests/runtime'), join(f.root, 'tests/original-runtime'));
  await symlink(outside, join(f.root, 'tests/runtime'), 'dir');
  await assert.rejects(createModule(f.root, { id: 'new-feature', owner: 'community' }), { code: 'unsafe_module_directory' });
  await assert.rejects(lstat(join(outside, 'new-feature.test.ts')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(f.root, 'modules/new-feature')), { code: 'ENOENT' });
});

test('catalog rejects invalid, duplicate or symlinked descriptor data without loading code', async t => {
  const f = await fixture(t);
  await put(f.root, 'modules/duplicate/freedom.module.json', pretty(descriptor()));
  await assert.rejects(readModuleCatalog(f.root), { code: 'duplicate_module' });
  await writeFile(join(f.root, 'modules/duplicate/freedom.module.json'), '{"format":"freedom.module/v1","format":"other"}');
  await assert.rejects(readModuleCatalog(f.root), { code: 'duplicate_json_key' });
  await rename(join(f.root, 'modules/duplicate/freedom.module.json'), join(f.root, 'modules/duplicate/not-a-descriptor.json'));
  await symlink(join(f.root, 'packages/shared/freedom.module.json'), join(f.root, 'modules/duplicate/freedom.module.json'));
  await assert.rejects(readModuleCatalog(f.root), { code: 'artifact_symlink' });
});


test('catalog applies the CI bound to implicit descriptor ownership without double-counting covered paths', async t => {
  const f = await fixture(t);
  const paths = Array.from({ length: 64 }, (_, index) => `apps/portal-web/src/feature-${index}.ts`);
  await writeDescriptor(f.root, 'bounded', { owned_paths: paths });
  await assert.rejects(readModuleCatalog(f.root));
  paths[0] = 'packages/bounded/**';
  await writeDescriptor(f.root, 'bounded', { owned_paths: paths });
  assert.equal((await listModules(f.root, { moduleId: 'bounded' })).modules[0].owned_paths.length, 64);
});

test('module CLI accepts only the documented flags and does not mutate on malformed input', async t => {
  const f = await fixture(t);
  assert.equal((await runModuleCommand(['modules', '--module', 'shared'], f.root)).modules.length, 1);
  assert.equal((await runModuleCommand(['module-check'], f.root)).status, 'passed');
  assert.equal((await runModuleCommand(['module-new', '--id', 'new-feature', '--owner', 'community', '--depends', 'shared', '--dry-run', 'true'], f.root)).status, 'planned');
  for (const args of [
    ['modules', '--module'], ['modules', '--module', 'shared', '--module', 'shared'],
    ['module-check', '--paths', ''], ['module-check', '--base-ref', 'HEAD'],
    ['module-new', '--id', 'new-feature', '--owner', 'community', '--dry-run', 'yes'],
    ['module-new', '--id', 'new-feature', '--owner', 'community', '--force', 'true'],
  ]) await assert.rejects(runModuleCommand(args, f.root), { code: 'invalid_arguments' });
  await assert.rejects(lstat(join(f.root, 'modules/new-feature')), { code: 'ENOENT' });
});
