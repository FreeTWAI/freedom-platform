import {defaultProfileLayout} from '../../packages/shared/member-profile.js';
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
    assert.deepEqual(await response.json(),{display_name:'Confirmed',bio:'Hello',links:[],avatar_url:null,layout:defaultProfileLayout,cover:null});
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
  assert.deepEqual(Object.keys(result.profile).sort(),['avatar_url','bio','cover','display_name','layout','links']);
 }
});

test('recognition remains member-only, flag-gated and in the admitted profile SQL snapshot',async()=>{
 const queries:string[]=[];const enriched={...row,certification_state:'active',show_community_certification:true,social_title_id:'chat_7',statement:'private application',days:999,peer_ids:['private']};
 const q={query:async(sql:string)=>{queries.push(sql);return {rows:[enriched]};}};
 const actor={community_id:'community',user_id:id} as any;
 for(const options of [{},{communityCertificationEnabled:false,socialAchievementsEnabled:false},{communityCertificationEnabled:'true',socialAchievementsEnabled:1}]){
  const result=await memberVisitorProfile(q as any,actor,id,options as any);
  assert.equal(result.community_certification,undefined);assert.equal(result.social_achievement,undefined);
  assert.doesNotMatch(queries.at(-1)!,/member_community_certifications|social_achievement_(settings|awards)/);
 }
 queries.length=0;
 const result=await memberVisitorProfile(q as any,actor,id,{communityCertificationEnabled:true,socialAchievementsEnabled:true});
 assert.equal(queries.length,1);assert.equal(result.community_certification?.label,'社群認證');assert.equal(result.social_achievement?.title_id,'chat_7');
 assert.deepEqual(Object.keys(result.social_achievement!).sort(),['description','label','policy_version','title_id']);
 for(const pattern of [/c.community_id=p.community_id/,/s.community_id=p.community_id/,/s.show_title/,/s.status<>'revoked'/,/a.title_id=s.selected_title/,/a.policy_version='social_days_v1'/,/member_interaction_blocks/])assert.match(queries[0],pattern);
 assert.doesNotMatch(JSON.stringify(result),/private application|peer_ids|999/);
 queries.length=0;const anonymous=await publicVisitorProfile(q as any,id);
 assert.equal('community_certification' in anonymous,false);assert.equal('social_achievement' in anonymous,false);
 assert.doesNotMatch(queries[0],/member_community_certifications|social_achievement_(settings|awards)/);
});
test('revoked or not-consented certification cannot project through an admitted member profile',async()=>{
 for(const [state,optIn] of [['active',false],['pending',true],['revoked',true],['withdrawn',true]]){
  const q={query:async()=>({rows:[{...row,certification_state:state,show_community_certification:optIn,social_title_id:null}]})};
  const result=await memberVisitorProfile(q as any,{community_id:'community',user_id:id} as any,id,{communityCertificationEnabled:true,socialAchievementsEnabled:true});
  assert.equal(result.community_certification,undefined);assert.equal(result.social_achievement,undefined);
 }
});

test('public HTTP and member visitor envelopes withhold hidden payloads, including self view',async()=>{
 const source={...row,links:[{label:'private-link-marker',url:'https://example.test/private-link-marker'}],
  layout:{...structuredClone(defaultProfileLayout),about:'private-about-marker',featured:[{title:'private-work-marker',description:'private-description-marker',url:'https://example.test/private-work-marker'}]},
  certification_state:'active',show_community_certification:true,social_title_id:'chat_7'};
 const actor={community_id:'community',user_id:id} as any;
 for(let mask=0;mask<16;mask++){
  const current=structuredClone(source);current.layout.blocks.forEach((block,index)=>{block.visible=Boolean(mask&(1<<index));});
  const q={query:async()=>({rows:[current]})};const app=new Hono();registerPublicMemberProfiles(app as any,{pool:q} as any);
  const response=await app.request('/api/v1/public/member-profiles/'+id,{headers:{Cookie:'session=ignored'}});
  assert.equal(response.status,200);const anonymous=await response.json();
  assert.equal(anonymous.layout.about,mask&1?source.layout.about:'');assert.deepEqual(anonymous.layout.featured,mask&2?source.layout.featured:[]);assert.deepEqual(anonymous.links,mask&4?source.links:[]);
  assert.equal('community_certification' in anonymous,false);assert.equal('social_achievement' in anonymous,false);
  for(const self of [false,true]){
   const member=await memberVisitorProfile({query:async()=>({rows:[{...current,is_self:self}]})} as any,actor,id,{communityCertificationEnabled:true,socialAchievementsEnabled:true});
   assert.deepEqual(member.profile,anonymous);
   assert.equal(Boolean(member.community_certification),Boolean(mask&8));assert.equal(Boolean(member.social_achievement),Boolean(mask&8));
   const json=JSON.stringify(member);if(!(mask&1))assert(!json.includes('private-about-marker'));if(!(mask&2))assert(!json.includes('private-work-marker')&&!json.includes('private-description-marker'));if(!(mask&4))assert(!json.includes('private-link-marker'));if(!(mask&8))assert(!json.includes('chat_7')&&!json.includes('community_certification'));
  }
  assert.equal(current.layout.about,source.layout.about,'projection does not mutate owner storage');
 }
});

test('owner settings and input round trip preserve hidden content while visitor projection remains empty',async()=>{
 const {profilePublicationSettings}=await import('../../modules/identity-membership/profile-publication.js');
 const {ProfilePublicationInput,ProfilePublicationSettingsSchema}=await import('../../packages/shared/member-profile.js');
 const saved={...row,visibility:'members',links:[{label:'saved link',url:'https://example.test/saved'}],
  layout:{...structuredClone(defaultProfileLayout),about:'saved hidden about',featured:[{title:'saved work',description:'kept',url:'https://example.test/work'}],blocks:defaultProfileLayout.blocks.map(block=>({...block,visible:false}))},
  include_cover:false,cover_version:null,aggregate_version:7};
 const calls:string[]=[];const q={query:async(sql:string)=>{calls.push(sql);return {rows:sql.includes(' AS ready ')?[{ready:true}]:[saved]};}};
 const owner=ProfilePublicationSettingsSchema.parse(await profilePublicationSettings(q as any,{community_id:'community',user_id:id} as any));
 assert.deepEqual(owner.layout,saved.layout);assert.deepEqual(owner.links,saved.links);assert.equal(owner.aggregate_version,'7');
 assert.equal(calls.length,2);assert.match(calls[1],/p.user_id=\$1 AND p.community_id=\$2/);
 const input=ProfilePublicationInput.parse({visibility:owner.visibility,display_name:owner.display_name,bio:owner.bio,links:owner.links,layout:owner.layout,include_cover:owner.include_cover,cover_version:owner.cover_version});
 assert.deepEqual(input.layout,saved.layout);assert.deepEqual(input.links,saved.links);
 const visitor=await publicVisitorProfile({query:async()=>({rows:[saved]})} as any,id);
 assert.equal(visitor.layout.about,'');assert.deepEqual(visitor.layout.featured,[]);assert.deepEqual(visitor.links,[]);
});
