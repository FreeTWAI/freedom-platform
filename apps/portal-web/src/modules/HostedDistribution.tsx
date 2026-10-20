import {SELLABLE_LABEL} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferPresentation';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import type {z} from 'zod';
import {DistributionInputSchema,DistributionSchema,DistributionsSchema,SupplyCatalogPhotosSchema,SupplyOfferSchema,SupplyOffersSchema,type Distribution,type SupplyOffer} from '../../../../contracts/guild-launchpad/v1/hosted-distribution';
import {SupplyOfferPhoto} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferPhoto';
import {ApiError,type PortalClient} from '../api';
import {formatMinor,parseMajorToMinor} from '../format';
import {PriceDifference,productMatches} from '../../../../modules/agent-commerce/hosted-ui/CommerceTools';

export type DistributionCommand = {method:'post'|'patch';path:string;body:unknown;version?:string;schema:z.ZodType;notice:string;success:(value:unknown)=>void;targetMissingIsStore?:boolean};
export const distributionStateWord:Record<Distribution['state'],string> = {awaiting_supply_acceptance:'等待供應商確認',sellable:SELLABLE_LABEL,declined:'供應商未同意',changes_requested:'需要修改',revoked:'已撤回供貨'};
export type SupplyCooperationSnapshot = {ok:true;offers:SupplyOffer[];offersTruncated:boolean;requests:Distribution[];requestsTruncated:boolean} | {ok:false;stale?:boolean};
/** Decision buttons use this same pair: still offered, and still waiting for this supplier. */
export function supplyRequestsWaiting(requests:Distribution[]) {
  return requests.filter(request=>request.state==='awaiting_supply_acceptance'&&request.offer.state==='offered').length;
}
type CatalogPhoto=z.infer<typeof SupplyCatalogPhotosSchema>['items'][number]['photo'];
const photoReadHint='暫時無法載入供貨照片，清單內容不受影響。';
/** Independent optional projection: no photo failure can reject the text-list read. */
function useSupplyCatalogPhotos(client:PortalClient,root:string,refresh:number,enabled:boolean) {
  const generation=client.sessionGeneration,scope=`${root}:${generation}:${refresh}:${enabled}`;
  const current=useRef(scope);current.current=scope;
  const [result,setResult]=useState<{scope:string;items:z.infer<typeof SupplyCatalogPhotosSchema>['items'];error:string;failed:string[]}|null>(null);
  useEffect(()=>{
    if(!enabled)return;
    const abort=new AbortController();
    const valid=()=>!abort.signal.aborted&&current.current===scope&&client.sessionGeneration===generation;
    void client.get(root+'/supply-catalog-photos',{signal:abort.signal,background:true,skipAuthHandler:true}).then(raw=>{
      if(!valid())return;
      const data=SupplyCatalogPhotosSchema.parse(raw);
      setResult({scope,items:data.items,error:'',failed:[]});
    }).catch(cause=>{
      if(valid())setResult({scope,items:[],failed:[],error:cause instanceof ApiError&&cause.status===404?'':photoReadHint});
    });
    return()=>abort.abort();
  },[client,root,scope,generation,enabled]);
  const visible=enabled&&result?.scope===scope?result:null;
  return {photos:new Map(visible?.items.filter(item=>!visible.failed.includes(item.photo.read_path)).map(item=>[item.offer_id,item.photo])??[]),error:visible?.error??'',
    failed:(path:string)=>{if(current.current===scope&&client.sessionGeneration===generation)setResult(old=>old?.scope===scope?{...old,failed:[...old.failed,path]}:old);}};
}
function OfferPhotoRow({enabled,photo,title,onUnavailable,children}:{enabled:boolean;photo:CatalogPhoto|undefined;title:string;onUnavailable:(path:string)=>void;children:ReactNode}) {
  if(!enabled)return <>{children}</>;
  // Keep the text/form subtree mounted while the optional image arrives or disappears.
  return <div className={photo?'supply-offer-photo-row':undefined}><SupplyOfferPhoto key={photo?.read_path??'none'} photo={photo??null} title={title} thumbnail onUnavailable={()=>{if(photo)onUnavailable(photo.read_path);}}/><div className="stack">{children}</div></div>;
}
export function HostedDistribution({client,root,refresh,busy,writable,onDirty,onCommand,onReload,onCooperation,supplierOnly=false,supplyOfferPhotosEnabled=false}:{supplyOfferPhotosEnabled?:boolean;supplierOnly?:boolean;client:PortalClient;root:string;refresh:number;busy:boolean;writable:boolean;onDirty:(key:string,value:boolean)=>void;onCommand:(command:DistributionCommand)=>Promise<void>;onReload:()=>Promise<void>;onCooperation?:(snapshot:SupplyCooperationSnapshot,origin:number)=>void}) {
  const photos=useSupplyCatalogPhotos(client,root,refresh,supplyOfferPhotosEnabled&&!supplierOnly);
  const [data,setData]=useState<{offers:SupplyOffer[];offersTruncated:boolean;catalog:SupplyOffer[];selections:Distribution[];requests:Distribution[];requestsTruncated:boolean;truncated:boolean}|null>(null);
  const [error,setError]=useState(''),[editing,setEditing]=useState<string|null>(null);
  const [query,setQuery]=useState('');
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [requestsOpen,setRequestsOpen]=useState(false);
  const requestsTouched=useRef(false),onCooperationRef=useRef(onCooperation);
  onCooperationRef.current=onCooperation;
  const pending=data?supplyRequestsWaiting(data.requests):0;
  // Open before paint. A post-paint effect leaves the section closed long enough
  // for a summary click to shut it, and a close must stay closed on later reads.
  if(supplierOnly&&data&&!requestsTouched.current&&pending>0&&!requestsOpen)setRequestsOpen(true);
  useEffect(()=>{
    // `refresh` is the parent generation that started this read. Report that
    // origin; a later render's callback must not retarget this reply.
    const abort=new AbortController(),origin=refresh; setError('');
    void Promise.all((supplierOnly ? ['supply-offers','supply-requests'] : ['supply-offers','supply-catalog','distribution-selections','supply-requests']).map(path=>client.get(root+'/'+path,{signal:abort.signal}))).then(raw=>{
      if(abort.signal.aborted)return;
      const offers=SupplyOffersSchema.parse(raw[0]),catalog=supplierOnly ? {items:[],truncated:false} : SupplyOffersSchema.parse(raw[1]),selections=supplierOnly ? {items:[],truncated:false} : DistributionsSchema.parse(raw[2]),requests=DistributionsSchema.parse(raw[supplierOnly ? 1 : 3]);
      const next={offers:offers.items,offersTruncated:offers.truncated,catalog:catalog.items,selections:selections.items,requests:requests.items,requestsTruncated:requests.truncated,truncated:[offers,catalog,selections,requests].some(p=>p.truncated)};
      setData(next);
      onCooperationRef.current?.({ok:true,offers:next.offers,offersTruncated:next.offersTruncated,requests:next.requests,requestsTruncated:next.requestsTruncated},origin);
    }).catch(cause=>{if(!abort.signal.aborted){setError(cause instanceof ApiError ? cause.detail??'目前無法讀取供貨合作。':'暫時無法讀取供貨合作。');onCooperationRef.current?.({ok:false},origin);}});
    return()=>abort.abort();
  },[client,root,refresh,supplierOnly]);
  const detailHref=(id:string)=>'#stores/'+root.split('/')[2]+'/'+root.split('/')[4]+'/supply-offers/'+id;
  const catalog=data?.catalog.filter(o=>!data.selections.some(s=>s.offer.product_id===o.product_id))??[];
  const matches=(o:SupplyOffer)=>productMatches({title:o.terms.title,sku:o.supplier_name,description:o.terms.description},query);
  const command=(value:DistributionCommand)=>onCommand({...value,targetMissingIsStore:false});
  const hasPhotos=data&&(data.selections.some(r=>photos.photos.has(r.offer.offer_id))||catalog.filter(matches).some(o=>photos.photos.has(o.offer_id)));
  return <section className="stack hosted-distribution" aria-labelledby="store-distribution-title">
    <h3 id="store-distribution-title">供貨合作</h3>
    <p className="field-hint">{supplierOnly ? '公開供貨版本後，同社群且有選品權限的店主可查看商品介紹、供貨價與條件，再提出售價供你確認。這不會建立買家可見的零售展示頁。' : '供應商確認這一版售價後，商品才能加入你的展示頁。跨店預留需雙方開放庫存預留；供貨撤回或條件變更後，買家須重新確認。'}</p>
    <div className="actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>void onReload()}>更新供貨狀態</button></div>
    {error&&<p role="alert">{error}</p>}
    {photos.error&&<p className="field-hint" role="status">{photos.error}</p>}
    {hasPhotos&&<p className="field-hint">縮圖是供應商提供的評估照片，不屬於供貨條件。</p>}
    {!data?<p>{error ? '請更新供貨狀態後再試一次。' : '正在讀取供貨合作…'}</p>:<>
      <details><summary>我的供貨（{data.offers.length}）</summary>
        {!data.offers.length&&<p>尚未公開供貨版本。請在商品的「供貨條件」確認內容後公開。</p>}
        {data.offers.map(o=><article className="hosted-distribution-item stack" key={o.offer_id}>
          <h4>{o.terms.title}</h4><Terms offer={o}/>
          <div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||!writable||!!error} onClick={()=>{
            if(window.confirm('撤回後，所有採用這一版的商店都不能再加入新的公開版本或建立新預留。既有公開內容與訂單會保留，已成立的預留仍可取消或到期。'))void command({method:'post',path:root+`/supply-offers/${o.offer_id}/withdraw`,body:{},version:o.version,schema:SupplyOfferSchema,notice:'已撤回這一版供貨。',success:()=>{}});
          }}>撤回供貨版本</button></div>
        </article>)}
      </details>
      <details open={supplierOnly?requestsOpen:undefined} onToggle={supplierOnly?event=>setRequestsOpen(event.currentTarget.open):undefined}><summary onClick={supplierOnly?()=>{requestsTouched.current=true;}:undefined}>供貨申請（{data.requests.length}{supplierOnly&&pending>0?`・待你確認${data.requestsTruncated?`至少 ${pending} 件`:` ${pending}`}`:''}）</summary>
        {!data.requests.length&&<p>目前沒有供貨申請。</p>}
        {data.requests.map(r=><article className="hosted-distribution-item stack" key={r.selection_id}>
          <h4>{r.offer.terms.title}・{r.seller_name}</h4><Terms offer={r.offer}/>
          <p>對方零售價 {formatMinor(r.retail_price_minor,r.offer.terms.currency)}・{distributionStateWord[r.state]}</p>
          {(r.state==='sellable'||r.state==='awaiting_supply_acceptance')&&<label className="field">回覆原因（選填，供不同意或撤回同意使用）<textarea maxLength={500} value={reasons[r.selection_id]??''} disabled={busy||!writable||!!error} onChange={e=>{setReasons(old=>({...old,[r.selection_id]:e.target.value}));onDirty('reason/'+r.selection_id,!!e.target.value.trim());}}/></label>}
          <div className="actions">{(r.state==='sellable'?['revoked']:r.offer.state==='offered'&&r.state==='awaiting_supply_acceptance'?['accepted','declined']:[]).map(decision=><button type="button" className="btn btn-ghost" disabled={busy||!writable||!!error} key={decision} onClick={()=>void command({method:'post',path:root+`/supply-requests/${r.selection_id}/decision`,body:{decision,listing_sha256:r.listing_sha256,...(decision==='accepted'?{}:{reason:reasons[r.selection_id]??''})},version:r.version,schema:DistributionSchema,notice:decision==='accepted'?'已同意這一版選品。':decision==='revoked'?'已撤回這間店的供貨同意。':'已回覆不同意。',success:()=>{setReasons(old=>({...old,[r.selection_id]:''}));onDirty('reason/'+r.selection_id,false);}})}>{decision==='accepted'?'同意這一版':decision==='revoked'?'撤回這間店的同意':'不同意'}</button>)}</div>
        </article>)}
      </details>
      {!supplierOnly && <><details><summary>我的選品（{data.selections.length}）</summary>
        {!data.selections.length&&<p>尚未選用其他商店的商品。</p>}
        {data.selections.map(r=><article className="hosted-distribution-item stack" key={r.selection_id}>
          <OfferPhotoRow enabled={supplyOfferPhotosEnabled} photo={photos.photos.get(r.offer.offer_id)} title={r.offer.terms.title} onUnavailable={photos.failed}>
          <h4>{r.offer.terms.title}・{r.offer.supplier_name}</h4>
          <p>{r.offer.state==='withdrawn'?'供貨版本已撤回':distributionStateWord[r.state]}・零售價 {formatMinor(r.retail_price_minor,r.offer.terms.currency)}</p>
          {r.decision_note&&<p className="supply-offer-text">供應商回覆：{r.decision_note}</p>}
          <div className="actions"><a className="btn btn-ghost" href={detailHref(r.offer.offer_id)}>查看供貨方案</a></div>
          <Terms offer={r.offer}/>
          {r.state!=='revoked'&&<div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||!writable||!!error} onClick={()=>void command(distributionWithdrawal(root,r))}>停止採用</button></div>}
          {r.offer.state==='offered'&&<PriceForm key={r.version} offer={r.offer} selection={r} busy={busy||!writable||!!error} onDirty={v=>onDirty(r.selection_id,v)} onSubmit={body=>command(distributionProposal(root,body,r,()=>onDirty(r.selection_id,false)))}/>}
          {r.offer.state==='withdrawn'&&data.catalog.filter(o=>o.product_id===r.offer.product_id).map(o=><PriceForm key={o.offer_id} offer={o} selection={r} busy={busy||!writable||!!error} onDirty={v=>onDirty(r.selection_id,v)} onSubmit={body=>command(distributionProposal(root,body,r,()=>onDirty(r.selection_id,false)))}/>)}
          </OfferPhotoRow>
        </article>)}
      </details>
      <details><summary>選用其他商店的商品</summary>
        {!data.catalog.length&&<p>目前沒有其他店主公開的同幣別供貨商品。</p>}
        {data.catalog.length>0&&data.catalog.every(o=>data.selections.some(s=>s.offer.product_id===o.product_id))&&<p>目前可選的商品都已加入「我的選品」。</p>}
        <label className="field">搜尋供貨商品<input type="search" value={query} placeholder="商品名稱、供應商或介紹" disabled={busy||editing!==null} onChange={e=>setQuery(e.target.value)}/></label>
        <p className="field-hint" aria-live="polite">找到 {catalog.filter(matches).length}／{catalog.length} 件已載入的供貨商品</p>
        {catalog.length>0&&!catalog.some(matches)&&<p>沒有符合的供貨商品，清除搜尋即可查看全部。</p>}
        {catalog.filter(matches).map(o=><article className="hosted-distribution-item stack" key={o.offer_id}>
          <OfferPhotoRow enabled={supplyOfferPhotosEnabled} photo={photos.photos.get(o.offer_id)} title={o.terms.title} onUnavailable={photos.failed}>
          <h4>{o.terms.title}・{o.supplier_name}</h4><p>{o.terms.description}</p><Terms offer={o}/>{(o.terms.msrp_minor!==undefined||o.terms.minimum_order_quantity!==undefined||o.terms.lead_time_days!==undefined)&&<p className="field-hint">供應商參考：{[o.terms.msrp_minor!==undefined?`建議售價 ${formatMinor(o.terms.msrp_minor,o.terms.currency)}`:null,o.terms.minimum_order_quantity!==undefined?`建議最低 ${o.terms.minimum_order_quantity} 件`:null,o.terms.lead_time_days!==undefined?o.terms.lead_time_days===0?'預估當天出貨':`預估 ${o.terms.lead_time_days} 天內出貨`:null].filter(Boolean).join('・')}</p>}<div className="actions"><a className="btn btn-ghost" href={detailHref(o.offer_id)}>查看供貨方案</a></div>
          {editing===o.offer_id?<><PriceForm offer={o} busy={busy||!writable||!!error} onDirty={v=>onDirty(o.offer_id,v)} onSubmit={body=>command(distributionProposal(root,body,undefined,()=>{onDirty(o.offer_id,false);setEditing(null);}))}/><div className="actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>{onDirty(o.offer_id,false);setEditing(null);}}>取消選品</button></div></>:<div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||!writable||!!error||editing!==null} onClick={()=>setEditing(o.offer_id)}>設定我的售價</button></div>}
          </OfferPhotoRow>
        </article>)}
      </details>
      </>}
      {data.truncated&&<p className="field-hint">目前只顯示部分供貨與申請，這份清單尚未包含全部資料。</p>}
    </>}
  </section>;
}
function Terms({offer:o}:{offer:SupplyOffer}) {
  return <div><p>供貨單價 {formatMinor(o.terms.cost_minor,o.terms.currency)}・每件運費 {formatMinor(o.terms.shipping_minor,o.terms.currency)}</p>
    <p>出貨：{o.terms.shipping_terms}</p><p>退貨：{o.terms.return_terms}</p></div>;
}
export function PriceForm({offer,selection,busy,onDirty,onSubmit}:{offer:SupplyOffer;selection?:Distribution;busy:boolean;onDirty:(value:boolean)=>void;onSubmit:(body:unknown)=>Promise<void>}) {
  const initial=selection?String(selection.retail_price_minor/100):'';
  const [price,setPrice]=useState(initial),[error,setError]=useState('');
  const dirtyRef=useRef(onDirty); dirtyRef.current=onDirty;
  useEffect(()=>{dirtyRef.current(price!==initial);},[price,initial]);
  useEffect(()=>()=>dirtyRef.current(false),[]);
  async function submit(e:FormEvent) {
    e.preventDefault();setError('');
    try{const body=DistributionInputSchema.parse({offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:parseMajorToMinor(price)});await onSubmit(body);}
    catch{setError('請填寫有效的零售價。');}
  }
  return <form className="hosted-store-form stack" aria-label={`${offer.terms.title}選品售價`} onSubmit={e=>void submit(e)}>
    <label className="field">我的零售價（{offer.terms.currency}）<input inputMode="decimal" required value={price} disabled={busy} onChange={e=>setPrice(e.target.value)}/></label>
    {offer.terms.msrp_minor!==undefined&&<div className="stack"><p className="field-hint">供應商建議售價 {formatMinor(offer.terms.msrp_minor,offer.terms.currency)}（僅供參考，可自行定價）</p><div className="actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>setPrice((offer.terms.msrp_minor!/100).toFixed(2))}>填入建議售價</button></div></div>}
    <PriceDifference retail={price} cost={offer.terms.cost_minor} shipping={offer.terms.shipping_minor} currency={offer.terms.currency}/>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button className="btn btn-ghost" disabled={busy||(!!selection&&price===initial&&selection.offer.offer_id===offer.offer_id&&!['revoked','declined'].includes(selection.state))}>送出供貨申請</button></div>
  </form>;
}

export function distributionProposal(root:string,body:unknown,selection:Distribution|undefined,success:()=>void):DistributionCommand {
  return {method:selection?'patch':'post',path:root+'/distribution-selections'+(selection?'/'+selection.selection_id:''),body,version:selection?.version,
    schema:DistributionSchema,notice:selection?'已送出新售價，等待供應商重新確認。':'已送出選品，等待供應商確認。',success,targetMissingIsStore:false};
}
export function distributionWithdrawal(root:string,selection:Distribution):DistributionCommand {
  return {method:'post',path:root+`/distribution-selections/${selection.selection_id}/withdraw`,body:{},version:selection.version,schema:DistributionSchema,
    notice:'已停止採用這項選品；重新發布後，展示頁才會更新。',success:()=>{},targetMissingIsStore:false};
}
