import test from 'node:test';
import assert from 'node:assert/strict';
import {CertificationSettingsSchema,CertificationReviewAckSchema,CertificationQueueSchema,certificationCommandRejected,ApplicationInput,DisplayInput,ReviewInput,certificationBadge,certificationStates,nextCertificationState,CERTIFICATION_DESCRIPTION} from '../../packages/shared/community-certification.js';
const allowed={apply:{unrequested:'pending',rejected:'pending',revoked:'pending',withdrawn:'pending'},withdraw:{pending:'withdrawn',active:'withdrawn'},approve:{pending:'active'},reject:{pending:'rejected'},revoke:{active:'revoked'}} as const;
for(const action of Object.keys(allowed) as (keyof typeof allowed)[])for(const state of certificationStates)test(`${action} from ${state} follows explicit manual lifecycle`,()=>{
 assert.equal(nextCertificationState(state,action),(allowed[action] as Record<string,string>)[state]);
});
for(const state of certificationStates)for(const optIn of [false,true])test(`${state}, opt-in ${optIn}: no unreviewed/revoked claims`,()=>{
 const badge=certificationBadge(state,optIn);assert.equal(Boolean(badge),state==='active'&&optIn);
 if(badge){assert.deepEqual(Object.keys(badge).sort(),['description','kind','label']);assert.equal(badge.description,CERTIFICATION_DESCRIPTION);}
});
test('application is explicit and cannot smuggle authority, state, or display',()=>{
 const input={statement:'A sufficient community application',acknowledged:true};assert.equal(ApplicationInput.parse(input).statement,input.statement);
 for(const body of [{...input,state:'active'},{...input,reviewed_by:'admin'},{...input,show_community_certification:true},{...input,acknowledged:false},{...input,statement:'short'},{...input,statement:'x'.repeat(1001)},{...input,statement:'valid text\0invalid'}])assert.equal(ApplicationInput.safeParse(body).success,false);
});
test('display opt-in is independent and review requires a deliberate exact decision and reason',()=>{
 assert.deepEqual(DisplayInput.parse({show_community_certification:false}),{show_community_certification:false});
 for(const value of ['true',1,null,undefined])assert.equal(DisplayInput.safeParse({show_community_certification:value}).success,false);
 assert.equal(ReviewInput.safeParse({decision:'approve',reason:'Reviewed',confirmed:true}).success,true);
 for(const body of [{decision:'active',reason:'Reviewed',confirmed:true},{decision:'approve',reason:'x',confirmed:true},{decision:'approve',reason:'Reviewed',confirmed:false},{decision:'approve',reason:'Reviewed',confirmed:true,admin:true}])assert.equal(ReviewInput.safeParse(body).success,false);
});
test('untyped projection input cannot manufacture a blue check',()=>{
 for(const [state,opt] of [['pending',true],['active','true'],[true,true],[null,true],['verified',true]])assert.equal(certificationBadge(state,opt),undefined);
});

for(const status of [0,200,400,401,403,404,409,412,422,429,500,503])for(const complete of [false,true])test(`pending tuple rejection status ${status} complete ${complete}`,()=>{
 assert.equal(certificationCommandRejected(status,complete),complete&&(status===412||status===422));
});

test('a prior unknown command outcome cannot be settled by a later rejection',()=>{
 for(const status of [0,200,400,401,403,404,409,412,422,429,500,503])for(const complete of [false,true])assert.equal(certificationCommandRejected(status,complete,true),false);
});

// Actual client decoders: HTTP status alone never establishes command outcome.
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {AdminClient,AdminRequestError} from '../../apps/portal-web/src/modules/admin-client.js';
for(const status of [412,422])for(const body of ['', '<html>upstream error</html>', '{}', '[]', JSON.stringify({type:'about:blank',title:'Rejected',status:500}), 'valid'])test(`actual clients preserve response provenance ${status}/${body}`,async t=>{
 const wire=body==='valid'?JSON.stringify({type:'about:blank',title:'Rejected',status}):body;
 t.mock.method(globalThis,'fetch',async()=>new Response(wire,{status,headers:{'content-type':'application/json'}}));
 const member=new PortalClient();member.csrfToken='synthetic';
 const admin=new AdminClient();admin.csrf='synthetic';
 await assert.rejects(member.post('/me/community-certification/apply',{},{ifMatch:1,idempotencyKey:'synthetic-operation',background:true}),error=>error instanceof ApiError&&error.definitiveResponse===(body==='valid'));
 await assert.rejects(admin.request('/community-certifications/synthetic/review',{},{version:1,key:'synthetic-operation'}),error=>error instanceof AdminRequestError&&error.definitiveResponse===(body==='valid'));
});

const settingsResponse={state:'unrequested',aggregate_version:1,show_community_certification:false,statement:'',policy_version:'community_certification_v1'};
test('successful settings response requires exact runtime facts before settling',()=>{
 assert.equal(CertificationSettingsSchema.safeParse(settingsResponse).success,true);
 for(const bad of [null,{},[],{...settingsResponse,extra:true},{...settingsResponse,aggregate_version:0},{...settingsResponse,aggregate_version:1.5},{...settingsResponse,aggregate_version:Number.MAX_SAFE_INTEGER+1},{...settingsResponse,state:'verified'},{...settingsResponse,show_community_certification:'true'},{...settingsResponse,policy_version:'unknown'}])assert.equal(CertificationSettingsSchema.safeParse(bad).success,false);
});
test('review ACK and queue decode exact shapes, not any JSON 2xx',()=>{
 assert.deepEqual(CertificationReviewAckSchema.parse({updated:true}),{updated:true});
 for(const bad of [null,{},[],{updated:false},{updated:'true'},{updated:true,private_reason:'hidden'}])assert.equal(CertificationReviewAckSchema.safeParse(bad).success,false);
 assert.deepEqual(CertificationQueueSchema.parse({items:[],next_offset:null}),{items:[],next_offset:null});
 for(const bad of [{},{items:[]},{items:[],next_offset:-1},{items:[settingsResponse],next_offset:null}])assert.equal(CertificationQueueSchema.safeParse(bad).success,false);
});

test('actual 2xx client payloads must pass feature decoders before acknowledgement',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({}));
 const member=new PortalClient();member.csrfToken='synthetic';const admin=new AdminClient();admin.csrf='synthetic';
 await assert.rejects(member.post('/me/community-certification/apply',{},{ifMatch:1,idempotencyKey:'synthetic',background:true}).then(value=>CertificationSettingsSchema.parse(value)));
 await assert.rejects(member.get('/me/community-certification',{background:true}).then(value=>CertificationSettingsSchema.parse(value)));
 await assert.rejects(admin.request('/community-certifications/synthetic/review',{},{version:1,key:'synthetic'}).then(value=>CertificationReviewAckSchema.parse(value)));
});
