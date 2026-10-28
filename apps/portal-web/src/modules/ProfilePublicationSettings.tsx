import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ProfilePublicationInput,ProfilePublicationSettingsSchema,defaultProfileLayout,type ProfileLayoutData,type ProfilePublicationSettingsData,type ProfileVisibilityValue} from '../../../../packages/shared/member-profile';
import type {PortalClient} from '../api';
import type {SessionPayload} from '../types';
import {createProfileReader,profilePublicationPreview,profileMutationBlocksLeave} from './profile-publication-controller';
import {sharingMutationState} from './authoring-drafts';
import {useModuleMutation} from './shared';
import {ProfileText} from './VisitorProfile';
import {visitorProfileHash} from './profile-publication-route';
import {ProfileLayoutEditor} from './ProfileLayoutEditor';
import {ProfileCoverEditor,type CoverEditorState} from './ProfileCoverEditor';
import './ProfilePublication.css';

type Draft={visibility:ProfileVisibilityValue;display_name:string;bio:string;links:{label:string;url:string}[];layout:ProfileLayoutData;include_cover:boolean;cover_version:string|null};
type Settings=ProfilePublicationSettingsData;
function draftOf(value:Settings):Draft{return {visibility:value.visibility,display_name:value.display_name,bio:value.bio,links:value.links,layout:structuredClone(value.layout),include_cover:value.include_cover,cover_version:value.cover_version};}
const empty:Draft={visibility:'private',display_name:'',bio:'',links:[],layout:structuredClone(defaultProfileLayout),include_cover:false,cover_version:null};
const labels={private:'不公開（僅自己）',members:'同社群會員',public:'任何人（免登入）'};
export function ProfilePublicationSettings(props:{client:PortalClient;session:SessionPayload;registerLeave:(guard:((hash:string|null)=>boolean)|null)=>void;onReturn:()=>void;onView:()=>void}){
 return <SettingsContent key={`${props.session.user.user_id}:${props.client.sessionGeneration}`} {...props}/>;
}
function SettingsContent({client,session,registerLeave,onReturn,onView}:Parameters<typeof ProfilePublicationSettings>[0]){
 const generation=client.sessionGeneration,owner=session.user.user_id,scope=useRef({client,generation});scope.current={client,generation};
 const current=()=>scope.current.client===client&&scope.current.generation===generation&&client.sessionGeneration===generation;
 const reader=useMemo(()=>createProfileReader(async signal=>ProfilePublicationSettingsSchema.parse(await client.get('/me/profile-publication',{signal})),current),[client,generation]);
 const load=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 const [loadedFor,setLoadedFor]=useState<typeof reader|null>(null);
 const [draft,setDraft]=useState<Draft>(empty),[saved,setSaved]=useState<Settings|null>(null),[confirmed,setConfirmed]=useState(false),[preview,setPreview]=useState(false),[notice,setNotice]=useState(''),[validation,setValidation]=useState('');
 const {mutate,busy,error,lastFailureUnknown}=useModuleMutation(client,{userId:owner,type:'profile-publication-settings'});
 const mutationState=sharingMutationState({userId:owner,type:'profile-publication-settings'});
 const pending=useRef<{body:Draft&{confirm_public:boolean};version?:string}|null>(null);
 const coverState=useRef<CoverEditorState>({busy:false,unknown:false,dirty:false});
 const [coverStatus,setCoverStatus]=useState(coverState.current);
 const reportCover=(value:CoverEditorState)=>{coverState.current=value;setCoverStatus(value);};
 const dirty=saved!==null&&JSON.stringify(draft)!==JSON.stringify(draftOf(saved));
 useEffect(()=>{reader.start();return()=>reader.stop();},[reader]);
 useEffect(()=>{if(load.value&&current()){const data=load.value;setLoadedFor(reader);setSaved(data);setDraft(draftOf(data));setConfirmed(false);}},[load.value]);
 useEffect(()=>{
  const guard=()=>(profileMutationBlocksLeave(mutationState)||coverState.current.busy||coverState.current.unknown)?false:!(dirty||coverState.current.dirty)||window.confirm('尚有未儲存的修改，確定離開？');registerLeave(guard);
  const unload=(event:BeforeUnloadEvent)=>{if(dirty||profileMutationBlocksLeave(mutationState)||coverState.current.busy||coverState.current.unknown||coverState.current.dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);
  return()=>{registerLeave(null);window.removeEventListener('beforeunload',unload);};
 },[registerLeave,dirty,mutationState]);
 async function submit(retry=false){
  if(busy||coverState.current.busy||coverState.current.unknown||coverState.current.dirty||!saved||!current())return;setValidation('');setNotice('');
  let operation=pending.current;
  if(!retry){
   const body={...draft,confirm_public:confirmed},parsed=ProfilePublicationInput.safeParse(body);
   if(!parsed.success){setValidation(parsed.error.issues[0]?.message??'請檢查欄位。');return;}
   operation={body:parsed.data,version:saved.aggregate_version??undefined};pending.current=operation;
  }
  if(!operation)return;
  const result=await mutate<Settings>('/me/profile-publication',operation.body,operation.version,value=>ProfilePublicationSettingsSchema.parse(value));
  if(!current())return;
  if(result){pending.current=null;setSaved(result);setDraft(draftOf(result));setConfirmed(false);setNotice('個人頁與可見範圍已儲存。');}
 }
 function update(next:Draft){setDraft(next);setConfirmed(false);setNotice('');}
 const previewData=profilePublicationPreview(draft);
 const locked=busy||lastFailureUnknown||coverStatus.busy||coverStatus.unknown;
 return <section className="profile-publication stack" aria-label="對外個人頁設定">
  <div className="section-head"><h2>對外個人頁</h2><button type="button" className="btn btn-secondary btn-small" disabled={locked} onClick={onReturn}>返回本人空間</button></div>
  <p className="hint">這裡只設定新的對外個人頁，不會隱藏舊會員目錄、分享名片或其他已發布內容。私人草稿、聯絡資料與訂單不會自動加入。</p><p className="hint">不影響你已公開的名片；名片另行管理。<a href="#account">前往資料與帳號設定，管理分享名片</a></p>
  {load.status==='error'&&<div role="alert"><p>設定暫時無法讀取。</p><button className="btn btn-secondary btn-small" onClick={()=>void reader.refresh()}>重讀設定</button></div>}
  {(!saved||loadedFor!==reader)&&load.status!=='error'&&<p role="status">正在讀取設定…</p>}
  {saved&&loadedFor===reader&&current()&&<form className="card stack" onSubmit={event=>{event.preventDefault();void submit();}}>
   <p>目前已儲存範圍：<strong>{labels[saved.visibility]}</strong></p>
   <fieldset className="fieldset profile-visibility" disabled={locked}><legend>誰可以看這個個人頁？</legend>{(Object.keys(labels) as ProfileVisibilityValue[]).map(value=><label key={value}><input type="radio" name="profile-visibility" checked={draft.visibility===value} onChange={()=>update({...draft,visibility:value})}/>{labels[value]}</label>)}</fieldset>
   <label className="field">顯示名稱<input required maxLength={60} disabled={locked} value={draft.display_name} onChange={event=>update({...draft,display_name:event.target.value})}/></label>
   <label className="field">一句話介紹<input maxLength={280} disabled={locked} value={draft.bio} onChange={event=>update({...draft,bio:event.target.value})}/></label>
   <fieldset className="fieldset stack" disabled={locked}><legend>連結（最多五個）</legend>{draft.links.map((link,index)=><div className="profile-link-editor" key={index}><label className="field">連結名稱 {index+1}<input required maxLength={40} value={link.label} onChange={event=>update({...draft,links:draft.links.map((value,i)=>i===index?{...value,label:event.target.value}:value)})}/></label><label className="field">HTTPS 網址 {index+1}<input required type="url" maxLength={500} value={link.url} onChange={event=>update({...draft,links:draft.links.map((value,i)=>i===index?{...value,url:event.target.value}:value)})}/></label><button type="button" className="btn btn-secondary btn-small" onClick={()=>update({...draft,links:draft.links.filter((_,i)=>i!==index)})}>移除連結 {index+1}</button></div>)}{draft.links.length<5&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>update({...draft,links:[...draft.links,{label:'',url:''}]})}>新增連結</button>}</fieldset>
   <ProfileLayoutEditor value={draft.layout} disabled={locked} onChange={layout=>update({...draft,layout})}/>
   <ProfileCoverEditor client={client} value={draft} saved={saved} disabled={busy||lastFailureUnknown} onChange={selection=>update({...draft,...selection})} onState={reportCover}/>
   <label className="field">封面圖片說明<input maxLength={120} disabled={locked} value={draft.layout.cover_alt} onChange={event=>update({...draft,layout:{...draft.layout,cover_alt:event.target.value}})}/></label>
   {draft.visibility==='public'&&<div className="banner banner-info"><p id="profile-public-warning">公開後任何人都能免登入閱讀，包括登出後的被封鎖者。封鎖不能讓公開資料保密。</p><label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={locked} aria-describedby="profile-public-warning" onChange={event=>setConfirmed(event.target.checked)}/>我確認公開以上文字、連結與已勾選的封面</label></div>}
   <div className="actions profile-editor-savebar"><button type="submit" className="btn btn-primary" disabled={locked||coverStatus.dirty||draft.visibility==='public'&&!confirmed}>{busy?'儲存中…':draft.visibility==='public'?'確認公開':'儲存'}</button><button type="button" className="btn btn-secondary btn-small" disabled={locked||coverStatus.dirty||!dirty} onClick={()=>{setDraft(draftOf(saved));setConfirmed(false);setNotice('已取消未儲存的修改。私人封面草稿仍可另行捨棄。');}}>取消修改</button><button type="button" className="btn btn-secondary btn-small" disabled={locked||coverStatus.dirty} onClick={()=>{if(window.confirm('將外觀恢復預設？文字名片與可見範圍保持不變，按儲存才生效。'))update({...draft,layout:structuredClone(defaultProfileLayout),include_cover:false,cover_version:null});}}>恢復預設外觀</button><button type="button" className="btn btn-secondary btn-small" onClick={()=>setPreview(value=>!value)} aria-expanded={preview}>草稿外觀預覽</button>{saved.aggregate_version&&<button type="button" className="btn btn-secondary btn-small" disabled={locked} onClick={onView}>查看已儲存個人頁</button>}</div>
   {preview&&<section className="profile-preview stack"><h3>尚未儲存的草稿預覽</h3><p className="hint">只是外觀預覽，不會改變伺服器上的內容或公開範圍。此處不載入帳號稱號與認證；請用「查看已儲存個人頁」確認實際會員畫面。</p>{previewData.success?<ProfileText profile={previewData.data} coverUrl={draft.include_cover&&draft.cover_version?`/api/v1/me/profile-cover/image?v=${encodeURIComponent(draft.cover_version)}`:null}/>:<p>請填寫有效名稱與連結後預覽。</p>}</section>}
   {saved.visibility!=='private'&&saved.aggregate_version&&<p className="hint">個人頁連結：<a href={visitorProfileHash(owner)}>{visitorProfileHash(owner)}</a>（{labels[saved.visibility]}）</p>}
  </form>}
  {validation&&<p role="alert">{validation}</p>}{error&&<div role="alert"><p>{error}</p>{!lastFailureUnknown&&<p>若資料版本已更新，重讀會丟棄這份本機修改。<button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>{if(window.confirm('丟棄本機修改並重讀最新設定？'))void reader.refresh();}}>重讀最新設定</button></p>}</div>}
  {lastFailureUnknown&&<div className="banner banner-info"><p>結果尚未確認，儲存可能已成功。確認前請留在此頁。</p><button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>void submit(true)}>確認原儲存結果</button></div>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
