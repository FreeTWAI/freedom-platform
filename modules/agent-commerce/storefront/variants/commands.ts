import type {Pool,PoolClient} from 'pg';
import {ProductGroupKeySchema,ReplaceProductGroupInputSchema,CreateVariantProductInputSchema,SplitProductGroupInputSchema,VariantCommandAckSchema,STOREFRONT_VARIANTS_PROFILE,VariantAxisNameSchema,VariantValueNameSchema,VariantGroupTitleSchema,VariantGroupDescriptionSchema,type ProductGroupDraft,type VariantCommandAck} from '../../../../contracts/guild-launchpad/v1/storefront-variants.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {scopedTenantCommand} from '../../../../packages/scoped-commands/index.js';
import {isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import {assertCurrentSessionClock} from '../../../../packages/db/member-session.js';
import {storeCapabilities,requireStoreInstance,STORE_MISSING} from '../../hosted/capabilities.js';
import type {TenantScopeContext} from '../../../../packages/resource-scopes/index.js';
import type {Actor} from '../../../identity-membership/service.js';
import {profile,instance,retailReady,storeRead,storeFact,type Profile} from '../../hosted/store.js';
import {createProductRow} from '../../hosted/products.js';
import {buyerLabel,draftVariantsData} from './model.js';
import {variantCheck} from './errors.js';
const normalized=(value:string)=>value.trim().normalize('NFC');
function normalizeReplace(raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
 const data=raw as Record<string,unknown>,text=(v:unknown)=>typeof v==='string'?normalized(v):v;
 return {...data,title:text(data.title),description:text(data.description),axes:Array.isArray(data.axes)?data.axes.map(axis=>{
  if(!axis||typeof axis!=='object'||Array.isArray(axis))return axis;
  return {...axis,name:text(axis.name),values:Array.isArray(axis.values)?axis.values.map((value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?{...value,name:text((value as Record<string,unknown>).name)}:value):axis.values};
 }):data.axes};
}
function parseReplace(raw:unknown){
 const data=normalizeReplace(raw) as Record<string,unknown>;
 variantCheck(data&&typeof data==='object'&&VariantGroupTitleSchema.safeParse(data.title).success&&VariantGroupDescriptionSchema.safeParse(data.description).success,'variant_group_text_invalid');
 variantCheck(Array.isArray(data.axes)&&data.axes.length<=2&&data.axes.every(a=>Array.isArray(a?.values)&&a.values.length>=1&&a.values.length<=20),'variant_axes_invalid');
 if(Array.isArray(data.axes))for(const axis of data.axes){
  variantCheck(VariantAxisNameSchema.safeParse(axis?.name).success,'variant_axis_name_invalid');
  if(Array.isArray(axis?.values))for(const value of axis.values)variantCheck(VariantValueNameSchema.safeParse(value?.name).success,'variant_value_invalid');
 }
 const parsed=ReplaceProductGroupInputSchema.safeParse(data);requireCondition(parsed.success,422,'validation_failed','規格設定格式無效，請檢查商品組、選項與成員。');
 const input=parsed.data;
 variantCheck(new Set(input.axes.map(a=>a.key)).size===input.axes.length&&new Set(input.axes.map(a=>a.name)).size===input.axes.length,'variant_axes_invalid');
 for(const a of input.axes)variantCheck(new Set(a.values.map(v=>v.key)).size===a.values.length&&new Set(a.values.map(v=>v.name)).size===a.values.length,'variant_value_invalid');
 variantCheck(new Set(input.members.map(m=>m.product_id)).size===input.members.length,'variant_order_invalid');
 variantCheck(input.axes.length>0||input.members.length===1,'variant_singleton_requires_one_member');
 const tuples=new Set<string>();
 for(const m of input.members){
  const values=input.axes.map((a,n)=>a.values.find(v=>v.key===m.value_keys[n])?.name);
  variantCheck(m.value_keys.length===input.axes.length&&values.every(v=>typeof v==='string'),'variant_member_values_invalid');
  const tuple=JSON.stringify(m.value_keys);variantCheck(!tuples.has(tuple),'variant_combination_duplicate',409);tuples.add(tuple);
  variantCheck(buyerLabel(input.title,values as string[]).length<=120,'variant_label_too_long');
 }
 variantCheck(input.members.some(m=>m.product_id===input.default_product_id),'variant_default_invalid');return input;
}
function checkedGroupKey(raw:string){requireCondition(ProductGroupKeySchema.safeParse(raw).success,404,'not_found','找不到這個商品組。');return raw;}
function group(page:{items:ProductGroupDraft[]},key:string){const g=page.items.find(g=>g.group_key===key);requireCondition(g,404,'not_found','找不到這個商品組。');return g;}
function version(g:ProductGroupDraft,expected:string){requireCondition(g.version===expected,412,'version_conflict','規格已更新，請重新讀取後再儲存。');}
export async function listProductGroups(pool:Pool,actor:Actor,t:string,i:string,key?:string){
 return storeRead(pool,actor,t,i,'store:read',async q=>{const p=await profile(q,t,i);retailReady(p);const {page}=await draftVariantsData(q,p);return key===undefined?page:group(page,checkedGroupKey(key));});
}
async function save(q:PoolClient,c:TenantScopeContext,p:Profile,current:ProductGroupDraft,input:ReturnType<typeof parseReplace>,operation='storefront.product-group.replace'){
 const data=await draftVariantsData(q,p),all=data.page.items;
 variantCheck(current.editable,'variant_supply_not_supported',409);variantCheck(current.can_anchor,'variant_anchor_retained',409);
 const desired=input.members.map(m=>{const owner=all.find(g=>g.members.some(v=>v.product.product_id===m.product_id));const member=owner?.members.find(v=>v.product.product_id===m.product_id);
  variantCheck(member&&member.product.version===m.product_version,'variant_members_changed',409);variantCheck(member.source==='own','variant_supply_not_supported',409);
  variantCheck(owner!.group_key===current.group_key||owner!.group_id===null,'variant_member_in_group',409);return {...m,selection_id:member.selection_id};});
 const comparable=(g:ProductGroupDraft)=>({title:g.title,description:g.description,axes:g.axes,members:g.members.map(m=>({product_id:m.product.product_id,product_version:m.product.version,value_keys:m.value_keys})),default_product_id:g.default_product_id,order:g.order});
 if(JSON.stringify(comparable(current))===JSON.stringify(input))return {completedVersion:current.version,changed:false};
 // Lock items and selections before gallery home rows, consistently with photo edits.
 const ids=[...new Set([...current.members.map(m=>m.product.product_id),...desired.map(m=>m.product_id)])].sort();
 await q.query('SELECT item_id FROM commerce_items WHERE shop_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY item_id FOR UPDATE',[p.supply_shop_id,ids]);
 await q.query('SELECT selection_id FROM commerce_selections WHERE shop_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY selection_id FOR UPDATE',[p.storefront_shop_id,ids]);
 // Materialize the same retained gallery home rows in bulk. Item/selection
 // locks and the original 177 triggers remain the authority for each row.
 await q.query(`INSERT INTO commerce_product_photo_targets(product_id,tenant_id,instance_id,scope_id)
  SELECT product_id,$2,$3,$4 FROM unnest($1::uuid[]) product_id ON CONFLICT DO NOTHING`,[ids,p.tenant_id,p.instance_id,c.scope.scope_id]);
 await q.query(`INSERT INTO commerce_product_groups(group_id,tenant_id,instance_id,scope_id,anchor_product_id,last_changed_at_product_version)
  SELECT gen_random_uuid(),$2,$3,$4,s.item_id,s.aggregate_version FROM commerce_selections s
  WHERE s.shop_id=$5 AND s.item_id=ANY($1::uuid[]) ORDER BY s.item_id
  ON CONFLICT(tenant_id,instance_id,anchor_product_id) DO NOTHING`,[ids,p.tenant_id,p.instance_id,c.scope.scope_id,p.storefront_shop_id]);
 await q.query(`INSERT INTO commerce_product_group_members(tenant_id,instance_id,scope_id,group_id,selection_id,product_id)
  SELECT g.tenant_id,g.instance_id,g.scope_id,g.group_id,s.selection_id,g.anchor_product_id FROM commerce_product_groups g
  JOIN commerce_selections s ON s.item_id=g.anchor_product_id AND s.shop_id=$4
  WHERE g.tenant_id=$1 AND g.instance_id=$2 AND g.anchor_product_id=ANY($3::uuid[]) ORDER BY g.group_id
  ON CONFLICT(tenant_id,instance_id,selection_id) DO NOTHING`,[p.tenant_id,p.instance_id,ids,p.storefront_shop_id]);
 await q.query(`SELECT group_id FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 AND (anchor_product_id=ANY($3::uuid[]) OR group_id=$4) ORDER BY group_id FOR UPDATE`,[p.tenant_id,p.instance_id,ids,current.group_id]);
 let groupId=current.group_id;
 if(!groupId)groupId=(await q.query('SELECT group_id FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 AND anchor_product_id=$3',[p.tenant_id,p.instance_id,current.members[0].product.product_id])).rows[0].group_id;
 const next=String(BigInt(current.version)+1n);
 await q.query(`UPDATE commerce_product_group_members SET catalog_group_id=NULL,option_value_keys='{}',sort_order=0,membership_version=membership_version+1 WHERE tenant_id=$1 AND instance_id=$2 AND catalog_group_id=$3`,[p.tenant_id,p.instance_id,groupId]);
 await q.query(`UPDATE commerce_product_groups SET catalog_anchor_sku=$4,title=$5,description=$6,option_axes=$7,default_selection_id=$8,sort_order=$9,version=$10 WHERE tenant_id=$1 AND instance_id=$2 AND group_id=$3`,[p.tenant_id,p.instance_id,groupId,current.group_key,input.title,input.description,JSON.stringify(input.axes),desired.find(m=>m.product_id===input.default_product_id)!.selection_id,input.order,next]);
 await q.query(`UPDATE commerce_product_group_members m SET catalog_group_id=$3,option_value_keys=v.value_keys,sort_order=v.position,membership_version=m.membership_version+1
  FROM jsonb_to_recordset($4::jsonb) AS v(selection_id uuid,value_keys uuid[],position integer)
  WHERE m.tenant_id=$1 AND m.instance_id=$2 AND m.selection_id=v.selection_id`,[p.tenant_id,p.instance_id,groupId,JSON.stringify(desired.map((m,position)=>({selection_id:m.selection_id,value_keys:m.value_keys,position})))]);
 await storeFact(q,c,groupId!,next,operation,'storefront_product_group');return {completedVersion:next,changed:true};
}
async function command(pool:Pool,actor:Actor,t:string,i:string,rawKey:string,key:string,expected:string,operation:VariantCommandAck['operation'],body:unknown,run:(q:PoolClient,c:TenantScopeContext,p:Profile,g:ProductGroupDraft)=>Promise<{completedVersion:string;changed:boolean}>){
 const groupKey=rawKey;let context!:TenantScopeContext,ack!:VariantCommandAck;
 // Use the canonical store writer gates and lock order, also on receipt replay.
 const authorize=async(q:PoolClient,c:TenantScopeContext)=>{context=c;const peek=await instance(q,t,i,false,true);
  await requireStoreInstance(q,c,peek.instance_id,'store:write',true);await instance(q,t,i,true);
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`commerce-orders/${c.community_id}`]);
 };
 try{
  await scopedTenantCommand(pool,{actor,tenantId:t,tenantLock:'share',operation:'storefront.product-group.'+operation,body:{group_key:groupKey,...body as object},key,expected,
   target:{kind:'storefront',id:i},capabilitiesForRole:storeCapabilities},authorize,async(q,c)=>{
    const p=await profile(q,t,i,true);retailReady(p);const g=group((await draftVariantsData(q,p)).page,checkedGroupKey(groupKey));version(g,expected);
    return {groupKey,operation,...await run(q,c,p,g)};
   },authorize,undefined,(source,execute)=>isolatedTransaction(source,async q=>{
    const receipt=await execute(q) as {groupKey:string;operation:VariantCommandAck['operation'];completedVersion:string;changed:boolean};
    requireCondition(receipt.groupKey===groupKey&&receipt.operation===operation,500,'storefront_variants_invalid','商品規格暫時無法讀取，請稍後重試。');
    const p=await profile(q,t,i,true);retailReady(p);
    ack=VariantCommandAckSchema.parse({profile:STOREFRONT_VARIANTS_PROFILE,group_key:receipt.groupKey,operation:receipt.operation,completed_version:receipt.completedVersion,changed:receipt.changed,current:(await draftVariantsData(q,p)).page});
    // Current reply and receipt commit together. A failed current authorization
    // cannot leave a committed new mutation behind a known rejection response.
    await authorize(q,context);await assertCurrentSessionClock(q,actor);return receipt as Awaited<ReturnType<typeof execute>>;
   }));return ack;
 }catch(e){if(e instanceof Problem&&e.code==='tenant_not_found')throw new Problem(404,'not_found',STORE_MISSING);throw e;}
}
export function replaceProductGroup(pool:Pool,actor:Actor,t:string,i:string,g:string,key:string,expected:string,raw:unknown){const input=parseReplace(raw);return command(pool,actor,t,i,g,key,expected,'replace',input,(q,c,p,current)=>save(q,c,p,current,input));}
export function splitProductGroup(pool:Pool,actor:Actor,t:string,i:string,g:string,key:string,expected:string,raw:unknown){
 const parsed=SplitProductGroupInputSchema.safeParse(raw);requireCondition(parsed.success,422,'validation_failed','規格設定格式無效，請檢查商品組、選項與成員。');const input=parsed.data;return command(pool,actor,t,i,g,key,expected,'split',input,async(q,c,p,current)=>{
  variantCheck(current.editable,'variant_supply_not_supported',409);if(!current.group_id)return {completedVersion:current.version,changed:false};
  await q.query(`UPDATE commerce_product_group_members SET catalog_group_id=NULL,option_value_keys='{}',sort_order=0,membership_version=membership_version+1 WHERE tenant_id=$1 AND instance_id=$2 AND catalog_group_id=$3`,[t,i,current.group_id]);
  const next=String(BigInt(current.version)+1n);await q.query('UPDATE commerce_product_groups SET default_selection_id=NULL,version=$4 WHERE tenant_id=$1 AND instance_id=$2 AND group_id=$3',[t,i,current.group_id,next]);
  await storeFact(q,c,current.group_id,next,'storefront.product-group.split','storefront_product_group');return {completedVersion:next,changed:true};
 });
}
export function createVariantProduct(pool:Pool,actor:Actor,t:string,i:string,g:string,key:string,expected:string,raw:unknown){
 const parsed=CreateVariantProductInputSchema.safeParse(raw);requireCondition(parsed.success,422,'validation_failed','規格設定格式無效，請檢查商品組、選項與成員。');const input=parsed.data;return command(pool,actor,t,i,g,key,expected,'create-product',input,async(q,c,p,current)=>{
  variantCheck(current.editable,'variant_supply_not_supported',409);variantCheck(current.can_anchor,'variant_anchor_retained',409);
  const product=await createProductRow(q,c,p,{...input.product,description:input.product.description??'',stock:input.product.stock??0},false,'storefront.product-group.create-product');
  const body=parseReplace({title:current.title,description:current.description,axes:current.axes,members:[...current.members.map(m=>({product_id:m.product.product_id,product_version:m.product.version,value_keys:m.value_keys})),{product_id:product.product_id,product_version:product.version,value_keys:input.value_keys}],default_product_id:current.default_product_id,order:current.order});
  return save(q,c,p,current,body,'storefront.product-group.create-product');
 });
}
