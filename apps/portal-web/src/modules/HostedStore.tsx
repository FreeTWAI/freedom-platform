import {CategoriesEditor} from '../../../../modules/agent-commerce/storefront/categories/Editor';
import {VariantsEditor} from '../../../../modules/agent-commerce/storefront/variants/Editor';
import {StoreOverviewSchema,type StoreOverview} from '../../../../contracts/guild-launchpad/v1/hosted-commerce-setup';
import {storeOrderStatus} from '../../../../modules/agent-commerce/seller-console/ui/view';
import {HostedStoreGallery} from './HostedStoreGallery';
import {ProductGalleriesSchema,type ProductGalleryDraft} from '../../../../contracts/guild-launchpad/v1/storefront-gallery';
import {HostedStorePolicies} from './HostedStorePolicies';
import {SellerPoliciesDraftSchema,type SellerPoliciesDraft} from '../../../../contracts/guild-launchpad/v1/storefront-policies';
import {HostedStoreAppearance} from './HostedStoreAppearance';
import {StorefrontAppearanceDraftSchema,type StorefrontAppearanceDraft} from '../../../../contracts/guild-launchpad/v1/storefront-appearance';
import {HostedSupplyOffer} from './HostedSupplyOffer';
import {parseSellerConsoleRoute,sellerSlugFallback,sellerConsoleHref} from '../../../../modules/agent-commerce/seller-console/route';
import {parseSupplierConsoleRoute} from '../../../../modules/agent-commerce/supplier-console/ui/route';
import {PartnerMaterials} from '../../../../modules/agent-commerce/supplier-console/ui/partner/PartnerMaterials';
import {PageLoadBoundary} from '../LazyPage';
import {ProductMediaPageSchema,type ProductMediaView} from '../../../../contracts/guild-launchpad/v1/hosted-store-media';
import {HostedStorePhoto} from './HostedStorePhoto';
import {lazy, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject} from 'react';
import {z} from 'zod';
import {OpaqueId} from '../../../../contracts/common/v1/identity';
import {
  StoreViewSchema, StoreSetupInputSchema, StoreUpdateInputSchema, SlugAvailabilitySchema,
  ProductInputSchema, MerchantProductViewSchema as ProductViewSchema, MerchantProductPageSchema as ProductPageSchema, ProductRemovedSchema, StorePreviewSchema,
  type MerchantProductView as ProductView, type StoreView,
} from '../../../../contracts/guild-launchpad/v1/storefront';
import {StoreAppearanceSchema, type StoreAppearance, type StoreTemplate} from '../../../../contracts/guild-launchpad/v1/storefront-presentation';
import {StorePublicationReviewSchema, type StorePublicationReview} from '../../../../contracts/guild-launchpad/v1/storefront-publication';
import {StoreSetup} from './StoreSetup';
import {SupplyTermsSchema} from '../../../../contracts/guild-launchpad/v1/hosted-supply-terms';
import {HostedDistribution} from './HostedDistribution';
import {SupplyOfferSchema} from '../../../../contracts/guild-launchpad/v1/hosted-distribution';
import {HostedSupplyTerms} from './HostedSupplyTerms';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal, formatMinor, parseMajorToMinor} from '../format';
import {useMyStores, stateWord} from './MyStoreAction';
import {HostedSellerOrders, SellerOrdersLink} from './HostedSellerOrders';
import {HostedSupplierOrders} from './HostedSupplierOrders';
import {ReservationSettingSchema} from '../../../../contracts/guild-launchpad/v1/hosted-shared-order';
import {sellerOrdersRoute} from './hosted-seller-order-state';
import {useLocalAction} from '../useLocalAction';
import {HostedSupplyCatalog, SupplyCatalogList} from './HostedSupplyCatalog';
import {HostedReservationSetting} from './HostedReservationSetting';
import './HostedStore.css';
import {ProductSearch,productMatches,MerchantInventorySummary,InventoryDefinition,STOCK_HINT} from '../../../../modules/agent-commerce/hosted-ui/CommerceTools';

