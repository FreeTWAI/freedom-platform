import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkMigrations} from '../lib/migrations.mjs';
import {compatibilityLedgerDigest,evaluateReleaseCompatibility} from '../lib/release-compatibility.mjs';
const root=fileURLToPath(new URL('../../../migrations',import.meta.url));
function fixture(){
 const scan=checkMigrations(root,{first:1,last:197,known_gaps:[22]});
 const candidate={source_sha:'a'.repeat(40),artifact_sha256:'b'.repeat(64)},target={environment:'next',database_identity:'synthetic-certification',recovery_generation:'1'};
 const input={schema:'freedom.release-compatibility-request/v1',environment:'next',candidate,enable_shapes:[]};
 const floor=structuredClone(scan.ledger.filter(row=>Number(row.name.slice(0,3))<=194)),now=1790899200000;
 const host={schema:'freedom.release-compatibility-host/v2',target,now_ms:now,max_age_ms:30000,rollback_floor_shapes:[],
  rollback_floor:{evidence_id:'synthetic-floor',target:{...target},schema_ledger:floor,schema_ledger_digest:compatibilityLedgerDigest(floor),capabilities:[]},
  observation:{evidence_id:'synthetic-observation',observed_at_ms:now-1000,target:{...target},schema_ledger:structuredClone(scan.ledger),schema_ledger_digest:scan.ledger_digest,enabled_shapes:[],written_shapes:[],active_releases:[candidate],complete:true},
  release_records:[{...candidate,evidence_id:'synthetic-approval',status:'approved',environments:['next'],schema_ledger_digests:[scan.ledger_digest],capabilities:['identity.passwordless-null-safe.v1','platform.legacy.v1','work.explicit-wire.v1','community.guest-invitation-credit.v1','commerce.hosted-payment.v1','commerce.checkout-contact-retention.v1','commerce.hosted-checkout.v1','opensource.sharing-visibility.v1','commerce.hosted-supply-catalog.v1','commerce.hosted-inventory-reservation.v1'],approved_at_ms:now-1000,expires_at_ms:now+30000}]};
 return {scan,input,host};
}
const evaluate=f=>evaluateReleaseCompatibility(f.input,{scan:f.scan,host:f.host});
const codes=result=>result.issues.map(issue=>issue.code);
test('integrated schema197 certification records recognize exact identity without granting publication or release authority',()=>{
 const f=fixture();assert.equal(f.scan.ok,true);assert.equal(f.scan.ledger.at(-1).name,'197_event_registration_policy.sql');assert(f.scan.ledger.some(row=>row.name==='193_member_community_certifications.sql'));
 assert(f.scan.ledger.some(row=>row.name==='194_social_achievements.sql'));
 assert(f.scan.ledger.some(row=>row.name==='195_event_helpers.sql'));
 assert(f.scan.ledger.some(row=>row.name==='196_event_missions.sql'));
 const result=evaluate(f);assert.equal(result.status,'compatible');assert.deepEqual(result.required_shapes,[]);
 for(const flag of ['deployment_authority','execution_authority','restore_proof'])assert.equal(result[flag],false);
 assert.equal(result.required_capabilities.some(value=>value.includes('certification')),false);
});
test('integrated schema197 does not reuse schema194/195/196 approvals and still requires independent host evidence',()=>{
 for(const through of [193,194,195,196]){
  const f=fixture(),old=f.scan.ledger.filter(row=>Number(row.name.slice(0,3))<=through);
  f.host.release_records[0].schema_ledger_digests=[compatibilityLedgerDigest(old)];assert(codes(evaluate(f)).includes('release_schema_unsupported'));
 }
 const f=fixture();
 assert.deepEqual(codes(evaluateReleaseCompatibility(f.input,{scan:f.scan})),['trusted_host_required']);
});
test('integrated schema197 rejects renamed, changed, future and gapped catalogs',()=>{
 for(const [name,expected] of [['197_unreviewed.sql','schema_unknown'],['198_member_community_certifications.sql','schema_ledger_invalid']]){
  const f=fixture();f.scan.ledger.at(-1).name=name;f.scan.ledger_digest=compatibilityLedgerDigest(f.scan.ledger);assert.deepEqual(codes(evaluate(f)),[expected]);
 }
 for(const index of [-4,-3,-2,-1]){
  const changed=fixture();changed.scan.ledger.at(index).sha256='d'.repeat(64);changed.scan.ledger_digest=compatibilityLedgerDigest(changed.scan.ledger);assert(codes(evaluate(changed)).includes('schema_ledger_mismatch'),JSON.stringify(evaluate(changed)));
 }
 const historical=fixture();historical.scan.ledger.at(-4).name='194_unreviewed.sql';historical.scan.ledger_digest=compatibilityLedgerDigest(historical.scan.ledger);assert.deepEqual(codes(evaluate(historical)),['schema_unknown']);
 const future=fixture();future.scan.ledger.push({name:'198_unreviewed.sql',sha256:'e'.repeat(64)});future.scan.ledger_digest=compatibilityLedgerDigest(future.scan.ledger);assert.deepEqual(codes(evaluate(future)),['schema_unknown']);
});

test('integrated schema197 retains the main Google NULL-safe password capability requirement',()=>{
 const f=fixture();f.host.release_records[0].capabilities=f.host.release_records[0].capabilities.filter(value=>value!=='identity.passwordless-null-safe.v1');
 const result=evaluate(f);assert.equal(result.status,'incompatible');assert(result.issues.some(issue=>issue.code==='release_capability_missing'&&issue.capability==='identity.passwordless-null-safe.v1'));
});
