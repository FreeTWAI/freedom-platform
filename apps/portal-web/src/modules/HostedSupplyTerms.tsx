import {SupplyReferenceFields,MerchantInventorySummary,InventoryDefinition} from '../../../../modules/agent-commerce/hosted-ui/CommerceTools';
import {SUPPLY_REFERENCE_FIELDS,supplyReferenceValue} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferText';
import {SupplyOfferPresentation,SHIPPING_TERMS_HINT,RETURN_TERMS_HINT} from '../../../../modules/agent-commerce/hosted-ui/SupplyOfferPresentation';
import {resellerRoles} from '../../../../modules/agent-commerce/hosted-ui/reseller-arrangement';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {SupplyTermsInputSchema, SupplyTermsSchema, type SupplyTerms, type SupplyTermsInput} from '../../../../contracts/guild-launchpad/v1/hosted-supply-terms';
import {ApiError, type PortalClient} from '../api';
import {formatMinor, parseMajorToMinor} from '../format';

export function HostedSupplyTerms({client, path, title, description, supplierName, busy, onDirty, onCancel, onSave, onPublish, supplierOnly=false}: {
  supplierOnly?: boolean; client: PortalClient; path: string; title: string; description: string; supplierName: string; busy: boolean;
  onDirty: (dirty: boolean) => void; onCancel: () => void;
  onPublish?: (version: string) => Promise<void>;
  onSave: (body: SupplyTermsInput, version: string, success: () => void) => Promise<void>;
}) {
  const [view, setView] = useState<SupplyTerms | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void client.get(path, {signal: controller.signal}).then(raw => {
      if (!controller.signal.aborted) {
        const next=SupplyTermsSchema.parse(raw);
        // Refresh only stock: an edited form retains its original terms and CAS
        // version, so another writer still requires the existing conflict review.
        setView(current=>current?.product_id===next.product_id?{...current,stock:next.stock,reserved:next.reserved,available:next.available,inventory:next.inventory}:next);
      }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && !cause.network ? cause.detail ?? '目前無法讀取供貨條件。' : '暫時無法讀取供貨條件，請重試。');
    });
    return () => controller.abort();
  }, [client, path, reload]);
  if (!view) return <div className="stack">
    <p role={error ? 'alert' : 'status'}>{error || '正在讀取供貨條件…'}</p>
    <div className="actions">{error && <button type="button" className="btn btn-ghost" onClick={() => setReload(n => n + 1)}>重試讀取供貨條件</button>}
      <button type="button" className="btn btn-ghost" onClick={onCancel}>返回商品</button></div>
  </div>;
  return <>{error&&<p className="field-hint" role="status">{error}</p>}<SupplyForm view={view} title={title} description={description} supplierName={supplierName} busy={busy} onDirty={onDirty} onCancel={onCancel} onSave={onSave} onPublish={onPublish} supplierOnly={supplierOnly} onRefresh={()=>setReload(n=>n+1)}/></>;
}