const NOTICE = '店鋪／商品展示已就緒，交易尚未啟用';
// Same path as productPath in modules/agent-commerce/hosted/page.ts (not exported).
function productSharePath(slug: string, sku: string) {
  return `/shops/${encodeURIComponent(slug)}/products/${encodeURIComponent(sku)}`;
}
function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).href;
}
function ManualCopy({url, fieldRef}: {url: string; fieldRef: RefObject<HTMLInputElement | null>}) {
  return <label className="field">手動複製連結<input ref={fieldRef} readOnly value={url} onFocus={event => event.currentTarget.select()}/></label>;
}
const LEAVE = '還有尚未儲存的內容，要離開嗎？';
const NEXT: Record<string, string> = {
  storefront_slug_taken: '請換一個商店網址。',
  storefront_slug_reserved: '請換一個商店網址。',
  storefront_slug_locked: '網址已固定，請保留目前的商店網址。',
  storefront_already_set_up: '請重新載入商店，繼續編輯資料。',
  storefront_not_set_up: '請先完成商店設定。',
  storefront_has_no_products: '請先新增至少一件商品。',
  storefront_publication_changed: '請確認更新後的商品與店面內容，再按一次上架。',
  storefront_product_limit: '請編輯或移除現有商品後再新增。',
  storefront_product_in_use: '請保留這件商品，並聯絡業務空間擁有者。',
  storefront_unavailable: '請聯絡業務空間擁有者恢復使用。',
  storefront_exists: '這個業務空間已經有商店，請沿用它。',
  capability_denied: '請聯絡業務空間擁有者確認你的權限。',
  material_version_changed: '請按合作素材的「重新整理」，再選用新版本。',
  material_not_public: '請改用其他素材，或請供應商開放公開使用。',
  material_not_image: '請改選圖片素材。',
  material_content_unavailable: '請稍後再試一次。',
  distribution_photo_unavailable: '請稍後再試一次。',
};
function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'validation_failed') return '有欄位格式不符，請檢查後再送出。';
    return `${error.detail ?? error.message} ${NEXT[error.code ?? ''] ?? '請重新載入後再試一次。'}`;
  }
  return '暫時無法確認回應。請重新載入後再試一次。';
}
type Preview = z.infer<typeof StorePreviewSchema>;
const SupplierConsole = lazy(() => import('../../../../modules/agent-commerce/supplier-console/ui/SupplierConsole').then(m => ({default:m.SupplierConsole})));
const SellerConsole = lazy(() => import('../../../../modules/agent-commerce/seller-console/ui/SellerConsole').then(m => ({default:m.SellerConsole})));
type RegisterLeave = (guard: ((nextHash:string|null) => boolean) | null) => void;
export function HostedStore({client, enabled, appearanceEnabled=false,policiesEnabled=false,galleryEnabled=false,variantsEnabled=false,categoriesEnabled=false, locationHash, userId, registerLeave, photosEnabled=false, photoUploadsEnabled=false, materialMediaEnabled=false, materialUploadsEnabled=false, distributionPhotosEnabled=false, supplyOfferPhotosEnabled=false, consoleEnabled=false, commerceConsoleEnabled=false, checkoutEnabled=false, providerEnvironment='sandbox'}: {galleryEnabled?:boolean;variantsEnabled?:boolean;categoriesEnabled?:boolean;policiesEnabled?:boolean;appearanceEnabled?:boolean;supplyOfferPhotosEnabled?:boolean;distributionPhotosEnabled?:boolean;materialMediaEnabled?:boolean;materialUploadsEnabled?:boolean;commerceConsoleEnabled?:boolean;checkoutEnabled?:boolean;providerEnvironment?:'sandbox'|'live';consoleEnabled?:boolean;client: PortalClient; photosEnabled?:boolean;photoUploadsEnabled?:boolean;enabled: boolean; locationHash: string; userId: string; registerLeave: RegisterLeave}) {
  const consoleRoute = parseSupplierConsoleRoute(locationHash);
  if (consoleEnabled && enabled && consoleRoute) {
    const key = `${userId}:${client.sessionGeneration}:${consoleRoute.tenantId}:${consoleRoute.instanceId}`;
    return <PageLoadBoundary label="供應商營運中心" resetKey={key}><SupplierConsole supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} key={key} client={client} userId={userId} route={consoleRoute} registerLeave={registerLeave} photosEnabled={photosEnabled} photoUploadsEnabled={photoUploadsEnabled} materialMediaEnabled={materialMediaEnabled} materialUploadsEnabled={materialUploadsEnabled}/></PageLoadBoundary>;
  }
  const sellerRoute = parseSellerConsoleRoute(locationHash);
  if (commerceConsoleEnabled && enabled && sellerRoute) {
    const key = `${userId}:${client.sessionGeneration}:${sellerRoute.tenantId}:${sellerRoute.instanceId}`;
    return <PageLoadBoundary label="賣家主控台" resetKey={key}><SellerConsole key={key} client={client} userId={userId} route={sellerRoute} registerLeave={registerLeave} providerEnvironment={providerEnvironment} checkoutEnabled={checkoutEnabled}/></PageLoadBoundary>;
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

type Attempt = {targetMissingIsStore?: boolean; method: 'post' | 'patch'; path: string; body: unknown; version?: string; schema: z.ZodType;
  key: string; success: (value: unknown) => void; notice: string; product?: boolean; fieldError?: (error: ApiError) => void};
function StorePage({supplyOfferPhotosEnabled=false,offerId,cooperation=false,appearanceEnabled=false,policiesEnabled=false,galleryEnabled=false,variantsEnabled=false,categoriesEnabled=false,client, userId,tenantId, instanceId, registerLeave,photosEnabled,photoUploadsEnabled, consoleEnabled=false, commerceConsoleEnabled=false, checkoutEnabled=false, materialMediaEnabled=false, distributionPhotosEnabled=false}: {supplyOfferPhotosEnabled?:boolean;galleryEnabled?:boolean;variantsEnabled?:boolean;categoriesEnabled?:boolean;policiesEnabled?:boolean;appearanceEnabled?:boolean;offerId?:string;cooperation?:boolean;userId:string;photosEnabled:boolean;photoUploadsEnabled:boolean;client: PortalClient; tenantId: string; instanceId: string; registerLeave: RegisterLeave; consoleEnabled?: boolean; commerceConsoleEnabled?: boolean; checkoutEnabled?:boolean; materialMediaEnabled?: boolean;distributionPhotosEnabled?:boolean}) {
  const root = `/tenants/${tenantId}/storefronts/${instanceId}`;
  const [distributionRefresh,setDistributionRefresh]=useState(0);
  const [view, setView] = useState<StoreView | null>(null);
  const [reservationSetting,setReservationSetting] = useState<z.infer<typeof ReservationSettingSchema>|null>(null);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [galleries,setGalleries]=useState<ProductGalleryDraft[]>([]);
  const [media,setMedia]=useState<ProductMediaView[]>([]);
  const [photoBlocks,setPhotoBlocks]=useState<Record<string,boolean>>({});
  const photoBlockRef=useRef<Record<string,boolean>>({});
  const photoBlocking=Object.values(photoBlocks).some(Boolean);
  function photoState(id:string,dirty:boolean,blocking:boolean){
    photoBlockRef.current={...photoBlockRef.current,[id]:blocking};
    setPhotoBlocks(old=>old[id]===blocking?old:{...old,[id]:blocking});markDirty(id==='appearance'?'appearance':id==='policies'?'policies':'photo/'+id,dirty);
  }
  const [preview, setPreview] = useState<Preview | null>(null);
  const [publicationReview, setPublicationReview] = useState<StorePublicationReview | null>(null);
  const [appearance, setAppearance] = useState<StoreAppearance | null>(null);
  const [policiesDraft,setPoliciesDraft]=useState<SellerPoliciesDraft|null>(null),[policiesError,setPoliciesError]=useState(false);
  const [appearanceDraft,setAppearanceDraft]=useState<StorefrontAppearanceDraft|null>(null),[appearanceError,setAppearanceError]=useState(false);
  const [templateChoice, setTemplateChoice] = useState<StoreTemplate | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Attempt | null>(null);
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({});
  const dirtyFormsRef = useRef<Record<string, boolean>>({});
  const hasDraft = Object.values(dirtyForms).some(Boolean);
  const hasFormDraft = Object.entries(dirtyForms).some(([id,dirty])=>dirty&&!id.startsWith('photo/'));
  const dirty = hasDraft || busy || retry !== null || photoBlocking;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const controller = useRef(new AbortController());
  const readGeneration = useRef(0);
  const held = useRef<Attempt | null>(null);
  const busyRef = useRef(false);
  const statusLine = useRef<HTMLParagraphElement>(null);
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
  function leaveOk() {
    if (Object.values(photoBlockRef.current).some(Boolean)) {announce(photoBlockRef.current.policies?'賣方資訊與商店政策操作尚未確認，請先重試原操作。':photoBlockRef.current.appearance?'外觀操作尚未確認，請先重試原操作。':photoBlockRef.current.variants?'規格操作尚未確認，請先重試原操作。':photoBlockRef.current.categories?'暫時無法確認儲存結果，請用原操作重試。':'照片操作尚未確認，請先重試原照片操作。');return false;}
    if (busyRef.current || held.current) {
      announce(busyRef.current ? '正在確認原操作，請等候完成後再離開。' : '尚未確認原操作的結果，請按「重試」確認後再離開。');
      return false;
    }
    return !dirtyRef.current || window.confirm(LEAVE);
  }
  useEffect(() => {
    registerLeave(leaveOk);
    return () => registerLeave(null);
  }, [registerLeave]);
  useEffect(() => {
    controller.current = new AbortController();
    const unloading = (event: BeforeUnloadEvent) => {if (dirtyRef.current || busyRef.current || held.current || Object.values(photoBlockRef.current).some(Boolean)) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', unloading);
    void load();
    return () => {controller.current.abort(); readGeneration.current++; window.removeEventListener('beforeunload', unloading);};
  }, [client, root]);
  async function load(options?: {throwOnError?: boolean}) {
    const signal = controller.current.signal; const ticket = ++readGeneration.current;
    const current = () => !signal.aborted && readGeneration.current === ticket;
    setLoading(true); setPublicationReview(null);
    try {
      const next = StoreViewSchema.parse(await client.get(root, {signal}));
      let photos:ProductMediaView[]=[],galleryDrafts:ProductGalleryDraft[]=[], setting:z.infer<typeof ReservationSettingSchema>|null=null;
      let items: ProductView[] = [], draft: Preview | null = null, presentation: StoreAppearance | null = null, review: StorePublicationReview | null = null;
      let branding:StorefrontAppearanceDraft|null=null,brandingError=false,legal:SellerPoliciesDraft|null=null,legalError=false;
      if (next.setup_state === 'ready') {
        const results = await Promise.all([client.get(root + '/products', {signal}), client.get(root + '/preview', {signal}), client.get(root + '/appearance', {signal}), photosEnabled ? client.get(root+'/product-media',{signal}) : Promise.resolve(null),
          appearanceEnabled?client.get(root+'/appearance-settings',{signal}).then(value=>StorefrontAppearanceDraftSchema.parse(value)).catch(()=>{brandingError=true;return null;}):Promise.resolve(null),
          policiesEnabled?client.get(root+'/seller-policies',{signal}).then(value=>SellerPoliciesDraftSchema.parse(value)).catch(()=>{legalError=true;return null;}):Promise.resolve(null),
          galleryEnabled?client.get(root+'/product-galleries',{signal}).then(value=>ProductGalleriesSchema.parse(value)):Promise.resolve(null),
          next.capabilities.includes('store:publish')?client.get(root+'/publication-review',{signal}):Promise.resolve(null)]);
        items = ProductPageSchema.parse(results[0]).items; draft = StorePreviewSchema.parse(results[1]); presentation = StoreAppearanceSchema.parse(results[2]);
        if(photosEnabled)photos=ProductMediaPageSchema.parse(results[3]).items;
        if(appearanceEnabled)branding=results[4] as StorefrontAppearanceDraft|null;
        if(policiesEnabled)legal=results[5] as SellerPoliciesDraft|null;
        if(galleryEnabled)galleryDrafts=(results[6] as z.infer<typeof ProductGalleriesSchema>).items;
        if(results[7] !== null)review=StorePublicationReviewSchema.parse(results[7]);
        try {setting=ReservationSettingSchema.parse(await client.get(root+'/reservation-setting',{signal}));}
        catch(cause) {if(!(cause instanceof ApiError && [403,404].includes(cause.status))) throw cause;}
      }
      if (!current()) return;
      if(legal||next.setup_state!=='ready')setPoliciesDraft(legal);setPoliciesError(legalError);
      if(branding||next.setup_state!=='ready')setAppearanceDraft(branding);setAppearanceError(brandingError);
      setReservationSetting(setting); setView(next); setDistributionRefresh(n=>n+1); setProducts(items); setMedia(photos);setGalleries(galleryDrafts); setPreview(draft); setAppearance(presentation); setPublicationReview(review); setError('');
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.status === 404 && !Object.values(photoBlockRef.current).some(Boolean)) setMissing(true);
      else setError(errorText(cause));
      if(options?.throwOnError) throw cause;
    } finally {if (current()) setLoading(false);}
  }
  useEffect(() => {if(!appearanceEnabled)markDirty('appearance', templateChoice !== null && templateChoice !== appearance?.template_id);}, [appearanceEnabled,templateChoice, appearance?.template_id]);
  useEffect(() => {
    if (!manualUrl) return;
    manualField.current?.focus();
    manualField.current?.select();
  }, [manualUrl]);
  function markDirty(id: string, value: boolean) {
    dirtyFormsRef.current={...dirtyFormsRef.current,[id]:value};
    setDirtyForms(old => old[id] === value ? old : {...old, [id]: value});
  }
  function announce(text: string) {setStatus(text); requestAnimationFrame(() => statusLine.current?.focus());}
  async function copyLink(url: string) {
    const result = await copyAction.run('copy', () => {setManualUrl(null); setCopyFeedback(null); return navigator.clipboard.writeText(url);});
    if (result.status === 'done') setCopyFeedback({url, message: '已複製連結'});
    else if (result.status === 'failed') {setCopyFeedback({url, message: '無法自動複製，請選取並複製下方內容'}); setManualUrl(url);}
  }
  async function send(attempt: Attempt) {
    if (busyRef.current) return;
    held.current = attempt; busyRef.current = true; setBusy(true); setRetry(null); setError('');
    const signal = controller.current.signal;
    try {
      const raw = await client[attempt.method](attempt.path, attempt.body, {idempotencyKey: attempt.key, ifMatch: attempt.version, signal});
      // An unreadable success may already have committed; retain the same attempt key.
      const parsed = attempt.schema.safeParse(raw);
      if (!parsed.success) throw new ApiError({message: '回應未完整收到，請重試確認原操作。', network: true});
      if (signal.aborted) return;
      held.current = null; attempt.success(parsed.data);
      await load(); if (!signal.aborted) announce(attempt.notice);
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof ApiError && cause.network) {setRetry(attempt); setError('尚未確認原操作的結果，請按「重試」確認。'); return;}
      held.current = null;
      if (cause instanceof ApiError && cause.status === 404 && attempt.targetMissingIsStore!==false) {setMissing(true); return;}
      if (cause instanceof ApiError && attempt.path.endsWith('/publish-reviewed') && (cause.status === 412 || cause.code === 'storefront_publication_changed')) {
        await load(); announce('商品或店面內容已更新，已重新載入。請確認後再按一次上架。');
      } else if (cause instanceof ApiError && cause.status === 412) {
        setEditing(null); setSupplyEditing(null); markDirty('edit', false); markDirty('supply', false); await load();
        announce(attempt.path.endsWith('/appearance') ? '商店資料剛剛被更新，已重新載入。你的版型選擇仍保留，請確認後再儲存。' : attempt.product ? '這件商品剛剛被更新，已重新載入。' : '商店資料剛剛被更新，已重新載入。');
      } else if (cause instanceof ApiError && cause.code === 'storefront_already_set_up') {
        await load(); announce('這間商店已經設定過，已重新載入。');
      } else if (cause instanceof ApiError && ['storefront_slug_taken', 'storefront_slug_reserved', 'validation_failed'].includes(cause.code ?? '') && attempt.fieldError) {
        attempt.fieldError(cause);
      } else setError(errorText(cause));
    } finally {if (!signal.aborted) {busyRef.current = false; setBusy(false);}}
  }
  function command(attempt: Omit<Attempt, 'key'>) {return send({...attempt, key: crypto.randomUUID()});}
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
        <section id="store-products-panel" hidden={area!=='products'} className="hosted-supply-panel stack" aria-labelledby="store-products-title"><h3 id="store-products-title">商品</h3>
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
        </section>
        <div id="store-cooperation-panel" className="hosted-supply-panel" hidden={area!=='cooperation'}>{view.capabilities.includes('store:write') ? <HostedDistribution supplyOfferPhotosEnabled={supplyOfferPhotosEnabled} client={client} root={root} refresh={distributionRefresh} busy={areaLocked} writable={can('store:write')} onDirty={(id,value)=>markDirty('distribution/'+id,value)} onCommand={command} onReload={() => leaveOk() ? load() : Promise.resolve()}/>
          : <p>你沒有供貨合作的管理權限，仍可查看商品與店面資料。</p>}
          {consoleEnabled&&<PartnerMaterials client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} active={area==='cooperation'} refresh={distributionRefresh} mediaEnabled={materialMediaEnabled} distributionPhotosEnabled={distributionPhotosEnabled} writable={can('store:write')} busy={areaLocked} onCommand={command}/>}
        </div>
        <section id="store-publish-panel" hidden={area!=='publish'} className="hosted-supply-panel stack" aria-labelledby="store-publish-title"><h3 id="store-publish-title">預覽與發布</h3>
          <p>{publication?.state === 'published' ? `目前公開第 ${publication.current_revision} 版。` : publication?.state === 'unpublished' ? '已停止公開。' : '尚未發布。'}</p>
          {publication?.state === 'published' && preview?.dirty && <p>有尚未發布的變更。</p>}
          {!appearanceEnabled && appearance && <fieldset disabled={areaLocked || !can('store:manage')} className="hosted-store-templates">
            <legend>商店版型</legend>
            {([['catalog-grid-v1', '格狀目錄', '商品並排展示，手機改為單欄。'], ['catalog-list-v1', '直列目錄', '商品逐項排列，方便閱讀較長說明。']] as const).map(([id, label, hint]) => <label key={id}>
              <input type="radio" name="store-template" value={id} checked={(templateChoice ?? appearance.template_id) === id} onChange={() => {setTemplateChoice(id); markDirty('appearance', id !== appearance.template_id);}}/>
              <span>{label}<small>{hint}</small></span>
            </label>)}
          </fieldset>}
          {!appearanceEnabled && appearance && can('store:manage') && <div className="actions"><button type="button" className="btn btn-ghost" disabled={areaLocked || !templateChoice || templateChoice === appearance.template_id} onClick={() => void command({method: 'patch', path: root + '/appearance', body: {template_id: templateChoice}, version: appearance.version, schema: StoreAppearanceSchema, notice: '已儲存版型。重新發布後，公開頁才會更新。', success: () => {setTemplateChoice(null); markDirty('appearance', false);}})}>儲存版型</button></div>}
          {appearanceEnabled&&<>
            {appearanceError&&<div><p role="alert">店面外觀暫時無法讀取。請重試。</p><div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={loading||locked} onClick={()=>void load()}>重新讀取店面外觀</button></div></div>}
            {appearanceDraft?<HostedStoreAppearance client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} draft={appearanceDraft} writable={can('store:manage')}
              locked={busy||retry!==null||!!otherDraft||appearanceError||Object.entries(photoBlocks).some(([id,blocking])=>id!=='appearance'&&blocking)}
              onState={(dirty,blocking)=>photoState('appearance',dirty,blocking)} onSaved={load}/>:!appearanceError&&<p role="status">正在讀取店面外觀…</p>}
          </>}
          {preview && <div className="actions"><a href={`/api/v1${root}/preview-page`} target="_blank" rel="noopener">預覽已儲存的展示頁</a></div>}
          {dirtyForms.appearance && <p className="field-hint">{appearanceEnabled?'請先儲存店面外觀，再開啟預覽；公開頁會保留目前發布的版本。':'請先儲存版型，再開啟預覽；公開頁會保留目前發布的版本。'}</p>}
          {can('store:publish') && publicationReview && <PublicationReview review={publicationReview}/>}
          {can('store:publish') && <div className="actions">
            {(publication?.state !== 'published' || preview?.dirty) && <button type="button" className={publicationReview?.preview.projection.products.length ? 'btn btn-primary' : 'btn btn-ghost'} disabled={publishDisabled} onClick={publishSaved}>{publication?.state === 'published' ? '發布更新' : '發布展示頁'}</button>}
            {publication?.state === 'published' && <button type="button" className="btn btn-ghost" disabled={areaLocked || hasDraft} onClick={() => {if (window.confirm(`停止公開後，/shops/${store.slug} 會顯示找不到這間商店。`)) void command({method: 'post', path: root + '/unpublish', body: {}, version: view.version!, schema: StoreViewSchema, notice: '已停止公開。', success: () => {}});}}>停止公開</button>}
          </div>}
          {can('store:publish') && hasDraft && <p className="field-hint">還有尚未儲存的內容。請先儲存商店資料與商品，再發布或停止公開。</p>}
          {can('store:publish') && !preview?.projection.products.length && <p className="field-hint">至少上架一件商品才能發布。</p>}
          {publicPath && storeCopyUrl && <div className="actions"><a href={publicPath} target="_blank" rel="noopener">查看公開頁：{publicPath}</a><button type="button" className="btn btn-ghost" aria-busy={copyAction.pending !== null} onClick={() => void copyLink(storeCopyUrl)}>複製商店連結</button></div>}
          {copyFeedback && storeCopyUrl && copyFeedback.url === storeCopyUrl && <p className="field-hint" role="status">{copyFeedback.message}</p>}
          {manualUrl !== null && manualUrl === storeCopyUrl && <ManualCopy url={manualUrl} fieldRef={manualField}/>}
          {store.slug_locked && <p className="field-hint">網址已固定。</p>}
        </section>
        <section id="store-settings-panel" hidden={area!=='settings'} className="hosted-supply-panel stack" aria-labelledby="store-settings-title"><h3 id="store-settings-title">商店資料</h3>
          {can('store:manage') ? <SettingsForm key={view.version} client={client} root={root} store={store} busy={areaLocked||dirtyForms.policies===true} onMissing={() => setMissing(true)} onDirty={value => markDirty('settings', value)} onSave={(body, success, fieldError) => command({method: 'patch', path: root, body, version: view.version!, schema: StoreViewSchema, notice: `已儲存。${publication?.state === 'published' ? '重新發布後，公開頁才會更新。' : ''}`, success, fieldError})}/>
            : <dl className="detail-list"><div><dt>商店名稱</dt><dd>{store.name}</dd></div><div><dt>品牌</dt><dd>{store.brand ?? '未填寫'}</dd></div><div><dt>商店介紹</dt><dd>{store.description}</dd></div><div><dt>商店網址</dt><dd>/shops/{store.slug}</dd></div><div><dt>幣別</dt><dd>{currencyLabel(store.currency)}</dd></div></dl>}
          {policiesEnabled&&<>
            {policiesError&&<div><p role="alert">賣方資訊與商店政策暫時無法讀取。請重試。</p><div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={loading||locked} onClick={()=>void load()}>重新讀取賣方資訊與商店政策</button></div></div>}
            {policiesDraft?<HostedStorePolicies client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} draft={policiesDraft} writable={can('store:manage')}
              locked={busy||retry!==null||!!otherDraft||policiesError||dirtyForms.settings===true||Object.entries(photoBlocks).some(([id,blocking])=>id!=='policies'&&blocking)}
              onState={(dirty,blocking)=>photoState('policies',dirty,blocking)} onSaved={load}/>:!policiesError&&<p role="status">正在讀取賣方資訊與商店政策…</p>}
          </>}
        </section>
      </>}
    </>}
  </div>;
}
const currencyLabel = (currency: string) => currency === 'TWD' ? '新臺幣 TWD' : '美元 USD';

