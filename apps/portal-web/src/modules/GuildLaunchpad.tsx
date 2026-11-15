import {GUILD_TOOLS} from '../guild-tools/catalog';
import {guildRoute} from './guild-launchpad-route';
import {Suspense,lazy,useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {recommendedApplications} from '../../../../contracts/guild-launchpad/v1/config';
import type {Config, ConfigView} from '../../../../contracts/guild-launchpad/v2/config';
import {canReplaceLaunchpadLayout} from '../../../../modules/guild-workspace/launchpad-layout-guards';
import type {GuildBlockLoaders} from '../guild-blocks/runtime';
import {LaunchpadApplicationSchema, type LaunchpadApplication} from '../../../../contracts/guild-launchpad/v1/module-registry';
import {ApiError, type PortalClient} from '../api';
import {useLocalAction} from '../useLocalAction';
import type {GuildSummary} from './Onboarding';
import {useModuleMutation} from './shared';
import {legacyPrimaryLabel, legacyPrimaryVisible, legacyWorkNavigationGuard} from '../../../../modules/guild-workspace/LegacyLaunchpadPrimary';
import './GuildLaunchpad.css';
import {GuildRepositoryFrame} from '../guild-repositories/GuildRepositoryFrame';
import {guildRepository} from '../../../../modules/guild-workspace/repositories/registry';
import type {GuildAction} from '../../../../modules/guild-workspace/repositories/bridge';
import type {GuildEntryAction} from './guild-launchpad-route';
import {BLOCK_LABEL, GuildLaunchpadReading, INFO_KINDS, MyWorkUnavailable, asConfig, blockSection, httpsUrl, type AnnouncementRef, type BookRef, type ConfigProblem} from './GuildLaunchpadReading';
export {MyWorkUnavailable};

const GuildLaunchpadEditor = lazy(() => import('./GuildLaunchpadEditor').then(m => ({default: m.GuildLaunchpadEditor})));
const EMPTY_BLOCK_LOADERS: GuildBlockLoaders = Object.freeze({});

type MemberView = {
  guild: {guild_key: string; name: string; purpose: string};
  config: ConfigView;
  config_problem: ConfigProblem;
  membership: {state: string; member_tier: string};
  announcements: AnnouncementRef[];
  skill_books: BookRef[];
  applications: LaunchpadApplication[];
  viewer_can_edit_config: boolean;
  viewer_can_preview_config: boolean;
  viewer_can_publish_config: boolean;
  viewer_can_manage_delegations: boolean;
};
type PublicView = {
  guild: {guild_key: string; name: string; purpose: string; category: null};
  config: {revision: string; body: Omit<Config, 'extensions'>};
  config_problem: ConfigProblem;
  announcements: AnnouncementRef[];
  skill_books: BookRef[];
};

type LaunchpadSection = {id: string; label: string; group: '工作' | '公會資源' | '管理'};
function launchpadSections(guildKey: string, config: Config, applications: LaunchpadApplication[], member: boolean, editor: boolean): LaunchpadSection[] {
  const blocks = [...config.blocks].filter(block => block.enabled).sort((a, b) => a.order - b.order);
  const primary = recommendedApplications(config.application_refs, applications)[0];
  const dedicated = member && !blocks.some(block => block.kind === 'extension') && primary
    && legacyPrimaryVisible(primary, blocks.some(block => block.kind === 'applications'));
  const sections: LaunchpadSection[] = dedicated ? [{id: 'primary', label: legacyPrimaryLabel(guildKey, primary), group: '工作'}] : [];
  for (const block of blocks) {
    const id = blockSection(block);
    if (sections.some(section => section.id === id)) continue;
    sections.push({id, label: id === 'information' ? '公會資訊' : block.kind === 'extension' ? block.title || '公會工具'
      : block.kind === 'applications' ? '工具目錄' : BLOCK_LABEL[block.kind],
      group: block.kind === 'my_work' || block.kind === 'extension' ? '工作' : '公會資源'});
  }
  if (editor) sections.push({id: 'management', label: '管理啟動台', group: '管理'});
  return sections;
}

/** Share the published public destination, never the current query or a member draft. */
function GuildPublicEntry({guildKey, publicMode, onReadBooks, contactUrl}: {
  guildKey: string; publicMode: boolean; onReadBooks?: () => void; contactUrl: string | null;
}) {
  const destination = new URL('/', window.location.origin);
  destination.hash = `guilds/${guildKey}`;
  const url = destination.href;
  const [status, setStatus] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const action = useLocalAction([guildKey, publicMode, url]);
  useLayoutEffect(() => {
    if (manualCopy) {field.current?.focus(); field.current?.select();}
  }, [manualCopy]);
  async function copy() {
    setStatus('');
    const result = await action.run('copy', () => navigator.clipboard.writeText(url));
    if (result.status === 'done') {
      setManualCopy(false); setStatus('已複製公會連結');
    } else if (result.status === 'failed') {
      setStatus('無法自動複製，請選取下方公會連結。'); setManualCopy(true);
      field.current?.focus(); field.current?.select();
    }
  }
  return <section className={publicMode ? 'guild-launchpad-entry' : 'guild-launchpad-share'} aria-label="公會公開入口">
    <div className="guild-launchpad-actions">
      {onReadBooks && <button type="button" className="btn btn-primary btn-small" onClick={onReadBooks}>查看公會技能書</button>}
      {contactUrl && <a className="btn btn-ghost btn-small guild-launchpad-external" href={contactUrl} rel="noopener noreferrer" target="_blank"><span>聯絡這個公會</span><span className="guild-launchpad-destination">{new URL(contactUrl).hostname} · 另開分頁</span></a>}
      <button type="button" className="btn btn-ghost btn-small" disabled={action.pending !== null} aria-busy={action.pending === 'copy'} onClick={() => void copy()}>{action.pending === 'copy' ? '複製中…' : '複製公會連結'}</button>
    </div>
    {publicMode && <p className="muted">公開免登入；交流請先登入。</p>}
    <p className="guild-launchpad-share-status" role="status">{status}</p>
    {manualCopy && <label className="field">公會公開連結<input ref={field} readOnly value={url} onFocus={event => event.currentTarget.select()}/></label>}
  </section>;
}

export function PublicGuildLaunchpad({client, guildKey, onLogin, pageTools, entryAction, blockLoaders = EMPTY_BLOCK_LOADERS}: {client: PortalClient; guildKey: string; onLogin: () => void; pageTools?: ReactNode; entryAction?: GuildEntryAction; blockLoaders?: GuildBlockLoaders}) {
  return <div className="guild-launchpad-public">
    <header><img src="/brand/freedom-workshop.webp" alt="自由工坊" width={1280} height={720}/><div className="guild-launchpad-public-tools">{pageTools}<button type="button" className="btn btn-ghost" onClick={onLogin}>會員登入</button></div></header>
    <main><GuildLaunchpad key={guildKey} client={client} guildKey={guildKey} mode="public" onLogin={onLogin} entryAction={entryAction} blockLoaders={blockLoaders}/></main>
  </div>;
}

export function GuildLaunchpad({client, guildKey, mode, onBack, onLogin, userId, registerPendingLeave, supplierConsoleEnabled, entryAction, blockLoaders = EMPTY_BLOCK_LOADERS}: {
  client: PortalClient; guildKey: string; mode: 'public' | 'member'; onBack?: () => void; onLogin?: () => void; userId?: string;
  registerPendingLeave?: (guard: (() => boolean) | null) => void;
  blockLoaders?: GuildBlockLoaders;
  supplierConsoleEnabled?: boolean;
  entryAction?: GuildEntryAction;
}) {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [editorOpened, setEditorOpened] = useState(false);
  const skillBooksHeading = useRef<HTMLHeadingElement>(null);
  const focusSkillBooks = useRef(false);
  const readingRoot = useRef<HTMLDivElement>(null);
  const pendingResourceFocus = useRef<string | null>(null);
  const editorDirty = useRef(false);
  const activeSectionRef = useRef('');
  const confirmEditorLeave = useCallback(() => !editorDirty.current || window.confirm('有尚未儲存的修改，確定要離開嗎？'), []);
  const onEditorDirtyChange = useCallback((dirty: boolean) => { editorDirty.current = dirty; }, []);
  const selectSection = useCallback((id: string) => {
    if (activeSectionRef.current === 'management' && id !== 'management' && !confirmEditorLeave()) return false;
    setSelectedSection(id);
    return true;
  }, [confirmEditorLeave]);
  useEffect(() => {setSelectedSection(null); setEditorOpened(false); editorDirty.current = false;}, [client, guildKey, mode]);
  const [guild, setGuild] = useState<{name: string; purpose: string} | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementRef[]>([]);
  const [skillBooks, setSkillBooks] = useState<BookRef[]>([]);
  const [applications, setApplications] = useState<LaunchpadApplication[]>([]);
  const [visitor, setVisitor] = useState(mode === 'public');
  const [memberTier, setMemberTier] = useState<string | undefined>();
  const [configProblem, setConfigProblem] = useState<ConfigProblem>(null);
  const [readingConfig, setReadingConfig] = useState<Config | null>(null);
  const [access, setAccess] = useState({edit: false, preview: false, publish: false, delegate: false});
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState('');
  const generation = useRef(0);
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const registerLeave = useCallback((guard: (() => boolean) | null) => { leaveGuard.current = guard; }, []);
  const launchLeaveGuard = useRef<(() => boolean) | null>(null);
  const registerLaunchLeave = useCallback((guard: (() => boolean) | null) => {
    launchLeaveGuard.current = guard;
  }, []);
  useEffect(() => {
    // Keep tenant creation and production / direction-card Result checkpoints in the existing
    // App guard; either child clearing its guard must not erase the other.
    registerPendingLeave?.(() => (!launchLeaveGuard.current || launchLeaveGuard.current())
      && (!legacyWorkNavigationGuard(guildKey) || !leaveGuard.current || leaveGuard.current())
      && confirmEditorLeave());
    return () => registerPendingLeave?.(null);
  }, [guildKey, registerPendingLeave, confirmEditorLeave]);
  const canLeave = useCallback(() => (!launchLeaveGuard.current || launchLeaveGuard.current()) && (!leaveGuard.current || leaveGuard.current()), []);
  // Route changes are checked once by App; local context switches still check here.
  const canNavigate = () => (registerPendingLeave ? true : confirmEditorLeave()) && (legacyWorkNavigationGuard(guildKey) && registerPendingLeave ? true : canLeave());
  const canAdoptLayout = useCallback((current: Config | null, next: Config) => canReplaceLaunchpadLayout(current, next, {
    applications: launchLeaveGuard.current,
    my_work: leaveGuard.current,
  }), []);
  const headingId = useId();
  const {mutate, busy: joining, error: joinError} = useModuleMutation(client);
  const showEditor = mode === 'member' && !visitor && (access.edit || access.preview || access.publish);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true); setBanner(''); setGuild(null); setApplications([]);
    const signal = controller.signal;
    const applyPublic = (value: PublicView) => {
      setGuild(value.guild); setAnnouncements(value.announcements); setSkillBooks(value.skill_books); setConfigProblem(value.config_problem);
      setVisitor(true); setMemberTier(undefined); setAccess({edit: false, preview: false, publish: false, delegate: false});
      setApplications([]);
      setReadingConfig(asConfig(guildKey, value.config.body));
    };
    const load = async () => {
      if (mode === 'public') {
        const value = await client.get<PublicView>(`/public/guilds/${guildKey}/launchpad`, {skipAuthHandler: true, signal});
        if (current !== generation.current) return;
        applyPublic(value);
        return;
      }
      try {
        const member = await client.get<MemberView>(`/guilds/${guildKey}/launchpad`, {signal});
        if (current !== generation.current) return;
        setGuild(member.guild); setAnnouncements(member.announcements); setSkillBooks(member.skill_books); setConfigProblem(member.config_problem);
        setVisitor(false); setMemberTier(member.membership.member_tier);
        setApplications(LaunchpadApplicationSchema.array().parse(member.applications));
        setAccess({edit: member.viewer_can_edit_config, preview: member.viewer_can_preview_config, publish: member.viewer_can_publish_config, delegate: member.viewer_can_manage_delegations});
        setReadingConfig(asConfig(guildKey, member.config.body));
      } catch (error) {
        if (current !== generation.current) return;
        if (error instanceof ApiError && error.code === 'guild_member_required') {
          applyPublic(await client.get<PublicView>(`/public/guilds/${guildKey}/launchpad`, {skipAuthHandler: true, signal}));
          return;
        }
        throw error;
      }
    };
    void load().catch(error => {
      if (current !== generation.current || (error instanceof ApiError && error.code === 'aborted')) return;
      setBanner(error instanceof Error ? error.message : '啟動台暫時無法載入。');
    }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [client, guildKey, mode]);

  const reloadReading = useCallback(async () => {
    if (mode === 'public' || visitor) return;
    const current = generation.current;
    const member = await client.get<MemberView>(`/guilds/${guildKey}/launchpad`);
    if (current !== generation.current) return;
    setGuild(member.guild); setAnnouncements(member.announcements); setSkillBooks(member.skill_books); setMemberTier(member.membership.member_tier); setConfigProblem(member.config_problem);
    setApplications(LaunchpadApplicationSchema.array().parse(member.applications));
    setAccess({edit: member.viewer_can_edit_config, preview: member.viewer_can_preview_config, publish: member.viewer_can_publish_config, delegate: member.viewer_can_manage_delegations});
    setReadingConfig(asConfig(guildKey, member.config.body));
  }, [client, guildKey, mode, visitor]);

  async function join() {
    setBanner('');
    try {
      const directory = await client.get<{items: GuildSummary[]}>('/guilds/directory');
      const membership = directory.items.find(item => item.guild_key === guildKey)?.membership;
      const result = await mutate(`/guilds/${guildKey}/join`, {}, membership?.aggregate_version);
      if (result) {
        window.dispatchEvent(new Event('freedom-profile-updated'));
        window.location.reload();
      }
    } catch (error) { setBanner(error instanceof Error ? error.message : '操作未完成。'); }
  }

  const title = guild?.name ?? (loading ? '公會啟動台' : '找不到這個公會');
  const titleId = mode === 'member' ? 'workspace-page-title' : headingId;
  const sections = readingConfig ? launchpadSections(guildKey, readingConfig, applications, !visitor && mode === 'member' && Boolean(userId), showEditor) : [];
  const repository = guildRepository(guildKey);
  if (repository && readingConfig) sections.unshift({id: 'start', label: '啟動台', group: '工作'});
  const groups = (['工作', '公會資源', '管理'] as const).map(group => ({label: group, items: sections.filter(section => section.group === group)})).filter(group => group.items.length);
  const defaultSection = visitor ? sections.find(section => section.id === 'information') : sections.find(section => section.group === '工作' && section.id !== 'start') ?? sections.find(section => section.id === 'information') ?? sections.find(section => section.id !== 'start');
  const activeSection = sections.find(section => section.id === selectedSection)?.id ?? defaultSection?.id ?? sections[0]?.id ?? '';
  activeSectionRef.current = activeSection;
  const managementActive = showEditor && activeSection === 'management';
  useEffect(() => {
    if (managementActive) setEditorOpened(true);
  }, [managementActive]);

  const destinations: Partial<Record<GuildEntryAction, string>> = {start: repository ? 'start' : undefined};
  for (const [action, kind] of [['work', 'my_work'], ['skills', 'skill_books'], ['tools', 'applications'], ['information', 'mission']] as const) {
    const block = readingConfig?.blocks.find(item => item.kind === kind && item.enabled);
    if (block) destinations[action] = blockSection(block);
  }
  if (sections.some(section => section.id === 'primary')) destinations.work = 'primary';
  const entryDestination = entryAction ? destinations[entryAction] : undefined;
  useEffect(() => {if (!loading && entryDestination) selectSection(entryDestination);}, [loading, entryDestination, selectSection]);
  const repositoryActions = (['work', 'skills', 'tools', 'information'] as const).filter(action => destinations[action]);
  function navigateRepository(action: GuildAction) {
    if (action === 'work' && mode === 'public') {onLogin?.(); return;}
    const destination = destinations[action];
    if (!destination || !selectSection(destination)) return;
    requestAnimationFrame(() => {
      const heading = readingRoot.current?.querySelector<HTMLElement>('[data-launchpad-kind]:not([hidden]) h2, section:not([hidden]) > h2');
      heading?.focus();
    });
  }
  const entryBookBlock = readingConfig?.blocks.find(block => block.kind === 'skill_books' && block.enabled);
  const entryAnnouncementBlock = readingConfig?.blocks.find(block => block.kind === 'announcements' && block.enabled);
  const entryInformationBlock = readingConfig?.blocks.filter(block => INFO_KINDS.has(block.kind) && block.enabled).sort((a,b)=>a.order-b.order)[0];
  const publicBookBlock = mode === 'public' && skillBooks.length > 0 ? readingConfig?.blocks.find(block => block.kind === 'skill_books' && block.enabled) : undefined;
  const publicContact = mode === 'public' && readingConfig?.support.kind === 'guild_public_contact' && readingConfig.blocks.some(block => block.kind === 'support' && block.enabled)
    ? httpsUrl(readingConfig.support.public_url) : null;
  function focusResourceHeading(kind: string) {
    const heading = readingRoot.current?.querySelector<HTMLHeadingElement>(`[data-launchpad-kind="${kind}"] > h2`);
    heading?.focus();
    heading?.scrollIntoView({block: 'start'});
  }
  function openResource(section: string, kind: string) {
    if (!sections.some(item => item.id === section)) return;
    if (activeSection === section) focusResourceHeading(kind);
    else if (selectSection(section)) pendingResourceFocus.current = kind;
  }
  useLayoutEffect(() => {
    if (focusSkillBooks.current) {focusSkillBooks.current = false; skillBooksHeading.current?.focus();}
    if (pendingResourceFocus.current) {
      const kind = pendingResourceFocus.current; pendingResourceFocus.current = null;
      focusResourceHeading(kind);
    }
  }, [activeSection]);

  return <section className="guild-launchpad" aria-labelledby={titleId}>
    <header className="guild-launchpad-heading">
      <div><h1 id={titleId}>{title}</h1>
        {memberTier && !visitor && <p className="field-hint guild-launchpad-membership">成員身分：{memberTier === 'intern' ? '實習成員' : memberTier === 'full' ? '正式成員' : memberTier}</p>}
      </div>
      {mode === 'member' && <button type="button" className="btn btn-ghost btn-small" onClick={() => { if (!canNavigate()) return; onBack?.(); }}>返回公會列表</button>}
    </header>
    <p className="guild-launchpad-status" role="status" aria-live="polite">{loading ? '正在載入啟動台…' : ''}</p>
    {configProblem && <p className="banner" role="status">這個公會的啟動台設定版本目前無法顯示，先顯示上一個可用版本。</p>}
    {banner && <p className="banner banner-error" role="alert">{banner}</p>}
    {visitor && mode === 'member' && guild && <div className="actions"><button type="button" className="btn btn-primary" disabled={joining} onClick={() => void join()}>加入{guild.name}</button></div>}
    {visitor && joinError && <p className="banner banner-error" role="alert">{joinError}</p>}
    {!loading && guild && readingConfig && <GuildPublicEntry key={`${mode}:${guildKey}`} guildKey={guildKey} publicMode={mode === 'public'} contactUrl={publicContact}
      onReadBooks={publicBookBlock ? () => {
        const section = blockSection(publicBookBlock);
        if (activeSection === section) skillBooksHeading.current?.focus();
        else {focusSkillBooks.current = true; selectSection(section);}
      } : undefined}/>}
    {!loading && guild && readingConfig && mode === 'member' && activeSection !== 'start' && <section className="guild-launchpad-welcome" aria-label="公會工作區導覽">
      <div className="guild-launchpad-purpose"><p className="guild-launchpad-kicker">公會工作區</p><p>{readingConfig.mission_override ?? guild.purpose}</p></div>
      <div className="guild-launchpad-resource-preview">
        {entryBookBlock && <button type="button" disabled={!skillBooks.length&&!entryInformationBlock} onClick={() => {const destination=skillBooks.length?entryBookBlock:entryInformationBlock;if(destination)openResource(blockSection(destination),destination.kind);}}><span>入門技能書 <span aria-hidden="true">→</span></span><strong>{skillBooks[0]?.title ?? '尚無可顯示的技能書'}</strong><small>{skillBooks.length?'閱讀介紹與原始專案':entryInformationBlock?'先閱讀公會資訊，了解這個公會。':'這個工作區目前沒有可顯示的入門資源。'}</small></button>}
        {!visitor && entryAnnouncementBlock && <button type="button" onClick={() => openResource(blockSection(entryAnnouncementBlock), 'announcements')}><span>公會公告 <span aria-hidden="true">→</span></span><strong>{announcements[0]?.title ?? '目前沒有公告'}</strong><small>{announcements.length?'查看已發布的公會消息':'查看公告區；目前尚未發布公告。'}</small></button>}
      </div>
      <details className="guild-launchpad-help"><summary>說明</summary><p className="muted">{visitor?'先閱讀公會資源；加入後可到公會聊天室交流。':memberTier==='intern'?'先閱讀技能書、到聊天室交流。發布或編輯需由會長調整為正式成員。':'閱讀資源，或從下方工作區接續你的工作。私人工作仍依原業務空間權限存取。'}</p></details>
    </section>}
    {GUILD_TOOLS.some(tool=>tool.guild_key===guildKey)&&<div className="actions"><button type="button" className="btn btn-secondary btn-small" onClick={()=>{if(canNavigate())window.location.hash=guildRoute(guildKey,'tools');}}>工具</button></div>}
    <div className="guild-launchpad-layout">
    {sections.length > 0 && <>
      <nav className="guild-launchpad-nav" aria-label="公會功能">
        {groups.map(group => <div key={group.label} className="guild-launchpad-nav-group">
          <p>{group.label}</p>{group.items.map(item => <button type="button" key={item.id} aria-current={activeSection === item.id ? 'page' : undefined} onClick={() => selectSection(item.id)}>{item.label}</button>)}
        </div>)}
      </nav>
      <label className="guild-launchpad-mobile-nav">公會功能<select value={activeSection} onChange={event => selectSection(event.target.value)}>
        {groups.map(group => <optgroup key={group.label} label={group.label}>{group.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
      </select></label>
    </>}
    <div className="guild-launchpad-content" ref={readingRoot}>
    {!loading && guild && repository && activeSection === 'start' && <GuildRepositoryFrame key={`${guildKey}:${client.sessionGeneration}:${mode}`} repository={repository} actions={repositoryActions} onNavigate={navigateRepository}/>}
    {readingConfig && guild && <GuildLaunchpadReading guild={guild} config={readingConfig} announcements={visitor ? [] : announcements} skillBooks={skillBooks} applications={applications} visitor={visitor} memberTier={visitor ? undefined : memberTier} mode={mode} client={client} guildKey={guildKey} userId={userId} registerLeave={registerLeave} registerPendingLeave={registerLaunchLeave} canLeave={canLeave} canNavigate={canNavigate} onLogin={onLogin} blockLoaders={blockLoaders} supplierConsoleEnabled={supplierConsoleEnabled} activeSection={activeSection} selectSection={selectSection} skillBooksHeading={skillBooksHeading}/>}
    {showEditor && (managementActive || editorOpened) && <Suspense fallback={<p role="status">載入中…</p>}>
      <GuildLaunchpadEditor client={client} guildKey={guildKey} guild={guild ?? {name: guildKey, purpose: ''}} announcements={announcements} skillBooks={skillBooks} applications={applications} blockLoaders={blockLoaders} supplierConsoleEnabled={supplierConsoleEnabled} hidden={!managementActive} access={access} shellConfigProblem={configProblem} canAdoptLayout={canAdoptLayout} canLeave={canLeave} onDraftChange={setReadingConfig} onDirtyChange={onEditorDirtyChange} onPublished={reloadReading}/>
    </Suspense>}
    </div>
    </div>
  </section>;
}
