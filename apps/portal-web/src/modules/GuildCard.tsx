import {useEffect,useId,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {useLanguage,type InterfaceLanguage} from '../language';
import {guildMasterLabel,type GuildSummary} from './Onboarding';
import {GuildName} from './GuildName';
import {GuildLeadership} from './GuildLeadership';
import {GuildMembers} from './GuildMembers';
import {GuildAnnouncements} from './GuildWorkspace';
import {SkillBookIntro} from './SkillBookIntro';
import {GuildTags} from './GuildFilters';
import {openMemberChat} from './chat-entry';
import {SkillBookStarGate} from './SkillBookCover';

type GuildPanel='overview'|'books'|'members'|'announcements';
type CommunityCopy={enter:string;overview:string;books:string;members:string;announcements:string;navigation:string;about:string;next:string;chat:string};
const communityCopy:Record<InterfaceLanguage,CommunityCopy>={
  'zh-Hant':{enter:'查看公會介紹',overview:'社群總覽',books:'技能書庫',members:'成員',announcements:'公告',navigation:'公會內容',about:'我們一起做什麼',next:'從這裡開始',chat:'進入公會聊天室'},
  en:{enter:'About this guild',overview:'Community overview',books:'Skill library',members:'Members',announcements:'Announcements',navigation:'Guild content',about:'What we do together',next:'Start here',chat:'Open guild chat'},
  ja:{enter:'ギルド紹介を見る',overview:'コミュニティ概要',books:'スキルライブラリ',members:'メンバー',announcements:'お知らせ',navigation:'ギルドの内容',about:'一緒に取り組むこと',next:'ここから始める',chat:'ギルドチャットを開く'},
  ko:{enter:'길드 소개 보기',overview:'커뮤니티 개요',books:'스킬 라이브러리',members:'멤버',announcements:'공지',navigation:'길드 콘텐츠',about:'함께 하는 일',next:'여기서 시작하기',chat:'길드 채팅 열기'},
  es:{enter:'Conocer el gremio',overview:'Vista de la comunidad',books:'Biblioteca de habilidades',members:'Miembros',announcements:'Anuncios',navigation:'Contenido del gremio',about:'Qué hacemos juntos',next:'Empieza aquí',chat:'Abrir chat del gremio'},
};

export type GuildCategorySlot={pending:boolean;selected:boolean;section:string;onToggle?:()=>void;actionId?:string};
export function GuildCard({guild:g,client,busy,writesBlocked=false,onPrimary,onMembership,onSecondary,secondaryFull=false,viewerId,onChanged,categorySlot,launchpadEnabled=false,onLaunchpad}:{guild:GuildSummary;client:PortalClient;busy:boolean;writesBlocked?:boolean;onPrimary:()=>void;onMembership:()=>void;onSecondary?:()=>void;secondaryFull?:boolean;viewerId?:string;onChanged?:()=>void;categorySlot?:GuildCategorySlot;launchpadEnabled?:boolean;onLaunchpad?:()=>void}) {
  const [panel,setPanel]=useState<GuildPanel|null>(null);
  const [membersVisited,setMembersVisited]=useState(false);
  const {language}=useLanguage(),copy=communityCopy[language];
  const sessionGeneration=client.sessionGeneration;
  const owner=useRef({client,viewerId,guildKey:g.guild_key,sessionGeneration});
  const sameOwner=owner.current.client===client&&owner.current.viewerId===viewerId&&owner.current.guildKey===g.guild_key&&owner.current.sessionGeneration===sessionGeneration;
  const visiblePanel=sameOwner?panel:null;
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement|null>(null),titleId=useId();
  const active=g.membership?.state==='active',firstBook=g.skill_books[0],legacyPrimary=!categorySlot&&g.is_primary;
  const title=visiblePanel==='overview'?`${g.name} · ${copy.overview}`:`${g.name}${visiblePanel==='books'?'技能書庫':visiblePanel==='members'?'成員':'公告'}`;
  const badge=categorySlot?(categorySlot.selected?'本類主力':categorySlot.pending?'分類整理中':active?'已加入':'未加入'):g.is_primary?'主要公會':g.is_secondary?'次要公會':active?'已加入':'未加入';
  useEffect(()=>{if(panel&&!dialog.current?.open)dialog.current?.showModal();},[panel]);
  // A new viewer/client must never render a previous owner's loaded detail.
  useEffect(()=>{
    if(sameOwner)return;
    dialog.current?.close();setPanel(null);setMembersVisited(false);
    owner.current={client,viewerId,guildKey:g.guild_key,sessionGeneration};
  },[client,viewerId,g.guild_key,sessionGeneration,sameOwner]);
  useEffect(()=>{if(!active&&(panel==='overview'||panel==='announcements'))close();},[active,panel]);
  function choose(value:GuildPanel){setPanel(value);if(value==='members')setMembersVisited(true);}
  function open(value:GuildPanel,button:HTMLButtonElement){trigger.current=button;choose(value);}
  function close(){dialog.current?.close();setPanel(null);setMembersVisited(false);trigger.current?.focus();}
  function chat(){if(!active||!sameOwner)return;close();openMemberChat('guild',g.guild_key);}
  return <article className={`card guild-card${legacyPrimary||categorySlot?.selected?' primary-guild':active?' joined-guild':''}`} aria-label={g.name} data-guild-key={g.guild_key} tabIndex={-1}>
    <div className="guild-card-content">
      <div className="card-head guild-card-topline"><h3><GuildName name={g.name} alias={g.alias}/></h3><span className="badge">{badge}</span></div>
      <GuildLeadership masterName={guildMasterLabel(g)} masterId={g.guild_master?.user_id} masterAvatarUrl={g.guild_master?.avatar_url} experts={g.guild_experts}/>
      <p className="guild-purpose multiline-text">{g.purpose}</p>{active&&g.membership?.member_tier==='intern'&&<p className="field-hint guild-intern-notice" role="status">你是這個公會的實習成員：可以閱讀公會內容、在公會聊天室聊天。想發布或編輯，可以在聊天室跟會長打聲招呼，會長能把你設為正式成員。</p>}<GuildTags tags={g.tags}/>
      <div className="guild-book-list"><strong>入門技能</strong>{firstBook?<SkillBookIntro book={firstBook} guildName={g.name} label={firstBook.title} disabled={busy}/>:<p className="muted">技能書整理中</p>}</div>
      <SkillBookStarGate books={g.skill_books}/>
    </div>
    <div className="guild-card-controls">
      {launchpadEnabled&&<button type="button" className={`btn ${active?'btn-primary':'btn-ghost'} guild-workspace-entry`} onClick={onLaunchpad}>{active?'進入公會工作區':'預覽公會工作區'}</button>}
      {active&&<button type="button" className="btn btn-ghost guild-community-entry" aria-haspopup="dialog" disabled={busy} onClick={event=>open('overview',event.currentTarget)}>{copy.enter}</button>}
      {active&&<div className="guild-first-step"><p className="multiline-text">{g.first_step}</p><button type="button" className="btn btn-ghost" onClick={()=>openMemberChat('guild',g.guild_key)}>進入公會聊天室</button></div>}
      <button type="button" className="btn btn-ghost" aria-haspopup="dialog" disabled={busy} onClick={event=>open('books',event.currentTarget)}>公會技能書庫 · {g.skill_books.length}</button>
      <div className="guild-card-links"><button type="button" className="btn btn-ghost" aria-haspopup="dialog" disabled={busy} onClick={event=>open('members',event.currentTarget)}>查看成員</button>{active&&<button type="button" className="btn btn-ghost" aria-haspopup="dialog" disabled={busy} onClick={event=>open('announcements',event.currentTarget)}>公會公告</button>}</div>
      {active?<details className="guild-membership-settings"><summary>會員設定 · 主力與退出</summary><div className="actions">{categorySlot&&active&&!categorySlot.pending&&categorySlot.onToggle&&<button type="button" className="btn btn-ghost" data-category-action={categorySlot.actionId} disabled={busy||writesBlocked} onClick={categorySlot.onToggle}>{categorySlot.selected?'取消本類主力':'設為本類主力'}</button>}{!categorySlot&&active&&!g.is_primary&&<button className="btn btn-primary" disabled={busy||writesBlocked} onClick={onPrimary}>設為主要公會</button>}{!categorySlot&&active&&!g.is_primary&&onSecondary&&<button type="button" className="btn btn-ghost" disabled={busy||writesBlocked||(!g.is_secondary&&secondaryFull)} onClick={onSecondary}>{g.is_secondary?'取消次要公會':'設為次要公會'}</button>}<button type="button" className="btn btn-ghost" disabled={busy||writesBlocked||legacyPrimary} onClick={onMembership}>退出{g.name}</button></div>{legacyPrimary&&<p className="field-hint">退出前，請先更換主要公會。</p>}</details>:<button type="button" className="btn btn-primary" disabled={busy||writesBlocked} onClick={onMembership}>加入{g.name}</button>}
      {categorySlot?.pending&&<p className="field-hint">分類整理中，仍可使用公會工作區。</p>}
      {!categorySlot&&active&&!g.is_primary&&!g.is_secondary&&secondaryFull&&<p className="field-hint">次要公會已滿 2 個。先取消其中一個。</p>}
    </div>
    <dialog ref={dialog} className="guild-detail-dialog" aria-labelledby={titleId} onCancel={event=>{if(event.target===event.currentTarget){event.preventDefault();close();}}} onClose={event=>{if(event.target===event.currentTarget){setPanel(null);setMembersVisited(false);}}}>
      <header className="guild-detail-heading"><h2 id={titleId}>{title}</h2><button type="button" className="btn btn-ghost" aria-label="關閉公會視窗" autoFocus onClick={close}>關閉</button></header>
      {visiblePanel&&active&&<nav className="guild-community-nav" aria-label={copy.navigation}>{(['overview','announcements','members','books'] as const).map(value=><button key={value} type="button" className="btn btn-ghost" aria-pressed={visiblePanel===value} onClick={()=>choose(value)}>{copy[value]}</button>)}</nav>}
      {visiblePanel==='overview'&&active&&<section className="guild-community-overview" aria-label={copy.overview}>
        <div className="guild-community-about"><h3>{copy.about}</h3><p className="multiline-text">{g.purpose}</p><GuildTags tags={g.tags}/></div>
        <GuildLeadership masterName={guildMasterLabel(g)} masterId={g.guild_master?.user_id} masterAvatarUrl={g.guild_master?.avatar_url} experts={g.guild_experts}/>
        <div className="guild-community-start"><h3>{copy.next}</h3><p className="multiline-text">{g.first_step}</p><div className="actions">{firstBook&&<SkillBookIntro book={firstBook} guildName={g.name} label={`閱讀入門技能：${firstBook.title}`}/>}<button type="button" className="btn btn-primary" onClick={chat}>{copy.chat}</button></div>{!firstBook&&<p className="muted">入門技能書尚未整理，仍可先到聊天室交流。</p>}</div>
      </section>}
      {visiblePanel==='books'&&<div className="guild-library-books">{g.skill_books.map((book,index)=><div className="guild-library-entry" key={book.id??book.book_id}><div><span className="field-hint">{index===0?'入門技能':`技能 ${index+1}`}</span><p>{book.guide?.beginner?.purpose??book.description}</p></div><SkillBookIntro book={book} guildName={g.name} label={book.title}/></div>)}{!g.skill_books.length&&<p>技能書整理中</p>}</div>}
      {/* Keep an already-opened roster alive across section switches so its search, confirmation and command keys survive. */}
      {visiblePanel&&membersVisited&&<div hidden={visiblePanel!=='members'}><GuildMembers key={`${g.guild_key}:${viewerId}:${sessionGeneration}:${g.membership?.state??'none'}:${g.membership?.aggregate_version??'none'}`} client={client} guildKey={g.guild_key} guildName={g.name} masterId={g.guild_master?.user_id} expertIds={g.guild_experts?.map(expert=>expert.user_id)} viewerId={viewerId} expertCount={g.guild_experts?.length??0} onChanged={onChanged}/></div>}
      {visiblePanel==='announcements'&&active&&<GuildAnnouncements key={`${g.guild_key}:${viewerId}:${sessionGeneration}:${g.membership?.aggregate_version??'none'}`} client={client} guildKey={g.guild_key} expanded/>}
    </dialog>
  </article>;
}

// Measure intrinsic content, not stretched cards. Long names, portraits and
// responsive widths can change the required minimum height without clipping
// content while the next measurement is still pending.
export function useUniformGuildCards(key:string){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=root.current;if(!node)return;
    let frame=0;
    const measure=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        let height=0;
        for(const card of node.querySelectorAll<HTMLElement>('.guild-card')){
          const content=card.querySelector<HTMLElement>('.guild-card-content'),controls=card.querySelector<HTMLElement>('.guild-card-controls');
          if(!content||!controls)continue;
          const style=getComputedStyle(card);
          height=Math.max(height,content.getBoundingClientRect().height+controls.getBoundingClientRect().height+parseFloat(style.rowGap||'0')+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth));
        }
        if(height)node.style.setProperty('--guild-card-height',`${Math.ceil(height)}px`);
      });
    };
    const observer=new ResizeObserver(measure);
    node.querySelectorAll('.guild-card-content,.guild-card-controls').forEach(element=>observer.observe(element));
    measure();return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[key]);
  return root;
}
