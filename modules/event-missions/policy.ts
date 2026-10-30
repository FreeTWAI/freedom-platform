/** Personal self-exercises only; never attendance, exchange or contribution proof. */
export const MISSION_POLICY='personal_self_exercises_v1' as const;
export const MISSION_TEMPLATES=[
 {id:'read_intro',title:'看一看活動介紹',description:'找一個自己感興趣的主題。不需要公開或告訴任何人。'},
 {id:'think_question',title:'想一個想了解的問題',description:'可以只在心裡想，也可以自願向主辦詢問。'},
 {id:'notice_interest',title:'發現一個共同興趣',description:'可和熟人自在聊聊，也可自己閱讀公開作品；不需要接觸陌生人。'},
 {id:'prepare_intro',title:'想一句自我介紹',description:'只練習自己想分享的內容，不必提供姓名、電話或其他私人資料。'},
 {id:'reflect',title:'回想一個小收穫',description:'在心裡回想即可，不需要上傳文字、照片或證明。'},
 {id:'take_break',title:'照顧一下自己的步調',description:'休息、喝水或略過任務都可以。任務不是參加活動的條件。'},
] as const;
export type MissionId=typeof MISSION_TEMPLATES[number]['id'];
export type MissionSlot={template_id:MissionId;state:'active'|'self_reported'|'skipped'};
export type MissionAction={action:'start'|'clear'}|{action:'replace'|'mark_done'|'skip';slot:number};
export function chooseMissions(index:number):MissionSlot[]{
 return [0,1,2].map(offset=>({template_id:MISSION_TEMPLATES[(index+offset)%MISSION_TEMPLATES.length].id,state:'active'}));
}
export function changeMission(slots:readonly MissionSlot[],action:Exclude<MissionAction,{action:'start'|'clear'}>,index:number):MissionSlot[]{
 if(!['replace','mark_done','skip'].includes(action.action))throw new Error('invalid_action');
 if(!Number.isInteger(action.slot)||action.slot<0||action.slot>=slots.length)throw new Error('invalid_slot');
 const next=slots.map(s=>({...s}));
 if(action.action==='replace'){
  const available=MISSION_TEMPLATES.filter(t=>!slots.some(s=>s.template_id===t.id));
  next[action.slot]={template_id:available[index%available.length].id,state:'active'};
 }else next[action.slot].state=action.action==='mark_done'?'self_reported':'skipped';
 return next;
}
