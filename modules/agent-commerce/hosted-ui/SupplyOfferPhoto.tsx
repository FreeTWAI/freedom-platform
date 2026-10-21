import {useState} from 'react';
import './SupplyOffer.css';

export function SupplyOfferPhoto({photo,title,measureIntrinsic=false,thumbnail=false,onUnavailable}:{photo:{read_path:string;width:number;height:number}|null;title:string;measureIntrinsic?:boolean;thumbnail?:boolean;onUnavailable?:()=>void}) {
  const [failedPath,setFailedPath]=useState<string|null>(null);
  const [intrinsic,setIntrinsic]=useState<{path:string;width:number;height:number}|null>(null);
  const dimensions=measureIntrinsic&&intrinsic?.path===photo?.read_path?intrinsic:photo;
  if(thumbnail)return photo&&failedPath!==photo.read_path
    ? <img className="supply-offer-thumbnail" src={photo.read_path} width={photo.width} height={photo.height} loading="lazy" decoding="async" alt={`${title}，供應商提供的商品照片`} onError={()=>{setFailedPath(photo.read_path);onUnavailable?.();}}/>
    : null;
  return <figure className="supply-offer-photo stack" aria-label="方案照片">
    {photo&&failedPath!==photo.read_path
      ? <img src={photo.read_path} width={dimensions!.width} height={dimensions!.height} loading="lazy" alt={`${title}，供應商提供的商品照片`} onLoad={event=>{if(measureIntrinsic)setIntrinsic({path:photo.read_path,width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight});}} onError={()=>setFailedPath(photo.read_path)}/>
      : <p className="field-hint">照片暫時無法顯示</p>}
    <figcaption className="field-hint">供應商提供的商品照片，只供評估，不屬於供貨條件。</figcaption>
  </figure>;
}
