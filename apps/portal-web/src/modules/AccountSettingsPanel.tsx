import {useEffect,useId,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {useModuleMutation,type ModulePanelProps} from './shared';
import {AccountDeactivation} from './AccountDeactivation';
import {EmailChangePanel} from './EmailChange';
import {ClientConnections} from './ClientConnections';
import {AvatarEditor} from './AvatarEditor';
import type {AvatarMetadata} from './MemberAvatar';
import {GitHubConnectionPanel} from './GitHubSocial';
import {TotpSettings} from './TotpSettings';
import {MemberSocialLinks} from './MemberSocialLinks';
import {MemberShare} from './MemberShare';
import {sharingMutationState} from './authoring-drafts';
import {createSettingsLeaveRegistry,settingsMutationBlocksLeave,type RegisterSettingsLeave} from './account-settings-leave';
import {EmailVerificationPanel} from './EmailVerification';
import {AccountSecurity} from './AccountSecurity';
import {GoogleAccount} from './GoogleAccount';
import {PasswordSetup} from './PasswordSetup';
import {OwnReports} from './MemberReporting';
import {MemberCard,Status,loadLabels,identityLabels,contactLabels,type IdentityLabel,type MemberCardData} from './Membership';

// This page is loaded only by the account feature. Shared member cards must not
// statically import it, or the homepage would download all account editors too.
type Audience='public'|'friends'|'squad'|'guild';
type Contact={value:string;audiences:Audience[];verified?:boolean};
type Account={user_id:string;avatar:AvatarMetadata;nickname:string;identity_label:IdentityLabel|null;login_email:string;email_verified:boolean;has_password:boolean;contacts:Record<'email'|'discord'|'github'|'line',Contact>;aggregate_version:number};
const audienceOptions: [Audience,string][]=[['public','平台公開'],['friends','平台好友'],['squad','小隊夥伴'],['guild','公會夥伴']];
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
