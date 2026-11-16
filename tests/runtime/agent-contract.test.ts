import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {agentOperations} from '../../apps/platform-api/src/agent-allowlist.js';
import {agentBodySchemas,agentInputSchema,agentJsonSchema} from '../../apps/platform-api/src/agent-schemas.js';
import {agentContract} from '../../modules/client-connections/agent-contract.js';

test('every granted operation has a generated body/input schema accepting its runtime example',()=>{
 const operations=Object.values(agentContract.paths).flatMap(path=>Object.values(path));
 for(const op of agentOperations.filter(op=>op.granted!==false)){
  const contract=operations.find(entry=>entry.operationId===op.id)!;
  assert.ok(contract,op.id);
  assert.deepEqual(contract['x-body-schema'],agentJsonSchema(agentBodySchemas[op.id]));
  assert.deepEqual(contract['x-input-schema'],agentJsonSchema(agentInputSchema(op)));
  assert.ok(z.fromJSONSchema(contract['x-body-schema']).safeParse(op.example??{}).success,op.id);
 }
});
test('guild keys and tool names are strings, UUID resource IDs remain UUIDs',()=>{
 const schemas=agentInputSchema(agentOperations[0]);
 assert.ok(schemas.safeParse({guild:'guild_member_operations',tool:'notes-tool',body:{},idempotency_key:'synthetic-key'}).success);
 assert.equal(schemas.safeParse({guild:'../../admin',tool:'token',body:{},idempotency_key:'synthetic-key'}).success,false);
 const read=agentInputSchema(agentOperations.find(op=>op.id==='events.read')!);
 assert.equal(read.safeParse({id:'not-a-uuid'}).success,false);
});
test('contract requires Idempotency-Key header iff operation is non-GET',()=>{
 for(const pathItem of Object.values(agentContract.paths)){
  for(const [method,def] of Object.entries(pathItem as Record<string,any>)){
   const header=(def.parameters??[]).find((p:any)=>p.in==='header'&&p.name==='Idempotency-Key');
   if(method==='get')assert.equal(header,undefined,def.operationId);
   else{assert.ok(header,def.operationId);assert.equal(header.required,true,def.operationId);}
  }
 }
});
test('posts.list documents query params and notifications.mark_all_read requires scope=notifications',()=>{
 const defs=Object.values(agentContract.paths).flatMap(p=>Object.values(p)) as any[];
 const postsList=defs.find(d=>d.operationId==='posts.list');
 assert.ok(postsList,'posts.list missing from contract');
 const queryNames=(postsList.parameters??[]).filter((p:any)=>p.in==='query').map((p:any)=>p.name).sort();
 assert.deepEqual(queryNames,['cursor','kind','platform','post_id','tag']);
 const markAll=defs.find(d=>d.operationId==='notifications.mark_all_read');
 assert.ok(markAll,'notifications.mark_all_read missing from contract');
 const bodySchema=z.fromJSONSchema(markAll['x-body-schema']);
 assert.equal(bodySchema.safeParse({scope:'notifications'}).success,true);
 assert.equal(bodySchema.safeParse({}).success,false);
 assert.equal(bodySchema.safeParse({scope:'chats'}).success,false);
});

