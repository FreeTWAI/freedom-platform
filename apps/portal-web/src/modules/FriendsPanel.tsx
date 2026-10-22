import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {useModuleMutation,type ModulePanelProps} from './shared';
import {DirectoryMemberRow,loadLabels,type MemberCardData} from './Membership';
import {announceInboxChange} from './member-inbox';
import {BlockedMembers,MemberBlockingAction} from './MemberBlocking';
import {createFriendsDirectory,type FriendsPage,type FriendsScope} from './friends-directory-controller';
import './MemberConnections.css';

// Removing a friend or declining a request cannot be undone from this page, so both ask first.
const CONFIRM={remove:{label:'移除好友',confirm:'確定移除',busy:'正在移除…',warning:'移除後對方不會收到通知；之後要重新送出邀請並由對方接受，才能再成為好友。'},decline:{label:'婉拒',confirm:'確定婉拒',busy:'正在婉拒…',warning:'婉拒後對方會收到通知，這則通知無法收回。'}} as const;
type Props=ModulePanelProps&{onMessage:(id:string)=>void;initialScope?:'accepted'|'incoming';memberBlockingEnabled?:boolean};
export function FriendsPanel(props:Props){
  // A different member/session never inherits private results or mutation notices.
  return <FriendsContent key={`${props.session.user.user_id}:${props.client.sessionGeneration}`} {...props}/>;
}
function FriendsContent({client,onNavigate,onMessage,initialScope='accepted',memberBlockingEnabled=false}:Props){
  const owner=client.sessionGeneration;
  const directory=useMemo(()=>createFriendsDirectory<MemberCardData>({
    generation:()=>client.sessionGeneration,initialScope,
    read:(query,signal)=>client.get<FriendsPage<MemberCardData>>(`/friends/directory?${query}`,{signal}),
  }),[client,owner]);
  const view=useSyncExternalStore(directory.subscribe,directory.getSnapshot,directory.getSnapshot);
  const {scope,draft:search,page,offset,composing}=view;
  const loading=view.status==='loading'||view.status==='waiting'||view.status==='idle'&&!composing&&scope!=='blocked';
  const loadError=view.status==='error'?(view.error instanceof Error?view.error.message:'好友名單暫時無法載入。'):'';
  const [labels,setLabels]=useState<Record<string,string>>({}),[notice,setNotice]=useState('');
  const [actionTarget,setActionTarget]=useState<{id:string;action:'accept'|'remove'}|null>(null);
  const [blockingTarget,setBlockingTarget]=useState<string|null>(null),[blockingTargets,setBlockingTargets]=useState<{user_id:string;nickname:string}[]>([]);
  const [visitedBlocked,setVisitedBlocked]=useState(false);
  const [confirming,setConfirming]=useState<{userId:string;action:keyof typeof CONFIRM}|null>(null),confirmationId=useId();
  const {mutate,busy,error}=useModuleMutation(client);
  const input=useRef<HTMLInputElement>(null),results=useRef<HTMLElement>(null);
  const pageTrigger=useRef<Element|null>(null),focusedRevision=useRef(0);
  useEffect(()=>{directory.start();return()=>directory.stop();},[directory]);
  useEffect(()=>{
    let active=true;
    void loadLabels(client).then(data=>{if(active&&directory.isCurrent())setLabels(data);}).catch(()=>{});
    return()=>{active=false;};
  },[client,directory]);
  useEffect(()=>{if(scope==='blocked')setVisitedBlocked(true);},[scope]);
  useEffect(()=>{
    if(view.focusRevision===focusedRevision.current)return;
    focusedRevision.current=view.focusRevision;
    if(directory.isCurrent()&&(document.activeElement===document.body||document.activeElement===pageTrigger.current)){
      results.current?.focus({preventScroll:true});
    }
    pageTrigger.current=null;
  },[view.focusRevision,directory]);
  function openBlocking(member:MemberCardData){setBlockingTargets(value=>value.some(item=>item.user_id===member.user_id)?value:[...value,{user_id:member.user_id,nickname:member.nickname}]);setBlockingTarget(member.user_id);}
  async function act(member:MemberCardData,action:'accept'|'remove'){
    if(busy||!directory.isCurrent())return;
    setNotice('');setActionTarget({id:member.user_id,action});
    // Keep the existing version, command key and explicit retry semantics.
    const result=await mutate(`/friends/${member.user_id}/${action}`,{},member.friendship.aggregate_version);
    if(!directory.isCurrent())return;
    setActionTarget(null);
    if(result!==undefined){
      setConfirming(null);
      announceInboxChange();
      setNotice(action==='accept'?`已和${member.nickname}成為好友。`:'好友關係或邀請已移除。');
      await directory.refreshAfterMutation();
    }
  }
  function changeScope(next:FriendsScope){setNotice('');setConfirming(null);void directory.selectScope(next);}
  const pending=(member:MemberCardData,action:'accept'|'remove')=>busy&&actionTarget?.id===member.user_id&&actionTarget.action===action;
  function confirmable(member:MemberCardData,action:keyof typeof CONFIRM){
    const id=`${confirmationId}-${member.user_id}-${action}`,open=confirming?.userId===member.user_id&&confirming.action===action,copy=CONFIRM[action];
    return <><button id={id} type="button" className="btn btn-ghost" disabled={busy} aria-expanded={open} aria-controls={`${id}-confirmation`} aria-describedby={open?`${id}-warning`:undefined} onClick={()=>setConfirming({userId:member.user_id,action})}>{copy.label}</button>
      <div id={`${id}-confirmation`} hidden={!open} role="group" aria-label={`${copy.label}「${member.nickname}」`} aria-describedby={`${id}-warning`}>
        <p id={`${id}-warning`} className="field-hint">{copy.warning}</p>
        <button type="button" className="btn btn-ghost" disabled={busy} aria-describedby={`${id}-warning`} onClick={()=>void act(member,'remove')}>{pending(member,'remove')?copy.busy:copy.confirm}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>{setConfirming(null);document.getElementById(id)?.focus();}}>取消</button>
      </div></>;
  }
  return <section className="module-panel members-panel friends-panel"><div className="actions"><button type="button" className="btn btn-ghost" onClick={()=>onNavigate?.('members')}>認識更多工坊夥伴</button></div>
    <div className="friend-scopes" data-guide-anchor="friends:scope" role="group" aria-label="好友名單範圍">{([['accepted','我的好友'],['incoming','收到的邀請'],['outgoing','送出的邀請'],...(memberBlockingEnabled?[['blocked','我的封鎖名單']]:[])] as [FriendsScope,string][]).map(([key,label])=><button type="button" className="btn btn-ghost" key={key} data-guide-anchor={key==='incoming'?'friends:incoming':undefined} aria-pressed={scope===key} disabled={composing} onClick={()=>changeScope(key)}>{label}</button>)}</div>
    {/* Keep visited blocking editors mounted across list switches: an unknown write retains its key. */}
    {memberBlockingEnabled&&visitedBlocked&&<div hidden={scope!=='blocked'}><BlockedMembers client={client}/></div>}
    {scope!=='blocked'&&<form className="stack" role="search" aria-label="搜尋好友" onSubmit={event=>{event.preventDefault();if(!composing)void directory.submit();}}>
      <label className="field">搜尋好友名稱<input ref={input} type="search" autoComplete="off" maxLength={100} value={search}
        onChange={event=>directory.input(event.target.value)}
        onCompositionStart={()=>directory.compositionStart()}
        onCompositionEnd={event=>directory.compositionEnd(event.currentTarget.value)}
        onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||directory.getSnapshot().composing))event.preventDefault();}}/></label>
      <div className="actions"><button type="submit" className="btn btn-secondary btn-small" disabled={composing}>搜尋好友</button>
        {search&&<button type="button" className="btn btn-ghost btn-small" disabled={composing} onClick={()=>{void directory.clear();input.current?.focus();}}>清除好友搜尋</button>}
      </div>
      {composing&&<p className="field-hint" role="status">選字完成後會自動搜尋。</p>}
    </form>}
    {error&&<div className="banner banner-error" role="alert"><p>{error}</p><button type="button" className="btn btn-ghost" disabled={busy||composing} onClick={()=>void directory.submit()}>重讀好友名單</button></div>}
    {notice&&<p role="status" className="banner status-note">{notice}</p>}
    {scope!=='blocked'&&<section ref={results} tabIndex={-1} aria-label="好友名單結果" aria-busy={loading}>
      {loadError&&<div className="banner banner-error" role="alert"><p>{loadError}</p><button type="button" className="btn btn-ghost" onClick={()=>void directory.submit()}>重讀好友名單</button></div>}
      {loading&&<p role="status">正在載入好友名單…</p>}
      {view.status==='ready'&&page&&<><p className="field-hint" aria-live="polite">共 {page.total} 位{scope==='accepted'?'好友':'待回覆的夥伴'}</p>
        {!page.items.length&&<p>{view.search?'沒有符合的名字。':scope==='accepted'?'還沒有好友，從工坊夥伴或首頁推薦開始認識彼此。':'目前沒有待回覆的邀請。'}</p>}
        <div className="directory-rows">{page.items.map(member=><DirectoryMemberRow key={member.user_id} member={member} labels={labels} client={client}><div className="directory-friend-actions">
          {scope==='accepted'?<><button type="button" className="btn btn-ghost" onClick={()=>onMessage(member.user_id)}>私訊使用者</button>{confirmable(member,'remove')}</>
            :scope==='incoming'?<><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void act(member,'accept')}>{pending(member,'accept')?'正在接受…':'接受邀請'}</button>{confirmable(member,'decline')}</>
            :<button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>void act(member,'remove')}>{pending(member,'remove')?'正在取消…':'取消邀請'}</button>}
          {memberBlockingEnabled&&<button type="button" className="btn btn-ghost" onClick={()=>openBlocking(member)}>封鎖設定</button>}
        </div></DirectoryMemberRow>)}</div>
      </>}
      {(offset>0||page?.next_offset!=null)&&<nav className="actions" aria-label="好友頁數">
        {offset>0&&<button type="button" className="btn btn-ghost" disabled={loading||composing} onClick={()=>{pageTrigger.current=document.activeElement;void directory.previous();}}>上一頁好友</button>}
        {view.status==='ready'&&page&&<span className="field-hint">第 {Math.floor(offset/20)+1} 頁</span>}
        {page?.next_offset!=null&&<button type="button" className="btn btn-ghost" disabled={loading||composing} onClick={()=>{pageTrigger.current=document.activeElement;void directory.next();}}>下一頁好友</button>}
      </nav>}
    </section>}
    {memberBlockingEnabled&&blockingTargets.map(target=><div key={target.user_id} hidden={blockingTarget!==target.user_id}><MemberBlockingAction client={client} userId={target.user_id} nickname={target.nickname} active={blockingTarget===target.user_id} onDismiss={()=>setBlockingTarget(null)} onChanged={()=>{if(!directory.isCurrent())return;setNotice('封鎖設定已保存。好友名單以重新讀取的資料為準。');return directory.refreshAfterMutation();}}/></div>)}
  </section>;
}
