import {HostedStoreSettingsArea, SettingsForm} from './HostedStoreSettingsArea';
import {HostedStorePublishArea} from './HostedStorePublishArea';
import {HostedStoreCooperationArea} from './HostedStoreCooperationArea';
import {HostedStoreProductsArea} from './HostedStoreProductsArea';
import {useStorePageData} from './hosted-store-page-state';
import {useStoreDirtyForms, type RegisterLeave} from './hosted-store-dirty-state';
import {StoreOverviewSchema,type StoreOverview} from '../../../../contracts/guild-launchpad/v1/hosted-commerce-setup';
import {storeOrderStatus} from '../../../../modules/agent-commerce/seller-console/ui/view';
import {HostedSupplyOffer} from './HostedSupplyOffer';
import {parseSellerConsoleRoute,sellerSlugFallback,sellerConsoleHref} from '../../../../modules/agent-commerce/seller-console/route';
import {parseSupplierConsoleRoute} from '../../../../modules/agent-commerce/supplier-console/ui/route';
import {PageLoadBoundary} from '../LazyPage';
import {lazy, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {OpaqueId} from '../../../../contracts/common/v1/identity';
import {StoreViewSchema} from '../../../../contracts/guild-launchpad/v1/storefront';
import {StoreSetup} from './StoreSetup';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal} from '../format';
import {useMyStores, stateWord} from './MyStoreAction';
import {HostedSellerOrders, SellerOrdersLink} from './HostedSellerOrders';
import {HostedSupplierOrders} from './HostedSupplierOrders';
import {ReservationSettingSchema} from '../../../../contracts/guild-launchpad/v1/hosted-shared-order';
import {sellerOrdersRoute} from './hosted-seller-order-state';
import {useLocalAction} from '../useLocalAction';
import {HostedSupplyCatalog, SupplyCatalogList} from './HostedSupplyCatalog';
import {HostedReservationSetting} from './HostedReservationSetting';
import './HostedStore.css';

