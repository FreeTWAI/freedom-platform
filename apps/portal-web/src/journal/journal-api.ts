import type {JournalPerson,JournalEntry} from '../../../../modules/community-journal/payload.js';
export class DataError extends Error { constructor(public code:string){super(code);} }
export function assetUrl(value:unknown){return typeof value==='string'&&/^\/media\/public\/[a-f0-9]{64}\.png$/.test(value)?'/journal-assets/'+value.split('/').at(-1):null;}
export function personView(p:JournalPerson){return {id:p.slug,name:p.display_name,english:'',kind:p.kind,role:p.role,category:p.category,tags:p.tags,bio:p.intro||'',avatarUrl:assetUrl(p.avatar.url),avatar:undefined as string|undefined,lineName:undefined as string|undefined,fit:p.avatar.display_fit,position:p.avatar.object_position,color:'',background:p.color};}
export type PersonView=ReturnType<typeof personView>;
const statusNames={proposed:'提案中',in_progress:'進行中',reported_done:'回報完成',verified_done:'已驗證'};
type Block={type:'list';items:string[]}|{type:'paragraph'|'quote';text:string};
export function journalView(j:JournalEntry){
 const chapters:{id:string;short:string;title:string;label:string;paragraphs:string[];blocks:Block[];points?:string[]}[]=[];
 for(const [i,b] of j.blocks.entries()){
  if(b.type==='heading'||!chapters.length)chapters.push({id:'section-'+i,short:b.type==='heading'?b.text:'日誌內容',title:b.type==='heading'?b.text:'',label:'',paragraphs:[],blocks:[]});
  if(b.type!=='heading')chapters.at(-1)!.blocks.push(b);
 }
 return {issue:String(j.version).padStart(3,'0'),title:j.title,kicker:'',summary:j.excerpt,minutes:Math.max(1,Math.ceil(JSON.stringify(j.blocks).length/450)),scope:j.date,sourceNote:j.coverage.is_partial?'本篇為部分時段紀錄。':'',tags:[] as string[],chapters,heroUrl:assetUrl(j.hero?.url),api:true,published:true,people:j.people.map(personView),decisions:j.decisions.map(d=>({title:d.text,detail:d.scope,state:'已決定'})),topics:j.development_items.map((d,i)=>({name:d.id||String(i),title:d.title,text:d.next_step,state:statusNames[d.status],tag:'開發項目',color:i%2?'lilac':'mint',chapter:'development'}))};
}
export type StoryView=ReturnType<typeof journalView>;
export async function readSnapshot(signal:AbortSignal){
 let response:Response;try{response=await fetch('/api/v1/public/journal',{signal,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});}catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw new DataError('network');}
 if(!response.ok)throw new DataError('unavailable');
 const body=await response.json();
 if(!body?.data||!Array.isArray(body.data.people)||!Array.isArray(body.data.journals))throw new DataError('invalid_data');
 return body.data as {people:JournalPerson[];journals:JournalEntry[]};
}
