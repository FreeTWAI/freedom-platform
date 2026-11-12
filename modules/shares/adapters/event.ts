import {existingAdapter} from './existing.js';
import {importEvent} from './event-import.js';
import type {ShareAdapter} from '../types.js';
const existing=existingAdapter('event','community_events','/events/');
export const eventAdapter:ShareAdapter={kind:'event',async prepare(input,context){
 if(input.ref_id)return existing.prepare(input,context);
 const event=input.url?await importEvent(input.url,context.previewFetch):{source_url:''};
 return {kind:'event',canonical_key:event.source_url,canonical_url:event.source_url,title:event.title??'',event};
},async authorize(q,actor,p){if(p.ref_id)await existing.authorize!(q,actor,p);}};
