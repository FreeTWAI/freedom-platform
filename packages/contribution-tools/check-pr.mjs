import { owns } from './context.mjs';
import { E2E_PLAN } from './pinned-e2e.mjs';

const RUNTIME_TEST_PATH = /^tests\/runtime\/[a-z0-9][a-z0-9_-]*\.test\.ts$/;
const E2E_SPEC_PATH = /^tests\/e2e\/[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/;

// Local pilot only: these suites read or execute MemberMessages source at runtime,
// so ordinary import-graph analysis does not reliably find all of them.
const DIRECT_MESSAGES_SOURCE = 'apps/portal-web/src/modules/MemberMessages.tsx';
const DIRECT_MESSAGES_NO_DB_SUITES = Object.freeze([
  'tests/runtime/chat-sticker-send.test.ts',
  'tests/runtime/direct-list-poll-isolation.test.ts',
  'tests/runtime/direct-list-render.test.ts',
  'tests/runtime/direct-message-receipts.test.ts',
]);

export const LANE_DECLINE_SENTENCES = Object.freeze({
  non_pull_request: '只有 pull_request 事件可以走模組快速通道。',
  non_overridable_decision: '已變更到不能由模組快速通道覆寫的核心或特殊範圍。',
  missing_lane_context: '本機缺少通道判斷所需的範圍設定。',
  empty_changes: '目前沒有偵測到任何檔案變更。',
  too_many_paths: '變更的檔案數量超過模組快速通道上限。',
  non_regular_or_executable_blob: '變更包含可執行檔、符號連結或非常規檔案。',
  descriptors_changed_or_unproven: '模組定義檔（freedom.module.json）有變更或無法確認未改動。',
  disallowed_change_status: '包含刪除、重新命名或複製檔案，須跑完整檢查。',
  duplicate_path: '變更清單出現重複路徑，無法安全走快速通道。',
  disallowed_path: '變更了模組目錄與允許測試／文件以外的檔案（例如共用設定、套件或腳本）。',
  unowned_module_path: '變更的模組路徑沒有任何模組宣告擁有（owned_paths）。',
  ineligible_module: '變更的模組屬於核心模組或被太多其他模組依賴。',
  e2e_imports_changed_runtime: '變更了 runtime 測試，且瀏覽器測試目錄有靜態匯入該測試檔。',
  e2e_import_graph_unproven: '無法驗證瀏覽器測試對 tests/runtime 的靜態匯入關係。',
  missing_catalog: '缺少可用的瀏覽器測試規格清單。',
  missing_smoke_or_fixture_spec: '缺少模組快速通道必需的冒煙測試或 fixture 規格檔案。',
  too_many_e2e_files: '需要執行的瀏覽器測試規格數量超過模組快速通道上限。',
});

export function parseCheckPrArgs(argv) {
  const result = {
    ok: true,
    baseRef: null,
    keepGoing: false,
    runE2e: false,
    help: false,
    error: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--keep-going') {
      result.keepGoing = true;
    } else if (arg === '--e2e') {
      result.runE2e = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--base') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        return { ...result, ok: false, error: 'missing_base_ref' };
      }
      result.baseRef = value;
    } else if (arg.startsWith('--base=')) {
      const value = arg.slice('--base='.length);
      if (!value || value.startsWith('-')) {
        return { ...result, ok: false, error: 'missing_base_ref' };
      }
      result.baseRef = value;
    } else {
      return { ...result, ok: false, error: `unknown_argument:${arg}` };
    }
  }
  return result;
}

