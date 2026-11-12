import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/205_agent_tokens.sql',import.meta.url),'utf8');
test('205 extends the exact unchanged 204 ledger with only its reviewed migration',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=204),legacyMigrationProfile({first:1,last:204,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=205),legacyMigrationProfile({first:1,last:205,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['205_agent_tokens.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);
 assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('205 preserves both legacy read kinds and bounds the new hashed agent-token lane',()=>{
 assert.match(sql,/\(kind='storefront' AND scope='storefront:read' AND store_id IS NOT NULL AND scopes='\{\}'\)/);
 assert.match(sql,/\(kind='supplier' AND scope='supplier:read' AND store_id IS NULL AND scopes='\{\}'\)/);
 assert.match(sql,/kind='agent' AND scope='agent' AND store_id IS NULL AND token_hash IS NOT NULL/);
 assert.match(sql,/cardinality\(scopes\)>0 AND scopes <@ ARRAY\['read','share','rsvp','react','message'\]::text\[\]/);
 assert.match(sql,/public_daily_cap BETWEEN 0 AND 20/); assert.match(sql,/reaction_daily_cap BETWEEN 0 AND 100/);
 assert.match(sql,/ADD COLUMN public_confirmed_at timestamptz/);
 assert.doesNotMatch(sql,/DROP CONSTRAINT member_client_connections_token_hash|\bGRANT\b|SECURITY DEFINER|CREATE ROLE|\b(?:ALTER TABLE|UPDATE|INSERT INTO)\s+(?:agent_connections|runtime_registrations|broker_model_credentials)/i);
});
test('agent publication receipts and recipient change cursors do not authorize publication by themselves',()=>{
 assert.match(sql,/CREATE TABLE agent_pending_publications/); assert.match(sql,/approved_at timestamptz/);
 assert.match(sql,/via_agent boolean NOT NULL DEFAULT true CHECK\(via_agent\)/);
 assert.match(sql,/PRIMARY KEY\(connection_id,operation,idempotency_key\)/);
 assert.match(sql,/UNIQUE\(user_id,source_key\), UNIQUE\(user_id,cursor\)/);
 assert.match(sql,/WHERE user_id=p_user AND community_id=p_community/);
 assert.match(sql,/recipient.community_id=sender.community_id/);
 assert.doesNotMatch(sql,/\bUPDATE\s+community_events\s+SET\s+state\s*=\s*'published'/i);
});
