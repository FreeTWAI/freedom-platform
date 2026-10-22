import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {CategoryCommandAckSchema,CategoryNameSchema,CreateCategoryInputSchema,ReorderCategoriesInputSchema,SetCategoryGroupsInputSchema,RemoveCategoryInputSchema,STOREFRONT_CATEGORIES_PROFILE,type CategoryCommandAck} from '../../../../contracts/guild-launchpad/v1/storefront-categories.js';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {scopedTenantCommand} from '../../../../packages/scoped-commands/index.js';
import {isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import {assertCurrentSessionClock} from '../../../../packages/db/member-session.js';
import type {TenantScopeContext} from '../../../../packages/resource-scopes/index.js';
import {storeCapabilities,requireStoreInstance,STORE_MISSING} from '../../hosted/capabilities.js';
import type {Actor} from '../../../identity-membership/service.js';
import {profile,instance,retailReady,storeRead,storeFact,type Profile} from '../../hosted/store.js';
import {categoryDraft,categoryCheck,type CategoriesOptions} from './model.js';
export async function listCategories(pool:Pool,actor:Actor,t:string,i:string,options:CategoriesOptions={}){
 return storeRead(pool,actor,t,i,'store:read',async q=>{await q.query('SELECT 1 FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2 FOR SHARE',[t,i]);const p=await profile(q,t,i);retailReady(p);return categoryDraft(q,p,options);});
}
const missing=()=>new Problem(404,'not_found','找不到這個分類。');
async function category(q:PoolClient,p:Profile,id:string|null){if(!OpaqueId.safeParse(id).success)throw missing();const row=(await q.query('SELECT *,version::text FROM commerce_storefront_categories WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3 AND removed_at IS NULL',[p.tenant_id,p.instance_id,id])).rows[0];if(!row)throw missing();return row;}
type CategoryInput={name?:string;category_ids?:string[];group_keys?:string[]};
function input(operation:CategoryCommandAck['operation'],raw:unknown):CategoryInput{
 if(operation==='create'||operation==='rename'){
  const obj=raw as {name?:unknown};let name=obj?.name;
  categoryCheck(typeof name==='string'&&!/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(name),'category_name_invalid');
  name=name.normalize('NFC').trim();categoryCheck(CategoryNameSchema.safeParse(name).success,'category_name_invalid');
  const parsed=CreateCategoryInputSchema.safeParse({...obj,name});requireCondition(parsed.success,422,'validation_failed','分類設定格式無效，請檢查分類與商品。');return parsed.data;
 }
 if(operation==='groups'&&raw!==null&&typeof raw==='object'&&!Array.isArray(raw)){
  const keys=(raw as {group_keys?:unknown}).group_keys;
  if(Array.isArray(keys))categoryCheck(SetCategoryGroupsInputSchema.shape.group_keys.safeParse(keys).success,'category_groups_invalid');
 }
 const schema=operation==='groups'?SetCategoryGroupsInputSchema:operation==='reorder'?ReorderCategoriesInputSchema:RemoveCategoryInputSchema;
 const parsed=schema.safeParse(raw);requireCondition(parsed.success,422,'validation_failed','分類設定格式無效，請檢查分類與商品。');
 const data=parsed.data as CategoryInput;
 if(data.group_keys)categoryCheck(new Set(data.group_keys).size===data.group_keys.length,'category_groups_invalid');
 if(data.category_ids)categoryCheck(new Set(data.category_ids).size===data.category_ids.length,'category_order_invalid');
 return data;
}
export async function categoryCommand(pool:Pool,actor:Actor,t:string,i:string,operation:CategoryCommandAck['operation'],id:string|null,raw:unknown,key:string,expected:string,options:CategoriesOptions={}){
 const body=input(operation,raw);let context!:TenantScopeContext,ack!:CategoryCommandAck;
 const authorize=async(q:PoolClient,c:TenantScopeContext)=>{context=c;const peek=await instance(q,t,i,false,true);await requireStoreInstance(q,c,peek.instance_id,'store:write',true);await instance(q,t,i,true);await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`commerce-orders/${c.community_id}`]);};
 try{
  await scopedTenantCommand(pool,{actor,tenantId:t,tenantLock:'share',operation:'storefront.category.'+operation,body:{category_id:id,...body},key,expected,target:{kind:'storefront',id:i},capabilitiesForRole:storeCapabilities},authorize,async(q,c)=>{
   const p=await profile(q,t,i,true);retailReady(p);requireCondition(p.version===expected,412,'version_conflict','商店資料已更新，請重新讀取分類後再儲存。');
   await q.query("SELECT set_config('freedom.category_variants',$1,true)",[options.variantsEnabled===true?'on':'off']);
   const page=await categoryDraft(q,p,options);let changed=false,categoryId=id;
   if(operation==='create'){
    categoryCheck(page.items.length<30,'category_limit',409);categoryId=randomUUID();const name=(body as {name:string}).name;
    categoryCheck(!page.items.some(c=>c.name===name),'category_name_taken',409);
    await q.query('INSERT INTO commerce_storefront_categories(category_id,tenant_id,instance_id,scope_id,name,name_key,sort_order) VALUES($1,$2,$3,$4,$5,$5,$6)',[categoryId,t,i,c.scope.scope_id,name,page.items.length+1]);changed=true;
   }else if(operation==='reorder'){
    const ids=(body as {category_ids:string[]}).category_ids;categoryCheck(ids.length===page.items.length&&ids.every(id=>page.items.some(c=>c.category_id===id)),'category_order_invalid');
    for(const [n,id] of ids.entries())if(page.items[n].category_id!==id){await q.query('UPDATE commerce_storefront_categories SET sort_order=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3',[t,i,id,n+1]);changed=true;}
   }else{
    const row=await category(q,p,id);
    if(operation==='rename'){
     const name=(body as {name:string}).name;categoryCheck(!page.items.some(c=>c.category_id!==id&&c.name===name),'category_name_taken',409);
     if(name!==row.name){await q.query('UPDATE commerce_storefront_categories SET name=$4,name_key=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3',[t,i,id,name]);changed=true;}
    }else if(operation==='groups'){
     const keys=(body as {group_keys:string[]}).group_keys;categoryCheck(keys.every(k=>page.catalog.some(g=>g.group_key===k)),'category_groups_changed',409);
     const current=(await q.query('SELECT group_key FROM commerce_storefront_category_members WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3 AND removed_at IS NULL ORDER BY sort_order',[t,i,id])).rows.map(r=>r.group_key);
     if(JSON.stringify(current)!==JSON.stringify(keys)){
      await q.query('UPDATE commerce_storefront_category_members SET removed_at=clock_timestamp(),sort_order=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3 AND removed_at IS NULL',[t,i,id]);
      for(const [n,k] of keys.entries())await q.query(`INSERT INTO commerce_storefront_category_members(category_id,tenant_id,instance_id,scope_id,group_key,sort_order) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(category_id,group_key) DO UPDATE SET sort_order=EXCLUDED.sort_order,removed_at=NULL,updated_at=clock_timestamp()`,[id,t,i,row.scope_id,k,n]);
      await q.query('UPDATE commerce_storefront_categories SET version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3',[t,i,id]);changed=true;
     }
    }else{
     await q.query('UPDATE commerce_storefront_category_members SET removed_at=clock_timestamp(),sort_order=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3 AND removed_at IS NULL',[t,i,id]);
     await q.query('UPDATE commerce_storefront_categories SET removed_at=clock_timestamp(),sort_order=NULL,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND category_id=$3',[t,i,id]);
     await q.query('UPDATE commerce_storefront_categories SET sort_order=sort_order-1,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2 AND removed_at IS NULL AND sort_order>$3',[t,i,row.sort_order]);changed=true;
    }
   }
   const completedVersion=changed?String(BigInt(p.version)+1n):p.version;
   if(changed){await q.query('UPDATE commerce_storefront_profiles SET version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2',[t,i]);await storeFact(q,c,i,completedVersion,'storefront.category.'+operation);}
   return {categoryId,operation,completedVersion,changed};
  },authorize,undefined,(source,execute)=>isolatedTransaction(source,async q=>{
   const receipt=await execute(q) as {categoryId:string|null;operation:CategoryCommandAck['operation'];completedVersion:string;changed:boolean};
   requireCondition(receipt.operation===operation,500,'storefront_categories_invalid','商品分類暫時無法讀取，請稍後重試。');const p=await profile(q,t,i,true);retailReady(p);
   ack=CategoryCommandAckSchema.parse({profile:STOREFRONT_CATEGORIES_PROFILE,operation:receipt.operation,category_id:receipt.categoryId,completed_version:receipt.completedVersion,changed:receipt.changed,current:await categoryDraft(q,p,options)});
   await authorize(q,context);await assertCurrentSessionClock(q,actor);return receipt as Awaited<ReturnType<typeof execute>>;
  }));return ack;
 }catch(e){if(e instanceof Problem&&e.code==='tenant_not_found')throw new Problem(404,'not_found',STORE_MISSING);const x=e as {code?:string;constraint?:string;message?:string};
  if(x.code==='23505'&&x.constraint==='storefront_category_name')categoryCheck(false,'category_name_taken',409);
  if(x.code==='23514'&&x.constraint==='storefront_category_limit')categoryCheck(false,'category_limit',409);
  // Migration 183's deferred member validator raises this exact message without a constraint name.
  if(x.code==='23514'&&x.message==='Category group no longer resolves')categoryCheck(false,'category_groups_changed',409);
  throw e;}
}
