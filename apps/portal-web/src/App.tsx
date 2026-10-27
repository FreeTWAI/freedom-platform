import {parseProfileRoute,canOpenGuestProfile} from './modules/profile-publication-route';
import {skillAcquisitionFromSearch,skillReadingPath,validateSkillReturn} from '../../../packages/shared/skill-acquisition';
import {activateHomeLink} from './brand-home-link';
import {requestHomeJournalOpen} from './modules/member-home-loading';
import {PasswordField} from './modules/auth/PasswordField';
import {parseSellerConsoleRoute} from '../../../modules/agent-commerce/seller-console/route';
import {orderNotificationDestination} from '../../../modules/agent-commerce/checkout/notification-action';
import {parseSupplierConsoleRoute} from '../../../modules/agent-commerce/supplier-console/ui/route';
import {sellerOrdersRoute} from './modules/hosted-seller-order-state'
import {buyerRoute} from './modules/hosted-order-state'
import { client, PortalContext, describeError, isOwnRef, type ActionError, type PortalContextValue } from './portal-session'
import { ErrorPanel } from './portal-feedback'
import { Navigation, TAB_TITLES } from './Navigation'
import { TAB_GUIDANCE } from './features/metadata'
import { renderPortalFeature } from './features/registry'
import React, { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageLoadBoundary } from './LazyPage'
import { RequestFeedback } from './RequestFeedback'
import { MEMBER_ACCESS_EXPIRED_MESSAGE } from './access-fetch'
import { ApiError } from './api'
import {EntryResources} from './modules/EntryResources'
import {CHAT_ENTRY_EVENT,isChatEntry,type ChatEntry} from './modules/chat-entry'
import type { OnboardingView } from './modules/Onboarding'
import type { MemberCardData } from './modules/Membership'
import { EmailChangeConfirm } from './modules/EmailChange'
import {EmailVerificationConfirm} from './modules/EmailVerification';
import { MemberAvatar } from './modules/MemberAvatar'
import { GitHubSocialProvider } from './modules/GitHubSocial'
import { AuthorClaimProvider } from './modules/AuthorClaim'
import { SettingsMenu } from './modules/SettingsMenu'
import {NotificationBell,type BellAction} from './modules/NotificationBell'
import {FloatingMessages} from './modules/FloatingMessages'
import './SocialLayout.css'
import { PlatformPurpose, entryIntentFromHash, entryIntentLabel, type EntryIntent } from './PlatformPurpose'
import {readEventParticipationToken} from './modules/event-participation-token'
import {DevelopmentAccessProvider} from './modules/DevelopmentAccess'
import { GameConsoleProvider, GameConsolePopout, useGameConsole } from './GameConsole'
import {PageTools} from './PageTools'
import {PlatformHelperHost} from './PlatformHelperHost';
import {GuideHost,type GuideHelperAction} from './modules/newcomer-guides/GuideHost'
import { logConsoleEvent } from './game-console-core'
import { consoleChannel } from './game-console-routing'
import {AdminReports,MemberReportingProvider} from './modules/MemberReporting'
import { BrandPoster, CommunityLinks, type SiteConfig } from './modules/Community'
import { PublicDiscovery, publicDiscoveryPath, validatePublicReturn } from './modules/PublicDiscovery'
import {storefrontReturnFromSearch, successfulStorefrontReturn} from '../../../modules/agent-commerce/storefront-return'
import {anonymousSharedPost,memberPostReturn,publicPostReturn} from './modules/public-post-return'
import { CommunitySearch } from './modules/CommunitySearch'
import { guildKeyFromHash } from './modules/guild-launchpad-route'
import {ShareLauncher,SHARE_TARGETS,type ShareTarget} from './ShareLauncher'
import { setSharingDraftAccount } from './modules/authoring-drafts'
import type { SessionPayload, TabId } from './types'
import {LanguageProvider,LanguagePicker,useLanguage} from './language'
import {authErrorMessage} from './auth-messages'
import {AppInstallProvider,InstallAppButton} from './AppInstall'

const PublicGuildLaunchpad = lazy(() => import('./guild-blocks/GuildLaunchpadPage').then(m => ({default: m.PublicGuildLaunchpad})))
const PublicArPage=lazy(()=>import('./modules/community-ar/Panel').then(m=>({default:m.PublicArPage})))
const VisitorProfile = lazy(() => import('./modules/VisitorProfile').then(m => ({default:m.VisitorProfile})))
const PublicMemberPage = lazy(() => import('./modules/PublicMemberPage').then(m => ({default: m.PublicMemberPage})))
const Onboarding = lazy(() => import('./modules/Onboarding').then(m => ({default: m.Onboarding})))
const AdminPanel = lazy(() => import('./modules/AdminPanel').then(m => ({default: m.AdminPanel})))
const GitHubCallback = lazy(() => import('./modules/GitHubCallback').then(m => ({default: m.GitHubCallback})))
const MemberMessages = lazy(() => import('./modules/MemberMessages').then(m => ({default: m.MemberMessages})))
const PublicEventPage = lazy(() => import('./modules/PublicEventPage').then(m => ({default: m.PublicEventPage})))
const CommunityHub = lazy(() => import('./modules/CommunityHub').then(m=>({default:m.CommunityHub})))
const NewbieVillage = lazy(() => import('./modules/NewbieVillage').then(m => ({default: m.NewbieVillage})))
const WelcomePreview = lazy(() => import('./modules/WelcomePreview').then(m => ({default: m.WelcomePreview})))
const TesterMap = lazy(() => import('./modules/TesterMap').then(m => ({default: m.TesterMap})))
import { HostedOrderPage } from './features/commerce'

const DEMO_ACCOUNTS = [
  { email: 'maker@local.test', label: '作者示範帳號' },
  { email: 'reviewer@local.test', label: '回饋示範帳號' },
  { email: 'client@local.test', label: '委託示範帳號' },
] as const
const DEMO_PASSWORD = 'freedom-local-demo'
const onboardingStarted=(userId:string)=>{try{return sessionStorage.getItem(`freedom-onboarding-started:${userId}`)==='yes'}catch{return false}}
const rememberOnboarding=(userId:string,started:boolean)=>{try{if(started)sessionStorage.setItem(`freedom-onboarding-started:${userId}`,'yes');else sessionStorage.removeItem(`freedom-onboarding-started:${userId}`)}catch{/* Keep the in-memory choice. */}}


export function App() {
  // Old pop-out links now enter the same member message panel.
  const legacyConsole=new URL(window.location.href)
  const adminRoute=window.location.pathname==='/admin'||window.location.pathname.startsWith('/admin/')
  const popout=legacyConsole.searchParams.get('game-console')==='popout'
  if(popout&&!adminRoute){
    legacyConsole.searchParams.delete('game-console');legacyConsole.searchParams.delete('scope');legacyConsole.hash='messages'
    window.history.replaceState(null,'',legacyConsole)
  }
  const arToken=/^\/ar\/([A-Za-z0-9_-]{43})\/?$/.exec(window.location.pathname)?.[1]
  const page = arToken?<PublicArPage client={client} token={arToken}/> : popout&&adminRoute ? <GameConsolePopout client={client}/> : window.location.pathname==='/github/callback' ? <GitHubCallback/>
    : adminRoute ? <AdminConsoleShell/> : <MemberApp/>
  return <LanguageProvider><AppInstallProvider><RequestFeedback/><PageLoadBoundary label="自由工坊" resetKey={window.location.pathname}>{page}</PageLoadBoundary></AppInstallProvider></LanguageProvider>
}

const resetTokenFromHash=()=>/^#reset-password\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1]??null
const eventIdFromLocation=()=>{
  const inHash=/^#events\/([0-9a-f-]{36})(?:\?.*)?$/.exec(window.location.hash)?.[1];
  if(inHash)return inHash;
  if(window.location.hash&&!readEventParticipationToken())return null;
  return /^\/events\/([0-9a-f-]{36})\/?$/.exec(window.location.pathname)?.[1]??null;
}
const eventLoginFromLocation=()=>Boolean(eventIdFromLocation()&&window.history.state?.freedomEventLogin===window.location.href)
const isMessagesHash=(hash:string)=>hash.split('?')[0]==='#messages'
const isMessagesHistoryEntry=(state:unknown)=>Boolean(state&&typeof state==='object'&&(state as Record<string,unknown>).freedomMessagesOpen===true)
function messagesHistoryState(open:boolean,state:unknown=window.history.state){
  const next:Record<string,unknown>=state&&typeof state==='object'?{...state}:{}
  // This is only presentation state. Conversation IDs and drafts stay in React.
  if(open)next.freedomMessagesOpen=true
  else delete next.freedomMessagesOpen
  return Object.keys(next).length?next:null
}
const memberCardFromLocation=()=>/^\/member-cards\/([A-Za-z0-9_-]{43})\/?$/.exec(window.location.pathname)?.[1]??null
const clearResetHash=()=>window.history.replaceState(null,'',window.location.pathname+window.location.search)

