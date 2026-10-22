import type {SupplyOffer} from '../../../contracts/guild-launchpad/v1/hosted-distribution';
import {formatMinor} from '../../../apps/portal-web/src/format';
import './SupplyOffer.css';

export {SHIPPING_TERMS_HINT,RETURN_TERMS_HINT,SELLABLE_LABEL} from './SupplyOfferText';

/** Browser-only allowlist. Both supplier preview and seller detail render here. */
export function SupplyOfferPresentation({terms, supplierName, publishedAt, versionHash, arrangement}: {
  terms: SupplyOffer['terms']; supplierName: string; publishedAt?: string; versionHash?: string;
  arrangement: SupplyOffer['arrangement'];
}) {
  return <div className="supply-offer-presentation stack">
    <section className="supply-offer-section stack"><h3>商品</h3><h4>{terms.title}</h4>
      <p className="supply-offer-text">{terms.description || '供應商未填寫'}</p><p>供應商：{supplierName}</p>
      <p className="field-hint">供貨版本：{publishedAt ? <time dateTime={publishedAt}>{new Intl.DateTimeFormat('zh-TW', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(publishedAt))}（臺北時間）</time> : '尚未公開'}{versionHash && ` · ${versionHash.slice(0, 8)}`}</p>
    </section>
    <section className="supply-offer-section stack"><h3>價格</h3><p className="field-hint">幣別：{terms.currency === 'TWD' ? '新臺幣（TWD）' : '美元（USD）'}</p><dl className="detail-list">
      <div><dt>供貨單價</dt><dd>{formatMinor(terms.cost_minor, terms.currency)}</dd></div>
      <div><dt>每件運費</dt><dd>{formatMinor(terms.shipping_minor, terms.currency)}</dd></div>
      <div><dt>每件成本合計</dt><dd>{formatMinor(terms.cost_minor + terms.shipping_minor, terms.currency)}</dd></div>
      {terms.msrp_minor!==undefined&&<div><dt>供應商建議售價</dt><dd>{formatMinor(terms.msrp_minor,terms.currency)}<p>建議售價只供參考，你可以自行決定零售價。</p></dd></div>}
    </dl><p>這是店主依這個版本，每件商品須支付給供應商的供貨價與運費。</p></section>
    {(terms.minimum_order_quantity!==undefined||terms.lead_time_days!==undefined)&&<section className="supply-offer-section stack"><h3>訂貨與交期</h3>
      <p>這些是供應商提供的參考資訊。系統不會依最低訂量限制預留或結帳，也不保證出貨時間。</p>
      {terms.minimum_order_quantity!==undefined&&<p>建議最低訂量：每次 {terms.minimum_order_quantity} 件</p>}
      {terms.lead_time_days!==undefined&&<p>預估交期：{terms.lead_time_days===0?'收到訂單當天出貨':`收到訂單後約 ${terms.lead_time_days} 天內出貨`}</p>}
    </section>}
    <section className="supply-offer-section stack"><h3>出貨與退貨</h3><h4>出貨條件</h4><p className="supply-offer-text">{terms.shipping_terms || '供應商未填寫'}</p>
      <h4>退貨條件</h4><p className="supply-offer-text">{terms.return_terms || '供應商未填寫'}</p></section>
    <section className="supply-offer-section stack"><h3>合作方式</h3>{arrangement?.mode === 'reseller'
      ? <><p>店主是對買家銷售的賣方，負責收款、開立發票、處理退款，並自行決定零售價。</p><p>供應商是供貨履行方；這份責任分工仍需另有代出貨同意，才能替店主向買家出貨。</p></>
      : <p>目前無法確認這份版本的合作方式，請重新讀取後再申請。</p>}</section>
    <section className="supply-offer-section stack"><h3>供應商同意的範圍</h3>
      <p>供應商同意的是你提出的零售價與這個確切的供貨版本。變更售價，或採用供應商的新版本，都需要重新取得同意。</p>
      <p>這項同意不包含代出貨同意，也不會讓供應商取得買家資料。</p>
    </section>
  </div>;
}
