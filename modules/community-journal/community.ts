import type {JournalPerson,JournalEntry} from './payload.js';
export const journalCommunities=['freedom','claude','codex'] as const;
export type JournalCommunity=typeof journalCommunities[number];
export const communityOf=(item:{community?:JournalCommunity}):JournalCommunity=>item.community??'freedom';
export const communityLabel=(community:JournalCommunity)=>({freedom:'自由工坊',claude:'Claude',codex:'Codex'})[community];

// An editorial source stream is not a platform membership or permission grant.
export function communitySnapshot<T extends {people:JournalPerson[];journals:JournalEntry[]}>(snapshot:T,community:JournalCommunity):T{
 return {...snapshot,people:snapshot.people.filter(p=>communityOf(p)===community),journals:snapshot.journals.filter(j=>communityOf(j)===community)};
}
