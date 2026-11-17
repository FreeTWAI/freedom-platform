import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  extractStaticImportSpecifiersFallback,
  formatLaneDecision,
  formatSummaryLines,
  groupFilesByModule,
  mergeWorkingChanges,
  parseCheckPrArgs,
  parseDiffNameStatus,
  parsePorcelainStatus,
  planCheckPrRuntimeTests,
  partitionSpecsByE2ePass,
  selectChangedRuntimeTests,
  selectE2eSpecs,
} from '../packages/contribution-tools/check-pr.mjs';
import { ROOT_INSTRUCTIONS, isModuleDescriptorPath } from '../packages/contribution-tools/context.mjs';
import { loadGuildPresentationParsers } from '../packages/contribution-tools/guild-presentation-profile.mjs';
import { collectE2eRuntimeImports, decideModuleLane } from '../packages/contribution-tools/module-lane.mjs';
import { readModuleCatalog } from '../packages/contribution-tools/modules.mjs';
import {
  FULL_SCOPE,
  RUNTIME_TEXT,
  hiddenSegment,
  isDocsAllowlisted,
  safeRepoPath,
} from './ci/select-affected-jobs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E2E_SPEC_PATH = /^tests\/e2e\/[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/;

const LANE_CONTEXT = Object.freeze({
  fullScope: FULL_SCOPE,
  runtimeText: RUNTIME_TEXT,
  rootInstructions: ROOT_INSTRUCTIONS,
  isDocsAllowlisted,
  safeRepoPath,
  hiddenSegment,
  isModuleDescriptorPath,
});

