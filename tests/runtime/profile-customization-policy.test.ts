import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {defaultProfileLayout,ProfileLayout,ProfilePublicationInput,VisitorProfile,moveProfileBlock} from '../../packages/shared/member-profile.js';
import {ProfileLayoutEditor} from '../../apps/portal-web/src/modules/ProfileLayoutEditor.js';
import {ProfileDesign} from '../../apps/portal-web/src/modules/ProfileDesign.js';
import {PortalClient} from '../../apps/portal-web/src/api.js';
const layout=()=>structuredClone(defaultProfileLayout);
const draft=()=>({visibility:'private' as const,display_name:'本人',bio:'介紹',links:[],layout:layout(),include_cover:false,cover_version:null});
test('layout is a bounded allowlist, not CSS/HTML or an implicit private-work projection',()=>{
 for(const field of ['css','html','background_url','works','badge'])assert.equal(ProfileLayout.safeParse({...layout(),[field]:'secret'}).success,false);
 for(const field of ['theme','accent','cover_style'])assert.equal(ProfileLayout.safeParse({...layout(),[field]:'url(https://tracker.test)'}).success,false);
 for(const control of ['\u0000','\r','\t','\u007f'])assert.equal(ProfileLayout.safeParse({...layout(),about:'intro'+control}).success,false);
 assert.equal(ProfileLayout.safeParse({...layout(),about:'line one\nline two'}).success,true);
 assert.equal(ProfileLayout.safeParse({...layout(),about:'x'.repeat(1601)}).success,false);
 for(const url of ['javascript:alert(1)','https://user:pass@example.test','http://example.test','https://example.test/'+ '中'.repeat(60)])assert.equal(ProfileLayout.safeParse({...layout(),featured:[{title:'作品',description:'',url}]}).success,false);
 assert.equal(ProfileLayout.safeParse({...layout(),featured:Array(7).fill({title:'作品',description:'',url:'https://example.test'})}).success,false);
});
test('block ordering is immutable, complete and unique; boundary movement is a no-op',()=>{
 const before=layout();const after=moveProfileBlock(before,'links',-1);assert.deepEqual(after.blocks.map(b=>b.id),['about','links','featured','recognition']);assert.deepEqual(before,layout());
 assert.equal(moveProfileBlock(before,'about',-1),before);assert.equal(moveProfileBlock(before,'recognition',1),before);
 assert.equal(ProfileLayout.safeParse({...before,blocks:[before.blocks[0],...before.blocks.slice(0,3)]}).success,false);
 assert.equal(ProfileLayout.safeParse({...before,blocks:before.blocks.slice(0,3)}).success,false);
});
test('cover requires explicit independent selection and bounded version; public still requires confirmation',()=>{
 assert.equal(ProfilePublicationInput.parse(draft()).include_cover,false);
 assert.equal(ProfilePublicationInput.safeParse({...draft(),include_cover:true}).success,false);
 assert.equal(ProfilePublicationInput.safeParse({...draft(),include_cover:true,cover_version:'2'}).success,true);
 for(const version of ['0','-1','1e3','9223372036854775808','x'])assert.equal(ProfilePublicationInput.safeParse({...draft(),cover_version:version}).success,false);
 assert.equal(ProfilePublicationInput.safeParse({...draft(),visibility:'public',include_cover:true,cover_version:'2'}).success,false);
 assert.equal(ProfilePublicationInput.safeParse({...draft(),visibility:'public',include_cover:true,cover_version:'2',confirm_public:true}).success,true);
});
test('one renderer honors block order/hiding and escapes user text; anonymous has no recognition',()=>{
 const custom=layout();custom.about='<script>alert(1)</script>';custom.featured=[{title:'<img src=x>',description:'my work',url:'https://example.test/work'}];custom.blocks=moveProfileBlock(custom,'featured',-1).blocks;
 const profile=VisitorProfile.parse({display_name:'<b>literal</b>',bio:'intro',links:[],avatar_url:null,layout:custom,cover:null});
 const html=renderToStaticMarkup(createElement(ProfileDesign,{profile}));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('<img src=x>'));assert(html.indexOf('精選作品')<html.indexOf('關於我'));assert(!html.includes('稱號與社群認證'));
 custom.blocks.find(b=>b.id==='featured')!.visible=false;
 const hidden=renderToStaticMarkup(createElement(ProfileDesign,{profile:{...profile,layout:custom}}));assert.equal(hidden.split('https://example.test/work').length,1);assert(!hidden.includes('/private/'));
});
test('defaults are independent snapshots; resetting appearance never changes identity or privacy',()=>{
 const first=ProfilePublicationInput.parse({visibility:'members',display_name:'owner',bio:'intro',links:[]}),second=ProfilePublicationInput.parse({visibility:'private',display_name:'other',bio:'',links:[]});
 first.layout.blocks[0].visible=false;assert.equal(second.layout.blocks[0].visible,true);assert.equal(defaultProfileLayout.blocks[0].visible,true);
 const before={...draft(),visibility:'members' as const,layout:{...layout(),theme:'night' as const},include_cover:true,cover_version:'2'};
 const reset={...before,layout:layout(),include_cover:false,cover_version:null};assert.equal(reset.visibility,'members');assert.equal(reset.display_name,before.display_name);assert.deepEqual(before.layout.theme,'night');
});
test('closed binary client preserves MIME, CSRF, CAS and caller idempotency, rejects invalid input before fetch',async()=>{
 const original=globalThis.fetch;const requests:{url:string;init?:RequestInit}[]=[];
 globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json({version:'2',present:true});};
 try{const client=new PortalClient();client.csrfToken='synthetic-csrf';const file=new Blob(['synthetic'],{type:'image/png'});
 await client.postProfileCover(file,{ifMatch:'1',idempotencyKey:'same-cover-key'});assert.equal(requests.length,1);const request=requests[0];assert.equal(request.url,'/api/v1/me/profile-cover');assert.equal(request.init?.body,file);assert.equal(new Headers(request.init?.headers).get('Content-Type'),'image/png');assert.equal(new Headers(request.init?.headers).get('X-CSRF-Token'),'synthetic-csrf');assert.equal(new Headers(request.init?.headers).get('If-Match'),'"1"');assert.equal(new Headers(request.init?.headers).get('Idempotency-Key'),'same-cover-key');
 for(const bad of [new Blob(['svg'],{type:'image/svg+xml'}),new Blob([],{type:'image/png'}),new Blob([new Uint8Array(4194305)],{type:'image/png'})])await assert.rejects(client.postProfileCover(bad,{ifMatch:'1',idempotencyKey:'same-cover-key'}));assert.equal(requests.length,1);
 }finally{globalThis.fetch=original;}
});

