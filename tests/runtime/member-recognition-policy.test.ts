import test from 'node:test';
import assert from 'node:assert/strict';
import {CERTIFICATION_POLICY, countEligibleOutcomes, proposedMilestone, proposedRecognitionDisplay} from '../../modules/member-recognition/policy.js';
import type {OutcomeEvidence, RecognitionDisplayContext} from '../../modules/member-recognition/contracts.js';
const context: RecognitionDisplayContext = {audience:'member',profileReadable:true,sameCommunity:true,currentSession:true,showCommunityCertification:true,showContributionBadges:true};
const fact = {state:'active',aggregateVersion:1,policyVersion:CERTIFICATION_POLICY} as const;
const work = (n=1): OutcomeEvidence => ({workId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,mode:'community_collaboration',accepted:true,basis:'accepted_delivery',current:true});
for (const [count, label] of [[0,undefined],[1,'初次貢獻'],[4,'初次貢獻'],[5,'協作夥伴'],[19,'協作夥伴'],[20,'持續貢獻者'],[49,'持續貢獻者'],[50,'長期共創者'],[51,'長期共創者']] as const) {
  test(`proposed threshold ${count}`,()=>assert.equal(proposedMilestone(count)?.label,label));
}
test('reject malformed counts without rounding or coercion',()=>{
  for(const n of [-1,0.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,'5',null,undefined]) assert.throws(()=>proposedMilestone(n as number));
});
test('unique Work, not roles, replays or case variations',()=>{
  const a={...work(),workId:'abcdefab-abcd-4abc-8abc-abcdefabcdef'};
  assert.equal(countEligibleOutcomes([a,{...a,basis:'confirmed_role'},{...a,workId:a.workId.toUpperCase()},work(2)]),2);
});
test('exclude private, tenant, unaccepted and withdrawn/pending role evidence',()=>{
  assert.equal(countEligibleOutcomes([{...work(),mode:'private'},{...work(2),mode:'tenant'},{...work(3),accepted:false},{...work(4),basis:'confirmed_role',current:false}]),0);
  assert.equal(countEligibleOutcomes([work(),{...work(),basis:'confirmed_role',current:false}]),1);
});
test('invalid evidence rejected, not silently counted',()=>{
  for(const row of [null,{}, {...work(),workId:'fake'}, {...work(),accepted:'true'}, {...work(),basis:'invites'}, {...work(),mode:'public'}, {...work(),score:100}]) assert.throws(()=>countEligibleOutcomes([row as OutcomeEvidence]));
  assert.throws(()=>countEligibleOutcomes(null as unknown as OutcomeEvidence[]));
});
test('anonymous, denied, different community and expired views omit all fields',()=>{
  for(const patch of [{audience:'anonymous'},{profileReadable:false},{sameCommunity:false},{currentSession:false}] as const) assert.deepEqual(proposedRecognitionDisplay({...context,...patch},[work()],fact),{});
});
test('independent opt-ins, no inferred consent',()=>{
  assert.deepEqual(proposedRecognitionDisplay({...context,showCommunityCertification:false,showContributionBadges:false},[work()],fact),{});
  assert.deepEqual(Object.keys(proposedRecognitionDisplay({...context,showCommunityCertification:false},[work()],fact)),['contributionMilestone']);
  assert.deepEqual(Object.keys(proposedRecognitionDisplay({...context,showContributionBadges:false},[work()],fact)),['communityCertification']);
  assert.throws(()=>proposedRecognitionDisplay({...context,showContributionBadges:undefined} as unknown as RecognitionDisplayContext,[],fact));
});
test('revoked or missing certification never becomes blue check through contributions',()=>{
  assert.equal(proposedRecognitionDisplay(context,[work()],{...fact,state:'revoked'}).communityCertification,undefined);
  assert.equal(proposedRecognitionDisplay(context,[work()]).communityCertification,undefined);
});
test('certification requires exact proposed policy and version',()=>{
  for(const patch of [{aggregateVersion:0},{aggregateVersion:NaN},{policyVersion:'identity_verified'},{state:'pending'}]) assert.throws(()=>proposedRecognitionDisplay(context,[],{...fact,...patch} as typeof fact));
});
test('public DTO has distinct icons, explicit semantics, no count or audit details',()=>{
  const dto=proposedRecognitionDisplay(context,[work()],fact);
  assert.equal(dto.communityCertification?.icon,'blue-check'); assert.equal(dto.contributionMilestone?.icon,'sprout');
  assert.match(dto.communityCertification!.accessibleDescription,/非實名查驗/);
  for(const badge of Object.values(dto)) assert.deepEqual(Object.keys(badge).sort(),['accessibleDescription','icon','kind','label','policyVersion']);
});
