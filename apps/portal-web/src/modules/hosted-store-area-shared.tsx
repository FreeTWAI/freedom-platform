import type {RefObject} from 'react';
import type {StoreView} from '../../../../contracts/guild-launchpad/v1/storefront';
import type {StorePublicationReview} from '../../../../contracts/guild-launchpad/v1/storefront-publication';
import type {useStorePageData} from './hosted-store-page-state';
import {formatMinor} from '../format';

// Area props reuse the hook's value types; state and write ownership stay in StorePage.
export type StoreAreaData = ReturnType<typeof useStorePageData>;
export type StoreArea = 'products' | 'cooperation' | 'publish' | 'settings';
export type StoreAreaStore = NonNullable<StoreView['store']>;
export const currencyLabel = (currency: string) => currency === 'TWD' ? '新臺幣 TWD' : '美元 USD';

export function ManualCopy({url, fieldRef}: {url: string; fieldRef: RefObject<HTMLInputElement | null>}) {
  return <label className="field">手動複製連結<input ref={fieldRef} readOnly value={url} onFocus={event => event.currentTarget.select()}/></label>;
}

export function PublicationReview({review}:{review:StorePublicationReview}) {
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
