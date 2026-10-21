import {useEffect,useId,useRef,useState} from 'react';
import type {ProductView} from '../../../../contracts/guild-launchpad/v1/storefront';
import type {ProductMediaView} from '../../../../contracts/guild-launchpad/v1/hosted-store-media';
import {ApiError,type PortalClient} from '../api';
import {sendProductPhoto,productPhotoFileError,prepareProductPhotoFile} from './hosted-store-photo-client';
import {retainedPhotoFailure,reviewPhotoAttempt,holdPhotoAttempt,heldPhotoAttempt,restorePhotoAttempt,releasePhotoAttempt,forgetRefusedPhotoAttempt,photoBlocksLeaving,type PhotoAttempt} from './hosted-store-photo-state';
import {socialImageProblem} from '../../../../packages/asset-storage/browser-raster';

interface HostedStorePhotoProps {
  client:PortalClient;userId:string;tenantId:string;instanceId:string;product:Pick<ProductView,'product_id'|'title'|'version'>;media?:ProductMediaView;writable:boolean;uploadsEnabled:boolean;locked:boolean;
  onState:(dirty:boolean,blocking:boolean)=>void;onSaved:()=>Promise<void>;
}
export function HostedStorePhoto(props:HostedStorePhotoProps){
  // An old selection/response must never become the next product or member's draft.
  return <PhotoEditor key={JSON.stringify([props.userId,props.tenantId,props.instanceId,props.product.product_id,props.client.sessionGeneration])} {...props}/>;
}
function PhotoEditor({client,userId,tenantId,instanceId,product,media,writable,uploadsEnabled,locked,onState,onSaved}:HostedStorePhotoProps){
  const [restored]=useState(()=>restorePhotoAttempt(client,userId,{tenantId,instanceId,productId:product.product_id}));
  const [file,setFile]=useState<File|null>(restored?.file??null),[attempt,setAttempt]=useState<PhotoAttempt|null>(restored);
  const [phase,setPhase]=useState<'idle'|'sending'|'unknown'|'review'|'rejected'|'refreshing'|'refresh_failed'>(restored?'unknown':'idle');
  const [message,setMessage]=useState(restored?'原照片操作仍待確認。重新登入不會自動重送，請按重試原照片操作。':''),[failedPath,setFailedPath]=useState('');
  const id=useId(),input=useRef<HTMLInputElement>(null),busy=useRef(false),held=useRef<PhotoAttempt|null>(restored);
  const [preparing,setPreparing]=useState(false),[previewUrl,setPreviewUrl]=useState('');
  const preparation=useRef(0),mounted=useRef(false),session=useRef(client.sessionGeneration),savedNotice=useRef('');
  const permissions=useRef({writable,uploadsEnabled});permissions.current={writable,uploadsEnabled};
  const current=()=>mounted.current&&session.current===client.sessionGeneration;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;preparation.current++;};},[]);
  useEffect(()=>{
    setPreviewUrl('');if(!file)return;let current=true,url='';
    // Preserve the original upload File while previewing only a fixed raster MIME.
    void file.arrayBuffer().then(bytes=>{if(!current)return;const mime=file.type==='image/png'?'image/png':file.type==='image/webp'?'image/webp':'image/jpeg';url=URL.createObjectURL(new Blob([bytes],{type:mime}));setPreviewUrl(url);},()=>{if(current)setMessage('預覽暫時無法讀取，請重新選擇照片。');});
    return()=>{current=false;if(url)URL.revokeObjectURL(url);};
  },[file]);
  const stateRef=useRef(onState);stateRef.current=onState;
  useEffect(()=>{stateRef.current(Boolean(file||attempt||preparing||phase==='refreshing'||phase==='refresh_failed'),photoBlocksLeaving(attempt,phase==='sending'||preparing||phase==='refreshing'));},[file,attempt,phase,preparing]);
  useEffect(()=>()=>stateRef.current(false,false),[]);
  function clear(){setFile(null);setAttempt(null);held.current=null;setPhase('idle');if(input.current)input.current.value='';}
  async function choose(selected:File){
    if(!current()||locked||!writable||!uploadsEnabled||held.current?.hadUnknown||busy.current)return;
    const error=socialImageProblem(selected);if(error){setMessage(error);if(input.current)input.current.value='';return;}
    const serial=++preparation.current,expected=product.version;setPreparing(true);onState(true,true);setMessage('正在裝置上準備照片…');
    try{const prepared=await prepareProductPhotoFile(selected);
      if(!current()||serial!==preparation.current)return;
      if(!permissions.current.writable||!permissions.current.uploadsEnabled){setMessage('目前無法儲存照片，請確認權限與上傳狀態後重新選擇。');return;}
      const invalid=productPhotoFileError(prepared);if(invalid)throw new Error(invalid);
      setFile(prepared);setAttempt(null);held.current=null;setPreparing(false);
      await send(Object.freeze({tenantId,instanceId,productId:product.product_id,expected,key:crypto.randomUUID(),file:prepared,action:'upload',hadUnknown:false}));
    }catch(error){if(current()&&serial===preparation.current)setMessage(error instanceof Error?error.message:'照片未完成，請重新選擇。');}
    finally{if(current()&&serial===preparation.current){setPreparing(false);if(input.current)input.current.value='';}}
  }
  async function refreshSaved(){
    if(!current())return;
    setPhase('refreshing');onState(true,true);
    try{await onSaved();if(current()){setPhase('idle');setMessage(savedNotice.current);}}
    catch{if(current()){setPhase('refresh_failed');setMessage('照片變更已儲存，但最新商品資料未完整讀取。請重新讀取，不必再次上傳。');}}
  }
  async function send(value:PhotoAttempt){
    if(!current()||busy.current)return;busy.current=true;held.current=value;setAttempt(value);setPhase('sending');onState(true,true);setMessage('正在上傳並儲存商品照片…');
    holdPhotoAttempt(client,userId,value);
    let saved=false;
    try{
      const ack=await sendProductPhoto(client,value);releasePhotoAttempt(client,userId,value);saved=true;
      if(!current())return;
      clear();savedNotice.current=ack.changed?'已儲存照片變更。重新發布後，公開頁才會更新。':'這項商品已經沒有草稿照片。';setMessage(savedNotice.current);
    }catch(error){
      const unknown=!(error instanceof ApiError)||error.network||error.timedOut||error.accessExpired;
      const retained=retainedPhotoFailure(value,unknown||heldPhotoAttempt(client,userId,value)?.hadUnknown===true);
      if(retained.hadUnknown)holdPhotoAttempt(client,userId,retained);else forgetRefusedPhotoAttempt(client,userId,value);
      if(!current())return;
      held.current=retained;setAttempt(retained);
      if(retained.hadUnknown){setPhase('unknown');setMessage('尚未確認原操作結果。照片與原操作仍保留，請重試確認後再離開。');}
      else if(error instanceof ApiError&&error.status===412){setPhase('review');setMessage('商品已更新，照片仍保留。請核對最新商品後，再明確確認套用。');try{await onSaved();}catch{if(current())setMessage('商品已更新，但最新資料未完整讀取。照片仍保留，請先重新整理商品資料後再核對。');}}
      else {setPhase('rejected');setMessage(error instanceof ApiError?error.message:'照片操作未完成。');}
    }finally{busy.current=false;}
    // An acknowledged write stays acknowledged even if its following read fails.
    if(saved&&current())await refreshSaved();
  }
  function remove(){
    if(locked||!writable||busy.current||held.current?.hadUnknown)return;
    void send(Object.freeze({tenantId,instanceId,productId:product.product_id,expected:product.version,key:crypto.randomUUID(),file:null,action:'remove',hadUnknown:false}));
  }
  const photo=media?.photo,path=photo?.read_path;
  const blocked=locked||preparing||phase==='sending'||phase==='unknown'||phase==='refreshing'||phase==='refresh_failed';
  return <div className="hosted-store-photo stack">
    {photo&&path!==failedPath?<img src={path} alt={product.title} width={photo.width} height={photo.height} onError={()=>setFailedPath(path??'')}/>:<p className="field-hint">{photo?'照片暫時無法讀取。':'尚未加入商品照片。'}</p>}
    {(writable||attempt?.hadUnknown)&&<>
      {uploadsEnabled&&<label htmlFor={id}>商品照片<input ref={input} id={id} type="file" accept="image/png,image/jpeg,image/webp" disabled={blocked} aria-describedby={id+'-hint'} onChange={event=>{
        const selected=event.target.files?.[0];if(selected)void choose(selected);
      }}/></label>}
      {uploadsEnabled&&<p className="field-hint" id={id+'-hint'}>PNG、JPEG 或 WebP，原始照片最多 20 MB；大照片會在裝置上自動縮小。選好後自動上傳並儲存草稿；公開頁需重新發布。</p>}
      {file&&<p className="field-hint">已選擇：{file.name}</p>}
      {file&&previewUrl&&<figure className="hosted-photo-draft"><img src={previewUrl} alt="待儲存的完整商品照片"/><figcaption>裝置上的預覽・{(file.size/1024/1024).toFixed(2)} MB・{phase==='unknown'?'儲存結果尚未確認':phase==='sending'?'正在儲存':'尚未套用到商品'}</figcaption></figure>}
      <div className="actions">
        {phase==='unknown'?<button type="button" className="btn btn-ghost" onClick={()=>attempt&&void send(attempt)}>重試原照片操作</button>
          :phase==='review'?<button type="button" className="btn btn-ghost" disabled={locked||!writable||!attempt||(attempt.action==='upload'&&!uploadsEnabled)} onClick={()=>attempt&&void send(reviewPhotoAttempt(attempt,product.version,crypto.randomUUID()))}>確認以最新商品套用照片變更</button>
          :phase==='refresh_failed'?<button type="button" className="btn btn-ghost" disabled={locked} onClick={()=>void refreshSaved()}>重新讀取已儲存照片</button>
          :<>{phase==='rejected'&&attempt&&<button type="button" className="btn btn-ghost" disabled={blocked||!writable||(attempt.action==='upload'&&!uploadsEnabled)} onClick={()=>void send(attempt)}>{attempt.action==='upload'?'重試儲存照片':'重試移除照片'}</button>}
            {photo&&<button type="button" className="btn btn-ghost" disabled={blocked} onClick={()=>{if(window.confirm(`移除「${product.title}」的草稿照片？公開頁會保留到重新發布。`))remove();}}>移除照片</button>}</>}
        {(file||attempt||preparing)&&phase!=='unknown'&&phase!=='sending'&&phase!=='refreshing'&&<button type="button" className="btn btn-ghost" disabled={locked} onClick={()=>{preparation.current++;setPreparing(false);clear();setMessage('已取消這次照片變更。');}}>取消照片變更</button>}
      </div>
    </>}
    {message&&<p role="status" className="field-hint">{message}</p>}
  </div>;
}
