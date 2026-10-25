import {useEffect, useRef, useState, type FormEvent, type RefObject} from 'react';
import {CategoriesEditor} from '../../../../modules/agent-commerce/storefront/categories/Editor';
import {VariantsEditor} from '../../../../modules/agent-commerce/storefront/variants/Editor';
import {ProductInputSchema, MerchantProductViewSchema as ProductViewSchema, ProductRemovedSchema, type MerchantProductView as ProductView} from '../../../../contracts/guild-launchpad/v1/storefront';
import {SupplyTermsSchema} from '../../../../contracts/guild-launchpad/v1/hosted-supply-terms';
import {SupplyOfferSchema} from '../../../../contracts/guild-launchpad/v1/hosted-distribution';
import {HostedSupplyTerms} from './HostedSupplyTerms';
import {HostedStoreGallery} from './HostedStoreGallery';
import {HostedStorePhoto} from './HostedStorePhoto';
import {ProductSearch,productMatches,MerchantInventorySummary,InventoryDefinition,STOCK_HINT} from '../../../../modules/agent-commerce/hosted-ui/CommerceTools';
import {formatMinor, parseMajorToMinor} from '../format';
import {PublicationReview, ManualCopy, currencyLabel} from './hosted-store-area-shared';
import type {PortalClient} from '../api';
import type {StoreAreaData, StoreArea, StoreAreaStore} from './hosted-store-area-shared';

export interface HostedStoreProductsAreaProps {
  area: StoreArea;
  can: (key: string) => boolean;
  photosEnabled: boolean;
  photoUploadsEnabled: boolean;
  galleryEnabled: boolean;
  publicationReview: StoreAreaData['publicationReview'];
  publishDisabled: boolean;
  publication: NonNullable<StoreAreaData['view']>['publication'] | undefined;
  busy: StoreAreaData['busy'];
  held: StoreAreaData['held'];
  publishSaved: () => void;
  publicPath: string | null | undefined;
  hasDraft: boolean;
  photoBlocking: StoreAreaData['photoBlocking'];
  loading: StoreAreaData['loading'];
  view: NonNullable<StoreAreaData['view']>;
  products: StoreAreaData['products'];
  query: string;
  setQuery: (value: string) => void;
  locked: boolean;
  preview: StoreAreaData['preview'];
  categoriesEnabled: boolean;
  client: PortalClient;
  userId: string;
  root: string;
  distributionRefresh: StoreAreaData['distributionRefresh'];
  retry: StoreAreaData['retry'];
  otherDraft: [string, boolean] | undefined;
  photoBlocks: StoreAreaData['photoBlocks'];
  photoState: (id: string, dirty: boolean, blocking: boolean) => void;
  load: StoreAreaData['load'];
  variantsEnabled: boolean;
  supplyEditing: string | null;
  editing: string | null;
  store: StoreAreaStore;
  areaLocked: boolean;
  command: StoreAreaData['command'];
  setSupplyEditing: (value: string | null) => void;
  markDirty: (id: string, value: boolean) => void;
  leaveOk: () => boolean;
  setEditing: (value: string | null) => void;
  productCopyUrl: (sku: string) => string | null;
  copyAction: {pending: string | null};
  copyLink: (url: string) => Promise<void>;
  copyFeedback: {url: string; message: string} | null;
  manualUrl: string | null;
  manualField: RefObject<HTMLInputElement | null>;
  tenantId: string;
  instanceId: string;
  galleries: StoreAreaData['galleries'];
  hasFormDraft: boolean;
  media: StoreAreaData['media'];
}