export function groupFilesByModule(paths, descriptors) {
  const uniquePaths = [...new Set(
    (Array.isArray(paths) ? paths : []).map(item => (typeof item === 'string' ? item : item?.path)).filter(Boolean),
  )].sort();
  const sortedDescriptors = [...(Array.isArray(descriptors) ? descriptors : [])]
    .sort((a, b) => a.module_id.localeCompare(b.module_id, 'en'));
  const byModule = new Map();
  const unowned = [];

  for (const path of uniquePaths) {
    const owners = sortedDescriptors.filter(descriptor => owns(descriptor, path));
    if (owners.length === 0) {
      unowned.push(path);
      continue;
    }
    for (const owner of owners) {
      let list = byModule.get(owner.module_id);
      if (!list) {
        list = [];
        byModule.set(owner.module_id, list);
      }
      list.push(path);
    }
  }

  const groups = [...byModule.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .map(([moduleId, files]) => ({ moduleId, files }));
  return { groups, unowned };
}

export function describeDeclineCode(code) {
  if (typeof code === 'string' && Object.hasOwn(LANE_DECLINE_SENTENCES, code)) {
    return LANE_DECLINE_SENTENCES[code];
  }
  return `未知原因（${String(code || 'unknown')}）。`;
}

export function formatLaneDecision(lane) {
  if (lane?.admitted) {
    const count = Array.isArray(lane.files) ? lane.files.length : 0;
    return `這個 PR 會走模組快速通道（預估；以 CI 結果為準），預計執行 ${count} 個瀏覽器測試規格。`;
  }
  return `這個 PR 會跑完整檢查（預估；以 CI 結果為準）：${describeDeclineCode(lane?.decline)}`;
}

export function parseDiffNameStatus(nulOutput) {
  if (!nulOutput) return [];
  const tokens = nulOutput.split('\0');
  const changes = [];
  for (let index = 0; index < tokens.length; index++) {
    const rawStatus = tokens[index];
    if (!rawStatus) continue;
    const status = rawStatus[0];
    if (status === 'R' || status === 'C') {
      const previousPath = tokens[++index];
      const path = tokens[++index];
      if (path) changes.push({ status, path, previousPath });
    } else {
      const path = tokens[++index];
      if (path) changes.push({ status, path });
    }
  }
  return changes;
}

export function parsePorcelainStatus(nulOutput) {
  if (!nulOutput) return [];
  const tokens = nulOutput.split('\0');
  const changes = [];
  for (let index = 0; index < tokens.length; index++) {
    const entry = tokens[index];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!path || xy === '!!') continue;
    if (xy === '??') {
      changes.push({ status: 'A', path });
      continue;
    }
    if (xy.includes('R') || xy.includes('C')) {
      const status = xy.includes('R') ? 'R' : 'C';
      const previousPath = tokens[++index];
      changes.push({ status, path, ...(previousPath ? { previousPath } : {}) });
      continue;
    }
    const status = xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : 'M';
    changes.push({ status, path });
  }
  return changes;
}

