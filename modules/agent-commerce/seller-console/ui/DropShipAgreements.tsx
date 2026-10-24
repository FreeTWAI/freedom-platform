import {useEffect,useState} from 'react';
import {DropShipAgreementsSchema,DropShipAgreementSchema,DropShipSupplierProductsSchema,DropShipProposalSchema,type DropShipAgreement} from '../../../../contracts/guild-launchpad/v1/hosted-drop-ship';
import type {z} from 'zod';
import {formatMinor,parseMajorToMinor} from '../../../../apps/portal-web/src/format';
import type {Controller} from '../state/controller';
import {useRead,ReadStatus,Confirm} from './Shared';
const state={proposed:'等待供應商決定',accepted:'已生效',declined:'已婉拒',withdrawn:'已撤回',revoked:'已撤銷',superseded:'已有新版本'} as const;
function Agreement({c,a,supplier,writable}:{c:Controller;a:DropShipAgreement;supplier:boolean;writable:boolean}) {
 const path=c.root+(supplier?'/supplier-console/drop-ship/agreements/':'/drop-ship/agreements/')+a.agreement_id;
 const act=(action:'accept'|'decline'|'withdraw'|'revoke',label:string)=>c.command({label,path:path+'/'+action,body:action==='accept'||action==='decline'?{terms_sha256:a.terms_sha256}:{},ifMatch:a.version,schema:DropShipAgreementSchema});
 return <article className="card stack"><h3>{supplier?a.store_name:a.supplier_name} · 第 {a.version} 版 <span className="badge">{state[a.state]}</span></h3>
 <ul>{a.items.map(i=><li key={i.selection_id}>{i.title}</li>)}</ul><p>每單代出貨費（含郵資）：{formatMinor(a.fee_per_order_minor,'TWD')}；店家於平台外支付。</p><p>確認收款後 {a.promise_working_days} 個工作天內寄出。</p>
 <details><summary>條件摘要</summary><code style={{overflowWrap:'anywhere'}}>{a.terms_sha256}</code></details>
 <div className="actions">{a.state==='proposed'&&(supplier?<><Confirm label="同意這一版" disabled={c.locked||!writable} onConfirm={()=>act('accept','同意這一版')}><p>同意上述商品、每單代出貨費與寄送承諾。這份同意適用後續符合條件的訂單。</p></Confirm><Confirm label="婉拒" disabled={c.locked||!writable} onConfirm={()=>act('decline','婉拒')}><p>婉拒第 {a.version} 版代出貨提案。</p></Confirm></>:<Confirm label="撤回提案" disabled={c.locked||!writable} onConfirm={()=>act('withdraw','撤回提案')}><p>撤回尚未生效的提案。</p></Confirm>)}
 {a.state==='accepted'&&<Confirm label="撤銷同意" disabled={c.locked||!writable} onConfirm={()=>act('revoke','撤銷同意')}><p>撤銷只影響之後的新訂單，已成立訂單仍須依原版本寄送。</p></Confirm>}</div></article>;
}
type Products=z.infer<typeof DropShipSupplierProductsSchema>['items'];
type ProposalDraft={version:string|undefined;agreementId:string|undefined;selected:string[];fee:string;days:string};
function Proposal({c,products,agreements,writable}:{c:Controller;products:Products;agreements:DropShipAgreement[];writable:boolean}) {
 const supplierId=products[0].supplier_instance_id,name='drop-proposal:'+supplierId;
 const latest=agreements.reduce<DropShipAgreement|undefined>((previous,a)=>!previous||BigInt(a.version)>BigInt(previous.version)?a:previous,undefined);
 const [draft,setDraft]=useState<ProposalDraft|null>(null),[error,setError]=useState('');
 // Reads can arrive in either order. Only an edit freezes fields and their CAS;
 // refreshing the directory must never attach a newer version to older input.
 const initial:ProposalDraft={version:latest?.version,agreementId:latest?.agreement_id,selected:latest?.items.map(i=>i.selection_id)??[],fee:String((latest?.fee_per_order_minor??0)/100),days:String(latest?.promise_working_days??3)};
 const values=draft??initial,stale=values.version!==initial.version||values.agreementId!==initial.agreementId,locked=c.locked||!writable||stale;
 useEffect(()=>()=>c.markDirty(name,false),[c.markDirty,name]);
 const edit=(change:Partial<Pick<ProposalDraft,'selected'|'fee'|'days'>>)=>{setDraft(old=>({...old??initial,...change}));c.markDirty(name,true);setError('');};
 const reset=()=>{setDraft(null);c.markDirty(name,false);setError('');};
 return <form className="card stack" aria-label={'代出貨提案：'+products[0].supplier_name} onSubmit={e=>{
  e.preventDefault();if(locked)return;
  let minor=NaN;try{minor=/^0(?:\.0{1,2})?$/.test(values.fee.trim())?0:parseMajorToMinor(values.fee);}catch{}
  const parsed=DropShipProposalSchema.safeParse({supplier_instance_id:supplierId,selection_ids:values.selected,fee_per_order_minor:minor,promise_working_days:Number(values.days)});
  if(!parsed.success){setError('請選擇商品，填寫非負費用（最多兩位小數）與 1–14 個工作天。');return;}
  c.command({label:latest?'提出新版本':'提出代出貨',path:c.root+'/drop-ship/agreements',body:parsed.data,ifMatch:values.version,schema:DropShipAgreementSchema,success:reset});
 }}>
 <h3>{products[0].supplier_name}</h3>{latest&&<p>最新提案：第 {latest.version} 版 · {state[latest.state]}</p>}{error&&<p role="alert">{error}</p>}
 {stale&&!c.locked&&writable&&<p role="alert">代出貨提案已更新，輸入仍保留。請捨棄草稿並載入最新提案後再編輯；尚未送出新版本。</p>}
 <fieldset className="stack" disabled={locked}><legend>{latest?'提出新版本':'提出代出貨'}</legend>
 {products.map(p=><label className="field" key={p.selection_id}><span><input type="checkbox" checked={values.selected.includes(p.selection_id)} onChange={e=>edit({selected:e.target.checked?[...values.selected,p.selection_id]:values.selected.filter(id=>id!==p.selection_id)})}/> {p.title}</span></label>)}
 <label className="field">每單代出貨費（元，含郵資）<input type="number" min="0" step="0.01" required value={values.fee} onChange={e=>edit({fee:e.target.value})}/></label>
 <label className="field">寄送承諾（工作天）<input type="number" min="1" max="14" step="1" required value={values.days} onChange={e=>edit({days:e.target.value})}/></label>
 <p className="field-hint">費用可為 0 元。工作天為週一至週五，從店家確認收款的次日起算。</p><div className="actions"><button className="btn btn-ghost btn-small" type="submit">{latest?'提出新版本':'提出代出貨'}</button></div></fieldset>
 {draft&&<div className="actions"><button type="button" className="btn btn-ghost btn-small" disabled={c.locked||!writable} onClick={reset}>捨棄草稿並載入最新提案</button></div>}
 </form>;
}
export function DropShipAgreements({c,supplier=false,writable=true}:{c:Controller;supplier?:boolean;writable?:boolean}) {
 const path=supplier?'/supplier-console/drop-ship/agreements':'/drop-ship/agreements',r=useRead(c,'drop-agreements',path,DropShipAgreementsSchema),products=useRead(c,'drop-products','/drop-ship/suppliers',DropShipSupplierProductsSchema,!supplier);
 const groups=new Map<string,Products>();for(const p of products.data?.items??[]){const items=groups.get(p.supplier_instance_id)??[];items.push(p);groups.set(p.supplier_instance_id,items);}
 return <section className="stack"><h2 tabIndex={-1}>{supplier?'代出貨同意':'代出貨'}</h2><p>店家負責收款、取消、退款與客服；供應商依同意寄送。代出貨費含郵資，由店家在平台外支付，工坊不代收或代付。</p>
 <ReadStatus c={c} name="drop-agreements" label="代出貨同意" slot={r}/>{!supplier&&<><ReadStatus c={c} name="drop-products" label="可代出貨商品" slot={products}/>{products.data&&!products.data.items.length&&<p>目前沒有可銷售的供貨商品。</p>}{[...groups].map(([id,items])=><Proposal key={id} c={c} products={items} agreements={(r.data?.items??[]).filter(a=>a.supplier_instance_id===id)} writable={writable&&r.state==='ready'&&products.state==='ready'}/>)}</>}
 {r.data&&!r.data.items.length&&<p>目前沒有代出貨提案或同意。</p>}{r.data?.items.map(a=><Agreement key={a.agreement_id} c={c} a={a} supplier={supplier} writable={writable&&r.state==='ready'}/>)}</section>;
}
