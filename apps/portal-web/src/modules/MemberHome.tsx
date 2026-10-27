import {useLanguage} from '../language';
import {FirstParticipation} from './FirstParticipation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ModulePanelProps } from './shared';
import type { TabId } from '../types';
import { WorkshopIcon } from '../WorkshopIcon';
import { loadLabels, type MemberCardData } from './Membership';
import { MemberAvatar } from './MemberAvatar';
import { PromotionShare } from './PromotionShare';
import { logConsoleEvent } from '../game-console-core';
import { consoleChannel } from '../game-console-routing';
import './HomeDesign.css';
import {MemberRecommendations} from './MemberRecommendations';
import {SkillBookIntro, type IntroBook} from './SkillBookIntro';
import {openMemberChat} from './chat-entry';
import {SocialZone} from './SocialZone';
import {HomeParticipation} from './HomeParticipation';
import {SECTION_LABELS} from '../../../../contracts/guild-launchpad/v1/guild-preferences';
import {consumeHomeJournalIntent, createHomeReadCycle, loadHomeNextSteps, observeHomeReturns, resolveHomeJournalUrl, type HomeRefreshReason} from './member-home-loading';

// Open the public aiSNS journal only when the member asks to read it.
const journalEnv = (import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env;
const journalUrl = resolveHomeJournalUrl(journalEnv?.VITE_COMMUNITY_JOURNAL_URL);

function HomeJournal({onOpen}: {onOpen: () => boolean}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), frame = useRef<HTMLIFrameElement>(null), titleId = useId();
  useEffect(() => {
    if (!consumeHomeJournalIntent()) return;
    // Restore the clicked entry's disclosure after the new mobile document.
    const disclosure = trigger.current?.closest('details');
    if (disclosure) disclosure.open = true;
    setOpen(true);
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus({preventScroll: true}); }
  useEffect(() => {
    if (!open || !journalUrl) return;
    const origin = new URL(journalUrl).origin;
    function onMessage(event: MessageEvent) {
      if (event.origin === origin && event.source === frame.current?.contentWindow && event.data === 'freedom-journal:close') close();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);
  return <section className="home-journal-entry" aria-label="共創日誌">
    <h2>共創日誌</h2>
    <p>閱讀工坊討論整理、開發進展與決策。</p>
    {journalUrl ? <>
      <button ref={trigger} type="button" className="btn btn-ghost" aria-haspopup="dialog" onClick={() => { if (onOpen()) setOpen(true); }}>閱讀共創誌</button>
      <dialog ref={dialog} className="home-journal-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}>
        <header><h2 id={titleId}>共創日誌</h2><a className="btn btn-ghost" href={journalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">另開共創誌</a><button type="button" className="btn btn-ghost" onClick={close} autoFocus aria-label="關閉共創日誌">關閉</button></header>
        {open && <iframe ref={frame} title="共創日誌內容" src={journalUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"/>}
      </dialog>
    </> : <p role="status">日誌尚未公開</p>}
  </section>;
}

const shortcuts: { id: TabId; title: string }[] = [
  { id: 'messages', title: '開始聊天' },
  { id: 'members', title: '找夥伴' },
];
// The third next-step button follows real work facts, in this order: a claim of mine that is not finished (/dashboard, work.ts),
// then the open task board, then work sharing. Titles stay on their own pages and no count is shown.
const taskActions = {
  resume: { tab: 'workbench', label: '回到任務協作', hint: '你有認領中的工作還沒結案，可以回到「任務協作」繼續。' },
  tasks: { tab: 'tasks', label: '查看社群任務', hint: '社群任務板有開放中的任務，可自行挑選一件參與。' },
  showcase: { tab: 'showcase', label: '分享作品與需求', hint: null },
} satisfies Record<string, { tab: TabId; label: string; hint: string | null }>;

type HomeOnboarding = { entry_mode?: string; assessment_completed?: boolean };
type HomeScope = ReturnType<typeof createHomeReadCycle>;
type HomeValue<T> = {scope: HomeScope; value: T};
type HomeMember = HomeValue<MemberCardData> & {reason: HomeRefreshReason};
type HomeGuildScope = {scope: HomeScope; guildKey: string | null};
type HomeGuildValue<T> = {guildScope: HomeGuildScope; value: T};

export function MemberHome({ client, session, onNavigate, openHomeJournal, firstParticipationEnabled=false, guildLaunchpadEnabled=false, personalContentEnabled=false, shortVideos=false, bookmarksEnabled=false, onOpenSupply }: ModulePanelProps&{openHomeJournal:()=>boolean; firstParticipationEnabled?:boolean; guildLaunchpadEnabled?:boolean; personalContentEnabled?:boolean; shortVideos?:boolean; bookmarksEnabled?:boolean; onOpenSupply?:()=>void}) {
  const {t} = useLanguage();
  const [wide,setWide]=useState(()=>window.matchMedia('(min-width:861px)').matches);
  useEffect(()=>{const media=window.matchMedia('(min-width:861px)'),update=()=>setWide(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const sessionGeneration = client.sessionGeneration;
  const scope = useMemo(() => createHomeReadCycle(() => client.sessionGeneration),
    [client, session.user.user_id, sessionGeneration]);
  const [memberValue, setMemberValue] = useState<HomeMember | null>(null);
  const [labelValue, setLabelValue] = useState<HomeValue<Record<string, string>> | null>(null);
  const [onboardingValue, setOnboardingValue] = useState<HomeValue<HomeOnboarding | null> | null>(null);
  const [loadState, setLoadState] = useState<{scope: HomeScope; loading: boolean; error: string | null} | null>(null);
  const [bookValue, setBookValue] = useState<HomeGuildValue<IntroBook | null> | null>(null);
  const [taskValue, setTaskValue] = useState<HomeGuildValue<keyof typeof taskActions | null> | null>(null);
  // Hide the old session's view synchronously, before effect cleanup can run.
  const currentMember = memberValue?.scope === scope ? memberValue : null;
  const member = currentMember?.value ?? null;
  const labels = labelValue?.scope === scope ? labelValue.value : null;
  const onboarding = onboardingValue?.scope === scope ? onboardingValue.value : null;
  const loading = loadState?.scope === scope ? loadState.loading : true;
  const loadError = loadState?.scope === scope ? loadState.error : null;
  const guildKey = member?.primary_guild?.guild_key ?? null;
  // Same-session, same-guild refreshes keep mounted dialogs and focused actions.
  // Returning to a previous guild creates a new lifetime, never a cached view.
  const guildScope = useMemo<HomeGuildScope>(() => ({scope, guildKey}), [scope, guildKey]);
  const guideBook = bookValue?.guildScope === guildScope ? bookValue.value : null;
  const taskAction = taskValue?.guildScope === guildScope ? taskValue.value : null;
  const summary = useRef<HTMLElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<number | null>(null);

  const load = useCallback((withLabels: boolean, reason: HomeRefreshReason = 'manual') => {
    const ticket = scope.begin(reason);
    if (!ticket) return;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
    setLoadState(previous => ({scope, loading: true, error: previous?.scope === scope ? previous.error : null}));
    // Automatic reads retain normal client diagnostics; only home UI errors are quiet.
    const options = {signal: ticket.signal};
    void client.get<MemberCardData>(`/members/${session.user.user_id}`, options).then(data => {
      if (!ticket.isCurrent()) return;
      const priorFocus = document.activeElement;
      const retrying = reason === 'manual' && alertRef.current?.contains(priorFocus);
      setMemberValue({scope, value: data, reason});
      setLoadState({scope, loading: false, error: null});
      ticket.complete(true);
      if (retrying) focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        if (!ticket.isCurrent() || (document.activeElement !== document.body && document.activeElement !== priorFocus)) return;
        // Retry recovery reveals the summary, but background refresh never moves focus.
        let disclosure = summary.current?.closest('details');
        while (disclosure) {
          disclosure.open = true;
          disclosure = disclosure.parentElement?.closest('details') ?? null;
        }
        summary.current?.focus();
      });
    }).catch((error: unknown) => {
      if (!ticket.isCurrent()) return;
      ticket.complete(false);
      setLoadState(previous => ({scope, loading: false,
        error: reason === 'automatic' ? (previous?.scope === scope ? previous.error : null)
          : `名片暫時無法載入。${error instanceof Error ? error.message : ''}`}));
    });
    // Shared label metadata has no cancellation API; fence its late replies instead.
    if (withLabels) void loadLabels(client).then(data => {
      if (ticket.isCurrent()) setLabelValue({scope, value: data});
    }).catch(() => {});
    void client.get<HomeOnboarding>('/me/onboarding', options).then(data => {
      if (ticket.isCurrent()) setOnboardingValue({scope, value: data});
    }).catch(() => {
      if (ticket.isCurrent() && reason !== 'automatic') setOnboardingValue({scope, value: null});
    });
  }, [client, session.user.user_id, scope]);

  useEffect(() => {
    setMemberValue(null); setLabelValue(null); setOnboardingValue(null);
    setBookValue(null); setTaskValue(null);
    load(true, 'initial');
    return () => {
      scope.cancel();
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    };
  }, [load, scope]);

  // No interval or hidden-tab polling; return events share the same freshness gate.
  useEffect(() => observeHomeReturns({page: document, window,
    visible: () => document.visibilityState === 'visible',
    online: () => navigator.onLine !== false,
  }, () => load(labels === null, 'automatic')), [load, labels]);

  const retry = () => { if (!loading) load(labels === null, 'manual'); };

  const showAssessment = onboarding?.entry_mode === 'quick' && onboarding.assessment_completed !== true;
  const nickname = member?.nickname ?? session.user.display_name;
  const featured = (member?.featured_capabilities ?? member?.capabilities.slice(0, 3) ?? []).slice(0, 3);
  const skillLabel = (id: string) => id.startsWith('custom:') ? id.slice(7) : labels?.[id] ?? id;
  const primaryGuild = member?.primary_guild ?? null;
  const internPrimary = Boolean(primaryGuild && member?.member_tiers?.some(tier => tier.guild_key === primaryGuild.guild_key && tier.member_tier === 'intern'));
  useEffect(() => {
    if (!currentMember || !guildScope.guildKey) return;
    const controller = new AbortController();
    void loadHomeNextSteps<IntroBook>({client, guildKey: guildScope.guildKey, signal: controller.signal,
      preserveOnFailure: currentMember.reason === 'automatic',
      onBook: value => setBookValue({guildScope, value}),
      onTask: value => setTaskValue({guildScope, value}),
    });
    return () => { controller.abort(); };
    // Each confirmed card refresh also refreshes work/grants, even in the same guild.
  }, [client, currentMember, guildScope]);

  const nextStep = useMemo<{ message: string; label: string; action: 'guilds' | 'skills' } | null>(() => {
    if (!member) return null;
    if (member.primary_guild) return { action: 'skills', label: '前往技能書架',
      message: '到技能書架選一本技能書閱讀，開始練習。' };
    // The member card separates secondary guilds from other joined guilds.
    if (member.secondary_guilds.length > 0 || (member.joined_guilds?.length ?? 0) > 0)
      return { action: 'guilds', label: '設定主要公會',
        message: '從已加入的公會選擇主要公會。' };
    return { action: 'guilds', label: '探索職業公會',
      message: '加入感興趣的公會，再選擇主要公會。' };
  }, [member]);

  useEffect(() => {
    if (!nextStep) return;
    // Each confirmed load gets a fresh event, including a return to an earlier guild state.
    logConsoleEvent({channel:consoleChannel('guide_next_step'), kind:'guide', source:'下一步',
      action: nextStep.action, message: nextStep.message});
  }, [nextStep]);

  return <div className="member-home freedom-home">
    {loadError && <div ref={alertRef} role="alert" className="banner banner-error home-load-error">
      <p>{loadError}下方常用入口仍可使用。</p>
      <button type="button" className="btn btn-ghost" aria-disabled={loading} onClick={retry}>{loading ? '正在重新載入名片…' : '重新載入名片'}</button>
    </div>}
    <div className="home-layout">
    <div className="home-main">
    <details className="home-participation-disclosure" key={`${session.user.user_id}:${client.sessionGeneration}`}>
    <summary><span>{t('home.explore')}</span><span className="home-explore-indicator" aria-hidden="true"><span className="home-explore-open">{t('home.expand')} ＋</span><span className="home-explore-close">{t('home.collapse')} −</span></span></summary>
    <div className="home-exploration-content">
    {nextStep && <section className="home-next-step" aria-label="公會與技能書建議">
      <div className="home-next-copy">
      <h2 className="home-next-eyebrow">公會與學習</h2>
      <p id="home-next-step-description">{nextStep.message}</p>
      {internPrimary && <p className="field-hint guild-intern-notice" role="status">你是這個公會的實習成員：可以閱讀公會內容、在公會聊天室聊天。想發布或編輯，可以在聊天室跟會長打聲招呼，會長能把你設為正式成員。</p>}
      {primaryGuild && taskAction && taskActions[taskAction].hint && <p id="home-next-task-hint">{taskActions[taskAction].hint}</p>}
      {primaryGuild ? <div className="home-next-actions">
        {guideBook
          ? <SkillBookIntro key={guideBook.id ?? guideBook.book_id} book={guideBook} label={t('home.readBook')} describedBy="home-next-step-description"/>
          : <button type="button" className="btn btn-ghost" aria-describedby="home-next-step-description" onClick={() => onNavigate?.('skills')}>前往技能書架</button>}
        <button type="button" className="btn btn-ghost" aria-describedby="home-next-step-description" onClick={() => openMemberChat('guild', primaryGuild.guild_key)}>進入{primaryGuild.name}聊天室</button>
        {taskAction && <button type="button" className="btn btn-ghost" aria-describedby={taskActions[taskAction].hint ? 'home-next-step-description home-next-task-hint' : 'home-next-step-description'} onClick={() => onNavigate?.(taskActions[taskAction].tab)}>{taskActions[taskAction].label}</button>}
      </div> : <div className="home-next-actions"><button type="button" className="btn btn-ghost" aria-describedby="home-next-step-description" onClick={() => onNavigate?.(nextStep.action)}>{nextStep.label}</button></div>}
      {primaryGuild && <FirstParticipation client={client} session={session} onNavigate={onNavigate} primaryGuild={primaryGuild} firstParticipationEnabled={firstParticipationEnabled}/>}
      </div>
      <img className="home-next-art" src="/art/rpg/skill-codex.webp" alt="" width="124" height="108"/>
    </section>}

    <HomeParticipation client={client} session={session} onNavigate={onNavigate} personalContentEnabled={personalContentEnabled}/>
    </div>
    </details>
    <section className="home-timeline" aria-label="首頁社群動態"><SocialZone client={client} bookmarksEnabled={bookmarksEnabled} shortVideos={shortVideos} viewer={{name: nickname, avatarUrl: member?.avatar_url}}/></section>
    </div>
    <details className="home-context home-guide-disclosure" aria-label="我的工坊" open={wide}><summary>我的工坊</summary>
    <div className="home-support">
    <nav className="home-destinations" aria-label="商品、作品與活動">
      <section>
        <h2>商品與供貨</h2>
        {guildLaunchpadEnabled ? <>
          <button type="button" onClick={onOpenSupply}><strong>我的供貨商品庫</strong><span>管理商品與合作條件</span><span className="home-destination-arrow" aria-hidden="true">›</span></button>
          <button type="button" onClick={() => onNavigate?.('stores')}><strong>我的商店</strong><span>編輯店面與公開商品</span><span className="home-destination-arrow" aria-hidden="true">›</span></button>
        </> : <>
          <button type="button" onClick={() => onNavigate?.('supplier')}><strong>我有東西要賣</strong><span>整理商品提案</span><span className="home-destination-arrow" aria-hidden="true">›</span></button>
          <button type="button" onClick={() => onNavigate?.('retail')}><strong>我可以賣東西</strong><span>挑選商品與規劃展示</span><span className="home-destination-arrow" aria-hidden="true">›</span></button>
        </>}
      </section>
      <section>
        <h2>作品與活動</h2>
        <button type="button" onClick={() => onNavigate?.('opensource')}><strong>開源投稿</strong><span>介紹工具與預覽分享內容</span><span className="home-destination-arrow" aria-hidden="true">›</span></button>
        <button type="button" onClick={() => onNavigate?.('events')}><strong>社群活動</strong><span>查看、提交與管理活動</span><span className="home-destination-arrow" aria-hidden="true">›</span></button>
      </section>
    </nav>

    <HomeJournal onOpen={openHomeJournal}/>

    <section className="card stack" aria-label="離譜日常遊樂場">
      <h2>休息一下，做點離譜的事。</h2>
      <p>三款短局遊戲，拍下怪事、蓋完下班，也能把成果分享給工坊夥伴。</p>
      <a className="btn btn-ghost" href="/play" target="_blank" rel="noopener noreferrer">玩離譜日常<span className="sr-only">（另開分頁）</span></a>
    </section>

    <nav className="home-shortcuts" data-guide-anchor="home:shortcuts" aria-label="常用入口">
      {shortcuts.map(entry => <button key={entry.id} type="button" className="home-shortcut" onClick={() => onNavigate?.(entry.id)}>
        <span className="home-shortcut-icon" aria-hidden="true"><WorkshopIcon name={entry.id}/></span><span>{entry.title}</span>
      </button>)}
    </nav>

    </div>
    <details className="home-personal home-disclosure">
    <summary>我的名片與推薦夥伴</summary>
    <aside className="home-rail">
    <section ref={summary} tabIndex={-1} className="member-card home-member-summary guild-base-hero" data-guide-anchor="home:member-summary" aria-label="我的會員摘要" aria-busy={loading}>
      <div className="home-member-identity">
        <MemberAvatar nickname={nickname} avatarUrl={member?.avatar_url} className="home-member-initial"/>
        <div>
          <p className="home-member-name">{nickname}{member?.positioning_title && <span className="positioning-title">{member.positioning_title}</span>}</p>
          {member ? <p className="home-member-guild">{member.category_primaries ? member.category_primaries.map(item => `${SECTION_LABELS[item.category]} · ${item.guild?.name??'尚未選擇'}`).join('　') : member.primary_guild ? `主要公會 · ${member.primary_guild.name}` : '尚未設定主要公會'}</p>
            : loading && <p className="home-member-guild" role="status">正在載入名片…</p>}
          {showAssessment && <p className="home-assessment-hint">完成定位後，名片會顯示擅長能力，也更容易遇到合適的夥伴。</p>}
        </div>
      </div>
      {featured.length > 0 && <div className="member-featured home-member-skills" aria-label="擅長的能力">
        {featured.map(id => <span className="pill" key={id}>{skillLabel(id)}</span>)}
      </div>}
      <div className="home-member-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onNavigate?.('account')}>編輯我的名片</button>
        {showAssessment && <button type="button" className="btn btn-ghost" onClick={() => onNavigate?.('positioning')}>補做定位測驗</button>}
        <PromotionShare client={client} kind="platform" target="workshop" title="自由工坊" text="自由工坊：加入公會、領取 Repo 技能書，和夥伴一起供貨、開店與做開源作品。" label="分享自由工坊"/>
      </div>
    </section>
    <MemberRecommendations client={client}/>
    </aside>
    </details>
    </details>
    </div>
  </div>;
}