export function mergeWorkingChanges(committed, uncommitted) {
  const byPath = new Map();
  for (const item of committed ?? []) {
    byPath.set(item.path, { ...item });
  }
  for (const item of uncommitted ?? []) {
    const existing = byPath.get(item.path);
    if (!existing) {
      byPath.set(item.path, { ...item });
      continue;
    }
    if (existing.status === 'A' && item.status === 'D') {
      byPath.delete(item.path);
      continue;
    }
    const nextStatus = existing.status === 'A' && item.status === 'M' ? 'A' : item.status;
    const next = {
      ...existing,
      ...item,
      status: nextStatus,
    };
    if (!item.previousPath && existing.previousPath && nextStatus === existing.status) {
      next.previousPath = existing.previousPath;
    }
    byPath.set(item.path, next);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function selectChangedRuntimeTests(changes) {
  return [...new Set(
    (changes ?? [])
      .filter(change => change?.status !== 'D' && RUNTIME_TEST_PATH.test(change?.path ?? ''))
      .map(change => change.path),
  )].sort();
}

export function planCheckPrRuntimeTests(changes) {
  const selected = new Set(selectChangedRuntimeTests(changes));
  const affectedPaths = new Set((changes ?? []).flatMap(change => [change?.path, change?.previousPath]));
  for (const file of DIRECT_MESSAGES_NO_DB_SUITES) {
    // Keep deleted/renamed pilot suites in the plan so missing evidence cannot become green.
    if (affectedPaths.has(DIRECT_MESSAGES_SOURCE) || affectedPaths.has(file)) selected.add(file);
  }
  return [...selected].sort().map(file => ({
    file,
    requiresDatabase: !DIRECT_MESSAGES_NO_DB_SUITES.includes(file),
  }));
}

export function selectE2eSpecs({ lane, changes }) {
  if (lane?.admitted && Array.isArray(lane.files)) {
    return [...lane.files];
  }
  return [...new Set(
    (changes ?? [])
      .filter(change => change?.status !== 'D' && E2E_SPEC_PATH.test(change?.path ?? ''))
      .map(change => change.path),
  )].sort();
}

export function partitionSpecsByE2ePass(specs, plan = E2E_PLAN) {
  const specSet = new Set(specs ?? []);
  const assigned = new Set();
  const passes = [];
  for (const pass of plan.slice(1)) {
    const files = pass.files.filter(file => specSet.has(file)).sort();
    if (files.length === 0) continue;
    for (const file of files) assigned.add(file);
    passes.push({ id: pass.id, env: pass.env, files });
  }
  const defaultFiles = [...specSet].filter(file => !assigned.has(file)).sort();
  if (defaultFiles.length > 0) {
    return [{ id: 'default', env: {}, files: defaultFiles }, ...passes];
  }
  return passes;
}

export function formatSummaryLines({
  passedChecks = [],
  failedChecks = [],
  skippedChecks = [],
  lane,
  uncommittedCount = 0,
  ranE2e = false,
}) {
  const passPart = passedChecks.length ? `通過：${passedChecks.join('、')}` : '通過：無';
  const failPart = failedChecks.length ? `；失敗：${failedChecks.join('、')}` : '';
  const skipPart = skippedChecks.length ? `；略過：${skippedChecks.join('、')}` : '';
  const line1 = `${passPart}${failPart}${skipPart}`;

  const line2 = lane?.admitted
    ? `CI 預估：模組快速通道（${Array.isArray(lane.files) ? lane.files.length : 0} 個 E2E 規格；以 CI 結果為準）`
    : `CI 預估：完整檢查（${describeDeclineCode(lane?.decline)}）`;

  let line3;
  if (failedChecks.length > 0) {
    line3 = '下一步：修復失敗項目後再重跑 npm run check:pr。';
  } else if (uncommittedCount > 0) {
    line3 = '下一步：先 commit 未提交變更，再重跑 npm run check:pr（如需瀏覽器驗證請加 -- --e2e）。';
  } else if (!ranE2e) {
    line3 = '下一步：若有改畫面可補跑 npm run check:pr -- --e2e，確認無誤後推送並將摘要貼進 PR。';
  } else {
    line3 = '下一步：推送分支並開 PR，將上方結果貼進 PR 的「怎麼驗證」。';
  }

  return `${line1}\n${line2}\n${line3}`;
}

/**
 * Fallback static specifier extractor used when the TypeScript pre-processor cannot be loaded.
 * Strips comments while preserving string literals, then extracts literal import/export/import()/require() targets.
 */
export function extractStaticImportSpecifiersFallback(source) {
  if (typeof source !== 'string') return [];
  const withoutComments = source.replace(
    /(["'`])(?:\\.|(?!\1)[^\\\n])*\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, quote) => (quote ? match : ' '),
  );
  const specifiers = [];
  const staticFrom = /(?:import\s+(?:[^;'"\n]*?\s+from\s+)?|export\s+[^;'"\n]*?\s+from\s+)(['"])([^'"\n]+)\1/g;
  const staticCall = /(?:^|[^.\w$])(?:import|require)\s*\(\s*(['"`])([^'"`\n$]+)\1\s*\)/g;
  for (const match of withoutComments.matchAll(staticFrom)) specifiers.push(match[2]);
  for (const match of withoutComments.matchAll(staticCall)) specifiers.push(match[2]);
  return specifiers;
}
