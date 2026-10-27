import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProfilePublicationInput,VisitorProfile,visitorProfile,canReadVisitorProfile} from '../../packages/shared/member-profile.js';
const body={visibility:'private',display_name:'本人確認名稱',bio:'介紹',links:[]};
test('publication is strict, text-only and requires fresh explicit public confirmation',()=>{
  assert.equal(ProfilePublicationInput.parse(body).visibility,'private');
  assert.throws(()=>ProfilePublicationInput.parse({...body,visibility:'public'}));
  assert.equal(ProfilePublicationInput.parse({...body,visibility:'public',confirm_public:true}).visibility,'public');
  for(const key of ['email','contacts','orders','posts','include_avatar','avatar_url','badge','user_id'])assert.throws(()=>ProfilePublicationInput.parse({...body,[key]:'private value'}));
  for(const url of ['http://example.test','javascript:alert(1)','https://user:pass@example.test','bad'])assert.throws(()=>ProfilePublicationInput.parse({...body,links:[{label:'link',url}]}));
  assert.throws(()=>ProfilePublicationInput.parse({...body,links:Array(6).fill({label:'link',url:'https://example.test'})}));
  assert.throws(()=>ProfilePublicationInput.parse({...body,bio:'x'.repeat(281)}));
  assert.throws(()=>ProfilePublicationInput.parse({...body,display_name:'name\nsecret'}));
});
test('DTO allowlist never spreads private/account fields',()=>{
  const value=visitorProfile({...body,email:'secret',orders:['secret'],avatar_url:'/private/avatar',aggregate_version:9} as any);
  assert.deepEqual(value,{display_name:body.display_name,bio:body.bio,links:[],avatar_url:null});
  for(const key of ['visibility','contacts','email','actions'])assert.throws(()=>VisitorProfile.parse({...value,[key]:'not allowed'}));
});
test('self/member/guest/private/blocked matrix; public can be read signed out',()=>{
  const base={ownerReady:true,self:false,viewerReady:true,sameCommunity:true,blocked:false,anonymous:false};
  for(const visibility of ['private','members','public'] as const){
    assert.equal(canReadVisitorProfile({...base,visibility,self:true}),true);
    assert.equal(canReadVisitorProfile({...base,visibility}),visibility!=='private');
    assert.equal(canReadVisitorProfile({...base,visibility,blocked:true}),false);
    assert.equal(canReadVisitorProfile({...base,visibility,ownerReady:false}),false);
    assert.equal(canReadVisitorProfile({...base,visibility,viewerReady:false}),false);
    assert.equal(canReadVisitorProfile({...base,visibility,sameCommunity:false}),false);
    assert.equal(canReadVisitorProfile({...base,visibility,anonymous:true,blocked:true}),visibility==='public');
  }
});

test('raw controls and normalized overlong URLs are rejected before public text rendering',()=>{
 for(const control of ['\n','\r','\t','\u0000','\u007f']){
  for(const field of ['display_name','bio'])for(const value of [control+'text','text'+control,'text'+control+'text'])assert.equal(ProfilePublicationInput.safeParse({...body,[field]:value}).success,false);
  for(const field of ['label','url'])assert.equal(ProfilePublicationInput.safeParse({...body,links:[{label:'link',url:'https://example.test',[field]:control+(field==='label'?'link':'https://example.test')}]}).success,false);
 }
 for(const url of ['//example.test','data:text/html,test','https://user@example.test','https://:password@example.test','https://example.test/'+ '中'.repeat(60)])assert.equal(ProfilePublicationInput.safeParse({...body,links:[{label:'link',url}]}).success,false);
 assert.equal(ProfilePublicationInput.safeParse({...body,links:[{label:'網站',url:'https://example.test/path?q=one#section'}]}).success,true);
 assert.equal(ProfilePublicationInput.parse({...body,display_name:'  literal <script>  '}).display_name,'literal <script>','text remains literal; React rendering must escape, not interpret markup');
});
