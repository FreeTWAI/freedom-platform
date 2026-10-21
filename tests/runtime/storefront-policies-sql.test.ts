import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {bindTenantContext} from '../../packages/resource-scopes/tenant-transaction.js';
import {legalTables,seedSellerPolicyRows} from '../helpers/storefront-policies.js';
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString)throw Error('Explicit isolated TEST_DATABASE_URL required');
const schema=`fp_policies_sql_${process.pid}_${Date.now()}`,role=schema+'_role';
const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Query=Pick<PoolClient,'query'>;
let fixture:Awaited<ReturnType<typeof seedSellerPolicyRows>>,runtime:Pool,tenant:string,instance:string,scope:string;
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

before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);
 for(const file of (await readdir(new URL('../../migrations/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n)&&Number(n.slice(0,3))<=175).sort())await pool.query(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
 const q=await pool.connect();try{await q.query('BEGIN');await seed(q);await seed(q);await q.query('COMMIT');}finally{q.release();}
 const before=await definitions(pool),rows=(await pool.query('SELECT * FROM commerce_storefront_publications')).rows;
 await pool.query(await readFile(new URL('../../migrations/176_storefront_seller_policies.sql',import.meta.url),'utf8'));
 const after=await definitions(pool);
 for(const key of Object.keys(before) as (keyof typeof before)[]){const actual=new Set(after[key].map(hash));for(const row of before[key])assert(actual.has(hash(row)),`${key}: baseline unchanged`);}
 assert.deepEqual((await pool.query('SELECT * FROM commerce_storefront_publications')).rows,rows);
 const p=(await pool.query('SELECT * FROM commerce_storefront_profiles')).rows[0];tenant=p.tenant_id;instance=p.instance_id;
 scope=(await pool.query("SELECT scope_id FROM resource_scopes WHERE tenant_ref=$1 AND kind='tenant'",[tenant])).rows[0].scope_id;
 const client=await pool.connect();try{await client.query('BEGIN');fixture=await seedSellerPolicyRows(client,{tenantId:tenant,instanceId:instance});const other=(await client.query('SELECT tenant_id,instance_id FROM commerce_storefront_profiles WHERE tenant_id<>$1',[tenant])).rows[0];await seedSellerPolicyRows(client,{tenantId:other.tenant_id,instanceId:other.instance_id});await client.query('COMMIT');}finally{client.release();}
 await admin.query(`CREATE ROLE ${role} LOGIN;GRANT USAGE ON SCHEMA ${schema} TO ${role};GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
 const url=new URL(connectionString);url.username=role;url.password='';runtime=new Pool({connectionString:url.toString(),options:`-c search_path=${schema}`});
});
after(async()=>{await runtime?.end();await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;DROP ROLE IF EXISTS ${role}`);await admin.end();});
async function tx(run:(q:PoolClient)=>Promise<void>,source=pool){const q=await source.connect();try{await q.query('BEGIN');await run(q);}finally{await q.query('ROLLBACK');q.release();}}
async function fails(q:PoolClient,sql:string,values:unknown[]=[],code='23514'){await q.query('SAVEPOINT invalid');await assert.rejects(q.query(sql,values),(e:unknown)=>(e as {code:string}).code===code);await q.query('ROLLBACK TO SAVEPOINT invalid');}
test('POL-SQL-01 schema176 adds six tables without changing any baseline object or publication',async()=>{
 for(const table of legalTables)assert((await pool.query(`SELECT 1 FROM ${table}`)).rowCount);
});
test('POL-SQL-02 immutable versions and freezes reject every UPDATE and DELETE',()=>tx(async q=>{
 for(const table of legalTables.filter(t=>!t.endsWith('_drafts'))){await fails(q,`UPDATE ${table} SET tenant_id=tenant_id`);await fails(q,`DELETE FROM ${table}`);}
 for(const table of legalTables.filter(t=>t.endsWith('_drafts'))){await fails(q,`DELETE FROM ${table}`);await fails(q,`UPDATE ${table} SET instance_id=$1`,[randomUUID()]);}
}));
test('POL-SQL-03 kinds, Unicode lengths, structured fields and dense sequence are closed',()=>tx(async q=>{
 const sql=`INSERT INTO commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind,version_no,created_at_profile_version,body,window_days,return_by_days,drop_ship_disclosed,content_sha256) VALUES(gen_random_uuid(),$1,$2,$3,$4,1,$5,$6,$7,$8,$9)`;
 for(const [kind,no,body,window,by,drop] of [['other',1,'',null,null,null],['shipping',3,'',null,null,null],['shipping',2,'x'.repeat(10001),null,null,null],['shipping',2,'\u202e',null,null,null],['shipping',2,'',7,null,null],['returns',2,'',6,14,null],['returns',2,'',7,0,null],['privacy',2,'',null,null,null]] as const)await fails(q,sql,[tenant,instance,kind,no,body,window,by,drop,'a'.repeat(64)]);
 await q.query(sql,[tenant,instance,'shipping',2,'😀'.repeat(10000),null,null,null,'a'.repeat(64)]);
 await fails(q,'INSERT INTO commerce_storefront_policy_drafts(tenant_id,instance_id,kind,version_id) VALUES($1,$2,\'shipping\',$3)',[tenant,randomUUID(),fixture.policyIds.shipping]);
}));
test('POL-SQL-04 dense 500 boundary rejects 501 without 500 command saves',()=>tx(async q=>{
 await q.query(`INSERT INTO commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind,version_no,created_at_profile_version,body,content_sha256)
 SELECT gen_random_uuid(),$1,$2,'shipping',n,1,'合成上限測試',repeat('a',64) FROM generate_series(2,500) n ORDER BY n`,[tenant,instance]);
 await fails(q,`INSERT INTO commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind,version_no,created_at_profile_version,body,content_sha256) VALUES(gen_random_uuid(),$1,$2,'shipping',501,1,'',repeat('a',64))`,[tenant,instance]);
 await q.query(`INSERT INTO commerce_storefront_seller_versions(version_id,tenant_id,instance_id,version_no,created_at_profile_version,business_name,email,phone,address,service_hours,tax_id,responsible_person,content_sha256)
 SELECT gen_random_uuid(),$1,$2,n,1,'合成測試商行','','','','','','',repeat('a',64) FROM generate_series(2,500) n ORDER BY n`,[tenant,instance]);
 await fails(q,`INSERT INTO commerce_storefront_seller_versions(version_id,tenant_id,instance_id,version_no,created_at_profile_version,business_name,email,phone,address,service_hours,tax_id,responsible_person,content_sha256) VALUES(gen_random_uuid(),$1,$2,501,1,'','','','','','','',repeat('a',64))`,[tenant,instance]);
}));
test('POL-SQL-05 RLS denies unbound and foreign reads and writes',async()=>{await tx(async q=>{
 for(const table of legalTables)assert.equal((await q.query(`SELECT 1 FROM ${table}`)).rowCount,0);
 await bindTenantContext(q,{tenantId:randomUUID(),tenantScopeId:randomUUID()});
 for(const table of legalTables)assert.equal((await q.query(`SELECT 1 FROM ${table}`)).rowCount,0);
 await fails(q,'INSERT INTO commerce_storefront_seller_drafts(tenant_id,instance_id,version_id) VALUES($1,$2,$3)',[tenant,instance,fixture.sellerId]);
 await fails(q,'INSERT INTO commerce_publication_seller_policies(publication_id,tenant_id,instance_id,document,policies_sha256) VALUES($1,$2,$3,$4,$5)',[fixture.profile.current_publication_id,tenant,instance,{profile:'freedom.hosted-store-policies/v1',seller:null,policies:{shipping:null,returns:null,privacy:null,terms:null}},'a'.repeat(64)],'42501');
 },runtime);await tx(async q=>{
 await bindTenantContext(q,{tenantId:tenant,tenantScopeId:scope});
 for(const table of legalTables){assert((await q.query(`SELECT 1 FROM ${table}`)).rowCount);assert.equal((await q.query(`DELETE FROM ${table}`)).rowCount,0);}
},runtime);});
test('POL-SQL-06 runtime grants revoke immutable and column writes',()=>tx(async q=>{
 const text=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
 const sql=text.split('-- BEGIN STOREFRONT SELLER POLICY GRANTS\n')[1].split('\n\\gexec')[0].replaceAll(":'runtime'",`'${role}'`).replaceAll("n.nspname='public'",`n.nspname='${schema}'`);
 await q.query(`GRANT UPDATE(document) ON commerce_publication_seller_policies TO ${role} WITH GRANT OPTION`);
 for(const row of (await q.query(sql)).rows)await q.query(Object.values(row)[0] as string);
 for(const table of legalTables){const p=(await q.query("SELECT has_table_privilege($1,$2,'SELECT') r,has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE,TRUNCATE,TRIGGER,REFERENCES') unsafe",[role,table])).rows[0];assert.deepEqual(p,{r:true,i:true,u:table.endsWith('_drafts'),unsafe:false});}
}));

test('POL-SQL-07 composite FKs reject foreign seller and policy refs; deferred freeze must be complete',()=>tx(async q=>{
 const b=(await q.query('SELECT * FROM commerce_storefront_profiles WHERE tenant_id<>$1',[tenant])).rows[0],id=randomUUID();
 await q.query(`INSERT INTO commerce_storefront_publications(publication_id,tenant_id,instance_id,revision,slug,projection,projection_sha256,published_by_principal_id)
 SELECT $1,tenant_id,instance_id,revision+1,slug,projection,projection_sha256,published_by_principal_id FROM commerce_storefront_publications WHERE publication_id=$2`,[id,b.current_publication_id]);
 const doc={profile:'freedom.hosted-store-policies/v1',seller:null,policies:{shipping:null,returns:null,privacy:null,terms:null}};
 await fails(q,'INSERT INTO commerce_publication_seller_policies(publication_id,tenant_id,instance_id,seller_version_id,document,policies_sha256) VALUES($1,$2,$3,$4,$5,$6)',[id,b.tenant_id,b.instance_id,fixture.sellerId,doc,'a'.repeat(64)],'23503');
 await q.query('INSERT INTO commerce_publication_seller_policies(publication_id,tenant_id,instance_id,document,policies_sha256) VALUES($1,$2,$3,$4,$5)',[id,b.tenant_id,b.instance_id,doc,'a'.repeat(64)]);
 await fails(q,"INSERT INTO commerce_publication_policy_refs(publication_id,tenant_id,instance_id,kind,version_id) VALUES($1,$2,$3,'shipping',$4)",[id,b.tenant_id,b.instance_id,fixture.policyIds.shipping],'23503');
 await q.query('SAVEPOINT inconsistent');
 const own=(await q.query("SELECT version_id FROM commerce_storefront_policy_versions WHERE tenant_id=$1 AND kind='shipping'",[b.tenant_id])).rows[0];
 await q.query("INSERT INTO commerce_publication_policy_refs(publication_id,tenant_id,instance_id,kind,version_id) VALUES($1,$2,$3,'shipping',$4)",[id,b.tenant_id,b.instance_id,own.version_id]);
 await assert.rejects(q.query('SET CONSTRAINTS ALL IMMEDIATE'),(e:unknown)=>(e as {code:string}).code==='23514');await q.query('ROLLBACK TO SAVEPOINT inconsistent');
}));
test('POL-SQL-08 seller format and code-point limits are enforced independently of commands',()=>tx(async q=>{
 const seller={business_name:'合成測試商行',email:'seller@example.test',phone:'+886-2-0000-0000',address:'測試市範例路 1 號',service_hours:'合成客服時間',tax_id:'00000000',responsible_person:'合成負責人'},columns=Object.keys(seller);
 const sql=`INSERT INTO commerce_storefront_seller_versions(version_id,tenant_id,instance_id,version_no,created_at_profile_version,${columns.join(',')},content_sha256) VALUES(gen_random_uuid(),$1,$2,2,1,${columns.map((_,i)=>'$'+(i+3)).join(',')},repeat('a',64))`;
 for(const patch of [{business_name:''},{business_name:'字'.repeat(121)},{email:'invalid'},{phone:'javascript:123456'},{address:'字'.repeat(301)},{service_hours:'line\nline'},{tax_id:'00000000\n'},{tax_id:'１２３４５６７８'},{responsible_person:'a\u202eb'}])await fails(q,sql,[tenant,instance,...Object.values({...seller,...patch})]);
 await q.query(sql,[tenant,instance,...Object.values({...seller,business_name:'😀'.repeat(120),address:'😀'.repeat(300),service_hours:'😀'.repeat(300),responsible_person:'😀'.repeat(80)})]);
}));
