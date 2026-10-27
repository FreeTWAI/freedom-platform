import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {MemberCard,loadLabels,type MemberCardData} from './Membership';
import {MemberAvatar} from './MemberAvatar';
import {useModuleMutation} from './shared';
import './MemberConnections.css';
type Page={items:{member:MemberCardData;reason:string}[];total:number;next_offset:number};
export function MemberRecommendations({client}:{client:PortalClient}){
  const [page,setPage]=useState<Page|null>(null),[labels,setLabels]=useState<Record<string,string>>({}),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[expanded,setExpanded]=useState(false);
  const generation=useRef(0),pending=useRef<number|null>(null),attemptedOffset=useRef(0),active=useRef(false),owner=useRef(client),{mutate,busy,error}=useModuleMutation(client);
  const session=client.sessionGeneration;
  async function load(offset=0){
    if(!active.current||owner.current!==client||client.sessionGeneration!==session||pending.current!==null)return;
    const current=++generation.current;pending.current=current;attemptedOffset.current=offset;
    const live=()=>active.current&&owner.current===client&&current===generation.current&&client.sessionGeneration===session;
    setLoading(true);setLoadError('');setPage(null);setExpanded(false);
    try{const data=await client.get<Page>(`/members/recommendations?limit=1&offset=${offset}`);if(live())setPage(data);}
    catch(cause){if(live())setLoadError(cause instanceof Error?cause.message:'暫時無法推薦夥伴。');}
    finally{if(live())setLoading(false);if(pending.current===current)pending.current=null;}
  }
  useLayoutEffect(()=>{
    active.current=true;owner.current=client;attemptedOffset.current=0;pending.current=null;setPage(null);setLoadError('');setNotice('');setLoading(true);setExpanded(false);
    return()=>{active.current=false;generation.current++;pending.current=null;};
  },[client,session]);
  useEffect(()=>{void load(0);let live=true;void loadLabels(client).then(data=>{if(live&&client.sessionGeneration===session)setLabels(data);}).catch(()=>{});return()=>{live=false;};},[client,session]);
  const recommendation=page?.items[0],member=recommendation?.member;
  async function invite(){
    if(!member||busy||!active.current||owner.current!==client||client.sessionGeneration!==session)return;
    const current=generation.current;setNotice('');
    const result=await mutate(`/friends/${member.user_id}/request`,{},member.friendship.aggregate_version);
    if(result&&active.current&&owner.current===client&&current===generation.current&&client.sessionGeneration===session){setNotice(`已向${member.nickname}送出好友邀請。`);await load(0);}
  }
  return <section className="card stack member-recommendation home-partner" aria-label="認識一位工坊夥伴"><div className="card-head home-partner-heading"><h2>認識一位工坊夥伴</h2><button type="button" className="btn btn-ghost home-partner-swap" disabled={loading||busy||Boolean(loadError)} onClick={()=>void load(page?.next_offset??0)}>換一位</button></div>
    {loading&&<p role="status">正在找可以認識的夥伴…</p>}
    {loadError&&<div role="alert" className="banner banner-error"><p>{loadError}</p><button type="button" className="btn btn-ghost" disabled={loading} onClick={()=>void load(attemptedOffset.current)}>重讀推薦</button></div>}
    {!loading&&!loadError&&member&&<><div className="connection-person"><MemberAvatar nickname={member.nickname} avatarUrl={member.avatar_url}/><div><h3>{member.nickname}</h3><p>{member.primary_guild?.name??'自由工坊夥伴'}</p></div></div><p className="recommendation-reason">{recommendation.reason}</p><div className="tag-list">{(member.featured_capabilities??member.capabilities.slice(0,3)).map(id=><span key={id} className="pill">{id.startsWith('custom:')?id.slice(7):labels[id]??id}</span>)}</div>
      <div className="actions"><button type="button" className="btn btn-ghost" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起名片':'查看名片'}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>void invite()}>邀請成為好友</button></div>{expanded&&<MemberCard member={member} labels={labels} client={client}/>}</>}
    {!loading&&!loadError&&!member&&<p>目前沒有新的推薦夥伴。可以到工坊夥伴頁探索，或邀請朋友加入。</p>}
    {error&&<p role="alert" className="banner banner-error">{error}</p>}{notice&&<p role="status" className="field-hint">{notice}</p>}
  </section>;
}
