import {storeOrderStatus} from './view';
import {StoreOverviewSchema,STORE_READINESS_LABELS,STORE_PAYMENT_LABELS,storeReadinessStateLabel,type StoreReadiness} from '../../../../contracts/guild-launchpad/v1/hosted-commerce-setup';
import {DELIVERY_METHOD_LABELS} from '../../../../contracts/guild-launchpad/v1/hosted-shipping';
import {sellerConsoleHref,sellerRootHref,type SellerConsoleRoute} from '../route';
import type {Controller} from '../state/controller';
import {Axis,ReadStatus,useRead} from './Shared';
import './Readiness.css';

function help(item:StoreReadiness['items'][number]){
 if(item.key==='admission')return item.state==='done'?'平台已確認開放':item.state==='revoked'?'平台已暫停這間店接受新訂單；已成立的訂單照常處理。':'等待平台確認。其他項目完成後，由平台管理員確認開放，不需要另外申請。';
 if(item.key==='platform')return item.state==='done'?'平台接單服務正常。':'平台目前暫停所有商店的新訂單；已成立的訂單照常處理。';
 if(item.key==='storefront')return item.state==='done'?`目前發布第 ${item.revision} 版。`:'完成商店與商品設定後，預覽並發布商店。';
 if(item.key==='products')return item.state==='done'?`已發布 ${item.published_count} 項商品，其中 ${item.sellable_count} 項目前可售。`:'新增並發布自有商品，確認可售庫存大於 0；已占用的數量不能再出售。';
 if(item.key==='store_information')return item.state==='done'?'已發布商店介紹。':'在「商店資料」的商店介紹填寫願意公開的客服方式、交付與售後說明，並重新發布。';
 if(item.key==='release')return item.state==='done'?`目前版本：${item.module_release_ref}`:'請在收款設定升級商店版本。';
 if(item.key==='payment')return item.state==='not_offered'?'你設定的付款方式目前平台尚未開放。':item.state==='done'?'已設定可用的付款方式。':'設定銀行匯款或面交付現；也可設定平台提供的信用卡服務。';
 return item.state==='done'?'已設定可用的交付方式。':'請設定交付方式，可以只提供面交取貨。';
}
export function Overview({c,route,checkoutEnabled=false}:{c:Controller;route:SellerConsoleRoute;checkoutEnabled?:boolean}){
 const r=useRead(c,'overview','/overview',StoreOverviewSchema,true,v=>v.tenant_id===route.tenantId&&v.instance_id===route.instanceId),data=r.data;
 return <section className="stack commerce-readiness"><h2 tabIndex={-1}>開店準備</h2><ReadStatus c={c} name="overview" label="開店準備" slot={r}/>{data&&<>
  <p role="status">{checkoutEnabled?storeOrderStatus({readiness:data}).text:data.accepting_orders?'目前已開放接單：買家可以在你的商店加入購物車並下單。':data.items.some(item=>item.key==='platform'&&item.state==='paused')?'平台目前暫停所有商店的新訂單；已成立的訂單照常處理。':'目前尚未開放接單。完成下列項目後，由平台確認開放。'}</p>
  <Axis title="開店檢查" time={data.checked_at} readState={r.state}><ol className="readiness-list">{data.items.map(item=>{
   const home=['storefront','products','store_information'].includes(item.key),settings=['release','payment','delivery'].includes(item.key);
   return <li key={item.key} data-readiness={item.key} className="readiness-row stack"><div className="readiness-row-head"><h4>{STORE_READINESS_LABELS[item.key]}</h4><span className="badge readiness-state" data-state={item.state}>{storeReadinessStateLabel(item)}</span></div><p>{help(item)}</p>
    {item.key==='payment'&&<p>已設定：{data.methods.payment.map(kind=>STORE_PAYMENT_LABELS[kind]).join('／')||'尚未設定'}</p>}
    {item.key==='delivery'&&<><p>已設定：{data.methods.delivery.map(kind=>DELIVERY_METHOD_LABELS[kind]).join('／')||'尚未設定'}</p><p className="field-hint">可以只提供面交取貨。</p></>}
    {(home||settings)&&<div className="actions"><a className="btn btn-ghost" href={home?sellerRootHref(route):sellerConsoleHref(route,'settings-payments')}>{home?'前往商店首頁':'前往收款設定'}</a></div>}
   </li>;
  })}</ol></Axis>
  {data.orders&&<Axis title="訂單概況" readState={r.state}><dl className="seller-facts">{([['open','進行中'],['awaiting_offline_payment','待確認收款'],['needs_action','待處理問題']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{data.orders![key].more?'99+':data.orders![key].count}</dd></div>)}</dl><div className="actions"><a className="btn btn-ghost" href={sellerConsoleHref(route,'orders',{query:{lifecycle:'open'}})}>查看訂單</a><a className="btn btn-ghost" href={sellerConsoleHref(route,'orders',{query:{awaiting_offline_payment:'true'}})}>查看待確認收款</a><a className="btn btn-ghost" href={sellerConsoleHref(route,'orders',{query:{needs_action:'true'}})}>查看待處理</a></div></Axis>}
 </>}</section>;
}
