import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {Pool,type PoolClient} from 'pg';

const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString)throw Error('Appearance migration tests require explicit isolated TEST_DATABASE_URL.');
const schema=`fp_appearance_upgrade_${process.pid}_${Date.now()}`;
const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const migration=new URL('../../migrations/175_storefront_appearance.sql',import.meta.url);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Query=Pick<PoolClient,'query'>;
let created=false;
async function insert(q:Query,table:string,row:Record<string,unknown>){
  const columns=Object.keys(row);assert([table,...columns].every(name=>/^[a-z_][a-z_0-9]*$/.test(name)));
  await q.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
}
before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);created=true;
  // One real pre-175 installation for both cases; no application helper can
  // accidentally install 175 or seed through candidate commands.
  const files=(await readdir(new URL('../../migrations/',import.meta.url))).filter(name=>/^\d+.*\.sql$/.test(name)&&Number(name.slice(0,3))<=174).sort();
  assert.equal(files.at(-1),'174_supply_offer_photos.sql');
  for(const file of files)await pool.query(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
  const q=await pool.connect();
  try{await q.query('BEGIN');await seed(q);await q.query('COMMIT');}
  catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
});
after(async()=>{await pool.end();if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});

async function seed(q:PoolClient){
  const community=randomUUID(),user=randomUUID(),principal=randomUUID(),tenant=randomUUID(),scope=randomUUID(),instance=randomUUID(),binding=randomUUID();
  const supply=randomUUID(),retail=randomUUID(),item=randomUUID(),publication=randomUUID(),offer=randomUUID(),material=randomUUID(),version=randomUUID();
  const digest=hash('synthetic historical projection');
  await insert(q,'communities',{community_id:community,name:'Synthetic appearance upgrade'});
  await insert(q,'users',{user_id:user,community_id:community,email:'appearance-upgrade@example.invalid',display_name:'Synthetic owner',password_hash:'synthetic',profession_membership_ref:randomUUID()});
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
  await insert(q,'commerce_storefront_profiles',{instance_id:instance,tenant_id:tenant,supply_shop_id:supply,storefront_shop_id:retail,slug:'synthetic-upgrade',created_by_principal_id:principal});
  await insert(q,'commerce_items',{item_id:item,shop_id:supply,sku:'P0001',title:'Synthetic product',description:'Synthetic product text',price_minor:1200,
    shipping_minor:0,stock:10,shipping_terms:'Synthetic delivery',return_terms:'Synthetic returns'});
  await insert(q,'commerce_selections',{selection_id:randomUUID(),shop_id:retail,item_id:item,retail_price_minor:1200,sale_terms:'Synthetic terms',snapshot:{sku:'P0001'}});
  await insert(q,'commerce_storefront_publications',{publication_id:publication,tenant_id:tenant,instance_id:instance,revision:1,slug:'synthetic-upgrade',
    projection:{slug:'synthetic-upgrade',name:'Synthetic shop',brand:null,description:'Synthetic public description',currency:'TWD',products:[{sku:'P0001',title:'Synthetic product',description:'Synthetic product text',price_minor:1200}],revision:'1',published_at:'2026-10-20T00:00:00.000Z',transaction_state:'not_enabled'},
    projection_sha256:digest,published_by_principal_id:principal});
  await q.query('UPDATE commerce_storefront_profiles SET current_publication_id=$1,first_published_at=clock_timestamp() WHERE instance_id=$2',[publication,instance]);
  async function object(purpose:string){
    const asset=randomUUID(),representation=randomUUID();
    await insert(q,'assets',{asset_id:asset,representation_id:representation,scope_id:scope,scope_kind:'tenant',tenant_ref:tenant,
      owner_principal_id:principal,owner_user_id:user,purpose,policy_revision:'synthetic-upgrade'});
    await insert(q,'asset_objects',{asset_id:asset,representation_id:representation,scope_id:scope,purpose,variant:'image',content_type:'image/webp',
      byte_size:4,content_sha256:digest,transform_version:purpose+'.webp.v1',policy_revision:'synthetic-upgrade',profile_id:purpose,pixel_width:1,pixel_height:1});
    await q.query("UPDATE assets SET state='ready',ready_at=clock_timestamp() WHERE asset_id=$1",[asset]);
    return {asset_id:asset,representation_id:representation,scope_id:scope,policy_revision:'synthetic-upgrade'};
  }
  const photo=await object('storefront.product-photo');
  await insert(q,'commerce_product_photo_targets',{tenant_id:tenant,instance_id:instance,product_id:item,...photo,linked_at_product_version:1});
  await insert(q,'commerce_publication_photo_refs',{publication_id:publication,sku:'P0001',tenant_id:tenant,instance_id:instance,...photo});
  await insert(q,'commerce_hosted_supply_offers',{offer_id:offer,tenant_id:tenant,instance_id:instance,item_id:item,community_id:community,supplier_name:'Synthetic supplier',
    source_version:1,terms:{currency:'TWD',title:'Synthetic product',description:'Synthetic product text',cost_minor:1200,shipping_minor:0,shipping_terms:'Synthetic delivery',return_terms:'Synthetic returns'},terms_sha256:digest});
  await insert(q,'commerce_hosted_offer_photos',{offer_id:offer,seq:1,tenant_id:tenant,instance_id:instance,item_id:item,...photo,shared_by_principal_id:principal});
  await insert(q,'supply_materials',{material_id:material,tenant_id:tenant,instance_id:instance,scope_id:scope,kind:'image',product_id:item,title:'Synthetic material',created_by_principal_id:principal});
  const source=await object('storefront.supply-material');
  await insert(q,'supply_material_versions',{version_id:version,material_id:material,tenant_id:tenant,instance_id:instance,kind:'image',version_no:1,
    ...source,purpose:'storefront.supply-material',content_sha256:digest,created_by_principal_id:principal});
  await q.query('UPDATE supply_materials SET current_version_id=$1,aggregate_version=aggregate_version+1 WHERE material_id=$2',[version,material]);
  await insert(q,'commerce_distribution_photo_copies',{...photo,tenant_id:tenant,instance_id:instance,product_id:item,source_material_id:material,source_version_id:version,
    source_content_sha256:digest,source_version_no:1,source_title:'Synthetic material',copied_by_principal_id:principal});
  const pending=randomUUID(),representation=randomUUID();
  await insert(q,'assets',{asset_id:pending,representation_id:representation,scope_id:scope,scope_kind:'tenant',tenant_ref:tenant,
    owner_principal_id:principal,owner_user_id:user,purpose:'storefront.product-photo',policy_revision:'synthetic-upgrade'});
  await insert(q,'asset_upload_intents',{intent_id:randomUUID(),asset_id:pending,representation_id:representation,scope_id:scope,owner_principal_id:principal,target_user_id:user,
    purpose:'storefront.product-photo',policy_revision:'synthetic-upgrade',target_kind:'storefront.product-photo',target_product_id:item,target_instance_id:instance,target_tenant_id:tenant,
    prepare_key:randomUUID(),request_digest:digest,source_content_type:'image/png',source_byte_size:4,source_sha256:digest,expected_version:1,reserved_bytes:1048576,expires_at:new Date(Date.now()+3600000)});
}

