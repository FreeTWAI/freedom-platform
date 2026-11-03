import {useEffect,useRef,useState,type FormEvent} from 'react';
import {SQUAD_KINDS,SQUAD_KIND_LABELS,type SquadKind} from '../../../../packages/shared/squad-kinds';
import {ApiError} from '../api';
import {useModuleMutation,type ModulePanelProps} from './shared';
import {sharingMutationState,useAuthoringDraft} from './authoring-drafts';
import {Status} from './Membership';
import {ModuleBanner} from './ModuleBanner';
import {SquadOutcomePublisher,type Outcome} from './SquadOutcomes';
import {SquadOwnerTools} from './SquadOwnerTools';
import {ReceivedInvitations,OwnerInvitations} from './SquadInvitations';
import './ModuleDiscovery.css';
import './SquadInvitations.css';
type Squad={squad_id:string;name:string;kind:SquadKind;purpose:string;communication_channel_name:string;aggregate_version:number;owner_ref:string;owner_name:string;member_count:number;membership:null|{state:string;aggregate_version:number}};
type SquadDetail=Squad&{members:{user_id:string;nickname:string;state:string;aggregate_version:number}[]};
const kindLabels=SQUAD_KIND_LABELS;
const kindOptions=SQUAD_KINDS.map(kind=><option key={kind} value={kind}>{kindLabels[kind]}</option>);
const message=(e:unknown,fallback:string)=>e instanceof Error?e.message:fallback;

