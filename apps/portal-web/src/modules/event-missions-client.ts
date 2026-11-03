export type MissionAction={action:'start'|'clear'}|{action:'replace'|'mark_done'|'skip';slot:number};
export type MissionView={policy:'personal_self_exercises_v1';version:number;enabled:boolean;editable:boolean;slots:{slot:number;template_id:string;id:string;state:'active'|'self_reported'|'skipped';title:string;description:string}[]};
const ids=new Set(['read_intro','think_question','notice_interest','prepare_intro','reflect','take_break']);
export function missionView(value:unknown):value is MissionView{
 if(!value||typeof value!=='object')return false;const v=value as MissionView;
 return v.policy==='personal_self_exercises_v1'&&Number.isSafeInteger(v.version)&&v.version>0&&typeof v.enabled==='boolean'&&typeof v.editable==='boolean'&&Array.isArray(v.slots)
  &&v.slots.length===(v.enabled&&v.editable?3:0)&&new Set(v.slots.map(s=>s?.template_id)).size===v.slots.length
  &&v.slots.every((s,i)=>s&&s.slot===i&&ids.has(s.template_id)&&s.id===s.template_id&&['active','self_reported','skipped'].includes(s.state)&&typeof s.title==='string'&&s.title.length<=100&&typeof s.description==='string'&&s.description.length<=300);
}
export function missionAck(value:unknown,eventId:string,body:MissionAction,key:string){
 if(!value||typeof value!=='object')return false;
 const v=value as Record<string,unknown>;
 return v.acknowledged===true&&v.event_id===eventId&&v.action===body.action&&v.command_key===key;
}
