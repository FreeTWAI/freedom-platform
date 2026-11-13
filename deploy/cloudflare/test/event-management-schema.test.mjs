import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/209_event_management.sql',import.meta.url),'utf8');
test('209 extends the exact unchanged 208 ledger with only its reviewed migration',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=208),legacyMigrationProfile({first:1,last:208,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=209),legacyMigrationProfile({first:1,last:209,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['209_event_management.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);
 assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('management stores versioned changes and bounded announcements without exporting contacts',()=>{
 assert.match(sql,/PRIMARY KEY\(event_id,event_version\)/);
 assert.match(sql,/length\(trim\(body\)\) BETWEEN 1 AND 300/);
 assert.match(sql,/ADD COLUMN body text CHECK\(length\(body\)<=2000\)/);
 assert.doesNotMatch(sql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE/i);
});
