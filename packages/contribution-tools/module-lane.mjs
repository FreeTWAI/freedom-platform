import { posix } from 'node:path';
import { ROOT_INSTRUCTIONS, isModuleDescriptorPath, owns, validateDescriptor } from './context.mjs';
import { E2E_PLAN } from './pinned-e2e.mjs';

export const MODULE_LANE_CORE = Object.freeze([
  'application-composition',
  'portal-shell',
  'shared',
  'platform-host',
  'platform-api-features',
  'portal-features',
  'command-core',
  'tenant-workspaces',
  'newcomer-guides',
  'public-guide-assets',
  'e2e-harness',
  'google-identity-ui',
  'member-profile-ui',
  'member-communications-ui',
  'platform-helper',
  'module-registry',
  'runtime-registration',
  'governance',
  'shared-release',
  'preview-contract',
  'local-demo-data',
  'guild-presentation',
  'guild-supply',
  'guild-open-source',
  'guild-events',
]);

export const MODULE_LANE_MAX_DEPENDENTS = 9;
export const MODULE_LANE_MAX_FILES = 80;
export const MODULE_LANE_MAX_PATHS = 200;
export const MODULE_LANE_MAX_IMPORT_GRAPH_FILES = 3000;

// Measured fastest passing smoke subset totaling 199.1s (<= 4 minutes, >= 6 specs).
export const MODULE_LANE_SMOKE_FILES = Object.freeze([
  'tests/e2e/calm-experience.spec.ts',
  'tests/e2e/member-navigation-hierarchy.spec.ts',
  'tests/e2e/member-session-lifecycle.spec.ts',
  'tests/e2e/mobile-install.spec.ts',
  'tests/e2e/page-tools.spec.ts',
  'tests/e2e/session-recovery.spec.ts',
]);

export const MODULE_LANE_OVERRIDABLE_REASONS = Object.freeze([
  'not_docs_allowlist',
  'baseline_candidate_union',
  'leaf_profile_unproven',
  'governance_security_or_shared_runtime',
  'excluded_test_spec_or_config',
]);

