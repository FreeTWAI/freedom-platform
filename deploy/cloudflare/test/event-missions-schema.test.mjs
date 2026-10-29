import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {LEGACY_MIGRATIONS,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
import {checkMigrations} from '../lib/migrations.mjs';

const root=fileURLToPath(new URL('../../../migrations',import.meta.url));
const profile=last=>({format:LEGACY_MIGRATIONS,first:1,last,known_gaps:[22]});
const sources=()=>readMigrationSources(root);
const historical=()=>resolveMigrationPlan(sources().filter(row=>Number(row.name.slice(0,3))<=195),profile(195));

test('mission candidate preserves exact PR1170 schema195 ledger without treating it as approval for196',()=>{
 const old=historical();
 assert.equal(old.ledger.at(-1).name,'195_event_helpers.sql');
 assert.equal(old.ledger_digest,'63ce756c3265756c4bad892137a189f1a47b9a43c982c6ad49ebcfff840e3503');
 const next=resolveMigrationPlan(sources(),profile(196),old.ledger);
 assert.deepEqual(next.pending,['196_event_missions.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),old.ledger);
 assert.notEqual(next.ledger_digest,old.ledger_digest);
});

test('explicit196 scan accepts only complete catalog; stale195 profile is not silently advanced',()=>{
 assert.equal(checkMigrations(root,profile(196)).ok,true);
 assert.equal(checkMigrations(root,profile(195)).ok,false);
 assert.equal(checkMigrations(root,profile(194)).ok,false);
 assert.throws(()=>resolveMigrationPlan(sources().filter(row=>row.name!=='195_event_helpers.sql'),profile(196)));
});

test('mission schema has no attendee, friend or Contribution write and clearing is not a hard-erasure claim',()=>{
 const sql=sources().find(row=>row.name==='196_event_missions.sql').sql;
 assert.match(sql,/CREATE TABLE event_mission_progress/);
 assert.match(sql,/UNIQUE\(event_id,member_ref\)/);
 assert.match(sql,/NOT enabled AND slots='\[\]'::jsonb/);
 assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE|ALTER TABLE)\s+(?:contributions|community_event_rsvps|community_event_helpers|friendships|social_achievement)/i);
});

test('mission identity binds both referenced rows to the same community, including retained tombstones',()=>{
 const sql=sources().find(row=>row.name==='196_event_missions.sql').sql;
 assert.match(sql,/CONSTRAINT event_mission_event_community_fk\s+FOREIGN KEY\(event_id,community_id\) REFERENCES community_events\(event_id,community_id\) ON DELETE CASCADE/);
 assert.match(sql,/CONSTRAINT event_mission_member_community_fk\s+FOREIGN KEY\(member_ref,community_id\) REFERENCES users\(user_id,community_id\) ON DELETE CASCADE/);
 assert.match(sql,/community_id uuid NOT NULL REFERENCES communities/);
 assert.match(sql,/event_id uuid NOT NULL,/);assert.match(sql,/member_ref uuid NOT NULL,/);
});
