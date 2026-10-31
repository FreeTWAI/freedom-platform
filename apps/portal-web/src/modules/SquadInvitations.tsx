import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {PortalClient} from '../api';
import type {useModuleMutation} from './shared';

// Invitation views own their read/search state; the parent retains the shared
// mutation lock, refresh orchestration and the owner view's squad key.
type InvitationSquad={squad_id:string;members:{user_id:string;state:string}[]};
type Invitation={invitation_id:string;squad_id:string;squad_name:string;owner_ref:string;owner_name:string;recipient_ref:string;recipient_name:string;state:'pending'|'accepted'|'declined'|'withdrawn';aggregate_version:number;created_at:string;updated_at:string;resolved_at:string|null};
type InvitationPage={items:Invitation[];next_offset:number|null};
type Mutate=ReturnType<typeof useModuleMutation>['mutate'];
const invitationLabels={pending:'待回覆',accepted:'已接受',declined:'已婉拒',withdrawn:'已撤回'};
const message=(e:unknown,fallback:string)=>e instanceof Error?e.message:fallback;

// A shared page loader: only the newest request may write, so a slow earlier
// page or filter never overwrites the list the member is looking at now.
function useInvitationPages(client:PortalClient,path:(offset:number)=>string,deps:unknown[]){
  const [items,setItems]=useState<Invitation[]>([]),[nextOffset,setNextOffset]=useState<number|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[failedOffset,setFailedOffset]=useState(0);
  const request=useRef(0);
  async function load(offset=0){const token=++request.current;setLoading(true);setError('');setFailedOffset(offset);try{const data=await client.get<InvitationPage>(path(offset));if(token!==request.current)return;setItems(current=>offset?[...current,...data.items]:data.items);setNextOffset(data.next_offset);}catch(e){if(token===request.current)setError(message(e,'無法載入小隊邀請。'));}finally{if(token===request.current)setLoading(false);}}
  useEffect(()=>{void load();return ()=>{request.current++;};},deps);
  return {items,nextOffset,loading,error,load,retry:()=>void load(failedOffset)};
}

export function ReceivedInvitations({client,mutate,busy,refreshToken,onChanged}:{client:PortalClient;mutate:Mutate;busy:boolean;refreshToken:number;onChanged:(notice:string)=>Promise<void>}){
  const [expanded,setExpanded]=useState(false);
  const [showAll,setShowAll]=useState(false),heading=useRef<HTMLHeadingElement>(null);
  const page=useInvitationPages(client,offset=>`/me/squad-invitations?state=${showAll?'all':'pending'}&limit=20&offset=${offset}`,[client,showAll,refreshToken]);
  useEffect(()=>{if(page.error||page.items.some(item=>item.state==='pending'))setExpanded(true);},[page.error,page.items]);
  async function respond(invitation:Invitation,action:'accept'|'decline'){
    const result=await mutate<Invitation>(`/squad-invitations/${invitation.invitation_id}/${action}`,{},invitation.aggregate_version);
    if(result){await onChanged(action==='accept'?`已加入「${result.squad_name}」。`:`已婉拒「${result.squad_name}」的邀請。`);heading.current?.focus();}
    else await onChanged(''); // Keep the error visible, but replace a stale pending row with the current record.
  }
  return <section className="squad-invitations" aria-labelledby="received-squad-invitations">
    <details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary><h3 id="received-squad-invitations" data-guide-anchor="squads:invitations" ref={heading} tabIndex={-1}>收到的小隊邀請</h3><span className="muted">{page.loading?'載入中…':page.items.some(item=>item.state==='pending')?'有待回覆邀請':'查看紀錄'}</span></summary>
      <p className="field-hint">接受後會加入對方的小隊，並可查看成員選擇分享給小隊的聯絡資料；婉拒不會加入。</p>
      <label className="squad-invitations-toggle"><input type="checkbox" checked={showAll} onChange={event=>setShowAll(event.target.checked)}/>顯示已回覆</label>
    {page.items.length>0&&<ul className="squad-invitation-list">{page.items.map(invitation=><li key={invitation.invitation_id} className="squad-invitation">
      <div><strong>{invitation.squad_name}</strong><span className="muted">隊主：{invitation.owner_name} · {invitationLabels[invitation.state]}</span></div>
      {invitation.state==='pending'&&<div className="actions"><button className="btn btn-primary" disabled={busy} aria-label={`接受邀請：${invitation.squad_name}`} onClick={()=>void respond(invitation,'accept')}>接受</button><button className="btn btn-ghost" disabled={busy} aria-label={`婉拒邀請：${invitation.squad_name}`} onClick={()=>void respond(invitation,'decline')}>婉拒</button></div>}
    </li>)}</ul>}
    {page.loading&&<p role="status">正在載入小隊邀請…</p>}
    {page.error&&<><p role="alert" className="banner banner-error">{page.error}</p><button className="btn btn-ghost" disabled={page.loading} onClick={page.retry}>重新載入邀請</button></>}
    {!page.loading&&!page.error&&!page.items.length&&<p className="field-hint">{showAll?'還沒有收到小隊邀請。':'目前沒有待回覆的小隊邀請。'}</p>}
    {page.nextOffset!==null&&!page.error&&<button className="btn btn-ghost" disabled={page.loading} onClick={()=>void page.load(page.nextOffset!)}>查看更多邀請</button>}
    </details>
  </section>;
}