export function HostedStoreProductsArea({
  area, can, photosEnabled, photoUploadsEnabled, galleryEnabled, publicationReview, publishDisabled,
  publication, busy, held, publishSaved, publicPath, hasDraft, photoBlocking,
  loading, view, products, query, setQuery, locked, preview,
  categoriesEnabled, client, userId, root, distributionRefresh, retry, otherDraft,
  photoBlocks, photoState, load, variantsEnabled, supplyEditing, editing, store,
  areaLocked, command, setSupplyEditing, markDirty, leaveOk, setEditing, productCopyUrl,
  copyAction, copyLink, copyFeedback, manualUrl, manualField, tenantId, instanceId,
  galleries, hasFormDraft, media,
}: HostedStoreProductsAreaProps) {
  return <section id="store-products-panel" hidden={area!=='products'} className="hosted-supply-panel stack" aria-labelledby="store-products-title"><h3 id="store-products-title">商品</h3>
          {can('store:publish') && <div className="hosted-store-publication stack">
            <h4>商品上架</h4>
            <p>先儲存商品資料{photosEnabled && photoUploadsEnabled && !galleryEnabled ? '，選圖後會自動儲存照片' : ''}，確認內容後即可一鍵上架。</p>
            {publicationReview && <PublicationReview review={publicationReview}/>}
            <div className="actions"><button type="button" className="btn btn-primary" disabled={publishDisabled || (publication?.state==='published' && !publicationReview?.preview.dirty)} onClick={publishSaved}>
              {busy && held.current?.path.endsWith('/publish-reviewed') ? '正在上架…' : publication?.state==='published' && publicationReview && !publicationReview.preview.dirty ? '商品已全部上架' : '一鍵上架商品'}
            </button>{publicPath && <a href={publicPath} target="_blank" rel="noopener">查看公開商店</a>}</div>
            {hasDraft ? <p className="field-hint">還有未儲存或尚未確認的內容，請先完成儲存或取消變更。</p>
              : photoBlocking ? <p className="field-hint">照片正在儲存或等待確認，完成後就能上架。</p>
              : loading ? <p className="field-hint">正在確認可上架內容…</p>
              : publicationReview && !publicationReview.preview.projection.products.length ? <p className="field-hint">請先新增並儲存至少一件零售商品，或接受合作選品。</p> : null}
          </div>}
          <p>{view.product_count}／{view.product_limit} 件商品</p>
          {galleryEnabled&&<p className="field-hint">自有商品每件最多 8 張照片。供貨合作商品的公開頁沿用你選用的公開素材照片，沒有時不顯示照片；供應商分享的照片只供私人評估。</p>}
          {!!products.length&&<ProductSearch value={query} onChange={setQuery} count={products.filter(product=>productMatches(product,query)).length} total={products.length} disabled={locked||hasDraft}/>}
          {!!products.length&&!products.some(product=>productMatches(product,query))&&<p>沒有符合的商品，清除搜尋即可查看全部。</p>}
          {publication?.state === 'published' && preview?.dirty && <p>有尚未發布的變更；發布更新後才能複製商品連結。</p>}
          {!products.length && <p>{publicationReview?.preview.projection.products.length ? '這間店目前使用合作選品；可前往供貨合作管理。' : '還沒有自有零售商品。填寫下方資料，先儲存第一件商品。'}</p>}
          {categoriesEnabled&&<CategoriesEditor client={client} userId={userId} root={root} writable={can('store:write')} refresh={String(distributionRefresh)}
            locked={loading||busy||retry!==null||!!otherDraft||(photoBlocking&&!photoBlocks.categories)} onState={(dirty,blocking)=>photoState('categories',dirty,blocking)} onSaved={load}/>}
          {variantsEnabled&&<VariantsEditor categoriesEnabled={categoriesEnabled} client={client} userId={userId} root={root} writable={can('store:write')} refresh={products.map(p=>p.product_id+':'+p.version).join(',')}
            locked={loading||busy||retry!==null||!!otherDraft||(photoBlocking&&!photoBlocks.variants)} onState={(dirty,blocking)=>photoState('variants',dirty,blocking)} onSaved={load}/>}
          {!supplyEditing&&<InventoryDefinition/>}<div className="hosted-store-products">{products.map(product => <article className="hosted-store-product stack" key={product.product_id} hidden={!productMatches(product,query)}>
            {supplyEditing === product.product_id && can('store:write') ? <HostedSupplyTerms key={product.version} client={client} path={root + '/products/' + product.product_id + '/supply-terms'} title={product.title} description={product.description} supplierName={store.name} busy={areaLocked} onPublish={can('store:publish') ? version => command({method: 'post', path: root + '/products/' + product.product_id + '/supply-offer', body: {}, version, schema: SupplyOfferSchema, notice: '已公開供貨版本，店主可申請選用。', success: () => {setSupplyEditing(null); markDirty('supply', false);}}) : undefined} onDirty={value => markDirty('supply', value)} onCancel={() => {if (leaveOk()) {setSupplyEditing(null); markDirty('supply', false);}}} onSave={(body, version, success) => command({method: 'patch', path: root + '/products/' + product.product_id + '/supply-terms', body, version, schema: SupplyTermsSchema, product: true, notice: '已儲存供貨條件。可直接確認並公開這一版。', success: () => {success(); markDirty('supply', false);}})}/>
              : editing === product.product_id && can('store:write') ? <ProductForm key={product.version} product={product} currency={store.currency} busy={areaLocked} onDirty={value => markDirty('edit', value)} onCancel={() => {if (leaveOk()) {setEditing(null); markDirty('edit', false);}}} onSave={(body, success) => command({method: 'patch', path: root + '/products/' + product.product_id, body, version: product.version, schema: ProductViewSchema, product: true, notice: '已儲存。', success: value => {success(value); setEditing(null); markDirty('edit', false);}})}/>
              : <><h4>{product.title}</h4><p>{formatMinor(product.price_minor, product.currency)}</p><MerchantInventorySummary stock={product.stock} inventory={product.inventory} onRefresh={()=>void load()} disabled={locked||hasDraft}/><p className="hosted-store-description">{product.description}</p>
                {can('store:write') && <div className="actions"><button type="button" className="btn btn-ghost" disabled={areaLocked} onClick={() => {if (leaveOk()) {setSupplyEditing(null); setEditing(product.product_id); markDirty('edit', false);}}}>編輯</button>
                  <button type="button" className="btn btn-ghost" disabled={areaLocked} onClick={() => {if (leaveOk()) {setEditing(null); setSupplyEditing(product.product_id);}}}>供貨條件</button>
                  <button type="button" className="btn btn-ghost" disabled={areaLocked} onClick={() => {if (window.confirm(`要移除「${product.title}」嗎？已發布的展示頁要重新發布後才會更新。`)) void command({method: 'post', path: root + '/products/' + product.product_id + '/remove', body: {}, version: product.version, schema: ProductRemovedSchema, product: true, notice: '已移除商品。', success: () => {}});}}>移除</button></div>}
                {productCopyUrl(product.sku) && <div className="actions"><button type="button" className="btn btn-ghost" aria-busy={copyAction.pending !== null} onClick={() => {const url = productCopyUrl(product.sku); if (url) void copyLink(url);}}>複製商品連結</button></div>}
              </>}
            {copyFeedback && copyFeedback.url === productCopyUrl(product.sku) && <p className="field-hint" role="status">{copyFeedback.message}</p>}
            {manualUrl !== null && manualUrl === productCopyUrl(product.sku) && <ManualCopy url={manualUrl} fieldRef={manualField}/>}
            {galleryEnabled?<HostedStoreGallery client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} product={product} gallery={galleries.find(item=>item.product_id===product.product_id)}
              writable={can('store:write')} locked={loading||areaLocked||(photoBlocking&&!photoBlocks[product.product_id])} onState={(dirty,blocking)=>photoState(product.product_id,dirty,blocking)} onSaved={load}/>:photosEnabled&&<>{hasFormDraft&&<p className="field-hint">請先儲存或取消正在編輯的資料，再選擇商品照片。</p>}<HostedStorePhoto client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} product={product} media={media.find(item=>item.product_id===product.product_id)}
              writable={can('store:write')} uploadsEnabled={photoUploadsEnabled} locked={areaLocked||hasFormDraft||(photoBlocking&&!photoBlocks[product.product_id])}
              onState={(dirty,blocking)=>photoState(product.product_id,dirty,blocking)} onSaved={()=>load({throwOnError:true})}/></>}
          </article>)}</div>
          {can('store:write') && (view.product_count >= view.product_limit ? <p>已達 {view.product_limit} 件商品上限。</p>
            : <ProductForm currency={store.currency} busy={areaLocked} primary={!products.length} onDirty={value => markDirty('add', value)} onSave={(body, success) => command({method: 'post', path: root + '/products', body, schema: ProductViewSchema, notice: photosEnabled && photoUploadsEnabled && !galleryEnabled ? '已新增商品。草稿已儲存，可選圖自動儲存照片，再按「一鍵上架商品」。' : '已新增商品。草稿已儲存，確認後可按「一鍵上架商品」。', success})}/>)}
        </section>;
}

