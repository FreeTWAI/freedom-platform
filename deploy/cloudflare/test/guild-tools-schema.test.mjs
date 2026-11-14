import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/207_guild_tools.sql',import.meta.url),'utf8');
test('207 extends the exact unchanged 206 ledger with only its reviewed migration',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=206),legacyMigrationProfile({first:1,last:206,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=207),legacyMigrationProfile({first:1,last:207,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['207_guild_tools.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);
 assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('guild tool registrations retain revision history, reports, attribution and append-only audit without authority grants',()=>{
 const tables=[...sql.matchAll(/CREATE TABLE (\w+)/g)].map(m=>m[1]);
 assert.deepEqual(tables,['guild_tools','guild_tool_revisions','guild_tool_reports','guild_tool_subjects','guild_tool_audit','guild_tool_share_sources','guild_tool_origin_challenges','guild_tool_token_grants']);
 assert.match(sql,/state IN \('pending','enabled','disabled'\)/);
 assert.match(sql,/bridge_version='freedom.guild-launchpad\/v2'/);
 assert.match(sql,/profile IN \('sandboxed','origin'\)/);
 assert.match(sql,/UNIQUE\(guild_key,tool_id\)/);
 assert.match(sql,/PRIMARY KEY\(tool,revision,reporter\)/);
 assert.match(sql,/PRIMARY KEY\(share_id,tool,revision,member\)/);
 assert.match(sql,/CHECK \(\(actor IS NULL\) <> \(admin IS NULL\)\)/);
 assert.match(sql,/guild tool history is append only/);
 for(const table of ['guild_tool_revisions','guild_tool_audit'])assert.match(sql,new RegExp(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table}`));
 assert.doesNotMatch(sql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE|\b(?:INSERT INTO|UPDATE|ALTER TABLE)\s+(?:shares|payments|member_client_connections|agent_connections|platform_admins)/i);
});
test('origin challenges and identity grants record expiry and bind each grant to exactly one browser session or agent connection',()=>{
 assert.match(sql,/origin text NOT NULL, token text NOT NULL, expires_at timestamptz NOT NULL/);
 assert.match(sql,/jti uuid PRIMARY KEY, tool uuid NOT NULL REFERENCES guild_tools, revision integer NOT NULL/);
 assert.match(sql,/member uuid NOT NULL REFERENCES users, session_hash text, agent_connection uuid REFERENCES member_client_connections\(connection_id\)/);
 assert.match(sql,/expires_at timestamptz NOT NULL, CHECK \(\(session_hash IS NULL\) <> \(agent_connection IS NULL\)\)/);
 assert.match(sql,/CREATE INDEX guild_tool_token_expiry ON guild_tool_token_grants\(expires_at\)/);
});
