import type {SupplyCatalogView} from '../../../../contracts/guild-launchpad/v1/hosted-supply-catalog';
import type {SupplierOverview,SupplierProducts} from '../../../../contracts/guild-launchpad/v1/supplier-console';
import type {ReservationSettingSchema} from '../../../../contracts/guild-launchpad/v1/hosted-shared-order';
import type {z} from 'zod';
import type {ReadSlot} from '../state/useSupplierConsoleController';

export const SUPPLY_CURRENCY_HINT='建立後不可變更。供貨單價、運費與合作售價都使用這個幣別，只有相同幣別的店家能選用，不會自動換匯。選錯時需在另一個業務空間重建，既有商品不會搬移。';
export const SUPPLY_STAGE_LABELS={done:'已完成',current:'目前步驟',todo:'尚待完成',optional:'選用',unknown:'暫時無法確認'} as const;
const titles={tools:'建立業務空間並啟用供貨工具',catalog:'填寫商品庫資料與幣別',product:'新增第一件商品',offer:'設定供貨條件並公開第一個供貨版本',requests:'確認店家的選品申請'} as const;
type ProgressRead<T>=Readonly<Pick<ReadSlot<T>,'state'|'data'>>;
type ReservationSetting=z.infer<typeof ReservationSettingSchema>;
export type SupplyStage={key:keyof typeof titles;title:string;state:keyof typeof SUPPLY_STAGE_LABELS;detail?:string};
type ObservedCount={state:'ready';count:number}|{state:'unknown'};
type ReservationState={state:'ready';enabled:boolean;admission:boolean}|{state:'failed'}|{state:'unavailable'};
type NextAction={kind:'setup';label:'建立供貨商品庫'}|{kind:'navigate';page:'product-new';label:'新增商品'}|{kind:'navigate';page:'products';state:'not_offered';label:'選擇要公開的商品'};
export type SupplySetupProgress={stages:SupplyStage[];nextAction:NextAction|null;storage:ObservedCount;publication:ObservedCount;reservation:ReservationState;steady:boolean;contradictory:boolean;retailEnabled:boolean};
const unknown:ObservedCount={state:'unknown'};
const metric=(value:{state:string;count?:number}|undefined):ObservedCount=>value?.state==='ready'&&typeof value.count==='number'&&Number.isSafeInteger(value.count)&&value.count>=0?{state:'ready',count:value.count}:unknown;

/** Only ready, authorized observations prove progress; capacity includes other suppliers' selections. */
export function supplySetupProgress({profile,overview,products,owner}:{profile:ProgressRead<SupplyCatalogView>;overview:ProgressRead<SupplierOverview>;products:ProgressRead<SupplierProducts>;owner:ProgressRead<ReservationSetting>}):SupplySetupProgress {
 const p=profile.state==='ready'?profile.data:null,write=p?.capabilities.includes('store:write')===true,ready=p?.setup_state==='ready';
 const reservation:ReservationState=owner.state==='ready'&&owner.data?{state:'ready',enabled:owner.data.reservation_enabled,admission:owner.data.admission_enabled}:owner.state==='failed'?{state:'failed'}:{state:'unavailable'};
 let storage:ObservedCount=write&&ready&&products.state==='ready'&&Array.isArray(products.data?.items)?{state:'ready',count:products.data.items.length}:unknown;
 let publication=write&&ready&&overview.state==='ready'?metric(overview.data?.metrics?.offered_products):unknown;
 const pending=write&&ready&&overview.state==='ready'?metric(overview.data?.metrics?.pending_requests):unknown;
 const contradictory=storage.state==='ready'&&publication.state==='ready'&&publication.count>storage.count;
 if(contradictory){storage=unknown;publication=unknown;}
 const states:Record<SupplyStage['key'],SupplyStage['state']>={tools:'done',catalog:p?ready?'done':'current':'unknown',product:'unknown',offer:'unknown',requests:'unknown'};
 if(p?.setup_state==='setup_required'){states.product='todo';states.offer='todo';states.requests='optional';}
 else if(ready){
  if(storage.state==='ready')states.product=storage.count>0?'done':'current';
  if(publication.state==='ready')states.offer=publication.count>0?'done':states.product==='done'?'current':'todo';
  if(pending.state==='ready')states.requests='optional';
 }
 const stages=Object.entries(titles).map(([key,title]):SupplyStage=>({key:key as SupplyStage['key'],title,state:states[key as SupplyStage['key']]}));
 if(ready&&p?.catalog)stages[1].detail=`幣別：${p.catalog.currency}（建立後不可變更）`;
 if(pending.state==='ready')stages[4].detail=pending.count?`${pending.count} 筆售價申請待確認`:'目前沒有待確認的申請';
 const steady=stages.slice(0,4).every(stage=>stage.state==='done');
 let nextAction:NextAction|null=null;
 if(write&&p?.writable){
  if(p.setup_state==='setup_required'&&p.capabilities.includes('store:manage'))nextAction={kind:'setup',label:'建立供貨商品庫'};
  else if(!steady&&storage.state==='ready'&&publication.state==='ready'&&pending.state==='ready'){
   if(states.product==='current'&&p.product_count<p.product_limit)nextAction={kind:'navigate',page:'product-new',label:'新增商品'};
   else if(states.offer==='current'&&p.capabilities.includes('store:publish'))nextAction={kind:'navigate',page:'products',state:'not_offered',label:'選擇要公開的商品'};
  }
 }
 return {stages,nextAction,storage,publication,reservation,steady,contradictory,retailEnabled:ready&&p?.retail_enabled===true};
}