test('recognition respects the same ordered hidden block and anonymous DTO rejects account enrichments',()=>{
 const custom=layout();custom.about='about marker';custom.blocks=moveProfileBlock(moveProfileBlock(moveProfileBlock(custom,'recognition',-1),'recognition',-1),'recognition',-1).blocks;
 const profile=VisitorProfile.parse({display_name:'owner',bio:'',links:[],avatar_url:null,layout:custom,cover:null});
 const recognition=createElement('span',{},'earned marker');
 const visible=renderToStaticMarkup(createElement(ProfileDesign,{profile,recognition}));assert(visible.indexOf('earned marker')<visible.indexOf('about marker'));
 custom.blocks.find(b=>b.id==='recognition')!.visible=false;
 const hidden=renderToStaticMarkup(createElement(ProfileDesign,{profile:{...profile,layout:custom},recognition}));assert(!hidden.includes('earned marker'));
 for(const key of ['community_certification','social_achievement','statement','days','peer_ids'])assert.equal(VisitorProfile.safeParse({...profile,[key]:{}}).success,false);
});


test('layout editor labels identify only their controls, hint is a description and repeated editors have unique IDs',()=>{
 const html=renderToStaticMarkup(createElement(Fragment,{},...Array.from({length:2},()=>createElement(ProfileLayoutEditor,{value:layout(),onChange:()=>{},disabled:false}))));
 const ids:string[]=[];
 for(const [label,tag] of [['重點顏色','select'],['封面圖樣','select'],['關於我','textarea']]){
  const matches=[...html.matchAll(new RegExp(`<label for="([^"]+)">${label}</label>`,'g'))];assert.equal(matches.length,2,label);
  for(const match of matches){const id=match[1];ids.push(id);assert(html.includes(`<${tag} id="${id}"`),label);}
 }
 assert.equal(new Set(ids).size,6);
 assert.equal([...html.matchAll(/role="group" aria-label="主題"/g)].length,2);
 assert.equal([...html.matchAll(/aria-pressed="true"/g)].length,2);
 assert.equal([...html.matchAll(/aria-pressed="false"/g)].length,6);
 for(const match of html.matchAll(/<textarea id="([^"]+)" aria-describedby="([^"]+)"/g)){
  assert(html.includes(`<span id="${match[2]}" class="hint">可以換行，最多 1600 字；不支援網頁程式碼。</span>`));
 }
 assert.equal([...html.matchAll(/<textarea id="[^"]+" aria-describedby="[^"]+"/g)].length,2);
 assert(!/<label[^>]*>[^<]*<(?:select|textarea)/.test(html));
 const disabled=renderToStaticMarkup(createElement(ProfileLayoutEditor,{value:layout(),onChange:()=>{},disabled:true}));assert(disabled.includes('<fieldset class="fieldset stack" disabled="">'));
});

for(const theme of ['paper','night','sage','rose'] as const)for(const disabled of [false,true])test(`theme chooser renders ${theme}, locked=${disabled}, without mutating saved content`,()=>{
 const value={...layout(),theme,about:'existing biography',featured:[{title:'retained work',description:'unchanged',url:'https://example.test/work'}]};
 const before=JSON.stringify(value);let writes=0;
 const html=renderToStaticMarkup(createElement(ProfileLayoutEditor,{value,disabled,onChange:()=>{writes++;}}));
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 assert.equal((html.match(/aria-pressed="false"/g)||[]).length,3);
 assert.match(html,new RegExp(`aria-pressed="true"[^>]*><span[^>]*data-profile-theme="${theme}"`));
 assert.equal((html.match(/type="button" class="btn btn-secondary profile-theme-choice"/g)||[]).length,4);
 for(const label of ['明亮紙頁','深夜星空','森林手帳','暖粉相簿'])assert(html.includes(label));
 assert.doesNotMatch(html,/<details open/);
 assert.match(html,/existing biography/);assert.match(html,/retained work/);
 assert.equal(html.startsWith('<fieldset class="fieldset stack" disabled=""'),disabled);
 assert.equal(JSON.stringify(value),before);assert.equal(writes,0);
});
