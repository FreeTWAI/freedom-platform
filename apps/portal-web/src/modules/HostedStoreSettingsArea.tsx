import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {StoreViewSchema, StoreSetupInputSchema, StoreUpdateInputSchema, SlugAvailabilitySchema, type StoreView} from '../../../../contracts/guild-launchpad/v1/storefront';
import {ApiError} from '../api';
import {errorText} from './hosted-store-page-state';
import {HostedStorePolicies} from './HostedStorePolicies';
import {currencyLabel} from './hosted-store-area-shared';
import type {PortalClient} from '../api';
import type {StoreAreaData, StoreArea, StoreAreaStore} from './hosted-store-area-shared';

export interface HostedStoreSettingsAreaProps {
  area: StoreArea;
  can: (key: string) => boolean;
  view: NonNullable<StoreAreaData['view']>;
  client: PortalClient;
  root: string;
  store: StoreAreaStore;
  areaLocked: boolean;
  dirtyForms: Record<string, boolean>;
  setMissing: StoreAreaData['setMissing'];
  markDirty: (id: string, value: boolean) => void;
  command: StoreAreaData['command'];
  publication: NonNullable<StoreAreaData['view']>['publication'] | undefined;
  policiesEnabled: boolean;
  policiesError: StoreAreaData['policiesError'];
  loading: StoreAreaData['loading'];
  locked: boolean;
  load: StoreAreaData['load'];
  policiesDraft: StoreAreaData['policiesDraft'];
  userId: string;
  tenantId: string;
  instanceId: string;
  busy: StoreAreaData['busy'];
  retry: StoreAreaData['retry'];
  otherDraft: [string, boolean] | undefined;
  photoBlocks: StoreAreaData['photoBlocks'];
  photoState: (id: string, dirty: boolean, blocking: boolean) => void;
}

export function HostedStoreSettingsArea({
  area, can, view, client, root, store, areaLocked,
  dirtyForms, setMissing, markDirty, command, publication, policiesEnabled, policiesError,
  loading, locked, load, policiesDraft, userId, tenantId, instanceId,
  busy, retry, otherDraft, photoBlocks, photoState,
}: HostedStoreSettingsAreaProps) {
  return <section id="store-settings-panel" hidden={area!=='settings'} className="hosted-supply-panel stack" aria-labelledby="store-settings-title"><h3 id="store-settings-title">商店資料</h3>
          {can('store:manage') ? <SettingsForm key={view.version} client={client} root={root} store={store} busy={areaLocked||dirtyForms.policies===true} onMissing={() => setMissing(true)} onDirty={value => markDirty('settings', value)} onSave={(body, success, fieldError) => command({method: 'patch', path: root, body, version: view.version!, schema: StoreViewSchema, notice: `已儲存。${publication?.state === 'published' ? '重新發布後，公開頁才會更新。' : ''}`, success, fieldError})}/>
            : <dl className="detail-list"><div><dt>商店名稱</dt><dd>{store.name}</dd></div><div><dt>品牌</dt><dd>{store.brand ?? '未填寫'}</dd></div><div><dt>商店介紹</dt><dd>{store.description}</dd></div><div><dt>商店網址</dt><dd>/shops/{store.slug}</dd></div><div><dt>幣別</dt><dd>{currencyLabel(store.currency)}</dd></div></dl>}
          {policiesEnabled&&<>
            {policiesError&&<div><p role="alert">賣方資訊與商店政策暫時無法讀取。請重試。</p><div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={loading||locked} onClick={()=>void load()}>重新讀取賣方資訊與商店政策</button></div></div>}
            {policiesDraft?<HostedStorePolicies client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} draft={policiesDraft} writable={can('store:manage')}
              locked={busy||retry!==null||!!otherDraft||policiesError||dirtyForms.settings===true||Object.entries(photoBlocks).some(([id,blocking])=>id!=='policies'&&blocking)}
              onState={(dirty,blocking)=>photoState('policies',dirty,blocking)} onSaved={load}/>:!policiesError&&<p role="status">正在讀取賣方資訊與商店政策…</p>}
          </>}
        </section>;
}

