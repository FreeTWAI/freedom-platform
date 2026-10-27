import {z} from 'zod';
import type {Pool} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {objectKey,readVerifiedObject,type ObjectStore} from '../../packages/asset-storage/index.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import {profileReadySql,memberProfileAuthoritySql,publicProfileAuthoritySql} from '../../packages/shared/profile-authority.js';
import {assetVersion} from './engine.js';
export interface ProfileCoverSnapshot {user_id:string;version:string;generation:string;asset_id:string;scope_id:string;representation_id:string;byte_size:number;content_sha256:string;policy_revision:string;}
const missing=()=>new Problem(404,'profile_cover_not_found','找不到可閱讀的封面。');
const columns='vcover.user_id,vcover.version::text AS version,p.aggregate_version::text AS generation,vcover.asset_id,vcover.scope_id,o.representation_id,o.byte_size,o.content_sha256,o.policy_revision';
const joins=`JOIN member_profile_cover_versions vcover ON vcover.user_id=p.user_id AND vcover.version=p.cover_version AND vcover.retired_at IS NULL
 JOIN assets a ON a.asset_id=vcover.asset_id AND a.scope_id=vcover.scope_id AND a.owner_user_id=p.user_id AND a.purpose='member.profile-cover' AND a.state='ready' AND a.deletion_fence=0
 JOIN resource_scopes cs ON cs.scope_id=a.scope_id AND cs.kind='personal' AND cs.owner_principal_id=a.owner_principal_id AND cs.status='active'
 JOIN principals cp ON cp.principal_id=a.owner_principal_id AND cp.user_ref=a.owner_user_id AND cp.status='active'
 JOIN asset_objects o ON o.asset_id=a.asset_id AND o.scope_id=a.scope_id AND o.representation_id=a.representation_id
 AND o.profile_id='member.profile-cover' AND o.content_type='image/webp' AND o.transform_version='member.profile-cover.webp.v1'`;
/** SQL authority is repeated after verified object I/O. No transaction spans
 * object I/O, no retry substitutes a new generation, no conditional 304 path. */
export async function readAuthorizedProfileCover(snapshot:()=>Promise<ProfileCoverSnapshot|undefined>,store:ObjectStore|undefined,version:string,generation?:string){
 const current=await snapshot(),first=current?Object.freeze({...current}):undefined;if(!first||first.version!==version||(generation!==undefined&&first.generation!==generation))throw missing();
 requireCondition(store,503,'profile_cover_unavailable','封面暫時無法讀取。');let bytes:Uint8Array;
 try{bytes=(await readVerifiedObject(store!,objectKey({scopeId:first.scope_id,assetId:first.asset_id,representationId:first.representation_id}),{contentType:'image/webp',byteSize:first.byte_size,sha256:first.content_sha256,transformVersion:'member.profile-cover.webp.v1',policyRevision:first.policy_revision,profileId:'member.profile-cover'})).bytes;}
 catch{throw new Problem(503,'profile_cover_unavailable','封面暫時無法讀取。');}
 const last=await snapshot();if(!last||JSON.stringify(last)!==JSON.stringify(first))throw missing();return bytes;
}
export function readPublicProfileCover(pool:Pool,rawId:string,rawVersion:string,rawGeneration:string,store?:ObjectStore){
 const id=z.uuid().parse(rawId).toLowerCase(),version=assetVersion.parse(rawVersion),generation=assetVersion.parse(rawGeneration);
 return readAuthorizedProfileCover(async()=> (await pool.query<ProfileCoverSnapshot>(`SELECT ${columns} FROM member_profile_publications p
 JOIN users u ON u.user_id=p.user_id AND u.community_id=p.community_id ${joins}
 WHERE ${publicProfileAuthoritySql()} AND p.include_cover AND vcover.version=$2 AND p.aggregate_version=$3`,[id,version,generation])).rows[0],store,version,generation);
}
export function readMemberProfileCover(pool:Pool,actor:Actor,rawId:string,rawVersion:string,rawGeneration:string,store?:ObjectStore){
 actor=Object.freeze({...actor});
 const id=z.uuid().parse(rawId).toLowerCase(),version=assetVersion.parse(rawVersion),generation=assetVersion.parse(rawGeneration);
 return readAuthorizedProfileCover(()=>readWithMemberSession(pool,actor,async q=>(await q.query<ProfileCoverSnapshot>(`SELECT ${columns} FROM member_profile_publications p
 JOIN users u ON u.user_id=p.user_id AND u.community_id=p.community_id JOIN users v ON v.user_id=$2 AND v.community_id=p.community_id ${joins}
 WHERE ${memberProfileAuthoritySql()} AND p.include_cover AND vcover.version=$4 AND p.aggregate_version=$5`,[actor.community_id,actor.user_id,id,version,generation])).rows[0]),store,version,generation);
}
export function readOwnerProfileCover(pool:Pool,actor:Actor,rawVersion:string,store?:ObjectStore){
 actor=Object.freeze({...actor});
 const version=assetVersion.parse(rawVersion);
 return readAuthorizedProfileCover(()=>readWithMemberSession(pool,actor,async q=>(await q.query<ProfileCoverSnapshot>(`SELECT vcover.user_id,vcover.version::text AS version,'owner'::text AS generation,vcover.asset_id,vcover.scope_id,o.representation_id,o.byte_size,o.content_sha256,o.policy_revision
 FROM member_profile_cover_versions vcover JOIN users u ON u.user_id=vcover.user_id
 JOIN assets a ON a.asset_id=vcover.asset_id AND a.scope_id=vcover.scope_id AND a.owner_user_id=u.user_id AND a.purpose='member.profile-cover' AND a.state='ready' AND a.deletion_fence=0
 JOIN resource_scopes cs ON cs.scope_id=a.scope_id AND cs.kind='personal' AND cs.owner_principal_id=a.owner_principal_id AND cs.status='active'
 JOIN principals cp ON cp.principal_id=a.owner_principal_id AND cp.user_ref=a.owner_user_id AND cp.status='active'
 JOIN asset_objects o ON o.asset_id=a.asset_id AND o.scope_id=a.scope_id AND o.representation_id=a.representation_id AND o.profile_id='member.profile-cover' AND o.content_type='image/webp' AND o.transform_version='member.profile-cover.webp.v1'
 WHERE u.user_id=$1 AND u.community_id=$2 AND ${profileReadySql('u')} AND vcover.version=$3 AND vcover.retired_at IS NULL`,[actor.user_id,actor.community_id,version])).rows[0]),store,version);
}
/** Use only alongside the canonical text profile ACL in the same SELECT. */
export const profileCoverProjectionSql=`CASE WHEN p.include_cover AND EXISTS(
 SELECT 1 FROM member_profile_cover_versions cv JOIN assets ca ON ca.asset_id=cv.asset_id AND ca.scope_id=cv.scope_id
 AND ca.owner_user_id=p.user_id AND ca.purpose='member.profile-cover' AND ca.state='ready' AND ca.deletion_fence=0
 JOIN resource_scopes cs ON cs.scope_id=ca.scope_id AND cs.kind='personal' AND cs.owner_principal_id=ca.owner_principal_id AND cs.status='active'
 JOIN principals cp ON cp.principal_id=ca.owner_principal_id AND cp.user_ref=ca.owner_user_id AND cp.status='active'
 WHERE cv.user_id=p.user_id AND cv.version=p.cover_version AND cv.retired_at IS NULL)
 THEN jsonb_build_object('version',p.cover_version::text,'generation',p.aggregate_version::text) ELSE NULL END AS cover`;