function PublicationReview({review}:{review:StorePublicationReview}) {
  const projection=review.preview.projection;

  return <div className="hosted-store-publication-review">
    <p>本次會公開全部 {projection.products.length} 件商品、{review.photo_count} 張已儲存照片，以及店面更新。</p>
    <details><summary>查看本次上架內容</summary>
      <dl className="detail-list"><div><dt>商店</dt><dd>{projection.name}</dd></div><div><dt>品牌</dt><dd>{projection.brand || '未填寫'}</dd></div>
        <div><dt>網址</dt><dd>/shops/{projection.slug}</dd></div><div><dt>商店介紹</dt><dd>{projection.description || '未填寫'}</dd></div>
        <div><dt>版型</dt><dd>{review.template_id==='catalog-grid-v1'?'格狀目錄':'直列目錄'}</dd></div>
        {([['appearance_changed','店面外觀'],['policies_changed','賣方資訊與商店政策'],['gallery_changed','商品圖組'],['variants_changed','規格'],['categories_changed','商品分類']] as const).map(([key,label])=>review[key]===undefined?null:<div key={key}><dt>{label}</dt><dd>{review[key]?'有尚未發布的變更':'與上次發布相同'}</dd></div>)}</dl>
      <ul>{projection.products.map(product=>{const photos=review.photos.filter(item=>item.sku===product.sku);return <li key={product.sku}><strong>{product.title}</strong> · {formatMinor(product.price_minor,projection.currency)}
        {photos.map(({photo},index)=><img key={photo.read_path} src={photo.read_path} alt={`${product.title} 本次上架照片${review.gallery_changed===undefined?'':` ${index+1}`}`} width={photo.width} height={photo.height}/>)}
        {product.description && <p>{product.description}</p>}</li>;})}</ul>
    </details>
  </div>;
}

function SettingsForm({client, root, store, busy, onMissing, onDirty, onSave}: {
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
