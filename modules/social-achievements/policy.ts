/** Server-owned cumulative days. No streaks, online time or content-quality inference. */
export const SOCIAL_POLICY='social_days_v1' as const;
export const SOCIAL_THRESHOLDS=[1,7,30,90,365] as const;
export const SOCIAL_DESCRIPTION='長期主動參與里程碑；不代表內容品質、專業能力、真人身分或社群認證。';
export const SOCIAL_TITLES=[
  ...['話題接上了','接話新手','聊得來','接話高手','聊天宗師'].map((label,i)=>({title_id:`chat_${SOCIAL_THRESHOLDS[i]}`,track:'chat' as const,days:SOCIAL_THRESHOLDS[i]!,label})),
  ...['工坊初相遇','工坊新面孔','工坊熟面孔','工坊常客','工坊老朋友'].map((label,i)=>({title_id:`participation_${SOCIAL_THRESHOLDS[i]}`,track:'participation' as const,days:SOCIAL_THRESHOLDS[i]!,label})),
];
export function socialProgress(days:number){
  const next=SOCIAL_THRESHOLDS.find(n=>n>days)??null;
  return {days,next_days:next,remaining:next===null?0:next-days};
}
export function unlockedTitles(chat:number,participation:number){return SOCIAL_TITLES.filter(t=>(t.track==='chat'?chat:participation)>=t.days);}
export function titleProjection(id:string|null){const title=SOCIAL_TITLES.find(t=>t.title_id===id);return title?{title_id:title.title_id,label:title.label,policy_version:SOCIAL_POLICY,description:SOCIAL_DESCRIPTION}:null;}