type SquadCommand=Readonly<{path:string;body:unknown;version?:number|string}>;
// All squad commands already return a versioned record. Do not acknowledge an
// empty/malformed response or lose the shared hook's sticky unknown history.
export function confirmedSquadCommand(value:unknown,path:string,actorId:string,body:unknown){
  const row=value as Record<string,unknown>|null,input=body as Record<string,unknown>;
  const fail=()=>{throw new Error('回覆不是原操作的已確認紀錄，請保留原操作重試。');};
  if(!row||typeof row!=='object'||Array.isArray(row))return fail();
  const version=Number(row.aggregate_version);
  if(!/^\d+$/.test(String(row.aggregate_version))||!Number.isSafeInteger(version)||version<1)return fail();
  const squadId=/^\/squads\/([^/]+)/.exec(path)?.[1],outcomeId=/^\/squad-outcomes\/([^/]+)/.exec(path)?.[1],invitationId=/^\/squad-invitations\/([^/]+)/.exec(path)?.[1];
  if(typeof row.squad_id!=='string'||(squadId&&row.squad_id!==squadId)||(outcomeId&&row.outcome_id!==outcomeId)||(invitationId&&row.invitation_id!==invitationId))return fail();
  const action=path.split('/').at(-1),outcome=path.includes('/outcomes')||Boolean(outcomeId);
  if(outcome){
    const author=row.author as Record<string,unknown>|null;
    const expected=action==='publish'?'published':action==='withdraw'?'withdrawn':'draft';
    if(!author||author.user_id!==actorId||typeof author.display_name!=='string'||['outcome_id','title','summary'].some(key=>typeof row[key]!=='string')||!['squad','community','public'].includes(String(row.audience))||row.state!==expected||(row.artifact_url!==null&&typeof row.artifact_url!=='string'))return fail();
    if(action==='publish'&&row.audience!==input.audience)return fail();
  }else if(invitationId||action==='invitations'){
    const expected=action==='invitations'?'pending':action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
    if(typeof row.invitation_id!=='string'||typeof row.squad_name!=='string'||typeof row.recipient_name!=='string'||row.state!==expected)return fail();
    if(action==='invitations'&&(row.owner_ref!==actorId||row.recipient_ref!==input.recipient_ref))return fail();
    if(invitationId&&(action==='withdraw'?row.owner_ref!==actorId:row.recipient_ref!==actorId))return fail();
  }else if(path==='/squads'){
    if(row.owner_ref!==actorId||typeof row.name!=='string'||typeof row.purpose!=='string')return fail();
  }else if(action==='profile'){
    if(typeof row.name!=='string'||typeof row.purpose!=='string')return fail();
  }else if(action==='channel'){
    if(typeof row.communication_channel_name!=='string')return fail();
  }else if(action==='transfer'){
    if(row.owner_ref!==input.user_id)return fail();
  }else if(action==='disband'){
    if(typeof row.disbanded_at!=='string'||!Number.isFinite(Date.parse(row.disbanded_at)))return fail();
  }else{
    const memberId=/\/members\/([^/]+)\//.exec(path)?.[1]??actorId;
    const states=action==='request'?['pending','active']:action==='accept'?['active']:['left'];
    if(row.user_id!==memberId||!states.includes(String(row.state)))return fail();
  }
  return row;
}
function squadCommandLabel(path:string){
  if(path==='/squads')return '成立小隊';
  if(path.endsWith('/outcomes')||path.endsWith('/edit'))return '儲存成果草稿';
  const action=path.split('/').at(-1)??'';
  return ({publish:'發布成果',withdraw:path.startsWith('/squad-outcomes/')?'撤下成果':'撤回邀請',request:'申請加入',leave:'退出小隊',accept:'接受邀請或加入申請',decline:'婉拒邀請或加入申請',remove:'移除成員',transfer:'轉移隊主',disband:'解散小隊',profile:'修改名稱與目標',channel:'修改頻道名稱',invitations:'邀請夥伴'} as Record<string,string>)[action]??'更新小隊';
}
const emptyCreate={name:'',kind:'project' as SquadKind,purpose:'',communication_channel_name:''};
export function SquadsPanel({client,session,outcomesEnabled=false,eventLinksEnabled=false,registerLeave}:ModulePanelProps&{outcomesEnabled?:boolean;eventLinksEnabled?:boolean;registerLeave?:(guard:((hash:string|null)=>boolean)|null)=>void}){
  const [squads,setSquads]=useState<Squad[]>([]),[detail,setDetail]=useState<SquadDetail|null>(null);
  const [loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[nextOffset,setNextOffset]=useState<number|null>(null);
  const [query,setQuery]=useState(''),[kind,setKind]=useState<'all'|SquadKind>('all'),[onlyMine,setOnlyMine]=useState(false);
  const [failedOffset,setFailedOffset]=useState(0),[detailError,setDetailError]=useState(''),[detailLoading,setDetailLoading]=useState(false);
  const [creating,setCreating]=useState(false),[inviting,setInviting]=useState(false),[refreshToken,setRefreshToken]=useState(0);
  const nameInput=useRef<HTMLInputElement>(null),detailHeading=useRef<HTMLHeadingElement>(null),directoryHeading=useRef<HTMLHeadingElement>(null);
  const detailTrigger=useRef<HTMLElement|null>(null),createTrigger=useRef<HTMLButtonElement>(null);
  const detailRequest=useRef(0),listRequest=useRef(0),openSquad=useRef<string|null>(null),focusDetail=useRef(false);
  const selfId=session.user.user_id;
  const scope={userId:selfId,type:'squad-participation'};
  const mutationState=sharingMutationState(scope);
  const {mutate:baseMutate,busy:sending,error,lastFailureUnknown}=useModuleMutation(client,scope);
  const [pendingCommand,setPendingCommand,commandLive]=useAuthoringDraft<SquadCommand|null>(selfId,'squads:pending-command',null);
  const commandRef=useRef(pendingCommand),inFlight=useRef(false);commandRef.current=pendingCommand;
  const busy=sending||lastFailureUnknown;
  const [createDraft,setCreateDraft]=useAuthoringDraft(selfId,'squads:create',emptyCreate);
  const [returnSquad,setReturnSquad]=useAuthoringDraft<string|null>(selfId,'squads:outcome-return',null);
  const [confirmedOutcome,setConfirmedOutcome]=useState<Outcome|null>(null);
  const [dirtyOutcomes,setDirtyOutcomes]=useAuthoringDraft<Record<string,boolean>>(selfId,'squads:dirty-outcomes',{});
  const dirtyOutcomesRef=useRef(dirtyOutcomes);dirtyOutcomesRef.current=dirtyOutcomes;
  const [visitedManage,setVisitedManage]=useState(false),[visitedInvites,setVisitedInvites]=useState(false);
  const draftRef=useRef(createDraft);draftRef.current=createDraft;
  function blocksLeave(){return inFlight.current||mutationState.snapshot.busy||mutationState.snapshot.lastFailureUnknown;}
  useEffect(()=>{
    registerLeave?.(()=>{if(!blocksLeave())return true;setNotice('操作結果還沒確認，請先使用「確認原操作結果」。');return false;});
    const unload=(event:BeforeUnloadEvent)=>{if(blocksLeave()||Object.values(dirtyOutcomesRef.current).some(Boolean)||draftRef.current.name||draftRef.current.purpose||draftRef.current.communication_channel_name){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return()=>{registerLeave?.(null);window.removeEventListener('beforeunload',unload);};
  },[registerLeave,mutationState]);
  async function sendCommand<T,>(command:SquadCommand,retry=false):Promise<T|undefined>{
    if(!commandLive()||inFlight.current||mutationState.snapshot.busy||(!retry&&mutationState.snapshot.lastFailureUnknown))return;
    if(retry&&commandRef.current!==command)return;
    inFlight.current=true;commandRef.current=command;setPendingCommand(command);setNotice('');
    try{
      const result=await baseMutate<T>(command.path,command.body,command.version,value=>confirmedSquadCommand(value,command.path,selfId,command.body) as T);
      if(!commandLive())return;
      if(result!==undefined||!mutationState.snapshot.lastFailureUnknown){commandRef.current=null;setPendingCommand(null);}
      // A failed owner command may mean permission changed. Refresh the detail
      // without treating its current state as acknowledgement of the write.
      if(result===undefined&&openSquad.current)await open(openSquad.current);
      return result;
    }finally{inFlight.current=false;}
  }
  const mutate:ReturnType<typeof useModuleMutation>['mutate']=<T,>(path:string,body:unknown,version?:number|string)=>
    sendCommand<T>(Object.freeze({path,body:JSON.parse(JSON.stringify(body)),version}));
  async function retryOriginal(){
    const command=commandRef.current;if(!command)return;
    const result=await sendCommand<Record<string,unknown>>(command,true);if(!result)return;
    if(command.path==='/squads'){await created(result as unknown as Squad);return;}
    if(typeof result.outcome_id==='string')setConfirmedOutcome(result as unknown as Outcome);
    await refreshAll('原操作已確認；以下顯示重新讀取的小隊資料。');
  }
  async function load(offset=0){
    const token=++listRequest.current;setLoading(true);setLoadError('');setFailedOffset(offset);
    try{const data=await client.get<{items:Squad[];next_offset:number|null}>(`/squads?limit=20&offset=${offset}`);
      if(token!==listRequest.current)return;
      setSquads(current=>offset?[...current,...data.items]:data.items);setNextOffset(data.next_offset);
    }catch(e){if(token===listRequest.current)setLoadError(message(e,'無法載入小隊。'));}
    finally{if(token===listRequest.current)setLoading(false);}
  }
  async function open(id:string,trigger?:HTMLElement,invite=false){
    const token=++detailRequest.current;openSquad.current=id;setDetailError('');setDetailLoading(true);
    if(trigger)detailTrigger.current=trigger;
    try{const data=await client.get<SquadDetail>(`/squads/${id}`);if(token!==detailRequest.current)return;
      const own=data.members.find(member=>member.user_id===selfId);
      if(trigger){focusDetail.current=true;setInviting(invite);setVisitedManage(!invite);setVisitedInvites(invite);}
      setCreating(false);setDetail({...data,membership:own?{state:own.state,aggregate_version:own.aggregate_version}:null});
    }catch(e){if(token===detailRequest.current){
      if(e instanceof ApiError&&[401,403,404].includes(e.status)){closeDetail();setNotice('這支小隊已不存在或目前無法查看，已返回列表。');}
      else setDetailError(message(e,'無法載入小隊。'));
    }}
    finally{if(token===detailRequest.current)setDetailLoading(false);}
  }
  useEffect(()=>{if(!focusDetail.current)return;focusDetail.current=false;detailHeading.current?.focus();},[detail]);
  useEffect(()=>{if(creating)nameInput.current?.focus();},[creating]);
  async function refreshAll(text:string){
    if(text)setNotice(text);setRefreshToken(token=>token+1);
    await Promise.all([load(),openSquad.current?open(openSquad.current):undefined]);
  }
  useEffect(()=>{void load();if(returnSquad){focusDetail.current=true;setVisitedManage(true);void open(returnSquad);setReturnSquad(null);}return ()=>{listRequest.current++;detailRequest.current++;};},[client]);
  function closeDetail(){
    detailRequest.current++;openSquad.current=null;setDetail(null);setDetailLoading(false);setDetailError('');setInviting(false);
    requestAnimationFrame(()=>{if(detailTrigger.current?.isConnected)detailTrigger.current.focus();else directoryHeading.current?.focus();});
  }
  async function created(result:Squad){
    const navigation=++detailRequest.current;
    setCreateDraft(emptyCreate);setNotice('小隊已成立，現在可以邀請夥伴。');setCreating(false);setQuery('');setKind('all');setOnlyMine(false);
    await load();if(navigation!==detailRequest.current)return;await open(result.squad_id,createTrigger.current??undefined,true);
  }
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const result=await mutate<Squad>('/squads',{...createDraft});
    if(result)await created(result);
  }
  async function saveChannel(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!detail)return;
    const name=new FormData(event.currentTarget).get('communication_channel_name');
    const result=await mutate(`/squads/${detail.squad_id}/channel`,{communication_channel_name:name},detail.aggregate_version);
    await refreshAll(result?'小隊溝通頻道已更新，所有會員都看得見。':'');
  }
  async function change(squad:Squad,action:string,version?:number){
    const result=await mutate<{state?:string}>(`/squads/${squad.squad_id}/${action}`,{},version);
    await refreshAll(result?(action==='request'?(result.state==='active'?'你已是這支小隊的成員。':'加入申請已送出，等待隊主接受。'):'小隊資料已更新。'):'');
  }
  const search=query.trim().toLocaleLowerCase();
  const visibleSquads=squads.filter(squad=>(!onlyMine||squad.owner_ref===selfId||['active','pending'].includes(squad.membership?.state??''))&&(kind==='all'||squad.kind===kind)&&(!search||[squad.name,squad.purpose,squad.communication_channel_name,squad.owner_name].join(' ').toLocaleLowerCase().includes(search)));
  const filtered=Boolean(search||kind!=='all'||onlyMine),isOwner=detail?.owner_ref===selfId;
  return <section className="module-panel squad-panel">
    <div hidden={Boolean(detail)||creating}>
      <ModuleBanner eyebrow="" title="找夥伴，一起完成想做的事" description="先看小隊目標，再申請加入；隊長接受後才會成為成員。">
        <button ref={createTrigger} className="btn btn-primary" onClick={()=>{detailRequest.current++;openSquad.current=null;setDetailLoading(false);setCreating(true);}}>成立一支小隊</button>
      </ModuleBanner>
    </div>
    <Status error={loadError||detailError||error} notice={notice}/>
    {(sending||lastFailureUnknown)&&<div className="squad-recovery" role="status">
      {pendingCommand&&<strong>待確認的操作：{squadCommandLabel(pendingCommand.path)}</strong>}
      <p>{sending?'正在送出操作，請稍候…':'這次操作可能已成功，結果尚未確認。請勿重新建立或改送另一筆。'}</p>
      {lastFailureUnknown&&pendingCommand&&<button type="button" className="btn btn-secondary btn-small" disabled={sending||detailLoading} onClick={()=>void retryOriginal()}>確認原操作結果</button>}
    </div>}
    {detailError&&openSquad.current&&<button className="btn btn-secondary btn-small" disabled={detailLoading} onClick={()=>void open(openSquad.current!)}>重新載入小隊詳情</button>}
    {detailLoading&&<p role="status">正在載入小隊詳情…</p>}
    <div hidden={Boolean(detail)||creating} className="stack">
      <ReceivedInvitations client={client} mutate={mutate} busy={busy} refreshToken={refreshToken} onChanged={refreshAll}/>
      <section className="squad-directory" aria-labelledby="squad-directory-heading">
        <div className="squad-directory-heading"><h3 id="squad-directory-heading" ref={directoryHeading} tabIndex={-1}>尋找小隊</h3>
          <div className="actions squad-scope" role="group" aria-label="小隊列表範圍">
            <button type="button" className="btn btn-ghost" aria-pressed={!onlyMine} onClick={()=>setOnlyMine(false)}>尋找小隊</button>
            <button type="button" className="btn btn-ghost" aria-pressed={onlyMine} onClick={()=>setOnlyMine(true)}>我的小隊與申請</button>
          </div>
        </div>
        <p className="field-hint">{onlyMine?'我建立、已加入或已送出申請的小隊；申請中不代表已加入。':'依目標找夥伴。收到的邀請在上方回覆，不需要再申請一次。'}</p>
        <div className="discovery-toolbar">
          <label className="field discovery-search">搜尋小隊<input data-guide-anchor="squads:search" type="search" value={query} maxLength={150} onChange={event=>setQuery(event.target.value)} placeholder="小隊名稱、目標、頻道或隊主"/></label>
          <label className="field">篩選小隊類型<select value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="all">全部類型</option>{kindOptions}</select></label>
        </div>
        <div className="discovery-feedback">
          {squads.length>0&&<p role="status">顯示 {visibleSquads.length} / {squads.length} 支小隊</p>}
          {filtered&&<button className="btn btn-ghost" onClick={()=>{setQuery('');setKind('all');}}>清除小隊篩選</button>}
        </div>
        {nextOffset!==null&&<p className="field-hint">目前只篩選已載入的小隊。載入更多，可繼續找夥伴。</p>}
        <div className="card-grid">{visibleSquads.map(squad=><article className="card expedition-squad" key={squad.squad_id}>
          <span className="eyebrow">{kindLabels[squad.kind]}</span><h3>{squad.name}</h3>
          <p className="squad-purpose">{squad.purpose}</p>
          {squad.communication_channel_name&&<p className="muted squad-channel">溝通頻道：{squad.communication_channel_name}</p>}
          <p className="muted squad-meta"><span>隊長：{squad.owner_name}</span><span>{squad.member_count} 位夥伴</span></p>
          <div className="actions">
            <button className="btn btn-ghost" aria-label={`查看小隊：${squad.name}`} onClick={event=>void open(squad.squad_id,event.currentTarget)}>查看小隊</button>
            {squad.owner_ref===selfId?<button className="btn btn-ghost" aria-label={`邀請夥伴：${squad.name}`} onClick={event=>void open(squad.squad_id,event.currentTarget,true)}>邀請夥伴</button>
              :squad.membership?.state==='active'?<span className="badge">已加入</span>
              :squad.membership?.state==='pending'?<span className="muted">等候隊主接受</span>
              :<button className="btn btn-ghost" disabled={busy} onClick={()=>void change(squad,'request',squad.membership?.aggregate_version)}>申請加入</button>}
          </div>
        </article>)}</div>
        {loading&&<p role="status">正在載入小隊…</p>}
        {!loading&&!loadError&&!visibleSquads.length&&<div className="discovery-empty"><h4>{search||kind!=='all'?'沒有符合條件的小隊':onlyMine?'目前沒有你的小隊或申請':'還沒有小隊'}</h4><p className="field-hint">{onlyMine?'切回「尋找小隊」查看目標，再決定是否申請加入。':filtered?'試試其他名稱或清除搜尋與類型篩選。':'你可以成立小隊，寫下目標後邀請夥伴。'}</p></div>}
        {loadError&&<button className="btn btn-ghost" disabled={loading} onClick={()=>void load(failedOffset)}>重新載入小隊</button>}
        {nextOffset!==null&&<button className="btn btn-ghost" disabled={loading} onClick={()=>void load(nextOffset)}>查看更多小隊</button>}
      </section>
    </div>
    {detail&&<section className="card stack expedition-squad-detail" aria-label="小隊詳情">
      <div className="card-head"><h3 ref={detailHeading} tabIndex={-1}>{detail.name}的夥伴</h3><button className="btn btn-ghost" onClick={closeDetail}>返回小隊列表</button></div>
      <p className="muted">{kindLabels[detail.kind]} · 隊長：{detail.members.find(member=>member.user_id===detail.owner_ref)?.nickname??'目前不可用的會員'}</p>
      <p className="multiline-text">{detail.purpose}</p>
      {detail.communication_channel_name&&<p className="muted">溝通頻道：{detail.communication_channel_name}</p>}
      {isOwner&&<div className="actions squad-detail-actions" aria-label="小隊操作">
        <button className="btn btn-ghost" aria-pressed={!inviting} onClick={()=>{setInviting(false);setVisitedManage(true);}}>成員與管理</button>
        <button className="btn btn-ghost" aria-pressed={inviting} onClick={()=>{setInviting(true);setVisitedInvites(true);}}>邀請夥伴</button>
      </div>}
      {isOwner&&visitedInvites&&<div hidden={!inviting}><OwnerInvitations key={detail.squad_id} client={client} squad={detail} selfId={selfId} mutate={mutate} busy={busy} refreshToken={refreshToken} onChanged={refreshAll}/></div>}
      {isOwner&&visitedManage&&<div hidden={inviting}><SquadOwnerTools key={detail.squad_id} squad={detail} selfId={selfId} mutate={mutate} busy={busy} onChanged={refreshAll} onDisbanded={async text=>{closeDetail();await refreshAll(text);}}>
          <form className="stack" onSubmit={saveChannel}>
            <label className="field">小隊溝通頻道名稱<input key={`${detail.squad_id}-${detail.aggregate_version}`} name="communication_channel_name" disabled={busy} defaultValue={detail.communication_channel_name} maxLength={100} placeholder="例如 LINE 頻道名稱"/></label>
            <p className="field-hint">所有會員都看得見；請勿填私人邀請連結。留空可移除。</p>
            <div className="actions"><button className="btn btn-ghost" disabled={busy}>儲存頻道名稱</button></div>
          </form>
        </SquadOwnerTools></div>}
      {!isOwner&&<>{detail.members.map(member=><div className="member-request" key={member.user_id}><span>{member.nickname} · {member.state==='active'?'已加入':'申請中'}</span></div>)}</>}
      {(isOwner||detail.membership?.state==='active')&&<p className="field-hint">已加入這支小隊。可從右下角訊息泡泡開啟「小隊」聊天；頻道與聯絡資料依目前成員資格開放。</p>}
      {!isOwner&&(detail.membership?.state==='active'?<div className="actions"><button className="btn btn-ghost" disabled={busy} onClick={()=>void change(detail,'leave',detail.membership?.aggregate_version)}>退出這支小隊</button></div>
        :detail.membership?.state==='pending'?<p className="muted">等候隊主接受</p>:<div className="actions"><button className="btn btn-primary" disabled={busy} onClick={()=>void change(detail,'request',detail.membership?.aggregate_version)}>申請加入</button><p className="field-hint">隊長接受後，才能查看分享給小隊的聯絡方式。</p></div>)}
    </section>}
    {detail&&outcomesEnabled&&<section className="card stack"><SquadOutcomePublisher key={detail.squad_id} client={client} squadId={detail.squad_id} owner={detail.owner_ref===session.user.user_id} actorId={session.user.user_id} eventLinksEnabled={eventLinksEnabled} mutate={mutate} busy={busy} confirmed={confirmedOutcome} onDirtyChange={dirty=>setDirtyOutcomes(current=>current[detail.squad_id]===dirty?current:{...current,[detail.squad_id]:dirty})} onConfirmationApplied={()=>setConfirmedOutcome(null)} onOpenOutcome={()=>setReturnSquad(detail.squad_id)}/></section>}
    {creating&&<div className="squad-start">
      <form className="card stack" onSubmit={create}>
        <div className="card-head"><h3>成立一支小隊</h3><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>{setCreating(false);requestAnimationFrame(()=>createTrigger.current?.focus());}}>返回小隊列表</button></div>
        <p className="field-hint">你會成為隊長；成立後再邀請夥伴，由對方決定是否加入。每人最多建立 10 支小隊。</p>
        <p className="field-hint">返回列表會保留這次登入的輸入，尚未成立小隊；重新整理或登出後不保留。</p>
        <label className="field">小隊名稱<input ref={nameInput} name="name" required maxLength={80} disabled={busy} value={createDraft.name} onChange={event=>setCreateDraft({...createDraft,name:event.target.value})}/></label>
        <label className="field">小隊類型<select name="kind" disabled={busy} value={createDraft.kind} onChange={event=>setCreateDraft({...createDraft,kind:event.target.value as SquadKind})}>{kindOptions}</select></label>
        <label className="field">我們想一起完成什麼<textarea name="purpose" required maxLength={800} disabled={busy} value={createDraft.purpose} onChange={event=>setCreateDraft({...createDraft,purpose:event.target.value})} placeholder="寫下目標，以及想找哪些夥伴。"/></label>
        <label className="field">小隊溝通頻道名稱（選填）<input name="communication_channel_name" maxLength={100} disabled={busy} value={createDraft.communication_channel_name} onChange={event=>setCreateDraft({...createDraft,communication_channel_name:event.target.value})} placeholder="例如 LINE 頻道名稱"/></label>
        <p className="field-hint">所有會員都看得見；請勿填私人邀請連結。</p>
        <div className="actions"><button className="btn btn-primary" disabled={busy}>成立小隊</button></div>
      </form>
    </div>}
  </section>;
}
