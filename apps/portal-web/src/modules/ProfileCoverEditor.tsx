import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {z} from 'zod';
import {ApiError,type PortalClient} from '../api';
import {createProfileReader} from './profile-publication-controller';
const version=z.string().regex(/^[1-9][0-9]{0,18}$/);
const Metadata=z.object({version,present:z.boolean(),upload_available:z.boolean(),reason:z.string().nullable(),draft_versions:z.array(version).max(4)}).strict();
const Uploaded=z.object({version,present:z.literal(true)}).strict();
export type CoverSelection={include_cover:boolean;cover_version:string|null};
export type CoverEditorState={busy:boolean;unknown:boolean;dirty:boolean};
type Props={client:PortalClient;value:CoverSelection;saved:CoverSelection;disabled:boolean;onChange:(value:CoverSelection)=>void;onState:(value:CoverEditorState)=>void};
type Operation=({kind:'upload';file:File;version:string;key:string}|{kind:'remove';removeVersion:string;version:string;key:string})&{everUnknown?:boolean};
export function ProfileCoverEditor({client,value,saved,disabled,onChange,onState}:Props){
 const generation=client.sessionGeneration,live=useRef({client,generation});live.current={client,generation};
 const current=()=>live.current.client===client&&live.current.generation===generation&&client.sessionGeneration===generation;
 const reader=useMemo(()=>createProfileReader(async signal=>Metadata.parse(await client.get('/me/profile-cover',{signal})),current),[client,generation]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<Operation|null>(null),active=useRef(false),input=useRef<HTMLInputElement>(null);
 const signalState=(next:CoverEditorState)=>{onState(next);setBusy(next.busy);setUnknown(next.unknown);};
 useEffect(()=>{reader.start();return()=>{reader.stop();};},[reader]);
 function choose(next?:File){
  if(active.current||pending.current||disabled)return;setError('');setNotice('');
  if(!next){setFile(null);onState({busy:false,unknown:false,dirty:false});return;}
  if(!['image/jpeg','image/png','image/webp'].includes(next.type)||!next.size||next.size>4*1024*1024){setError('請選擇4 MB以下的JPEG、PNG或WebP靜態圖片。');setFile(null);if(input.current)input.current.value='';onState({busy:false,unknown:false,dirty:false});return;}
  setFile(next);onState({busy:false,unknown:false,dirty:true});
 }
 async function run(operation:Operation){
  if(active.current||!current())return;pending.current=operation;active.current=true;signalState({busy:true,unknown:false,dirty:true});setError('');setNotice('');
  try{
   if(operation.kind==='upload'){
    const result=Uploaded.parse(await client.postProfileCover(operation.file,{ifMatch:operation.version,idempotencyKey:operation.key}));
    if(!current())return;onChange({include_cover:false,cover_version:result.version});setNotice('封面已存成私人草稿。確認預覽並勾選使用後，再按儲存個人頁。');
   }else{
    Metadata.parse(await client.post('/me/profile-cover/remove',{version:operation.removeVersion},{ifMatch:operation.version,idempotencyKey:operation.key}));
    if(!current())return;if(value.cover_version===operation.removeVersion)onChange(saved);setNotice('未使用的封面草稿已移除。');
   }
   pending.current=null;setFile(null);if(input.current)input.current.value='';signalState({busy:false,unknown:false,dirty:false});void reader.refresh();
  }catch(cause){
   if(!current())return;const uncertain=Boolean(operation.everUnknown)||(cause instanceof ApiError?(cause.network||!cause.definitiveResponse||cause.status>=500||cause.status===401||cause.status===403):true);
   if(uncertain)operation.everUnknown=true;
   if(!uncertain)pending.current=null;signalState({busy:false,unknown:uncertain,dirty:Boolean(file)||uncertain});setError(uncertain?'結果尚未確認，請確認同一筆操作，不要重選檔案。':cause instanceof ApiError?cause.message:'封面暫時無法處理，請重新確認。');
   if(!uncertain)void reader.refresh();
  }finally{active.current=false;}
 }
 const metadata=state.value,locked=disabled||busy||unknown;
 const previewVersion=value.cover_version;
 return <section className="profile-cover-editor stack" aria-label="自己的封面圖片"><h3>自己的封面圖片</h3>
  <p className="hint">選擇靜態JPEG、PNG或WebP，最多4 MB。系統會移除圖片附帶資料並裁成1600 × 600；上傳先存成私人草稿，不會立即改變已儲存的封面。</p>
  {state.status==='loading'&&<p role="status">正在確認封面儲存功能…</p>}
  {state.status==='error'&&<p role="alert">封面狀態暫時讀取失敗。<button type="button" className="btn btn-secondary btn-small" disabled={busy||unknown} onClick={()=>void reader.refresh()}>重讀封面狀態</button></p>}
  {metadata&&!metadata.upload_available&&<p className="banner banner-info">目前尚未提供圖片儲存。你仍可選擇封面圖樣；不會假裝上傳成功。</p>}
  {previewVersion&&<div className="profile-cover-private-preview"><img src={`/api/v1/me/profile-cover/image?v=${encodeURIComponent(previewVersion)}`} alt="只供本人確認的封面草稿" width="1600" height="600"/><p className="hint">本人預覽；不代表已對外顯示。</p></div>}
  <label className="field">選擇封面圖片<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={locked||!metadata?.upload_available} onChange={event=>choose(event.currentTarget.files?.[0])}/></label>
  {file&&<p>已選擇：{file.name}（尚未上傳）</p>}
  <div className="actions"><button type="button" className="btn btn-secondary btn-small" disabled={locked||!file||!metadata?.upload_available} onClick={()=>{if(file&&metadata)void run({kind:'upload',file,version:metadata.version,key:crypto.randomUUID()});}}>上傳並預覽封面</button>{file&&<button type="button" className="btn btn-secondary btn-small" disabled={locked} onClick={()=>{choose();if(input.current)input.current.value='';}}>取消選檔</button>}</div>
  {previewVersion&&<label className="checkbox-row"><input type="checkbox" checked={value.include_cover} disabled={locked} onChange={event=>onChange({...value,include_cover:event.target.checked})}/>使用這張封面，依個人頁可見範圍展示</label>}
  {value.cover_version&&<button type="button" className="btn btn-secondary btn-small" disabled={locked} onClick={()=>onChange({include_cover:false,cover_version:null})}>改用圖樣（儲存個人頁後生效）</button>}
  {metadata?.draft_versions.map((draftVersion,index)=><div className="actions" key={draftVersion}><button type="button" className="btn btn-secondary btn-small" disabled={locked} onClick={()=>onChange({include_cover:false,cover_version:draftVersion})}>預覽未使用的封面草稿 {index+1}</button><button type="button" className="btn btn-secondary btn-small" disabled={locked} onClick={()=>{if(window.confirm('移除這張尚未用在個人頁的封面草稿？'))void run({kind:'remove',removeVersion:draftVersion,version:metadata.version,key:crypto.randomUUID()});}}>捨棄封面草稿 {index+1}</button></div>)}
  {error&&<p role="alert">{error}</p>}{unknown&&pending.current&&<button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={()=>{if(pending.current)void run(pending.current);}}>確認原封面操作</button>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