function gitOutput(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGitOutput(args) {
  try {
    return gitOutput(args).trim();
  } catch {
    return null;
  }
}

function resolveBase(baseRef) {
  if (baseRef) {
    const resolved = tryGitOutput(['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`]);
    if (resolved) return { base: resolved, label: baseRef };
    console.log(`找不到指定基準 ${baseRef}，改用 HEAD~1。`);
  } else {
    const mergeBase = tryGitOutput(['merge-base', 'HEAD', 'origin/main']);
    if (mergeBase) return { base: mergeBase, label: 'merge-base(HEAD, origin/main)' };
    console.log('找不到 origin/main 的 merge-base，改用 HEAD~1。');
  }
  const parent = tryGitOutput(['rev-parse', '--verify', 'HEAD~1^{commit}']);
  if (parent) return { base: parent, label: 'HEAD~1' };
  const head = tryGitOutput(['rev-parse', '--verify', 'HEAD^{commit}']) ?? 'HEAD';
  return { base: head, label: 'HEAD' };
}

function readHeadDescriptors(fallbackDescriptors) {
  try {
    const paths = gitOutput(['ls-tree', '-r', '--name-only', '-z', 'HEAD'])
      .split('\0')
      .filter(isModuleDescriptorPath);
    if (paths.length === 0) return fallbackDescriptors;
    return paths.map(path => JSON.parse(gitOutput(['show', '--end-of-options', `HEAD:${path}`])));
  } catch {
    return fallbackDescriptors;
  }
}

function annotateFileModes(changes) {
  return changes.map(change => {
    if (change.status === 'D') return change;
    try {
      const stat = lstatSync(join(ROOT, change.path));
      if (stat.isSymbolicLink()) return { ...change, mode: '120000' };
      if ((stat.mode & 0o111) !== 0) return { ...change, mode: '100755' };
      return { ...change, mode: '100644' };
    } catch {
      return change;
    }
  });
}

function collectLocalE2eRuntimeImports(files) {
  const ts = loadGuildPresentationParsers()?.ts;
  const extractSpecifiers = ts && typeof ts.preProcessFile === 'function'
    ? source => ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName)
    : extractStaticImportSpecifiersFallback;
  return collectE2eRuntimeImports({
    listFiles: () => files,
    readFile: path => {
      const fullPath = join(ROOT, path);
      if (!lstatSync(fullPath).isFile()) throw new Error('non_regular_file');
      return readFileSync(fullPath, 'utf8');
    },
    extractSpecifiers,
  });
}

function runCheck(name, command, args, env = process.env) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  const ok = result.status === 0 && !result.error;
  console.log(`${ok ? '✓' : '✗'} ${name} ${seconds}s`);
  if (!ok) {
    const output = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim()
      .split('\n');
    for (const line of output.slice(-25)) console.log(`  ${line}`);
  }
  return ok;
}

function printHelp() {
  console.log('用法：npm run check:pr -- [--base <ref>] [--keep-going] [--e2e]');
}

async function main() {
  const args = parseCheckPrArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(`參數錯誤：${args.error}`);
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }

  const { base, label } = resolveBase(args.baseRef);
  console.log(`基準：${label} (${base.slice(0, 12)})`);

  const committedRaw = execFileSync(
    'git',
    ['diff', '--name-status', '-z', `${base}...HEAD`],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const statusRaw = execFileSync(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const committed = parseDiffNameStatus(committedRaw);
  const uncommitted = parsePorcelainStatus(statusRaw);
  if (uncommitted.length > 0) {
    console.log('⚠️ 以下未提交變更尚未 commit（CI 只會檢查已 commit 的內容）：');
    for (const item of uncommitted) {
      console.log(`  - ${item.status} ${item.path}`);
    }
  }

  const changes = annotateFileModes(mergeWorkingChanges(committed, uncommitted));
  const catalogData = await readModuleCatalog(ROOT);
  const localDescriptors = catalogData.modules.map(({ descriptor_path: _dp, ...descriptor }) => descriptor);
  const headDescriptors = readHeadDescriptors(localDescriptors);

  const grouped = groupFilesByModule(changes.map(change => change.path), headDescriptors);
  console.log(`變更檔案（共 ${changes.length} 個，依模組分組）：`);
  for (const group of grouped.groups) {
    console.log(`  [${group.moduleId}] ${group.files.join(', ')}`);
  }
  if (grouped.unowned.length > 0) {
    console.log(`  [未歸屬模組] ${grouped.unowned.join(', ')}`);
  }

  const e2eCatalog = catalogData.files.filter(file => E2E_SPEC_PATH.test(file)).sort();
  const runtimePlan = planCheckPrRuntimeTests(changes);
  const e2eRuntimeImports = selectChangedRuntimeTests(changes).length > 0 ? collectLocalE2eRuntimeImports(catalogData.files) : new Set();
  const nonExecutableBlobsProven = changes.every(change => change.status === 'D' || change.mode === '100644');

  const lane = decideModuleLane({
    event: 'pull_request',
    existingDecision: { mode: 'full', reason: 'not_docs_allowlist' },
    changes,
    baseline: localDescriptors,
    candidate: localDescriptors,
    catalog: e2eCatalog,
    e2eRuntimeImports,
    nonExecutableBlobsProven,
    context: LANE_CONTEXT,
  });
  console.log(formatLaneDecision(lane));

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const hasRuntimeTextCheck = Boolean(packageJson.scripts?.['check:runtime-text']);

  const passedChecks = [];
  const failedChecks = [];
  const skippedChecks = [];

  const steps = [
    { name: 'contracts:build', command: 'npm', args: ['run', '-s', 'contracts:build'] },
    { name: 'typecheck', command: 'npm', args: ['run', '-s', 'typecheck'] },
    { name: 'module:check', command: 'npm', args: ['run', '-s', 'module:check'] },
    ...(hasRuntimeTextCheck
      ? [{ name: 'check:runtime-text', command: 'npm', args: ['run', '-s', 'check:runtime-text'] }]
      : [{ name: 'check:runtime-text', skip: true }]),
    { name: 'git diff --check', command: 'git', args: ['diff', '--check', `${base}...HEAD`] },
  ];

  for (const step of steps) {
    if (step.skip) {
      skippedChecks.push(step.name);
      console.log(`- ${step.name} (skipped) 0.0s`);
      continue;
    }
    const ok = runCheck(step.name, step.command, step.args);
    if (ok) {
      passedChecks.push(step.name);
    } else {
      failedChecks.push(step.name);
      if (!args.keepGoing) break;
    }
  }

  if (failedChecks.length === 0 || args.keepGoing) {
    const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
    if (runtimePlan.length === 0 && hasDatabase) {
      console.log('✓ runtime tests (0 selected) 0.0s');
    }
    for (const { file, requiresDatabase } of runtimePlan) {
      const name = `runtime:${basename(file)}`;
      if (requiresDatabase && !hasDatabase) {
        const reason = `${name}（未設定 TEST_DATABASE_URL）`;
        console.log(`未執行：${reason}`);
        skippedChecks.push(reason);
        continue;
      }

      // The pilot list is fixed; a removed or non-regular file must fail explicitly.
      let pilotSuitePresent = true;
      if (!requiresDatabase) {
        try { pilotSuitePresent = lstatSync(join(ROOT, file)).isFile(); }
        catch { pilotSuitePresent = false; }
      }
      if (!pilotSuitePresent) {
        console.log(`✗ ${name}（必要測試檔缺失或不是一般檔案：${file}）`);
      }
      const ok = pilotSuitePresent && (requiresDatabase
        ? runCheck(name, 'npx', ['tsx', '--test', '--test-concurrency=1', file])
        : runCheck(name, process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', file]));
      if (ok) passedChecks.push(name);
      else {
        failedChecks.push(name);
        if (!args.keepGoing) break;
      }
    }
  }

  let ranE2e = false;
  if (args.runE2e && (failedChecks.length === 0 || args.keepGoing)) {
    ranE2e = true;
    const specs = selectE2eSpecs({ lane, changes });
    if (specs.length === 0) {
      console.log('✓ e2e (0 specs) 0.0s');
    } else {
      const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
      const port = process.env.FREEDOM_E2E_PORT || '47942';
      const passes = partitionSpecsByE2ePass(specs);
      for (const pass of passes) {
        const patterns = pass.files.map(file => `(?:^|/)${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        const passEnv = { ...process.env, ...pass.env, FREEDOM_PINNED_E2E_ROOT: ROOT, FREEDOM_E2E_PORT: port };
        if (!process.env.FREEDOM_E2E_SCHEMA) delete passEnv.FREEDOM_E2E_SCHEMA;
        const name = `e2e:${pass.id} (${pass.files.length})`;
        const ok = runCheck(
          name,
          process.execPath,
          [cli, 'test', '--config', 'scripts/ci/pinned-playwright.config.mjs', '--workers=1', ...patterns],
          passEnv,
        );
        if (ok) passedChecks.push(name);
        else {
          failedChecks.push(name);
          if (!args.keepGoing) break;
        }
      }
    }
  }

  console.log('');
  console.log(formatSummaryLines({
    passedChecks,
    failedChecks,
    skippedChecks,
    lane,
    uncommittedCount: uncommitted.length,
    ranE2e,
  }));

  if (failedChecks.length > 0) process.exitCode = 1;
}

await main();
