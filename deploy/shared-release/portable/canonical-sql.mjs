import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { requireRelease as check, isSha } from '../admission.mjs';

const NAMES = ['20-runtime-grants.psql', '30-verify-readonly.psql'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read the two canonical programs from the admitted immutable Git object, not
 * a mutable pathname or a dispatch-supplied SQL program. Installation admission
 * separately checks the clean source/tree and migration closure. */
export function readCanonicalSql(sourceRoot, sourceCommit) {
  check(isSha(sourceCommit), 'release_canonical_source_invalid');
  const files = {}, hashes = {};
  for (const name of NAMES) {
    const bytes = execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
      'show', `${sourceCommit}:deploy/cloudflare/sql/${name}`], { cwd: sourceRoot, timeout: 15_000,
      maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
    files[name] = new TextDecoder('utf-8', { fatal: true }).decode(bytes); hashes[name] = digest(bytes);
  }
  return Object.freeze({ files: Object.freeze(files), hashes: Object.freeze(hashes), sourceCommit });
}

/** Small interpreter for the existing reviewed psql programs. No shell/meta
 * command execution. Grants join the caller's transaction: never nested COMMIT.
 * gexec executes only one bounded SQL string per result row from that program. */
export async function runCanonicalSql(q, canonical, name, { runtime, migrator }) {
  check(NAMES.includes(name) && /^[a-z][a-z0-9_]{0,62}$/.test(runtime)
    && /^[a-z][a-z0-9_]{0,62}$/.test(migrator), 'release_canonical_input_invalid');
  let text = canonical?.files?.[name];
  check(typeof text === 'string' && text.length <= 262144 && digest(text) === canonical.hashes[name],
    'release_canonical_changed');
  text = text.replace(/^\\set (?:runtime|migrator) :env_prefix '_(?:app|migrator)'\r?\n/gm, '');
  if (name === '20-runtime-grants.psql') {
    check((text.match(/^BEGIN;$/gm) ?? []).length === 1 && (text.match(/^COMMIT;$/gm) ?? []).length === 1,
      'release_canonical_transaction_invalid');
    text = text.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
  }
  for (const [key, value] of Object.entries({ runtime, migrator })) {
    text = text.replaceAll(`:"${key}"`, `"${value}"`).replaceAll(`:'${key}'`, `'${value}'`);
  }
  check(!/:["'][a-z_]+["']/.test(text) && !/^\s*\\(?!gexec\s*$)/m.test(text), 'release_canonical_directive_invalid');
  const chunks = text.split(/^\\gexec\s*$/m), rows = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i].trim()) continue;
    const result = await q.query(chunks[i]);
    const results = Array.isArray(result) ? result : [result];
    rows.push(...results.flatMap(item => item.rows ?? []));
    if (i < chunks.length - 1) {
      const generated = results.at(-1)?.rows;
      check(Array.isArray(generated) && generated.length <= 1000, 'release_canonical_result_invalid');
      for (const row of generated) {
        const values = Object.values(row);
        check(values.length === 1 && typeof values[0] === 'string' && values[0].length <= 20000,
          'release_canonical_result_invalid');
        await q.query(values[0]);
      }
    }
  }
  return rows;
}