function ProductForm({product, currency, busy, primary, onDirty, onSave, onCancel}: {
  product?: ProductView; currency: string; busy: boolean; primary?: boolean; onDirty: (dirty: boolean) => void; onCancel?: () => void;
  onSave: (body: unknown, success: (value: unknown) => void) => Promise<void>;
}) {
  const initial = {title: product?.title ?? '', description: product?.description ?? '', price: product ? String(product.price_minor / 100) : '', stock: String(product?.stock ?? 0)};
  const [fields, setFields] = useState(initial);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const onDirtyRef = useRef(onDirty); onDirtyRef.current = onDirty;
  useEffect(() => {onDirtyRef.current(dirty);}, [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []);
  const change = (key: keyof typeof fields, value: string) => setFields(old => ({...old, [key]: value}));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const amount = parseMajorToMinor(fields.price);
      const cap = ProductInputSchema.shape.price_minor.maxValue!;
      if (amount > cap) {setError(`價格上限為 ${formatMinor(cap, currency)}。`); return;}
      if (!/^\d+$/.test(fields.stock)) {setError('庫存須為整數。'); return;}
      const result = ProductInputSchema.safeParse({title: fields.title, description: fields.description, price_minor: amount, stock: Number(fields.stock)});
      if (!result.success) {setError('有欄位格式不符，請檢查後再送出。'); return;}
      await onSave(result.data, () => {if (!product) setFields(initial); onDirtyRef.current(false);});
    } catch (cause) {setError(cause instanceof Error ? cause.message : '有欄位格式不符，請檢查後再送出。');}
  }
  return <form className="hosted-store-form stack" aria-label={product ? `編輯${product.title}` : '新增商品'} onSubmit={event => void submit(event)}>
    {!product && <><h4>新增商品</h4><p className="field-hint">先儲存草稿，再加入照片與確認上架。新增商品不會立即公開。</p></>}
    <fieldset disabled={busy} className="hosted-store-fields stack"><legend className="sr-only">{product ? '編輯商品' : '新增商品'}</legend>
      <label className="field">商品名稱<input required maxLength={ProductInputSchema.shape.title.maxLength!} value={fields.title} onChange={event => change('title', event.target.value)}/></label>
      <label className="field">價格（{currencyLabel(currency)}）<input required inputMode="decimal" value={fields.price} onChange={event => change('price', event.target.value)}/></label>
      <label className="field">庫存<input required type="number" min={0} max={ProductInputSchema.shape.stock.unwrap().maxValue!} step={1} value={fields.stock} onChange={event => change('stock', event.target.value)}/></label><p className="field-hint">{STOCK_HINT}</p>
      <label className="field">商品介紹<textarea maxLength={ProductInputSchema.shape.description.unwrap().maxLength!} value={fields.description} onChange={event => change('description', event.target.value)}/></label>
      {error && <p role="alert" className="banner banner-error">{error}</p>}
      <div className="actions"><button className={primary ? 'btn btn-primary' : 'btn btn-ghost'} disabled={busy}>{product ? '儲存' : '新增商品'}</button>{onCancel && <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>取消</button>}</div>
    </fieldset>
  </form>;
}
