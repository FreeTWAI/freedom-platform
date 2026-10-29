import {sellableLabel} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferText';
import {useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import {SupplyOfferPageSchema} from '../../../../contracts/guild-launchpad/v1/hosted-distribution';
import {SupplyOfferPresentation} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferPresentation';
import {SupplyOfferPhoto} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferPhoto';
import {ApiError,type PortalClient} from '../api';
import {formatMinor} from '../format';
import {PriceForm,distributionProposal,distributionWithdrawal,distributionStateWord,type DistributionCommand} from './HostedDistribution';

const reservationReasons:Record<string,string> = {
  not_configured:'這個環境尚未開放庫存預留。',store_unavailable:'商店目前無法接受新預留。',
  reservation_not_enabled:'你的商店尚未開放庫存預留。',supply_unavailable:'供應商尚未開放預留，或這份供貨同意已失效。',
  supply_withdrawn:'這份供貨版本已撤回。',supply_not_accepted:'需要供應商先同意這一版售價。',
  publication_required:'取得供應商同意並發布到你的店面後，才能接受預留。',publication_changed:'請先將已同意的選品與售價發布到你的店面。',
  unknown:'目前無法核實供應商的預留資格；請先確認合作條件。',
};
type OfferScope = {client:PortalClient;root:string;offerId:string;generation:number};
type OfferRead = {data:z.infer<typeof SupplyOfferPageSchema>;scope:OfferScope;refresh:number;reload:number;epoch:number};
export function HostedSupplyOffer({client,root,offerId,refresh,busy,writable,onDirty,onCommand}: {
  client:PortalClient;root:string;offerId:string;refresh:number;busy:boolean;writable:boolean;
  onDirty:(value:boolean)=>void;onCommand:(command:DistributionCommand)=>Promise<void>;
}) {
  const generation=client.sessionGeneration,scope={client,root,offerId,generation};
  const active=useRef(scope),mounted=useRef(false),request=useRef<AbortController|null>(null),readEpoch=useRef(0);
  active.current=scope;
  const [read,setRead]=useState<OfferRead|null>(null),[epoch,setEpoch]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[reload,setReload]=useState(0),[editing,setEditing]=useState(false);
  const sameScope=(origin:OfferScope)=>active.current.client===origin.client&&active.current.root===origin.root&&active.current.offerId===origin.offerId&&active.current.generation===origin.generation&&origin.client.sessionGeneration===origin.generation;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const abort=new AbortController(),origin=readEpoch.current;request.current=abort;setError('');setLoading(true);
    const current=()=>mounted.current&&sameScope(scope)&&!abort.signal.aborted&&readEpoch.current===origin;
    void client.get(root+'/supply-catalog/'+offerId,{signal:abort.signal}).then(raw=>{
      const parsed=SupplyOfferPageSchema.parse(raw);if(current())setRead({data:parsed,scope,refresh,reload,epoch:origin});
    }).catch(cause=>{if(current())setError(cause instanceof ApiError?cause.detail??'目前無法讀取供貨方案。':'暫時無法讀取供貨方案。');})
      .finally(()=>{if(current())setLoading(false);});
    return()=>abort.abort();
  },[client,root,offerId,generation,refresh,reload]);
  const data=read&&sameScope(read.scope)?read.data:null;
  const confirmed=!!data&&read?.refresh===refresh&&read.reload===reload&&read.epoch===epoch&&!loading&&!error;
  const live=confirmed&&!busy;
  const command=(value:DistributionCommand)=>onCommand({...value,success:result=>{
    if(!mounted.current||!sameScope(scope))return;
    // A validated command receipt invalidates even a read started before the
    // parent reload. Its failure must not restore pre-command sale eligibility.
    request.current?.abort();readEpoch.current++;setEpoch(readEpoch.current);setLoading(false);
    value.success(result);
  }});
  const back='#stores/'+root.split('/')[2]+'/'+root.split('/')[4]+'/cooperation';
  const locked=busy||!writable||!confirmed;
  const displayReady=data?.offer.state==='offered'&&data.selection?.state==='sellable'&&data.sale_paths.display.available;
  return <section className="hosted-supply-offer stack"><div className="actions"><a className="btn btn-ghost" href={back}>返回供貨合作</a></div><h2>供貨方案</h2>
    {error&&<p className="banner banner-error" role="alert">{error}</p>}
    {(error||(data&&!confirmed&&!loading))&&<div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||loading} onClick={()=>setReload(n=>n+1)}>重試讀取供貨方案</button></div>}
    {!data&&!error&&<p role="status">正在讀取供貨方案…</p>}
    {data&&!live&&<p role="status">{loading||busy?'正在重新確認供貨狀態…':'目前供貨狀態尚未確認，請重新讀取。'}</p>}
    {data&&<>{live&&data.photo&&<SupplyOfferPhoto key={data.photo.read_path} photo={data.photo} title={data.offer.terms.title}/>}<SupplyOfferPresentation terms={data.offer.terms} supplierName={data.supplier.name} publishedAt={data.published_at} versionHash={data.offer.terms_sha256} arrangement={data.selection?data.selection.arrangement:data.offer.arrangement}/>
      {data.supplier.public_path&&<div className="actions"><a className="btn btn-ghost" href={data.supplier.public_path} target="_blank" rel="noopener">查看供應商商店</a></div>}
      <section className="supply-offer-section stack"><h3>目前可以怎麼賣</h3>
        <div className="sale-path stack"><h4>展示：{!live?'尚未確認':!data.selection&&data.offer.state==='offered'?'供應商同意後可加入':displayReady?'可加入展示頁':'目前無法加入展示頁'}</h4><p>{!live?'重新讀取成功後，才能確認目前是否可加入展示頁。':data.offer.state==='withdrawn'?'這份供貨版本已撤回。':displayReady?'供應商已同意；下次發布後，商品會出現在你的商店。':'取得供應商同意，並在你的商店發布後，商品才會出現在展示頁。'}</p></div>
        <div className="sale-path stack"><h4>預留：{!live?'尚未確認':data.sale_paths.reservation.available?'可接受預留':'目前無法預留'}</h4><p>{!live?'重新讀取成功後，才能確認目前的預留條件。':data.sale_paths.reservation.available?'雙方已開放庫存預留；買家送出時仍會重新確認供貨狀態與可用庫存。':reservationReasons[data.sale_paths.reservation.reason??'']??'目前無法確認預留條件，請重新讀取。'}</p></div>
        <div className="sale-path stack"><h4>結帳購買：{!live?'尚未確認':data.sale_paths.checkout.available?'可結帳購買':'目前無法結帳購買'}</h4><p>{!live?'重新讀取成功後，才能確認目前的結帳條件。':data.sale_paths.checkout.reason==='fulfilment_not_agreed'?'供貨商品需要有效的供應商代出貨同意，目前尚不能結帳購買。':data.sale_paths.checkout.available?'買家可依你的店面設定結帳。':'目前無法確認結帳條件，請重新讀取。'}</p></div>
        <p>若你先向供應商批發買入並自行持有商品，可作為自己的商品上架，使用自己的庫存、收款與面交設定。</p>
      </section>
      {data.selection&&<section className="supply-offer-section stack"><h3>我的選品</h3><p>{!live?'選品狀態尚未確認':data.selection.offer.state==='withdrawn'?'供貨版本已撤回':data.selection.state==='sellable'?sellableLabel(data.sale_paths.checkout.available):distributionStateWord[data.selection.state]}</p><p>我的零售價：{formatMinor(data.selection.retail_price_minor,data.offer.terms.currency)}</p>{data.decision_note&&<p className="supply-offer-text">供應商回覆：{data.decision_note}</p>}
        {data.selection.state!=='revoked'&&<div className="actions"><button type="button" className="btn btn-ghost" disabled={locked} onClick={()=>void command(distributionWithdrawal(root,data.selection!))}>停止採用</button></div>}
      </section>}
      {data.offer.state==='offered'&&<section className="supply-offer-section stack"><h3>設定我的售價</h3>{data.selection||editing?<PriceForm key={data.selection?.version??'new'} offer={data.offer} selection={data.selection??undefined} busy={locked} onDirty={onDirty} onSubmit={body=>command(distributionProposal(root,body,data.selection??undefined,()=>{onDirty(false);setEditing(false);} ))}/>:<div className="actions"><button type="button" className="btn btn-ghost" disabled={locked} onClick={()=>setEditing(true)}>設定我的售價</button></div>}</section>}
    </>}
  </section>;
}
