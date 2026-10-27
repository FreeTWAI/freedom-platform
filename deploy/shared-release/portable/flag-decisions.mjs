// Decisions are authority only as reviewed bytes of the admitted application SHA.
// Never read workflow inputs, Environment config or the network for flag values.
import { execFileSync } from 'node:child_process';
import { requireRelease as check, isSha } from '../admission.mjs';

const PATH = 'deploy/shared-release/flag-decisions.json';
const FORMAT = 'freedom.shared-release.flag-decisions/v1';
const TARGETS = ['staging-next', 'next'];
const FLAG = /^FREEDOM_[A-Z0-9_]+_ENABLED$/;
// Receipts repeat changes in preflight, progress and deploy. Leave room under
// both 65,536-byte result/archive limits without dropping any bound fields.
const MAX_DECISIONS_PER_TARGET = 64;
const MAX_FLAG_NAME_LENGTH = 64;
const MAX_FLAG_RECORD_LENGTH = 160;
export const MAX_FLAG_CHANGES = 16;
const MAX_FLAG_CHANGES_BYTES = Buffer.byteLength(JSON.stringify(Array.from({ length: MAX_FLAG_CHANGES }, () => ({
  name: 'X'.repeat(MAX_FLAG_NAME_LENGTH), from: 'false', to: 'false',
  // Canonical URLs are ASCII without controls; allow JSON escaping each byte.
  record: '\\'.repeat(MAX_FLAG_RECORD_LENGTH),
}))));
const checkChangesBudget = flagChanges => check(flagChanges.length <= MAX_FLAG_CHANGES
  && Buffer.byteLength(JSON.stringify(flagChanges)) <= MAX_FLAG_CHANGES_BYTES, 'release_flag_changes_too_many');
const boolean = value => value === 'true' || value === 'false';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const recordUrl = value => {
  if (typeof value !== 'string' || value.length > MAX_FLAG_RECORD_LENGTH
    || !value.startsWith('https://github.com/FreeTWAI/freedom-platform/')) return false;
  try {
    const url = new URL(value);
    return url.href === value && url.pathname.startsWith('/FreeTWAI/freedom-platform/')
      && url.pathname.length > '/FreeTWAI/freedom-platform/'.length;
  } catch { return false; }
};

export function validateFlagDecisions(value) {
  check(keys(value, ['format', 'targets']) && value.format === FORMAT && object(value.targets)
    && Object.keys(value.targets).every(target => TARGETS.includes(target)), 'release_flag_decisions_invalid');
  for (const decisions of Object.values(value.targets)) {
    check(object(decisions) && Object.keys(decisions).length <= MAX_DECISIONS_PER_TARGET, 'release_flag_decisions_invalid');
    for (const [name, decision] of Object.entries(decisions)) {
      check(name.length <= MAX_FLAG_NAME_LENGTH && FLAG.test(name) && keys(decision, ['value', 'decidedBy', 'decidedAt', 'record'])
        && boolean(decision.value) && typeof decision.decidedBy === 'string'
        && decision.decidedBy.trim() === decision.decidedBy && decision.decidedBy.length > 0
        && decision.decidedBy.length <= 128 && !/[\x00-\x1f\x7f]/.test(decision.decidedBy)
        && typeof decision.decidedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(decision.decidedAt)
        && Number.isFinite(Date.parse(decision.decidedAt))
        && new Date(decision.decidedAt).toISOString().slice(0, 10) === decision.decidedAt
        && recordUrl(decision.record), 'release_flag_decisions_invalid');
    }
  }
  return structuredClone(value);
}

export function readFlagDecisions({ sourceRoot, sourceSha }) {
  check(isSha(sourceSha), 'release_flag_source_invalid');
  const git = args => execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', ...args], {
    cwd: sourceRoot, timeout: 15000, maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  let entry, bytes;
  try {
    entry = git(['ls-tree', '-z', sourceSha, '--', PATH]).toString('utf8');
    if (entry === '') return { format: FORMAT, targets: {} };
    const match = /^(100644|100755) blob ([a-f0-9]{40})\tdeploy\/shared-release\/flag-decisions\.json\0$/.exec(entry);
    check(match, 'release_flag_source_invalid');
    bytes = git(['cat-file', 'blob', match[2]]);
  } catch { check(false, 'release_flag_source_invalid'); }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { check(false, 'release_flag_decisions_invalid'); }
  return validateFlagDecisions(value);
}

// Only boolean flag values are public. A non-plain-text binding may never be
// replaced, and an unexpected live value must not leak through a public receipt.
export function applyFlagDecisions({ target, bindings, decisions }) {
  check(TARGETS.includes(target), 'release_flag_target_invalid');
  const selected = validateFlagDecisions(decisions).targets[target] ?? {};
  const expected = structuredClone(bindings), flagChanges = [];
  for (const name of Object.keys(selected).sort()) {
    const decision = selected[name], binding = expected.find(row => row.name === name);
    check(!binding || (binding.type === 'plain_text' && boolean(binding.text)), 'release_flag_live_binding_invalid');
    const from = binding?.text ?? null;
    if (from === decision.value) continue;
    if (binding) binding.text = decision.value;
    else expected.push({ name, type: 'plain_text', text: decision.value });
    flagChanges.push({ name, from, to: decision.value, record: decision.record });
  }
  checkChangesBudget(flagChanges);
  return { bindings: expected, flagChanges };
}

// An explicit whitelist, including in operator progress/failure receipts.
export function publicFlagChanges(value) {
  check(Array.isArray(value), 'release_flag_changes_invalid');
  check(new Set(value.map(item => item?.name)).size === value.length, 'release_flag_changes_invalid');
  check(value.length <= MAX_FLAG_CHANGES, 'release_flag_changes_too_many');
  const flagChanges = value.map(item => {
    check(object(item) && typeof item.name === 'string' && item.name.length <= MAX_FLAG_NAME_LENGTH
      && FLAG.test(item.name) && (item.from === null || boolean(item.from))
      && boolean(item.to) && item.from !== item.to && recordUrl(item.record), 'release_flag_changes_invalid');
    return { name: item.name, from: item.from, to: item.to, record: item.record };
  });
  checkChangesBudget(flagChanges);
  return flagChanges;
}

export function plannedFlagChanges(decisions, target) {
  return applyFlagDecisions({ target, bindings: [], decisions }).flagChanges;
}
