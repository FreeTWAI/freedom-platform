import {useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import {ApiError, type PortalClient} from '../api';
import {StoreViewSchema, MerchantProductPageSchema as ProductPageSchema, StorePreviewSchema,
  type StoreView, type MerchantProductView as ProductView} from '../../../../contracts/guild-launchpad/v1/storefront';
import {ReservationSettingSchema} from '../../../../contracts/guild-launchpad/v1/hosted-shared-order';
import {ProductGalleriesSchema, type ProductGalleryDraft} from '../../../../contracts/guild-launchpad/v1/storefront-gallery';
import {ProductMediaPageSchema, type ProductMediaView} from '../../../../contracts/guild-launchpad/v1/hosted-store-media';
import {StoreAppearanceSchema, type StoreAppearance, type StoreTemplate} from '../../../../contracts/guild-launchpad/v1/storefront-presentation';
import {StorePublicationReviewSchema, type StorePublicationReview} from '../../../../contracts/guild-launchpad/v1/storefront-publication';
import {SellerPoliciesDraftSchema, type SellerPoliciesDraft} from '../../../../contracts/guild-launchpad/v1/storefront-policies';
import {StorefrontAppearanceDraftSchema, type StorefrontAppearanceDraft} from '../../../../contracts/guild-launchpad/v1/storefront-appearance';

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
export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'validation_failed') return '有欄位格式不符，請檢查後再送出。';
    return `${error.detail ?? error.message} ${NEXT[error.code ?? ''] ?? '請重新載入後再試一次。'}`;
  }
  return '暫時無法確認回應。請重新載入後再試一次。';
}
type Preview = z.infer<typeof StorePreviewSchema>;
export type StorePageAttempt = {targetMissingIsStore?: boolean; method: 'post' | 'patch'; path: string; body: unknown; version?: string; schema: z.ZodType;
  key: string; success: (value: unknown) => void; notice: string; product?: boolean; fieldError?: (error: ApiError) => void};
export function useStorePageData({client, root, photosEnabled, appearanceEnabled, policiesEnabled, galleryEnabled, onConflict}: {
  client: PortalClient; root: string; photosEnabled: boolean; appearanceEnabled: boolean; policiesEnabled: boolean; galleryEnabled: boolean; onConflict: () => void;
}) {
  const [distributionRefresh,setDistributionRefresh]=useState(0);
  const [view, setView] = useState<StoreView | null>(null);
  const [reservationSetting,setReservationSetting] = useState<z.infer<typeof ReservationSettingSchema>|null>(null);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [galleries,setGalleries]=useState<ProductGalleryDraft[]>([]);
  const [media,setMedia]=useState<ProductMediaView[]>([]);
  const [photoBlocks,setPhotoBlocks]=useState<Record<string,boolean>>({});
  const photoBlockRef=useRef<Record<string,boolean>>({});
  const photoBlocking=Object.values(photoBlocks).some(Boolean);
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
  const [retry, setRetry] = useState<StorePageAttempt | null>(null);
  const controller = useRef(new AbortController());
  const readGeneration = useRef(0);
  const held = useRef<StorePageAttempt | null>(null);
  const busyRef = useRef(false);
  const statusLine = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    void load();
    return () => {controller.current.abort(); readGeneration.current++;};
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
  function setPhotoBlocking(id: string, blocking: boolean) {
    photoBlockRef.current={...photoBlockRef.current,[id]:blocking};
    setPhotoBlocks(old=>old[id]===blocking?old:{...old,[id]:blocking});
  }
  function announce(text: string) {setStatus(text); requestAnimationFrame(() => statusLine.current?.focus());}
  async function send(attempt: StorePageAttempt) {
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
        onConflict(); await load();
        announce(attempt.path.endsWith('/appearance') ? '商店資料剛剛被更新，已重新載入。你的版型選擇仍保留，請確認後再儲存。' : attempt.product ? '這件商品剛剛被更新，已重新載入。' : '商店資料剛剛被更新，已重新載入。');
      } else if (cause instanceof ApiError && cause.code === 'storefront_already_set_up') {
        await load(); announce('這間商店已經設定過，已重新載入。');
      } else if (cause instanceof ApiError && ['storefront_slug_taken', 'storefront_slug_reserved', 'validation_failed'].includes(cause.code ?? '') && attempt.fieldError) {
        attempt.fieldError(cause);
      } else setError(errorText(cause));
    } finally {if (!signal.aborted) {busyRef.current = false; setBusy(false);}}
  }
  function command(attempt: Omit<StorePageAttempt, 'key'>) {return send({...attempt, key: crypto.randomUUID()});}
  return {distributionRefresh, view, reservationSetting, products, galleries, media, photoBlocks, photoBlockRef, photoBlocking, setPhotoBlocking,
    preview, publicationReview, appearance, policiesDraft, policiesError, appearanceDraft, appearanceError, templateChoice, setTemplateChoice,
    missing, setMissing, error, status, loading, busy, retry, busyRef, held, statusLine, load, announce, send, command};
}
