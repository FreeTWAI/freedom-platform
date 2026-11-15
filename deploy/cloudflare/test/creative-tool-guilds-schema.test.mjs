import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/206_creative_tool_guilds.sql',import.meta.url),'utf8');
test('206 extends the exact unchanged 205 ledger with only its reviewed migration',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=205),legacyMigrationProfile({first:1,last:205,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=206),legacyMigrationProfile({first:1,last:206,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['206_creative_tool_guilds.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);
 assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('creative guild catalog seeds neither memberships nor approved categories or appointments',()=>{
 assert.match(sql,/'guild_games','games'/); assert.match(sql,/'guild_ar','ar'/);
 assert.match(sql,/'game_creator'/); assert.match(sql,/'ar_creator'/);
 for(const guild of ['guild_games','guild_ar'])assert(sql.includes(`('${guild}',NULL,'pending',nextval('guild_catalog_revision'),'{}',true)`));
 const tables=[...sql.matchAll(/INSERT INTO (\w+)/g)].map(m=>m[1]);
 assert.deepEqual(tables,['positioning_guild_catalog','positioning_track_catalog','guild_catalog_categories']);
 assert.doesNotMatch(sql,/\bUPDATE\b|\bDELETE\b|\bGRANT\b|SECURITY DEFINER|CREATE ROLE/i);
});
