import {directoryVisitorProfileHref} from './profile-publication-route';
import './ProfilePublication.css';
import {ReportButton,OwnReports} from './MemberReporting';
import {AccountDeactivation} from './AccountDeactivation';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useModuleMutation, type ModulePanelProps } from './shared';
import {MemberBlockingAction} from './MemberBlocking';
import { ApiError, type PortalClient } from '../api';
import { EmailChangePanel } from './EmailChange';
import { ClientConnections } from './ClientConnections';
import { ModuleBanner } from './ModuleBanner';
import { AvatarEditor } from './AvatarEditor';
import { MemberAvatar, type AvatarMetadata } from './MemberAvatar';
import { GitHubConnectionPanel } from './GitHubSocial';
import {TotpSettings} from './TotpSettings';
import './MemberDirectory.css';
import {MemberSocialLinks,SocialLinksList} from './MemberSocialLinks';
import {MemberPresence} from './MemberPresence';
import {MemberShare} from './MemberShare';
import {MemberECard} from './MemberECard';
import './AccountSettings.css';
import {sharingMutationState} from './authoring-drafts';
import {createSettingsLeaveRegistry,settingsMutationBlocksLeave,type RegisterSettingsLeave} from './account-settings-leave';
import {EmailVerificationPanel} from './EmailVerification';
import {guildLabel} from './GuildName';
import {SECTION_LABELS} from '../../../../contracts/guild-launchpad/v1/guild-preferences';
import {AccountSecurity} from './AccountSecurity';
import {GoogleAccount} from './GoogleAccount';
import {PasswordSetup} from './PasswordSetup';
import {MemberContributionOutcomes} from './ContributionOutcomes';

