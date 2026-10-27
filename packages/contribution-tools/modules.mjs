import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { artifactPath, parseJson, readBounded, sha256 } from './io.mjs';
import { isModuleDescriptorPath, owns, selectImpact, validateDescriptor } from './context.mjs';
import { git, resolveCommit } from './workspace.mjs';
import { VerificationError, requireCondition as check } from './errors.mjs';

// Contributor aids do not replace prepare/verify, the CI selector or domain ACLs.
export const MODULE_SOURCE_SCOPE = Object.freeze({
  roots: ['apps/', 'modules/', 'packages/'],
  extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css'],
  excluded_directories: ['test', 'tests', '__tests__', 'vendor', 'generated', 'node_modules', 'dist', 'build'],
  excluded_paths: ['apps/portal-web/public/assets/'],
  excluded_filenames: ['*.test.*', '*.spec.*', '*.d.ts'],
});

export function isModuleSourcePath(path) {
  return MODULE_SOURCE_SCOPE.roots.some(root => path.startsWith(root))
    && /\.(?:[cm]?js|jsx|tsx?|css)$/.test(path)
    && !path.split('/').some(part => MODULE_SOURCE_SCOPE.excluded_directories.includes(part))
    && !MODULE_SOURCE_SCOPE.excluded_paths.some(root => path.startsWith(root))
    && !/\.(?:test|spec)\.[^/]+$/.test(path) && !path.endsWith('.d.ts');
}

