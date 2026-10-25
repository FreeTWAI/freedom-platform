import {useLanguage} from '../language';
import type {InterfaceMessage} from '../interface-messages';
import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {requireItems,type PortalClient} from '../api';
import type {SessionPayload} from '../types';
import type {MemberCardData} from './Membership';
import {MemberAvatar} from './MemberAvatar';
import {personalContentActionPath,type PersonalContentItem} from './MyContent';
import {PERSONAL_SPACE_PAGE_SIZE,personalSpaceGuilds,isPersonalSpaceScope,personalPostPath,createPersonalPostPageReader,type PersonalPostResult} from './personal-space-model';
import './PersonalSpace.css';

type Hero=Pick<MemberCardData,'nickname'|'avatar_url'|'positioning_title'> & {guilds:ReturnType<typeof personalSpaceGuilds>};
type Snapshot={client:PortalClient;owner:string;generation:number;hero:Hero|null;items:PersonalContentItem[];profileError:boolean;contentError:boolean};
const kinds={all:'space.kind.all',social_post:'space.kind.social_post',showcase:'space.kind.showcase',skill_submission:'space.kind.skill_submission',event:'space.kind.event'} as const;
const states:Record<string,InterfaceMessage>={draft:'space.state.draft',active:'space.state.published',published:'space.state.published',hidden:'space.state.hidden',deleted:'space.state.deleted',withdrawn:'space.state.withdrawn',pending:'space.state.pending',rejected:'space.state.rejected',cancelled:'space.state.cancelled',awaiting_upload:'space.state.awaiting_upload',ready_for_review:'space.state.ready_for_review',revoked:'space.state.revoked'};
const audiences:Record<string,InterfaceMessage>={private:'space.audience.private',community:'space.audience.community',public:'space.audience.public',workshop:'space.audience.workshop',guild:'space.audience.guild',open:'space.audience.open',referral:'space.audience.referral'};

