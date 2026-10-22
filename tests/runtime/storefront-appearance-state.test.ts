import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {sendAppearanceAttempt} from '../../apps/portal-web/src/modules/hosted-store-appearance-client.js';
import {appearanceFields,appearanceAcknowledgement,forgetRefusedAppearanceAttempt,heldAppearanceAttempt,holdAppearanceAttempt,
  releaseAppearanceAttempt,restoreAppearanceAttempt,retainedAppearanceFailure,reviewAppearanceAttempt,type AppearanceAttempt} from '../../apps/portal-web/src/modules/hosted-store-appearance-state.js';
import {STOREFRONT_APPEARANCE_PROFILE,type StorefrontAppearanceDraft} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';

const tenantId=randomUUID(),instanceId=randomUUID(),user=randomUUID();
const body=appearanceFields({template_id:'catalog-grid-v1',accent_preset:'ocean',announcement:'合成公告',featured_product_ids:[]});
const original=():AppearanceAttempt=>Object.freeze({tenantId,instanceId,kind:'settings',expected:'1',key:randomUUID(),body,hadUnknown:false});
function draft(version='2'):StorefrontAppearanceDraft{return {profile:STOREFRONT_APPEARANCE_PROFILE,version,...body,
  featured_products:[],eligible_products:[],has_supplied_products:false,cover:null,logo:null,media_installed:true,uploads_enabled:true,published_revision:null,dirty:true};}
const ack=(current=draft(),changed=true)=>({profile:STOREFRONT_APPEARANCE_PROFILE,completed_version:changed?'2':'1',changed,current});