async function repositoryFiles(repositoryRoot) {
  check(git(repositoryRoot, ['rev-parse', '--show-prefix']).toString().trim() === '', 'run_from_repository_root');
  const paths = [...new Set(git(repositoryRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .toString('utf8').split('\0').filter(Boolean))].sort();
  check(paths.length <= 8192, 'workspace_path_limit');
  for (const path of paths) artifactPath(path);
  // ls-files --cached includes unstaged deletions; the catalog describes files
  // present in the candidate workspace, just like context's descriptor reader.
  const deleted = new Set(git(repositoryRoot, ['ls-files', '--deleted', '-z']).toString('utf8').split('\0').filter(Boolean));
  return paths.filter(path => !deleted.has(path));
}

/** Read descriptor data only, never candidate scripts. */
export async function readModuleCatalog(repositoryRoot) {
  const files = await repositoryFiles(repositoryRoot);
  const descriptorPaths = files.filter(isModuleDescriptorPath);
  check(descriptorPaths.length > 0, 'candidate_governance_unavailable');
  check(descriptorPaths.length <= 256, 'module_limit');
  const modules = [];
  for (const path of descriptorPaths) {
    const descriptor = validateDescriptor(parseJson(await readBounded(repositoryRoot, path)));
    const module = { descriptor_path: path, ...descriptor };
    // Match the CI selector: implicit descriptor ownership consumes a schema
    // slot only when it is not already covered by an explicit owned path.
    withDescriptorOwnership(module);
    modules.push(module);
  }
  check(new Set(modules.map(item => item.module_id)).size === modules.length, 'duplicate_module');
  modules.sort((a, b) => a.module_id.localeCompare(b.module_id, 'en'));
  return { files, modules, head_commit: resolveCommit(repositoryRoot, 'HEAD') };
}

const withDescriptorOwnership = module => {
  const { descriptor_path, ...descriptor } = module;
  return owns(descriptor, descriptor_path) ? descriptor
    : validateDescriptor({ ...descriptor, owned_paths: [...descriptor.owned_paths, descriptor_path] });
};
const ownersFor = (modules, path) => modules.filter(module => module.descriptor_path === path || owns(module, path))
  .map(module => module.module_id).sort();

export async function listModules(repositoryRoot, { moduleId, path } = {}) {
  const catalog = await readModuleCatalog(repositoryRoot);
  if (moduleId !== undefined) check(typeof moduleId === 'string' && catalog.modules.some(module => module.module_id === moduleId), 'unknown_module_scope');
  if (path !== undefined) artifactPath(path);
  const modules = catalog.modules.filter(module => (moduleId === undefined || module.module_id === moduleId)
    && (path === undefined || module.descriptor_path === path || owns(module, path)));
  return { format: 'freedom.module-catalog/v1', assurance_level: 'local',
    head_commit: catalog.head_commit, total_modules: catalog.modules.length,
    ...(path !== undefined ? { requested_path: path, owners: ownersFor(catalog.modules, path) } : {}), modules };
}

function graphDiagnostics(modules) {
  const issues = [], byId = new Map(modules.map(module => [module.module_id, module]));
  for (const module of modules) for (const dependency of module.dependencies) {
    if (!byId.has(dependency)) issues.push({ code: 'module_dependency_missing', module_id: module.module_id, dependency });
  }
  const active = new Set(), done = new Set();
  const visit = id => {
    if (active.has(id)) { issues.push({ code: 'module_dependency_cycle', module_id: id }); return; }
    if (done.has(id) || !byId.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    active.delete(id); done.add(id);
  };
  for (const id of byId.keys()) visit(id);
  return issues;
}

/** Descriptor/reference and source ownership checks, not import or ACL proof. */
export async function checkModules(repositoryRoot, { paths } = {}) {
  check(paths === undefined || Array.isArray(paths) && paths.length > 0 && paths.length <= 4096, 'invalid_arguments');
  if (paths) for (const path of paths) artifactPath(path);
  const catalog = await readModuleCatalog(repositoryRoot);
  const issues = graphDiagnostics(catalog.modules);
  for (const module of catalog.modules) {
    const references = new Set([...module.instructions, ...module.public_exports, ...module.surfaces.map(surface => surface.entry)]);
    for (const path of references) {
      try { await readBounded(repositoryRoot, path); }
      catch (error) {
        if (!(error instanceof VerificationError)) throw error;
        issues.push({ code: error.code, module_id: module.module_id, path });
      }
    }
  }
  const checkedPaths = [...new Set(paths ?? catalog.files.filter(isModuleSourcePath))].sort();
  const ownership = checkedPaths.map(path => ({ path, modules: ownersFor(catalog.modules, path) }));
  const unownedPaths = ownership.filter(item => !item.modules.length).map(item => item.path);
  const warnings = unownedPaths.map(path => ({ code: 'surface_unmapped', path }));
  if (warnings.length) console.warn(JSON.stringify({ severity: 'warning', code: 'surface_unmapped', unknown_paths: unownedPaths }));
  const descriptors = catalog.modules.map(withDescriptorOwnership);
  const impact = selectImpact({ baseline: descriptors, candidate: descriptors, changedPaths: [], requestedPaths: checkedPaths });
  return { format: 'freedom.module-check/v1', assurance_level: 'local',
    coverage_kind: 'descriptor-and-source-ownership', status: issues.length ? 'failed' : 'passed',
    head_commit: catalog.head_commit, module_count: catalog.modules.length, checked_source_count: checkedPaths.length,
    source_scope: paths ? { requested_paths: checkedPaths } : MODULE_SOURCE_SCOPE,
    unknown_paths: unownedPaths, shared_ownership: ownership.filter(item => item.modules.length > 1),
    affected_modules: impact.module_ids, tests: impact.tests, issues, warnings,
    not_checked: ['baseline-candidate-impact', 'imports', 'runtime-registration', 'authorization', 'behavior'],
    merge_authorized: false, execution_authorized: false };
}

function moduleTemplate(id, owner, dependencies) {
  const directory = `modules/${id}`, test = `tests/runtime/${id}.test.ts`;
  const descriptor = validateDescriptor({ format: 'freedom.module/v1', module_id: id, owner_role: owner,
    owned_paths: [`${directory}/**`, test], public_exports: [`${directory}/index.ts`],
    dependencies, contract_families: [], client_profiles: ['member'],
    instructions: ['AGENTS.md', 'CONTRIBUTING.md', `${directory}/README.md`],
    invariants: ['current-authority-before-replay', 'no-secrets-in-artifacts'], tests: ['runtime.full'], surfaces: [] });
  return [
    { path: `${directory}/freedom.module.json`, content: JSON.stringify(descriptor, null, 2) + '\n' },
    { path: `${directory}/README.md`, content: `# ${id}

這是尚未接入平台的模組骨架。請先把範例換成這次 PR 的實際功能。

## 負責範圍

- 模組 ID：\`${id}\`；維護角色：\`${owner}\`（不是 GitHub 寫入權或業務授權）。
- 對外入口：\`index.ts\`；內部實作：\`service.ts\`。
- 相依：${dependencies.length ? dependencies.map(dep => `\`${dep}\``).join('、') : '目前沒有'}。新增跨模組呼叫時，使用對方的 public_exports 並更新 dependencies。
- \`normalizeInput\` 是純函式教學範例，只驗證輸入，沒有資料庫、路由或正式業務行為。

## 實作與提交

1. 寫明使用者問題、輸入／輸出、權限、失敗與重試行為，替換範例並補正常／拒絕案例。
2. 新頁面或 API 需在對應組合入口明確註冊，並同步 descriptor 的 owned_paths、surfaces 與 dependencies。JSON 描述檔不會自動啟用功能。
3. 會員、權限、交易與資料庫寫入沿用現有服務及契約；不要從前端 import 伺服器或資料庫實作。
4. 若需 migration，依合併時主線選下一個編號；不要自行啟用正式旗標。
5. 依根 CONTRIBUTING.md 準備 context，記錄下列命令的實際結果與未驗項，再開 PR。

\`\`\`sh
node scripts/freedom.mjs prepare --base-ref origin/main --scope ${id}
node scripts/freedom.mjs module-check
node --import tsx --test ${test}
npm run typecheck
\`\`\`

有前端修改時先 build 再跑對應 E2E；runtime.full 與既有 CI 要求仍保留。模組 metadata 通過不等於權限、完整功能或部署驗收。
` },
    { path: `${directory}/index.ts`, content: "// Public module entry. Keep internal implementation imports inside this module.\nexport { normalizeInput } from './service.js';\nexport type { ModuleInput } from './service.js';\n" },
    { path: `${directory}/service.ts`, content: `// Replace this pure input example with the module's actual domain behavior.
// No route, database connection, feature flag or permission is created here.
export type ModuleInput = Readonly<{ title: string }>;

export function normalizeInput(value: unknown): ModuleInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !Object.hasOwn(value, 'title') || typeof (value as { title?: unknown }).title !== 'string') {
    throw new TypeError('invalid_module_input');
  }
  const title = (value as { title: string }).title.trim();
  if (!title || Array.from(title).length > 120) throw new TypeError('invalid_module_input');
  return Object.freeze({ title });
}
` },
    { path: test, content: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput } from '../../${directory}/index.js';

// Replace these examples with the module's user-visible behavior and failures.
test('${id}: accepts a title without changing its content', () => {
  assert.deepEqual(normalizeInput({ title: '  第一個功能  ' }), { title: '第一個功能' });
});

test('${id}: rejects missing, blank and oversized input', () => {
  for (const value of [null, [], {}, { title: 1 }, { title: '  ' }, { title: '字'.repeat(121) }]) {
    assert.throws(() => normalizeInput(value), { message: 'invalid_module_input' });
  }
});
` },
  ];
}

async function checkedDirectory(root, path) {
  let current = resolve(root);
  const rootStat = await lstat(current);
  check(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'unsafe_artifact_root');
  for (const part of artifactPath(path).split('/')) {
    const names = await readdir(current);
    check(!names.some(name => name.toLowerCase() === part.toLowerCase() && name !== part), 'case_collision');
    current = resolve(current, part);
    const stat = await lstat(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'unsafe_module_directory');
  }
  return current;
}

async function ensureMissing(root, path) {
  artifactPath(path);
  const directory = await checkedDirectory(root, dirname(path));
  const name = path.slice(path.lastIndexOf('/') + 1);
  check(!(await readdir(directory)).some(existing => existing.toLowerCase() === name.toLowerCase()), 'module_destination_exists');
}

/** Explicit local file creation. Preflight the whole plan; never overwrite. */
export async function createModule(repositoryRoot, { id, owner, dependencies = [], dryRun = false } = {}) {
  check(typeof id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64, 'invalid_module_id');
  artifactPath(`modules/${id}`);
  check(typeof owner === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/.test(owner), 'invalid_module_owner');
  check(typeof dryRun === 'boolean' && Array.isArray(dependencies) && dependencies.length <= 64
    && dependencies.every(dependency => typeof dependency === 'string')
    && new Set(dependencies).size === dependencies.length, 'invalid_arguments');
  const catalog = await readModuleCatalog(repositoryRoot);
  check(!catalog.modules.some(module => module.module_id.toLowerCase() === id), 'module_already_exists');
  check(dependencies.every(id => catalog.modules.some(module => module.module_id === id)), 'module_dependency_missing');
  const files = moduleTemplate(id, owner, dependencies), moduleDirectory = `modules/${id}`;
  await ensureMissing(repositoryRoot, moduleDirectory);
  await ensureMissing(repositoryRoot, `tests/runtime/${id}.test.ts`);
  // A currently absent path can still be intentionally reserved by a descriptor.
  for (const file of files) check(ownersFor(catalog.modules, file.path).length === 0, 'module_path_already_owned');
  for (const path of ['AGENTS.md', 'CONTRIBUTING.md']) await readBounded(repositoryRoot, path);
  const result = { format: 'freedom.module-scaffold/v1', assurance_level: 'local',
    status: dryRun ? 'planned' : 'created', module_id: id, head_commit: catalog.head_commit,
    files: files.map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content), sha256: sha256(file.content),
      ...(dryRun ? { content: file.content } : {}) })),
    next_commands: [`node scripts/freedom.mjs prepare --base-ref origin/main --scope ${id}`,
      'node scripts/freedom.mjs module-check', `node --import tsx --test tests/runtime/${id}.test.ts`, 'npm run typecheck'],
    runtime_registered: false, merge_authorized: false, execution_authorized: false };
  if (dryRun) return result;
  const created = [];
  let directoryCreated = false;
  try {
    await ensureMissing(repositoryRoot, moduleDirectory);
    await ensureMissing(repositoryRoot, `tests/runtime/${id}.test.ts`);
    await mkdir(resolve(repositoryRoot, moduleDirectory)); directoryCreated = true;
    // Descriptor last: an interrupted scaffold is not a complete registration.
    for (const file of [...files.slice(1), files[0]]) {
      await checkedDirectory(repositoryRoot, dirname(file.path));
      const handle = await open(resolve(repositoryRoot, file.path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
      const stat = await handle.stat();
      created.push({ path: file.path, dev: stat.dev, ino: stat.ino });
      try { await handle.writeFile(file.content, 'utf8'); } finally { await handle.close(); }
    }
  } catch (error) {
    // Remove only our exclusive-create inodes. Never recursively remove a folder.
    for (const file of created.reverse()) {
      try {
        await checkedDirectory(repositoryRoot, dirname(file.path));
        const stat = await lstat(resolve(repositoryRoot, file.path));
        if (stat.isFile() && stat.dev === file.dev && stat.ino === file.ino) await unlink(resolve(repositoryRoot, file.path));
      } catch { /* Leave unknown/concurrently changed paths alone. */ }
    }
    if (directoryCreated) await rmdir(resolve(repositoryRoot, moduleDirectory)).catch(() => {});
    if (error instanceof VerificationError) throw error;
    throw new VerificationError(error?.code === 'EEXIST' ? 'module_destination_exists' : 'module_scaffold_write_failed');
  }
  return result;
}

export const MODULE_COMMANDS = Object.freeze(['modules', 'module-new', 'module-check']);

export async function runModuleCommand(args, repositoryRoot) {
  const [command, ...rest] = args;
  check(MODULE_COMMANDS.includes(command), 'unknown_command');
  const allowed = command === 'modules' ? ['--module', '--path']
    : command === 'module-check' ? ['--paths'] : ['--id', '--owner', '--depends', '--dry-run'];
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index], value = rest[index + 1];
    check(allowed.includes(flag) && typeof value === 'string' && value.length > 0
      && !value.startsWith('--') && !values.has(flag), 'invalid_arguments');
    values.set(flag, value);
  }
  if (command === 'modules') return listModules(repositoryRoot, { moduleId: values.get('--module'), path: values.get('--path') });
  if (command === 'module-check') return checkModules(repositoryRoot, { paths: values.get('--paths')?.split(',') });
  check(!values.has('--dry-run') || ['true', 'false'].includes(values.get('--dry-run')), 'invalid_arguments');
  return createModule(repositoryRoot, { id: values.get('--id'), owner: values.get('--owner'),
    dependencies: values.get('--depends')?.split(',') ?? [], dryRun: values.get('--dry-run') === 'true' });
}
