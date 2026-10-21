import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {lockShopService,forgetShopService,shopServiceHost} from '../../packages/resource-scopes/shop-service.js';

const origin='http://127.0.0.1:4310',schemes=['Bearer ','bearer ','bEaReR ','BEARER   '];
const legacy='fw_shop_'+'v2_'+'A'.repeat(40),v2='fw_shop_v2_'+'A'.repeat(43);

test('v2_-starting legacy suffix is canonical base64url for 32 bytes',()=>{
 const suffix=legacy.slice('fw_shop_'.length),bytes=Buffer.from(suffix,'base64url');
 assert.equal(bytes.length,32);assert.equal(bytes.toString('base64url'),suffix);
 assert.equal(legacy.length,51);assert.equal(v2.length,54);
});

// Classification/binding unit fixture only; real SQL/HTTP cancellation coverage
// remains in shop-service-command.test.ts and requires disposable PostgreSQL.
function client(token:string,bound:boolean){
 const shop={shop_id:'synthetic-shop',owner_id:'synthetic-owner',community_id:'synthetic-community'};
 const row={...shop,credential_id:'synthetic-key',credential_profile:bound?'freedom.shop-service-key/v1':'legacy-shop-key/v1',
  purpose:bound?'shop-api':null,issuer:bound?origin:null,audience:bound?origin+'/shop-api/v1':null,environment:bound?'local':null};
 const hash=createHash('sha256').update(token).digest('hex'),queries:string[]=[];
 const q={async query(sql:string,values:unknown[]=[]){
  queries.push(sql);
  if(sql.includes('token_hash'))assert.equal(values[sql.includes('token_hash=$2')?1:0],hash,'hash exact credential bytes');
  let rows:unknown[];
  if(sql.startsWith('SELECT s.owner_id'))rows=[shop];
  else if(sql.startsWith('SELECT 1 FROM users'))rows=[{}];
  else if(sql.startsWith('SELECT k.*')||sql.startsWith('SELECT * FROM commerce_shop_keys'))rows=[row];
  else if(sql.startsWith('SELECT principal_id'))rows=[{principal_id:'synthetic-service',status:'active'}];
  else if(sql.startsWith('SELECT scope_id'))rows=[{scope_id:'synthetic-site',service_principal_id:'synthetic-service',status:'active'}];
  else if(sql.startsWith('SELECT pg_advisory_xact_lock'))rows=[{}];
  else if(sql.startsWith('SELECT * FROM commerce_shops'))rows=[shop];
  else assert.fail('unexpected query in classification fixture');
  return {rows,rowCount:rows.length};
 }} as unknown as PoolClient;
 return {q,queries};
}

for(const scheme of schemes)for(const bound of [false,true])for(const policy of ['legacy-compatible','purpose-bound-only',undefined] as const){
 test(`${scheme.trim()}/${scheme.length}: ${bound?'v2':'v2_-starting legacy'} under ${policy??'missing policy'}`,async()=>{
  const {q,queries}=client(bound?v2:legacy,bound),host=shopServiceHost('local',origin,policy);
  const resolve=()=>lockShopService(q,scheme+(bound?v2:legacy),host);
  if(policy===undefined){await assert.rejects(resolve,{status:503,code:'shop_auth_not_configured'});assert.equal(queries.length,0);}
  else if(!bound&&policy==='purpose-bound-only')await assert.rejects(resolve,{status:401,code:'shop_key_invalid'});
  else{
   const context=await resolve();
   try{assert.equal(context.authn_kind,bound?'shop_service_key':'legacy_shop_key');}
   finally{forgetShopService(context);}
   assert.equal(queries.some(sql=>sql.includes('FROM principals')),bound);
   assert.equal(queries.some(sql=>sql.includes('FROM resource_scopes')),bound);
  }
  assert(!queries.some(sql=>/scoped_command_receipts|scoped_transition_journal/.test(sql)));
 });
}

for(const authorization of ['Basic '+legacy,'BearerX '+legacy,'Bearer\t'+legacy,'Bearer'+legacy,'Bearer\u00a0'+legacy,
 'Bearer '+legacy.replace('fw_shop_','FW_SHOP_'),'Bearer '+legacy+'A','Bearer '+v2+'A','Bearer '+legacy.slice(0,-1)]){
 test('invalid shop grammar is rejected before SQL: '+JSON.stringify(authorization.slice(0,12)),async()=>{
  const {q,queries}=client(legacy,false);
  await assert.rejects(()=>lockShopService(q,authorization,shopServiceHost('local',origin,'legacy-compatible')),{status:401,code:'shop_key_invalid'});
  assert.equal(queries.length,0);
 });
}
