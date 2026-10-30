import React, { lazy } from 'react';
import type { PortalFeatureEntries } from './types';

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
    render: ({client, session, site, selectTab, openHomeJournal}) => <MemberHome openHomeJournal={openHomeJournal} bookmarksEnabled={site?.community_search_enabled===true && site.community_relations_enabled===true} client={client} session={session} onNavigate={selectTab} personalContentEnabled={site?.personal_content_enabled === true} guildLaunchpadEnabled={site?.guild_launchpad_enabled === true} shortVideos={site?.short_videos_enabled === true} onOpenSupply={() => selectTab('stores', '#stores/supply')} firstParticipationEnabled={site?.first_participation_enabled===true}/>,
  },
  "positioning": {
    moduleId: "positioning", placement: 'page',
    render: ({client, session, selectTab}) => <PositioningPanel client={client} session={session} onNavigate={selectTab} />,
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
    render: ({client, session, site, locationHash, selectTab, registerPageLeave}) => (/^#squad-outcomes\/[0-9a-f-]{36}$/i.test(locationHash)&&site?.squad_outcomes_enabled===true ? <SquadOutcomeDetail client={client} id={locationHash.slice('#squad-outcomes/'.length)} eventLinksEnabled={site?.event_outcomes_enabled===true}/> : <SquadsPanel key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} session={session} registerLeave={registerPageLeave} onNavigate={selectTab} outcomesEnabled={site?.squad_outcomes_enabled===true} eventLinksEnabled={site?.event_outcomes_enabled===true}/>),
  },
} satisfies PortalFeatureEntries;
