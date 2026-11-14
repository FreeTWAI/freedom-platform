import {linkAdapter} from '../../modules/shares/adapters/link.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importEvent} from '../../modules/shares/adapters/event-import.js';
import {createNodePreviewFetch} from '../../apps/platform-api/src/node-preview-fetch.js';
const fixture=(name:string)=>readFile(new URL(`../fixtures/event-import/${name}`,import.meta.url),'utf8');
const recorded=(name:string)=>async()=>new Response(await fixture(name),{headers:{'Content-Type':'text/html'}});
test('JSON-LD graph, OG tags and linked ICS import recorded pages',async()=>{
 const j=await importEvent('https://example.com/event',recorded('jsonld.html'));assert.equal(j.title,'合成讀書會');assert.equal(j.starts_at,'2099-01-01T10:00:00.000Z');assert.equal(j.source_organizer,'合成主辦');assert.equal(j.description,'一起閱讀');
 const og=await importEvent('https://example.com/event',recorded('og.html'));assert.equal(og.title,'合成聚會');assert.equal(og.source_cover_url,'https://example.com/cover.png');
 const ics=await importEvent('https://example.com/event',async url=>new Response(await fixture(url.endsWith('.ics')?'meeting.ics':'calendar.html'),{headers:{'Content-Type':url.endsWith('.ics')?'text/calendar':'text/html'}}));assert.equal(ics.title,'合成行事曆活動');assert.equal(ics.starts_at,'2099-01-03T10:00:00.000Z');
});
test('hostile markup is data; private URLs, DNS, redirected calendars and oversized documents fail closed',async()=>{
 const event=await importEvent('https://example.com/event',async()=>new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Event',name:'<img src=x onerror=evil()>活動',image:'javascript:evil()',location:{'@type':'VirtualLocation',url:'https://127.0.0.1/private'}})+'</script>',{headers:{'Content-Type':'text/html'}}));assert.equal(event.title,'活動');assert.equal(event.source_cover_url,undefined);assert.equal(event.online_url,undefined);
 for(const url of ['https://127.0.0.1/','https://[::1]/','https://localhost/','https://169.254.169.254/','http://example.com/'])await assert.rejects(importEvent(url,async()=>{throw Error('must not fetch');}));
 let lookups=0;const transport=createNodePreviewFetch(async()=>{lookups++;return [{address:'10.0.0.1',family:4}];});assert.deepEqual(await importEvent('https://example.com/event',transport),{source_url:'https://example.com/event'});assert.equal(lookups,1);
 let calls=0;await importEvent('https://example.com/event',async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/'}});});assert.equal(calls,1);
 assert.deepEqual(await importEvent('https://example.com/event',async()=>new Response('x'.repeat(1048577),{headers:{'Content-Type':'text/html'}})),{source_url:'https://example.com/event'});
 assert.deepEqual(await importEvent('https://example.com/event'),{source_url:'https://example.com/event'});
});

test('generic share box recognizes Event JSON-LD and incomplete structured data falls through to OG and ICS',async()=>{
 const preview=await linkAdapter.prepare({url:'https://example.com/event'},{previewFetch:recorded('jsonld.html')});assert.equal(preview.kind,'event');assert.equal(preview.event?.title,'合成讀書會');
 const result=await importEvent('https://example.com/event',async url=>new Response(url.endsWith('.ics')?await fixture('meeting.ics'):'<script type="application/ld+json">'+JSON.stringify({'@type':'Event',name:'JSON 優先'})+'</script><meta property="og:title" content="OG 候補"><meta property="og:description" content="補足說明"><link type="text/calendar" href="/event.ics">',{headers:{'Content-Type':url.endsWith('.ics')?'text/calendar':'text/html'}}));assert.equal(result.title,'JSON 優先');assert.equal(result.description,'補足說明');assert.equal(result.starts_at,'2099-01-03T10:00:00.000Z');
});
