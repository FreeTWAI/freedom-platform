import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import * as wire from '../../../../contracts/guild-launchpad/v1/hosted-drop-ship.js';
import {checkVersion} from '../../../../packages/db/index.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {hashJSON} from '../../checkout/terms.js';
import {requireStoreInstance} from '../../hosted/capabilities.js';
import {shippingSettingsCommand,shippingSettingsRead,nextSettingsVersion,type SettingsActor,type ShippingSettingsContext} from '../settings/command.js';

export type AgreementSide='store'|'supplier';
export interface DropShipAgreementOptions {dropShipEnabled?:boolean}
const sideSQL=(side:AgreementSide)=>side==='store'?'a.tenant_id=$1 AND a.instance_id=$2':'a.supplier_tenant_id=$1 AND a.supplier_instance_id=$2';
export async function agreementView(q:PoolClient,context:ShippingSettingsContext,id:string,side:AgreementSide) {
  const a=(await q.query(`SELECT a.*,a.version::text AS version,s.name AS store_name,p.name AS supplier_name
    FROM commerce_fulfilment_agreements a JOIN commerce_shops s ON s.shop_id=a.store_shop_id JOIN commerce_shops p ON p.shop_id=a.supplier_shop_id
    WHERE ${sideSQL(side)} AND a.agreement_id=$3`,[context.tenant.tenant_id,context.profile.instance_id,id])).rows[0];
  requireCondition(a,404,'not_found','找不到這份代出貨同意。');
  const items=(await q.query(`SELECT ai.selection_id,ai.item_id,i.title FROM commerce_fulfilment_agreement_items ai JOIN commerce_items i USING(item_id) WHERE ai.agreement_id=$1 ORDER BY ai.selection_id`,[id])).rows;
  const {item_count,...allowed}=a;
  return wire.DropShipAgreementSchema.parse({...allowed,proposed_at:a.proposed_at.toISOString(),decided_at:a.decided_at?.toISOString()??null,revoked_at:a.revoked_at?.toISOString()??null,items});
}
export async function listDropShipAgreements(pool:Pool,actor:SettingsActor,tenantId:string,instanceId:string,side:AgreementSide) {
  return shippingSettingsRead(pool,actor,tenantId,instanceId,true,async(q,c)=>{
    await requireStoreInstance(q,c.tenant,instanceId,'store:manage');
    const rows=(await q.query(`SELECT a.agreement_id FROM commerce_fulfilment_agreements a WHERE ${sideSQL(side)} ORDER BY a.proposed_at DESC,a.agreement_id DESC LIMIT 200`,[tenantId,instanceId])).rows;
    const items=[];for(const row of rows)items.push(await agreementView(q,c,row.agreement_id,side));
    return wire.DropShipAgreementsSchema.parse({items});
  });
}
export async function listDropShipSupplierProducts(pool:Pool,actor:SettingsActor,tenantId:string,instanceId:string) {
  return shippingSettingsRead(pool,actor,tenantId,instanceId,true,async(q,c)=>{
    await requireStoreInstance(q,c.tenant,instanceId,'store:manage');
    return wire.DropShipSupplierProductsSchema.parse({items:(await q.query(`SELECT p.instance_id AS supplier_instance_id,ss.name AS supplier_name,s.selection_id,i.item_id,i.title
      FROM commerce_selections s JOIN commerce_items i USING(item_id) JOIN commerce_storefront_profiles p ON p.supply_shop_id=i.shop_id
      JOIN commerce_shops ss ON ss.shop_id=i.shop_id WHERE s.shop_id=$1 AND s.acceptance_state='sellable' AND p.instance_id<>$2 ORDER BY ss.name,s.selection_id LIMIT 200`,[c.profile.storefront_shop_id,instanceId])).rows});
  });
}
export async function proposeDropShipAgreement(pool:Pool,actor:SettingsActor,tenantId:string,instanceId:string,raw:unknown,key:string,expected:string|undefined,options:DropShipAgreementOptions={}) {
  requireCondition(options.dropShipEnabled===true,404,'not_found','找不到這個功能。');
  const input=wire.DropShipProposalSchema.parse(raw),selectionIds=[...input.selection_ids].sort();
  return shippingSettingsCommand(pool,actor,tenantId,instanceId,'store:manage','commerce.drop_ship.propose',{kind:'commerce_fulfilment_agreement',id:instanceId},input,key,expected,async(q,c)=>{
    requireCondition(c.profile.slug!==null&&c.profile.currency==='TWD',422,'validation_failed','代出貨使用新臺幣商店。');
    const supplier=(await q.query(`SELECT p.tenant_id,p.instance_id,p.supply_shop_id FROM commerce_storefront_profiles p JOIN commerce_shops s ON s.shop_id=p.supply_shop_id
      JOIN commerce_shops retail ON retail.shop_id=$2 WHERE p.instance_id=$1 AND p.instance_id<>$3 AND s.community_id=retail.community_id`,[input.supplier_instance_id,c.profile.storefront_shop_id,instanceId])).rows[0];
    requireCondition(supplier,404,'not_found','找不到這個供應商。');
    const last=(await q.query(`SELECT version::text AS version FROM commerce_fulfilment_agreements WHERE instance_id=$1 AND supplier_instance_id=$2 ORDER BY version DESC LIMIT 1`,[instanceId,supplier.instance_id])).rows[0];
    const version=String(nextSettingsVersion(last?.version??null,expected));
    const items=(await q.query(`SELECT s.selection_id,s.item_id FROM commerce_selections s JOIN commerce_items i USING(item_id)
      WHERE s.shop_id=$1 AND s.selection_id=ANY($2::uuid[]) AND s.acceptance_state='sellable' AND i.shop_id=$3 ORDER BY s.selection_id FOR SHARE OF s`,[c.profile.storefront_shop_id,selectionIds,supplier.supply_shop_id])).rows;
    requireCondition(items.length===selectionIds.length,422,'supply_unavailable','請選擇同一供應商目前可銷售的供貨商品。');
    const id=randomUUID(),digest=hashJSON({instance_id:instanceId,supplier_instance_id:supplier.instance_id,version,items,fee_per_order_minor:input.fee_per_order_minor,currency:'TWD',promise_working_days:input.promise_working_days});
    await q.query(`INSERT INTO commerce_fulfilment_agreements(agreement_id,tenant_id,instance_id,store_shop_id,supplier_tenant_id,supplier_instance_id,supplier_shop_id,version,fee_per_order_minor,promise_working_days,item_count,terms_sha256,proposed_by_principal_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,tenantId,instanceId,c.profile.storefront_shop_id,supplier.tenant_id,supplier.instance_id,supplier.supply_shop_id,version,input.fee_per_order_minor,input.promise_working_days,items.length,digest,c.tenant.principal_id]);
    for(const item of items)await q.query(`INSERT INTO commerce_fulfilment_agreement_items(agreement_id,tenant_id,instance_id,supplier_tenant_id,selection_id,item_id,state) VALUES($1,$2,$3,$4,$5,$6,'proposed')`,[id,tenantId,instanceId,supplier.tenant_id,item.selection_id,item.item_id]);
    return {id};
  },(q,c,id)=>agreementView(q,c,id,'store'));
}
export async function decideDropShipAgreement(pool:Pool,actor:SettingsActor,tenantId:string,instanceId:string,id:string,side:AgreementSide,action:'accept'|'decline'|'withdraw'|'revoke',raw:unknown,key:string,expected:string,options:DropShipAgreementOptions={}) {
  requireCondition(options.dropShipEnabled===true,404,'not_found','找不到這個功能。');
  const input=action==='accept'||action==='decline'?wire.DropShipDecisionSchema.parse(raw):wire.DropShipRevokeSchema.parse(raw);
  return shippingSettingsCommand(pool,actor,tenantId,instanceId,'store:manage','commerce.drop_ship.decide',{kind:'commerce_fulfilment_agreement',id},{action,...input},key,expected,async(q,c)=>{
    // Serialize all supplier decisions, including overlap supersession, before locking individual agreements.
    await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,186))',[`drop-ship:${instanceId}`]);
    const a=(await q.query(`SELECT a.*,a.version::text AS version FROM commerce_fulfilment_agreements a WHERE ${sideSQL(side)} AND a.agreement_id=$3 FOR UPDATE`,[tenantId,instanceId,id])).rows[0];
    requireCondition(a,404,'not_found','找不到這份代出貨同意。');checkVersion(a.version,expected);
    requireCondition(action==='revoke'||side==='supplier'&&(action==='accept'||action==='decline')||side==='store'&&action==='withdraw',404,'not_found','找不到這個操作。');
    requireCondition(action==='revoke'?a.state==='accepted':a.state==='proposed',409,'agreement_state_conflict','代出貨同意狀態已變更。');
    if('terms_sha256' in input)requireCondition(input.terms_sha256===a.terms_sha256,412,'terms_changed','條件已更新，請重新閱讀後再決定。');
    if(action==='accept') {
      const old=(await q.query(`SELECT DISTINCT ai.agreement_id FROM commerce_fulfilment_agreement_items ai WHERE ai.instance_id=$1 AND ai.state='accepted'
        AND ai.selection_id IN (SELECT selection_id FROM commerce_fulfilment_agreement_items WHERE agreement_id=$2) ORDER BY ai.agreement_id`,[a.instance_id,id])).rows;
      for(const row of old)await q.query(`UPDATE commerce_fulfilment_agreements SET state='superseded',revoked_by_principal_id=$2,revoked_at=clock_timestamp() WHERE agreement_id=$1 AND state='accepted'`,[row.agreement_id,c.tenant.principal_id]);
    }
    if(action==='revoke')await q.query(`UPDATE commerce_fulfilment_agreements SET state='revoked',revoked_by_principal_id=$2,revoked_at=clock_timestamp(),revoke_reason=$3 WHERE agreement_id=$1`,[id,c.tenant.principal_id,'reason' in input?input.reason??null:null]);
    else await q.query(`UPDATE commerce_fulfilment_agreements SET state=$2,decided_by_principal_id=$3,decided_at=clock_timestamp(),signed_digest=$4 WHERE agreement_id=$1`,[id,{accept:'accepted',decline:'declined',withdraw:'withdrawn'}[action],c.tenant.principal_id,action==='accept'?a.terms_sha256:null]);
    return {id};
  },(q,c,ref)=>agreementView(q,c,ref,side));
}
