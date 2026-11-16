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
 assert.doesNotMatch(sql,/\b(?:ALTER TABLE|UPDATE|INSERT INTO)\s+member_client_connections\b/i);
 assert.match(sql,/CREATE TABLE agent_token_connections/);
 assert.match(sql,/CHECK\(kind='agent'\)/); assert.match(sql,/CHECK\(scope='agent'\)/);
 assert.match(sql,/token_hash text NOT NULL UNIQUE/);
 assert.match(sql,/cardinality\(scopes\)>0 AND scopes <@ ARRAY\['read','share','rsvp','react','message'\]::text\[\]/);
 assert.match(sql,/public_daily_cap BETWEEN 0 AND 20/); assert.match(sql,/reaction_daily_cap BETWEEN 0 AND 100/);
 assert.match(sql,/public_confirmed_at timestamptz/);
 assert.match(sql,/CREATE TRIGGER revoke_agent_tokens_on_deactivation AFTER UPDATE OF active ON users/);
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
test('215 creates agent_change_pings extending the 214 ledger without authority grants',()=>{
 const pingsSql=readFileSync(new URL('../../../migrations/215_agent_change_pings.sql',import.meta.url),'utf8');
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=214),legacyMigrationProfile({first:1,last:214,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=215),legacyMigrationProfile({first:1,last:215,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['215_agent_change_pings.sql']);
 assert.match(pingsSql,/CREATE TABLE agent_change_pings/);
 assert.match(pingsSql,/connection_id uuid PRIMARY KEY REFERENCES agent_token_connections\(connection_id\) ON DELETE CASCADE/);
 assert.match(pingsSql,/notify_url text NOT NULL CHECK\(char_length\(notify_url\) BETWEEN 12 AND 2048 AND notify_url LIKE 'https:\/\/%'\)/);
 assert.match(pingsSql,/last_error text CHECK\(last_error IN \('timeout','network','redirect','http_status','rejected_url'\)\)/);
 assert.doesNotMatch(pingsSql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE|\b(?:INSERT INTO|UPDATE|ALTER TABLE)\s+(?:shares|payments|member_client_connections|agent_connections|platform_admins)/i);
});
test('216 drops NOT NULL on community_journal_submissions.key_id extending the 215 ledger',()=>{
 const journalSql=readFileSync(new URL('../../../migrations/216_community_journal_member_submissions.sql',import.meta.url),'utf8');
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=215),legacyMigrationProfile({first:1,last:215,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=216),legacyMigrationProfile({first:1,last:216,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['216_community_journal_member_submissions.sql']);
 assert.match(journalSql,/ALTER TABLE community_journal_submissions ALTER COLUMN key_id DROP NOT NULL/);
 assert.doesNotMatch(journalSql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE/i);
});
