import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {bindTenantContext} from '../../packages/resource-scopes/tenant-transaction.js';
import {galleryTables,seedGalleryRows} from '../helpers/storefront-gallery.js';
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString)throw Error('Explicit disposable TEST_DATABASE_URL required');
const schema=`fp_gallery_sql_${process.pid}_${Date.now()}`,role=schema+'_role';
const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Query=Pick<PoolClient,'query'>;
let a:Awaited<ReturnType<typeof seed>>,b:typeof a,runtime:Pool;
async function insert(q:Query,table:string,row:Record<string,unknown>){
 const columns=Object.keys(row);assert([table,...columns].every(name=>/^[a-z_][a-z_0-9]*$/.test(name)));
 await q.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
}
async function seed(q:PoolClient){
  const slug='synthetic-'+randomUUID().slice(0,8);
  const community=randomUUID(),user=randomUUID(),principal=randomUUID(),tenant=randomUUID(),scope=randomUUID(),instance=randomUUID(),binding=randomUUID();
  const supply=randomUUID(),retail=randomUUID(),item=randomUUID(),publication=randomUUID(),offer=randomUUID(),material=randomUUID(),version=randomUUID();
  const digest=hash('synthetic historical projection');
  await insert(q,'communities',{community_id:community,name:'Synthetic policy upgrade'});
  await insert(q,'users',{user_id:user,community_id:community,email:slug+'@example.test',display_name:'Synthetic owner',password_hash:'synthetic',profession_membership_ref:randomUUID()});
  await insert(q,'principals',{principal_id:principal,kind:'person',user_ref:user});
  await insert(q,'tenants',{tenant_id:tenant,community_id:community,display_name:'Synthetic tenant',created_by_principal_id:principal});
  await insert(q,'tenant_memberships',{tenant_id:tenant,principal_id:principal,role:'owner',status:'active',accepted_at:new Date()});
  await insert(q,'resource_scopes',{scope_id:scope,kind:'tenant',tenant_ref:tenant});
  await q.query(`INSERT INTO module_instances(instance_id,tenant_id,module_key,module_release_ref,application_release_ref,data_schema_version,
    contract_ref,status,binding_id,created_by_principal_id,origin_guild_key)
    SELECT $1,$2,'storefront',release_ref,'hosted-store@1.0.0',data_schema_version,contract_ref,'active',$3,$4,'guild_commerce_sales'
    FROM module_definitions WHERE release_ref='storefront@1.0.0'`,[instance,tenant,binding,principal]);
  await q.query(`INSERT INTO deployment_bindings(binding_id,tenant_id,instance_id,mode,environment,contract_ref,state)
    SELECT $1,$2,$3,'hosted','local',contract_ref,'active' FROM module_instances WHERE instance_id=$3`,[binding,tenant,instance]);
  for(const [id,kind] of [[supply,'internal'],[retail,'public']]){
    await insert(q,'commerce_shops',{shop_id:id,community_id:community,owner_id:user,kind,origin:'hosted',accepting_orders:false,
      name:'Synthetic shop',description:'Synthetic public description',website_url:'',contact:'',currency:'TWD',manifest_sha256:hash(id)});
    await insert(q,'commerce_resource_tenants',{resource_kind:'shop',resource_id:id,tenant_id:tenant,instance_id:instance,source_owner_id:principal,mapping_state:'confirmed'});
  }
  await insert(q,'commerce_storefront_profiles',{instance_id:instance,tenant_id:tenant,supply_shop_id:supply,storefront_shop_id:retail,slug,created_by_principal_id:principal});
  await insert(q,'commerce_items',{item_id:item,shop_id:supply,sku:'P0001',title:'Synthetic product',description:'Synthetic product text',price_minor:1200,
    shipping_minor:0,stock:10,shipping_terms:'Synthetic delivery',return_terms:'Synthetic returns'});
  await insert(q,'commerce_selections',{selection_id:randomUUID(),shop_id:retail,item_id:item,retail_price_minor:1200,sale_terms:'Synthetic terms',snapshot:{sku:'P0001'}});
  await insert(q,'commerce_storefront_publications',{publication_id:publication,tenant_id:tenant,instance_id:instance,revision:1,slug,
    projection:{slug,name:'Synthetic shop',brand:null,description:'Synthetic public description',currency:'TWD',products:[{sku:'P0001',title:'Synthetic product',description:'Synthetic product text',price_minor:1200}],revision:'1',published_at:'2026-10-20T00:00:00.000Z',transaction_state:'not_enabled'},
    projection_sha256:digest,published_by_principal_id:principal});
  await q.query('UPDATE commerce_storefront_profiles SET current_publication_id=$1,first_published_at=clock_timestamp() WHERE instance_id=$2',[publication,instance]);
  async function object(){
   const asset=randomUUID(),representation=randomUUID();
   await insert(q,'assets',{asset_id:asset,representation_id:representation,scope_id:scope,scope_kind:'tenant',tenant_ref:tenant,owner_principal_id:principal,owner_user_id:user,purpose:'storefront.product-photo',policy_revision:'synthetic-gallery'});
   await insert(q,'asset_objects',{asset_id:asset,representation_id:representation,scope_id:scope,purpose:'storefront.product-photo',variant:'image',content_type:'image/webp',byte_size:4,content_sha256:digest,transform_version:'storefront.product-photo.webp.v1',policy_revision:'synthetic-gallery',profile_id:'storefront.product-photo',pixel_width:1,pixel_height:1});
   await q.query("UPDATE assets SET state='ready',ready_at=clock_timestamp() WHERE asset_id=$1",[asset]);
   return {asset_id:asset,representation_id:representation,scope_id:scope,policy_revision:'synthetic-gallery'};
  }
  const photo=await object(),second=await object();
  await insert(q,'commerce_product_photo_targets',{tenant_id:tenant,instance_id:instance,product_id:item,...photo,linked_at_product_version:1});
  await insert(q,'commerce_publication_photo_refs',{publication_id:publication,sku:'P0001',tenant_id:tenant,instance_id:instance,...photo});
  return {tenant,instance,scope,item,publication,photo,second};
}
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);
 for(const file of (await readdir(new URL('../../migrations/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)&&Number(n.slice(0,3))<=176).sort())await pool.query(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
 const migration=await readFile(new URL('../../migrations/177_storefront_product_gallery.sql',import.meta.url),'utf8');
 const q=await pool.connect();try{
  await q.query('BEGIN');a=await seed(q);b=await seed(q);await q.query('COMMIT');
  for(const name of ['upload_profile_shape','tenant_upload_identity']){
   await q.query('BEGIN');await q.query(`ALTER TABLE asset_upload_intents DROP CONSTRAINT ${name};ALTER TABLE asset_upload_intents ADD CONSTRAINT ${name} CHECK(true)`);
   await assert.rejects(q.query(migration),/Unexpected gallery intent baseline/);await q.query('ROLLBACK');
   assert.equal((await q.query("SELECT to_regclass('commerce_product_groups') AS t")).rows[0].t,null);
  }
  const old=(await q.query('SELECT * FROM commerce_storefront_publications')).rows;
  await q.query(migration);
  assert.deepEqual((await q.query('SELECT * FROM commerce_storefront_publications')).rows,old);
  for(const table of galleryTables)assert.equal((await q.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,'no backfill');
  await q.query('BEGIN');for(const f of [a,b])await seedGalleryRows(q,{tenantId:f.tenant,instanceId:f.instance,productId:f.item,secondary:f.second});await q.query('COMMIT');
 }finally{q.release();}
 await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS;GRANT USAGE ON SCHEMA ${schema} TO ${role};GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
 const url=new URL(connectionString);url.username=role;url.password='';runtime=new Pool({connectionString:url.toString(),options:`-c search_path=${schema}`});
});
after(async()=>{await runtime?.end();await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;DROP ROLE IF EXISTS ${role}`);await admin.end();});
async function tx(run:(q:PoolClient)=>Promise<void>,source=pool){const q=await source.connect();try{await q.query('BEGIN');await run(q);}finally{await q.query('ROLLBACK');q.release();}}
async function fails(q:PoolClient,sql:string,values:unknown[]=[],code='23514'){await q.query('SAVEPOINT invalid');await assert.rejects(q.query(sql,values),(e:unknown)=>(e as {code:string}).code===code);await q.query('ROLLBACK TO SAVEPOINT invalid');}
test('GALLERY-SQL-01 guarded atomic installation, lazy groups and old legacy removal/deletion',()=>tx(async q=>{
 // Old binaries do not need a group to create a selection, and have no gallery FK to delete.
 await q.query('UPDATE commerce_product_photo_targets SET asset_id=NULL,representation_id=NULL,policy_revision=NULL,linked_at_product_version=NULL WHERE product_id=$1',[a.item]);
 await q.query('DELETE FROM commerce_selections WHERE item_id=$1',[a.item]);
 await q.query('DELETE FROM commerce_items WHERE item_id=$1',[a.item]);
 assert.equal((await q.query('SELECT count(*)::int n FROM commerce_product_groups WHERE anchor_product_id=$1',[a.item])).rows[0].n,1);
}));
test('GALLERY-SQL-02 secondary slots, alt text, immutable identity and cross-tenant FKs',()=>tx(async q=>{
 for(const position of [0,1,9])await fails(q,'UPDATE commerce_product_gallery_photos SET position=$1 WHERE product_id=$2',[position,a.item]);
 for(const alt of ['x'.repeat(121),'\u202e','a\nb',' x','x '])await fails(q,'UPDATE commerce_product_gallery_photos SET alt_text=$1 WHERE product_id=$2',[alt,a.item]);
 await q.query('UPDATE commerce_product_gallery_photos SET alt_text=$1 WHERE product_id=$2',['😀'.repeat(120),a.item]);
 await fails(q,'UPDATE commerce_product_gallery_photos SET asset_id=$1,representation_id=$2 WHERE product_id=$3',[b.second.asset_id,b.second.representation_id,a.item]);
 const row=(await q.query('SELECT * FROM commerce_product_gallery_photos WHERE product_id=$1',[a.item])).rows[0];
 await fails(q,`INSERT INTO commerce_product_gallery_photos(photo_id,tenant_id,instance_id,scope_id,group_id,product_id,position,asset_id,representation_id,policy_revision,last_changed_at_product_version) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,$9,1)`,[randomUUID(),a.tenant,a.instance,a.scope,row.group_id,a.item,a.photo.asset_id,a.photo.representation_id,a.photo.policy_revision],'23505');
 await fails(q,`INSERT INTO commerce_product_gallery_photos(photo_id,tenant_id,instance_id,scope_id,group_id,product_id,position,asset_id,representation_id,policy_revision,last_changed_at_product_version) VALUES($1,$2,$3,$4,$5,$6,3,$7,$8,$9,1)`,[randomUUID(),a.tenant,a.instance,a.scope,row.group_id,a.item,b.second.asset_id,b.second.representation_id,b.second.policy_revision],'23503');
 await fails(q,'UPDATE commerce_product_gallery_photos SET last_changed_at_product_version=99 WHERE product_id=$1',[a.item]);
}));
test('GALLERY-SQL-03 routing and frozen rows cannot update/delete and sidecars require exact refs',()=>tx(async q=>{
 for(const table of galleryTables){await fails(q,`DELETE FROM ${table}`);if(!['commerce_product_groups','commerce_product_gallery_photos'].includes(table))await fails(q,`UPDATE ${table} SET tenant_id=tenant_id`);}
 await fails(q,'UPDATE commerce_product_groups SET anchor_product_id=$1 WHERE tenant_id=$2',[randomUUID(),a.tenant]);
 await q.query('SAVEPOINT incomplete_gallery');
 const id=randomUUID();await q.query('INSERT INTO commerce_storefront_publications(publication_id,tenant_id,instance_id,revision,slug,projection,projection_sha256,published_by_principal_id) SELECT $1,tenant_id,instance_id,revision+1,slug,projection,projection_sha256,published_by_principal_id FROM commerce_storefront_publications WHERE publication_id=$2',[id,a.publication]);
 await q.query("INSERT INTO commerce_publication_galleries(publication_id,tenant_id,instance_id,document,gallery_sha256) VALUES($1,$2,$3,$4,repeat('a',64))",[id,a.tenant,a.instance,{profile:'freedom.hosted-store-gallery/v1',products:[]}]);
 await assert.rejects(q.query('SET CONSTRAINTS ALL IMMEDIATE'),(e:unknown)=>(e as {code:string}).code==='23514');await q.query('ROLLBACK TO SAVEPOINT incomplete_gallery');
}));
test('GALLERY-SQL-04 RLS hides unbound and foreign rows; retargets and foreign inserts fail',async()=>{
 await tx(async q=>{for(const table of galleryTables)assert.equal((await q.query(`SELECT 1 FROM ${table}`)).rowCount,0);await bindTenantContext(q,{tenantId:a.tenant,tenantScopeId:a.scope});
 for(const table of galleryTables){assert((await q.query(`SELECT 1 FROM ${table}`)).rowCount);assert.equal((await q.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1`,[b.tenant])).rowCount,0);assert.equal((await q.query(`DELETE FROM ${table}`)).rowCount,0);}
 await fails(q,'INSERT INTO commerce_publication_galleries(publication_id,tenant_id,instance_id,document,gallery_sha256) VALUES($1,$2,$3,$4,$5)',[randomUUID(),b.tenant,b.instance,{profile:'freedom.hosted-store-gallery/v1',products:[]},'a'.repeat(64)],'42501');
 },runtime);
});
test('GALLERY-SQL-05 canonical grants remove column and immutable writes',()=>tx(async q=>{
 const text=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
 // Mask SQL literals and comments so procedural bodies do not count as transaction boundaries.
 const topLevel=text.replace(/\$([A-Za-z_][A-Za-z_0-9]*|)\$[\s\S]*?\$\1\$|'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g,value=>value.replace(/[^\n]/g,' '));
 const begins=[...topLevel.matchAll(/^[ \t]*BEGIN;[ \t]*$/gm)],commits=[...topLevel.matchAll(/^[ \t]*COMMIT;[ \t]*$/gm)];
 assert.equal(begins.length,1,'one top-level BEGIN');assert.equal(commits.length,1,'one top-level COMMIT');
 assert(topLevel.trimEnd().endsWith('COMMIT;'),'COMMIT must be the last top-level statement');
 const markers=[...text.matchAll(/^-- (BEGIN|END) (.+ (?:GRANTS|EXCLUSIONS))$/gm)],open=new Set<string>();
 assert(markers.some(marker=>marker[2]==='STOREFRONT GALLERY GRANTS'));
 for(const marker of markers){
  assert(marker.index>begins[0].index&&marker.index<commits[0].index,`${marker[1]} ${marker[2]} must be inside the grants transaction`);
  if(marker[1]==='BEGIN'){assert(!open.has(marker[2]),`duplicate BEGIN ${marker[2]}`);open.add(marker[2]);}
  else{assert(open.delete(marker[2]),`unmatched END ${marker[2]}`);}
 }
 assert.equal(open.size,0,'every grants/exclusions block has a matching END');
 const sql=text.split('-- BEGIN STOREFRONT GALLERY GRANTS\n')[1].split('\n\\gexec')[0].replaceAll(":'runtime'",`'${role}'`).replaceAll("n.nspname='public'",`n.nspname='${schema}'`);
 await q.query(`GRANT UPDATE(document) ON commerce_publication_galleries TO ${role} WITH GRANT OPTION`);
 for(const row of (await q.query(sql)).rows)await q.query(Object.values(row)[0] as string);
 for(const table of galleryTables){const p=(await q.query("SELECT has_table_privilege($1,$2,'SELECT') r,has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE,TRUNCATE,TRIGGER,REFERENCES') unsafe",[role,table])).rows[0];assert.deepEqual(p,{r:true,i:true,u:['commerce_product_groups','commerce_product_gallery_photos'].includes(table),unsafe:false});}
}));

test('GALLERY-SQL-06 old binary can create selections and primary pointers after migration177',()=>tx(async q=>{
 const old=await seed(q);
 assert.equal((await q.query('SELECT count(*)::int n FROM commerce_product_groups WHERE tenant_id=$1',[old.tenant])).rows[0].n,0);
 assert.equal((await q.query('SELECT asset_id FROM commerce_product_photo_targets WHERE product_id=$1',[old.item])).rows[0].asset_id,old.photo.asset_id);
}));
test('GALLERY-SQL-07 closed gallery intent shape reuses the known purpose and immutable routing',()=>tx(async q=>{
 const photo=(await q.query('SELECT photo_id FROM commerce_product_gallery_photos WHERE product_id=$1',[a.item])).rows[0].photo_id;
 const owner=(await q.query('SELECT * FROM assets WHERE asset_id=$1',[a.photo.asset_id])).rows[0];
 async function intent(extra:Record<string,unknown>={}){
  const asset=randomUUID(),representation=randomUUID();
  await insert(q,'assets',{asset_id:asset,representation_id:representation,scope_id:a.scope,scope_kind:'tenant',tenant_ref:a.tenant,owner_principal_id:owner.owner_principal_id,owner_user_id:owner.owner_user_id,purpose:'storefront.product-photo',policy_revision:'synthetic-gallery'});
  const row={intent_id:randomUUID(),asset_id:asset,representation_id:representation,scope_id:a.scope,owner_principal_id:owner.owner_principal_id,target_user_id:owner.owner_user_id,policy_revision:'synthetic-gallery',prepare_key:randomUUID(),request_digest:'a'.repeat(64),source_content_type:'image/png',source_byte_size:4,source_sha256:'a'.repeat(64),expected_version:1,reserved_bytes:1048576,expires_at:new Date(Date.now()+60000),purpose:'storefront.product-photo',target_kind:'storefront.gallery-photo',target_gallery_photo_id:photo,target_tenant_id:a.tenant,target_instance_id:a.instance,...extra};
  await insert(q,'asset_upload_intents',row);return row.intent_id;
 }
 const id=await intent();await fails(q,'UPDATE asset_upload_intents SET target_gallery_photo_id=$2 WHERE intent_id=$1',[id,randomUUID()]);
 for(const extra of [{target_kind:'future.gallery'},{target_product_id:a.item},{reserved_bytes:2097152},{source_byte_size:2097153},{source_content_type:'image/gif'}]){
  await q.query('SAVEPOINT bad_manifest');await assert.rejects(intent(extra),(e:unknown)=>(e as {code:string}).code==='23514');await q.query('ROLLBACK TO SAVEPOINT bad_manifest');
 }
 await q.query('SAVEPOINT foreign_manifest');await assert.rejects(intent({target_tenant_id:b.tenant}),(e:unknown)=>(e as {code:string}).code==='23503');await q.query('ROLLBACK TO SAVEPOINT foreign_manifest');
}));
