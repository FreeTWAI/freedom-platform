import {attributes,meta,previewDocument,previewImageUrl,htmlText,type PreviewFetch} from '../../community/link-preview.js';
import {normalizeShareUrl} from '../../../packages/shared/share-url.js';
import {requireCondition} from '../../../packages/shared/problem.js';
export type ImportedEvent={title?:string;starts_at?:string;ends_at?:string;location?:string;mode?:'online'|'in_person'|'hybrid';description?:string;online_url?:string;source_organizer?:string;source_cover_url?:string;external_registration_url?:string;source_url:string};
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/\u0000/g,'').trim().slice(0,max):undefined;
const safe=(value:unknown,base:string)=>{try{if(typeof value!=='string')return undefined;const n=normalizeShareUrl(new URL(value,base).href);return n.ok?n.url:undefined;}catch{return undefined;}};
const time=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v))return undefined;const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():undefined;};
function eventNode(value:unknown):any{
 // Iterative, bounded walk handles @graph and arrays without untrusted recursion.
 const queue:unknown[]=[value];let visited=0;
 while(queue.length&&visited++<2000){const v=queue.shift();if(Array.isArray(v)){queue.push(...v.slice(0,2000-visited));continue;}if(!v||typeof v!=='object')continue;const obj=v as Record<string,unknown>;const types=Array.isArray(obj['@type'])?obj['@type']:[obj['@type']];if(types.some(t=>typeof t==='string'&&/(?:^|[/#])Event$/.test(t)))return obj;if(obj['@graph'])queue.push(obj['@graph']);}
 return null;
}
function jsonEvent(value:any,url:string):ImportedEvent{
 const loc=Array.isArray(value.location)?value.location[0]:value.location;
 const address=loc?.address;const where=typeof loc==='string'?loc:typeof address==='string'?address:[address?.streetAddress,address?.addressLocality,address?.addressRegion].filter(x=>typeof x==='string').join(' ')||loc?.name;
 const online=loc?.['@type']==='VirtualLocation'||value.eventAttendanceMode?.endsWith?.('OnlineEventAttendanceMode');
 const org=Array.isArray(value.organizer)?value.organizer[0]:value.organizer;
 const image=Array.isArray(value.image)?value.image[0]:value.image;
 const offers=Array.isArray(value.offers)?value.offers[0]:value.offers;
 return {source_url:url,title:clean(value.name,120),description:clean(value.description,3000),starts_at:time(value.startDate),ends_at:time(value.endDate),location:clean(where,300)??(online?'線上':undefined),mode:online?'online':'in_person',online_url:online?safe(loc?.url,url):undefined,source_organizer:clean(typeof org==='string'?org:org?.name,160),source_cover_url:safe(typeof image==='string'?image:image?.url,url),external_registration_url:safe(offers?.url??value.url,url)};
}
export function parseEventCalendar(text:string,url:string):ImportedEvent{
 const event=text.replace(/\r?\n[ \t]/g,'').match(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/i)?.[1];
 const result:ImportedEvent={source_url:url};if(!event)return result;
 for(const line of event.split(/\r?\n/)){
  const colon=line.indexOf(':');if(colon<0)continue;const prop=line.slice(0,colon),key=prop.split(';')[0].toUpperCase(),value=line.slice(colon+1).replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1');
  if(key==='SUMMARY')result.title=clean(value,120);
  if(key==='DESCRIPTION')result.description=clean(value,3000);
  if(key==='LOCATION')result.location=clean(value,300);
  if(key==='URL')result.external_registration_url=safe(value,url);
  if(key==='ORGANIZER'){const cn=/(?:^|;)CN=(?:"([^"]*)"|([^;]*))/.exec(prop);result.source_organizer=clean(cn?.[1]??cn?.[2],160);}
  if(key==='DTSTART'||key==='DTEND'){
   // Floating/TZID and all-day values require explicit user time confirmation.
   const m=/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(value);
   const parsed=m?time(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`):undefined;
   if(parsed)result[key==='DTSTART'?'starts_at':'ends_at']=parsed;
  }
 }
 return result;
}
/** Recorded inputs in tests; no ambient fetch and no automatic publication of upstream markup. */
export async function importEvent(raw:string,fetcher?:PreviewFetch):Promise<ImportedEvent>{
 const normalized=normalizeShareUrl(raw);requireCondition(normalized.ok,422,'invalid_event_source','請貼上安全的 HTTPS 活動網址。');
 const url=normalized.url,empty={source_url:url};if(!fetcher)return empty;
 const deadline=Date.now()+6000,page=await previewDocument(url,fetcher,deadline);if(!page)return empty;
 if(page.type==='text/calendar')return parseEventCalendar(page.body.toString('utf8'),url);
 if(!['text/html','application/xhtml+xml','application/ld+json'].includes(page.type))return empty;
 const html=htmlText(page.body,page.contentType);
 if(page.type==='application/ld+json'){try{const n=eventNode(JSON.parse(html));if(n)return jsonEvent(n,url);}catch{}return empty;}
 let structured:ImportedEvent|undefined;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
  if(attributes(m[1]).type?.toLowerCase()!=='application/ld+json')continue;
  try{const n=eventNode(JSON.parse(m[2]));if(n){structured=jsonEvent(n,url);break;}}catch{/* One malformed block must not hide a later valid one. */}
 }
 const og:ImportedEvent={source_url:url,title:clean(meta(html,'og:title'),120),description:clean(meta(html,'og:description'),3000),starts_at:time(meta(html,'event:start_time')),ends_at:time(meta(html,'event:end_time')),location:clean(meta(html,'event:location'),300),source_cover_url:previewImageUrl(html,page.url)??undefined};
 if(structured)for(const [k,v] of Object.entries(structured))if(v!==undefined)(og as any)[k]=v;
 // JSON-LD and OG fill fields first; one linked calendar fills missing fields only.
 for(const tag of html.match(/<(?:a|link)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)??[]){
  const a=attributes(tag),href=safe(a.href,page.url);if(!href||!(a.type==='text/calendar'||new URL(href).pathname.toLowerCase().endsWith('.ics')))continue;
  const calendar=await previewDocument(href,fetcher,deadline);
  if(calendar?.type==='text/calendar'){const parsed=parseEventCalendar(calendar.body.toString('utf8'),url);for(const [k,v] of Object.entries(parsed))if(v!==undefined&&(og as any)[k]===undefined)(og as any)[k]=v;}
  break;
 }
 return og;
}
