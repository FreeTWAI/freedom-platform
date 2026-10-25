import type {TabId} from '../../apps/portal-web/src/types';
import type {InterfaceMessage} from '../../apps/portal-web/src/interface-messages';
export type CommunityWork = {readonly id: string; readonly tab: TabId; readonly descriptionKey: InterfaceMessage};
export const COMMUNITY_WORK = (['tasks','events','cocreation','squads','opensource','skills','social','highlights','guilds'] as const satisfies readonly TabId[]).map(tab => ({id:tab, tab, descriptionKey:`communityHub.work.${tab}` as const})) satisfies readonly CommunityWork[];
