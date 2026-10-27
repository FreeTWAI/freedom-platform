import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkModules } from '../modules.mjs';

// The portable CLI export excludes tests. This test guards the platform's real
// product sources while modules.test.mjs exercises small consumer repositories.
test('platform product sources retain valid module ownership and dependency references', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const report = await checkModules(root);
  assert.ok(report.checked_source_count > 0, 'scan the real product source tree');
  assert.deepEqual(report.warnings, report.unknown_paths.map(path => ({ code: 'surface_unmapped', path })),
    'unmapped sources remain visible warnings; the selector retains full fallback');
  assert.deepEqual(report.issues, [], 'module dependencies and referenced files must remain valid');
  assert.equal(report.status, 'passed');
});
