import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import type {PoolClient} from 'pg';
import {bindPrincipalContext,bindTenantContext} from '../../packages/resource-scopes/tenant-transaction.js';
import {createHostedStorePhotoHarness,photoSourcePng,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';
import {seedAppearanceRows} from '../helpers/storefront-appearance.js';

let f:HostedStorePhotoHarness;
before(async()=>{f=await createHostedStorePhotoHarness();});
after(async()=>{await f?.stop();});
beforeEach(async()=>{await f.reset();});
const tables=['commerce_storefront_appearance_drafts','commerce_storefront_appearance_targets','commerce_publication_appearances','commerce_publication_appearance_refs'];
const code=(value:string)=>(e:unknown)=>(e as {code?:string}).code===value;
async function transaction<T>(run:(q:PoolClient)=>Promise<T>,runtime=false){
  const q=await (runtime?f.runtime:f.h.pool).connect();
  try{await q.query('BEGIN');return await run(q);}finally{await q.query('ROLLBACK');q.release();}
}
async function fixture(){
  const s=await f.openStore();
  await f.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-appearance-sql',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");
  const api=await f.assets.forProduct({mime:'image/png',bytes:photoSourcePng}),actor={...s.actor,tenant_id:s.tenantId,instance_id:s.instanceId};
  const p=await api.prepare(actor,{key:randomUUID(),targetProductId:s.productId,expectedVersion:'1',contentType:'image/png',byteSize:photoSourcePng.length,sha256:createHash('sha256').update(photoSourcePng).digest('hex')});
  const lease=await api.claim(actor,{key:randomUUID(),intentId:p.intentId}),binding={intentId:p.intentId,fence:lease.fence,leaseToken:lease.leaseToken};
  await api.write(actor,{...binding,key:randomUUID()},new ReadableStream({start(c){c.enqueue(photoSourcePng);c.close();}}));
  await api.finalize(actor,{...binding,key:randomUUID()});
  const view=f.ok(await f.call('GET',s.root,s.owner));f.ok(await f.post(s.root+'/publish',s.owner,{},view.version));
  const q=await f.h.pool.connect();
  try{await q.query('BEGIN');const rows=await seedAppearanceRows(q,s);await q.query('COMMIT');return {...s,...rows};}
  catch(e){await q.query('ROLLBACK');throw e;}finally{q.release();}
}
async function fails(q:PoolClient,sql:string,values:unknown[]=[],expected='23514'){
  await q.query('SAVEPOINT invalid');await assert.rejects(q.query(sql,values),code(expected));await q.query('ROLLBACK TO SAVEPOINT invalid');
}

test('APPEARANCE-SQL-01 cold installation is additive and keeps the existing Asset policy closed',async()=>{
  for(const table of tables)assert.equal((await f.h.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
  assert.deepEqual((await f.h.pool.query("SELECT mode,persistence_allowed,policy_revision,retained_byte_limit FROM domain_media_storage_policy WHERE purpose='storefront.product-photo'")).rows,[{mode:'legacy',persistence_allowed:false,policy_revision:null,retained_byte_limit:null}]);
  assert.deepEqual((await f.h.pool.query("SELECT purpose FROM domain_media_storage_policy WHERE purpose IN ('storefront.cover','storefront.logo')")).rows,[]);
});

test('APPEARANCE-SQL-02 metadata bounds reject multiline, duplicate, foreign and non-retail selections',async()=>{
  const a=await f.openStore(),b=await f.openStore();
  await transaction(async q=>{
    const insert='INSERT INTO commerce_storefront_appearance_drafts(tenant_id,instance_id,announcement,featured_product_ids) VALUES($1,$2,$3,$4)';
    for(const announcement of ['x'.repeat(81),'line\nline','line\rline','line\u2028line','line\u0085line'])await fails(q,insert,[a.tenantId,a.instanceId,announcement,[]]);
    for(const ids of [[a.productId,a.productId],[b.productId],Array.from({length:9},()=>randomUUID())])await fails(q,insert,[a.tenantId,a.instanceId,'',ids]);
    await q.query('UPDATE commerce_selections SET own_retail_enabled=false WHERE item_id=$1',[a.productId]);
    await fails(q,insert,[a.tenantId,a.instanceId,'',[a.productId]]);
    await q.query('UPDATE commerce_selections SET own_retail_enabled=true WHERE item_id=$1',[a.productId]);
    await q.query(insert,[a.tenantId,a.instanceId,'合'.repeat(80),[a.productId]]);
    await q.query('UPDATE commerce_selections SET own_retail_enabled=false WHERE item_id=$1',[a.productId]);
    await q.query("UPDATE commerce_storefront_appearance_drafts SET announcement='保留失效的選擇' WHERE tenant_id=$1",[a.tenantId]);
    await fails(q,'DELETE FROM commerce_storefront_appearance_drafts WHERE tenant_id=$1',[a.tenantId]);
    await fails(q,'UPDATE commerce_storefront_appearance_drafts SET tenant_id=$2 WHERE tenant_id=$1',[a.tenantId,b.tenantId]);
  });
});

test('APPEARANCE-SQL-03 targets use only the real advanced profile version, retain removals and reject routing changes',async()=>{
  const s=await fixture();
  await transaction(async q=>{
    const where=" WHERE tenant_id=$1 AND kind='storefront.cover'";
    await fails(q,'UPDATE commerce_storefront_appearance_targets SET asset_id=NULL,representation_id=NULL,policy_revision=NULL'+where,[s.tenantId]);
    await q.query('UPDATE commerce_storefront_profiles SET version=version+1 WHERE tenant_id=$1',[s.tenantId]);
    await q.query('UPDATE commerce_storefront_appearance_targets SET asset_id=NULL,representation_id=NULL,policy_revision=NULL,last_changed_at_profile_version=last_changed_at_profile_version+1'+where,[s.tenantId]);
    await fails(q,'UPDATE commerce_storefront_appearance_targets SET last_changed_at_profile_version=last_changed_at_profile_version+1'+where,[s.tenantId]);
    await fails(q,"UPDATE commerce_storefront_appearance_targets SET kind='storefront.logo'"+where,[s.tenantId]);
    await fails(q,'DELETE FROM commerce_storefront_appearance_targets'+where,[s.tenantId]);
    await q.query('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('APPEARANCE-SQL-04 frozen document and typed refs must agree and remain immutable',async()=>{
  const s=await fixture();
  await transaction(async q=>{
    await fails(q,'UPDATE commerce_publication_appearances SET document=document WHERE tenant_id=$1',[s.tenantId]);
    await fails(q,'DELETE FROM commerce_publication_appearances WHERE tenant_id=$1',[s.tenantId]);
    await fails(q,'UPDATE commerce_publication_appearance_refs SET width=width WHERE tenant_id=$1',[s.tenantId]);
    await fails(q,'DELETE FROM commerce_publication_appearance_refs WHERE tenant_id=$1',[s.tenantId]);
    const doc=s.document;
    for(const invalid of [{...doc,private_email:'synthetic@invalid.test'},{...doc,featured_skus:['P9999']},{...doc,logo:{...doc.logo,width:2}},{...doc,cover:{...doc.cover,purpose:'member.avatar'}}]){
      await q.query('SAVEPOINT invalid_document');
      const pub=(await q.query(`INSERT INTO commerce_storefront_publications(publication_id,instance_id,tenant_id,revision,slug,projection,projection_sha256,published_by_principal_id)
        SELECT gen_random_uuid(),instance_id,tenant_id,revision+100,slug,jsonb_set(projection,'{revision}',to_jsonb((revision+100)::text)),projection_sha256,published_by_principal_id FROM commerce_storefront_publications WHERE publication_id=$1 RETURNING publication_id`,[s.profile.current_publication_id])).rows[0];
      await assert.rejects(async()=>{
        await q.query('INSERT INTO commerce_publication_appearances(publication_id,tenant_id,instance_id,document,appearance_sha256) VALUES($1,$2,$3,$4,$5)',[pub.publication_id,s.tenantId,s.instanceId,invalid,s.digest]);
        await q.query('SET CONSTRAINTS ALL IMMEDIATE');
      },code('23514'));
      await q.query('ROLLBACK TO SAVEPOINT invalid_document');
    }
  });
});

test('APPEARANCE-SQL-05 RLS hides unbound and foreign rows and rejects foreign metadata INSERT',async()=>{
  const a=await fixture(),b=await f.openStore();
  await transaction(async q=>{
    for(const table of tables)assert.equal((await q.query(`SELECT * FROM ${table}`)).rowCount,0);
    await bindPrincipalContext(q,(await f.h.pool.query('SELECT principal_id FROM principals WHERE user_ref=$1',[b.actor.user_id])).rows[0].principal_id);await bindTenantContext(q,{tenantId:b.tenantId,tenantScopeId:(await f.h.pool.query("SELECT scope_id FROM resource_scopes WHERE tenant_ref=$1 AND kind='tenant'",[b.tenantId])).rows[0].scope_id});
    for(const table of tables)assert.equal((await q.query(`SELECT * FROM ${table}`)).rowCount,0);
    await fails(q,'INSERT INTO commerce_storefront_appearance_drafts(tenant_id,instance_id) VALUES($1,$2)',[a.tenantId,a.instanceId],'42501');
  },true);
  await transaction(async q=>{
    await bindPrincipalContext(q,(await f.h.pool.query('SELECT principal_id FROM principals WHERE user_ref=$1',[a.actor.user_id])).rows[0].principal_id);await bindTenantContext(q,{tenantId:a.tenantId,tenantScopeId:a.profile.scope_id});
    for(const table of tables)assert.ok((await q.query(`SELECT * FROM ${table}`)).rowCount);
    for(const table of tables)assert.equal((await q.query(`DELETE FROM ${table}`)).rowCount,0);
  },true);
});

test('APPEARANCE-SQL-06 runtime ACL removes legacy table and column writes on immutable sidecars',async()=>{
  const sql=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
  const query=sql.split('-- BEGIN STOREFRONT APPEARANCE GRANTS\n')[1].split('\n\\gexec')[0]
    .replaceAll(":'runtime'",`'${f.role}'`).replaceAll("n.nspname='public'",`n.nspname='${f.h.schema}'`);
  await transaction(async q=>{
    await q.query(`GRANT UPDATE(document) ON commerce_publication_appearances TO ${f.role} WITH GRANT OPTION`);
    for(const row of (await q.query(query)).rows)await q.query(Object.values(row)[0] as string);
    for(const table of tables){
      const mutable=table.startsWith('commerce_storefront_');
      const row=(await q.query("SELECT has_table_privilege($1,$2,'SELECT') r,has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE,TRUNCATE,TRIGGER,REFERENCES') unsafe",[f.role,table])).rows[0];
      assert.deepEqual(row,{r:true,i:true,u:mutable,unsafe:false});
    }
  });
  await transaction(async q=>{
    await q.query('GRANT SELECT(document) ON commerce_publication_appearances TO PUBLIC');
    await assert.rejects(async()=>{for(const row of (await q.query(query)).rows)await q.query(Object.values(row)[0] as string);},/Unsafe runtime appearance privileges/);
  });
});

test('APPEARANCE-SQL-07 only the two closed appearance target kinds admit the established raster intent',async()=>{
  const s=await fixture(),foreign=await f.openStore();
  await transaction(async q=>{
    const owner=(await q.query('SELECT owner_principal_id,owner_user_id FROM assets WHERE asset_id=$1',[s.object.asset_id])).rows[0];
    async function intent(kind:string,extra:Record<string,unknown>={}){
      const asset=randomUUID(),representation=randomUUID();
      await q.query(`INSERT INTO assets(asset_id,scope_id,owner_principal_id,owner_user_id,policy_revision,representation_id,purpose,scope_kind,tenant_ref)
        VALUES($1,$2,$3,$4,$5,$6,'storefront.product-photo','tenant',$7)`,[asset,s.profile.scope_id,owner.owner_principal_id,owner.owner_user_id,s.object.policy_revision,representation,s.tenantId]);
      const fields={intent_id:randomUUID(),asset_id:asset,representation_id:representation,scope_id:s.profile.scope_id,
        owner_principal_id:owner.owner_principal_id,target_user_id:owner.owner_user_id,policy_revision:s.object.policy_revision,
        prepare_key:randomUUID(),request_digest:'a'.repeat(64),source_content_type:'image/png',source_byte_size:photoSourcePng.length,
        source_sha256:createHash('sha256').update(photoSourcePng).digest('hex'),expected_version:String(BigInt(s.profile.version)+1n),
        expires_at:new Date(Date.now()+60_000),purpose:'storefront.product-photo',reserved_bytes:1048576,
        target_kind:kind,target_appearance_id:s.instanceId,target_tenant_id:s.tenantId,target_instance_id:s.instanceId,...extra};
      const names=Object.keys(fields);
      return q.query(`INSERT INTO asset_upload_intents(${names.join(',')}) VALUES(${names.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING intent_id`,Object.values(fields));
    }
    for(const kind of ['storefront.cover','storefront.logo']){
      const row=(await intent(kind)).rows[0];
      await fails(q,'UPDATE asset_upload_intents SET target_appearance_id=$2 WHERE intent_id=$1',[row.intent_id,randomUUID()]);
      await q.query('SAVEPOINT foreign_target');
      await assert.rejects(intent(kind,{target_tenant_id:foreign.tenantId}),code('23503'));
      await q.query('ROLLBACK TO SAVEPOINT foreign_target');
    }
    for(const [kind,extra] of [['storefront.unreviewed',{}],['storefront.cover',{target_product_id:s.productId}],['storefront.cover',{source_byte_size:2097153}],['storefront.logo',{source_content_type:'video/webm'}],['storefront.logo',{reserved_bytes:524288}],['storefront.cover',{expected_version:'0'}]] as const){
      await q.query('SAVEPOINT bad_intent');await assert.rejects(intent(kind,extra),code('23514'));await q.query('ROLLBACK TO SAVEPOINT bad_intent');
    }
  });
});