test('APPEARANCE-STATE-01 metadata snapshots cannot be mutated by later form edits',()=>{
  const source={...body,featured_product_ids:[randomUUID()]},saved=appearanceFields(source);source.featured_product_ids.push(randomUUID());source.announcement='不同公告';
  assert.equal(saved.announcement,'合成公告');assert.equal(saved.featured_product_ids.length,1);
  assert.throws(()=>saved.featured_product_ids.push(randomUUID()),TypeError);assert.throws(()=>{saved.announcement='不同公告';},TypeError);
});
test('APPEARANCE-STATE-02 completion binds the exact CAS and current fields, permits later drafts, and refuses unrelated media paths',()=>{
  const attempt=original();assert(appearanceAcknowledgement(ack(),attempt));
  for(const raw of [{}, {...ack(),completed_version:'3'},ack({...draft(),announcement:'其他公告'}),{...ack(),extra:'unreviewed'}])assert.equal(appearanceAcknowledgement(raw,attempt),null);
  assert(appearanceAcknowledgement(ack({...draft('5'),announcement:'後續公告'}),attempt));
  assert(appearanceAcknowledgement(ack(draft('1'),false),attempt));
  const image={content_type:'image/webp',byte_size:64,width:1,height:1,read_path:`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/appearance-media/cover/2`} as const;
  const media:AppearanceAttempt={...attempt,kind:'cover',action:'upload',file:new File(['synthetic'],'synthetic.webp',{type:'image/webp'})};
  assert(appearanceAcknowledgement(ack({...draft(),cover:image}),media));assert.equal(appearanceAcknowledgement(ack(),media),null);
  assert.equal(appearanceAcknowledgement(ack({...draft(),cover:{...image,read_path:image.read_path.replace(tenantId,randomUUID())}}),media),null);
  assert.equal(appearanceAcknowledgement(ack({...draft(),cover:image}),{...media,action:'remove',file:null}),null);
});
test('APPEARANCE-STATE-03 unknown tuples survive later refusals and reauthentication without crossing member/store boundaries',()=>{
  const client={},attempt=original();holdAppearanceAttempt(client,user,attempt);
  const uncertain=retainedAppearanceFailure(attempt,true);holdAppearanceAttempt(client,user,uncertain);
  assert.equal(restoreAppearanceAttempt(client,randomUUID(),attempt),null);assert.equal(restoreAppearanceAttempt({},user,attempt),null);
  assert.equal(restoreAppearanceAttempt(client,user,{...attempt,instanceId:randomUUID()}),null);
  const restored=restoreAppearanceAttempt(client,user,attempt)!;assert.equal(restored.hadUnknown,true);assert(restored.kind==='settings');assert.equal(restored.body,body);
  for(const changed of [{...restored,key:randomUUID()},{...restored,expected:'2'},{...restored,body:appearanceFields({...body,announcement:'另一次操作'})}])
    assert.throws(()=>holdAppearanceAttempt(client,user,changed),/appearance_original_result_unknown/);
  assert.throws(()=>reviewAppearanceAttempt(restored,'2',randomUUID()),/appearance_original_result_unknown/);
  forgetRefusedAppearanceAttempt(client,user,attempt);assert(heldAppearanceAttempt(client,user,attempt));
  releaseAppearanceAttempt(client,user,{...attempt,key:randomUUID()});assert(heldAppearanceAttempt(client,user,attempt));
  releaseAppearanceAttempt(client,user,restored);assert.equal(heldAppearanceAttempt(client,user,attempt),null);
});
test('APPEARANCE-STATE-04 a known CAS refusal permits explicit review with a new key and the same immutable File',()=>{
  const client={},file=new File(['synthetic'],'synthetic.webp',{type:'image/webp'}),attempt:AppearanceAttempt={...original(),kind:'logo',action:'upload',file};
  holdAppearanceAttempt(client,user,attempt);forgetRefusedAppearanceAttempt(client,user,attempt);assert.equal(heldAppearanceAttempt(client,user,attempt),null);
  const reviewed=reviewAppearanceAttempt(attempt,'4',randomUUID());assert(reviewed.kind==='logo');assert.equal(reviewed.expected,'4');assert.notEqual(reviewed.key,attempt.key);assert.equal(reviewed.file,file);
  holdAppearanceAttempt(client,user,reviewed);releaseAppearanceAttempt(client,user,attempt);assert.equal(heldAppearanceAttempt(client,user,attempt)?.key,reviewed.key);
  releaseAppearanceAttempt(client,user,reviewed);
});
test('APPEARANCE-STATE-05 metadata HTTP loss retries exact key/version/body and rejects a stale-session success',async t=>{
  const client=new PortalClient();client.csrfToken='synthetic-session';const attempt=original(),requests:{path:string;key:string|null;version:string|null;body:unknown}[]=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const headers=new Headers(init?.headers);requests.push({path:String(input),key:headers.get('Idempotency-Key'),version:headers.get('If-Match'),body:init?.body});
    if(requests.length===1)throw Error('synthetic lost response');return Response.json(ack());
  });
  await assert.rejects(sendAppearanceAttempt(client,attempt),(error:unknown)=>error instanceof ApiError&&error.network);
  const response=await sendAppearanceAttempt(client,attempt);assert.equal(response.completed_version,'2');assert.deepEqual(requests[0],requests[1]);
  t.mock.method(client,'patch',async()=>{client.csrfToken='synthetic-new-session';return ack();});
  await assert.rejects(sendAppearanceAttempt(client,attempt),(error:unknown)=>error instanceof ApiError&&error.network);
});
test('APPEARANCE-STATE-06 media retries exact bytes and rejects malformed success, Access expiry and generation changes',async t=>{
  const client=new PortalClient();client.csrfToken='synthetic-session';let authLost=0;client.onUnauthorized=()=>{authLost++;};
  const attempt:AppearanceAttempt={...original(),kind:'logo',action:'upload',file:new File(['synthetic'],'synthetic.webp',{type:'image/webp'})};
  const sent:RequestInit[]=[];let mode='lost';
  t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{sent.push(init!);if(mode==='lost')throw Error('synthetic lost response');
    if(mode==='access')return new Response('<html>synthetic Access sign-in</html>',{status:403});
    if(mode==='session')client.csrfToken='synthetic-next-session';return Response.json({});});
  for(let i=0;i<2;i++)await assert.rejects(sendAppearanceAttempt(client,attempt),(error:unknown)=>error instanceof ApiError&&error.network);
  assert.equal(sent[0].body,attempt.file);assert.equal(sent[1].body,attempt.file);assert.deepEqual([...new Headers(sent[0].headers)],[...new Headers(sent[1].headers)]);
  mode='malformed';await assert.rejects(sendAppearanceAttempt(client,attempt),(error:unknown)=>error instanceof ApiError&&error.network);
  mode='session';await assert.rejects(sendAppearanceAttempt(client,attempt),(error:unknown)=>error instanceof ApiError&&error.network);assert.equal(authLost,0);
  mode='access';await assert.rejects(sendAppearanceAttempt(client,attempt),(error:unknown)=>error instanceof ApiError&&error.accessExpired);assert.equal(authLost,1);assert.equal(client.csrfToken,null);
});
