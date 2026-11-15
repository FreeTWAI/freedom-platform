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
