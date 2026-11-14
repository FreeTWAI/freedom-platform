import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/204_shares.sql',import.meta.url),'utf8');
test('204 extends the exact unchanged 203 ledger with only its reviewed migration',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=203),legacyMigrationProfile({first:1,last:203,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=204),legacyMigrationProfile({first:1,last:204,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['204_shares.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);
 assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('shares default to published while credit is retained, reversible attribution rather than payment or authority',()=>{
 assert.match(sql,/state text NOT NULL DEFAULT 'published' CHECK \(state IN \('published','hidden','retracted'\)\)/);
 assert.match(sql,/UNIQUE \(community_id,kind,canonical_key\)/);
 assert.match(sql,/share credit is append-only/); assert.match(sql,/invalid credit reversal/);
 assert.match(sql,/shares are retained/); assert.match(sql,/share identity is immutable/);
 assert.match(sql,/IF s.state IS DISTINCT FROM 'published' THEN RETURN NULL/);
 assert.match(sql,/is_verification_test_account\(NEW.user_id\)/);
 assert.match(sql,/NEW.actor_user_id=NEW.user_id THEN RETURN NULL/);
 assert.match(sql,/CREATE UNIQUE INDEX share_credit_fact ON share_credit_events\(community_id,basis,source_ref\) WHERE units=1/);
 assert.match(sql,/CREATE TRIGGER promotion_share_credit/); assert.match(sql,/CREATE TRIGGER repo_claim_share_credit/);
 assert.doesNotMatch(sql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE|\b(?:INSERT INTO|UPDATE|ALTER TABLE)\s+(?:payments|member_client_connections|agent_connections|platform_admin)/i);
});
