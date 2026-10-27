import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {registerPublicMemberProfiles} from '../../apps/platform-api/src/features/public-member-profiles.js';
import {memberVisitorProfile,publicVisitorProfile} from '../../modules/identity-membership/profile-publication.js';
import {Problem} from '../../packages/shared/problem.js';
const id='00000000-0000-4000-8000-000000000001';
const row={display_name:'Confirmed',bio:'Hello',links:[],email:'never',orders:['never']};
test('public HTTP always uses a single public-only query, no ETag/304 or Cookie augmentation',async()=>{
  const queries:{sql:string;values:unknown[]}[]=[];
  const pool={query:async(sql:string,values:unknown[])=>{queries.push({sql,values});return {rows:[row]};}};
  const app=new Hono();registerPublicMemberProfiles(app as any,{pool} as any);
  for(const Cookie of ['', 'session=some-credential']){
    const response=await app.request(`/api/v1/public/member-profiles/${id}`,{headers:{Cookie,'If-None-Match':'"old"'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(response.headers.get('ETag'),null);assert.equal(response.headers.get('Vary'),'Cookie');
    assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
    assert.deepEqual(await response.json(),{display_name:'Confirmed',bio:'Hello',links:[],avatar_url:null});
  }
  assert.equal(queries.length,2);assert.deepEqual(queries[0],queries[1]);
  assert.match(queries[0].sql,/p.visibility='public'/);assert.deepEqual(queries[0].values,[id]);
});
test('member projection is one statement including scope, readiness and reciprocal block; no inventory queries',async()=>{
  const queries:string[]=[];
  const q={query:async(sql:string)=>{queries.push(sql);return {rows:[row]};}};
  const result=await memberVisitorProfile(q as any,{community_id:'community',user_id:id} as any,id);
  assert.equal(result.profile.display_name,'Confirmed');assert.equal(queries.length,1);
  for(const pattern of [/p.community_id=\$1/,/p.visibility IN \('members','public'\)/,/member_interaction_blocks/,/b.owner_ref=p.user_id/,/v.active/,/u.active/,/is_verification_test_account/])assert.match(queries[0],pattern);
  assert.doesNotMatch(queries[0],/member_accounts|member_direct_messages|personal_content/);
});
test('missing/private/revoked projection returns one indistinguishable 404, no cached prior response',async()=>{
  let visible=true;
  const q={query:async()=>({rows:visible?[row]:[]})};
  assert.equal((await publicVisitorProfile(q as any,id)).display_name,'Confirmed');visible=false;
  await assert.rejects(()=>publicVisitorProfile(q as any,id),(error:unknown)=>error instanceof Problem&&error.status===404);
  await assert.rejects(()=>memberVisitorProfile(q as any,{community_id:'community',user_id:id} as any,id),(error:unknown)=>error instanceof Problem&&error.status===404);
});
test('authenticated actions distinguish self, incoming, outgoing and accepted without widening public DTO',async()=>{
 const peer='00000000-0000-4000-8000-000000000002';
 for(const [self,state,requester,request,accept,message] of [
  [true,'none',null,false,false,false],[false,'none',null,true,false,true],
  [false,'pending',peer,false,true,true],[false,'pending',id,false,false,true],[false,'accepted',peer,false,false,true],
 ] as const){
  const q={query:async()=>({rows:[{...row,is_self:self,friendship_state:state,requester_ref:requester,friendship_version:state==='none'?null:4}]})};
  const result=await memberVisitorProfile(q as any,{community_id:'community',user_id:id} as any,peer);
  assert.deepEqual([result.actions.can_request,result.actions.can_accept,result.actions.can_message],[request,accept,message]);
  assert.deepEqual(Object.keys(result.profile).sort(),['avatar_url','bio','display_name','links']);
 }
});