test('F2 draft schemas reuse service validators and max manual draft fits 32 KiB limit',async()=>{
 const {manualInput}=await import('../../modules/skill-submissions/service.js');
 const {proposalInput}=await import('../../modules/development-access/service.js');
 const {agentPathSchemas,agentResponseSchemas}=await import('../../apps/platform-api/src/agent-schemas.js');
 assert.equal(agentBodySchemas['skills.draft'],manualInput);
 assert.equal(agentBodySchemas['skills.revise'],manualInput);
 assert.equal(agentBodySchemas['development.propose'],proposalInput);
 assert.ok(agentPathSchemas.kind&&agentPathSchemas.target);
 for(const id of ['skills.drafts','skills.draft_read','skills.draft','skills.revise','development.status','development.propose']){
  const op=agentOperations.find(entry=>entry.id===id&&entry.granted!==false)!;
  assert.ok(op,`missing op ${id}`);
  assert.ok(agentResponseSchemas[id],`missing response schema ${id}`);
  const inputSchema=agentInputSchema(op);
  assert.ok(z.fromJSONSchema(agentJsonSchema(agentBodySchemas[id])).safeParse(op.example??{}).success,id);
  if(id==='development.status')assert.equal(inputSchema.safeParse({kind:'skill',target:'../../admin'}).success,false);
  if(id==='skills.revise'){
   assert.equal(inputSchema.safeParse({id:'00000000-0000-4000-8000-000000000001',body:op.example,idempotency_key:'synthetic-key-123'}).success,false);
   assert.equal(inputSchema.safeParse({id:'00000000-0000-4000-8000-000000000001',body:op.example,idempotency_key:'synthetic-key-123',version:1}).success,true);
  }
 }
 const maxManual={
  repository_url:'https://github.com/'+'o'.repeat(39)+'/'+'r'.repeat(100),
  title:'測'.repeat(120),
  description:'技'.repeat(2000),
  use_notes:'用'.repeat(3000),
  demo_url:'https://example.com/'+'d'.repeat(1980),
  relationship:'contributor' as const,
  page_content:{
   headline:'這是一個完整的測試用技能書頁面的標題設計目標句。',
   problem:'題'.repeat(100),
   mechanism:'制'.repeat(160),
   outcomes:['果甲'.repeat(15),'果乙'.repeat(15),'果丙'.repeat(15)],
   flow:{
    title:'流程標題'.repeat(6),
    lead:'流'.repeat(100),
    caption:'說'.repeat(90),
    steps:[
     {icon:'terminal',title:'甲步驟測試',note:'步驟說明文字'.repeat(5)},
     {icon:'code',title:'乙核心步驟',note:'核心說明'.repeat(5)},
     {icon:'check',title:'丙步驟測試',note:'步驟說明文字'.repeat(5)},
    ],
   },
  },
 };
 const parsed=manualInput.safeParse(maxManual);
 assert.equal(parsed.success,true,parsed.success?'':JSON.stringify(parsed.error.issues));
 const bytes=Buffer.byteLength(JSON.stringify(maxManual),'utf8');
 assert.ok(bytes<32768,`maxManual ${bytes} bytes exceeds 32768`);
});

test('F2 upload schemas reuse skillSubmissionPayload, allowlist skills.upload/skills.fill with valid PNG example, and keep skills.illustration binary-blocked',async()=>{
 const {skillSubmissionPayload,normalizeSubmission}=await import('../../modules/skill-submissions/payload.js');
 const {agentResponseSchemas}=await import('../../apps/platform-api/src/agent-schemas.js');
 const illustration=agentOperations.find(entry=>entry.id==='skills.illustration');
 assert.equal(illustration?.granted,false);
 for(const id of ['skills.upload','skills.fill']){
  const op=agentOperations.find(entry=>entry.id===id&&entry.granted!==false);
  assert.ok(op,`missing granted op ${id}`);
  assert.equal(op.scope,'share');
  assert.equal(op.screen,'works');
  assert.equal(agentBodySchemas[id],skillSubmissionPayload);
  assert.ok(agentResponseSchemas[id],`missing response schema ${id}`);
  assert.ok(op.example?.cover_image,'expected PNG cover_image in example');
  assert.ok(z.fromJSONSchema(agentJsonSchema(agentBodySchemas[id])).safeParse(op.example).success,`${id} JSON schema failed`);
  await normalizeSubmission(op.example);
 }
});