const NOTICE = '店鋪／商品展示已就緒，交易尚未啟用';
// Same path as productPath in modules/agent-commerce/hosted/page.ts (not exported).
function productSharePath(slug: string, sku: string) {
  return `/shops/${encodeURIComponent(slug)}/products/${encodeURIComponent(sku)}`;
}
function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).href;
}
const SupplierConsole = lazy(() => import('../../../../modules/agent-commerce/supplier-console/ui/SupplierConsole').then(m => ({default:m.SupplierConsole})));
const SellerConsole = lazy(() => import('../../../../modules/agent-commerce/seller-console/ui/SellerConsole').then(m => ({default:m.SellerConsole})));
export function HostedStore({client, enabled, appearanceEnabled=false,policiesEnabled=false,galleryEnabled=false,variantsEnabled=false,categoriesEnabled=false, locationHash, userId, registerLeave, photosEnabled=false, photoUploadsEnabled=false, materialMediaEnabled=false, materialUploadsEnabled=false, distributionPhotosEnabled=false, supplyOfferPhotosEnabled=false, consoleEnabled=false, commerceConsoleEnabled=false, checkoutEnabled=false, selfShipEnabled=false, dropShipEnabled=false, providerEnvironment='sandbox'}: {galleryEnabled?:boolean;variantsEnabled?:boolean;categoriesEnabled?:boolean;policiesEnabled?:boolean;appearanceEnabled?:boolean;supplyOfferPhotosEnabled?:boolean;distributionPhotosEnabled?:boolean;materialMediaEnabled?:boolean;materialUploadsEnabled?:boolean;commerceConsoleEnabled?:boolean;checkoutEnabled?:boolean;selfShipEnabled?:boolean;dropShipEnabled?:boolean;providerEnvironment?:'sandbox'|'live';consoleEnabled?:boolean;client: PortalClient; photosEnabled?:boolean;photoUploadsEnabled?:boolean;enabled: boolean; locationHash: string; userId: string; registerLeave: RegisterLeave}) {
  const consoleRoute = parseSupplierConsoleRoute(locationHash);
  if (consoleEnabled && enabled && consoleRoute) {
    const key = `${userId}:${client.sessionGeneration}:${consoleRoute.tenantId}:${consoleRoute.instanceId}`;
    return <PageLoadBoundary label="供應商營運中心" resetKey={key}><SupplierConsole dropShipEnabled={dropShipEnabled} supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} key={key} client={client} userId={userId} route={consoleRoute} registerLeave={registerLeave} photosEnabled={photosEnabled} photoUploadsEnabled={photoUploadsEnabled} materialMediaEnabled={materialMediaEnabled} materialUploadsEnabled={materialUploadsEnabled}/></PageLoadBoundary>;
  }
  const sellerRoute = parseSellerConsoleRoute(locationHash);
  if (commerceConsoleEnabled && enabled && sellerRoute) {
    const key = `${userId}:${client.sessionGeneration}:${sellerRoute.tenantId}:${sellerRoute.instanceId}`;
    return <PageLoadBoundary label="賣家主控台" resetKey={key}><SellerConsole key={key} client={client} userId={userId} route={sellerRoute} registerLeave={registerLeave} providerEnvironment={providerEnvironment} checkoutEnabled={checkoutEnabled} selfShipEnabled={selfShipEnabled} dropShipEnabled={dropShipEnabled}/></PageLoadBoundary>;
  }
  const retained = sellerOrdersRoute(locationHash) ?? (!enabled ? sellerOrdersRoute(locationHash + '/orders') : null);
  if (retained?.supplier) return <HostedSupplierOrders key={`${userId}:${client.sessionGeneration}:${retained.tenantId}:${retained.instanceId}`} client={client} route={retained}/>;
  if (retained) return <HostedSellerOrders key={`${userId}:${client.sessionGeneration}:${retained.tenantId}:${retained.instanceId}`} client={client} route={retained} registerLeave={registerLeave} commerceConsoleEnabled={commerceConsoleEnabled}/>;
  if (!enabled) return <p className="banner" role="status">目前不開放商店設定。若要查看或取消既有預留，請開啟你保存的店主管理連結；登入後會重新確認目前權限。</p>;
  if (locationHash === '#stores/setup') return <StoreSetup client={client} userId={userId} registerLeave={registerLeave}/>;
  if (locationHash === '#stores/supply/setup') return <StoreSetup client={client} userId={userId} registerLeave={registerLeave} purpose="supply"/>;
  if (consoleRoute && locationHash.split('?')[0].split('/')[3] === 'supply') return <HostedSupplyCatalog supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} key={`${userId}:${client.sessionGeneration}:${consoleRoute.tenantId}:${consoleRoute.instanceId}`} client={client} tenantId={consoleRoute.tenantId} instanceId={consoleRoute.instanceId} registerLeave={registerLeave}/>;
  const path = locationHash.replace(/^#/, '').split('/');
  if (path.length === 1 && path[0] === 'stores') return <StoreList key={`${userId}:${client.sessionGeneration}`} client={client}/>;
  if (path.length === 2 && path[0] === 'stores' && path[1] === 'supply') return <SupplyCatalogList key={`${userId}:${client.sessionGeneration}`} client={client}/>;
  if (path.length === 4 && path[0] === 'stores' && path[3] === 'supply' && OpaqueId.safeParse(path[1]).success && OpaqueId.safeParse(path[2]).success) return <HostedSupplyCatalog supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} key={`${userId}:${client.sessionGeneration}:${path[1]}:${path[2]}`} client={client} tenantId={path[1]} instanceId={path[2]} registerLeave={registerLeave}/>;
  const offerId = path.length===5&&path[3]==='supply-offers'&&OpaqueId.safeParse(path[4]).success?path[4]:undefined;
  const cooperation = path.length===4&&path[3]==='cooperation';
  const valid = (path.length === 3 || !!offerId || cooperation) && path[0] === 'stores' && OpaqueId.safeParse(path[1]).success && OpaqueId.safeParse(path[2]).success;
  const fallback = sellerSlugFallback(locationHash);
  if (fallback?.orders) return <HostedSellerOrders key={`${userId}:${client.sessionGeneration}:${fallback.tenantId}:${fallback.instanceId}`} client={client} route={{tenantId:fallback.tenantId,instanceId:fallback.instanceId,supplier:false}} registerLeave={registerLeave} commerceConsoleEnabled={commerceConsoleEnabled}/>;
  if (fallback) return <StorePage categoriesEnabled={categoriesEnabled} variantsEnabled={variantsEnabled} galleryEnabled={galleryEnabled} policiesEnabled={policiesEnabled} appearanceEnabled={appearanceEnabled} supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} key={`${userId}:${client.sessionGeneration}:${fallback.tenantId}:${fallback.instanceId}`} client={client} userId={userId} tenantId={fallback.tenantId} instanceId={fallback.instanceId} registerLeave={registerLeave} photosEnabled={photosEnabled} photoUploadsEnabled={photoUploadsEnabled} consoleEnabled={consoleEnabled} commerceConsoleEnabled={commerceConsoleEnabled} checkoutEnabled={checkoutEnabled} materialMediaEnabled={materialMediaEnabled} distributionPhotosEnabled={distributionPhotosEnabled}/>;
  return valid ? <StorePage categoriesEnabled={categoriesEnabled} variantsEnabled={variantsEnabled} galleryEnabled={galleryEnabled} policiesEnabled={policiesEnabled} appearanceEnabled={appearanceEnabled} supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} key={`${userId}:${client.sessionGeneration}:${path[1]}:${path[2]}:${offerId??(cooperation?'cooperation':'store')}`} offerId={offerId} cooperation={cooperation} client={client} userId={userId} tenantId={path[1]} instanceId={path[2]} registerLeave={registerLeave} photosEnabled={photosEnabled} photoUploadsEnabled={photoUploadsEnabled} consoleEnabled={consoleEnabled} commerceConsoleEnabled={commerceConsoleEnabled} checkoutEnabled={checkoutEnabled} materialMediaEnabled={materialMediaEnabled} distributionPhotosEnabled={distributionPhotosEnabled}/> : <MissingStore/>;
}
function BackLink() { return <div className="actions"><a href="#stores" className="btn btn-ghost">返回我的商店</a></div>; }
function MissingStore() { return <div className="hosted-store stack"><BackLink/><p>找不到這間商店。</p></div>; }
function StoreList({client}: {client: PortalClient}) {
  const {data, error, retry, loadMore, loadingMore, pageError} = useMyStores(client);
  return <div className="hosted-store stack" data-share-entry="stores" tabIndex={-1}>
    <div className="actions"><a className="btn btn-primary" href="#stores/setup">建立我的商店</a><a className="btn btn-ghost" href="#stores/supply/setup">開始供貨設定</a></div>
    {error ? <><p role="alert">暫時無法讀取你的商店。</p><div className="actions"><button type="button" className="btn btn-ghost" onClick={retry}>重試</button></div></> : !data ? <p role="status">正在確認你的商店…</p> : <>
      {data.items.length === 0 && !data.next_cursor && <p>你還沒有商店。從這裡開始，就能接續完成開店設定。</p>}
      {data.items.map(item => <article className="card stack" key={item.instance_id}>
        <h2>{item.name ?? '尚未完成設定的商店'}</h2><p>業務空間：{item.tenant_display_name}</p><p>{stateWord(item)}</p>
        <div className="actions"><a className="btn btn-primary" href={`#stores/${item.tenant_id}/${item.instance_id}`}>進入我的商店</a>
          {item.publication_state === 'published' && item.public_path && <a href={item.public_path} target="_blank" rel="noopener">查看公開頁</a>}</div>
      </article>)}
      {pageError && <p role="alert">暫時無法載入其餘商店，請重試。</p>}
      {data.next_cursor && <div className="actions"><button type="button" className="btn btn-ghost" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '正在載入…' : pageError ? '重試載入其餘商店' : '載入更多商店'}</button></div>}
    </>}
  </div>;
}