type Audience='public'|'friends'|'squad'|'guild';
type IdentityLabel='male'|'female'|'alien'|'ai';
const identityLabels:Record<IdentityLabel,string>={male:'男',female:'女',alien:'外星人',ai:'AI'};
function IdentityBadge({value}:{value?:IdentityLabel|null}){return value&&identityLabels[value]?<span className="badge" aria-label={`自我介紹：${identityLabels[value]}`}>{identityLabels[value]}</span>:null;}
type Contact={value:string;audiences:Audience[];verified?:boolean};
type Account={user_id:string;avatar:AvatarMetadata;nickname:string;identity_label:IdentityLabel|null;login_email:string;email_verified:boolean;has_password:boolean;contacts:Record<'email'|'discord'|'github'|'line',Contact>;aggregate_version:number};
type GuildRef={guild_key:string;name:string;alias?:string;joined_at?:string|null};
export type GuildRoster={member_tier:'intern'|'full';aggregate_version:number;expert_aggregate_version:number|null;expert_active:boolean};
export type CategoryPrimary={category:'internal'|'external'|'professional_industry';label:string;guild:GuildRef|null};
export type MemberCardData={user_id:string;joined_at?:string|null;joined_at_source?:'launch_day'|'registered';last_seen_at:string|null;is_online:boolean;avatar_url?:string|null;nickname:string;identity_label?:IdentityLabel|null;positioning_title:string|null;primary_guild:GuildRef|null;secondary_guilds:GuildRef[];joined_guilds?:GuildRef[];category_primaries?:CategoryPrimary[];capabilities:string[];equipment:string[];custom_capabilities?:string[];custom_equipment?:string[];featured_capabilities?:string[];contacts:Partial<Record<'email'|'discord'|'github'|'line',string>>;is_self:boolean;friendship:{state:string;requester_ref?:string;aggregate_version?:number};member_tiers?:{guild_key:string;member_tier:'intern'|'full'}[];guild_roster?:GuildRoster};
function CategoryPrimaries({items}:{items:CategoryPrimary[]}){return <dl className="member-category-primaries">{items.map(item=><div key={item.category}><dt>{SECTION_LABELS[item.category]}</dt><dd>{item.guild?.name??'尚未選擇'}</dd></div>)}</dl>;}
function guildRoleLabel(member:MemberCardData,guildKey:string){const category=member.category_primaries?.find(item=>item.guild?.guild_key===guildKey);if(category)return SECTION_LABELS[category.category];if(member.category_primaries)return '已加入公會';if(guildKey===member.primary_guild?.guild_key)return '主要公會';if(member.secondary_guilds.some(g=>g.guild_key===guildKey))return '次要公會';return '已加入公會';}
const audienceOptions: [Audience,string][]=[['public','平台公開'],['friends','平台好友'],['squad','小隊夥伴'],['guild','公會夥伴']];
const contactLabels={email:'聯絡 E-mail',discord:'Discord 帳號',github:'GitHub 帳號',line:'LINE ID'} as const;
const fail=(e:unknown)=>e instanceof Error?e.message:'暫時無法讀取，請稍後再試。';
type AccountPanelProps=ModulePanelProps&{registerLeave?:(guard:((hash:string|null)=>boolean)|null)=>void;children?:ReactNode|((registerLeave:RegisterSettingsLeave)=>ReactNode);profileExtras?:(registerLeave:RegisterSettingsLeave)=>ReactNode;focusProfileExtras?:boolean;focusConnections?:boolean};
export function AccountPanel(props:AccountPanelProps){
  return <AccountSettings key={`${props.session.user.user_id}:${props.client.sessionGeneration}`} {...props}/>;
}
function AccountSettings({client,session,onNavigate,registerLeave,children,profileExtras,focusProfileExtras,focusConnections}:AccountPanelProps){
  const [account,setAccount]=useState<Account|null>(null),[nickname,setNickname]=useState(''),[identityLabel,setIdentityLabel]=useState<IdentityLabel|''>(''),[contacts,setContacts]=useState<Account['contacts']|null>(null),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[member,setMember]=useState<MemberCardData|null>(null),[labels,setLabels]=useState<Record<string,string>>({});
  const mutationScope={userId:session.user.user_id,type:'account-settings'};
  const {mutate,busy,error,lastFailureUnknown}=useModuleMutation(client,mutationScope);
  const mutationState=sharingMutationState(mutationScope);
  const formId=useId(),generation=client.sessionGeneration;
  const childGuards=useRef(createSettingsLeaveRegistry()).current;
  const profileExtrasRef=useRef<HTMLDetailsElement>(null);
  const connectionsRef=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const details=connectionsRef.current;
    if(!focusConnections||!details)return;
    let ancestor=details.parentElement;
    while(ancestor){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement;}
    details.open=true;
    // The shell focuses main after navigation. Reveal this explicit destination
    // afterwards, without stealing focus from a modal or a newly used control.
    const frame=requestAnimationFrame(()=>{
      const summary=details.querySelector('summary');
      const active=document.activeElement;
      if(!details.isConnected||!details.open||window.location.hash!=='#account?view=connections'||document.querySelector('dialog[open],[aria-modal="true"]'))return;
      if(active===document.body||active?.id==='main-content'||active===summary)summary?.focus();
    });
    return()=>cancelAnimationFrame(frame);
  },[focusConnections]);
  const hasProfileExtras=Boolean(profileExtras);
  useEffect(()=>{
    const details=profileExtrasRef.current;
    if(!focusProfileExtras||!hasProfileExtras||!details)return;
    // Reveal the containing personal-data disclosure as well as this inner one.
    let ancestor=details.parentElement;
    while(ancestor){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement;}
    details.open=true;details.querySelector('summary')?.focus();
  },[focusProfileExtras,hasProfileExtras]);
  const [saveLoading,setSaveLoading]=useState(false);
  const mounted=useRef(false),request=useRef(0),saving=useRef(false);
  const pending=useRef<{body:{nickname:string;identity_label:IdentityLabel|null;contacts:Record<string,unknown>};version:number}|null>(null);
  const scope=useRef({client,generation});scope.current={client,generation};
  const live=()=>mounted.current&&scope.current.client===client&&scope.current.generation===generation&&client.sessionGeneration===generation;
  const dirty=Boolean(account&&contacts&&(nickname!==account.nickname||identityLabel!==(account.identity_label??'')||JSON.stringify(contacts)!==JSON.stringify(account.contacts)));
  const guardState=useRef({dirty});guardState.current={dirty};
  useEffect(()=>{
    mounted.current=true;
    const guard=()=>{const state=guardState.current;return saving.current||settingsMutationBlocksLeave(mutationState)||!childGuards.canLeave()?false:!state.dirty||window.confirm('還有修改尚未儲存，確定離開？');};
    registerLeave?.(guard);
    const unload=(event:BeforeUnloadEvent)=>{const state=guardState.current;if(state.dirty||saving.current||settingsMutationBlocksLeave(mutationState)||!childGuards.canLeave()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return()=>{mounted.current=false;request.current++;registerLeave?.(null);window.removeEventListener('beforeunload',unload);};
  },[client,generation,registerLeave,mutationState]);
  const fill=(value:Account)=>{setAccount(value);setNickname(value.nickname);setIdentityLabel(value.identity_label??'');setContacts(value.contacts);};
  async function load(){const sequence=++request.current;setLoadError('');try{const [a,m]=await Promise.all([client.get<Account>('/me/account'),client.get<MemberCardData>(`/members/${session.user.user_id}`)]);if(!live()||sequence!==request.current)return;fill(a);setMember(m);}catch(e){if(live()&&sequence===request.current)setLoadError(fail(e));}}
  useEffect(()=>{void load();void loadLabels(client).then(value=>{if(live())setLabels(value);}).catch(()=>{});},[client,session.user.user_id]);
  function sameAccountProfile(first:Account|null,second:Account){
    if(!first)return false;
    const {aggregate_version:_first,...before}=first,{aggregate_version:_second,...after}=second;
    return JSON.stringify(before)===JSON.stringify(after);
  }
  async function refreshSecurityVersion(){
    const generation=client.sessionGeneration;
    try{
      const latest=await client.get<Account>('/me/account');
      if(generation!==client.sessionGeneration)return;
      // A security-only increment may advance the loaded baseline, but a
      // concurrent profile edit must still conflict with our unsaved draft.
      if(!sameAccountProfile(account,latest)){setLoadError('帳號資料已在其他操作中變更。請先重新載入，再確認尚未保存的內容。');return;}
      setLoadError('');
      setAccount(current=>current&&sameAccountProfile(current,latest)?{...current,aggregate_version:Math.max(current.aggregate_version,latest.aggregate_version)}:current);
    }catch(cause){if(generation===client.sessionGeneration)setLoadError(fail(cause));}
  }
  async function submit(event?:FormEvent,retry=false){
    event?.preventDefault();if(!contacts||!account||saving.current||!live()||(!retry&&mutationState.snapshot.lastFailureUnknown))return;
    if(!retry){
      const clean=Object.fromEntries(Object.entries(contacts).map(([key,c])=>[key,key==='email'?{audiences:c.audiences}:{value:c.value,audiences:c.audiences}]));
      pending.current={body:{nickname,identity_label:identityLabel||null,contacts:clean},version:account.aggregate_version};
    }
    const operation=pending.current;if(!operation)return;
    saving.current=true;setSaveLoading(true);setNotice('');
    try{
      const saved=await mutate<Account>('/me/account',operation.body,operation.version);
      if(!live())return;
      if(saved){pending.current=null;fill(saved);setNotice('修改已儲存。');window.dispatchEvent(new Event('freedom-profile-updated'));await load();}
    }finally{saving.current=false;if(live())setSaveLoading(false);}
  }
  const locked=busy||saveLoading||lastFailureUnknown;
  const saveButton=<button type="submit" form={formId} className="btn btn-primary" disabled={locked}>{busy?'儲存中…':'儲存修改'}</button>;
  return <section className="module-panel account-panel account-settings" onInvalidCapture={event=>{
    // Native validation must be able to reveal/focus a field in a closed disclosure.
    let parent=(event.target as HTMLElement).parentElement;
    while(parent&&parent!==event.currentTarget){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
  }}>
    <div className="account-settings-intro"><p>改名字、選擇分享對象，或管理登入安全。</p>{onNavigate&&<button type="button" className="btn btn-small btn-ghost" disabled={locked} onClick={()=>onNavigate('profile')}>返回我的個人空間</button>}</div>
    <details className="card account-settings-section"><summary><strong>分享名片設定（免登入）</strong><span>見面時出示 QR Code，先確認你願意公開的內容</span></summary><div className="stack account-settings-body"><MemberShare client={client}/></div></details>
    <Status error={loadError||error} notice={notice}/>
    {loadError&&<button type="button" className="btn btn-small btn-ghost" disabled={locked} onClick={()=>{if(!dirty||window.confirm('放棄尚未儲存的修改，重新載入？'))void load();}}>重新載入我的資料</button>}
    {!account&&!loadError&&<p role="status">載入會員資料…</p>}
    {lastFailureUnknown&&<div className="banner" role="alert"><p>儲存結果還沒確認，請先留在這裡。再次確認不會重複儲存。</p><button type="button" className="btn btn-small" disabled={busy} onClick={()=>void submit(undefined,true)}>確認儲存結果</button></div>}
    <details className="card account-settings-section" open>
      <summary><strong>個人資料</strong><span>名字、頭像和聯絡方式</span></summary>
      <div className="stack account-settings-body">
        {account&&contacts&&<>
          <form id={formId} onSubmit={event=>void submit(event)} className="stack" aria-label="修改個人資料">
            <label className="field">社群顯示名稱<input required minLength={1} maxLength={60} disabled={locked} aria-describedby="community-name-hint" data-guide-anchor="account:display-name" value={nickname} onChange={e=>setNickname(e.target.value)}/></label>
            <p id="community-name-hint" className="field-hint">大家會看到這個名字。</p>
            <details className="account-settings-more"><summary>更多個人資料（選填）</summary><div className="stack">
              <label className="field">我是（選填）<select disabled={locked} value={identityLabel} aria-describedby="member-identity-hint" onChange={e=>setIdentityLabel(e.target.value as IdentityLabel|'')}><option value="">不顯示</option>{Object.entries(identityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              <p id="member-identity-hint" className="field-hint">由你自行選擇，會顯示在已登入夥伴可見的名片上；可隨時修改或選擇不顯示。</p>

            </div></details>
            <div className="actions">{saveButton}{dirty&&<span role="status">有修改尚未儲存</span>}</div>
            <p className="field-hint">儲存名字、聯絡方式和分享對象的修改；其他設定各自儲存。</p>
          </form>
          <details className="account-settings-more"><summary>更換頭像</summary><AvatarEditor client={client} nickname={account.nickname} initial={account.avatar} onSaved={avatar=>{setAccount(current=>current?{...current,avatar}:current);setMember(current=>current?{...current,avatar_url:avatar.avatar_url}:current);}}/></details>
        </>}
        {profileExtras&&<details ref={profileExtrasRef} className="account-settings-more" data-profile-recognition><summary>我的稱號與社群認證</summary><p>是否累積、是否展示，都由你自己選擇；不會自動公開個人頁。</p>{profileExtras(childGuards.register)}</details>}
        <details className="account-settings-more"><summary>個人網站與社群連結</summary><MemberSocialLinks client={client} memberId={session.user.user_id}/></details>
        {member&&<details className="account-settings-more"><summary>查看目前的會員名片</summary><MemberCard member={member} labels={labels} client={client}/></details>}
      </div>
    </details>
    <details className="card account-settings-section">
      <summary data-guide-anchor="account:email-visibility"><strong>誰能看到我</strong><span>聯絡方式和分享名片</span></summary>
      <div className="stack account-settings-body">
        <p>名字和頭像可由同工坊已加入的會員看見。下方只設定聯絡方式，不會隱藏已發布的貼文或其他內容。</p>
        <p className="field-hint" id="contact-audience-hint">社群帳號由本人填寫，尚未驗證身分。每項聯絡方式可選多個對象，符合其中一項就能看見。選「不公開」就不分享這項資料。「平台公開」是所有已登入的工坊會員；好友須雙方接受，小隊與公會依目前有效成員關係判斷。</p>
        <p className="banner">如果另外開啟分享名片，設為「平台公開」的聯絡方式也可能顯示在免登入名片上。請在「分享名片設定」逐項確認或隱藏。</p>
        {account&&contacts&&<>
          <div className="contact-grid">{(Object.keys(contactLabels) as (keyof typeof contactLabels)[]).map(key=><div className="contact-row" key={key}>
            <label className="field">{contactLabels[key]}<input form={formId} disabled={locked} aria-label={contactLabels[key]} type={key==='email'?'email':'text'} value={key==='email'?account.login_email:contacts[key].value} readOnly={key==='email'} maxLength={key==='github'?39:key==='email'?200:100} autoComplete="off" onChange={key==='email'?undefined:e=>setContacts({...contacts,[key]:{...contacts[key],value:e.target.value}})}/>{key==='email'&&<span className="field-hint">也是登入信箱</span>}</label>
            <AudienceChoices label={contactLabels[key]} form={formId} disabled={locked} audiences={contacts[key].audiences} onChange={audiences=>setContacts({...contacts,[key]:{...contacts[key],audiences}})}/>
          </div>)}</div>
          <div className="actions"><button type="submit" form={formId} className="btn btn-primary" disabled={locked}>{busy?'儲存中…':'儲存分享對象'}</button></div>
        </>}
      </div>
    </details>
    <details className="card account-settings-section">
      <summary><strong>帳號與安全</strong><span>密碼、登入裝置和進階設定</span></summary>
      <div className="stack account-settings-body">
        {account&&<EmailVerificationPanel client={client} email={account.login_email} verified={account.email_verified}/>}
        {account&&<GoogleAccount client={client} hasPassword={account.has_password!==false}/>}
        {account?.has_password===false&&<PasswordSetup client={client} email={account.login_email}/>}
        <AccountSecurity client={client} hasPassword={account?account.has_password!==false:false} onAccountChanged={refreshSecurityVersion}/>
        <details className="account-settings-more"><summary>兩步驟驗證</summary>{account&&account.has_password!==false&&<TotpSettings key={session.user.user_id} client={client} email={account.login_email}/>}</details>
        <details className="account-settings-more"><summary>更換登入信箱</summary>{account&&account.has_password!==false&&<EmailChangePanel client={client} email={account.login_email}/>}</details>
        {typeof children==='function'?children(childGuards.register):children}
        <details ref={connectionsRef} className="account-settings-more" data-account-connections><summary>連結 GitHub 與其他工具</summary><GitHubConnectionPanel/><ClientConnections client={client}/></details>
        <OwnReports client={client}/>
        <details className="account-settings-more"><summary>停用帳號</summary>{account&&account.has_password!==false&&<AccountDeactivation client={client} version={account.aggregate_version} disabled={locked}/>}</details>
      </div>
    </details>
  </section>;
}

function AudienceChoices({label,audiences,onChange,form,disabled}:{label:string;audiences:Audience[];onChange:(value:Audience[])=>void;form?:string;disabled?:boolean}){
  const isPublic=audiences.includes('public');
  const toggle=(audience:Audience)=>{if(audience==='public'){onChange(isPublic?[]:['public']);return;}onChange(audiences.includes(audience)?audiences.filter(value=>value!==audience):[...audiences,audience]);};
  return <fieldset disabled={disabled} className="fieldset" aria-label={`${label}可見範圍`} aria-describedby="contact-audience-hint"><legend>{label}可見範圍</legend><label className="checkbox-row"><input form={form} type="checkbox" checked={audiences.length===0} onChange={()=>onChange([])}/>不公開</label>{audienceOptions.map(([value,name])=><label className="checkbox-row" key={value}><input form={form} type="checkbox" checked={audiences.includes(value)} disabled={value!=='public'&&isPublic} onChange={()=>toggle(value)}/>{name}</label>)}{isPublic&&<p className="field-hint">平台公開已包含好友、小隊與公會夥伴。</p>}</fieldset>;
}
export function MemberCard({member,children,labels={},client}:{member:MemberCardData;children?:React.ReactNode;labels?:Record<string,string>;client?:PortalClient}){
  const featured=(member.featured_capabilities??member.capabilities.slice(0,3)).slice(0,3);
  const label=(id:string)=>id.startsWith('custom:')?id.slice(7):labels[id]??id;
  const abilities=[...member.capabilities,...(member.custom_capabilities??[]).map(value=>`custom:${value}`)],equipment=[...member.equipment,...(member.custom_equipment??[]).map(value=>`custom:${value}`)];
  return <article className="card member-card member-profile-card">
    <MemberECard design="editorial" nickname={member.nickname} headline={member.positioning_title} guildName={member.primary_guild?.name??null} capabilities={featured.map(label)} avatarUrl={member.avatar_url??null} links={[]} heading="h3"/>
    <div className="member-card-body">
      <IdentityBadge value={member.identity_label}/>
      {member.category_primaries?<CategoryPrimaries items={member.category_primaries}/>:<div className="member-secondary-guilds"><h4>次要公會</h4><p className="muted">{member.secondary_guilds.map(g=>g.name).join('、')||'先專注在主要公會'}</p></div>}
      {Boolean(member.joined_guilds?.length)&&<details className="member-other-guilds"><summary>其他已加入公會 · {member.joined_guilds!.length}</summary><p className="muted">{member.joined_guilds!.map(g=>g.name).join('、')}</p></details>}<details className="member-full-profile"><summary>完整能力與裝備 · {abilities.length} 項能力／{equipment.length} 項裝備</summary><div className="stack"><div><h4>基本能力</h4><div className="tag-list">{abilities.length?abilities.map(id=><span key={id} className="pill">{label(id)}</span>):<span className="muted">尚未填寫</span>}</div></div><div><h4>裝備</h4><div className="tag-list">{equipment.length?equipment.map(id=><span key={id} className="pill">{label(id)}</span>):<span className="muted">尚未填寫</span>}</div></div></div></details>
      {Object.keys(member.contacts).length>0&&<dl className="detail-list">{Object.entries(member.contacts).map(([key,value])=><div key={key}><dt>{contactLabels[key as keyof typeof contactLabels]}</dt><dd>{value}</dd></div>)}</dl>}
      {client&&<SocialLinksList client={client} memberId={member.user_id} self={member.is_self}/>}
    </div>
    {children}
    {!member.is_self&&<ReportButton kind="member" id={member.user_id} label={`${member.nickname}的名片`}/>}
  </article>;

}
type DirectoryFilters={search:string;guild_key:string;primary_guild_key:string;capability:string;sort:'newest'|'oldest'|'nickname'|'positioning'|'guild'};
type DirectoryResponse={items:MemberCardData[];next_offset:number|null;total:number};
type DirectoryFriend={user_id:string;nickname:string;state:string;requester_ref:string;aggregate_version:number};
type IncomingFriendsPage={items:MemberCardData[];total:number;next_offset:number|null};
function incomingFriend(member:MemberCardData,viewerId:string):DirectoryFriend|null{
  const relation=member.friendship;
  return relation.state==='pending'&&relation.requester_ref!==viewerId&&typeof relation.requester_ref==='string'&&typeof relation.aggregate_version==='number'
    ?{user_id:member.user_id,nickname:member.nickname,state:relation.state,requester_ref:relation.requester_ref,aggregate_version:relation.aggregate_version}:null;
}
const defaultDirectoryFilters:DirectoryFilters={search:'',guild_key:'',primary_guild_key:'',capability:'',sort:'newest'};

export function DirectoryMemberRow({member,labels,children,client}:{member:MemberCardData;labels:Record<string,string>;children?:React.ReactNode;client:PortalClient}){
  const [detailsOpen,setDetailsOpen]=useState(false);
  const profileHref=directoryVisitorProfileHref(member.user_id);
  const skillLabel=(id:string)=>id.startsWith('custom:')?id.slice(7):labels[id]??id;
  const featured=(member.featured_capabilities??member.capabilities.slice(0,3)).slice(0,3);
  const abilities=[...member.capabilities,...(member.custom_capabilities??[]).map(value=>`custom:${value}`)];
  const equipment=[...member.equipment,...(member.custom_equipment??[]).map(value=>`custom:${value}`)];
  const joined=member.joined_at&&Number.isFinite(Date.parse(member.joined_at))?member.joined_at:null;
  const contacts=(Object.keys(contactLabels) as (keyof typeof contactLabels)[]).filter(key=>typeof member.contacts[key]==='string'&&member.contacts[key]);
  return <article className="directory-member" data-member-id={member.user_id} aria-label={member.nickname}>
    <div className="directory-member-identity">{profileHref?<a className="directory-member-profile-link" href={profileHref} aria-label={`查看${member.nickname}的個人頁`}><MemberAvatar nickname={member.nickname} avatarUrl={member.avatar_url}/></a>:<MemberAvatar nickname={member.nickname} avatarUrl={member.avatar_url}/>}<div><div className="directory-member-name"><h3>{profileHref?<a className="directory-member-profile-link" href={profileHref}>{member.nickname}</a>:member.nickname}</h3><IdentityBadge value={member.identity_label}/>{member.is_self&&<span className="badge">你</span>}</div><p className="directory-member-title">{member.positioning_title??'探索自己的方向'}</p><p className="directory-member-guild">{member.category_primaries?member.category_primaries.map(item=>`${SECTION_LABELS[item.category]}：${item.guild?.name??'尚未選擇'}`).join(' · '):(member.primary_guild?.name??'尚未設定主要公會')}</p></div></div>
    <div className="directory-member-skills" aria-label="擅長的能力"><span className="hint">本人填寫的專長</span>{featured.length?featured.map(id=><span className="pill" key={id}>{skillLabel(id)}</span>):<span className="muted">尚未填寫專長</span>}</div>
    {!member.is_self&&<ReportButton kind="member" id={member.user_id} label={`${member.nickname}的名片`}/>}
    <div className="directory-member-meta"><MemberPresence online={member.is_online} lastSeen={member.last_seen_at}/>{joined?<span><time dateTime={joined} title={member.joined_at_source==='launch_day'?'開站日 · 台北時間':'台北時間'}>{new Date(joined).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'})}</time> 加入</span>:<span>加入日期未記錄</span>}{children}</div>
    <details className="directory-member-details" onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>更多資料</summary><div className="directory-member-expanded"><section><h4>公會加入紀錄</h4><ul className="directory-guild-dates">{[...(member.primary_guild?[member.primary_guild]:[]),...member.secondary_guilds,...(member.joined_guilds??[])].map(guild=><li key={guild.guild_key}><strong>{guild.name}</strong><span>{guildRoleLabel(member,guild.guild_key)}{guild.joined_at&&Number.isFinite(Date.parse(guild.joined_at))?<> · <time dateTime={guild.joined_at}>{new Date(guild.joined_at).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'})}</time> 加入</>:null}</span></li>)}</ul>{!member.primary_guild&&!member.secondary_guilds.length&&!member.joined_guilds?.length&&<p>尚未加入公會</p>}</section><section><h4>完整能力</h4><div className="tag-list">{abilities.length?abilities.map(id=><span key={id} className="pill">{skillLabel(id)}</span>):<p>尚未填寫</p>}</div></section><section><h4>裝備</h4><div className="tag-list">{equipment.length?equipment.map(id=><span key={id} className="pill">{skillLabel(id)}</span>):<p>尚未填寫</p>}</div></section><section><h4>聯絡方式</h4>{contacts.length?<dl>{contacts.map(key=><div key={key}><dt>{contactLabels[key]}</dt><dd>{member.contacts[key]}</dd></div>)}</dl>:<p>沒有對你公開的聯絡方式。</p>}</section>{detailsOpen&&<><MemberContributionOutcomes client={client} memberId={member.user_id}/><SocialLinksList client={client} memberId={member.user_id}/></>}</div></details>
  </article>;
}

export function MembersPanel({client,session,focusRequest,onIncomingFriends,onMessage,memberBlockingEnabled=false}:ModulePanelProps&{focusRequest?:{id:string;sequence:number};onIncomingFriends:()=>void;onMessage:(id:string)=>void;memberBlockingEnabled?:boolean}){
  const [members,setMembers]=useState<MemberCardData[]>([]),[nextOffset,setNextOffset]=useState<number|null>(null),[total,setTotal]=useState<number|null>(null),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true),[notice,setNotice]=useState(''),[labels,setLabels]=useState<Record<string,string>>({}),[skillGroups,setSkillGroups]=useState<SkillGroup[]>([]);
  const [friends,setFriends]=useState<DirectoryFriend[]>([]),[friendTotal,setFriendTotal]=useState(0),[friendError,setFriendError]=useState('');
  const [guilds,setGuilds]=useState<GuildRef[]>([]),[guildError,setGuildError]=useState(''),[search,setSearch]=useState(''),[filters,setFilters]=useState<DirectoryFilters>(defaultDirectoryFilters);
  const [pageSize,setPageSize]=useState(20),[pageOffset,setPageOffset]=useState(0);
  const searchInput=useRef<HTMLInputElement>(null);
  const [blockingTarget,setBlockingTarget]=useState<string|null>(null),[blockingTargets,setBlockingTargets]=useState<{user_id:string;nickname:string}[]>([]);
  function openBlocking(member:MemberCardData){setBlockingTargets(value=>value.some(item=>item.user_id===member.user_id)?value:[...value,{user_id:member.user_id,nickname:member.nickname}]);setBlockingTarget(member.user_id);}
  const filterRef=useRef(filters),generation=useRef(0),friendsGeneration=useRef(0),guildGeneration=useRef(0),loadedOffset=useRef(0);
  filterRef.current=filters;
  const {mutate,busy,error}=useModuleMutation(client);
  const load=useCallback(async(offset=0)=>{
    const sequence=++generation.current,current=filterRef.current;
    const query=new URLSearchParams({limit:String(pageSize),offset:String(offset),sort:current.sort});
    if(current.search)query.set('search',current.search);
    if(current.guild_key)query.set('guild_key',current.guild_key);
    if(current.primary_guild_key)query.set('primary_guild_key',current.primary_guild_key);
    if(current.capability)query.set('capability',current.capability);
    setLoadError('');setLoading(true);loadedOffset.current=offset;
    setMembers([]);setNextOffset(null);setTotal(null);
    try{
      const data=await client.get<DirectoryResponse>(`/members?${query}`);
      if(sequence!==generation.current)return;
      setMembers(data.items);
      setNextOffset(data.next_offset);setTotal(data.total);
    }catch(cause){if(sequence===generation.current)setLoadError(fail(cause));}
    finally{if(sequence===generation.current)setLoading(false);}
  },[client,pageSize]);
  const loadFriends=useCallback(async()=>{
    const sequence=++friendsGeneration.current,focusId=focusRequest?.id;setFriendError('');
    try{
      const [page,focused]=await Promise.all([
        client.get<IncomingFriendsPage>('/friends/directory?scope=incoming&limit=10&offset=0'),
        focusId?client.get<MemberCardData>(`/members/${encodeURIComponent(focusId)}`).catch(cause=>{if(cause instanceof ApiError&&cause.status===404)return null;throw cause;}):Promise.resolve(null),
      ]);
      if(sequence!==friendsGeneration.current)return;
      const items=page.items.flatMap(member=>{const friend=incomingFriend(member,session.user.user_id);return friend?[friend]:[];});
      const target=focused?incomingFriend(focused,session.user.user_id):null;
      setFriends(target&&!items.some(friend=>friend.user_id===target.user_id)?[target,...items]:items);
      setFriendTotal(page.total);
    }catch(cause){if(sequence===friendsGeneration.current){setFriends([]);setFriendTotal(0);setFriendError(fail(cause));}}
  },[client,focusRequest?.id,focusRequest?.sequence,session.user.user_id]);
  const loadGuilds=useCallback(async()=>{
    const sequence=++guildGeneration.current;setGuildError('');
    try{const data=await client.get<{items:GuildRef[]}>('/guilds/directory');if(sequence===guildGeneration.current)setGuilds(data.items);}
    catch(cause){if(sequence===guildGeneration.current)setGuildError(fail(cause));}
  },[client]);
  useEffect(()=>{void load(pageOffset);return()=>{generation.current++;};},[load,filters,pageOffset]);
  useEffect(()=>{let active=true;void loadFriends();void loadGuilds();void loadDirectoryDefinition(client).then(data=>{if(active){setLabels(data.labels);setSkillGroups(data.skills);}}).catch(()=>{});return()=>{active=false;friendsGeneration.current++;guildGeneration.current++;};},[client,loadFriends,loadGuilds]);
  const visibleIds=members.map(member=>member.user_id).join(',');
  useEffect(()=>{
    if(!visibleIds)return;
    let active=true;
    const refresh=()=>{if(document.visibilityState!=='visible')return;void client.get<{items:{user_id:string;last_seen_at:string|null;is_online:boolean}[]}>(`/members/presence?ids=${encodeURIComponent(visibleIds)}`,{background:true})
      .then(result=>{if(!active)return;const states=new Map(result.items.map(item=>[item.user_id,item]));setMembers(current=>current.map(member=>{const next=states.get(member.user_id);return next?{...member,last_seen_at:next.last_seen_at,is_online:next.is_online}:member}));}).catch(()=>{});};
    const timer=window.setInterval(refresh,60_000);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)};
  },[client,visibleIds]);
  useEffect(()=>{const timer=setTimeout(()=>{const term=search.trim();setFilters(current=>{if(current.search===term)return current;generation.current++;setPageOffset(0);return {...current,search:term};});},250);return()=>clearTimeout(timer);},[search]);
  function filter(change:Partial<DirectoryFilters>){generation.current++;setPageOffset(0);setFilters(current=>({...current,...change}));}
  function searchNow(event:FormEvent){event.preventDefault();filter({search:search.trim()});}
  function clearSearch(){setSearch('');filter({search:''});searchInput.current?.focus();}
  function changePageSize(value:number){generation.current++;setPageOffset(0);setPageSize(value);}
  function reset(){setSearch('');setPageSize(20);filter(defaultDirectoryFilters);searchInput.current?.focus();}
  async function act(userId:string,action:string,version?:number){setNotice('');const result=await mutate(`/friends/${userId}/${action}`,{},version);if(result){setNotice(action==='accept'?'已成為平台好友。':action==='remove'?'好友關係已移除。':'好友邀請已送出，等待對方接受。');await Promise.all([load(pageOffset),loadFriends()]);}}
  const invitations=friends.filter(friend=>friend.state==='pending'&&friend.requester_ref!==session.user.user_id);
  useEffect(()=>{if(!focusRequest||!invitations.some(friend=>friend.user_id===focusRequest.id))return;
    const frame=requestAnimationFrame(()=>{const row=document.getElementById(`friend-request-${focusRequest.id}`);row?.scrollIntoView({block:'center',behavior:'smooth'});row?.querySelector('button')?.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(frame);
  },[focusRequest?.id,focusRequest?.sequence,friends]);
  const filtered=Boolean(filters.search||filters.guild_key||filters.primary_guild_key||filters.capability);
  const sortLabels:Record<DirectoryFilters['sort'],string>={newest:'最新加入',oldest:'最早加入',nickname:'暱稱排序',positioning:'定位稱號',guild:'主要公會'};
  const selectedGuildLabel=(key:string)=>{const guild=guilds.find(item=>item.guild_key===key);return guild?guildLabel(guild.name,guild.alias):key;};
  const appliedSettings=[
    ...(filters.capability?[{key:'capability',label:`專長：${labels[filters.capability]??filters.capability}`,clear:()=>filter({capability:''})}]:[]),
    ...(filters.guild_key?[{key:'guild',label:`公會：${selectedGuildLabel(filters.guild_key)}`,clear:()=>filter({guild_key:''})}]:[]),
    ...(filters.primary_guild_key?[{key:'positioning',label:`定位：${selectedGuildLabel(filters.primary_guild_key)}`,clear:()=>filter({primary_guild_key:''})}]:[]),
    ...(filters.sort!=='newest'?[{key:'sort',label:`排序：${sortLabels[filters.sort]}`,clear:()=>filter({sort:'newest'})}]:[]),
    ...(pageSize!==20?[{key:'page-size',label:`每頁 ${pageSize} 位`,clear:()=>changePageSize(20)}]:[]),
  ];
  const appliedChips=[...(filters.search?[{key:'search',label:`關鍵字：${filters.search}`,clear:clearSearch}]:[]),...appliedSettings];
  const searchPending=search.trim()!==filters.search,changed=appliedChips.length>0||Boolean(search);
  return <section className="module-panel members-panel"><h2 className="directory-title">找夥伴</h2>
    <Status error={error} notice={notice}/>
    {friendError&&<div className="banner banner-error" role="alert"><p>好友邀請暫時無法載入：{friendError}</p><button className="btn btn-ghost" onClick={()=>void loadFriends()}>重讀好友邀請</button></div>}
    {invitations.length>0&&<section className="card stack directory-invitations"><h3>收到的好友邀請</h3>{invitations.map(friend=><div className="member-request" id={`friend-request-${friend.user_id}`} key={friend.user_id}><strong>{friend.nickname}</strong><button className="btn btn-primary" disabled={busy} onClick={()=>void act(friend.user_id,'accept',friend.aggregate_version)}>接受邀請</button><button className="btn btn-ghost" disabled={busy} onClick={()=>void act(friend.user_id,'remove',friend.aggregate_version)}>婉拒</button></div>)}{friendTotal>invitations.length&&<p className="field-hint">這裡顯示最近 {invitations.length} / {friendTotal} 則邀請。<button type="button" className="btn btn-ghost" onClick={onIncomingFriends}>查看完整好友邀請</button></p>}</section>}
    <form className="directory-filters" role="search" aria-label="尋找工坊夥伴" onSubmit={searchNow}>
      <div className="directory-search-row">
        <label className="field directory-search"><span className="directory-search-label">搜尋夥伴</span><input ref={searchInput} type="search" aria-label="搜尋夥伴" data-guide-anchor="members:search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜尋暱稱、定位或專長" autoComplete="off"/></label>
        {search&&<button type="button" className="btn btn-ghost directory-search-clear" aria-label="清除搜尋" onClick={clearSearch}><span aria-hidden="true">×</span></button>}
        <button className="btn btn-primary" type="submit">搜尋</button>
      </div>
      <details className="directory-advanced">
        <summary>篩選{appliedSettings.length>0&&<span className="directory-filter-count">{appliedSettings.length}<span className="directory-search-label"> 項已套用</span></span>}</summary>
        <div className="directory-advanced-fields">
          <label className="field">依專長篩選<select value={filters.capability} onChange={event=>filter({capability:event.target.value})}><option value="">全部專長</option>{skillGroups.map(group=><optgroup key={group.id} label={group.label}>{group.options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>)}</select></label>
          <label className="field">依公會篩選<select value={filters.guild_key} onChange={event=>filter({guild_key:event.target.value})}><option value="">全部公會</option>{guilds.map(guild=><option value={guild.guild_key} key={guild.guild_key}>{guildLabel(guild.name,guild.alias)}</option>)}</select></label>
          <label className="field">依主要定位篩選<select value={filters.primary_guild_key} onChange={event=>filter({primary_guild_key:event.target.value})}><option value="">全部定位</option>{guilds.map(guild=><option value={guild.guild_key} key={guild.guild_key}>{guildLabel(guild.name,guild.alias)}</option>)}</select></label>
          <label className="field">排序方式<select value={filters.sort} onChange={event=>filter({sort:event.target.value as DirectoryFilters['sort']})}>{Object.entries(sortLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">每頁顯示<select value={pageSize} onChange={event=>changePageSize(Number(event.target.value))}><option value={10}>10 位</option><option value={20}>20 位</option><option value={50}>50 位</option></select></label>
        </div>
      </details>
      {changed&&<div className="directory-applied-filters" aria-label="已套用的搜尋條件">
        {appliedChips.map(chip=><button key={chip.key} type="button" className="btn btn-ghost directory-filter-chip" aria-label={`清除條件：${chip.label}`} onClick={()=>{chip.clear();searchInput.current?.focus();}}><span>{chip.label}</span><span aria-hidden="true">×</span></button>)}
        <button className="btn btn-ghost" type="button" onClick={reset}>重設篩選</button>
      </div>}
    </form>
    {guildError&&<div className="directory-options-error" role="alert"><span>公會選項暫時無法載入。</span><button className="btn btn-ghost" onClick={()=>void loadGuilds()}>重讀公會選項</button></div>}
    <div className="directory-results-heading"><p className="directory-result-count" aria-live="polite">{searchPending?'正在套用搜尋…':loading&&members.length===0?'正在尋找夥伴…':total===null?'':`顯示 ${members.length?pageOffset+1:0}–${pageOffset+members.length} / ${total} 位夥伴`}</p><p className="field-hint">聯絡方式依本人設定顯示。</p></div>
    {loadError&&<div role="alert" className="banner banner-error"><p>{loadError}</p><button className="btn btn-ghost" onClick={()=>void load(loadedOffset.current)}>重新載入夥伴</button></div>}
    <div className="member-directory directory-rows" data-guide-anchor="members:directory" aria-busy={loading}>{members.map(member=><DirectoryMemberRow key={member.user_id} member={member} labels={labels} client={client}>{!member.is_self&&<div className="directory-friend-actions"><button className="btn btn-ghost" type="button" onClick={()=>onMessage(member.user_id)}>私訊使用者</button>{member.friendship.state==='accepted'?<><span className="badge">平台好友</span><button className="btn btn-ghost" disabled={busy} onClick={()=>void act(member.user_id,'remove',member.friendship.aggregate_version)}>移除好友</button></>:member.friendship.state==='pending'?<span className="muted">{member.friendship.requester_ref===session.user.user_id?'好友邀請已送出':'對方已邀請你'}</span>:<button className="btn btn-ghost" disabled={busy} onClick={()=>void act(member.user_id,'request',member.friendship.aggregate_version)}>邀請成為好友</button>}{memberBlockingEnabled&&<button type="button" className="btn btn-ghost" onClick={()=>openBlocking(member)}>封鎖設定</button>}</div>}</DirectoryMemberRow>)}</div>
    {memberBlockingEnabled&&blockingTargets.map(target=><div key={target.user_id} hidden={blockingTarget!==target.user_id}><MemberBlockingAction client={client} userId={target.user_id} nickname={target.nickname} active={blockingTarget===target.user_id} onDismiss={()=>setBlockingTarget(null)} onChanged={()=>{setNotice('封鎖設定已保存。好友關係與邀請以重新讀取的資料為準。');return Promise.all([load(pageOffset),loadFriends()]).then(()=>{});}}/></div>)}
    {loading&&<p role="status">正在載入夥伴…</p>}
    {!loading&&!members.length&&!loadError&&<div className="directory-empty"><p>{filtered?'沒有符合的夥伴。換個關鍵字、專長或公會試試。':'還沒有完成加入的會員。'}</p>{filtered&&<button className="btn btn-ghost" onClick={reset}>查看全部夥伴</button>}</div>}
    {total!==null&&!loadError&&total>pageSize&&<nav className="directory-pagination" aria-label="夥伴頁數"><button className="btn btn-ghost" type="button" disabled={loading||pageOffset===0} onClick={()=>setPageOffset(Math.max(0,pageOffset-pageSize))}>上一頁</button><span aria-live="polite">第 {Math.floor(pageOffset/pageSize)+1} / {Math.ceil(total/pageSize)} 頁</span><button className="btn btn-ghost" type="button" disabled={loading||nextOffset===null} onClick={()=>setPageOffset(nextOffset!)}>下一頁</button></nav>}
  </section>;
}
type SkillGroup={id:string;label:string;options:{id:string;label:string}[]};
async function loadDirectoryDefinition(client:PortalClient){const definition=await client.get<{capability_categories:SkillGroup[];equipment_categories:{options:{id:string;label:string}[]}[]}>('/assessment-definition');return {skills:definition.capability_categories,labels:Object.fromEntries([...definition.capability_categories,...definition.equipment_categories].flatMap(c=>c.options).map(o=>[o.id,o.label]))};}
export async function loadLabels(client:PortalClient){return (await loadDirectoryDefinition(client)).labels;}
export function Status({error,notice}:{error?:string|null;notice?:string|null}){return <>{error&&<p role="alert" className="banner banner-error">{error}</p>}{notice&&<p role="status" className="banner status-note">{notice}</p>}</>;}
