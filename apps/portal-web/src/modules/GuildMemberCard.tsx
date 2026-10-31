import {useState,type ReactNode} from 'react';
import type {PortalClient} from '../api';
import {MemberContributionOutcomes} from './ContributionOutcomes';
import {SocialLinksList} from './MemberSocialLinks';
import type {MemberCardData} from './Membership';
import {MemberAvatar} from './MemberAvatar';
import {ReportButton} from './MemberReporting';
import {directoryVisitorProfileHref} from './profile-publication-route';

const identityLabels={male:'男',female:'女',alien:'外星人',ai:'AI'} as const;
const contactLabels={email:'聯絡 E-mail',discord:'Discord 帳號',github:'GitHub 帳號',line:'LINE ID'} as const;

/** A guild introduction, not a ranking or an activity/presence projection. */
export function GuildMemberCard({member,guildKey,guildName,labels,client,children}:{member:MemberCardData;guildKey:string;guildName:string;labels:Record<string,string>;client:PortalClient;children?:ReactNode}){
  const [outcomesOpen,setOutcomesOpen]=useState(false);
  const guild=[...(member.primary_guild?[member.primary_guild]:[]),...member.secondary_guilds,...(member.joined_guilds??[])].find(item=>item.guild_key===guildKey);
  const joined=guild?.joined_at&&Number.isFinite(Date.parse(guild.joined_at))?guild.joined_at:null;
  const identity=member.identity_label?identityLabels[member.identity_label]:null;
  const label=(id:string)=>id.startsWith('custom:')?id.slice(7):labels[id]??id;
  const abilities=[...new Set([...member.capabilities,...(member.custom_capabilities??[]).map(value=>`custom:${value}`)])];
  const equipment=[...new Set([...member.equipment,...(member.custom_equipment??[]).map(value=>`custom:${value}`)])];
  const featured=[...new Set(member.featured_capabilities??abilities)].slice(0,3);
  const profileHref=member.is_self?'#profile':directoryVisitorProfileHref(member.user_id);
  const contacts=(Object.keys(contactLabels) as (keyof typeof contactLabels)[]).filter(key=>typeof member.contacts[key]==='string'&&member.contacts[key]);
  return <article className={`directory-member guild-member-card${member.is_self?' guild-member-card-self':''}`} data-member-id={member.user_id} aria-label={member.nickname}>
    <header className="guild-member-card-heading">
      <MemberAvatar nickname={member.nickname} avatarUrl={member.avatar_url}/>
      <div><p className="guild-member-card-guild">{guildName}</p><h3>{member.nickname}</h3>{identity&&<span className="badge" aria-label={`自我介紹：${identity}`}>{identity}</span>}{member.is_self&&<span className="badge">你</span>}</div>
    </header>
    <p className="guild-member-card-title">{member.positioning_title??'還在探索自己的方向'}</p>
    <div className="guild-member-card-specialties" aria-label="本人填寫的專長"><span className="guild-member-card-caption">可以從這些專長認識我</span><div className="tag-list">{featured.length?featured.map(id=><span className="pill" key={id}>{label(id)}</span>):<span className="muted">{abilities.length?'尚未選擇展示專長':'尚未填寫專長'}</span>}</div></div>
    {member.is_self&&<p className="guild-member-welcome">這裡也有你的位置。{featured.length?'讓夥伴從你的介紹認識你。':'不用等準備好作品，也可以先介紹自己。'}</p>}
    <div className="directory-member-meta guild-member-membership">{children}{joined&&<p className="guild-member-joined"><time dateTime={joined}>{new Date(joined).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'})}</time> 加入本公會</p>}</div>
    <div className="guild-member-card-links">{profileHref?<a className="btn btn-ghost" href={profileHref}>{member.is_self?'前往我的個人空間':'查看個人頁'}</a>:<span className="muted">個人頁連結暫時不可用</span>}{!member.is_self&&<ReportButton kind="member" id={member.user_id} label={`${member.nickname}的名片`}/>}</div>
    <details className="directory-member-details guild-member-card-details"><summary>專長、裝備與聯絡資料</summary><div className="guild-member-card-expanded">
      <section><h4>本人填寫的專長</h4><div className="tag-list">{abilities.length?abilities.map(id=><span className="pill" key={id}>{label(id)}</span>):<p>尚未填寫</p>}</div></section>
      <section><h4>裝備</h4><div className="tag-list">{equipment.length?equipment.map(id=><span className="pill" key={id}>{label(id)}</span>):<p>尚未填寫</p>}</div></section>
      <section><h4>對你公開的聯絡方式</h4>{contacts.length?<dl>{contacts.map(key=><div key={key}><dt>{contactLabels[key]}</dt><dd>{member.contacts[key]}</dd></div>)}</dl>:<p>沒有對你公開的聯絡方式。</p>}</section>
    </div></details>
    <details className="guild-member-card-details guild-member-outcomes" onToggle={event=>setOutcomesOpen(event.currentTarget.open)}><summary>平台合作成果與社群連結</summary>{outcomesOpen&&<div className="guild-member-card-expanded"><p>平台合作成果（非本公會貢獻統計）</p><MemberContributionOutcomes client={client} memberId={member.user_id}/><SocialLinksList client={client} memberId={member.user_id}/></div>}</details>
  </article>;
}
