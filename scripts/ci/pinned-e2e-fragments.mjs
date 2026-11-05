import { createHash } from 'node:crypto';
import { mkdir, opendir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseJson, readBounded } from '../../packages/contribution-tools/io.mjs';
import { E2E_DEFAULT_SHARDS } from '../../packages/contribution-tools/pinned-e2e.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_FRAGMENT_BYTES = 64 * 1024 * 1024;
const format = 'freedom.e2e-default-fragment/v1';
const filename = current => `default-shard-${current}.json`;
const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parse = bytes => parseJson(bytes, { maxBytes: MAX_FRAGMENT_BYTES, maxDepth: 64, maxNodes: 1_000_000 });

// Transport identity, not a signature or standalone passing browser receipt.
// Artifacts must also come from this workflow run and attempt in the workflow.
export function defaultFragmentBinding(input, env = process.env) {
  const binding = {};
  for (const key of ['base', 'head', 'candidate']) {
    if (input[key] !== undefined && !/^[a-f0-9]{40}$/.test(input[key])) throw Error('invalid_default_fragment_binding');
    if (input[key] !== undefined) binding[key] = input[key];
  }
  if (!binding.candidate || !/^[a-f0-9]{40}$/.test(env.PINNED_SHA ?? '')
    || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]{0,9}$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) throw Error('invalid_default_fragment_binding');
  return { ...binding, workflow_sha: env.PINNED_SHA, run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT };
}

export async function writeDefaultFragment(directory, binding, shard, reportPath, listingPath) {
  const report = await readBounded(directory, reportPath, MAX_FRAGMENT_BYTES / 2);
  const fragment = { format, admission_evidence: false, binding, profile: 'full',
    current: shard.current, total: shard.total, exit_code: 0,
    report: report.toString('utf8'), evidence_sha256: digest(report) };
  if (shard.current === 1) {
    const listing = await readBounded(directory, listingPath, MAX_FRAGMENT_BYTES / 2);
    fragment.listing = listing.toString('utf8');
    fragment.listing_exit_code = 0;
    fragment.listing_evidence_sha256 = digest(listing);
  }
  // Caller publishes only after a zero exit without timeout/cancellation.
  return fragment;
}

export async function publishDefaultFragment(directory, fragment) {
  const bytes = JSON.stringify(fragment) + '\n';
  if (Buffer.byteLength(bytes) > MAX_FRAGMENT_BYTES) throw Error('default_fragment_too_large');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename(fragment.current)), bytes, { flag: 'wx', mode: 0o600 });
}

export async function readDefaultFragments(directory, binding) {
  const names = E2E_DEFAULT_SHARDS.map(shard => filename(shard.current));
  const found = [];
  for await (const entry of await opendir(directory)) {
    if (!entry.isFile() || found.length === names.length) throw Error('invalid_default_fragment_set');
    found.push(entry.name);
  }
  if (!exact(found.sort(), [...names].sort())) throw Error('invalid_default_fragment_set');
  const partitions = [];
  let listing, listing_evidence_sha256;
  for (const shard of E2E_DEFAULT_SHARDS) {
    const part = parse(await readBounded(directory, filename(shard.current), MAX_FRAGMENT_BYTES));
    if (part.format !== format || part.admission_evidence !== false || !exact(part.binding, binding)
      || part.profile !== 'full' || part.current !== shard.current || part.total !== shard.total || part.exit_code !== 0
      || typeof part.report !== 'string' || digest(part.report) !== part.evidence_sha256) throw Error('invalid_default_fragment');
    if (shard.current === 1) {
      if (part.listing_exit_code !== 0 || typeof part.listing !== 'string'
        || digest(part.listing) !== part.listing_evidence_sha256) throw Error('invalid_default_listing');
      listing = parse(part.listing); listing_evidence_sha256 = part.listing_evidence_sha256;
    } else if (part.listing !== undefined || part.listing_exit_code !== undefined || part.listing_evidence_sha256 !== undefined) {
      throw Error('unexpected_default_listing');
    }
    partitions.push({ current: shard.current, total: shard.total, exit_code: part.exit_code,
      report: parse(part.report), evidence_sha256: part.evidence_sha256 });
  }
  // The existing full evaluator must still prove config, inventory union,
  // every case outcome, and all five dedicated fixture passes.
  return { id: 'default', exit_code: 0, partitions, listing, listing_exit_code: 0, listing_evidence_sha256 };
}