const DEFAULT_FIXTURE_FILES = Object.freeze(E2E_PLAN.slice(1).flatMap(pass => pass.files));
const RUNTIME_TEST_PATH = /^tests\/runtime\/[a-z0-9][a-z0-9_-]*\.test\.ts$/;
const E2E_TS_PATH = /^tests\/e2e\/.*\.ts$/;
const LANE_GRAPH_CODE_PATH = /^tests\/(?:e2e|runtime)\/.*\.(?:[cm]?[jt]s|[jt]sx)$/;
const SPEC_PATH = /^tests\/e2e\/[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/;
const MODULE_DIR = /^(?:apps|modules)\//;
const MODULE_ALLOWED_EXTENSION = /\.(?:ts|tsx|css|md|svg|png|webp|jpg|jpeg|gif|glb|wasm|mp3|ogg|woff2)$/;
const DESCRIPTOR_LIMIT = 256;

function resolveGraphSpecifier(fromPath, specifier, fileSet) {
  if (typeof specifier !== 'string' || !specifier) return null;
  const clean = specifier.split(/[?#]/, 1)[0];
  if (!clean) return null;
  let base;
  if (clean.startsWith('.')) {
    base = posix.normalize(posix.join(posix.dirname(fromPath), clean));
  } else if (clean.startsWith('/')) {
    base = posix.normalize(clean).replace(/^\/+/, '');
  } else if (clean.startsWith('tests/e2e/') || clean.startsWith('tests/runtime/')) {
    base = posix.normalize(clean);
  } else if (clean.startsWith('file:')) {
    const match = clean.match(/\/(tests\/(?:e2e|runtime)\/.*)$/);
    if (!match) return null;
    base = posix.normalize(match[1]);
  } else {
    return null;
  }
  if (!(base.startsWith('tests/e2e/') || base.startsWith('tests/runtime/'))) return null;
  const candidates = [base];
  if (/\.js$/i.test(base)) {
    candidates.push(base.replace(/\.js$/i, '.ts'), base.replace(/\.js$/i, '.tsx'));
  } else if (/\.mjs$/i.test(base)) {
    candidates.push(base.replace(/\.mjs$/i, '.mts'), base.replace(/\.mjs$/i, '.ts'));
  } else if (/\.cjs$/i.test(base)) {
    candidates.push(base.replace(/\.cjs$/i, '.cts'), base.replace(/\.cjs$/i, '.ts'));
  } else {
    candidates.push(`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`);
  }
  return candidates.find(candidate => fileSet.has(candidate)) ?? null;
}

/**
 * Collect repository paths under tests/runtime/ reachable via static imports from tests/e2e/**\/*.ts.
 * Returns null when inputs are missing, a reader fails, or more than maxFiles files are read.
 */
export function collectE2eRuntimeImports({
  listFiles,
  readFile,
  extractSpecifiers,
  maxFiles = MODULE_LANE_MAX_IMPORT_GRAPH_FILES,
} = {}) {
  if (typeof listFiles !== 'function' || typeof readFile !== 'function'
    || typeof extractSpecifiers !== 'function' || !Number.isInteger(maxFiles) || maxFiles < 1) {
    return null;
  }
  try {
    const listed = listFiles();
    if (!listed || typeof listed[Symbol.iterator] !== 'function') return null;
    const fileSet = new Set();
    const queue = [];
    const visited = new Set();
    for (const file of listed) {
      if (typeof file !== 'string') return null;
      fileSet.add(file);
      if (E2E_TS_PATH.test(file) && !visited.has(file)) {
        visited.add(file);
        queue.push(file);
      }
    }
    const runtimeImports = new Set();
    let filesRead = 0;
    for (let index = 0; index < queue.length; index++) {
      const fromPath = queue[index];
      if (++filesRead > maxFiles) return null;
      const source = readFile(fromPath);
      if (typeof source !== 'string') return null;
      const specifiers = extractSpecifiers(source, fromPath);
      if (!specifiers || typeof specifiers[Symbol.iterator] !== 'function') return null;
      for (const specifier of specifiers) {
        const target = resolveGraphSpecifier(fromPath, specifier, fileSet);
        if (!target) continue;
        if (target.startsWith('tests/runtime/')) runtimeImports.add(target);
        if (LANE_GRAPH_CODE_PATH.test(target) && !visited.has(target)) {
          visited.add(target);
          queue.push(target);
        }
      }
    }
    return runtimeImports;
  } catch {
    return null;
  }
}

function inScope(path, entry) {
  return entry.endsWith('/') ? path.startsWith(entry) : path === entry;
}

function hasTextEntry(collection, path) {
  if (collection instanceof Set) return collection.has(path);
  return Array.isArray(collection) && collection.includes(path);
}

function isModuleConfigFile(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base === 'package.json'
    || base === 'package-lock.json'
    || base === '.npmrc'
    || /^tsconfig.*\.json$/i.test(base)
    || /\.config\.[^/]+$/i.test(base);
}

function resolveLaneContext(context) {
  if (!context || typeof context !== 'object') return null;
  const fullScope = context.fullScope ?? context.FULL_SCOPE;
  const runtimeText = context.runtimeText ?? context.RUNTIME_TEXT;
  const rootInstructions = context.rootInstructions ?? context.ROOT_INSTRUCTIONS ?? ROOT_INSTRUCTIONS;
  const isDescriptor = context.isModuleDescriptorPath ?? isModuleDescriptorPath;
  if (typeof context.safeRepoPath !== 'function'
    || typeof context.hiddenSegment !== 'function'
    || typeof context.isDocsAllowlisted !== 'function'
    || !Array.isArray(fullScope)
    || !(runtimeText instanceof Set || Array.isArray(runtimeText))) return null;
  return {
    safeRepoPath: context.safeRepoPath,
    hiddenSegment: context.hiddenSegment,
    isDocsAllowlisted: context.isDocsAllowlisted,
    fullScope,
    runtimeText,
    rootInstructions,
    isDescriptor,
  };
}

/**
 * Classify a changed path into the module lane's admitted buckets using the selector's helpers.
 */
export function classifyLanePath(path, context) {
  const ctx = resolveLaneContext(context);
  if (!ctx || typeof path !== 'string') return null;
  const { safeRepoPath, hiddenSegment, isDocsAllowlisted, fullScope, runtimeText, rootInstructions, isDescriptor } = ctx;
  if (!safeRepoPath(path) || hiddenSegment(path)) return null;
  if (RUNTIME_TEST_PATH.test(path) && !hasTextEntry(runtimeText, path)) return 'runtime-test';
  if (SPEC_PATH.test(path) && !hasTextEntry(runtimeText, path)) return 'spec';
  if (isDocsAllowlisted(path)) return 'docs';
  if (!MODULE_DIR.test(path)) return null;
  if (fullScope.some(entry => inScope(path, entry))) return null;
  if (hasTextEntry(runtimeText, path)) return null;
  if (rootInstructions.includes(path)) return null;
  if (isDescriptor(path)) return null;
  if (isModuleConfigFile(path)) return null;
  if (!MODULE_ALLOWED_EXTENSION.test(path)) return null;
  return 'module';
}

/**
 * Return true when a module is outside the host-owned core list and has at most 9 direct dependents.
 */
export function laneEligible(moduleId, baselineDescriptors) {
  if (typeof moduleId !== 'string' || !moduleId || !Array.isArray(baselineDescriptors)) return false;
  if (MODULE_LANE_CORE.includes(moduleId)) return false;
  const dependents = baselineDescriptors.filter(
    descriptor => Array.isArray(descriptor?.dependencies) && descriptor.dependencies.includes(moduleId),
  ).length;
  return dependents <= MODULE_LANE_MAX_DEPENDENTS;
}

function dependentModuleClosure(descriptors, ownerIds) {
  const affectedIds = new Set();
  const queue = [];
  for (const id of ownerIds) {
    if (typeof id === 'string' && id && !affectedIds.has(id)) {
      affectedIds.add(id);
      queue.push(id);
    }
  }
  if (affectedIds.size === 0 || !Array.isArray(descriptors)) return affectedIds;
  const dependentsById = new Map();
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.module_id !== 'string' || !Array.isArray(descriptor.dependencies)) continue;
    for (const dependency of descriptor.dependencies) {
      if (typeof dependency !== 'string') continue;
      let list = dependentsById.get(dependency);
      if (!list) {
        list = [];
        dependentsById.set(dependency, list);
      }
      list.push(descriptor.module_id);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    for (const dependentId of dependentsById.get(queue[index]) ?? []) {
      if (!affectedIds.has(dependentId)) {
        affectedIds.add(dependentId);
        queue.push(dependentId);
      }
    }
  }
  return affectedIds;
}

/**
 * Compute the sorted unique Playwright spec list for the narrowed browser lane.
 */
export function narrowedSpecFiles({
  descriptors = [],
  changedSpecs = [],
  ownerIds = [],
  catalog = [],
  fixtureFiles = DEFAULT_FIXTURE_FILES,
} = {}) {
  const affectedIds = dependentModuleClosure(descriptors, ownerIds);
  const affectedDescriptors = affectedIds.size > 0 && Array.isArray(descriptors)
    ? descriptors.filter(descriptor => affectedIds.has(descriptor?.module_id))
    : [];
  const ownedCatalogSpecs = affectedDescriptors.length > 0 && Array.isArray(catalog)
    ? catalog.filter(spec => affectedDescriptors.some(descriptor => owns(descriptor, spec)))
    : [];
  return [...new Set([
    ...changedSpecs,
    ...ownedCatalogSpecs,
    ...MODULE_LANE_SMOKE_FILES,
    ...fixtureFiles,
  ])].sort();
}

function validatedDescriptorMap(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0 || descriptors.length > DESCRIPTOR_LIMIT) return null;
  const byId = new Map();
  try {
    for (const descriptor of descriptors) {
      validateDescriptor(descriptor);
      if (byId.has(descriptor.module_id)) return null;
      byId.set(descriptor.module_id, descriptor);
    }
    const active = new Set();
    const done = new Set();
    const visit = id => {
      if (active.has(id) || !byId.has(id)) throw new Error('invalid_module_graph');
      if (done.has(id)) return;
      active.add(id);
      for (const dependency of byId.get(id).dependencies) visit(dependency);
      active.delete(id);
      done.add(id);
    };
    for (const id of byId.keys()) visit(id);
    return byId;
  } catch {
    return null;
  }
}

function sameDescriptorGraphs(baseline, candidate) {
  const baseById = validatedDescriptorMap(baseline);
  const candById = validatedDescriptorMap(candidate);
  if (!baseById || !candById || baseById.size !== candById.size) return false;
  for (const [id, descriptor] of baseById) {
    if (JSON.stringify(descriptor) !== JSON.stringify(candById.get(id))) return false;
  }
  return true;
}

/**
 * Pure admission and spec-narrowing decision for the PR module lane.
 */
export function decideModuleLane({
  event,
  existingDecision,
  changes,
  baseline,
  candidate,
  catalog,
  fixtureFiles = DEFAULT_FIXTURE_FILES,
  e2eRuntimeImports,
  nonExecutableBlobsProven,
  context,
} = {}) {
  const decline = code => ({ admitted: false, decline: code });
  if (event !== 'pull_request') return decline('non_pull_request');
  if (!existingDecision || existingDecision.mode !== 'full'
    || !MODULE_LANE_OVERRIDABLE_REASONS.includes(existingDecision.reason)) {
    return decline('non_overridable_decision');
  }
  const ctx = resolveLaneContext(context);
  if (!ctx) return decline('missing_lane_context');
  if (!Array.isArray(changes) || changes.length === 0) return decline('empty_changes');
  if (changes.length > MODULE_LANE_MAX_PATHS) return decline('too_many_paths');
  if (nonExecutableBlobsProven !== true) return decline('non_regular_or_executable_blob');
  if (!sameDescriptorGraphs(baseline, candidate)) return decline('descriptors_changed_or_unproven');

  const seenPaths = new Set();
  const changedSpecs = [];
  const changedRuntimeTests = [];
  const modulePaths = [];

  for (const change of changes) {
    if (!change || typeof change !== 'object') return decline('disallowed_change_status');
    if ((change.status !== 'A' && change.status !== 'M') || change.previousPath) {
      return decline('disallowed_change_status');
    }
    if (change.mode !== undefined && change.mode !== '100644') {
      return decline('non_regular_or_executable_blob');
    }
    if (seenPaths.has(change.path)) return decline('duplicate_path');
    seenPaths.add(change.path);
    const kind = classifyLanePath(change.path, ctx);
    if (!kind) return decline('disallowed_path');
    if (kind === 'runtime-test') changedRuntimeTests.push(change.path);
    else if (kind === 'spec') changedSpecs.push(change.path);
    else if (kind === 'module') modulePaths.push(change.path);
  }

  const ownerIds = new Set();
  for (const path of modulePaths) {
    const owners = baseline.filter(descriptor => owns(descriptor, path));
    if (owners.length === 0) return decline('unowned_module_path');
    for (const owner of owners) {
      if (!laneEligible(owner.module_id, baseline)) return decline('ineligible_module');
      ownerIds.add(owner.module_id);
    }
  }

  if (!(e2eRuntimeImports instanceof Set)) return decline('e2e_import_graph_unproven');
  if (changedRuntimeTests.some(path => e2eRuntimeImports.has(path))) {
    return decline('e2e_imports_changed_runtime');
  }
  if (!Array.isArray(catalog)) return decline('missing_catalog');
  const catalogSet = new Set(catalog);
  if (!MODULE_LANE_SMOKE_FILES.every(file => catalogSet.has(file))
    || !fixtureFiles.every(file => catalogSet.has(file))) {
    return decline('missing_smoke_or_fixture_spec');
  }

  const files = narrowedSpecFiles({
    descriptors: baseline,
    changedSpecs,
    ownerIds: [...ownerIds],
    catalog,
    fixtureFiles,
  });
  if (files.length > MODULE_LANE_MAX_FILES) return decline('too_many_e2e_files');
  return { admitted: true, reason: 'module_affected', files };
}
