import {useCallback,useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {recommendedApplications} from '../../../../contracts/guild-launchpad/v1/config';
import {parseConfig, type Config} from '../../../../contracts/guild-launchpad/v2/config';
import {GuildBlock, type GuildBlockLoaders} from '../guild-blocks/runtime';
import type {LaunchpadApplication} from '../../../../contracts/guild-launchpad/v1/module-registry';
import type {PortalClient} from '../api';
import {MyWorkPanel, rememberActing} from './GuildLaunchpadMyWork';
import {GuildLaunchpadApplications, startable, type LaunchRequest} from './GuildLaunchpadApplications';
import {LegacyLaunchpadPrimary, legacyPrimaryVisible, legacyStorePath, legacyWorkNavigationGuard} from '../../../../modules/guild-workspace/LegacyLaunchpadPrimary';

export const BLOCK_LABEL: Record<Config['blocks'][number]['kind'], string> = {
  mission: '使命', announcements: '公告', skill_books: '技能書', applications: '應用',
  community_tasks: '公共任務', my_work: '我的工作', support: '協助', extension: '公會工具',
};
export const OPTIONAL = new Set<Config['blocks'][number]['kind']>(['announcements', 'community_tasks', 'applications', 'extension']);
const INTERN_HINT = '你是這個公會的實習成員：可以閱讀公會內容、在公會聊天室聊天。想發布或編輯，可以在聊天室跟會長打聲招呼，會長能把你設為正式成員。';

export type BookRef = {book_id: string; title: string; introduction_url: string | null; upstream_url: string};
export type AnnouncementRef = {announcement_id: string; title: string; body: string; published_at: string | null};
export type ConfigProblem = {code: 'config_schema_unsupported'; revision: string} | null;

export function asConfig(guildKey: string, body: {schema_version?: Config['schema_version']; mission_override?: string | null; blocks: Config['blocks']; application_refs: Config['application_refs']; starter?: Config['starter']; support?: Config['support']}): Config {
  return parseConfig({
    schema_version: body.schema_version ?? 'guild-launchpad.config/v1',
    guild_key: guildKey,
    mission_override: body.mission_override ?? null,
    blocks: [...body.blocks].sort((a, b) => a.order - b.order).map((block, order) => ({...block, order})),
    application_refs: [...body.application_refs].sort((a, b) => a.order - b.order).map((ref, order) => ({...ref, order})),
    starter: body.starter ?? {title_label: '', objective_hint: '', note_hint: ''},
    support: body.support ?? {kind: 'platform_help', public_url: null},
    extensions: {},
  }, guildKey);
}

export function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function MyWorkUnavailable({visitor, starter}: {visitor: boolean; starter?: Config['starter'] | null}) {
  if (visitor) return <p>登入並加入公會後，可以在這裡看到自己的工作。</p>;
  return <div className="stack">
    <p>業務空間尚未在此環境啟用</p>
    <p>尚無法建立或保存工作。</p>
    {starter && <dl className="detail-list">
      <div><dt>標題</dt><dd>{starter.title_label}</dd></div>
      <div><dt>目標</dt><dd>{starter.objective_hint}</dd></div>
      <div><dt>筆記</dt><dd>{starter.note_hint}</dd></div>
    </dl>}
  </div>;
}

export const INFO_KINDS = new Set<Config['blocks'][number]['kind']>(['mission', 'announcements', 'community_tasks', 'support']);
export function blockSection(block: Config['blocks'][number]): string {
  return INFO_KINDS.has(block.kind) ? 'information' : `block:${block.id}`;
}

export function GuildLaunchpadReading({guild, config, announcements, skillBooks, applications, visitor, memberTier, mode, client, guildKey, userId, registerLeave, registerPendingLeave, canLeave, canNavigate, onLogin, blockLoaders, supplierConsoleEnabled, activeSection, selectSection, skillBooksHeading, preview = false}: {
  activeSection: string;
  selectSection: (section: string) => void;
  skillBooksHeading?: RefObject<HTMLHeadingElement | null>;
  preview?: boolean;
  guild: {name: string; purpose: string};
  config: Config;
  announcements: AnnouncementRef[];
  skillBooks: BookRef[];
  applications: LaunchpadApplication[];
  visitor: boolean;
  onLogin?: () => void;
  blockLoaders: GuildBlockLoaders;
  memberTier?: string;
  supplierConsoleEnabled?: boolean;
  mode: 'public' | 'member';
  client: PortalClient;
  guildKey: string;
  userId?: string;
  registerLeave: (guard: (() => boolean) | null) => void;
  registerPendingLeave: (guard: (() => boolean) | null) => void;
  canLeave: () => boolean;
  canNavigate: () => boolean;
}) {
  const [workRefresh, setWorkRefresh] = useState(0);
  const workSection = useRef<HTMLElement | null>(null);
  const [launchRequest, setLaunchRequest] = useState<LaunchRequest | undefined>();
  const [launching, setLaunching] = useState(false);
  const focusWork = () => {
    const work = config.blocks.find(block => block.kind === 'my_work' && block.enabled);
    if (work) selectSection(blockSection(work));
    requestAnimationFrame(() => {workSection.current?.focus();});
  };
  const returnSection = useRef<string | null>(null);
  const applicationsSection = useRef<HTMLElement | null>(null);
  const focusAfterReveal = useRef(false);
  const focusAfterReturn = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (focusAfterReveal.current && applicationsSection.current && !applicationsSection.current.hidden) {
      focusAfterReveal.current = false;
      applicationsSection.current.querySelector<HTMLElement>('.application-flow h3')?.focus();
    }
    if (focusAfterReturn.current) {
      focusAfterReturn.current.focus();
      focusAfterReturn.current = null;
    }
  }, [activeSection]);
  const onLaunchStateChange = useCallback((active: boolean, returnFocus?: HTMLButtonElement | null) => {
    setLaunching(active);
    if (active) {
      const applications = config.blocks.find(block => block.kind === 'applications' && block.enabled);
      if (applications) {
        if (activeSection !== blockSection(applications)) {
          returnSection.current = activeSection;
          focusAfterReveal.current = true;
          selectSection(blockSection(applications));
        } else applicationsSection.current?.querySelector<HTMLElement>('.application-flow h3')?.focus();
      }
    } else if (returnSection.current) {
      focusAfterReturn.current = returnFocus ?? null;
      selectSection(returnSection.current); returnSection.current = null;
    } else returnFocus?.focus();
  }, [config.blocks, activeSection, selectSection]);
  const showWork = (tenantId: string, workspaceId: string) => {
    if (!canLeave() || !userId) return false;
    rememberActing(userId, tenantId, workspaceId); setWorkRefresh(value => value + 1);
    const work = config.blocks.find(block => block.kind === 'my_work' && block.enabled);
    if (work) {returnSection.current = blockSection(work); selectSection(blockSection(work));}
    return true;
  };
  const showStore = (tenantId: string, instanceId: string) => {
    if (!canNavigate()) return false;
    window.location.hash = legacyStorePath(guildKey, tenantId, instanceId); return true;
  };
  useEffect(() => { if (workRefresh) focusWork(); }, [workRefresh]);
  const blocks = [...config.blocks].sort((a, b) => a.order - b.order).filter(block => block.enabled || config.schema_version === 'guild-launchpad.config/v1' && !OPTIONAL.has(block.kind));
  const primary = recommendedApplications(config.application_refs, applications)[0];
  const showPrimary = !blocks.some(block => block.kind === 'extension') && !visitor && mode === 'member' && Boolean(userId) && primary
    && legacyPrimaryVisible(primary, blocks.some(block => block.kind === 'applications'));
  return <>
    {showPrimary && <div hidden={!preview && activeSection !== 'primary'}><LegacyLaunchpadPrimary primary={primary} config={config} guildKey={guildKey} memberTier={memberTier} internHint={INTERN_HINT} client={client}
      focusWork={focusWork} canLeave={canLeave} canNavigate={canNavigate} launchRequest={launchRequest} setLaunchRequest={setLaunchRequest}/></div>}
    {blocks.map(block => <section key={block.id} hidden={!preview && activeSection !== blockSection(block)} className="guild-launchpad-block" data-launchpad-kind={block.kind} ref={block.kind === 'my_work' ? workSection : block.kind === 'applications' ? applicationsSection : undefined} tabIndex={block.kind === 'my_work' ? -1 : undefined}>
      {block.kind !== 'extension' && !(block.kind === 'applications' && launching) && <><h2 ref={block.kind === 'skill_books' ? skillBooksHeading : undefined} tabIndex={-1}>{block.kind === 'applications' ? '工具目錄' : BLOCK_LABEL[block.kind]}</h2>{block.title && <p>{block.title}</p>}</>}
      {block.kind === 'extension' && <GuildBlock id={block.extension_id} heading={block.title} loaders={blockLoaders} client={client} guildKey={guildKey}
        viewer={visitor || mode === 'public' ? 'visitor' : memberTier === 'full' ? 'member' : 'read_only'}
        navigate={path => {if (canNavigate()) window.location.hash = path;}}
        startableApplications={applications.filter(startable).map(app => app.application_key)}
        supplierConsoleEnabled={supplierConsoleEnabled === true}
        startApplication={!visitor && mode !== 'public' && applications.some(startable) && blocks.some(item => item.kind === 'applications') ? key => {
          const app = applications.find(item => item.application_key === key);
          if (app && startable(app) && canLeave()) setLaunchRequest({application_key: app.application_key, release_ref: app.release_ref, nonce: (launchRequest?.nonce ?? 0) + 1});
        } : undefined}/>}
      {block.kind === 'mission' && <p>{config.mission_override ?? guild.purpose}</p>}
      {block.kind === 'announcements' && (announcements.length
        ? <ul>{announcements.map(item => <li key={item.announcement_id}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ul>
        : <p>目前沒有公告。</p>)}
      {block.kind === 'skill_books' && <div className="guild-launchpad-books">{skillBooks.length ? skillBooks.map(book => {
        const intro = httpsUrl(book.introduction_url);
        const upstream = httpsUrl(book.upstream_url);
        return <article className="guild-launchpad-book" key={book.book_id}>
          <h3>{book.title}</h3>
          <div className="guild-launchpad-actions">
            {intro && <a className="btn btn-ghost btn-small" href={intro} rel="noopener noreferrer" target="_blank" aria-label="閱讀介紹（另開分頁）">閱讀介紹 <span aria-hidden="true">↗</span></a>}
            {upstream && <a className="btn btn-ghost btn-small guild-launchpad-external" href={upstream} rel="noopener noreferrer" target="_blank"><span>查看原始專案</span><span className="guild-launchpad-destination">{new URL(upstream).hostname} · 另開分頁</span></a>}
          </div>
        </article>;
      }) : <p className="muted">目前沒有可顯示的技能書。</p>}</div>}
      {block.kind === 'applications' && <GuildLaunchpadApplications client={client} guildKey={guildKey} publicMode={mode === 'public' || !userId} userId={userId} onLogin={onLogin} onWork={showWork} onStore={showStore} canLeave={canLeave} registerPendingLeave={registerPendingLeave} visitor={visitor} recommendedRefs={config.application_refs} launchRequest={launchRequest} onLaunchStateChange={onLaunchStateChange}/>}
      {block.kind === 'community_tasks' && <p>目前沒有可顯示的公共任務。</p>}
      {block.kind === 'my_work' && (visitor || mode === 'public' || preview
        ? <MyWorkUnavailable visitor={visitor || mode === 'public'} starter={visitor || mode === 'public' ? null : config.starter}/>
        : memberTier === 'full'
          ? <MyWorkPanel key={workRefresh} client={client} guildKey={guildKey} userId={userId} starter={config.starter} registerLeave={registerLeave} canNavigate={legacyWorkNavigationGuard(guildKey) ? canNavigate : undefined}/>
          : <p className="field-hint" role="status">{INTERN_HINT}</p>)}
      {block.kind === 'support' && <SupportLine support={config.support}/>}
    </section>)}
  </>;
}

function SupportLine({support}: {support: Config['support']}) {
  const href = httpsUrl(support.public_url);
  if (href) return <p><a href={href} rel="noopener noreferrer" target="_blank">{support.kind === 'guild_public_contact' ? '公會公開聯絡' : '平台說明'}</a></p>;
  if (support.kind === 'guild_public_contact') return <p>這個公會尚未提供公開聯絡方式。</p>;
  return <p>需要協助時，可開啟頁面工具中的「頁面說明」。</p>;
}