type Candidate={user_id:string;nickname:string;positioning_title?:string|null};
export function OwnerInvitations({client,squad,selfId,mutate,busy,refreshToken,onChanged}:{client:PortalClient;squad:InvitationSquad;selfId:string;mutate:Mutate;busy:boolean;refreshToken:number;onChanged:(notice:string)=>Promise<void>}){
  const outgoing=useInvitationPages(client,offset=>`/squads/${squad.squad_id}/invitations?limit=20&offset=${offset}`,[client,squad.squad_id,refreshToken]);
  const [search,setSearch]=useState(''),[candidates,setCandidates]=useState<Candidate[]|null>(null),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState('');
  const searchRequest=useRef(0),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>()=>{searchRequest.current++;},[]);
  async function find(event?:FormEvent<HTMLFormElement>){event?.preventDefault();const token=++searchRequest.current;setSearching(true);setSearchError('');
    try{const data=await client.get<{items:Candidate[]}>(`/members?limit=20&sort=nickname&search=${encodeURIComponent(search.trim())}`);if(token===searchRequest.current)setCandidates(data.items.filter(member=>member.user_id!==selfId));}
    catch(e){if(token===searchRequest.current)setSearchError(message(e,'無法搜尋夥伴。'));}finally{if(token===searchRequest.current)setSearching(false);}}
  function status(candidate:Candidate){
    const member=squad.members.find(row=>row.user_id===candidate.user_id);
    if(member?.state==='active')return '已在小隊';
    if(outgoing.items.some(row=>row.recipient_ref===candidate.user_id&&row.state==='pending'))return '已邀請，等候回覆';
    if(member?.state==='pending')return '已申請加入，可直接接受';
    return null;
  }
  async function invite(candidate:Candidate){const result=await mutate<Invitation>(`/squads/${squad.squad_id}/invitations`,{recipient_ref:candidate.user_id});if(result){await onChanged(`已邀請 ${result.recipient_name}，等候對方回覆。`);heading.current?.focus();}else await onChanged('');}
  async function withdraw(invitation:Invitation){const result=await mutate<Invitation>(`/squad-invitations/${invitation.invitation_id}/withdraw`,{},invitation.aggregate_version);if(result){await onChanged(`已撤回給 ${result.recipient_name} 的邀請。`);heading.current?.focus();}else await onChanged('');}
  return <section className="squad-invite-manager stack" aria-label="邀請夥伴">
    <form className="squad-invite-search" onSubmit={find}><label className="field">搜尋要邀請的夥伴<input type="search" value={search} maxLength={100} onChange={event=>setSearch(event.target.value)} placeholder="暱稱、定位或技能"/></label><button className="btn btn-ghost" disabled={searching}>搜尋夥伴</button></form>
    <p className="field-hint">對方接受後才會加入小隊；接受前看不到只分享給小隊夥伴的聯絡方式。每支小隊最多保留 50 份待回覆邀請。</p>
    {searching&&<p role="status">正在搜尋夥伴…</p>}
    {searchError&&<><p role="alert" className="banner banner-error">{searchError}</p><button className="btn btn-ghost" onClick={()=>void find()}>重新搜尋</button></>}
    {candidates&&!searching&&!searchError&&(candidates.length?<ul className="squad-invitation-list" aria-label="搜尋結果">{candidates.map(candidate=>{const state=status(candidate);return <li key={candidate.user_id} className="squad-invitation">
      <div><strong>{candidate.nickname}</strong>{candidate.positioning_title&&<span className="muted">{candidate.positioning_title}</span>}</div>
      {state?<span className="muted">{state}</span>:<button className="btn btn-primary" disabled={busy||outgoing.loading||Boolean(outgoing.error)} aria-label={`邀請 ${candidate.nickname}`} onClick={()=>void invite(candidate)}>邀請</button>}
    </li>;})}</ul>:<p className="field-hint">沒有符合的夥伴。</p>)}
    <h4 ref={heading} tabIndex={-1}>送出的邀請</h4>
    {outgoing.items.length>0&&<ul className="squad-invitation-list">{outgoing.items.map(invitation=><li key={invitation.invitation_id} className="squad-invitation">
      <div><strong>{invitation.recipient_name}</strong><span className="muted">{invitationLabels[invitation.state]}</span></div>
      {invitation.state==='pending'&&<button className="btn btn-ghost" disabled={busy} aria-label={`撤回給 ${invitation.recipient_name} 的邀請`} onClick={()=>void withdraw(invitation)}>撤回邀請</button>}
    </li>)}</ul>}
    {outgoing.loading&&<p role="status">正在載入送出的邀請…</p>}
    {outgoing.error&&<><p role="alert" className="banner banner-error">{outgoing.error}</p><button className="btn btn-ghost" disabled={outgoing.loading} onClick={outgoing.retry}>重新載入送出的邀請</button></>}
    {!outgoing.loading&&!outgoing.error&&!outgoing.items.length&&<p className="field-hint">還沒有送出邀請。</p>}
    {outgoing.nextOffset!==null&&!outgoing.error&&<button className="btn btn-ghost" disabled={outgoing.loading} onClick={()=>void outgoing.load(outgoing.nextOffset!)}>查看更多送出的邀請</button>}
  </section>;
}
