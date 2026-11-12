import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readMigrationSources} from '../../../packages/db/migration-files.mjs';
import {legacyMigrationProfile,resolveMigrationPlan} from '../../../packages/db/migration-plan.mjs';
const sql=readFileSync(new URL('../../../migrations/208_event_publication.sql',import.meta.url),'utf8');
test('208 extends the exact unchanged 207 ledger with only its reviewed migration',()=>{
 const sources=readMigrationSources(fileURLToPath(new URL('../../../migrations',import.meta.url)));
 const prior=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=207),legacyMigrationProfile({first:1,last:207,known_gaps:[22]}));
 const next=resolveMigrationPlan(sources.filter(s=>Number(s.name.slice(0,3))<=208),legacyMigrationProfile({first:1,last:208,known_gaps:[22]}),prior.ledger);
 assert.deepEqual(next.pending,['208_event_publication.sql']);
 assert.deepEqual(next.ledger.slice(0,-1),prior.ledger);
 assert.notEqual(next.ledger_digest,prior.ledger_digest);
});
test('event metadata preserves platform registration and requires explicit publication and claim review',()=>{
 assert.match(sql,/imported boolean NOT NULL DEFAULT false/);
 assert.match(sql,/registration_mode text NOT NULL DEFAULT 'platform' CHECK\(registration_mode IN \('platform','external'\)\)/);
 assert.match(sql,/state text NOT NULL DEFAULT 'pending' CHECK\(state IN \('pending','verified','rejected','revoked'\)\)/);
 // Reports pause a published event; retracting a share never cancels the event.
 assert.match(sql,/IF NEW.kind='event' AND NEW.state='hidden' AND OLD.state='published' THEN\s+UPDATE community_events SET state='pending',/);
 // Only a platform admin's restore leaves 'hidden'; it republishes just the event the hold paused.
 assert.match(sql,/ELSIF NEW.kind='event' AND OLD.state='hidden' AND NEW.state IN \('published','retracted'\) THEN\s+UPDATE community_events SET state='published',aggregate_version=aggregate_version\+1,updated_at=now\(\)\s+WHERE event_id=NEW.ref_id AND community_id=NEW.community_id AND state='pending';/);
 assert.equal(sql.match(/SET state='published'/gi)?.length,1);
 assert.doesNotMatch(sql,/'cancelled'/);
 assert.match(sql,/WHERE event_id=NEW.ref_id AND community_id=NEW.community_id AND state='published'/);
 assert.match(sql,/CREATE TRIGGER event_promotion_credit/);
 assert.match(sql,/CREATE TABLE community_event_registration_credit_people/);
 assert.match(sql,/PRIMARY KEY\(event_id,user_id\)/);
 assert.doesNotMatch(sql,/\bGRANT\b|SECURITY DEFINER|CREATE ROLE|\b(?:INSERT INTO|UPDATE|ALTER TABLE)\s+(?:payments|agent_connections|member_client_connections)/i);
});
