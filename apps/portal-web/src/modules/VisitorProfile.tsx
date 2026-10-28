import {CommunityCertificationBadge} from './CommunityCertificationBadge';
import type {ReactNode} from 'react';
import {ProfileDesign} from './ProfileDesign';
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {VisitorProfile as PublicSchema,MemberVisitorProfile as MemberSchema,type VisitorProfileData,type MemberVisitorProfileData} from '../../../../packages/shared/member-profile';
import type {PortalClient} from '../api';
import type {SessionPayload} from '../types';
import {createProfileReader,profileMutationBlocksLeave} from './profile-publication-controller';
import {sharingMutationState} from './authoring-drafts';
import {useModuleMutation} from './shared';
import './ProfilePublication.css';

type Props={client:PortalClient;id:string;session?:SessionPayload;onLogin?:()=>void;onMessage?:(id:string)=>void;onEdit?:()=>void;registerLeave?:(guard:((hash:string|null)=>boolean)|null)=>void};
export function ProfileText({profile,coverUrl,recognition}:{profile:VisitorProfileData;coverUrl?:string|null;recognition?:ReactNode}){
 return <ProfileDesign profile={profile} coverUrl={coverUrl} recognition={recognition}/>;
}
export function VisitorProfile(props:Props){
 return <VisitorProfileContent key={`${props.session?.user.user_id??'guest'}:${props.client.sessionGeneration}:${props.id}`} {...props}/>;
}
function VisitorProfileContent({client,id,session,onLogin,onMessage,onEdit,registerLeave}:Props){
 const generation=client.sessionGeneration,owner=session?.user.user_id;
 const live=useRef({client,generation,id,owner});live.current={client,generation,id,owner};
 const reader=useMemo(()=>createProfileReader(async signal=>{
  const data=await client.get(owner?`/members/${id}/profile`:`/public/member-profiles/${id}`,{signal});
  return owner?MemberSchema.parse(data):{profile:PublicSchema.parse(data),actions:null};
 },()=>live.current.client===client&&live.current.generation===generation&&client.sessionGeneration===generation&&live.current.id===id&&live.current.owner===owner),[client,generation,id,owner]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 const {mutate,busy,error,lastFailureUnknown}=useModuleMutation(client,owner?{userId:owner,type:`visitor-profile:${id}`}:undefined);
 const mutationState=owner?sharingMutationState({userId:owner,type:`visitor-profile:${id}`}):null;
 const [notice,setNotice]=useState(''),[pending,setPending]=useState<{action:'request'|'accept'|'remove';version?:string}|null>(null);
 useEffect(()=>{
  reader.start();const refresh=()=>{if(document.visibilityState==='visible')void reader.refresh();};
  const visibility=()=>{if(document.visibilityState==='hidden')reader.hide();else refresh();};
  window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visibility);
  return()=>{reader.stop();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visibility);};
 },[reader]);
 useEffect(()=>{
  registerLeave?.(()=>!profileMutationBlocksLeave(mutationState));
  const unload=(event:BeforeUnloadEvent)=>{if(profileMutationBlocksLeave(mutationState)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);
  return()=>{registerLeave?.(null);window.removeEventListener('beforeunload',unload);};
 },[registerLeave,mutationState]);
 const value=client.sessionGeneration===generation?state.value:null;
 async function act(action:'request'|'accept'|'remove',version?:string){
  if(busy||!owner)return;setNotice('');setPending({action,version});
  const result=await mutate(`/friends/${id}/${action}`,{},version);
  if(client.sessionGeneration!==generation||live.current.client!==client||live.current.id!==id)return;
  if(result!==undefined){setPending(null);setNotice('好友關係已更新。');void reader.refresh();}
 }
 const actions=value?.actions as MemberVisitorProfileData['actions']|null|undefined;
 const badge=owner&&value&&'community_certification' in value?value.community_certification:undefined;
 const title=owner&&value&&'social_achievement' in value?value.social_achievement:undefined;
 const recognition=badge||title?<>{badge&&<CommunityCertificationBadge badge={badge}/>} {title&&<details className="social-achievement-title"><summary>社群稱號 · {title.label}</summary><p>{title.description}</p></details>}</>:null;
 return <section className="profile-publication stack" aria-label="個人頁">
  {state.status==='loading'&&<p role="status">正在讀取個人頁…</p>}
  {state.status==='error'&&<div className="card stack"><h2>目前無法查看此個人頁</h2><p>這個頁面目前無法提供給你閱讀。</p><button className="btn btn-secondary btn-small" onClick={()=>void reader.refresh()}>重新讀取</button>{!owner&&onLogin&&<button className="btn btn-secondary btn-small" onClick={onLogin}>登入後查看</button>}</div>}
  {value&&<article className="card stack"><ProfileText profile={value.profile} recognition={recognition} coverUrl={value.profile.cover?`/api/v1/${owner?`members/${id}/profile`:`public/member-profiles/${id}`}/cover?v=${encodeURIComponent(value.profile.cover.version)}&generation=${encodeURIComponent(value.profile.cover.generation)}`:null}/>
   {actions?.is_self?<><p className="hint">這是你已儲存的個人頁外觀，不代表所有訪客都能看見。</p><button className="btn btn-secondary btn-small" onClick={onEdit}>編輯對外個人頁</button></>:actions?<div className="actions">
    {actions.can_request&&<button className="btn btn-secondary btn-small" disabled={busy||lastFailureUnknown} onClick={()=>void act('request',actions.friendship.aggregate_version??undefined)}>邀請成為好友</button>}
    {actions.friendship.state==='pending'&&!actions.can_accept&&<span>好友邀請已送出，等待回覆</span>}
    {actions.can_accept&&<><button className="btn btn-secondary btn-small" disabled={busy||lastFailureUnknown} onClick={()=>void act('accept',actions.friendship.aggregate_version??undefined)}>接受好友邀請</button><button className="btn btn-secondary btn-small" disabled={busy||lastFailureUnknown} onClick={()=>{if(window.confirm('確定婉拒這次好友邀請？'))void act('remove',actions.friendship.aggregate_version??undefined);}}>婉拒</button></>}
    {actions.friendship.state==='accepted'&&<><span className="badge">平台好友</span><button className="btn btn-secondary btn-small" disabled={busy||lastFailureUnknown} onClick={()=>{if(window.confirm('確定移除好友關係？'))void act('remove',actions.friendship.aggregate_version??undefined);}}>移除好友</button></>}
    {actions.can_message&&onMessage&&<button className="btn btn-secondary btn-small" disabled={busy||lastFailureUnknown} onClick={()=>onMessage(id)}>私訊</button>}
   </div>:onLogin&&<button className="btn btn-secondary btn-small" onClick={onLogin}>登入後加好友或私訊</button>}
  </article>}
  {error&&<p role="alert">{error}</p>}{lastFailureUnknown&&pending&&<div className="banner banner-info"><p>結果尚未確認，操作可能已成功。請用同一筆操作確認；確認前先留在此頁。</p><button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>void act(pending.action,pending.version)}>確認原操作結果</button></div>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