function SupplyForm({view, title, description, supplierName, busy, onDirty, onCancel, onSave, onPublish, supplierOnly=false, onRefresh}: {
  onRefresh:()=>void; supplierOnly?: boolean; view: SupplyTerms; title: string; description: string; supplierName: string; busy: boolean; onDirty: (dirty: boolean) => void; onCancel: () => void;
  onPublish?: (version: string) => Promise<void>;
  onSave: (body: SupplyTermsInput, version: string, success: () => void) => Promise<void>;
}) {
  const initial = {cost: (view.cost_minor / 100).toFixed(2), shipping: (view.shipping_minor / 100).toFixed(2), shippingTerms: view.shipping_terms, returnTerms: view.return_terms,msrp_minor:view.msrp_minor===null?'':(view.msrp_minor/100).toFixed(2),minimum_order_quantity:view.minimum_order_quantity===null?'':String(view.minimum_order_quantity),lead_time_days:view.lead_time_days===null?'':String(view.lead_time_days)};
  const [fields, setFields] = useState(initial);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const onDirtyRef = useRef(onDirty); onDirtyRef.current = onDirty;
  useEffect(() => {onDirtyRef.current(dirty);}, [dirty]);
  useEffect(() => () => {onDirtyRef.current(false);}, []);
  const change = (key: keyof typeof fields, value: string) => setFields(old => ({...old, [key]: value}));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const shipping = /^0+(?:\.0{1,2})?$/.test(fields.shipping.trim()) ? 0 : parseMajorToMinor(fields.shipping);
      const parsed = SupplyTermsInputSchema.safeParse({cost_minor: parseMajorToMinor(fields.cost), shipping_minor: shipping, shipping_terms: fields.shippingTerms, return_terms: fields.returnTerms,...Object.fromEntries(SUPPLY_REFERENCE_FIELDS.filter(f=>fields[f.key]!==initial[f.key]).map(f=>[f.key,supplyReferenceValue(f.key,fields[f.key])]))});
      if (!parsed.success) {setError('請填寫有效的金額、出貨與退貨條件。'); return;}
      await onSave(parsed.data, view.version, () => onDirtyRef.current(false));
    } catch (cause) {setError(cause instanceof Error ? cause.message : '請檢查供貨條件。');}
  }
  return <form className="hosted-store-form stack" aria-label={`${title}供貨條件`} onSubmit={event => void submit(event)}>
    <h4>{title}・供貨條件</h4>
    <p className="field-hint">儲存的是私人草稿。按「公開供貨版本」後，同社群店主才能看到這份商品介紹、供貨價與條件，並申請選用。</p>
    <MerchantInventorySummary stock={view.stock} inventory={view.inventory} onRefresh={onRefresh} disabled={busy}/><InventoryDefinition/>
    <fieldset className="hosted-store-fields stack" disabled={busy}>
      <legend className="sr-only">供貨條件</legend>
      <label className="field">供貨單價（{view.currency}）<input required inputMode="decimal" value={fields.cost} onChange={e => change('cost', e.target.value)}/></label>
      <p className="field-hint">{supplierOnly ? '每件商品的供貨價；合作店主提出的零售價會另行送你確認。' : '每件商品的供貨價；店內零售價另行編輯。'}</p>
      <label className="field">每件運費（{view.currency}）<input required inputMode="decimal" value={fields.shipping} onChange={e => change('shipping', e.target.value)}/></label>
      <p className="field-hint">金額上限 {formatMinor(100000000, view.currency)}；免運請填 0。</p>
      <SupplyReferenceFields values={fields} cost={fields.cost} shipping={fields.shipping} currency={view.currency} onChange={change}/>
      <label className="field">出貨條件<textarea required maxLength={2000} value={fields.shippingTerms} onChange={e => change('shippingTerms', e.target.value)}/></label>
      <p className="field-hint">{SHIPPING_TERMS_HINT}</p>
      <label className="field">退貨條件<textarea required maxLength={2000} value={fields.returnTerms} onChange={e => change('returnTerms', e.target.value)}/></label>
      <p className="field-hint">{RETURN_TERMS_HINT}</p>
      {error && <p className="banner banner-error" role="alert">{error}</p>}
      <div className="actions"><button className="btn btn-ghost" disabled={busy}>儲存供貨條件</button>
        <button type="button" className="btn btn-ghost" disabled={busy || dirty || !onPublish} onClick={() => void onPublish?.(view.version)}>公開供貨版本</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>返回商品</button></div>
    </fieldset>
    <details className="supply-offer-preview"><summary>預覽店主會看到的供貨方案</summary><div className="stack">
      <p className="field-hint">{view.current_offer?'公開中的版本':'目前保存的條件（尚未公開）'}</p>
      <SupplyOfferPresentation terms={view.current_offer?.terms??{...view,title,description,msrp_minor:view.msrp_minor??undefined,minimum_order_quantity:view.minimum_order_quantity??undefined,lead_time_days:view.lead_time_days??undefined}} supplierName={view.current_offer?.supplier_name??supplierName} publishedAt={view.current_offer?.published_at} versionHash={view.current_offer?.terms_sha256} arrangement={resellerRoles}/>
    </div></details>
  </form>;
}
