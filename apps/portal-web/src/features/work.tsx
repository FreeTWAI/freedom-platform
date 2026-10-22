import React, { lazy } from 'react';
import type { PortalFeatureEntries } from './types';

const WorkbenchPanel = lazy(() => import('../modules/WorkbenchPanel').then(m => ({default: m.WorkbenchPanel})))
const ShowcasePanel = lazy(() => import('../modules/ShowcasePanel').then(m => ({default: m.ShowcasePanel})))
const EngagementPanel = lazy(() => import('../modules/EngagementPanel').then(m => ({default: m.EngagementPanel})))
const CoCreationPanel = lazy(() => import('../modules/CoCreationPanel').then(m => ({default: m.CoCreationPanel})))
const OpenSourcePanel = lazy(() => import('../modules/OpenSourcePanels').then(m => ({default: m.OpenSourcePanel})))
const MarketingPanel = lazy(() => import('../modules/OpenSourcePanels').then(m => ({default: m.MarketingPanel})))
const PrivateWorkAI = lazy(() => import('../modules/PrivateWorkAI').then(m => ({default: m.PrivateWorkAI})))

// Page entries only compose existing features. Session, navigation and leave guards stay in the shell.
export const workFeatures = {
  "cocreation": {
    moduleId: "work", placement: 'page',
    render: ({client, session, selectTab}) => <CoCreationPanel client={client} session={session} onNavigate={selectTab} />,
  },
  "workbench": {
    moduleId: "work", placement: 'page',
    render: ({}) => <WorkbenchPanel />,
  },
  "private-ai": {
    moduleId: "execution-runs", placement: 'page',
    render: ({client, session}) => <PrivateWorkAI client={client} key={session.user.user_id}/>,
  },
  "showcase": {
    moduleId: "work", placement: 'page',
    render: ({}) => <ShowcasePanel />,
  },
  "engagement": {
    moduleId: "work", placement: 'page',
    render: ({}) => <EngagementPanel />,
  },
  "opensource": {
    moduleId: "skill-submissions", placement: 'page',
    render: ({client, session, selectTab}) => <OpenSourcePanel key={session.user.user_id+':'+session.csrf_token} client={client} session={session} onNavigate={selectTab} />,
  },
  "marketing": {
    moduleId: "skill-submissions", placement: 'page',
    render: ({client, session, selectTab}) => <MarketingPanel client={client} session={session} onNavigate={selectTab} />,
  },
} satisfies PortalFeatureEntries;
