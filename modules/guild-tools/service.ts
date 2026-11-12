import {verifyOriginChallenge,assertOriginProofCurrent} from './origin-proof.js';
import {authRateLimit} from '../identity-membership/members.js';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {command,checkVersion,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {requireLeader,viewerAccess,assertDelegatedViewerDeadline} from '../guild-workspace/launchpad-config.js';
import {inspectTool,safeFrameOrigins} from './validation.js';
import type {PreviewFetch} from '../community/link-preview.js';
import {isNativeTool,type ToolRecord} from './contract.js';
const columns='id,guild_key,tool_id,title,entry_url,origin,bridge_version,profile,scopes,permissions,state,revision';
export async function listTools(pool:Pool,guild:string){return {items:(await pool.query(`SELECT ${columns} FROM guild_tools WHERE guild_key=$1 ORDER BY tool_id LIMIT 16`,[guild])).rows as ToolRecord[]};}
export async function frameOrigins(pool:Pool,origin:string){return safeFrameOrigins((await pool.query("SELECT DISTINCT origin FROM guild_tools WHERE state='enabled' ORDER BY origin LIMIT 65")).rows.map(r=>r.origin),origin);}
async function access(q:PoolClient,actor:Actor,guild:string){requireCondition(!actor.agent,403,'guild_leader_required','請由公會長在平台操作。');const a=await viewerAccess(q,actor,guild);requireCondition(a.publish,403,'guild_leader_required','請由此公會會長或受委任成員操作。');return {...a,edit:false,preview:false};}
export async function manageAccess(pool:Pool,actor:Actor,guild:string){return readWithMemberSession(pool,actor,async q=>{const a=await viewerAccess(q,actor,guild);await assertDelegatedViewerDeadline(q,actor,guild,{...a,edit:false,preview:false});return {manage:a.publish,leader:a.leader};});}
async function audit(q:PoolClient,actor:Actor,row:ToolRecord,action:string){await q.query('INSERT INTO guild_tool_audit(id,tool,revision,actor,action) VALUES($1,$2,$3,$4,$5)',[randomUUID(),row.id,row.revision,actor.user_id,action]);}
export async function registerTool(pool:Pool,input:Command,guild:string,origin:string,fetcher?:PreviewFetch){
 // Authenticate before external work, then repeat current authorization inside the write transaction.
 await readWithMemberSession(pool,input.actor,async q=>{const a=await access(q,input.actor,guild);await assertDelegatedViewerDeadline(q,input.actor,guild,a);});
 await authRateLimit(pool,'guild-tool-registration',input.actor.user_id,20,3600);
 const body=await inspectTool(input.body,origin,fetcher);requireCondition(!isNativeTool(guild,body.tool_id),409,'native_tool_reserved','此代號屬於平台工具，請換一個代號。');const proof=body.profile==='origin'?await verifyOriginChallenge(pool,input.actor,guild,body.origin,(input.body as {origin_challenge_id?:string}).origin_challenge_id,fetcher):undefined;let rights:Awaited<ReturnType<typeof access>>;
 return command(pool,input,async q=>{rights=await access(q,input.actor,guild);if(proof)await assertOriginProofCurrent(q,proof,input.actor,guild,body.origin);await q.query("SELECT pg_advisory_xact_lock(hashtextextended('guild-tools-registry',0))");},async q=>{
 const prior=(await q.query('SELECT * FROM guild_tools WHERE guild_key=$1 AND tool_id=$2 FOR UPDATE',[guild,body.tool_id])).rows[0];
 if(prior){requireCondition(prior.community_id===input.actor.community_id,403,'tool_forbidden','此工具屬於另一個社群。');checkVersion(String(prior.revision),input.expected);}
 else requireCondition(Number((await q.query('SELECT count(*) FROM guild_tools WHERE guild_key=$1',[guild])).rows[0].count)<16,409,'tool_limit','每個公會最多 16 個工具。');
 const count=Number((await q.query("SELECT count(DISTINCT origin) FROM guild_tools WHERE state<>'disabled' AND id IS DISTINCT FROM $1",[prior?.id??null])).rows[0].count);
 requireCondition(count<64||Boolean((await q.query("SELECT 1 FROM guild_tools WHERE origin=$1 AND state<>'disabled' LIMIT 1",[body.origin])).rowCount),409,'tool_origin_limit','來源數量已滿，請先整理現有工具。');
 const id=prior?.id??randomUUID(),revision=(prior?.revision??0)+1;
 await q.query(`INSERT INTO guild_tools(id,community_id,guild_key,tool_id,revision,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by)
 VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13)
 ON CONFLICT(guild_key,tool_id) DO UPDATE SET revision=$5,state='pending',title=$6,entry_url=$7,origin=$8,bridge_version=$9,profile=$10,scopes=$11,permissions=$12,registered_by=$13,accepted_by=NULL,updated_at=clock_timestamp()`,[id,input.actor.community_id,guild,body.tool_id,revision,body.title,body.entry_url,body.origin,body.bridge_version,body.profile,JSON.stringify(body.scopes),JSON.stringify(body.permissions),input.actor.user_id]);
 const row={...body,id,guild_key:guild,revision,state:'pending'} as ToolRecord;
 await q.query('INSERT INTO guild_tool_revisions(tool,revision,record,registered_by) VALUES($1,$2,$3,$4)',[id,revision,JSON.stringify(row),input.actor.user_id]);await audit(q,input.actor,row,'register');return row;
 },q=>assertDelegatedViewerDeadline(q,input.actor,guild,rights));
}
export async function changeTool(pool:Pool,input:Command,guild:string,tool:string,action:'accept'|'disable'|'report'){
 if(action==='report')await authRateLimit(pool,'guild-tool-report',input.actor.user_id,60,3600);
 requireCondition(typeof input.body==='object'&&input.body!==null&&Object.keys(input.body).length===0,422,'tool_invalid','操作內容須為空物件。');let row:ToolRecord;let rights:Awaited<ReturnType<typeof access>>|undefined;
 return command(pool,input,async q=>{
 requireCondition(!input.actor.agent,403,'tool_forbidden','請在平台操作。');
  const found=(await q.query(`SELECT *,${columns} FROM guild_tools WHERE guild_key=$1 AND tool_id=$2 AND community_id=$3 FOR UPDATE`,[guild,tool,input.actor.community_id])).rows[0];requireCondition(found,404,'tool_not_found','找不到工具。');row=found;
 if(action==='accept'&&row.revision===1)rights=await access(q,input.actor,guild);else if(action!=='report')await requireLeader(q,input.actor,guild);
 },async q=>{
 checkVersion(String(row.revision),input.expected);
 if(action==='report'){
 requireCondition(row.state==='enabled',409,'tool_disabled','工具已停用。');
 await q.query('INSERT INTO guild_tool_reports(tool,revision,reporter) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,row.revision,input.actor.user_id]);
 if(Number((await q.query('SELECT count(*) FROM guild_tool_reports WHERE tool=$1 AND revision=$2',[row.id,row.revision])).rows[0].count)>=3)row.state='disabled';
 }else{requireCondition(action!=='accept'||row.state==='pending',409,'tool_state','請重新登錄並預覽後加入。');row.state=action==='accept'?'enabled':'disabled';}
 await q.query('UPDATE guild_tools SET state=$2,accepted_by=CASE WHEN $3 THEN $4 ELSE accepted_by END,updated_at=clock_timestamp() WHERE id=$1',[row.id,row.state,action==='accept',input.actor.user_id]);await audit(q,input.actor,row,action);return {state:row.state,revision:row.revision};
 },q=>rights?assertDelegatedViewerDeadline(q,input.actor,guild,rights):Promise.resolve());
}
export async function toolContext(pool:Pool,actor:Actor,guild:string,tool:string){return readWithMemberSession(pool,actor,async q=>{
 const r=(await q.query("SELECT id FROM guild_tools WHERE guild_key=$1 AND tool_id=$2 AND state='enabled' AND community_id=$3 FOR SHARE",[guild,tool,actor.community_id])).rows[0];requireCondition(r,404,'tool_unavailable','工具目前無法使用。');
 await q.query('INSERT INTO guild_tool_subjects(tool,member,subject) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[r.id,actor.user_id,randomUUID()]);
 const tier=(await q.query("SELECT member_tier FROM positioning_profession_memberships WHERE user_id=$1 AND community_id=$2 AND guild_key=$3 AND state='active'",[actor.user_id,actor.community_id,guild])).rows[0]?.member_tier??null;
 return {subject:(await q.query('SELECT subject FROM guild_tool_subjects WHERE tool=$1 AND member=$2',[r.id,actor.user_id])).rows[0].subject,tier};
});}
