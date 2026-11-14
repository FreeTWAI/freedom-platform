import type { RepositorySnapshot } from '../github-social/provider.js';
import type { PoolClient } from 'pg';
import type { Actor } from '../identity-membership/service.js';
import type { PreviewFetch } from '../community/link-preview.js';
export type ShareKind = 'repository'|'link'|'event'|'work'|'post'|'service';
export type ShareInput = {kind?:ShareKind;url?:string;ref_id?:string;text?:string;guild_key?:string};
export type ShareRow = {share_id:string;community_id:string;kind:ShareKind;canonical_key:string;canonical_url:string;repo_id:string|null;ref_table:string|null;ref_id:string|null;title:string;first_sharer_user_id:string|null;state:'published'|'hidden'|'retracted';guild_key:string|null;editor_notes:Record<string,unknown>;created_at:Date};
export type RepositoryFacts = {metrics?:RepositorySnapshot;id:string;full_name:string;url:string;description:string;archived:boolean;fork:boolean;owner_id:string;owner_login:string;default_branch:string;stars:number;topics:string[];homepage:string|null;license_spdx:string|null};
export type PreparedShare = {event?:import('./adapters/event-import.js').ImportedEvent;kind:ShareKind;canonical_key:string;canonical_url:string;title:string;ref_table?:string;ref_id?:string;repository?:RepositoryFacts};
export type AdapterContext = {fetcher?:typeof fetch;previewFetch?:PreviewFetch;token?:string};
/** prepare may perform bounded public network I/O; register/visible run on the caller's DB transaction. */
export interface ShareAdapter {
  kind:ShareKind;
  prepare(input:ShareInput,context:AdapterContext):Promise<PreparedShare>;
  authorize?(q:PoolClient,actor:Actor,prepared:PreparedShare):Promise<void>;
}
