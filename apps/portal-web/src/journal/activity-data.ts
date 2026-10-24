import {DataError,sourceMessagesView,type SourceMessageView} from './journal-api.js';
import type {ActivityPeriod,JournalActivity} from '../../../../modules/community-journal/activity.js';
export type ActivityView={range:JournalActivity['range'];people:{id:string;count:number}[];messages:(SourceMessageView&{key:string;person:string;date:string;chapter:string;topic:string})[];unattributedCount:number};
export function activityView(data:JournalActivity):ActivityView{
 if(data?.scope!=='published_sources'||!Array.isArray(data.people)||!Array.isArray(data.messages)||!/^\d{4}-\d{2}-\d{2}$/.test(data.range?.start)||!/^\d{4}-\d{2}-\d{2}$/.test(data.range?.end))throw new DataError('invalid_data');
 const seen=new Set<string>();
 const messages=data.messages.map(m=>{
  const source=sourceMessagesView([m])[0];
  if(!source||typeof m.person_slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.person_slug)||typeof m.key!=='string'||!m.key||seen.has(m.key)||!/^\d{4}-\d{2}-\d{2}$/.test(m.journal_date)||!/^section-\d+$/.test(m.chapter_id)||typeof m.topic!=='string')throw new DataError('invalid_data');
  seen.add(m.key);return {...source,key:m.key,person:m.person_slug,date:m.journal_date,chapter:m.chapter_id,topic:m.topic};
 });
 const people=data.people.map(p=>{if(typeof p.slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug)||!Number.isSafeInteger(p.count)||p.count<0)throw new DataError('invalid_data');return {id:p.slug,count:p.count};});
 const ids=new Set(people.map(p=>p.id)),counts=new Map<string,number>();for(const m of messages)counts.set(m.person,(counts.get(m.person)||0)+1);
 if(ids.size!==people.length||messages.some(m=>!ids.has(m.person))||people.some(p=>p.count!==(counts.get(p.id)||0))||!Number.isSafeInteger(data.unattributed_count)||data.unattributed_count<0)throw new DataError('invalid_data');
 return {range:data.range,people,messages,unattributedCount:data.unattributed_count};
}
export async function loadActivity(period:ActivityPeriod,signal:AbortSignal,fetcher:typeof fetch=fetch){
 const response=await fetcher('/api/v1/public/journal/activity?period='+period,{signal,credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
 if(!response.ok)throw new DataError('unavailable');return activityView((await response.json()).data);
}
export function topicCounts(messages:ActivityView['messages']){const counts=new Map<string,number>();for(const m of messages)counts.set(m.topic,(counts.get(m.topic)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}
export function paginateMessages<T>(messages:T[],page=1){const pages=Math.max(1,Math.ceil(messages.length/5)),currentPage=Math.max(1,Math.min(page,pages));return {pages,currentPage,pageMessages:messages.slice((currentPage-1)*5,currentPage*5)};}