function AdminConsoleShell(){
  const [memberId,setMemberId]=useState<string|null>(null)
  useEffect(()=>{let live=true;void client.getSession().then(session=>{if(live){client.csrfToken=session.csrf_token;setMemberId(session.user.user_id)}}).catch(()=>{if(live)setMemberId(null)});return()=>{live=false}},[])
  return <GameConsoleProvider client={memberId?client:undefined} userId={memberId??undefined} feedEnabled={Boolean(memberId)} standalone>
    <AdminPanel memberClient={memberId?client:undefined}/>
  </GameConsoleProvider>
}

function MemberApp() {
  const {t}=useLanguage()
  const [phase, setPhase] = useState<'boot' | 'login' | 'ready'>('boot')
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [bootError, setBootError] = useState<ActionError | null>(null)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [publicReturnNotice, setPublicReturnNotice] = useState<string | null>(null)
  const [site, setSite] = useState<SiteConfig | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingView | null>(null)
  const [gateError, setGateError] = useState('')
  const [exploring,setExploring]=useState(true)
  const [resetToken,setResetToken]=useState(resetTokenFromHash)
  const [emailVerificationToken,setEmailVerificationToken]=useState(()=>/^#verify-email\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1]??null);
  const [publicEventId,setPublicEventId]=useState(eventIdFromLocation)
  const [eventLoginRequested,setEventLoginRequested]=useState(eventLoginFromLocation)
  const [locationHash,setLocationHash]=useState(() => window.location.hash)
  const [profileLoginRequested,setProfileLoginRequested]=useState(()=>window.history.state?.freedomProfileLogin===window.location.hash);
  const profileRoute=parseProfileRoute(locationHash);
  const beginProfileLogin=()=>{window.history.pushState({...window.history.state,freedomProfileLogin:window.location.hash},'');setProfileLoginRequested(true);};
  const returnToProfile=()=>{if(window.history.state?.freedomProfileLogin===window.location.hash)window.history.back();else setProfileLoginRequested(false);};
  useEffect(()=>{const update=()=>setProfileLoginRequested(window.history.state?.freedomProfileLogin===window.location.hash);window.addEventListener('popstate',update);window.addEventListener('hashchange',update);return()=>{window.removeEventListener('popstate',update);window.removeEventListener('hashchange',update);};},[]);
  const [entryIntent,setEntryIntent]=useState<EntryIntent|null>(entryIntentFromHash)
  const [siteLoaded,setSiteLoaded]=useState(false)
  const [launchpadLoginRequested,setLaunchpadLoginRequested]=useState(false)
  const [sharedCardToken,setSharedCardToken]=useState(memberCardFromLocation)
  const [memberLoginRequested,setMemberLoginRequested]=useState(false)
  const returnToWorkshop=()=>{window.history.replaceState(null,'','/#home');setSharedCardToken(null);setMemberLoginRequested(false);window.dispatchEvent(new HashChangeEvent('hashchange'));}
  const editOwnCard=()=>{window.history.replaceState(null,'','/#account');setSharedCardToken(null);setMemberLoginRequested(false);window.dispatchEvent(new HashChangeEvent('hashchange'));}
  useEffect(()=>{const changed=()=>{setSharedCardToken(memberCardFromLocation());setMemberLoginRequested(false)};window.addEventListener('popstate',changed);return()=>window.removeEventListener('popstate',changed)},[])
  useEffect(()=>{const changed=()=>setResetToken(resetTokenFromHash());window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[])
  useEffect(()=>{const changed=()=>setEmailVerificationToken(/^#verify-email\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1]??null);window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[]);
  useEffect(()=>{const changed=()=>{setLocationHash(window.location.hash);setEntryIntent(entryIntentFromHash());setPublicEventId(eventIdFromLocation());setEventLoginRequested(eventLoginFromLocation());setLaunchpadLoginRequested(false)};window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed);return()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed)}},[])
  const sessionGeneration = useRef(0)
  const loadOnboarding = useCallback(async () => {
    const generation = sessionGeneration.current
    setGateError('')
    try { const value=await client.get<OnboardingView>('/me/onboarding');if(generation===sessionGeneration.current)setOnboarding(value) }
    catch (error) { if(generation===sessionGeneration.current)setGateError(describeError(error).message) }
  }, [])
  useEffect(() => { void client.get<SiteConfig>('/site').then(value => { setSite(value); setSiteLoaded(true) }).catch(() => { setSite(null); setSiteLoaded(true) }) }, [])
  useEffect(() => { if (session) void loadOnboarding(); else setOnboarding(null) }, [session, loadOnboarding])
  useEffect(() => {
    if (!session || !onboarding || onboarding.required && !onboarding.completed || !entryIntent) return
    // Only a chosen entry is forwarded, after the server confirms that the joining gate is complete.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${entryIntent}`)
    setEntryIntent(null)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [session, onboarding, entryIntent])

  const applySession = useCallback((next: SessionPayload) => {
    // Public reading can resume before the member workspace's onboarding gate.
    const postReturn=window.location.pathname==='/'&&window.location.hash==='#account'?publicPostReturn(window.location.search):null
    if(postReturn){window.location.replace(postReturn);return}
    const memberReturn=window.location.pathname==='/'?memberPostReturn(window.location.search,window.location.hash):null
    if(memberReturn){window.history.replaceState(null,'',memberReturn);window.dispatchEvent(new HashChangeEvent('hashchange'))}
    if(eventLoginFromLocation()){
      const state={...window.history.state};delete state.freedomEventLogin
      window.history.replaceState(Object.keys(state).length?state:null,'')
    }
    if(window.history.state?.freedomProfileLogin){const state={...window.history.state};delete state.freedomProfileLogin;window.history.replaceState(state,'');}
    setProfileLoginRequested(false);
    sessionGeneration.current += 1
    client.csrfToken = next.csrf_token
    setSharingDraftAccount(next.user.user_id, client.sessionGeneration)
    setOnboarding(null)
    setExploring(!onboardingStarted(next.user.user_id))
    setSession(next)
    setEventLoginRequested(false)
    setPhase('ready')
    setBootError(null)
    setLoginNotice(null)
  }, [])

  const toLogin = useCallback((notice?: string) => {
    window.dispatchEvent(new Event('freedom-game-console-session-end'))
    sessionGeneration.current += 1
    client.csrfToken = null
    setSharingDraftAccount(null, client.sessionGeneration)
    setOnboarding(null)
    setExploring(true)
    setSession(null)
    setPhase('login')
    if (notice) setLoginNotice(notice)
  }, [])

  const bootstrap = useCallback(async () => {
    setPhase('boot')
    setBootError(null)
    try {
      const entryUrl = window.location.href, generation = sessionGeneration.current
      const next = await client.getSession()
      const skillReturn = !window.location.hash && window.location.pathname === '/' ? skillAcquisitionFromSearch(window.location.search) : null
      if (skillReturn) {
        const allowed = await validateSkillReturn(skillReturn)
        if (generation !== sessionGeneration.current) return
        if (window.location.href === entryUrl && allowed) { window.location.assign(skillReadingPath(skillReturn)!); return }
      }
      applySession(next)
    } catch (err) {
      if (err instanceof ApiError && err.accessExpired) {
        setLoginNotice(null)
        setBootError(describeError(err))
        setPhase('login')
        return
      }
      if (err instanceof ApiError && err.unauthorized) {
        const sharedPost=window.location.pathname==='/'?anonymousSharedPost(window.location.search,window.location.hash):null
        if(sharedPost){window.location.replace(sharedPost);return}
        toLogin()
        return
      }
      setBootError(describeError(err))
      setPhase('login')
    }
  }, [applySession, toLogin])

  useEffect(() => {
    client.onUnauthorized = () => {
      if (client.accessExpired) {
        window.dispatchEvent(new Event('freedom-game-console-session-end'))
        sessionGeneration.current += 1
        client.csrfToken = null
        setSharingDraftAccount(null, client.sessionGeneration)
        setOnboarding(null)
        setSession(null)
        setLoginNotice(null)
        setBootError({ message: MEMBER_ACCESS_EXPIRED_MESSAGE, network: false, conflict: false, accessExpired: true })
        setPhase('login')
        return
      }
      toLogin('登入已過期，請重新登入。')
    }
    void bootstrap()
    return () => {
      client.onUnauthorized = null
    }
  }, [bootstrap, toLogin])

  // A request owned by an unmounted workspace may finish after re-login.
  const renderedSessionGeneration = sessionGeneration.current
  const leaveCurrentSession = (notice?: string) => {
    if (sessionGeneration.current === renderedSessionGeneration) toLogin(notice)
  }
  const eventLogin=()=>{
    if(readEventParticipationToken()){
      window.history.replaceState(null,'',window.location.pathname+window.location.search);
      setLocationHash('');
      setPublicEventId(eventIdFromLocation());
    }
    // Keep the public event and its referral/query intact behind the login view.
    // A scoped history entry makes Back/Forward dismiss/reopen the same view.
    if(!eventLoginFromLocation())window.history.pushState({...window.history.state,freedomEventLogin:window.location.href},'');
    setEventLoginRequested(true);
  };
  const returnToEvent=()=>{if(eventLoginFromLocation())window.history.back();else setEventLoginRequested(false)};

  if (phase === 'boot') {
    return (
      <div className="app-frame">
        {site?.demo_accounts_enabled && <DemoBanner />}
        <div className="centered">
          <p className="muted" role="status">
            正在確認登入狀態…
          </p>
        </div>
      </div>
    )
  }
  if(!resetToken&&publicEventId&&readEventParticipationToken(locationHash)&&!eventLoginRequested)return <PublicEventPage client={client} id={publicEventId} participationEnabled={site?.event_participation_enabled===true} onLogin={eventLogin}/>;

  const emailChangeToken=/^#change-email\/([A-Za-z0-9_-]{43})$/.exec(locationHash)?.[1];
  if(emailChangeToken)return <EmailChangeConfirm key={emailChangeToken} client={client} token={emailChangeToken}/>;
  if(emailVerificationToken)return <EmailVerificationConfirm key={emailVerificationToken} client={client} token={emailVerificationToken}/>;
  if (resetToken || phase !== 'ready' || !session) {
    // Preserve authentication callbacks; #1043 must retain its additional !googleCallback gate when merged.
    if(!resetToken&&!profileLoginRequested&&profileRoute?.kind==='visitor'&&canOpenGuestProfile(locationHash,window.location.search))return <div className="app-frame"><main className="main stack"><BrandPoster compact/><h1>個人頁</h1><VisitorProfile client={client} id={profileRoute.id} onLogin={beginProfileLogin}/><a className="btn btn-secondary btn-small" href="#home">返回自由工坊</a></main></div>;
    if(!resetToken&&locationHash.split('?')[0]==='#newbie-village')return <div className="app-frame"><main className="main stack"><BrandPoster compact/><header className="topbar"><h1>{t('nav.newbie-village')}</h1><PageTools pageId="newbie-village" client={client}/></header><a className="btn btn-secondary btn-small" href="#home">{t('nv.back')}</a><PageLoadBoundary label={t('nav.newbie-village')}><NewbieVillage/></PageLoadBoundary></main></div>;
    if(!resetToken&&sharedCardToken&&!memberLoginRequested)return <PublicMemberPage client={client} token={sharedCardToken} onLogin={()=>setMemberLoginRequested(true)} onReturn={returnToWorkshop}/>;
    if(!resetToken&&locationHash.split('?')[0]==='#community-hub')return <div className="app-frame"><main className="main stack"><BrandPoster compact/><header className="topbar"><h1>{t('nav.community-hub')}</h1><PageTools pageId="community-hub" client={client}/></header><a className="btn btn-secondary btn-small community-hub-back" href="#home">{t('communityHub.back')}</a><PageLoadBoundary label={t('nav.community-hub')}><CommunityHub/></PageLoadBoundary></main></div>;
    if(!resetToken&&locationHash.split('?')[0]==='#community-search'&&site?.community_search_enabled===true)return <div className="app-frame"><main className="main stack"><BrandPoster compact/><header className="topbar"><h1>搜尋社群內容</h1><PageTools pageId="community-search" client={client}/></header><a className="btn btn-secondary btn-small community-search-action" href="#home">返回登入</a><CommunitySearch client={client} authKey={null}/></main></div>;
    if(!resetToken&&locationHash.split('?')[0]==='#tester-map')return <div className="app-frame"><main className="main stack"><BrandPoster compact/><header className="topbar"><h1>{t('nav.tester-map')}</h1><PageTools pageId="tester-map" client={client}/></header><a className="btn btn-secondary btn-small tester-map-back" href="#home">{t('testerMap.back')}</a><PageLoadBoundary label={t('nav.tester-map')}><TesterMap/></PageLoadBoundary></main></div>;
    if(!resetToken&&publicEventId&&!eventLoginRequested)return <PublicEventPage client={client} id={publicEventId} revalidatePublic={site?.community_discovery_enabled===true} participationEnabled={site?.event_participation_enabled===true} onLogin={()=>{if(site?.community_discovery_enabled&&site.registration_enabled)window.location.assign(`/?join=1&return_to=${encodeURIComponent(`/events/${publicEventId}`)}`);else eventLogin()}}/>;
    const launchpadKey=guildKeyFromHash(locationHash);
    if(!resetToken&&launchpadKey&&site?.guild_launchpad_enabled===true&&!launchpadLoginRequested)return <PageLoadBoundary label="自由工坊" resetKey={launchpadKey}><PublicGuildLaunchpad key={launchpadKey} client={client} guildKey={launchpadKey} onLogin={()=>setLaunchpadLoginRequested(true)} pageTools={<PageTools pageId="guilds" compact/>}/></PageLoadBoundary>;
    if(!resetToken&&launchpadKey&&!siteLoaded)return <div className="app-frame"><div className="centered"><p className="muted" role="status">正在確認公開頁面…</p></div></div>;
    return (
      <div className="app-frame">
        {site?.demo_accounts_enabled && <DemoBanner />}
        {sharedCardToken&&<button type="button" className="btn btn-ghost" onClick={()=>setMemberLoginRequested(false)}>返回邀請名片</button>}
        {profileLoginRequested&&profileRoute?.kind==='visitor'&&<button type="button" className="btn btn-secondary btn-small" onClick={returnToProfile}>取消登入，返回個人頁</button>}
        <LoginView
          site={site}
          notice={loginNotice}
          bootError={bootError}
          onRetrySession={() => void bootstrap()}
          onLoggedIn={(next, returnNotice) => { applySession(next); setPublicReturnNotice(returnNotice ?? null) }}
          onReturnToGuild={!resetToken&&launchpadKey&&launchpadLoginRequested&&site?.guild_launchpad_enabled===true?()=>setLaunchpadLoginRequested(false):undefined}
          onReturnToEvent={!resetToken&&publicEventId&&eventLoginRequested?returnToEvent:undefined}
          entryIntent={entryIntent}
          onChooseEntry={intent=>{setEntryIntent(intent);window.location.hash=`join/${intent}`}}
          resetToken={resetToken}
          onCancelReset={()=>{clearResetHash();setResetToken(null)}}
          onPasswordReset={next=>{clearResetHash();setResetToken(null);if(next)applySession(next);else toLogin('密碼已重設。請使用新密碼登入，並輸入驗證器代碼或備用碼。')}}
        />
      </div>
    )
  }

  return (
    <MemberReportingProvider key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} enabled={site?.member_reporting_enabled===true}>
    <GameConsoleProvider key={session.user.user_id+':'+client.sessionGeneration} client={client} userId={session.user.user_id} session={session} site={site} feedEnabled={false} headless>
    <GitHubSocialProvider client={client} session={session} starGateEnabled={site?.skill_book_star_gate_enabled===true}>
    {publicReturnNotice && <p className="banner banner-info" role="status">{publicReturnNotice}</p>}
    {publicEventId && site?.community_discovery_enabled ? <PublicEventPage client={client} id={publicEventId} revalidatePublic onLogin={()=>window.location.assign('/#home')}/> : !onboarding ? <div className="centered"><div className="card stack"><h1>自由工坊</h1>{gateError ? <><p role="alert">{gateError}</p><button className="btn btn-primary" onClick={() => void loadOnboarding()}>重新載入定位進度</button></> : <p role="status">正在確認你的定位旅程…</p>}</div></div>
    : onboarding.required && !onboarding.completed && site?.commerce_checkout_enabled===true && locationHash==='#reservations' ? <div className="app-frame"><main className="main stack"><BrandPoster compact/><div className="card stack"><h1>我的訂單</h1><HostedOrderPage key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} locationHash={locationHash} registerLeave={()=>{}} replaceLocation={()=>{}} checkoutOrders={{userId:session.user.user_id,csrfToken:session.csrf_token,readOnly:true,onSessionExpired:()=>leaveCurrentSession('登入已過期，請重新登入。')}}/><div className="actions"><a className="btn btn-small btn-ghost" href="/#home">返回工坊</a></div></div></main></div>
    : onboarding.required && !onboarding.completed ? exploring&&!onboardingStarted(session.user.user_id)
      ? <WelcomePreview client={client} name={session.user.display_name} entryLabel={entryIntent?t(`intent.${entryIntent}`):undefined} onCompleted={()=>{rememberOnboarding(session.user.user_id,false);void loadOnboarding()}} onStart={()=>{rememberOnboarding(session.user.user_id,true);setExploring(false)}} onLogout={() => void client.logout(crypto.randomUUID()).then(() => leaveCurrentSession()).catch(error => setGateError(describeError(error).message))}/>
      : <Onboarding client={client} initial={onboarding} profileName={session.user.display_name} onExplore={()=>{rememberOnboarding(session.user.user_id,false);setExploring(true)}} onCompleted={() => { rememberOnboarding(session.user.user_id,false);if(parseProfileRoute(window.location.hash)?.kind!=='visitor' && !entryIntent && !buyerRoute(window.location.hash) && !sellerOrdersRoute(window.location.hash) && !sellerOrdersRoute(window.location.hash + '/orders'))window.location.hash = 'home'; void loadOnboarding() }} onLogout={() => void client.logout(crypto.randomUUID()).then(() => leaveCurrentSession()).catch(error => setGateError(describeError(error).message))}/>
    : sharedCardToken ? <PublicMemberPage client={client} token={sharedCardToken} session={session} onLogin={()=>{}} onReturn={returnToWorkshop} onEdit={editOwnCard}/> : <>
    <AuthorClaimProvider client={client}><DevelopmentAccessProvider client={client} session={session}>
    <Workspace key={`${session.user.user_id}:${client.sessionGeneration}`}
      site={site}
      session={session}
      onLoggedOut={() => leaveCurrentSession()}
      onSessionExpired={() => leaveCurrentSession('登入已過期，請重新登入。')}
    />
    <AdminReports client={client}/>
    </DevelopmentAccessProvider></AuthorClaimProvider>
    </>}
    </GitHubSocialProvider>
    </GameConsoleProvider>
    </MemberReportingProvider>
  )
}

function DemoBanner() {
  const {t}=useLanguage()
  return (
    <div className="demo-banner" role="status">
      {t('auth.demoBanner')}
    </div>
  )
}

function LoginView({
  site,
  notice,
  bootError,
  onRetrySession,
  onLoggedIn,
  entryIntent,
  onChooseEntry,
  resetToken,
  onCancelReset,
  onPasswordReset,
  onReturnToGuild,
  onReturnToEvent,
}: {
  site: SiteConfig | null
  notice: string | null
  bootError: ActionError | null
  onRetrySession: () => void
  onLoggedIn: (session: SessionPayload, returnNotice?: string) => void
  entryIntent: EntryIntent | null
  onChooseEntry: (intent: EntryIntent) => void
  resetToken:string|null
  onCancelReset:()=>void
  onPasswordReset:(session?:SessionPayload)=>void
  onReturnToGuild?:()=>void
  onReturnToEvent?:()=>void
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'request-reset'>('login')
  const [returnPath] = useState(() => publicDiscoveryPath(new URLSearchParams(window.location.search).get('return_to')))
  const [skillReturn] = useState(() => skillAcquisitionFromSearch(window.location.search))
  const [skillEntryUrl] = useState(() => window.location.href)
  const skillReturnRequest = useRef<AbortController | null>(null)
  const [storefrontReturn] = useState(() => storefrontReturnFromSearch(window.location.search))
  const postEntryUrl=window.location.href
  const postReturnPath=!resetToken&&window.location.pathname==='/'&&window.location.hash==='#account'?publicPostReturn(window.location.search):null
  const memberPostPath=!resetToken&&window.location.pathname==='/'?memberPostReturn(window.location.search,window.location.hash):null
  const authEpoch = useRef(0)
  const emailInput = useRef<HTMLInputElement>(null)
  const authForm = useRef<HTMLFormElement>(null)
  const discoveryEnabled = site?.community_discovery_enabled === true && !resetToken
  const join = useCallback(() => {
    setMode('register'); setError(null); setResetNotice('')
    requestAnimationFrame(() => { authForm.current?.scrollIntoView({ block: 'start' }); emailInput.current?.focus({ preventScroll: true }) })
  }, [])
  useEffect(() => { if ((discoveryEnabled||postReturnPath||(!resetToken&&skillReturn)) && site?.registration_enabled && new URLSearchParams(window.location.search).get('join') === '1') join() }, [discoveryEnabled,postReturnPath,site?.registration_enabled,resetToken,skillReturn,join])
  const activeMode=resetToken?'confirm-reset':mode
  const storefrontReturnEnabled = site?.commerce_checkout_enabled === true && !resetToken
  useEffect(() => () => { authEpoch.current++; skillReturnRequest.current?.abort() }, [activeMode])
  useEffect(() => {
    if(!postReturnPath&&!memberPostPath)return
    const moved=()=>{authEpoch.current++}
    window.addEventListener('hashchange',moved);window.addEventListener('popstate',moved)
    return()=>{window.removeEventListener('hashchange',moved);window.removeEventListener('popstate',moved)}
  },[postReturnPath,memberPostPath])
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [totpRequired,setTotpRequired]=useState(false)
  const [loginCode,setLoginCode]=useState('')
  const codeInput=useRef<HTMLInputElement>(null)
  // Only credential/mode changes invalidate a challenge, not code entry itself.
  useEffect(()=>{
    if(totpRequired)setTotpRequired(false)
    if(loginCode)setLoginCode('')
  },[activeMode,email,password])
  const [resetNotice,setResetNotice]=useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const {language,t}=useLanguage()
  const errorDetails=error?{...describeError(error),message:totpRequired&&error instanceof ApiError&&error.status===401&&!error.accessExpired?t('error.totpInvalid'):authErrorMessage(error,language)}:null

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    const epoch = authEpoch.current
    try {
      if(activeMode==='request-reset'){
        await client.post('/auth/reset/request',{email:email.trim()},{skipAuthHandler:true})
        setResetNotice('若此信箱有可用帳號，且寄送服務正常，請在 30 分鐘內查看重設連結。')
        return
      }
      if(activeMode==='confirm-reset'){
        if(password!==confirmPassword)throw new Error('兩次輸入的新密碼不一致。')
        const session=await client.post<SessionPayload|{reset:true;totp_required:true;expires_after_minutes:number}>('/auth/reset/confirm',{token:resetToken,password},{skipAuthHandler:true,suppressConsole:true})
        if(session&&'reset' in session&&session.reset&&session.totp_required){
          setPassword('');setConfirmPassword('');setMode('login')
          onPasswordReset()
          return
        }
        if(!session||!('user' in session))throw new Error('登入回應不完整')
        if(!session?.user||!session.csrf_token)throw new Error('登入回應不完整')
        onPasswordReset(session)
        return
      }
      const session = activeMode === 'register'
        ? await client.register({email:email.trim(),password,nickname:nickname.trim()})
        : await client.login(email.trim(), password, totpRequired?loginCode.trim():undefined)
      if (!session?.user || !session.csrf_token) {
        throw new Error('登入回應不完整')
      }
      if (epoch !== authEpoch.current) return
      if(postReturnPath||memberPostPath){
        if(window.location.href!==postEntryUrl)return
        if(postReturnPath){window.location.assign(postReturnPath);return}
        onLoggedIn(session);return
      }
      if (storefrontReturnEnabled && storefrontReturn) {
        const allowed = await successfulStorefrontReturn(storefrontReturn, session)
        if (epoch !== authEpoch.current) return
        if (allowed) { window.location.assign(storefrontReturn); return }
        onLoggedIn(session, activeMode === 'register'
          ? '帳號已建立。原本的商店目前無法確認或已停止公開，你仍可繼續逛工坊。'
          : '登入成功。原本的商店目前無法確認或已停止公開，你仍可繼續逛工坊。')
      } else if (skillReturn) {
        // Same-document Back/Forward can retain this form while changing the entry.
        if (window.location.href !== skillEntryUrl) { onLoggedIn(session); return }
        const controller = new AbortController(); skillReturnRequest.current?.abort(); skillReturnRequest.current = controller
        const allowed = await validateSkillReturn(skillReturn, {signal: controller.signal})
        if (epoch !== authEpoch.current || controller.signal.aborted) return
        if (window.location.href !== skillEntryUrl) { onLoggedIn(session); return }
        if (allowed) { window.location.assign(skillReadingPath(skillReturn)!); return }
        onLoggedIn(session, t('auth.skillReturnUnavailable'))
      } else if (activeMode === 'register' && discoveryEnabled && returnPath) {
        let allowed = false
        try { allowed = await validatePublicReturn(returnPath) } catch { /* Registration succeeded even when original content cannot be checked. */ }
        if (allowed) { window.location.assign(returnPath); return }
        onLoggedIn(session, '帳號已建立。原本的公開內容目前無法確認或已停止公開，你仍可繼續逛工坊。')
      } else onLoggedIn(session)
    } catch (err) {
      if(activeMode==='login'&&err instanceof ApiError&&err.code==='totp_required'){
        setTotpRequired(true);setLoginCode('')
        requestAnimationFrame(()=>codeInput.current?.focus())
      }else setError(err)
    } finally {
      setPending(false)
    }
  }

  const accessExpired = Boolean(bootError?.accessExpired || errorDetails?.accessExpired)
  // A plain visitor entry starts with existing public reading, not an account gate.
  // Dedicated return/reset/role journeys retain their current form and destination.
  const visitorFirst = !discoveryEnabled && !resetToken && !returnPath && !skillReturn
    && !storefrontReturn && !postReturnPath && !memberPostPath && !entryIntent
    && !onReturnToGuild && !onReturnToEvent && !accessExpired
  return (
    <main className={`login-layout${discoveryEnabled ? ' discovery-login-layout' : ''}${visitorFirst ? ' visitor-first-layout' : ''}`}>
      <div className="login-entry-tools"><LanguagePicker className="login-language-row"/><InstallAppButton/></div>
      {visitorFirst && <section className="visitor-first-step" aria-labelledby="visitor-heading">
        <h1 id="visitor-heading">{t('auth.headline')}</h1>
        <EntryResources client={client} communitySearchEnabled={site?.community_search_enabled===true} compact/>
      </section>}
      {discoveryEnabled ? <section className="login-story discovery-story"><BrandPoster/><PublicDiscovery onJoin={join} registrationEnabled={Boolean(site?.registration_enabled)}/></section> : <section className="login-story"><BrandPoster/><div className="login-story-copy">{!visitorFirst&&<><h1>{t('auth.headline')}</h1><p className="login-purpose-intro">{t('auth.intro')}</p></>}<PlatformPurpose variant="public" disabled={pending||accessExpired||activeMode==='confirm-reset'} onAction={target=>{
        if(target!=='supplier'&&target!=='showcase'&&target!=='tasks')return
        onChooseEntry(target);setMode(site?.registration_enabled?'register':'login');setError(null);setResetNotice('')
        requestAnimationFrame(()=>emailInput.current?.focus())
      }}/></div></section>}
      <div className="login-form-area">
      <section className="card login-card" aria-labelledby="login-heading">
        {!accessExpired && activeMode!=='confirm-reset'&&<div className="auth-switch" role="group" aria-label={t('auth.switch')}><button type="button" className={activeMode==='login'?'selected':''} aria-pressed={activeMode==='login'} onClick={()=>{setMode('login');setError(null);setResetNotice('')}}>{t('auth.memberLogin')}</button>{site?.registration_enabled&&<button type="button" className={activeMode==='register'?'selected':''} aria-pressed={activeMode==='register'} onClick={()=>{setMode('register');setError(null);setResetNotice('')}}>{t('auth.create')}</button>}</div>}
        <header className="login-card-heading"><h2 id="login-heading">{t(accessExpired?'auth.accessExpired':activeMode==='register'?'auth.join':activeMode==='request-reset'?'auth.forgot':activeMode==='confirm-reset'?'auth.newPasswordTitle':'auth.login')}</h2><PageTools pageId="registration" compact/></header>
        {postReturnPath&&<p className="purpose-next-destination"><a href={postReturnPath}>返回貼文繼續閱讀</a><br/>{activeMode==='register'?'建立帳號後會回到這篇貼文，加入公會可稍後完成。':'登入後會回到這篇貼文。'}</p>}
        {memberPostPath&&<p className="purpose-next-destination">登入後會回到指定貼文，並確認你的閱覽權限。</p>}
        {entryIntent&&!accessExpired&&activeMode!=='confirm-reset'&&activeMode!=='request-reset'&&<p className="purpose-next-destination" role="status">{language==='zh-Hant'?`${activeMode==='register'?'加入':'登入'}後前往：${entryIntentLabel(entryIntent)}。`:t('auth.destination',{destination:t(`intent.${entryIntent}`)})}</p>}
        {!skillReturn && discoveryEnabled && returnPath && activeMode === 'register' && <p className="muted">建立帳號後，會先確認並返回原本的公開內容；選公會與完整定位可以稍後再做。</p>}
        {skillReturn && !accessExpired && (activeMode === 'login' || activeMode === 'register') && <div className="purpose-next-destination">
          <p>{t('auth.skillReturnHint')}</p><a href={skillReadingPath(skillReturn)!}>{t('auth.skillReturnRead')}</a>
        </div>}
        {storefrontReturnEnabled && storefrontReturn && activeMode === 'login' && <p className="muted">登入後會返回原本的商店頁面。</p>}
        {storefrontReturnEnabled && storefrontReturn && activeMode === 'register' && <p className="muted">建立帳號後，會先確認並返回原本的商店頁面；選公會與完整定位可以稍後再做。</p>}
        {notice && !accessExpired && (
          <p className="banner banner-info" role="status">
            {language==='zh-Hant'?notice:authErrorMessage({message:notice},language)}
          </p>
        )}
        {bootError && (
          <ErrorPanel error={{...bootError,message:authErrorMessage(bootError,language)}} onReload={onRetrySession} reloadLabel={t('auth.checkSession')} />
        )}
        {errorDetails && <ErrorPanel error={errorDetails} />}
        {resetNotice&&<p className="banner banner-info" role="status">{t('auth.resetNotice')}</p>}
        {!accessExpired && <form ref={authForm} className="stack" onSubmit={(event) => void onSubmit(event)}>
          {activeMode==='register'&&<p className="registration-progress">{t('auth.progress')}</p>}
          {activeMode!=='confirm-reset'&&<label className="field">
            <span className="field-label">{t('auth.email')}</span>
            <input
              ref={emailInput}
              name="email"
              type="email"
              inputMode="email" autoCapitalize="none" spellCheck={false}
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </label>}
          {activeMode!=='request-reset'&&<PasswordField key={activeMode}
            label={t(activeMode==='confirm-reset'?'auth.newPassword':'auth.password')}
            value={password} onChange={setPassword} disabled={pending} language={language}
            autoComplete={activeMode==='register'||activeMode==='confirm-reset'?'new-password':'current-password'}
            minLength={activeMode==='register'||activeMode==='confirm-reset'?12:undefined}
            hint={activeMode==='register'||activeMode==='confirm-reset'?t('auth.passwordHint'):undefined}/>}
          {activeMode==='login'&&totpRequired&&<label className="field"><span className="field-label">{t('auth.totpCode')}</span><input ref={codeInput} name="code" type="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} required maxLength={64} value={loginCode} onChange={event=>setLoginCode(event.target.value)} disabled={pending} aria-describedby="login-totp-hint"/><span id="login-totp-hint" className="field-hint">{t('auth.totpHint')}</span></label>}
          {activeMode==='confirm-reset'&&<label className="field">{t('auth.confirmPassword')}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} disabled={pending}/></label>}
          {activeMode==='register'&&<><label className="field"><span className="field-label" id="register-nickname-label">{t('auth.nickname')}</span><input name="nickname" maxLength={60} autoComplete="nickname" aria-labelledby="register-nickname-label" aria-describedby="register-nickname-hint" placeholder={t('auth.optionalName')} value={nickname} onChange={event=>setNickname(event.target.value)} disabled={pending}/><span className="field-hint" id="register-nickname-hint">{t('auth.nicknameHint')}</span></label><p className="field-hint">{t(site?.password_recovery_enabled?'auth.recoveryAvailable':'auth.recoveryUnavailable')}</p></>}
          {activeMode==='request-reset'&&<p className="field-hint">{t('auth.resetHint')}</p>}
          <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>
            {t(pending?'auth.pending':activeMode==='register'?'auth.createExplore':activeMode==='request-reset'?'auth.sendReset':activeMode==='confirm-reset'?'auth.savePassword':'auth.login')}
          </button>
        </form>}
        {onReturnToGuild&&<button type="button" className="btn btn-ghost" disabled={pending} onClick={onReturnToGuild}>返回公會啟動台</button>}
        {onReturnToEvent&&<button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={onReturnToEvent}>返回活動</button>}
        {!accessExpired&&<div className="login-secondary-actions">
          {site?.password_recovery_enabled&&activeMode==='login'&&<button type="button" className="btn btn-ghost" disabled={pending} onClick={()=>{setMode('request-reset');setError(null);setResetNotice('')}}>{t('auth.forgotButton')}</button>}
          {activeMode==='request-reset'&&<button type="button" className="btn btn-ghost" disabled={pending} onClick={()=>{setMode('login');setError(null);setResetNotice('')}}>{t('auth.backLogin')}</button>}
          {activeMode==='confirm-reset'&&<button type="button" className="btn btn-ghost" disabled={pending} onClick={onCancelReset}>{t('auth.backLogin')}</button>}
        </div>}
        {!accessExpired && site?.demo_accounts_enabled&&activeMode==='login'&&<aside className="help-box" aria-label={t('auth.demo')}>
          <p>
            {language==='zh-Hant'?<>示範帳號（虛構身分，不是真實人士）。密碼皆為 </>:t('auth.demoHint')} <code>{DEMO_PASSWORD}</code>。
          </p>
          <div className="chip-row">
            {DEMO_ACCOUNTS.map((account,index) => (
              <button
                key={account.email}
                type="button"
                className="chip"
                disabled={pending}
                onClick={() => {
                  setEmail(account.email)
                  setPassword(DEMO_PASSWORD)
                }}
              >
                {t(index===0?'auth.demoMaker':index===1?'auth.demoReviewer':'auth.demoClient')}
                <span className="chip-email">{account.email}</span>
              </button>
            ))}
          </div>
        </aside>}
      </section></div>
      <p className="login-language-scope field-hint">{t('language.scope')}</p>
      {!visitorFirst&&<div className="login-public-resources"><EntryResources client={client} communitySearchEnabled={!resetToken&&site?.community_search_enabled===true}/></div>}
      <CommunityLinks/>
    </main>
  )
}

function Workspace({
  site,
  session,
  onLoggedOut,
  onSessionExpired,
}: {
  site: SiteConfig | null
  session: SessionPayload
  onLoggedOut: () => void
  onSessionExpired: () => void
}) {
  const {t}=useLanguage()
  const [headerMember,setHeaderMember]=useState<MemberCardData|null>(null)
  const [canManageGuild,setCanManageGuild]=useState(false)
  useEffect(()=>{
    let active=true,generation=0;
    const refresh=()=>{
      const current=++generation;
      void client.get<{managed_guilds:unknown[];managed_books:unknown[];can_discuss:boolean;skill_editor_access?:{requires_development_guild:boolean}}>('/guild-workspace')
        .then(value=>{if(active&&current===generation)setCanManageGuild(Boolean(value.can_discuss||value.managed_guilds.length||value.managed_books.length||value.skill_editor_access?.requires_development_guild))})
        .catch(()=>{if(active&&current===generation)setCanManageGuild(false)});
    };
    refresh();window.addEventListener('focus',refresh);window.addEventListener('freedom-profile-updated',refresh);
    return()=>{active=false;generation++;window.removeEventListener('focus',refresh);window.removeEventListener('freedom-profile-updated',refresh)};
  },[session.user.user_id])
  useEffect(()=>{let active=true,generation=0;const refresh=()=>{const current=++generation;void client.get<MemberCardData>(`/members/${session.user.user_id}`).then(value=>{if(active&&current===generation)setHeaderMember(value)}).catch(()=>{})};refresh();window.addEventListener('freedom-profile-updated',refresh);return()=>{active=false;generation++;window.removeEventListener('freedom-profile-updated',refresh)}},[session.user.user_id])
  useEffect(()=>{
    let active=true;
    const generation=client.sessionGeneration;
    const heartbeat=()=>{
      if(document.visibilityState!=='visible')return;
      void client.get<SessionPayload>('/session',{background:true}).then(next=>{
        // Other tabs share the cookie, not this workspace's identity or CSRF.
        if(active&&generation===client.sessionGeneration&&(next.user.user_id!==session.user.user_id||next.csrf_token!==session.csrf_token))onSessionExpired();
      }).catch(()=>{});
    };
    const timer=window.setInterval(heartbeat,60_000);
    document.addEventListener('visibilitychange',heartbeat);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',heartbeat)};
  },[session.user.user_id,session.csrf_token]);
  const [tab, setTab] = useState<TabId>(() => tabFromHash(site?.guild_launchpad_enabled === true))
  const [locationHash, setLocationHash] = useState(() => window.location.hash)
  const helperScope=JSON.stringify([client.sessionGeneration,locationHash]);
  const [helperReady,setHelperReady]=useState<{scope:string;action:GuideHelperAction}|null>(null);
  const receiveHelper=useCallback((action:GuideHelperAction|null)=>{
    setHelperReady(previous=>action?{scope:helperScope,action}:previous?.scope===helperScope?null:previous);
  },[helperScope]);
  const {canEndSession:canEndConsoleSession}=useGameConsole()
  const consoleRoute = tab === 'stores' && site?.supplier_console_enabled === true ? parseSupplierConsoleRoute(locationHash) : null
  const sellerRoute = tab === 'stores' && site?.commerce_console_enabled === true ? parseSellerConsoleRoute(locationHash) : null;
  const pageLeaveGuard = useRef<((nextHash: string | null) => boolean) | null>(null)
  const acceptedHash = useRef(window.location.hash)
  const registerPageLeave = useCallback((guard: ((nextHash: string | null) => boolean) | null) => { pageLeaveGuard.current = guard }, [])
  const replaceBuyerLocation = useCallback((hash: string) => {
    if (!buyerRoute(hash)) return
    // Only the buyer page uses this after holding/confirming its exact attempt.
    acceptedHash.current = hash
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`)
    setLocationHash(hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationTarget,setNotificationTarget]=useState<(BellAction&{sequence:number})|null>(null)
  const notificationSequence=useRef(0)
  const [friendScope,setFriendScope]=useState<'accepted'|'incoming'>('accepted')
  const [chatEntry,setChatEntry]=useState<ChatEntry|null>(null)
  const chatEntrySequence=useRef(0)
  const [messagesOpen,setMessagesOpen]=useState(()=>isMessagesHash(window.location.hash)||isMessagesHistoryEntry(window.history.state))
  const [messagesMounted,setMessagesMounted]=useState(()=>isMessagesHash(window.location.hash)||isMessagesHistoryEntry(window.history.state))
  const messageLocation=useRef({href:window.location.href,state:window.history.state})
  const messageHistoryTransition=useRef<{after:(()=>void)|null}|null>(null)
  const messageLeaveGuard=useRef<(()=>boolean)|null>(null)
  const registerMessageLeave=useCallback((guard:(()=>boolean)|null)=>{messageLeaveGuard.current=guard},[])
  const openMessages=useCallback(function open(){
    // A close traverses history asynchronously. Queue a rapid reopen after it,
    // rather than pushing onto the entry that is about to disappear.
    if(messageHistoryTransition.current){messageHistoryTransition.current.after=open;return}
    if(!isMessagesHistoryEntry(window.history.state))window.history.pushState(messagesHistoryState(true),'')
    messageLocation.current={href:window.location.href,state:window.history.state}
    setMessagesMounted(true);setMessagesOpen(true);setMobileOpen(false)
  },[])
  const closeMessagesThen=useCallback((after:(()=>void)|null=null)=>{
    setMessagesOpen(false)
    if(messageHistoryTransition.current){if(after)messageHistoryTransition.current.after=after;return}
    if(isMessagesHistoryEntry(window.history.state)){
      messageHistoryTransition.current={after}
      window.history.back()
    }else after?.()
  },[])
  const closeMessages=useCallback(()=>closeMessagesThen(),[closeMessagesThen])
  useEffect(()=>{
    if(!isMessagesHash(window.location.hash)&&!isMessagesHistoryEntry(window.history.state))return
    if(!isMessagesHistoryEntry(window.history.state)){
      // A cold legacy link has no in-app return point. Seed home underneath the
      // overlay once; reloads retain the marker and do not grow the history.
      const destination=window.location.href
      window.history.replaceState(messagesHistoryState(false),'',`${window.location.pathname}${window.location.search}#home`)
      window.history.pushState(messagesHistoryState(true),'',destination)
    }
    openMessages()
  },[openMessages])
  const [shareEntry,setShareEntry]=useState<{target:ShareTarget;tab:TabId;sequence:number}|null>(null)
  const [shareNotice,setShareNotice]=useState('')
  const shareSequence=useRef(0)
  const menuToggle = useRef<HTMLButtonElement>(null)
  const mainContent = useRef<HTMLElement>(null)
  const workspaceTopbar = useRef<HTMLElement>(null)
  const helperFocusPending = useRef<string | null>(null)
  const previousTab = useRef(tab)
  useEffect(() => {
    setMobileOpen(false)
    if (previousTab.current === tab) {
      // Accepted same-page history changes must not leave focus in hidden navigation.
      if (document.activeElement?.closest('#workspace-navigation')) mainContent.current?.focus({ preventScroll: true })
      return
    }
    previousTab.current = tab
    if(tab!=='social')setNotificationTarget(current=>current?.tab==='social'?null:current)
    logConsoleEvent({channel:consoleChannel('guide_navigation'),kind:'guide',source:'導覽',message:`已進入「${tabTitle(tab)}」。${TAB_GUIDANCE[tab]}`})
    mainContent.current?.focus({ preventScroll: true })
    workspaceTopbar.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [tab, locationHash])
  useEffect(() => {
    const expectedHash = helperFocusPending.current
    helperFocusPending.current = null
    // A same-tab helper route has committed and its keyed native dialog is gone.
    // A newer modal owns focus; never take it back from that surface.
    if (expectedHash === locationHash && !document.querySelector('dialog[open],[aria-modal="true"]')) mainContent.current?.focus({preventScroll:true})
  }, [locationHash])
  const selectTab = useCallback((next: TabId, destinationHash?: string) => {
    if(next==='messages'){openMessages();return}
    const nextHash = destinationHash ?? `#${next}`
    if (nextHash !== acceptedHash.current && pageLeaveGuard.current && !pageLeaveGuard.current(nextHash)) return
    acceptedHash.current = nextHash
    if(next==='friends')setFriendScope('accepted')
    // Navigation intents (for example the share launcher) observe the new page
    // immediately, even while the overlay's history traversal is finishing.
    setTab(next);setLocationHash(nextHash)
    const navigate=()=>{
      acceptedHash.current = nextHash
      setMobileOpen(false)
      mainContent.current?.focus({ preventScroll: true })
      setTab(next);setLocationHash(nextHash)
      if(/^\/events\/[0-9a-f-]{36}\/?$/.test(window.location.pathname)){
        window.history.replaceState(messagesHistoryState(false),'',`/${nextHash}`)
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      }
      else window.location.hash = nextHash
    }
    // Leave the overlay's history entry before pushing a destination, so Back
    // returns to the actual page and cannot reopen an abandoned full-screen chat.
    closeMessagesThen(navigate)
  }, [openMessages,closeMessagesThen])
  const navigateFromHelper = useCallback((next: TabId) => {
    const previousHash = acceptedHash.current
    selectTab(next)
    // The guard's accepted hash, not the void callback, proves a route change.
    // Focus only after the keyed helper dialog has been removed from the DOM.
    if (next === tab && acceptedHash.current !== previousHash && acceptedHash.current === `#${next}`) helperFocusPending.current = acceptedHash.current
  }, [selectTab, tab])
  function navigateNotification(action:BellAction){
    const destination=orderNotificationDestination(action)
    if(destination?.tab==='stores'){selectTab('stores',destination.hash);return}
    if(destination?.tab==='reservations'){
      if(pageLeaveGuard.current&&!pageLeaveGuard.current(null))return
      if(!canEndConsoleSession()||messageLeaveGuard.current&&!messageLeaveGuard.current())return
      window.location.assign(destination.path);return
    }
    if(action.tab==='stores'||action.tab==='reservations')return
    selectTab(action.tab,action.tab==='events'&&action.resource_id?`#events/${action.resource_id}`:undefined)
    setNotificationTarget({...action,sequence:++notificationSequence.current})
  }
  function chooseShare(target:ShareTarget){
    const definition=SHARE_TARGETS[target]
    const destination=target==='post'&&tab==='home'?'home':definition.tab
    setShareNotice('');setShareEntry({target,tab:destination,sequence:++shareSequence.current});selectTab(destination,definition.hash)
    // A refused page-leave leaves the current hash, so this entry must not settle on the page that stayed.
    if(acceptedHash.current!==(definition.hash??'#'+destination))setShareEntry(null)
  }
  useEffect(()=>{
    if(!shareEntry)return
    if(tab!==shareEntry.tab){setShareEntry(null);return}
    const root=mainContent.current;if(!root)return
    let done=false
    const definition=SHARE_TARGETS[shareEntry.target]
    const settle=()=>{
      if(done)return
      const target=root.querySelector<HTMLElement>(definition.selector)
      if(target&&!target.matches(':disabled')){
        done=true;observer.disconnect()
        if(definition.activate)target.click()
        else{target.scrollIntoView({block:'center',behavior:'instant'});target.focus({preventScroll:true})}
        setShareEntry(current=>current?.sequence===shareEntry.sequence?null:current)
      }else if(root.querySelector('[role="alert"]')){
        done=true;observer.disconnect();setShareNotice('分享入口暫時無法載入，請使用頁面的重新載入。')
        setShareEntry(current=>current?.sequence===shareEntry.sequence?null:current)
      }
    }
    // The existing lazy page and data load own their requests. Only move focus
    // after the chosen real control mounts; never submit a form or upload here.
    const observer=new MutationObserver(settle)
    observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});settle()
    return()=>{done=true;observer.disconnect()}
  },[shareEntry,tab])
  useEffect(()=>{
    const open=(event:Event)=>{const value=(event as CustomEvent).detail;if(!isChatEntry(value))return;selectTab('messages');setChatEntry({...value,request:++chatEntrySequence.current})}
    window.addEventListener(CHAT_ENTRY_EVENT,open);return()=>window.removeEventListener(CHAT_ENTRY_EVENT,open)
  },[selectTab])
  useEffect(()=>{
    if(!isMessagesHash(locationHash))return
    const entry={kind:'guild',key:new URLSearchParams(locationHash.split('?')[1]??'').get('guild')}
    if(isChatEntry(entry))setChatEntry({...entry,request:++chatEntrySequence.current})
  },[locationHash])
  const launchpadEnabled = site?.guild_launchpad_enabled === true
  useEffect(() => {
    setLocationHash(window.location.hash)
    setTab(tabFromHash(launchpadEnabled))
  }, [launchpadEnabled])
  useEffect(() => {
    const changed = (event:Event) => {
      const nextHash = window.location.hash
      const current={href:window.location.href,state:window.history.state}
      const previous=messageLocation.current
      const transition=messageHistoryTransition.current
      // A fragment traversal emits both popstate and hashchange. Only consume
      // the traversal once, before running a queued reopen or page navigation.
      if(transition){
        if(event.type!=='popstate')return
        messageHistoryTransition.current=null
        messageLocation.current=current
        acceptedHash.current=nextHash
        setLocationHash(nextHash);setTab(tabFromHash(launchpadEnabled));setMessagesOpen(false)
        transition.after?.()
        return
      }
      if(current.href===previous.href&&isMessagesHistoryEntry(current.state)===isMessagesHistoryEntry(previous.state))return
      if (nextHash !== acceptedHash.current && pageLeaveGuard.current && !pageLeaveGuard.current(nextHash)) {
        window.history.replaceState(previous.state, '', `${window.location.pathname}${window.location.search}${acceptedHash.current}`)
        messageLocation.current={href:window.location.href,state:window.history.state}
        return
      }
      if(isMessagesHash(nextHash)&&!isMessagesHistoryEntry(current.state)){
        if(isMessagesHistoryEntry(previous.state)){
          // A second legacy hash while open should replace the current chat
          // entry, not create another Back step for the same overlay.
          messageHistoryTransition.current={after:()=>{
            window.history.pushState(messagesHistoryState(true),'',current.href)
            acceptedHash.current=nextHash;setLocationHash(nextHash);setTab('home');openMessages()
          }}
          // Return beneath both chat entries, then push once to discard the
          // duplicate forward branch as well as the extra Back step.
          window.history.go(-2)
          return
        }
        // Hash navigation already created an entry; adopt it without pushing.
        window.history.replaceState(messagesHistoryState(true),'')
      }
      acceptedHash.current = nextHash
      setLocationHash(nextHash); setTab(tabFromHash(launchpadEnabled))
      messageLocation.current={href:window.location.href,state:window.history.state}
      if(isMessagesHistoryEntry(window.history.state))openMessages()
      else setMessagesOpen(false)
    }
    window.addEventListener('hashchange', changed)
    window.addEventListener('popstate', changed)
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed) }
  }, [launchpadEnabled,openMessages])
  const launchpadOpen = site?.guild_launchpad_enabled === true && tab === 'guilds' && guildKeyFromHash(locationHash) !== null
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<ActionError | null>(null)
  const keysRef = useRef(new Map<string, string>())
  const lockRef = useRef(false)

  const mutate = useCallback(
    async (actionId: string, fn: (key: string) => Promise<void>) => {
      if (lockRef.current) return false
      lockRef.current = true
      setPending(actionId)
      setError(null)
      const key = keysRef.current.get(actionId) ?? crypto.randomUUID()
      keysRef.current.set(actionId, key)
      try {
        await fn(key)
        keysRef.current.delete(actionId)
        return true
      } catch (err) {
        const described = describeError(err)
        if (err instanceof ApiError && err.accessExpired) {
          setError(described)
          return false
        }
        if (err instanceof ApiError && err.unauthorized) {
          onSessionExpired()
          return false
        }
        if (!described.network) {
          keysRef.current.delete(actionId)
        } else {
          described.retry = () => {
            void mutate(actionId, fn).then(ok => { if (ok) window.location.reload() })
          }
        }
        setError(described)
        return false
      } finally {
        lockRef.current = false
        setPending(null)
      }
    },
    [onSessionExpired],
  )

  const value = useMemo<PortalContextValue>(
    () => ({
      session,
      pending,
      error,
      mutate,
      clearError: () => setError(null),
      isMe: (ref) => isOwnRef(session.user, ref),
    }),
    [error, mutate, pending, session],
  )

  async function logout() {
    if (pageLeaveGuard.current && !pageLeaveGuard.current(null)) return
    if (!canEndConsoleSession() || messageLeaveGuard.current&&!messageLeaveGuard.current()) return
    const ok = await mutate('logout', async (key) => {
      await client.logout(key)
    })
    if (ok) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      onLoggedOut()
    }
  }

  return (
    <PortalContext.Provider value={value}>
      <div className="app-frame social-layout">
        {site?.demo_accounts_enabled && <DemoBanner />}
        <a className="skip" href="#main-content" onClick={event => { event.preventDefault(); mainContent.current?.focus(); }}>
          跳到主要內容
        </a>
        <div className="shell">
          <header className="community-header">
          <aside className="sidebar" onKeyDown={event => { if (event.key === 'Escape' && mobileOpen && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { setMobileOpen(false); menuToggle.current?.focus(); } }}>
            <div className="sidebar-heading"><a className="brand brand-home" href="/#home" aria-label={`自由工坊 · ${t('nav.home')}`} onClick={event => activateHomeLink(event, () => {
              selectTab('home');
              // The existing leave guard must accept before changing the canonical URL or scroll.
              if (acceptedHash.current !== '#home') return;
              if (window.location.pathname !== '/' || window.location.search) {
                window.history.replaceState(window.history.state, '', '/#home');
                window.dispatchEvent(new HashChangeEvent('hashchange'));
              }
              workspaceTopbar.current?.scrollIntoView({block: 'start', behavior: 'instant'});
            })}><strong>自由工坊</strong></a>
            <button ref={menuToggle} type="button" className="btn btn-ghost mobile-menu-toggle" aria-label={t(mobileOpen?'nav.closeMenu':'nav.openMenu')} aria-expanded={mobileOpen} aria-controls="workspace-navigation" onClick={() => setMobileOpen(value => !value)}>{t(mobileOpen?'nav.closeMenu':'nav.openMenu')}</button></div>
            <Navigation current={tab} currentHash={locationHash} onSelect={selectTab} canManageGuild={canManageGuild} guildLaunchpadEnabled={site?.guild_launchpad_enabled === true} communitySearchEnabled={site?.community_search_enabled === true} personalContentEnabled={site?.personal_content_enabled === true} mobileOpen={mobileOpen} onCloseMobile={returnFocus => { setMobileOpen(false); if (returnFocus) menuToggle.current?.focus(); }}/>
          </aside>
          <div className="topbar-actions community-account-tools"><NotificationBell key={session.user.user_id+':'+session.csrf_token} client={client} preferencesEnabled={site?site.notification_preferences_enabled===true:null} onNavigate={navigateNotification}/><SettingsMenu personalContentEnabled={site?.personal_content_enabled===true} current={tab} onSelect={selectTab} name={headerMember?.nickname??session.user.display_name} avatar={<MemberAvatar nickname={headerMember?.nickname??session.user.display_name} avatarUrl={headerMember?.avatar_url} className="topbar-avatar"/>} onLogout={() => void logout()} logoutDisabled={Boolean(pending)}/></div>
          </header>
          <section className="main workspace-main">
            <header ref={workspaceTopbar} className="topbar workspace-topbar">
              <div>
                {launchpadOpen ? null : <h1 id="workspace-page-title">{consoleRoute ? t(consoleRoute.titleKey) : sellerRoute ? t(sellerRoute.titleKey) : tab === 'stores' && (locationHash === '#stores/supply' || /^#stores\/[^/]+\/[^/]+\/supply(?:[/?]|$)/.test(locationHash)) ? t('stores.supplyTitle') : t(`nav.${tab}`)}</h1>}
              </div>
              <PageTools pageId={consoleRoute ? 'supplier-console' : tab} client={client} compact/>
              <div className="topbar-actions"><PlatformHelperHost pageId={consoleRoute ? 'supplier-console' : tab} routeIdentity={locationHash}
                sessionGeneration={client.sessionGeneration} availablePageIds={Object.keys(TAB_TITLES)} guildLaunchpadEnabled={site?.guild_launchpad_enabled}
                mobileOpen={mobileOpen} messagesOpen={messagesOpen} pending={Boolean(pending)} accessExpired={Boolean(error?.accessExpired)} onNavigate={navigateFromHelper} onHelperReady={receiveHelper}/><ShareLauncher onChoose={chooseShare} disabled={Boolean(pending)} guided={site?.unified_sharing_enabled===true} storesEnabled={site?.guild_launchpad_enabled===true} onMyContent={site?.personal_content_enabled === true ? () => selectTab('my-content') : undefined}/></div>
            </header>
            <div className="workspace-content">
              <GuideHost key={helperScope} pageId={consoleRoute ? 'supplier-console' : tab} scopeKey={session.user.user_id}
                helperAction={helperReady?.scope===helperScope?helperReady.action:undefined}
                memberAccess={!error?.accessExpired && !mobileOpen && !pending && (tab !== 'guild-workspace' || canManageGuild) && (!['business', 'stores'].includes(tab) || site?.guild_launchpad_enabled === true)}/>
              <main ref={mainContent} className="workspace-page" id="main-content" tabIndex={-1} aria-labelledby="workspace-page-title">
            {(shareEntry||shareNotice)&&<p className="share-entry-status" role="status">{shareEntry?`正在開啟${SHARE_TARGETS[shareEntry.target].label}…`:shareNotice}</p>}
            {error && (
              <ErrorPanel
                error={error}
                onReload={() => window.location.reload()}
              />
            )}
            <PageLoadBoundary label={t(`nav.${tab}`)} resetKey={tab}>
            {renderPortalFeature(tab, {
              client, session, site, locationHash, selectTab, friendScope, notificationTarget, headerMember,
              registerPageLeave, replaceBuyerLocation, onSessionExpired,
              openHomeJournal: () => requestHomeJournalOpen(() => {
                if (pageLeaveGuard.current && !pageLeaveGuard.current(null)) return false;
                return canEndConsoleSession() && (!messageLeaveGuard.current || messageLeaveGuard.current());
              }),
              openMemberMessage: id => { selectTab('messages'); setNotificationTarget({tab:'messages', resource_id:id, sequence:++notificationSequence.current}); },
              showIncomingFriends: () => { selectTab('friends'); setFriendScope('incoming'); },
            })}
            </PageLoadBoundary>
              </main>
            </div>
          </section>
        </div>
        {!error?.accessExpired&&<FloatingMessages client={client} preferencesEnabled={site?site.notification_preferences_enabled===true:null} open={messagesOpen} onToggle={()=>messagesOpen?closeMessages():openMessages()} onClose={closeMessages}>
          {messagesMounted&&<PageLoadBoundary label={t('nav.messages')} resetKey={session.user.user_id} onHome={closeMessages}>
            <MemberMessages registerLeave={registerMessageLeave} active={messagesOpen} messageImagesEnabled={site?.message_images_enabled===true} client={client} session={session} memberBlockingEnabled={site?.member_blocking_enabled===true} onNavigate={selectTab} chatEntry={chatEntry} onNotificationPeer={notificationTarget?.tab==='messages'&&notificationTarget.resource_id?{id:notificationTarget.resource_id,sequence:notificationTarget.sequence}:undefined}/>
          </PageLoadBoundary>}
        </FloatingMessages>}
      </div>
    </PortalContext.Provider>
  )
}

function tabTitle(tab: TabId): string {
  return TAB_TITLES[tab]
}

function tabFromHash(launchpadEnabled: boolean): TabId {
  const value = window.location.hash.slice(1)
  if(parseProfileRoute(window.location.hash))return 'profile'
  if(value==='account?view=recognition')return 'account'
  if(isMessagesHash(window.location.hash))return 'home'
  if(value === 'reservations' || value.startsWith('reservations/'))return 'reservations'
  if(value.split('?')[0]==='community-search')return 'community-search'
  if(value==='my-content'||value.startsWith('my-content/'))return 'my-content'
  if(value.split('?')[0]==='opensource')return 'opensource'
  if(!value && window.location.pathname === '/device')return 'private-ai'
  if(value.startsWith('events/'))return 'events'
  if(value.startsWith('showcase/'))return 'showcase'
  if(value.startsWith('squad-outcomes/'))return 'squads'
  if(launchpadEnabled && value.startsWith('guilds/'))return 'guilds'
  if(value === 'stores' || value.startsWith('stores/'))return 'stores'
  if(value === 'highlights' || value.startsWith('highlights/'))return 'highlights'
  if(!value&&eventIdFromLocation())return 'events'
  return Object.hasOwn(TAB_TITLES, value) ? value as TabId : 'home'
}
