import {forgetFrameOrigins} from './service.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {adminCommand,audit,type AdminCommand,type AdminActor} from '../platform-admin/service.js';
import {checkVersion} from '../../packages/db/index.js';
import {requireCondition} from '../../packages/shared/problem.js';
export async function adminTools(pool:Pool,admin:AdminActor,reported=false,limit=200,offset=0){
 const rows=(await pool.query(`SELECT t.id,t.guild_key,t.tool_id,t.title,t.origin,t.state,t.revision,
   r.report_count,r.first_reported_at FROM guild_tools t
   LEFT JOIN LATERAL (SELECT count(*)::int AS report_count,min(created_at) AS first_reported_at
     FROM guild_tool_reports WHERE tool=t.id AND revision=t.revision) r ON true
   WHERE t.community_id=$1 AND (NOT $2 OR (r.report_count>0 AND NOT EXISTS(
     SELECT 1 FROM guild_tool_audit a WHERE a.tool=t.id AND a.revision=t.revision AND a.action='admin-disable')))
   ORDER BY r.first_reported_at NULLS LAST,t.id LIMIT $3 OFFSET $4`,[admin.community_id,reported,limit+1,offset])).rows;
 return {items:rows.slice(0,limit),next_offset:rows.length>limit?offset+limit:null};
}
export async function disableToolAsAdmin(pool:Pool,input:AdminCommand,id:string){
 const body=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(input.body);z.uuid().parse(id);let row:any;
 const result=await adminCommand(pool,input,async q=>{row=(await q.query('SELECT * FROM guild_tools WHERE id=$1 AND community_id=$2 FOR UPDATE',[id,input.admin.community_id])).rows[0];requireCondition(row,404,'tool_not_found','找不到工具。');},async q=>{
 checkVersion(String(row.revision),input.expected);await q.query("UPDATE guild_tools SET state='disabled',updated_at=clock_timestamp() WHERE id=$1",[id]);
 await q.query("INSERT INTO guild_tool_audit(id,tool,revision,admin,action) VALUES($1,$2,$3,$4,'admin-disable')",[randomUUID(),id,row.revision,input.admin.admin_id]);await audit(q,input.admin,'guild-tool.disable','guild-tool',id,body.reason,{state:row.state,revision:row.revision},{state:'disabled',revision:row.revision});return {state:'disabled',revision:row.revision};});
 forgetFrameOrigins();return result;
}
