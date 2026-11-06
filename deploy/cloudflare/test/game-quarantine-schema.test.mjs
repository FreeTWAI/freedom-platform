import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/203_member_game_quarantine.sql',import.meta.url),'utf8');
test('203 is one additive migration over the exact unchanged202 ledger',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=202),legacyMigrationProfile({first:1,last:202,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources,legacyMigrationProfile({first:1,last:203,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['203_member_game_quarantine.sql']);assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('source schema remains personal, opaque, unreviewed and default closed',()=>{
 assert.match(sql,/FOREIGN KEY\(owner_user_id,community_id\) REFERENCES users\(user_id,community_id\)/);
 assert.match(sql,/scope_kind text GENERATED ALWAYS AS \('personal'::text\)/);
 assert.match(sql,/content_type='application\/octet-stream'.*byte_size BETWEEN 1 AND 262144/);
 assert.match(sql,/trust text NOT NULL DEFAULT 'unreviewed' CHECK\(trust='unreviewed'\)/);
 assert.match(sql,/VALUES\('member.game-source','legacy',false,NULL,NULL\)/);
 assert.doesNotMatch(sql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE|UPDATE asset_maintenance_policy/);
 assert.match(sql,/target_game_id IS NULL/);assert.match(sql,/target_game_id IS NOT NULL/);
 assert.match(sql,/source_content_type='text\/html'/);
 for(const field of ['prize_photo','profile_cover','work','tenant','instance','community','ar','message_image','event'])assert(sql.includes(`target_${field}_id IS NULL`));
});
test('private revision and CAS constraints preserve frozen history and require atomic finalization',()=>{
 assert.match(sql,/FOREIGN KEY\(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,asset_state\)/);
 assert.match(sql,/Game source revisions are immutable/);assert.match(sql,/Game draft history is retained/);
 assert.match(sql,/Game upload target is immutable/);assert.match(sql,/OLD.state='withdrawn'/);
 assert.match(sql,/NEW.aggregate_version<>OLD.aggregate_version\+1/);
 assert.match(sql,/CREATE TRIGGER reject_fenced_asset_reference/);
 assert.match(sql,/i.state='stored'/);assert.match(sql,/state='finalized'/);
 assert.match(sql,/Game CAS requires its source revision/);
 assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/);
 const locks=sql.indexOf('PERFORM 1 FROM domain_media_storage_policy');assert(locks>0&&sql.indexOf('i.expires_at>clock_timestamp()',locks)>locks);
});
