import React, { lazy } from 'react';
import type { PortalFeatureEntries } from './types';
import { CommunityPanel } from '../modules/Community';
import { CommunitySearch } from '../modules/CommunitySearch';
import { MyContent } from '../modules/MyContent';

const CommunityArPanel=lazy(()=>import('../modules/community-ar/Panel').then(m=>({default:m.CommunityArPanel})))
const EventsPanel = lazy(() => import('../modules/EventsPanel').then(m => ({default: m.EventsPanel})))
const SocialZone = lazy(() => import('../modules/SocialZone').then(m => ({default: m.SocialZone})))
const MemberServices = lazy(() => import('../modules/MemberServices').then(m => ({default: m.MemberServices})))
const PromotionBoards = lazy(() => import('../modules/PromotionBoards').then(m => ({default: m.PromotionBoards})))
const EventHighlights = lazy(() => import('../modules/EventHighlights').then(m => ({default: m.EventHighlights})))
const TesterMap = lazy(() => import('../modules/TesterMap').then(m => ({default: m.TesterMap})))
const NewbieVillage = lazy(() => import('../modules/NewbieVillage').then(m => ({default: m.NewbieVillage})))
const TaskBoardPanel = lazy(() => import('../modules/TaskBoardPanel').then(m => ({default: m.TaskBoardPanel})))

const CommunityHub = lazy(() => import('../modules/CommunityHub').then(m=>({default:m.CommunityHub})));

// Page entries only compose existing features. Session, navigation and leave guards stay in the shell.
export const communityFeatures = {
  "community-hub": {moduleId:"community-hub",placement:"page",render:()=> <CommunityHub/>},
  "newbie-village": {moduleId:"newbie-village",placement:"page",render:()=> <NewbieVillage/>},
  "community": {
    moduleId: "community", placement: 'page',
    render: ({client, selectTab}) => <CommunityPanel client={client} onNavigate={selectTab} />,
  },
  "community-search": {
    moduleId: "community-search", placement: 'page',
    render: ({client, session, site}) => (site?.community_search_enabled === true ? <CommunitySearch key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} authKey={`${session.user.user_id}:${client.sessionGeneration}`} relationsEnabled={site.community_relations_enabled === true} guildSearchEnabled={site.guild_launchpad_enabled === true}/> : <p>社群內容搜尋尚未開放。</p>),
  },
  "my-content": {
    moduleId: "personal-content", placement: 'page',
    render: ({client, session, site}) => (site?.personal_content_enabled === true ? <MyContent key={`${session.user.user_id}:${client.sessionGeneration}`}/> : <p>我的內容尚未開放。</p>),
  },
  "ar": {
    moduleId: "community-ar", placement: 'page',
    render: ({client, session, site, registerPageLeave}) => <CommunityArPanel key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} enabled={site?.ar_enabled===true} userId={session.user.user_id} registerLeave={registerPageLeave}/>,
  },
  "events": {
    moduleId: "community", placement: 'page',
    render: ({client, session, site, locationHash, selectTab, registerPageLeave}) => <EventsPanel key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} session={session} locationHash={locationHash} registerLeave={registerPageLeave} onList={()=>selectTab('events')} participationEnabled={site?.event_participation_enabled===true}/>,
  },
  "highlights": {
    moduleId: "community", placement: 'page',
    render: ({client, session, site}) => <EventHighlights key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} outcomesEnabled={site?.event_outcomes_enabled===true}/>,
  },
  "tasks": {
    moduleId: "work", placement: 'page',
    render: ({client, selectTab}) => <TaskBoardPanel client={client} onNavigate={selectTab} />,
  },
  "social": {
    moduleId: "social-feed", placement: 'page',
    render: ({client, session, site, notificationTarget, headerMember}) => <SocialZone bookmarksEnabled={site?.community_search_enabled===true && site.community_relations_enabled===true} client={client} shortVideos={site?.short_videos_enabled===true} viewer={{name: headerMember?.nickname??session.user.display_name, avatarUrl: headerMember?.avatar_url}} focusPost={notificationTarget?.tab==='social'&&notificationTarget.resource_id?{id:notificationTarget.resource_id,sequence:notificationTarget.sequence}:undefined}/>,
  },
  "services": {
    moduleId: "community", placement: 'page',
    render: ({client}) => <MemberServices client={client} />,
  },
  "promotion": {
    moduleId: "community", placement: 'page',
    render: ({client}) => <PromotionBoards client={client} />,
  },
  "tester-map": {
    moduleId: "tester-map", placement: 'page',
    render: () => <TesterMap />,
  },
  messages: {
    moduleId: 'member-communications', placement: 'overlay',
    // FloatingMessages owns its retained mount, visibility and message-leave lifecycle.
    render: () => null,
  },
} satisfies PortalFeatureEntries;
