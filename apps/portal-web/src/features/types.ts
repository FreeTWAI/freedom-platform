import type { ReactNode } from 'react';
import type { PortalClient } from '../api';
import type { SessionPayload, TabId } from '../types';
import type { SiteConfig } from '../modules/Community';
import type { MemberCardData } from '../modules/Membership';
import type { BellAction } from '../modules/NotificationBell';

/** The shell supplies current state and existing actions; entries own no session or permission checks. */
export type PortalFeatureContext = {
  client: PortalClient;
  session: SessionPayload;
  site: SiteConfig | null;
  locationHash: string;
  selectTab: (tab: TabId, hash?: string) => void;
  friendScope: 'accepted' | 'incoming';
  notificationTarget: (BellAction & { sequence: number }) | null;
  headerMember: MemberCardData | null;
  registerPageLeave: (guard: ((nextHash: string | null) => boolean) | null) => void;
  replaceBuyerLocation: (hash: string) => void;
  onSessionExpired: () => void;
  openMemberMessage: (memberId: string) => void;
  showIncomingFriends: () => void;
};

/** moduleId links to the existing development descriptor; it never grants runtime access. */
export type PortalFeatureEntry = {
  moduleId: string;
  placement: 'page' | 'overlay';
  render: (context: PortalFeatureContext) => ReactNode;
};

export type PortalFeatureEntries = Partial<Record<TabId, PortalFeatureEntry>>;
