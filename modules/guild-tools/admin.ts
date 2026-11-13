import {forgetFrameOrigins} from './service.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {adminCommand,audit,type AdminCommand,type AdminActor} from '../platform-admin/service.js';
import {checkVersion} from '../../packages/db/index.js';
import {requireCondition} from '../../packages/shared/problem.js';
export async function adminTools(pool:Pool,admin:AdminActor){return {items:(await pool.query('SELECT id,guild_key,tool_id,title,origin,state,revision FROM guild_tools WHERE community_id=$1 ORDER BY updated_at DESC LIMIT 200',[admin.community_id])).rows};}
export async function disableToolAsAdmin(pool:Pool,input:AdminCommand,id:string){
 const body=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(input.body);z.uuid().parse(id);let row:any;
 const result=await adminCommand(pool,input,async q=>{row=(await q.query('SELECT * FROM guild_tools WHERE id=$1 AND community_id=$2 FOR UPDATE',[id,input.admin.community_id])).rows[0];requireCondition(row,404,'tool_not_found','找不到工具。');},async q=>{
 checkVersion(String(row.revision),input.expected);await q.query("UPDATE guild_tools SET state='disabled',updated_at=clock_timestamp() WHERE id=$1",[id]);
 await q.query("INSERT INTO guild_tool_audit(id,tool,revision,admin,action) VALUES($1,$2,$3,$4,'admin-disable')",[randomUUID(),id,row.revision,input.admin.admin_id]);await audit(q,input.admin,'guild-tool.disable','guild-tool',id,body.reason,{state:row.state,revision:row.revision},{state:'disabled',revision:row.revision});return {state:'disabled',revision:row.revision};});
 forgetFrameOrigins();return result;
}
