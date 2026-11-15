import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMigrationSources } from '../../../packages/db/migration-files.mjs';
import { legacyMigrationProfile, resolveMigrationPlan } from '../../../packages/db/migration-plan.mjs';

const sql = readFileSync(new URL('../../../migrations/210_work_public_sharing.sql', import.meta.url), 'utf8');

test('210 extends the exact unchanged 209 ledger with only its reviewed migration', () => {
  const sources = readMigrationSources(fileURLToPath(new URL('../../../migrations', import.meta.url)));
  const prior = resolveMigrationPlan(sources.filter(s => Number(s.name.slice(0, 3)) <= 209), legacyMigrationProfile({ first: 1, last: 209, known_gaps: [22] }));
  const next = resolveMigrationPlan(sources.filter(s => Number(s.name.slice(0, 3)) <= 210), legacyMigrationProfile({ first: 1, last: 210, known_gaps: [22] }), prior.ledger);
  assert.deepEqual(next.pending, ['210_work_public_sharing.sql']);
  assert.deepEqual(next.ledger.slice(0, -1), prior.ledger);
  assert.notEqual(next.ledger_digest, prior.ledger_digest);
});

test('210 stores opt-in work consent with default disabled and edit invalidation trigger', () => {
  assert.match(sql, /CREATE TABLE work_public_publications/);
  assert.match(sql, /enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql, /approved_work_version bigint NOT NULL CHECK \(approved_work_version >= 1\)/);
  assert.match(sql, /CREATE TRIGGER work_public_sharing_invalidation/);
  assert.match(sql, /SET enabled = false/);
  assert.doesNotMatch(sql, /\bINSERT INTO work_public_publications\b/i);
  assert.doesNotMatch(sql, /\bGRANT\b|SECURITY DEFINER|CREATE ROLE|\b(?:INSERT INTO|UPDATE|ALTER TABLE)\s+(?:payments|agent_connections|member_client_connections)/i);
});