async function definitions(q:Query){
  const tables=(await q.query("SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname",[schema])).rows;
  const columns=(await q.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,[schema])).rows;
  const functions=(await q.query(`SELECT p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=$1 ORDER BY identity`,[schema])).rows;
  const constraints=(await q.query(`SELECT c.conrelid::regclass::text relation,c.conname,pg_get_constraintdef(c.oid) definition,pg_get_expr(c.conbin,c.conrelid) expression
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 ORDER BY relation,c.conname`,[schema])).rows;
  const triggers=(await q.query(`SELECT t.tgrelid::regclass::text relation,t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY relation,t.tgname`,[schema])).rows;
  return {tables,columns,functions,constraints,triggers};
}
async function rows(q:Query){
  const result:Record<string,string>={};
  for(const table of ['users','principals','resource_scopes','tenants','tenant_memberships','module_instances','deployment_bindings','commerce_shops','commerce_resource_tenants',
    'commerce_items','commerce_selections','commerce_storefront_profiles','commerce_storefront_publications','commerce_product_photo_targets','commerce_publication_photo_refs',
    'commerce_hosted_supply_offers','commerce_hosted_offer_photos','supply_materials','supply_material_versions','commerce_distribution_photo_copies','assets','asset_objects','asset_upload_intents','domain_media_storage_policy']){
    const columns=(await q.query('SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',[table])).rows
      .map(r=>r.attname).filter(name=>name!=='target_appearance_id');
    result[table]=hash((await q.query(`SELECT ${columns.map(name=>'"'+name+'"').join(',')} FROM ${table} ORDER BY 1`)).rows);
  }
  return result;
}
test('intent baseline drift aborts migration atomically',async()=>{
  const q=await pool.connect(),before=await definitions(pool),data=await rows(pool);
  try{
    await q.query('BEGIN');
    await q.query('ALTER TABLE asset_upload_intents DROP CONSTRAINT upload_profile_shape');
    await q.query('ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_profile_shape CHECK(source_byte_size>0)');
    await assert.rejects(q.query(await readFile(migration,'utf8')),/Unexpected appearance intent baseline/);
  }finally{await q.query('ROLLBACK');q.release();}
  // Full catalog equality also detects leaked columns, implicit FK triggers,
  // constraints and functions, not just the four new table names.
  assert.deepEqual(await definitions(pool),before);
  assert.deepEqual(await rows(pool),data);
});
test('schema175 upgrade is additive and preserves historical projections and admission functions',async()=>{
  const before=await definitions(pool),data=await rows(pool);
  await pool.query(await readFile(migration,'utf8'));
  assert.deepEqual(await rows(pool),data);
  const after=await definitions(pool);
  const wrapped=new Set(['upload_profile_shape','tenant_upload_identity']);
  for(const kind of ['tables','columns','functions','constraints','triggers'] as const){
    const key=(r:Record<string,unknown>)=>kind==='columns'?r.relname+':'+r.attname:kind==='tables'?r.relname:kind==='functions'?r.identity:r.relation+':'+(r.conname??r.tgname);
    const actual=new Map(after[kind].map(r=>[key(r),r]));
    for(const row of before[kind]){
      const current=actual.get(key(row));assert(current,`${kind}: ${key(row)} retained`);
      if(kind==='constraints'&&row.relation==='asset_upload_intents'&&wrapped.has(row.conname)){
        assert(current.expression.includes(row.expression),'The complete old predicate must remain inside the wrapper.');
        assert.match(current.definition,/target_appearance_id IS NULL/);assert.match(current.definition,/storefront.cover/);assert.match(current.definition,/storefront.logo/);
      }else assert.equal(hash(current),hash(row),`${kind}: ${key(row)} unchanged`);
    }
  }
  const oldColumns=new Set(before.columns.map(r=>r.relname+':'+r.attname));
  assert.deepEqual(after.columns.filter(r=>r.relname==='asset_upload_intents'&&!oldColumns.has(r.relname+':'+r.attname)).map(r=>r.attname),['target_appearance_id']);
  const newTables=after.tables.filter(r=>r.relkind==='r'&&!before.tables.some(old=>old.relname===r.relname)).map(r=>r.relname);
  assert.deepEqual(newTables,['commerce_publication_appearance_refs','commerce_publication_appearances','commerce_storefront_appearance_drafts','commerce_storefront_appearance_targets']);
});
