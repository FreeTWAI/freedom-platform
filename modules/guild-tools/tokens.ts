import {randomUUID} from 'node:crypto';
import {SignJWT,jwtVerify,importJWK,type JWK} from 'jose';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {authRateLimit} from '../identity-membership/members.js';
import {requireCondition} from '../../packages/shared/problem.js';
export const TOOL_TOKEN_TYPE='freedom-guild-tool+jwt';
/** Deliberately explicit installation port. No environment-secret discovery or activation. */
export type ToolSigner={privateKey:CryptoKey;publicJwk:JWK;kid:string};
export function toolJwks(signer?:ToolSigner){requireCondition(signer,503,'tool_tokens_unavailable','工具身分尚未啟用。');const {kty,crv,x,y}=signer.publicJwk;requireCondition(kty==='EC'&&crv==='P-256'&&x&&y,503,'tool_tokens_unavailable','工具身分尚未啟用。');return {keys:[{kty,crv,x,y,kid:signer.kid,use:'sig',alg:'ES256'}]};}
export async function exchangeToolToken(pool:Pool,actor:Actor,guild:string,tool:string,raw:unknown,issuer:string,signer?:ToolSigner){
 z.object({}).strict().parse(raw);requireCondition(signer,503,'tool_tokens_unavailable','工具身分尚未啟用。');toolJwks(signer);
 await authRateLimit(pool,'guild-tool-token',actor.user_id,120,3600);
 return readWithMemberSession(pool,actor,async q=>{
 const row=(await q.query("SELECT id,revision,origin FROM guild_tools WHERE guild_key=$1 AND tool_id=$2 AND community_id=$3 AND state='enabled' AND profile='origin' AND scopes ? 'session:exchange' FOR SHARE",[guild,tool,actor.community_id])).rows[0];requireCondition(row,403,'tool_token_forbidden','只有已驗證來源且啟用中的工具能取得身分。');
 await q.query('INSERT INTO guild_tool_subjects(tool,member,subject) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,actor.user_id,randomUUID()]);
 const subject=(await q.query('SELECT subject FROM guild_tool_subjects WHERE tool=$1 AND member=$2',[row.id,actor.user_id])).rows[0].subject;
 const tier=(await q.query("SELECT member_tier FROM positioning_profession_memberships WHERE user_id=$1 AND community_id=$2 AND guild_key=$3 AND state='active' FOR SHARE",[actor.user_id,actor.community_id,guild])).rows[0]?.member_tier??null;
 const now=Math.floor(Date.now()/1000),jti=randomUUID();
 // Only pairwise identity is delegated. Bridge capabilities are NOT backend/core API grants.
 const access_token=await new SignJWT({purpose:'guild-tool-identity',tool_id:tool,guild_key:guild,revision:row.revision,tool_origin:row.origin,tier,scopes:['context:read']}).setProtectedHeader({alg:'ES256',typ:TOOL_TOKEN_TYPE,kid:signer.kid}).setIssuer(issuer).setAudience(row.id).setSubject(subject).setIssuedAt(now).setExpirationTime(now+600).setJti(jti).sign(signer.privateKey);
 await q.query('INSERT INTO guild_tool_token_grants(jti,tool,revision,member,session_hash,agent_connection,expires_at) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7))',[jti,row.id,row.revision,actor.user_id,actor.agent?null:actor.session_hash,actor.agent?.connection_id??null,now+600]);
 return {access_token,token_type:'Bearer',expires_in:600,audience:row.id,issuer};
 });
}
export async function verifyToolToken(token:string,jwk:JWK,issuer:string,audience:string){
 const {payload,protectedHeader}=await jwtVerify(token,await importJWK(jwk,'ES256'),{algorithms:['ES256'],typ:TOOL_TOKEN_TYPE,issuer,audience,maxTokenAge:'10m',requiredClaims:['iat','exp','jti','sub']});
 requireCondition(protectedHeader.typ===TOOL_TOKEN_TYPE&&z.uuid().safeParse(payload.jti).success&&z.uuid().safeParse(payload.sub).success&&Number.isInteger(payload.iat)&&Number.isInteger(payload.exp)&&Number(payload.exp)>Number(payload.iat)&&Number(payload.iat)<=Math.floor(Date.now()/1000)&&payload.purpose==='guild-tool-identity'&&payload.aud===audience&&Number.isInteger(payload.revision)&&Number(payload.exp)-Number(payload.iat)<=600&&Array.isArray(payload.scopes)&&payload.scopes.length===1&&payload.scopes[0]==='context:read',401,'tool_token_invalid','工具身分無效。');return payload;
}
export async function toolTokenStatus(pool:Pool,raw:unknown,issuer:string,signer?:ToolSigner){
 const body=z.object({token:z.string().max(4096),audience:z.uuid()}).strict().parse(raw);requireCondition(signer,503,'tool_tokens_unavailable','工具身分尚未啟用。');
 let claims;try{claims=await verifyToolToken(body.token,toolJwks(signer).keys[0],issuer,body.audience);}catch{return {active:false};}
 const row=(await pool.query(`SELECT t.id FROM guild_tool_token_grants g JOIN guild_tools t ON t.id=g.tool JOIN users u ON u.user_id=g.member
 WHERE g.jti=$1 AND t.id=$2 AND t.revision=g.revision AND t.revision=$3 AND t.state='enabled' AND t.profile='origin' AND u.active AND g.expires_at>clock_timestamp()
 AND (g.session_hash IS NOT NULL AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=g.session_hash AND s.user_id=g.member AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp())
 OR g.agent_connection IS NOT NULL AND EXISTS(SELECT 1 FROM member_client_connections c WHERE c.connection_id=g.agent_connection AND c.user_id=g.member AND c.revoked_at IS NULL AND c.suspended_at IS NULL AND c.expires_at>clock_timestamp() AND 'read'=ANY(c.scopes)))
 AND COALESCE((SELECT m.member_tier FROM positioning_profession_memberships m WHERE m.user_id=g.member AND m.community_id=t.community_id AND m.guild_key=t.guild_key AND m.state='active'),'')=$4`,[claims.jti,body.audience,claims.revision,claims.tier??''])).rows[0];return {active:Boolean(row)};
}
