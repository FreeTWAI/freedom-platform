import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';
import {text,isoTime} from '../../packages/shared/validation.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {eventPrizeDetailsSchema,confirmEventPrizeDetails,confirmEventPrizeReceipt} from '../../modules/community/event-prize-details.js';
import {EVENT_PRIZE_ICON_IDS} from '../../modules/community/event-prize-icons.js';

const prize=()=>({prize_id:randomUUID(),name:'入門書',description:'主辦者提供的合成範例',quantity:3,icon_id:'book' as const,completion_rule:'完成練習後，由主辦者評選三位',claim_note:'結果公布後現場領取'});
test('empty lists and bounded descriptive prizes round trip without inferred rewards',()=>{
  assert.deepEqual(eventPrizeDetailsSchema.parse([]),[]);
  const values=Array.from({length:5},prize);assert.deepEqual(eventPrizeDetailsSchema.parse(values),values);
  assert.deepEqual(eventPrizeDetailsSchema.parse([{...prize(),description:''}])[0].description,'');
  for(const icon_id of EVENT_PRIZE_ICON_IDS)assert.equal(eventPrizeDetailsSchema.parse([{...prize(),icon_id}])[0].icon_id,icon_id);
});
test('canonical text normalization and v4 identities preserve distinct list order',()=>{
  const original=prize(),other=prize();const actual=eventPrizeDetailsSchema.parse([{...original,name:' 入門書 ',prize_id:original.prize_id.toUpperCase()},other]);
  assert.equal(actual[0].prize_id,original.prize_id);assert.equal(actual[0].name,'入門書');assert.equal(actual[1].prize_id,other.prize_id);
});
for(const [name,value] of [
  ['null',null],['object',{}],['too many',Array.from({length:6},prize)],
  ['repeated ids',(()=>{const item=prize();return [item,{...item}];})()],
  ['duplicate canonical ids',(()=>{const item=prize();return [item,{...item,prize_id:item.prize_id.toUpperCase()}];})()],
  ...[0,-1,1.1,501,NaN,Infinity,'3',null].map(quantity=>[`quantity ${quantity}`,[{...prize(),quantity}]]),
  ...['https://example.test/icon.svg','<svg/>','GIFT','constructor',''].map(icon_id=>[`icon ${icon_id}`,[{...prize(),icon_id}]]),
  ...['name','completion_rule','claim_note'].flatMap(field=>[['blank '+field,[{...prize(),[field]:' \n\t '}]],['long '+field,[{...prize(),[field]:'文'.repeat(field==='name'?121:501)}]]]),
  ['long description',[{...prize(),description:'文'.repeat(501)}]],
  ['nul',[{...prize(),name:'bad\0text'}]],['unpaired surrogate',[{...prize(),claim_note:'bad\ud800'}]],
  ['invalid identity',[{...prize(),prize_id:'award-a'}]],['unknown key',[{...prize(),awarded:true}]],
  ['unknown image',[{...prize(),image_url:'https://example.test/prize.png'}]],
] as [string,unknown][])test(`strict prize DTO rejects ${name}`,()=>assert.equal(eventPrizeDetailsSchema.safeParse(value).success,false));
test('confirmation accepts reordered JSON object keys but not altered rule, quantity, ID or missing fields',()=>{
  const one=prize(),expected=[one];confirmEventPrizeDetails([Object.fromEntries(Object.entries(one).reverse())],expected);
  for(const field of ['name','description','completion_rule','claim_note','prize_id','quantity','icon_id']){
    const replacement=field==='quantity'?4:field==='prize_id'?randomUUID():field==='icon_id'?'gift':'不同內容';
    assert.throws(()=>confirmEventPrizeDetails([{...one,[field]:replacement}],expected),field);
  }
  assert.throws(()=>confirmEventPrizeDetails(undefined,[]));assert.throws(()=>confirmEventPrizeDetails([],expected));
  assert.throws(()=>confirmEventPrizeDetails([{...one,name:' 入門書 '}],expected));
});
test('receipt is bound to original event, organizer, pending state and exact safe next version',()=>{
  const expected={event_id:randomUUID(),organizer_ref:randomUUID(),aggregate_version:4,prize_details:[prize()]};
  const receipt={...expected,state:'pending'};confirmEventPrizeReceipt(receipt,expected);
  for(const patch of [{event_id:randomUUID()},{organizer_ref:randomUUID()},{aggregate_version:3},{aggregate_version:5},{aggregate_version:'4'},{state:'published'},{prize_details:[]}])assert.throws(()=>confirmEventPrizeReceipt({...receipt,...patch},expected));
  confirmEventPrizeReceipt({...receipt,aggregate_version:1},{...expected,event_id:null,aggregate_version:1});
  assert.throws(()=>confirmEventPrizeReceipt({...receipt,event_id:'not-id'},{...expected,event_id:null}));
});
test('SQL persistence guard contains the exact stable icon allowlist and empty legacy default',()=>{
  const sql=readFileSync('migrations/199_event_prize_details.sql','utf8');
  const list=/icon_id' NOT IN \(([^)]+)\)/.exec(sql)?.[1];assert.ok(list);
  assert.deepEqual([...list.matchAll(/'([^']+)'/g)].map(match=>match[1]),[...EVENT_PRIZE_ICON_IDS]);
  assert.match(sql,/NOT NULL DEFAULT '\[\]'::jsonb/);assert.match(sql,/CHECK \(valid_event_prize_details\(prize_details\)\)/);
});


test('Unicode code-point text limits and canonical whitespace match the persisted contract',()=>{
 const valid={...prize(),name:'😀'.repeat(120),description:'😀'.repeat(500),completion_rule:'😀'.repeat(500),claim_note:'😀'.repeat(500)};
 assert.deepEqual(eventPrizeDetailsSchema.parse([valid]),[valid]);
 for(const [field,max] of [['name',120],['description',500],['completion_rule',500],['claim_note',500]] as const)assert.equal(eventPrizeDetailsSchema.safeParse([{...valid,[field]:'😀'.repeat(max+1)}]).success,false);
 for(const pad of [' ', '\t', '\n', '\u00a0', '\u3000', '\ufeff'])assert.equal(eventPrizeDetailsSchema.parse([{...prize(),name:pad+'名稱'+pad}])[0].name,'名稱');
});

test('new editor focus outline uses the declared platform focus token',()=>{
 const css=readFileSync('apps/portal-web/src/modules/EventPrizeDetails.css','utf8');
 const theme=readFileSync('apps/portal-web/src/styles.css','utf8')+readFileSync('apps/portal-web/src/rpg-theme.css','utf8');
 assert.match(css,/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
 assert.match(theme,/--focus\s*:/);assert.doesNotMatch(css,/var\(--accent\)/);
});


function actualEventInputSchema(){
 // Execute the actual pure input declaration, not the database command or an API.
 const source=readFileSync('modules/community/events.ts','utf8');
 const declaration=source.slice(source.indexOf('const details = z.object('),source.indexOf('const reviewInput='));
 assert(declaration.startsWith('const details = z.object('));
 return runInNewContext(declaration+'\ndetails',{z,text,isoTime,eventPrizeDetailsSchema,URL}) as z.ZodType<Record<string,unknown>>;
}
test('actual event input preserves omitted prizes distinctly from explicit empty update intent',()=>{
 const schema=actualEventInputSchema(),body={title:'活動',description:'說明',starts_at:'2099-01-01T12:00:00Z',ends_at:'2099-01-02T12:00:00Z',mode:'online',location:'線上',capacity:null};
 assert.equal(Object.hasOwn(schema.parse(body),'prize_details'),false);
 assert.deepEqual(schema.parse({...body,prize_details:[]}).prize_details,[]);
 assert.equal(schema.safeParse({...body,prize_details:null}).success,false);
});
test('actual event and prize schemas accept maximum Unicode text before the HTTP envelope is considered',()=>{
 const char='😀',body={title:char.repeat(120),description:char.repeat(3000),help_need:char.repeat(500),starts_at:'2099-01-01T12:00:00.000+15:59',ends_at:'2099-01-02T13:00:00.000+15:59',mode:'in_person',location:char.repeat(300),event_kind:'guild_skill_exchange',topic:char.repeat(160),online_url:'https://example.org/'+char.repeat(480),visibility:'workshop',capacity:500,guild_key:'guild_member_operations',registration_policy:'community_member',prize_details:Array.from({length:5},()=>({...prize(),name:char.repeat(120),description:char.repeat(500),quantity:500,completion_rule:char.repeat(500),claim_note:char.repeat(500)}))};
 assert.deepEqual(actualEventInputSchema().parse(body),body);assert(Buffer.byteLength(JSON.stringify(body))>32768);
 assert.equal(actualEventInputSchema().safeParse({...body,online_url:body.online_url+char}).success,false);
});