test('F2 journal allowlist reuses snapshotSchema, keeps key/publish actions person-only, and omits key secrets',async()=>{
 const {snapshotSchema}=await import('../../modules/community-journal/payload.js');
 const {agentResponseSchemas}=await import('../../apps/platform-api/src/agent-schemas.js');
 for(const id of ['journal.publish','journal.discard','journal.withdraw','journal.key_create','journal.key_revoke']){
  const denied=agentOperations.find(entry=>entry.id===id);
  assert.ok(denied,`missing denied op ${id}`);
  assert.equal(denied.granted,false,`${id} must remain granted:false`);
 }
 const submit=agentOperations.find(entry=>entry.id==='journal.submit'&&entry.granted!==false);
 assert.ok(submit,'missing granted journal.submit');
 assert.equal(submit.method,'POST');
 assert.equal(submit.route,'/api/v1/me/community-journal/submissions');
 assert.equal(submit.scope,'share');
 assert.equal(submit.screen,'posts');
 assert.equal(agentBodySchemas['journal.submit'],snapshotSchema);
 assert.ok(agentResponseSchemas['journal.submit']);
 assert.ok(snapshotSchema.safeParse(submit.example).success,'journal.submit example failed snapshotSchema');
 assert.ok(z.fromJSONSchema(agentJsonSchema(snapshotSchema)).safeParse(submit.example).success,'journal.submit JSON schema failed');
 for(const [id,route] of [['journal.status','/api/v1/me/community-journal'],['journal.read','/api/v1/me/community-journal/submissions/:id']] as const){
  const op=agentOperations.find(entry=>entry.id===id&&entry.granted!==false);
  assert.ok(op,`missing granted ${id}`);
  assert.equal(op.method,'GET');
  assert.equal(op.route,route);
  assert.equal(op.scope,'read');
  assert.equal(op.screen,'posts');
  assert.ok(agentBodySchemas[id]);
  assert.ok(agentResponseSchemas[id]);
 }
 const statusSchema=agentResponseSchemas['journal.status'];
 assert.equal(statusSchema.safeParse({aggregate_version:1,published_submission_id:null,keys:[{key_id:'k',label:'x',expires_at:'2099-01-01T00:00:00Z',revoked_at:null,created_at:'2026-01-01T00:00:00Z'}],submissions:[]}).success,true);
 assert.equal(statusSchema.safeParse({aggregate_version:1,published_submission_id:null,keys:[{key_id:'k',label:'x',expires_at:'2099-01-01T00:00:00Z',revoked_at:null,created_at:'2026-01-01T00:00:00Z',token_hash:'secret'}],submissions:[]}).success,false);
 assert.equal(statusSchema.safeParse({aggregate_version:1,published_submission_id:null,keys:[{key_id:'k',label:'x',expires_at:'2099-01-01T00:00:00Z',revoked_at:null,created_at:'2026-01-01T00:00:00Z',token:'fjp_secret'}],submissions:[]}).success,false);
});

test('F3 paired-device read equivalents allowlist retail.* and supplier.* as read-only without writes or connection',async()=>{
 const {agentQuerySchemas,agentResponseSchemas}=await import('../../apps/platform-api/src/agent-schemas.js');
 const expected:[string,string][]=[
  ['retail.catalog','/api/v1/retail/catalog'],
  ['retail.stores','/api/v1/retail/stores'],
  ['retail.listings','/api/v1/retail/listings'],
  ['supplier.products','/api/v1/supplier/products'],
  ['supplier.requests','/api/v1/supplier/requests'],
 ];
 for(const [id,route] of expected){
  const op=agentOperations.find(entry=>entry.id===id&&entry.granted!==false);
  assert.ok(op,`missing granted ${id}`);
  assert.equal(op.method,'GET');
  assert.equal(op.route,route);
  assert.equal(op.scope,'read');
  assert.equal(op.screen,'services');
  assert.ok(agentBodySchemas[id],`missing body schema ${id}`);
  assert.ok(agentResponseSchemas[id],`missing response schema ${id}`);
 }
 const catalogQuery=agentQuerySchemas['retail.catalog'];
 assert.ok(catalogQuery,'missing retail.catalog query schema');
 assert.equal(catalogQuery.safeParse({limit:20,offset:0}).success,true);
 assert.equal(catalogQuery.safeParse({limit:51}).success,false);
 assert.equal(agentOperations.some(op=>op.granted!==false&&op.method!=='GET'&&(op.route.startsWith('/api/v1/retail/')||op.route.startsWith('/api/v1/supplier/'))),false);
 assert.equal(agentOperations.some(op=>op.granted!==false&&op.route.includes('client-connections')),false);
});