/** Signed-in owner's space, not a share capability or an author-directory endpoint. */
export function PersonalSpace({client,session,contentEnabled}:{client:PortalClient;session:SessionPayload;contentEnabled:boolean}){
  const {t}=useLanguage();
  const owner=session.user.user_id,generation=client.sessionGeneration;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
  const [filter,setFilter]=useState<keyof typeof kinds>('all'),[page,setPage]=useState(0);
  useEffect(()=>{
    let live=true;const abort=new AbortController(),started=client.sessionGeneration;
    setSnapshot(null);setLoading(true);setPage(0);
    const valid=()=>live&&!abort.signal.aborted&&client.sessionGeneration===started;
    void Promise.allSettled([client.get<MemberCardData>(`/members/${encodeURIComponent(owner)}`,{signal:abort.signal}),contentEnabled?client.get('/me/content',{signal:abort.signal}).then(value=>requireItems<PersonalContentItem>(value,'我的內容')):Promise.resolve([] as PersonalContentItem[])]).then(([profile,content])=>{
      if(!valid())return;
      const member=profile.status==='fulfilled'&&profile.value.user_id===owner&&profile.value.is_self?profile.value:null;
      // Never retain the contacts/security fields returned by the member DTO in view state.
      const hero=member?{nickname:member.nickname,avatar_url:member.avatar_url,positioning_title:member.positioning_title,guilds:personalSpaceGuilds(member)}:null;
      setSnapshot({client,owner,generation:started,hero,items:content.status==='fulfilled'?content.value:[],profileError:!hero,contentError:content.status==='rejected'});setLoading(false);
    });
    return()=>{live=false;abort.abort();};
  },[client,owner,generation,contentEnabled,revision]);
  useEffect(()=>{
    const refresh=()=>{setSnapshot(null);setLoading(true);setRevision(value=>value+1);};
    const visibility=()=>{if(document.visibilityState==='visible')refresh();else setSnapshot(null);};
    window.addEventListener('focus',refresh);window.addEventListener('freedom-profile-updated',refresh);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('freedom-profile-updated',refresh);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const current=isPersonalSpaceScope(snapshot,client,owner)?snapshot:null;
  const filtered=useMemo(()=>current?.items.filter(item=>filter==='all'||item.kind===filter)??[],[current,filter]);
  const maxPage=Math.max(0,Math.ceil(filtered.length/PERSONAL_SPACE_PAGE_SIZE)-1),selectedPage=Math.min(page,maxPage);
  const shown=useMemo(()=>filtered.slice(selectedPage*PERSONAL_SPACE_PAGE_SIZE,(selectedPage+1)*PERSONAL_SPACE_PAGE_SIZE),[filtered,selectedPage]);
  const retry=()=>{setSnapshot(null);setRevision(value=>value+1);};
  return <div className="personal-space stack">
    <section className="card personal-space-hero" aria-label={t('space.ownerSummary')}>
      {current?.hero ? <>
        <MemberAvatar nickname={current.hero.nickname} avatarUrl={current.hero.avatar_url}/>
        <div className="personal-space-identity">
          <p className="hint">{t('space.ownerOnly')}</p>
          <h2>{current.hero.nickname}</h2>
          {current.hero.positioning_title&&<p>{current.hero.positioning_title}</p>}
        </div>
      </> : <div className="personal-space-identity"><h2>{t('nav.profile')}</h2><p role="status">{current?.profileError?t('space.profileError'):t('space.profileLoading')}</p></div>}
      <div className="personal-space-hero-actions"><a className="btn btn-secondary btn-small" href="#account">{t('space.edit')}</a></div>
      {!!current?.hero?.guilds.length&&<details className="personal-space-memberships">
        <summary>{t('space.guilds')} <span>({current.hero.guilds.length})</span></summary>
        <ul className="personal-space-guilds" aria-label={t('space.guilds')}>{current.hero.guilds.map(guild=><li key={guild.guild_key}>{guild.name}</li>)}</ul>
      </details>}
    </section>
    <p className="hint personal-space-private">{t('space.privacy')}</p>
    <section className="personal-space-content stack" aria-label={t('space.content')}>
      <div className="section-head"><h2>{t('nav.my-content')}</h2><div className="actions">{contentEnabled&&<a href="#my-content" className="btn btn-secondary btn-small">{t('space.manage')}</a>}<button className="btn btn-secondary btn-small" type="button" onClick={retry}>{t('space.refresh')}</button></div></div>
      {!contentEnabled?<p className="empty">{t('space.disabled')}</p>:<>
        <div className="personal-space-filters" role="group" aria-label={t('space.filters')}>{Object.entries(kinds).map(([id,label])=><button key={id} type="button" className="btn btn-secondary btn-small" aria-pressed={filter===id} onClick={()=>{setFilter(id as keyof typeof kinds);setPage(0);}}>{t(label)}</button>)}</div>
        {(loading||!current)&&<p role="status">{t('space.loading')}</p>}
        {current?.contentError&&<div className="banner banner-error" role="alert">{t('space.error')}</div>}
        {current&&!current.contentError&&filtered.length===0&&<div className="card stack"><h3>{t('space.empty',{kind:t(filter==='all'?'space.emptyAll':kinds[filter])})}</h3><p>{t('space.emptyHint')}</p><div className="actions"><a className="btn btn-secondary btn-small" href="#social">{t('space.post')}</a><a className="btn btn-secondary btn-small" href="#my-content">{t('space.organize')}</a></div></div>}
        {current&&!current.contentError&&<PersonalContentPage key={`${owner}:${generation}:${revision}:${filter}:${selectedPage}`} client={client} owner={owner} items={shown}/>}
        {current&&!current.contentError&&filtered.length>PERSONAL_SPACE_PAGE_SIZE&&<nav className="actions personal-space-pagination" aria-label={t('space.pagination')}><button className="btn btn-secondary" disabled={selectedPage===0} onClick={()=>setPage(selectedPage-1)}>{t('space.previous')}</button><span aria-live="polite">{t('space.page',{page:selectedPage+1,total:maxPage+1})}</span><button className="btn btn-secondary" disabled={selectedPage>=maxPage} onClick={()=>setPage(selectedPage+1)}>{t('space.next')}</button></nav>}
      </>}
    </section>
  </div>;
}
function PersonalContentPage({client,owner,items}:{client:PortalClient;owner:string;items:PersonalContentItem[]}){
  const {t,language}=useLanguage();
  const [previews,setPreviews]=useState<Record<string,PersonalPostResult>>({});
  const reader=useRef<ReturnType<typeof createPersonalPostPageReader>|null>(null);
  const cards=useRef<Record<string,HTMLElement|null>>({});
  const retryFocus=useRef<{id:string;button:HTMLButtonElement}|null>(null);
  useLayoutEffect(()=>{
    const abort=new AbortController();
    const current=createPersonalPostPageReader(client,owner,items,abort.signal,(id,result)=>setPreviews(previous=>({...previous,[id]:result})));
    reader.current=current;setPreviews({});void current.load();
    return()=>{abort.abort();retryFocus.current=null;if(reader.current===current)reader.current=null;};
  },[client,owner,items]);
  useLayoutEffect(()=>{
    const pending=retryFocus.current;if(!pending||previews[pending.id]?.state==='retrying')return;
    retryFocus.current=null;
    // Only replace focus lost with this control; never steal it back after the user moved on.
    if(document.activeElement===document.body){
      const card=cards.current[pending.id],target=pending.button.isConnected?pending.button:(card?.querySelector<HTMLAnchorElement>('a')??card);
      target?.focus({preventScroll:true});
    }
  },[previews]);
  return <div className="personal-space-feed">{items.map(item=>{
    const result=previews[item.id],post=result?.state==='ready'?result.post:null;
    const action=item.actions.includes('view')?'view':item.actions.find(value=>['manage','continue','edit'].includes(value));
    const social=item.kind==='social_post',path=social?(post?personalPostPath(item):null):(action?personalContentActionPath(item,action):null);
    return <article ref={node=>{cards.current[item.id]=node;}} tabIndex={-1} className="card stack personal-space-entry" key={`${item.kind}:${item.id}`} aria-label={`${t(kinds[item.kind])}：${item.title}`}>
      <div className="personal-space-entry-meta"><span>{t(kinds[item.kind])}</span><span>{states[item.status]?t(states[item.status]):item.status}</span><span>{audiences[item.visibility]?t(audiences[item.visibility]):item.visibility}</span></div>
      <h3>{post?.title||item.title||t('space.untitled')}</h3>
      {post&&<>{post.note&&<PersonalPostText text={post.note}/>}{post.thumbnail_url&&<PersonalPostPhoto url={post.thumbnail_url}/>}<time dateTime={post.created_at}>{new Date(post.created_at).toLocaleDateString(language)}</time></>}
      {social&&personalPostPath(item)&&(!result||result.state==='retrying')&&<p role="status">{t('space.postLoading')}</p>}
      {social&&result?.state==='unavailable'&&<p>{t('space.postUnavailable')}</p>}
      {social&&result?.state==='error'&&<p role="status">{t('space.postError')}</p>}
      {social&&(result?.state==='retrying'||(result?.state==='error'&&result.retryable))&&<button type="button" className="btn btn-secondary btn-small" disabled={result.state==='retrying'} aria-busy={result.state==='retrying'} onClick={event=>{if(document.activeElement===event.currentTarget)retryFocus.current={id:item.id,button:event.currentTarget};void reader.current?.retry(item.id);}}>{t('feedback.retry')}</button>}
      {path&&<a className="btn btn-secondary btn-small personal-space-source" href={path}>{social?t('space.openPost'):t('space.openSource')}</a>}
    </article>;
  })}</div>;
}

/** Four visible lines initially, including short text that wraps on narrow screens. */
function PersonalPostText({text}:{text:string}){
  const {t}=useLanguage();
  const [expanded,setExpanded]=useState(false),[truncated,setTruncated]=useState(text.length>180||text.split('\n').length>4);
  const body=useRef<HTMLParagraphElement>(null),id=useId();
  useLayoutEffect(()=>{
    if(expanded)return;
    const measure=()=>{if(body.current)setTruncated(body.current.scrollHeight>body.current.clientHeight+1);};
    measure();const observer=new ResizeObserver(measure);if(body.current)observer.observe(body.current);return()=>observer.disconnect();
  },[text,expanded]);
  return <div><p ref={body} id={id} className={`personal-space-body${expanded?'':' is-preview'}`}>{text}</p>{(truncated||expanded)&&<button type="button" className="btn btn-ghost btn-small" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?t('space.collapse'):t('space.expand')}</button>}</div>;
}

function PersonalPostPhoto({url}:{url:string}){
  const {t}=useLanguage();
  const [failed,setFailed]=useState(false);
  return failed?<p className="hint" role="status">{t('space.photoError')}</p>:<img className="personal-space-photo" src={url} alt={t('space.photo')} loading="lazy" width="640" height="360" onError={()=>setFailed(true)}/>;
}
