import React, { lazy } from 'react';
import {parseProfileRoute,visitorProfileHash} from '../modules/profile-publication-route';
import type { PortalFeatureEntries } from './types';

const VisitorProfile = lazy(() => import('../modules/VisitorProfile').then(m => ({default:m.VisitorProfile})));
const ProfilePublicationSettings = lazy(() => import('../modules/ProfilePublicationSettings').then(m => ({default:m.ProfilePublicationSettings})));
const NotificationPreferencesPanel = lazy(() => import('../modules/NotificationPreferences').then(m => ({default: m.NotificationPreferencesPanel})))
const FriendsPanel = lazy(() => import('../modules/FriendsPanel').then(m => ({default: m.FriendsPanel})))
const PersonalSpace = lazy(() => import('../modules/PersonalSpace').then(m => ({default: m.PersonalSpace})))
const AccountPanel = lazy(() => import('../modules/Membership').then(m => ({default: m.AccountPanel})))
const MembersPanel = lazy(() => import('../modules/Membership').then(m => ({default: m.MembersPanel})))
const MemberTasks = lazy(() => import('../modules/MemberTasks').then(m => ({default: m.MemberTasks})))

// Page entries only compose existing features. Session, navigation and leave guards stay in the shell.
export const identityFeatures = {
  profile: {moduleId: "personal-content", placement: 'page', render: ({client,session,site,locationHash,selectTab,registerPageLeave,openMemberMessage}) => {
    const route=parseProfileRoute(locationHash);
    if(route?.kind==='invalid')return <p role="alert">個人頁連結不正確。</p>;
    if(route?.kind==='settings')return <ProfilePublicationSettings client={client} session={session} registerLeave={registerPageLeave} onReturn={()=>selectTab('profile')} onView={()=>selectTab('profile',visitorProfileHash(session.user.user_id))}/>;
    if(route?.kind==='visitor')return <VisitorProfile client={client} session={session} id={route.id} registerLeave={registerPageLeave} onMessage={openMemberMessage} onEdit={()=>selectTab('profile','#profile?view=settings')}/>;
    return <PersonalSpace key={session.user.user_id+':'+client.sessionGeneration} client={client} session={session} contentEnabled={site?.personal_content_enabled===true}/>;
  }},
  "account": {
    moduleId: "member-card", placement: 'page',
    render: ({client, session, site, selectTab}) => <><AccountPanel client={client} session={session} onNavigate={selectTab} />{site?.notification_preferences_enabled===true&&<NotificationPreferencesPanel key={session.user.user_id+':'+session.csrf_token} client={client} followingEnabled={site.community_relations_enabled===true}/>}</>,
  },
  "todos": {
    moduleId: "work", placement: 'page',
    render: ({client, selectTab}) => <MemberTasks client={client} onNavigate={selectTab} />,
  },
  "friends": {
    moduleId: "friends-directory", placement: 'page',
    render: ({client, session, site, selectTab, friendScope, openMemberMessage}) => <FriendsPanel client={client} session={session} initialScope={friendScope} memberBlockingEnabled={site?.member_blocking_enabled===true} onNavigate={selectTab} onMessage={openMemberMessage} />,
  },
  "members": {
    moduleId: "friends-directory", placement: 'page',
    render: ({client, session, site, notificationTarget, openMemberMessage, showIncomingFriends}) => <MembersPanel client={client} session={session} memberBlockingEnabled={site?.member_blocking_enabled===true} onIncomingFriends={showIncomingFriends} onMessage={openMemberMessage} focusRequest={notificationTarget?.tab==='members'&&notificationTarget.resource_id?{id:notificationTarget.resource_id,sequence:notificationTarget.sequence}:undefined} />,
  },
} satisfies PortalFeatureEntries;
