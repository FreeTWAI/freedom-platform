import type {Pool} from 'pg';
import {z} from 'zod';
import {command,transaction,type Command} from '../../packages/db/index.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {publicEvent,readEvent} from './events.js';
export async function eventInterest(pool:Pool,id:string,input:Command){
 z.object({}).strict().parse(input.body);
 return command(pool,input,async q=>{const e=await readEvent(q,input.actor,id);requireCondition(e.state==='published'&&e.registration_mode==='external',409,'external_event_required','請使用活動報名。');},async q=>{
  await q.query('INSERT INTO community_event_interests(event_id,interest_key) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,'m:'+input.actor.user_id]);return {interested:true,registered:false};
 });
}
export async function guestEventInterest(pool:Pool,id:string,raw:unknown){
 const body=z.object({interest_id:z.uuid()}).strict().parse(raw);
 return transaction(pool,async q=>{const e=await publicEvent(q,id);requireCondition(e.registration_mode==='external',409,'external_event_required','請使用活動報名。');
  await q.query('INSERT INTO community_event_interests(event_id,interest_key) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,'g:'+body.interest_id]);return {interested:true,registered:false};
 });
}