function StorePage({supplyOfferPhotosEnabled=false,offerId,cooperation=false,appearanceEnabled=false,policiesEnabled=false,galleryEnabled=false,variantsEnabled=false,categoriesEnabled=false,client, userId,tenantId, instanceId, registerLeave,photosEnabled,photoUploadsEnabled, consoleEnabled=false, commerceConsoleEnabled=false, checkoutEnabled=false, materialMediaEnabled=false, distributionPhotosEnabled=false}: {supplyOfferPhotosEnabled?:boolean;galleryEnabled?:boolean;variantsEnabled?:boolean;categoriesEnabled?:boolean;policiesEnabled?:boolean;appearanceEnabled?:boolean;offerId?:string;cooperation?:boolean;userId:string;photosEnabled:boolean;photoUploadsEnabled:boolean;client: PortalClient; tenantId: string; instanceId: string; registerLeave: RegisterLeave; consoleEnabled?: boolean; commerceConsoleEnabled?: boolean; checkoutEnabled?:boolean; materialMediaEnabled?: boolean;distributionPhotosEnabled?:boolean}) {
  const root = `/tenants/${tenantId}/storefronts/${instanceId}`;
  const {distributionRefresh, view, reservationSetting, products, galleries, media, photoBlocks, photoBlockRef, photoBlocking, setPhotoBlocking,
    preview, publicationReview, appearance, policiesDraft, policiesError, appearanceDraft, appearanceError, templateChoice, setTemplateChoice,
    missing, setMissing, error, status, loading, busy, retry, busyRef, held, statusLine, load, announce, send, command} = useStorePageData({
    client, root, photosEnabled, appearanceEnabled, policiesEnabled, galleryEnabled,
    onConflict: () => {setEditing(null); setSupplyEditing(null); markDirty('edit', false); markDirty('supply', false);},
  });
  const {dirtyForms, dirtyFormsRef, hasDraft, hasFormDraft, markDirty, leaveOk} = useStoreDirtyForms({
    client, root, registerLeave, busy, retry, photoBlocking, busyRef, held, photoBlockRef, announce,
  });
  function photoState(id:string,dirty:boolean,blocking:boolean){
    setPhotoBlocking(id,blocking);markDirty(id==='appearance'?'appearance':id==='policies'?'policies':'photo/'+id,dirty);
  }
  const [editing, setEditing] = useState<string | null>(null);
  const [supplyEditing, setSupplyEditing] = useState<string | null>(null);
  const [area,setArea]=useState<'products'|'cooperation'|'publish'|'settings'>(cooperation?'cooperation':'products');
  const [query,setQuery]=useState('');
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{url: string; message: string} | null>(null);
  const manualField = useRef<HTMLInputElement>(null);
  const publication = view?.publication;
  const publicPath = publication?.state === 'published' ? publication.public_path : null;
  const storeCopyUrl = publicPath ? absoluteUrl(publicPath) : null;
  // preview.projection is the published snapshot only while clean; a dirty preview is the saved draft.
  const publishedSkus = publication?.state === 'published' && preview && !preview.dirty ? new Set(preview.projection.products.map(item => item.sku)) : null;
  const publishedSkuKey = publishedSkus ? [...publishedSkus].sort().join('\n') : null;
  const copyAction = useLocalAction([root, storeCopyUrl, publishedSkuKey, editing, supplyEditing, publication?.current_revision]);
  useLayoutEffect(() => {
    setCopyFeedback(null);
    setManualUrl(null);
  }, [root, storeCopyUrl, publishedSkuKey, editing, supplyEditing, publication?.current_revision]);
  useEffect(() => {if(!appearanceEnabled)markDirty('appearance', templateChoice !== null && templateChoice !== appearance?.template_id);}, [appearanceEnabled,templateChoice, appearance?.template_id]);
  useEffect(() => {
    if (!manualUrl) return;
    manualField.current?.focus();
    manualField.current?.select();
  }, [manualUrl]);
  async function copyLink(url: string) {
    const result = await copyAction.run('copy', () => {setManualUrl(null); setCopyFeedback(null); return navigator.clipboard.writeText(url);});
    if (result.status === 'done') setCopyFeedback({url, message: '已複製連結'});
    else if (result.status === 'failed') {setCopyFeedback({url, message: '無法自動複製，請選取並複製下方內容'}); setManualUrl(url);}
  }
  const can = (key: string) => view?.writable === true && view.capabilities.includes(key);
  const locked = busy || retry !== null || photoBlocking || loading;
  const publishDisabled = locked || hasDraft || !publicationReview?.preview.projection.products.length || !can('store:publish');
  function publishSaved() {
    // Use the review already shown on screen; never fetch a new digest and publish it silently.
    if (publishDisabled || !publicationReview || busyRef.current || held.current || Object.values(dirtyFormsRef.current).some(Boolean) || Object.values(photoBlockRef.current).some(Boolean)) return;
    void command({method:'post',path:root+'/publish-reviewed',body:{review_digest:publicationReview.review_digest},version:publicationReview.store_version,
      schema:StoreViewSchema,notice:`已上架 ${publicationReview.preview.projection.products.length} 件商品，公開頁已更新。`,success:()=>{}});
  }
  const draftArea=(id:string):typeof area=>id==='settings'||id==='policies'?'settings':id==='appearance'?'publish':id.startsWith('distribution/')?'cooperation':'products';
  const otherDraft=Object.entries(dirtyForms).find(([id,dirty])=>dirty&&draftArea(id)!==area);
  const areaLocked=locked||!!otherDraft;
  if (missing) return <MissingStore/>;
  const store = view?.store;
  const publicationText = publication?.state === 'published' ? `已發布・第 ${publication.current_revision} 版・${formatIsoLocal(publication.published_at)}`
    : publication?.state === 'unpublished' ? '已停止公開' : '尚未發布';
  const productCopyUrl = (sku: string) => store && publishedSkus?.has(sku) ? absoluteUrl(productSharePath(store.slug, sku)) : null;
  if (offerId) return <div className="hosted-store stack">
    <p ref={statusLine} tabIndex={-1} role="status" aria-live="polite">{status}</p>
    {error&&<p className="banner banner-error" role="alert">{error}</p>}
    {(retry||error)&&<div className="actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>void (retry?send(retry):load())}>{retry?'重試':'重新載入'}</button></div>}
    {view?<HostedSupplyOffer client={client} root={root} offerId={offerId} refresh={distributionRefresh} busy={locked} writable={can('store:write')} onDirty={value=>markDirty('distribution/offer',value)} onCommand={command}/>:!error&&<p>正在確認商店權限…</p>}
  </div>;
  return <div className={appearanceEnabled?"hosted-store hosted-store-appearance-enabled stack":"hosted-store stack"}>
    <BackLink/>
    <p ref={statusLine} tabIndex={-1} role="status" aria-live="polite">{loading && !view ? '正在載入商店…' : [status, store ? publicationText : ''].filter(Boolean).join(' ')}</p>
    {error && <p className="banner banner-error" role="alert">{error}</p>}
    <div className="actions">{retry ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void send(retry)}>重試</button>
      : error && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>重新載入</button>}</div>
    {view && <>
      <h2>{store?.name ?? '設定我的商店'}</h2>
      {store && <SellerOrdersLink client={client} tenantId={tenantId} instanceId={instanceId} readinessHref={commerceConsoleEnabled?sellerConsoleHref({tenantId,instanceId},'overview'):undefined}/>}
      {!view.writable && <p>{view.capabilities.some(key => key !== 'store:read') ? '這間商店目前暫停，無法修改。' : '你可以檢視這間商店，但不能修改。'}</p>}
      {!store ? can('store:manage') ? <SettingsForm key="setup" client={client} root={root} busy={locked} onMissing={() => setMissing(true)} onDirty={value => markDirty('settings', value)} onSave={(body, success, fieldError) => command({method: 'post', path: root + '/setup', body, schema: StoreViewSchema, notice: '已建立商店。', success, fieldError})}/>
        : <p>這間商店還沒完成設定，請業務空間擁有者或管理員設定。</p> : <>
        {checkoutEnabled?<StoreOrderBanner client={client} tenantId={tenantId} instanceId={instanceId} consoleEnabled={commerceConsoleEnabled} refresh={distributionRefresh}/>:<p className="banner" role="note">{reservationSetting?.reservation_enabled && reservationSetting.admission_enabled ? '已開放 30 分鐘庫存預留；付款與出貨尚未啟用。' : NOTICE}</p>}
        <nav className="hosted-supply-nav hosted-retail-nav" aria-label="商店工作區">{([['products','商品'],['cooperation','供貨合作'],['publish','店面與發布'],['settings','商店資料']] as const).map(([key,label])=><button key={key} type="button" className="btn btn-ghost" aria-pressed={area===key} aria-controls={`store-${key}-panel`} onClick={()=>setArea(key)}>{label}</button>)}</nav>
        {otherDraft&&<div className="hosted-store-draft-note"><p>另一個工作區有未儲存內容，先儲存或取消後就能繼續修改。</p><button type="button" className="btn btn-ghost" onClick={()=>setArea(draftArea(otherDraft[0]))}>回到未儲存的工作區</button></div>}
        {reservationSetting && <HostedReservationSetting setting={reservationSetting} writable={view.writable} locked={locked || hasDraft || loading}
          onToggle={() => void command({method:'patch',path:root+'/reservation-setting',body:{reservation_enabled:!reservationSetting.reservation_enabled},
            version:reservationSetting.version,schema:ReservationSettingSchema,notice:reservationSetting.reservation_enabled?'已停止接受新預留。既有預留仍可查看與取消。':'已開放 30 分鐘預留。',success:()=>{}})}/>}
        <HostedStoreProductsArea
          area={area} can={can} photosEnabled={photosEnabled} photoUploadsEnabled={photoUploadsEnabled} galleryEnabled={galleryEnabled} publicationReview={publicationReview} publishDisabled={publishDisabled}
          publication={publication} busy={busy} held={held} publishSaved={publishSaved} publicPath={publicPath} hasDraft={hasDraft} photoBlocking={photoBlocking}
          loading={loading} view={view} products={products} query={query} setQuery={setQuery} locked={locked} preview={preview}
          categoriesEnabled={categoriesEnabled} client={client} userId={userId} root={root} distributionRefresh={distributionRefresh} retry={retry} otherDraft={otherDraft}
          photoBlocks={photoBlocks} photoState={photoState} load={load} variantsEnabled={variantsEnabled} supplyEditing={supplyEditing} editing={editing} store={store}
          areaLocked={areaLocked} command={command} setSupplyEditing={setSupplyEditing} markDirty={markDirty} leaveOk={leaveOk} setEditing={setEditing} productCopyUrl={productCopyUrl}
          copyAction={copyAction} copyLink={copyLink} copyFeedback={copyFeedback} manualUrl={manualUrl} manualField={manualField} tenantId={tenantId} instanceId={instanceId}
          galleries={galleries} hasFormDraft={hasFormDraft} media={media}/>
        <HostedStoreCooperationArea
          area={area} view={view} supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} client={client} root={root} distributionRefresh={distributionRefresh} areaLocked={areaLocked}
          can={can} markDirty={markDirty} command={command} leaveOk={leaveOk} load={load} consoleEnabled={consoleEnabled} userId={userId}
          tenantId={tenantId} instanceId={instanceId} materialMediaEnabled={materialMediaEnabled} distributionPhotosEnabled={distributionPhotosEnabled}/>
        <HostedStorePublishArea
          area={area} publication={publication} preview={preview} appearanceEnabled={appearanceEnabled} appearance={appearance} areaLocked={areaLocked} can={can}
          templateChoice={templateChoice} setTemplateChoice={setTemplateChoice} markDirty={markDirty} command={command} root={root} appearanceError={appearanceError} loading={loading}
          locked={locked} appearanceDraft={appearanceDraft} client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} busy={busy}
          retry={retry} otherDraft={otherDraft} photoBlocks={photoBlocks} photoState={photoState} load={load} dirtyForms={dirtyForms} publicationReview={publicationReview}
          publishDisabled={publishDisabled} publishSaved={publishSaved} hasDraft={hasDraft} store={store} view={view} publicPath={publicPath} storeCopyUrl={storeCopyUrl}
          copyAction={copyAction} copyLink={copyLink} copyFeedback={copyFeedback} manualUrl={manualUrl} manualField={manualField}/>
        <HostedStoreSettingsArea
          area={area} can={can} view={view} client={client} root={root} store={store} areaLocked={areaLocked}
          dirtyForms={dirtyForms} setMissing={setMissing} markDirty={markDirty} command={command} publication={publication} policiesEnabled={policiesEnabled} policiesError={policiesError}
          loading={loading} locked={locked} load={load} policiesDraft={policiesDraft} userId={userId} tenantId={tenantId} instanceId={instanceId}
          busy={busy} retry={retry} otherDraft={otherDraft} photoBlocks={photoBlocks} photoState={photoState}/>
      </>}
    </>}
  </div>;
}
function StoreOrderBanner({client,tenantId,instanceId,consoleEnabled,refresh}:{client:PortalClient;tenantId:string;instanceId:string;consoleEnabled:boolean;refresh:number}) {
 const [slot,setSlot]=useState<{data:StoreOverview|null;loading:boolean;status?:number}>({data:null,loading:true});
 const [nonce,setNonce]=useState(0),generation=client.sessionGeneration,root=`/tenants/${tenantId}/storefronts/${instanceId}`;
 useEffect(()=>{
  const abort=new AbortController();
  const current=()=>!abort.signal.aborted&&generation===client.sessionGeneration;
  setSlot({data:null,loading:consoleEnabled});
  if(consoleEnabled)void client.get(root+'/overview',{signal:abort.signal,suppressConsole:true}).then(raw=>{
   const data=StoreOverviewSchema.parse(raw);
   if(data.tenant_id!==tenantId||data.instance_id!==instanceId)throw Error('read_target_mismatch');
   if(current())setSlot({data,loading:false});
  }).catch(error=>{if(current())setSlot({data:null,loading:false,status:error instanceof ApiError?error.status:undefined});});
  return()=>abort.abort();
 },[client,generation,root,tenantId,instanceId,consoleEnabled,refresh,nonce]);
 const state=storeOrderStatus({consoleEnabled,readiness:slot.data,loading:slot.loading,status:slot.status});
 return <section className="banner merchant-order-status" aria-label="接單狀態"><p aria-live="polite">{state.text}</p>
  {state.review&&<a className="btn btn-ghost btn-small" href={sellerConsoleHref({tenantId,instanceId},'overview')}>檢查開店準備</a>}
  {slot.data&&<small className="field-hint">資料時間 {formatIsoLocal(slot.data.checked_at)}</small>}
  {consoleEnabled&&(state.retry||slot.data!==null||slot.loading)&&<button type="button" className="btn btn-ghost btn-small" disabled={slot.loading} onClick={()=>setNonce(n=>n+1)}>更新接單狀態</button>}
 </section>;
}
