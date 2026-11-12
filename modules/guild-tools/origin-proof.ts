import {randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition,Problem} from '../../packages/shared/problem.js';
import {viewerAccess,assertDelegatedViewerDeadline} from '../guild-workspace/launchpad-config.js';
import {authRateLimit} from '../identity-membership/members.js';
import type {Actor} from '../identity-membership/service.js';
import type {PreviewFetch} from '../community/link-preview.js';
import {toolUrl} from './validation.js';
export const CHALLENGE_PATH='/.well-known/freedom-guild-tool.txt';
export async function createOriginChallenge(pool:Pool,actor:Actor,guild:string,raw:unknown,platformOrigin:string){
 const body=z.object({entry_url:z.string().max(2048)}).strict().parse(raw),origin=toolUrl(body.entry_url,platformOrigin).origin;
 await authRateLimit(pool,'guild-tool-challenge',actor.user_id,20,3600);
 return readWithMemberSession(pool,actor,async q=>{requireCondition(!actor.agent,403,'browser_required','請由會長操作。');const a=await viewerAccess(q,actor,guild);requireCondition(a.publish,403,'guild_leader_required','請由此公會會長或受委任成員操作。');
 const id=randomUUID(),token='freedom-origin-v1-'+randomBytes(32).toString('base64url');
 await q.query('INSERT INTO guild_tool_origin_challenges(id,community_id,guild_key,member,origin,token,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval \'30 minutes\')',[id,actor.community_id,guild,actor.user_id,origin,token]);await assertDelegatedViewerDeadline(q,actor,guild,{...a,edit:false,preview:false});
 return {challenge_id:id,url:origin+CHALLENGE_PATH,contents:token,expires_in:1800};});
}
export async function verifyOriginChallenge(pool:Pool,actor:Actor,guild:string,origin:string,id:unknown,fetcher:PreviewFetch|undefined){
 requireCondition(typeof id==='string'&&z.uuid().safeParse(id).success,422,'origin_proof_required','請先建立來源驗證，將驗證檔放在網站根目錄。');
 const row=(await pool.query('SELECT token FROM guild_tool_origin_challenges WHERE id=$1 AND community_id=$2 AND guild_key=$3 AND member=$4 AND origin=$5 AND expires_at>clock_timestamp()',[id,actor.community_id,guild,actor.user_id,origin])).rows[0];requireCondition(row,422,'origin_proof_expired','驗證已過期或來源不符，請重新建立。');
 requireCondition(fetcher,503,'tool_egress_unavailable','尚未安裝安全網址檢查。');
 let response:Response;try{response=await fetcher(origin+CHALLENGE_PATH,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/plain'}});}catch{throw new Problem(422,'origin_proof_failed','無法讀取根目錄驗證檔。');}
 const reader=response.body?.getReader();try{requireCondition(response.status===200&&reader,422,'origin_proof_failed','驗證檔須直接回傳 200，不可重新導向。');let value='',bytes=0;const decoder=new TextDecoder();for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;requireCondition(bytes<=256,422,'origin_proof_failed','驗證檔內容太長。');value+=decoder.decode(part.value,{stream:true});}value+=decoder.decode();requireCondition(value.trim()===row.token,422,'origin_proof_failed','驗證內容不符，請更新根目錄驗證檔。');}finally{await reader?.cancel();}
 return id;
}
export async function assertOriginProofCurrent(q:PoolClient,id:string,actor:Actor,guild:string,origin:string){requireCondition((await q.query('SELECT 1 FROM guild_tool_origin_challenges WHERE id=$1 AND community_id=$2 AND guild_key=$3 AND member=$4 AND origin=$5 AND expires_at>clock_timestamp() FOR SHARE',[id,actor.community_id,guild,actor.user_id,origin])).rowCount===1,422,'origin_proof_expired','來源驗證已過期，請重試。');}
