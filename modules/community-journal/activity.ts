import type {JournalEntry,JournalPerson} from './payload.js';
import {communitySnapshot,type JournalCommunity} from './community.js';
export type ActivityPeriod='week'|'month';
export type ActivityMessage={key:string;person_slug:string;text:string;time:string;journal_date:string;chapter_id:string;topic:string};
// Only call with the currently published snapshot. Drafts are never queried here.
export function journalActivity(snapshot:{people:JournalPerson[];journals:JournalEntry[]},period:ActivityPeriod,now=new Date(),community:JournalCommunity='freedom'){
 snapshot=communitySnapshot(snapshot,community);
 const end=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const first=new Date(end+'T00:00:00Z');first.setUTCDate(first.getUTCDate()-(period==='week'?6:29));
 const start=first.toISOString().slice(0,10),people=snapshot.people.filter(p=>p.kind==='person'),ids=new Set(people.map(p=>p.slug)),seen=new Set<string>();
 const messages:ActivityMessage[]=[];let unattributed_count=0;
 for(const j of [...snapshot.journals].sort((a,b)=>a.date.localeCompare(b.date))){
  if(j.date<start||j.date>end)continue;
  for(const [index,block] of j.blocks.entries()){
   if(block.type!=='heading')continue;
   for(const m of block.source_messages||[]){
    if(m.source_key){if(seen.has(m.source_key))continue;seen.add(m.source_key);}
    if(!m.source_key||!m.person_slug){unattributed_count++;continue;}
    if(!ids.has(m.person_slug))continue;
    messages.push({key:m.source_key,person_slug:m.person_slug,text:m.text,time:m.time,journal_date:j.date,chapter_id:'section-'+index,topic:block.text});
   }
  }
 }
 messages.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||a.key.localeCompare(b.key));
 const counts=new Map<string,number>();for(const m of messages)counts.set(m.person_slug,(counts.get(m.person_slug)||0)+1);
 return {scope:'published_sources' as const,range:{start,end,time_zone:'Asia/Taipei' as const},people:people.map(p=>({slug:p.slug,count:counts.get(p.slug)||0})),messages,unattributed_count};
}
export type JournalActivity=ReturnType<typeof journalActivity>;