export function SettingsForm({client, root, store, busy, onMissing, onDirty, onSave}: {
  client: PortalClient; root: string; store?: NonNullable<StoreView['store']>; busy: boolean; onMissing: () => void; onDirty: (dirty: boolean) => void;
  onSave: (body: unknown, success: (value: unknown) => void, fieldError: (error: ApiError) => void) => Promise<void>;
}) {
  const initial = {name: store?.name ?? '', brand: store?.brand ?? '', description: store?.description ?? '', slug: store?.slug ?? '', currency: store?.currency ?? 'TWD'};
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState('');
  const [slugError, setSlugError] = useState('');
  const [availability, setAvailability] = useState('');
  const id = useId();
  const onMissingRef = useRef(onMissing); onMissingRef.current = onMissing;
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const onDirtyRef = useRef(onDirty); onDirtyRef.current = onDirty;
  useEffect(() => {onDirtyRef.current(dirty);}, [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []);
  useEffect(() => {
    setAvailability(''); setSlugError('');
    if (!fields.slug || store?.slug_locked) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void client.get(root + '/slug-availability?slug=' + encodeURIComponent(fields.slug), {signal: controller.signal}).then(raw => {
        const result = SlugAvailabilitySchema.parse(raw); if (controller.signal.aborted) return;
        setAvailability(result.available ? `可以使用：/shops/${result.slug}` : result.reason === 'taken' ? '這個網址已被使用。' : result.reason === 'reserved' ? '這個網址是保留字，請換一個。' : '網址格式不符。');
      }).catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) onMissingRef.current();
        else setAvailability(errorText(cause));
      });
    }, 400);
    return () => {clearTimeout(timer); controller.abort();};
  }, [client, root, fields.slug, store?.slug_locked]);
  const change = (key: keyof typeof fields, value: string) => setFields(old => ({...old, [key]: value}));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSlugError('');
    const body = {name: fields.name, brand: fields.brand.trim() || null, description: fields.description,
      ...(!store?.slug_locked ? {slug: fields.slug.trim().toLowerCase()} : {}), ...(!store ? {currency: fields.currency} : {})};
    const result = (store ? StoreUpdateInputSchema : StoreSetupInputSchema).safeParse(body);
    if (!result.success) {setError('有欄位格式不符，請檢查後再送出。'); return;}
    await onSave(result.data, () => {setSaved(fields); onDirtyRef.current(false);}, cause => cause.code === 'validation_failed' ? setError(errorText(cause)) : setSlugError(errorText(cause)));
  }
  return <form className="hosted-store-form stack" aria-label={store ? '商店資料' : '建立商店'} onSubmit={event => void submit(event)}>
    <fieldset disabled={busy} className="hosted-store-fields stack"><legend className="sr-only">{store ? '商店資料' : '商店設定'}</legend>
      <label className="field">商店名稱<input required maxLength={StoreSetupInputSchema.shape.name.maxLength!} value={fields.name} onChange={event => change('name', event.target.value)}/></label>
      <label className="field">品牌（選填）<input maxLength={StoreSetupInputSchema.shape.brand.unwrap().unwrap().maxLength!} value={fields.brand} onChange={event => change('brand', event.target.value)}/></label>
      <div className="field">{store?.slug_locked ? <><span>商店網址</span><span>/shops/{store.slug}</span></> : <><label htmlFor={`${id}-slug`}>商店網址</label><span className="hosted-store-slug"><span aria-hidden="true">/shops/</span><input id={`${id}-slug`} required maxLength={40} autoCapitalize="off" spellCheck={false} aria-describedby={`${id}-slug-hint ${id}-slug-result ${id}-slug-error`} value={fields.slug} onChange={event => change('slug', event.target.value)}/></span></>}</div>
      {!store?.slug_locked && <><p id={`${id}-slug-hint`} className="field-hint">3–40 個小寫英文字母、數字或連字號，以英文字母開頭；第一次發布後不能再改。</p><p id={`${id}-slug-result`} aria-live="polite">{availability}</p><p id={`${id}-slug-error`} role="alert">{slugError}</p></>}
      <label className="field">商店介紹<textarea rows={7} aria-describedby={`${id}-description-hint ${id}-description-public`} maxLength={StoreSetupInputSchema.shape.description.unwrap().maxLength!} value={fields.description} onChange={event => change('description', event.target.value)}/></label>
      <p id={`${id}-description-hint`} className="field-hint">介紹品牌，並填入願意公開的客服方式、可用的付款與交付方式，以及取消或售後處理說明。請寫明由誰負責、如何聯絡；銀行帳號請留在收款設定。</p>
      <p id={`${id}-description-public`} className="field-hint">儲存後可先預覽，再發布到店首頁、商品、購物車及訂單頁的「商店說明與聯絡」。修改草稿不會立即更新公開頁；這段說明也不會啟用交易或更改既有訂單條件。</p>
      {store ? <p>幣別：{currencyLabel(store.currency)}</p> : <><label className="field">幣別<select value={fields.currency} onChange={event => change('currency', event.target.value)}><option value="TWD">新臺幣 TWD</option><option value="USD">美元 USD</option></select></label><p className="field-hint">建立後不能更改。</p></>}
      {error && <p role="alert" className="banner banner-error">{error}</p>}
      <div className="actions"><button className={store ? 'btn btn-ghost' : 'btn btn-primary'} disabled={busy}>{store ? '儲存商店資料' : '建立商店'}</button></div>
    </fieldset>
  </form>;
}
