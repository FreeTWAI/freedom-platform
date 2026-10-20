import {useEffect,useId,useRef,useState} from 'react';
import type {ProductView} from '../../../../contracts/guild-launchpad/v1/storefront';
import {normalizeGalleryAlt,type ProductGalleryDraft} from '../../../../contracts/guild-launchpad/v1/storefront-gallery';
import {socialImageProblem} from '../../../../packages/asset-storage/browser-raster';
import {ApiError,type PortalClient} from '../api';
import {prepareProductPhotoFile,sendGalleryPhoto} from './hosted-store-photo-client';
import {holdPhotoAttempt,heldPhotoAttempt,restorePhotoAttempt,releasePhotoAttempt,forgetRefusedPhotoAttempt,retainedPhotoFailure,reviewPhotoAttempt,photoBlocksLeaving,type GalleryPhotoAttempt} from './hosted-store-photo-state';
import './HostedStoreGallery.css';

export function HostedStoreGallery({client,userId,tenantId,instanceId,product,gallery,writable,locked,onState,onSaved}:{
 client:PortalClient;userId:string;tenantId:string;instanceId:string;product:Pick<ProductView,'product_id'|'title'|'version'>;
 gallery?:ProductGalleryDraft;writable:boolean;locked:boolean;onState:(dirty:boolean,blocking:boolean)=>void;onSaved:()=>Promise<void>;
}){
 const placement={tenantId,instanceId,productId:product.product_id,gallery:true as const};
 const [restored]=useState(()=>restorePhotoAttempt<GalleryPhotoAttempt>(client,userId,placement));
 const [attempt,setAttempt]=useState<GalleryPhotoAttempt|null>(restored),[file,setFile]=useState<File|null>(restored?.file??null);
 const [phase,setPhase]=useState<'idle'|'sending'|'unknown'|'review'|'rejected'>(restored?'unknown':'idle');
 const [message,setMessage]=useState(restored?'原照片操作仍待確認。重新登入不會自動重送，請按重試原照片操作。':'');
 const [alts,setAlts]=useState<Record<string,string>>(()=>restored?.action==='describe'&&restored.photoKey?{[restored.photoKey]:JSON.parse(restored.body).alt_text}:{});
 const [preparing,setPreparing]=useState(false),[previewUrl,setPreviewUrl]=useState(''),[failed,setFailed]=useState<Record<string,boolean>>({});
 const mounted=useRef(false),serial=useRef(0),session=useRef(client.sessionGeneration),busy=useRef(false),held=useRef<GalleryPhotoAttempt|null>(restored);
 const picker=useRef<HTMLInputElement>(null),id=useId(),state=useRef(onState);state.current=onState;
 const photos=gallery?.photos??[],retained=gallery?.retained_secondary_photos??[],rows=photos.length?photos:retained;
 const altDirty=rows.some(p=>alts[p.photo_key]!==undefined&&alts[p.photo_key]!==p.alt_text);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;};},[]);
 useEffect(()=>{state.current(Boolean(file||attempt||preparing||altDirty),photoBlocksLeaving(attempt,phase==='sending'));},[file,attempt,preparing,altDirty,phase]);
 useEffect(()=>()=>state.current(false,false),[]);
 useEffect(()=>{setPreviewUrl('');if(!file)return;let current=true,url='';void file.arrayBuffer().then(bytes=>{if(!current)return;url=URL.createObjectURL(new Blob([bytes],{type:file.type}));setPreviewUrl(url);},()=>{if(current)setMessage('預覽暫時無法讀取，請重新選擇照片。');});return()=>{current=false;if(url)URL.revokeObjectURL(url);};},[file]);
 const blocked=locked||preparing||phase==='sending'||phase==='unknown';
 const unavailable=!gallery||!gallery.media_installed;
 async function choose(selected:File){
  if(busy.current||held.current?.hadUnknown)return;
  const error=socialImageProblem(selected);if(error){setMessage(error);if(picker.current)picker.current.value='';return;}
  const ticket=++serial.current;setPreparing(true);setMessage('正在裝置上準備照片…');
  try{const next=await prepareProductPhotoFile(selected);if(!mounted.current||serial.current!==ticket||session.current!==client.sessionGeneration)return;setFile(next);setAttempt(null);held.current=null;setPhase('idle');setMessage('照片準備好了。按「儲存照片」後才會上傳。');}
  catch(e){if(mounted.current&&serial.current===ticket&&session.current===client.sessionGeneration)setMessage(e instanceof Error?e.message:'照片未完成，請重新選擇。');}
  finally{if(mounted.current&&serial.current===ticket){setPreparing(false);if(picker.current)picker.current.value='';}}
 }
 async function send(value:GalleryPhotoAttempt){
  if(busy.current)return;busy.current=true;held.current=value;setAttempt(value);setPhase('sending');state.current(true,true);setMessage('正在儲存商品照片…');holdPhotoAttempt(client,userId,value);
  try{
   const ack=await sendGalleryPhoto(client,value);releasePhotoAttempt(client,userId,value);held.current=null;setAttempt(null);setPhase('idle');
   if(value.action==='upload'){setFile(null);if(picker.current)picker.current.value='';}
   if(value.action==='describe'&&value.photoKey)setAlts(old=>{const next={...old};delete next[value.photoKey!];return next;});
   setMessage(ack.changed?'已儲存照片變更。重新發布後，公開頁才會更新。':'照片沒有變更。');await onSaved();
  }catch(e){
   const unknown=!(e instanceof ApiError)||e.network||e.timedOut||e.accessExpired;
   const pending=retainedPhotoFailure(value,unknown||heldPhotoAttempt<GalleryPhotoAttempt>(client,userId,value)?.hadUnknown===true);
   if(pending.hadUnknown)holdPhotoAttempt(client,userId,pending);else forgetRefusedPhotoAttempt(client,userId,value);
   held.current=pending;setAttempt(pending);
   if(pending.hadUnknown){setPhase('unknown');setMessage('尚未確認原操作結果。照片與原操作仍保留，請重試確認後再離開。');}
   else if(e instanceof ApiError&&e.status===412){setPhase('review');setMessage('商品已更新，照片仍保留。請核對最新商品後，再明確確認套用。');await onSaved();}
   else{setPhase('rejected');setMessage(e instanceof ApiError?e.message:'照片操作未完成。');}
  }finally{busy.current=false;}
 }
 function fresh(action:GalleryPhotoAttempt['action'],photoKey:string|null,body:object={}){
  if(blocked||!writable||busy.current||held.current?.hadUnknown||!gallery)return;
  if(action==='upload'&&(!file||!gallery.uploads_enabled))return;
  try{
   const normalized=action==='describe'?{alt_text:normalizeGalleryAlt((body as {alt_text:string}).alt_text)}:body;
   void send(Object.freeze({...placement,expected:product.version,key:crypto.randomUUID(),action,photoKey,body:JSON.stringify(normalized),file:action==='upload'?file:null,hadUnknown:false}));
  }catch{setMessage('照片說明請使用有效的單行文字，最多 120 字。');}
 }
 function reorder(from:number,to:number){const keys=rows.map(p=>p.photo_key),[key]=keys.splice(from,1);keys.splice(to,0,key);fresh('reorder',null,{photo_keys:keys});}
 function cancel(){serial.current++;setPreparing(false);setFile(null);setAttempt(null);held.current=null;setAlts({});setPhase('idle');if(picker.current)picker.current.value='';setMessage('已取消這次照片變更。');}
 return <section className="hosted-gallery stack" aria-label="商品照片">
  <div className="hosted-gallery-heading"><h5>商品照片</h5><span>{photos.length} / 8 張</span></div>
  <p className="field-hint">第一張是主照片，用於商品卡片與分享連結。照片與說明需重新發布後，公開頁才會更新。</p>
  {!gallery?<p role="status">商品照片暫時無法讀取，請重新整理商店。</p>:unavailable?<p className="field-hint">商品照片目前無法讀取。</p>:rows.length===0?<p className="field-hint">尚未加入商品照片。</p>:<>
   {retained.length>0&&<p className="banner" role="status">主照片已移除，請先設為主照片或移除保留的照片。</p>}
   <ol className="hosted-gallery-list">{rows.map((photo,n)=><li key={photo.photo_key}>
    {failed[photo.read_path]?<p className="field-hint">照片暫時無法讀取。</p>:<img src={photo.read_path} alt={photo.alt_text||(retained.length?`${product.title}，保留的照片`:`${product.title}，第 ${photo.position} 張，共 ${photos.length} 張`)} width={photo.width} height={photo.height} loading={n===0?'eager':'lazy'} onError={()=>setFailed(old=>({...old,[photo.read_path]:true}))}/>}
    <div className="hosted-gallery-copy"><p className="hosted-gallery-position">{photo.photo_key==='main'?'主照片':retained.length?'保留的照片':`第 ${n+1} 張`}</p>
     {writable&&!retained.length?<><label>照片說明<input value={alts[photo.photo_key]??photo.alt_text} disabled={blocked} aria-describedby={id+'-alt'} onChange={event=>setAlts(old=>({...old,[photo.photo_key]:event.target.value}))}/></label>
      <div className="actions"><button type="button" className="btn btn-ghost btn-small" disabled={blocked||(alts[photo.photo_key]??photo.alt_text)===photo.alt_text} onClick={()=>fresh('describe',photo.photo_key,{alt_text:alts[photo.photo_key]??photo.alt_text})}>儲存說明</button>
       <button type="button" className="btn btn-ghost btn-small" disabled={blocked||altDirty||n===0} onClick={()=>reorder(n,n-1)}>上移</button>
       <button type="button" className="btn btn-ghost btn-small" disabled={blocked||altDirty||n===rows.length-1} onClick={()=>reorder(n,n+1)}>下移</button>
       {n>0&&<button type="button" className="btn btn-ghost btn-small" disabled={blocked||altDirty} onClick={()=>reorder(n,0)}>設為主照片</button>}
       <button type="button" className="btn btn-ghost btn-small" disabled={blocked||altDirty} onClick={()=>fresh('remove',photo.photo_key)}>移除</button></div></>
      :writable?<div className="actions"><button type="button" className="btn btn-ghost btn-small" disabled={blocked} onClick={()=>reorder(n,0)}>設為主照片</button><button type="button" className="btn btn-ghost btn-small" disabled={blocked} onClick={()=>fresh('remove',photo.photo_key)}>移除</button></div>
       :photo.alt_text&&<p>{photo.alt_text}</p>}
    </div></li>)}</ol>
  </>}
  {writable&&gallery?.media_installed&&<>
   {!retained.length&&gallery.uploads_enabled&&(photos.length<8?<><label htmlFor={id}>新增商品照片<input id={id} ref={picker} type="file" accept="image/png,image/jpeg,image/webp" disabled={blocked||altDirty} aria-describedby={id+'-hint'} onChange={event=>{const next=event.target.files?.[0];if(next)void choose(next);}}/></label><p id={id+'-hint'} className="field-hint">PNG、JPEG 或 WebP，原始照片最多 20 MB；大照片會在裝置上自動縮小。先看完整預覽，再儲存；公開頁需重新發布。</p></>:<p className="field-hint">已達 8 張照片上限，移除後才能新增。</p>)}
   <p id={id+'-alt'} className="field-hint">照片說明為選填，最多 120 字。留空時使用商品名稱與照片次序。{altDirty?'請先儲存或取消照片說明，再調整順序。':''}</p>
   {!gallery.uploads_enabled&&!retained.length&&photos.length<8&&<p className="field-hint">商品照片上傳目前無法使用。</p>}
   {file&&<p className="field-hint">已選擇：{file.name}</p>}
   {file&&previewUrl&&<figure className="hosted-photo-draft"><img src={previewUrl} alt="待儲存的完整商品照片"/><figcaption>裝置上的預覽・{(file.size/1024/1024).toFixed(2)} MB・{phase==='unknown'?'儲存結果尚未確認':phase==='sending'?'正在儲存':'尚未套用到商品'}</figcaption></figure>}
   <div className="actions">{file&&phase!=='unknown'&&phase!=='review'&&gallery.uploads_enabled&&<button type="button" className="btn btn-ghost btn-small" disabled={blocked||altDirty} onClick={()=>fresh('upload',crypto.randomUUID())}>儲存照片</button>}
    {phase==='review'&&<button type="button" className="btn btn-ghost btn-small" disabled={locked||!attempt||(attempt.action==='upload'&&!gallery.uploads_enabled)} onClick={()=>attempt&&void send(reviewPhotoAttempt(attempt,product.version,crypto.randomUUID()))}>確認以最新商品套用照片變更</button>}
    {(file||attempt||preparing||altDirty)&&phase!=='unknown'&&phase!=='sending'&&<button type="button" className="btn btn-ghost btn-small" disabled={locked} onClick={cancel}>取消照片變更</button>}
   </div>
  </>}
  {phase==='unknown'&&attempt&&<div className="actions"><button type="button" className="btn btn-ghost btn-small" onClick={()=>void send(attempt)}>重試原照片操作</button></div>}
  {message&&<p role="status" className="field-hint">{message}</p>}
 </section>;
}
