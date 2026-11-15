import React, { lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { PortalClient } from '../api';
import type { Outcome } from '../modules/SquadOutcomes';
import type { PortalFeatureEntries } from './types';

const OUTCOME_AUDIENCE_LABEL: Record<Outcome['audience'], string> = {
  squad: '目前小隊成員',
  community: '社群會員',
  public: '任何人（公開）',
};
const OUTCOME_STATE_LABEL: Record<Outcome['state'], string> = {
  draft: '草稿',
  published: '已發布',
  withdrawn: '已撤下',
};

function SquadOutcomesList({client, enabled, onOpenSquads}:{client:PortalClient; enabled:boolean; onOpenSquads:()=>void}) {
  const [items, setItems] = useState<Outcome[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (offset = 0) => {
    if (!enabled) return;
    const token = ++request.current;
    const generation = client.sessionGeneration;
    setLoading(true);
    setError('');
    try {
      const value = await client.get<{items: Outcome[]; next_offset: number | null}>(`/me/squad-outcomes?limit=20&offset=${offset}`);
      if (!mounted.current || token !== request.current || generation !== client.sessionGeneration) return;
      setItems(prev => offset > 0
        ? [...prev.filter(item => !value.items.some(next => next.outcome_id === item.outcome_id)), ...value.items]
        : value.items);
      setNextOffset(value.next_offset);
      setLoaded(true);
    } catch (reason) {
      if (!mounted.current || token !== request.current || generation !== client.sessionGeneration) return;
      setError(reason instanceof Error ? reason.message : '這次未能完成，請重新載入後再試。');
    } finally {
      if (mounted.current && token === request.current && generation === client.sessionGeneration) setLoading(false);
    }
  }, [client, enabled]);

  useEffect(() => {
    mounted.current = true;
    setItems([]);
    setNextOffset(null);
    setLoaded(false);
    setError('');
    if (enabled) void load(0);
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [enabled, load]);

  const openSquads = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onOpenSquads();
    }
  };

  if (!enabled) {
    return (
      <section className="card stack outcome-section" aria-label="小隊成果">
        <h2>小隊成果</h2>
        <p className="empty">目前沒有小隊成果</p>
        <a className="btn btn-primary" href="#me/teams" onClick={openSquads}>前往小隊</a>
      </section>
    );
  }

  return (
    <section className="card stack outcome-section" aria-label="小隊成果">
      <div className="card-head">
        <h2>小隊成果</h2>
        {items.length > 0 && <a className="btn btn-secondary btn-small" href="#me/teams" onClick={openSquads}>返回小隊</a>}
      </div>
      {items.length > 0 ? (
        <>
          {items.map(item => (
            <article className="card stack" key={item.outcome_id}>
              <h3><a href={`#me/teams/outcomes/${item.outcome_id}`}>{item.title}</a></h3>
              <p>{item.squad_name} · {OUTCOME_AUDIENCE_LABEL[item.audience]} · {OUTCOME_STATE_LABEL[item.state]}</p>
              <p className="multiline-text">{item.summary}</p>
            </article>
          ))}
          {error && <p role="alert">{error}</p>}
          {error && <button type="button" className="btn btn-secondary btn-small" disabled={loading} onClick={() => void load(0)}>重新載入</button>}
          {nextOffset !== null && <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load(nextOffset)}>更多</button>}
          {loading && <p role="status">正在載入更多成果…</p>}
        </>
      ) : loading && !loaded ? (
        <p role="status">正在載入小隊成果…</p>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load(0)}>重新載入</button>
            <a className="btn btn-secondary" href="#me/teams" onClick={openSquads}>返回小隊</a>
          </div>
        </>
      ) : (
        <>
          <p className="empty">目前沒有小隊成果</p>
          <a className="btn btn-primary" href="#me/teams" onClick={openSquads}>前往小隊</a>
        </>
      )}
    </section>
  );
}

const SkillsPanel = lazy(() => import('../modules/SkillsPanel').then(m => ({default: m.SkillsPanel})))
const MemberHome = lazy(() => import('../modules/MemberHome').then(m => ({default: m.MemberHome})))
const SquadsPanel = lazy(() => import('../modules/Squads').then(m => ({default: m.SquadsPanel})))
const SquadOutcomeDetail = lazy(() => import('../modules/SquadOutcomes').then(m => ({default: m.SquadOutcomeDetail})))
const MemberGuildWorkspace = lazy(() => import('../modules/GuildWorkspace').then(m => ({default: m.MemberGuildWorkspace})))
const PositioningPanel = lazy(() => import('../modules/PositioningPanels').then(m => ({default: m.PositioningPanel})))
const GuildsPanel = lazy(() => import('../guild-blocks/GuildDirectoryPage').then(m => ({default: m.GuildsPanel})))

// Page entries only compose existing features. Session, navigation and leave guards stay in the shell.
export const guildsFeatures = {
  "home": {
    moduleId: "social-feed", placement: 'page',
    render: ({client, session, site, selectTab, openHomeJournal, notificationTarget}) => <MemberHome focusPost={notificationTarget?.tab==='social'&&notificationTarget.resource_id?{id:notificationTarget.resource_id,sequence:notificationTarget.sequence}:undefined} openHomeJournal={openHomeJournal} bookmarksEnabled={site?.community_search_enabled===true && site.community_relations_enabled===true} client={client} session={session} onNavigate={selectTab} shortVideos={site?.short_videos_enabled === true} firstParticipationEnabled={site?.first_participation_enabled===true}/>,
  },
  "positioning": {
    moduleId: "positioning", placement: 'page',
    render: ({client, session, selectTab, registerPageLeave}) => <PositioningPanel key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} session={session} onNavigate={selectTab} registerPendingLeave={registerPageLeave} />,
  },
  "guilds": {
    moduleId: "guild-presentation", placement: 'page',
    render: ({client, session, site, locationHash, selectTab, registerPageLeave}) => <GuildsPanel client={client} session={session} onNavigate={selectTab} site={site} locationHash={locationHash} registerPendingLeave={registerPageLeave} />,
  },
  "skills": {
    moduleId: "development", placement: 'page',
    render: ({client, session, selectTab}) => <SkillsPanel client={client} session={session} onNavigate={selectTab} onManageGitHub={()=>selectTab('account','#account?view=connections')} />,
  },
  "guild-workspace": {
    moduleId: "guild-workspace", placement: 'page',
    render: ({client}) => <MemberGuildWorkspace client={client}/>,
  },
  "squads": {
    moduleId: "member-squads", placement: 'page',
    render: ({client, session, site, locationHash, selectTab, registerPageLeave}) => {
      const hashPath = locationHash.split('?')[0];
      const detailMatch = /^#(?:squad-outcomes|me\/teams\/outcomes)\/([0-9a-f-]{36})$/i.exec(hashPath);
      if (detailMatch && site?.squad_outcomes_enabled === true) {
        return <SquadOutcomeDetail client={client} id={detailMatch[1]} eventLinksEnabled={site?.event_outcomes_enabled === true} />;
      }
      if (/^#(?:squad-outcomes|me\/teams\/outcomes)\/?$/i.test(hashPath)) {
        return <SquadOutcomesList key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} enabled={site?.squad_outcomes_enabled === true} onOpenSquads={() => selectTab('squads')} />;
      }
      return <SquadsPanel key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} session={session} registerLeave={registerPageLeave} onNavigate={selectTab} outcomesEnabled={site?.squad_outcomes_enabled === true} eventLinksEnabled={site?.event_outcomes_enabled === true} />;
    },
  },
} satisfies PortalFeatureEntries;
