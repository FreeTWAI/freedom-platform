import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalClient} from '../../apps/portal-web/src/api';
import {shareModuleRetryUrl} from '../../apps/portal-web/src/share-module-loader';
import {SHARE_PLATFORMS,SHARE_IMAGE_LIMIT,SHARE_VIDEO_LIMIT,ShareMediaError,SocialShareSession,socialShareForSession,socialShareUrl,validateShareMedia} from '../../apps/portal-web/src/social-share';

const png=()=>new File([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],'原始作品.png',{type:'image/png'});
const jpeg=()=>new File([Uint8Array.from([255,216,255,224,0,0])],'作品.jpg',{type:'image/jpeg'});
const mp4=()=>new File([Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109])],'原始影片.mp4',{type:'video/mp4'});
function session(){const client=new PortalClient();client.csrfToken='test-current-session';return {client,job:socialShareForSession(client)};}
function select(job:SocialShareSession,platforms:readonly string[]){for(const platform of SHARE_PLATFORMS)if(job.snapshot().platforms.includes(platform)!==platforms.includes(platform))job.toggle(platform);}
async function fault(files:File[],code:string){await assert.rejects(()=>validateShareMedia(files),cause=>cause instanceof ShareMediaError&&cause.fault===code);}

test('module-map retry accepts only this application chunk and at most three explicit fresh keys',()=>{
  const origin='https://workshop.example.test',path='/assets/SocialCrossPlatformShare-abc123.js',error=(url:string)=>new TypeError('Failed to fetch dynamically imported module: '+url);
  assert.equal(shareModuleRetryUrl(error(origin+path),origin,1),origin+path+'?share-retry=1');assert.equal(shareModuleRetryUrl(error(origin+path+'?share-retry=1'),origin,2),origin+path+'?share-retry=2');
  for(const url of ['https://other.test'+path,origin+'/assets/OtherModule-abc123.js',origin+'/assets/SocialCrossPlatformShare-abc123.css',origin+path+'?token=private',origin+path+'#fragment','https://user:secret@workshop.example.test'+path])assert.equal(shareModuleRetryUrl(error(url),origin,1),null);
  for(const attempt of [0,4,1.5])assert.equal(shareModuleRetryUrl(error(origin+path),origin,attempt),null);
});

test('official intent URLs round-trip the same caption, including Unicode, newlines, links and query injection characters',()=>{
  const text='同一份文案\nhttps://example.test/a?b=1&next=2 #作品 + % <script>';
  for(const [platform,origin,path] of [['x','https://twitter.com','/intent/tweet'],['threads','https://www.threads.com','/intent/post']] as const){
    const url=new URL(socialShareUrl(platform,text));assert.equal(url.origin,origin);assert.equal(url.pathname,path);assert.equal(url.searchParams.get('text'),text);assert.equal(url.searchParams.size,1);
  }
  assert.equal(socialShareUrl('facebook',text),'https://www.facebook.com/');assert.equal(socialShareUrl('instagram',text),'https://www.instagram.com/');
});

test('off-by-default and disabled workflows cannot select, prepare, copy, share, open or confirm',async()=>{
  const {job}=session();let external=0;
  assert.equal(job.snapshot().enabled,false);job.toggle('x');assert.deepEqual(job.snapshot().platforms,SHARE_PLATFORMS);assert.equal(job.prepare('原稿'),false);
  await job.copy(1,async()=>{external++;});await job.shareFiles(1,'x',async()=>{external++;});assert.equal(job.opened(1,'x'),false);job.confirm(1,'x');assert.equal(external,0);
  job.enable();select(job,['x']);job.prepare('原稿');const saved=job.snapshot().prepared!;job.disable();assert.equal(job.payload(saved.id),null);assert.equal(job.opened(saved.id,'x'),false);
  await job.copy(saved.id,async()=>{external++;});assert.equal(external,0);assert.equal(job.snapshot().prepared,saved);
});

test('preparation rejects missing selection, empty content and Instagram without original media',async()=>{
  const {job}=session();job.enable();assert.deepEqual(job.snapshot().platforms,SHARE_PLATFORMS);select(job,[]);assert.equal(job.prepare('caption'),false);assert.equal(job.snapshot().fault,'platforms');job.toggle('x');assert.equal(job.prepare('  '),false);assert.equal(job.snapshot().fault,'empty');
  job.toggle('instagram');assert.equal(job.prepare('caption'),false);assert.equal(job.snapshot().fault,'instagram-media');await job.addFiles([png()]);assert.equal(job.prepare('caption'),true);
});

test('validated original JPEG, PNG and MP4 use only bounded header reads',async()=>{
  await validateShareMedia([png(),jpeg()]);await validateShareMedia([mp4()]);let read:number[]=[];
  const file=png(),slice=file.slice.bind(file);file.slice=(start,end)=>{read.push(end!);return slice(start,end);};await validateShareMedia([file]);assert.deepEqual(read,[16]);
});

test('wrong type, forged signature, zero size, excess count and mixed media are rejected',async()=>{
  await fault([new File(['hello'],'x.webp',{type:'image/webp'})],'type');await fault([new File(['not a PNG'],'x.png',{type:'image/png'})],'signature');
  await fault([new File([],'x.png',{type:'image/png'})],'size');await fault([png(),png(),png(),png(),png()],'count');await fault([mp4(),mp4()],'count');await fault([png(),mp4()],'mixed');
});

test('image and video size boundaries reject before reading any body',async()=>{
  for(const [type,limit] of [['image/png',SHARE_IMAGE_LIMIT],['video/mp4',SHARE_VIDEO_LIMIT]] as const){
    let reads=0;const file={type,size:limit+1,slice(){reads++;throw Error('must not read oversized file');}} as unknown as File;
    await fault([file],'size');assert.equal(reads,0);
  }
});

test('invalid newly added media preserves existing files and prepared work',async()=>{
  const {job}=session(),image=png();job.enable();select(job,['instagram']);await job.addFiles([image]);job.prepare('original');const saved=job.snapshot().prepared;
  await job.addFiles([new File(['forged'],'bad.png',{type:'image/png'})]);assert.equal(job.snapshot().fault,'signature');assert.deepEqual(job.snapshot().files,[image]);assert.equal(job.snapshot().prepared,saved);
});

test('snapshot remains the prepared caption, media and selection; changed input needs an explicit new preparation',async()=>{
  const {job}=session(),image=png();job.enable();select(job,['x','threads']);await job.addFiles([image]);job.prepare(' A ');const saved=job.snapshot().prepared!;
  job.confirm(saved.id,'x');job.toggle('facebook');job.removeFile(0);assert.equal(job.changed('B'),true);assert.equal(saved.text,'A');assert.deepEqual(saved.files,[image]);assert.deepEqual(saved.platforms,['x','threads']);
  assert.equal(job.prepare('B'),true);const next=job.snapshot().prepared!;assert.notEqual(next.id,saved.id);assert.equal(next.text,'B');assert.deepEqual(next.files,[]);assert.deepEqual(next.platforms,['x','facebook','threads']);assert.equal(job.snapshot().progress.x?.confirmedAt,null);assert.equal(job.payload(saved.id),null);
});

test('an open request or successful OS handoff never counts as published or self-confirmed',async()=>{
  const {job}=session();job.enable();select(job,['x','threads']);await job.addFiles([png()]);job.prepare('shared copy');const id=job.snapshot().prepared!.id;
  assert.equal(job.opened(id,'x'),true);assert.equal(job.snapshot().progress.x?.confirmedAt,null);let invoked=false;
  const pending=job.shareFiles(id,'x',async data=>{invoked=true;assert.equal(data.files!.length,1);assert.equal(data.text,undefined);});assert.equal(invoked,true,'share is invoked inside the click call stack');await pending;
  assert.equal(job.snapshot().progress.x?.deviceShared,true);assert.equal(job.snapshot().progress.x?.confirmedAt,null);assert.equal(job.snapshot().feedback,'device-share');
  job.confirm(id,'x');assert.equal(typeof job.snapshot().progress.x?.confirmedAt,'number');assert.equal(job.snapshot().active,'threads');assert.equal(job.snapshot().progress.threads?.confirmedAt,null);
});

test('OS cancellation and clipboard denial retain the exact snapshot and unconfirmed progress',async()=>{
  const {job}=session();job.enable();select(job,['instagram']);await job.addFiles([png()]);job.prepare('copy');const saved=job.snapshot().prepared!;
  await job.shareFiles(saved.id,'instagram',async()=>{throw new DOMException('cancelled','AbortError');});assert.equal(job.snapshot().fault,'share-cancel');assert.equal(job.snapshot().prepared,saved);assert.equal(job.snapshot().progress.instagram?.confirmedAt,null);
  await job.copy(saved.id,async()=>{throw new DOMException('denied','NotAllowedError');});assert.equal(job.snapshot().fault,'clipboard');assert.equal(job.snapshot().prepared,saved);
  let copied='';await job.copy(saved.id,async text=>{copied=text;});assert.equal(copied,'copy');assert.equal(job.snapshot().feedback,'copied');
});

test('same-login remounts recover in memory; another login receives an empty opt-in session',async()=>{
  const {client,job}=session();job.enable();select(job,['instagram']);await job.addFiles([png()]);job.prepare('private draft');assert.equal(socialShareForSession(client),job);
  client.csrfToken=null;client.csrfToken='different-login';const next=socialShareForSession(client);assert.notEqual(next,job);assert.equal(next.snapshot().enabled,false);assert.deepEqual(next.snapshot().files,[]);assert.equal(next.snapshot().prepared,null);
  let calls=0;await job.copy(1,async()=>{calls++;});assert.equal(calls,0);assert.equal(job.snapshot().fault,'session');assert.equal(job.snapshot().prepared,null);
});

test('late async completion after logout cannot revive a previous member draft or progress',async()=>{
  const {client,job}=session();job.enable();select(job,['x']);job.prepare('private copy');let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});const pending=job.copy(1,()=>gate);
  assert.equal(job.snapshot().busy,'clipboard');client.csrfToken=null;release();await pending;assert.equal(job.snapshot().enabled,false);assert.equal(job.snapshot().prepared,null);assert.equal(job.snapshot().fault,'session');
});

test('disabling while media validation is pending cancels its late state change',async()=>{
  const {job}=session();job.enable();let release=(_:ArrayBuffer)=>{};const header=new Promise<ArrayBuffer>(resolve=>{release=resolve});const file=png();file.slice=()=>({arrayBuffer:()=>header}) as Blob;
  const pending=job.addFiles([file]);assert.equal(job.snapshot().busy,'files');job.disable();release(Uint8Array.from([137,80,78,71,13,10,26,10]).buffer);await pending;
  assert.equal(job.snapshot().enabled,false);assert.deepEqual(job.snapshot().files,[]);assert.equal(job.snapshot().feedback,'disabled');
});

test('disabled share invalidates pending results, retains the draft, and stale platform steps cannot run',async()=>{
  const {job}=session();job.enable();select(job,['x']);await job.addFiles([png()]);job.prepare('copy');const saved=job.snapshot().prepared!;let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  const pending=job.shareFiles(saved.id,'x',()=>gate);job.disable();release();await pending;assert.equal(job.snapshot().progress.x?.deviceShared,false);assert.equal(job.snapshot().prepared,saved);
  job.enable();assert.equal(job.opened(saved.id,'facebook'),false);job.confirm(saved.id,'facebook');assert.equal(job.snapshot().progress.facebook,undefined);
});

// Execute the shipped composer closures and JSX with controlled hooks/promises.
// This tier needs neither a database nor a browser; layout/focus are E2E concerns.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {ApiError} from '../../apps/portal-web/src/api';
import {normalizeShareUrl,isOwnWorkshopHost} from '../../packages/shared/share-url';
import {newTextHistory,recordText} from '../../apps/portal-web/src/modules/text-edit-history';
const composerSource=readFileSync(new URL('../../apps/portal-web/src/modules/SocialZone.tsx',import.meta.url),'utf8');
const composerCode=transformSync(composerSource,{loader:'tsx',target:'es2023',format:'esm'}).code;
function composerFunction(name:string){
  const start=new RegExp(`^( *)(?:async )?function ${name}\\(`,'m').exec(composerCode);assert.ok(start,name);
  const tail=composerCode.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,name);
  return tail.slice(0,end.index+end[0].length);
}
const plain=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
function composerHarness(){
  const calls:{path:string;method:string;body:any;key:string;resolve:(value:any)=>void;reject:(error:unknown)=>void}[]=[];
  const enqueue=(path:string,method:string,body:any,key:string)=>new Promise((resolve,reject)=>calls.push({path,method,body,key,resolve,reject}));
  const state:any={text:'一起分享 https://example.com/read',url:'https://example.com/read',title:'參考資料',topic:'mood',locationName:'',checkIn:false,mentions:[],composeFile:null,preparingImage:false,linkPreview:false,
    pending:{current:null},publishLock:{current:null},selection:{current:{platform:'note',tag:'',version:1}},composerVersion:{current:1},newPosts:{current:[]},importedGame:{current:null},directPost:null,items:[],closed:0,publishError:'',notice:'',imageReads:0,
    crypto:{randomUUID},ApiError,normalizeShareUrl,isOwnWorkshopHost,location:{origin:'https://workshop.example.test'},newTextHistory,
    composerText:(key:string)=>key,composerMessages:new Proxy({},{get:(_,key)=>[key]}),document:{getElementById:()=>null},sessionStorage:{},clearGameDraft:()=>{},
    setPublishing:(value:boolean)=>{state.publishing=value;},setPublishError:(value:string)=>{state.publishError=value;},setNotice:(value:string)=>{state.notice=value;},
    setItems:(value:any)=>{state.items=typeof value==='function'?value(state.items):value;},setCursor:()=>{},selectPlatform:(value:string)=>{state.selection.current.platform=value;},clearDirectPost:()=>{state.directPost=null;},
    setTextHistory:(value:any)=>{state.text=value.value;},setText:(value:string,kind:string)=>{state.text=value;state.lastTextKind=kind;},setMentions:(value:any)=>{state.mentions=value;},setLocationName:(value:string)=>{state.locationName=value;},setCheckIn:(value:boolean)=>{state.checkIn=value;},
    selectComposeImage:async()=>{state.composeFile=null;},setOriginalDraft:()=>{},setUrl:(value:string)=>{state.url=value;},setTitle:(value:string)=>{state.title=value;},setLinkPreview:(value:boolean)=>{state.linkPreview=value;},closeComposer:()=>{state.closed++;},
    composeImage:async(file:File)=>{state.imageReads++;return {mime_type:file.type,data_base64:'cHJlcGFyZWQ='};},
    client:{sessionGeneration:1,csrfToken:'fixture-csrf',post:(path:string,body:unknown,options:{idempotencyKey:string})=>enqueue(path,'POST',plain(body),options.idempotencyKey)},
    accessAwareFetch:(path:string,init:RequestInit)=>enqueue(path,init.method!,init.method==='POST'?JSON.parse(init.body as string):init.body,(init.headers as Record<string,string>)['Idempotency-Key']),
  };
  state.currentClient={current:state.client};
  for(const name of ['toggleLinkPreview','insertRetainedLink','removeRetainedLink','finishPublication','publishLink','publish'])state[name]=runInNewContext(`${composerFunction(name)};${name}`,state);
  const submit=()=>state.publish({preventDefault(){}}) as Promise<void>;
  const ack=(kind:'note'|'link'='link')=>({post_id:'10000000-0000-4000-8000-000000000001',kind,url:kind==='link'?normalizeShareUrl(state.url).ok?state.url:null:null,platform:'other',title:state.title,note:state.text,created_at:'2026-10-25T06:00:00Z',mine:true,author:{display_name:'Fixture',user_id:'author',avatar_url:null},thumbnail_url:null,tags:[]});
  const response=(body:any,status=201)=>({ok:status>=200&&status<300,status,json:async()=>body});
  return {state,calls,submit,ack,response};
}
const microtasks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('composer default publishes URL text, 2,000-character content and metadata through the unchanged native command only',async()=>{
  const h=composerHarness();h.state.text=('文'.repeat(1900)+' https://example.com/read @夥伴 #作品').padEnd(2000,'文');h.state.topic='work';h.state.checkIn=true;h.state.locationName='線上';h.state.mentions=[{user_id:'peer',display_name:'夥伴'}];h.state.composeFile=png();
  const sent=h.submit();await microtasks();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/social-posts/notes');
  assert.deepEqual(h.calls[0].body,{text:h.state.text,topic:'work',location_name:'線上',mention_ids:['peer'],image:{mime_type:'image/png',data_base64:'cHJlcGFyZWQ='}});
  h.calls[0].resolve(h.ack('note'));await sent;assert.equal(h.state.closed,1);assert.equal(h.state.pending.current,null);
});

test('preview opt-in and opt-out preserve every draft field/photo and never fetch or publish',()=>{
  const h=composerHarness(),photo=png();Object.assign(h.state,{composeFile:photo,text:'長'.repeat(900)+' https://example.com/read',url:'',topic:'work',mentions:[{user_id:'peer',display_name:'同伴'}],checkIn:true,locationName:'台北'});
  h.state.toggleLinkPreview(true);assert.equal(h.state.url,'https://example.com/read');h.state.toggleLinkPreview(false);
  assert.equal(h.calls.length,0);assert.equal(h.state.text.length,925);assert.equal(h.state.composeFile,photo);assert.equal(h.state.topic,'work');assert.equal(h.state.mentions.length,1);assert.equal(h.state.locationName,'台北');
});

for(const draft of [{text:'文'.repeat(501)},{topic:'work'},{topic:'event'},{mentions:[{user_id:'peer',display_name:'人'}]},{checkIn:true},{locationName:'台北'},{text:'網址 #標籤'}])test(`preview rejects incompatible metadata without truncation: ${Object.keys(draft)[0]} ${JSON.stringify(draft).slice(0,45)}`,async()=>{
  const h=composerHarness();Object.assign(h.state,draft,{linkPreview:true,composeFile:png()});const before=h.state.text,photo=h.state.composeFile;
  await h.submit();assert.equal(h.calls.length,0);assert.equal(h.state.publishError,'previewIncompatible');assert.equal(h.state.text,before);assert.equal(h.state.composeFile,photo);assert.equal(h.state.pending.current,null);
});

for(const url of ['javascript:alert(1)','data:text/html,bad','file:///tmp/a','http://example.com/a','https://127.0.0.1/a','https://user:secret@example.com/a','https://freetwai.com/absurd-daily/x','https://workshop.example.test/a'])test(`preview rejects unsafe or own-host URL before any network request: ${url.split(':')[0]}`,async()=>{
  const h=composerHarness();h.state.linkPreview=true;h.state.url=url;await h.submit();assert.equal(h.calls.length,0);assert.equal(h.state.publishError,'previewUrlInvalid');assert.equal(h.state.text,'一起分享 https://example.com/read');
});

test('explicit preview publish uses the existing link contract once and does not open public-sharing or promotion APIs',async()=>{
  const h=composerHarness();h.state.linkPreview=true;const sent=h.submit();await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/v1/social-posts');assert.deepEqual(h.calls[0].body,{url:h.state.url,title:h.state.title,note:h.state.text});
  h.calls[0].resolve(h.response(h.ack()));await sent;assert.equal(h.calls.length,1);assert.equal(h.state.closed,1);assert.equal(h.state.items.length,1);
});

for(const mode of ['native','preview'] as const)test(`${mode} lost acknowledgement and later definite refusal retain the frozen body and key`,async()=>{
  const h=composerHarness();h.state.linkPreview=mode==='preview';h.state.composeFile=mode==='native'?png():null;
  const sent=h.submit();await microtasks();h.calls[0].reject(new ApiError({message:'lost',network:true}));await sent;
  const key=h.calls[0].key,body=h.calls[0].body;Object.assign(h.state,{text:'later text',url:'https://different.example.com',title:'different',composeFile:null});
  const retry=h.submit();await microtasks();assert.equal(h.calls[1].key,key);assert.deepEqual(h.calls[1].body,body);
  if(mode==='native')h.calls[1].reject(new ApiError({message:'refused retry',status:400}));else h.calls[1].resolve(h.response({detail:'refused retry'},400));await retry;
  assert.ok(h.state.pending.current);const again=h.submit();await microtasks();assert.equal(h.calls[2].key,key);assert.deepEqual(h.calls[2].body,body);
  const ack={...h.ack(mode==='native'?'note':'link'),url:mode==='native'?null:body.url,title:body.title??h.state.title,note:body.note??body.text};
  h.calls[2].resolve(mode==='native'?ack:h.response(ack));await again;assert.equal(h.state.pending.current,null);assert.equal(h.state.imageReads,mode==='native'?1:0);
});

test('malformed preview ACK stays unknown; explicit retry keeps its original command',async()=>{
  const h=composerHarness();h.state.linkPreview=true;const sent=h.submit();h.calls[0].resolve(h.response({}));await sent;assert.equal(h.state.publishError,'uncertain');
  const retry=h.submit();assert.equal(h.calls[1].key,h.calls[0].key);h.calls[1].resolve(h.response(h.ack()));await retry;assert.equal(h.state.items.length,1);
});

test('preview deduplication preserves the draft and never uploads its photo to the existing post',async()=>{
  const h=composerHarness();h.state.linkPreview=true;h.state.composeFile=png();const original=h.state.text,sent=h.submit();
  h.calls[0].resolve(h.response({code:'social_post_exists',post_id:h.ack().post_id},409));await sent;
  assert.equal(h.calls.length,1);assert.equal(h.state.text,original);assert.ok(h.state.composeFile);assert.equal(h.state.publishError,'duplicate');assert.equal(h.state.pending.current,null);
});

test('acknowledged preview with failed thumbnail retries only the same image PUT and key, never republishes',async()=>{
  const h=composerHarness();h.state.linkPreview=true;const photo=png();h.state.composeFile=photo;const sent=h.submit();h.calls[0].resolve(h.response(h.ack()));await microtasks();
  assert.equal(h.calls[1].method,'PUT');assert.equal(h.calls[1].body,photo);h.calls[1].reject(Error('lost image ACK'));await sent;
  assert.equal(h.state.publishError,'thumbnailPending');assert.equal(h.state.closed,0);assert.ok(h.state.pending.current.created);
  const retry=h.submit();await h.submit();assert.equal(h.calls.length,3);assert.equal(h.calls[2].path,h.calls[1].path);assert.equal(h.calls[2].key,h.calls[1].key);assert.equal(h.calls[2].body,photo);
  h.calls[2].resolve(h.response({...h.ack(),thumbnail_url:'/api/v1/social-posts/fixture/thumbnail'},200));await retry;
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.state.closed,1);assert.equal(h.state.pending.current,null);
});

for(const stage of ['post-fetch','post-json','thumbnail-fetch','thumbnail-json'] as const)test(`preview ignores an old session after ${stage}`,async()=>{
  const h=composerHarness();h.state.linkPreview=true;h.state.composeFile=png();const sent=h.submit();let release!:(value:any)=>void;
  if(stage.startsWith('thumbnail')){h.calls[0].resolve(h.response(h.ack()));await microtasks();}
  const call=h.calls.at(-1)!;
  if(stage.endsWith('json')){call.resolve({ok:true,status:201,json:()=>new Promise(resolve=>{release=resolve;})});await microtasks();}
  const before=h.calls.length;h.state.client.sessionGeneration++;h.state.text='new session draft';
  if(stage.endsWith('json'))release(h.ack());else call.resolve(h.response(h.ack()));await sent;
  assert.equal(h.calls.length,before);assert.equal(h.state.text,'new session draft');assert.equal(h.state.closed,0);assert.equal(h.state.items.length,0);assert.equal(h.state.notice,'');
});

test('closing and reopening while preview publishes does not close the newly opened editor',async()=>{
  const h=composerHarness();h.state.linkPreview=true;const sent=h.submit();h.state.composerVersion.current+=2;h.calls[0].resolve(h.response(h.ack()));await sent;
  assert.equal(h.state.closed,0);assert.equal(h.state.items.length,1);
});

test('actual composer JSX has one entry and one publish action; optional preview shares text and survives closing',async()=>{
  const values:any[]=[],refs:any[]=[];let cursor=0,refCursor=0,fetches=0;
  const element=(type:any,props:any,...children:any[])=>({type,props:{...props,children}});
  const React={createElement:element,Component:class{},lazy:()=>()=>null,Suspense:'suspense',useState:(initial:any)=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],(value:any)=>{values[i]=typeof value==='function'?value(values[i]):value;}];},useRef:(value:any)=>refs[refCursor++]??(refs[refCursor-1]={current:value}),useEffect:()=>{},useCallback:(fn:any)=>fn,useId:()=> 'composer',useSyncExternalStore:(_:any,snapshot:any)=>snapshot()};
  const context:any={React,module:{exports:{}},window:{location:{hash:'#social',search:''}},location:{origin:'https://workshop.example.test'},URL,URLSearchParams,crypto:{randomUUID},require(name:string){
    if(name==='react')return React;if(name.endsWith('.css'))return {};if(name==='../language')return {useLanguage:()=>({language:'zh-Hant'})};
    if(name.includes('social-post-task'))return {socialPostJobForSession:()=>({subscribe:()=>{},snapshot:()=>({phase:'idle'})})};
    if(name.includes('text-edit-history'))return {newTextHistory,recordText};if(name.includes('GameDraftInbox'))return {useGameDraftInbox:()=>({draft:null})};
    if(name==='./SocialTools')return {SOCIAL_TOPICS:{mood:'近況',event:'活動',work:'作品'}};if(name.includes('share-url'))return {PLATFORM_LABELS:{},normalizeShareUrl,isOwnWorkshopHost};
    if(name==='./social-image')return {prepareSocialImage:async(file:File)=>file};
    if(name.includes('access-fetch'))return {accessAwareFetch:()=>{fetches++;throw Error('unexpected fetch');}};
    return new Proxy({},{get:()=>()=>null});
  }};context.exports=context.module.exports;
  runInNewContext(transformSync(composerSource,{loader:'tsx',target:'es2023',format:'cjs'}).code,context);
  const render=()=>{cursor=refCursor=0;return context.module.exports.SocialZone({client:{sessionGeneration:1},viewer:{name:'Fixture'}});};
  const nodes=(tree:any):any[]=>tree==null?[]:Array.isArray(tree)?tree.flatMap(nodes):typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
  let all=nodes(render());const opener=all.find(node=>node.type==='button'&&node.props['aria-label']==='建立貼文');assert.ok(opener);
  assert.equal(all.filter(node=>node.type==='button'&&JSON.stringify(node.props.children).includes('分享外部連結')).length,0);
  opener.props.onClick();all=nodes(render());assert.equal(all.filter(node=>node.type==='form').length,1);
  let textarea=all.find(node=>node.type==='textarea');assert.equal(textarea.props.maxLength,2000);
  textarea.props.onChange({target:{value:'正文 https://example.com/read'},nativeEvent:{inputType:'insertFromPaste'}});all=nodes(render());
  all.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});all=nodes(render());
  assert.equal(all.filter(node=>node.type==='textarea').length,1);assert.equal(all.find(node=>node.type==='input'&&node.props.type==='url').props.value,'https://example.com/read');
  assert.equal(all.filter(node=>node.type==='button'&&node.props.className==='btn btn-primary').length,1);assert.equal(fetches,0);
  all.find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[png()]}});await microtasks();all=nodes(render());
  assert.equal(all.find(node=>node.type==='small').props.children[0],'貼文限社群會員，連結縮圖公開');
  all.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:false}});all=nodes(render());
  assert.equal(all.find(node=>node.type==='small').props.children[0],'社群會員可見');
  all.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});all=nodes(render());
  all.find(node=>node.type==='button'&&node.props['aria-label']==='關閉發文').props.onClick();opener.props.onClick();all=nodes(render());
  textarea=all.find(node=>node.type==='textarea');assert.equal(textarea.props.value,'正文 https://example.com/read');assert.equal(all.find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,true);assert.equal(fetches,0);
});

for(const stage of ['native-image','native-post','post-fetch','post-json','thumbnail-fetch','thumbnail-json'] as const)test(`same-generation replacement client fences ${stage} before passive effects`,async()=>{
  const h=composerHarness();h.state.linkPreview=!stage.startsWith('native');h.state.composeFile=png();let release!:(value:any)=>void;
  if(stage==='native-image')h.state.composeImage=()=>new Promise(resolve=>{release=resolve;});
  const sent=h.submit();await microtasks();
  if(stage.startsWith('thumbnail')){h.calls[0].resolve(h.response(h.ack()));await microtasks();}
  const call=h.calls.at(-1);
  if(stage.endsWith('json')){call!.resolve({ok:true,status:201,json:()=>new Promise(resolve=>{release=resolve;})});await microtasks();}
  // Render-time identity changes before any effect cleanup, with equal counters.
  h.state.currentClient.current={sessionGeneration:h.state.client.sessionGeneration};h.state.text='new member private draft';
  const count=h.calls.length;
  if(stage==='native-image')release({mime_type:'image/png',data_base64:'old-private-image'});
  else if(stage.endsWith('json'))release(h.ack());
  else call!.resolve(stage==='native-post'?h.ack('note'):h.response(h.ack()));
  await sent;assert.equal(h.calls.length,count);assert.equal(h.state.text,'new member private draft');assert.equal(h.state.items.length,0);assert.equal(h.state.closed,0);assert.equal(h.state.notice,'');
});

test('a replaced publish lock prevents old errors/finally from clearing a newer operation',async()=>{
  const h=composerHarness();h.state.linkPreview=true;const sent=h.submit(),nextLock={};h.state.publishLock.current=nextLock;h.state.publishError='new result';
  h.calls[0].reject(Error('late old failure'));await sent;assert.equal(h.state.publishLock.current,nextLock);assert.equal(h.state.publishError,'new result');assert.equal(h.state.publishing,true);
});

test('shared photo preparation rejects the former client before effects even with the same generation',async()=>{
  const h=composerHarness();let release!:(value:any)=>void;
  Object.assign(h.state,{imageSequence:{current:0},composeInput:{current:null},prepareSocialImage:()=>new Promise(resolve=>{release=resolve;}),setPreparingImage:(value:boolean)=>{h.state.preparingImage=value;},setComposeFile:(value:File)=>{h.state.composeFile=value;}});
  const select=runInNewContext(`${composerFunction('selectComposeImage')};selectComposeImage`,h.state),original=png(),next=jpeg();h.state.composeFile=original;
  const pending=select(next);h.state.currentClient.current={sessionGeneration:1};release(next);await pending;assert.equal(h.state.composeFile,original);assert.equal(h.state.publishError,'');
});

for(const mode of ['native-unknown','link-unknown','thumbnail','duplicate'] as const)test(`${mode} feedback follows a language change without changing the pending command`,async()=>{
  const start=composerCode.indexOf('const composerMessages ='),end=composerCode.indexOf('const optimizerPanelLoader =');assert.ok(start>=0&&end>start);
  const declarations=composerCode.slice(start,end);
  const messages=runInNewContext(`${declarations};composerMessages`);
  const from=composerCode.indexOf('  const composerText ='),to=composerCode.indexOf('  const historyText =',from);assert.ok(from>=0&&to>from);
  const context:any={language:'en'};
  const feedback=runInNewContext(`${declarations}\n${composerCode.slice(from,to)};composerFeedback`,context);
  const h=composerHarness();h.state.composerMessages=messages;h.state.linkPreview=mode!=='native-unknown';if(mode==='thumbnail')h.state.composeFile=png();
  const sent=h.submit();await microtasks();
  if(mode==='thumbnail'){h.calls[0].resolve(h.response(h.ack()));await microtasks();h.calls[1].reject(Error('lost image'));}
  else if(mode==='duplicate')h.calls[0].resolve(h.response({code:'social_post_exists',post_id:h.ack().post_id},409));
  else h.calls[0].reject(new ApiError({message:'network detail',network:true}));
  await sent;const command=h.state.pending.current,key=mode==='thumbnail'?'thumbnailPending':mode==='duplicate'?'duplicate':'uncertain';
  assert.equal(feedback(h.state.publishError),messages[key][1]);context.language='zh-Hant';assert.equal(feedback(h.state.publishError),messages[key][0]);context.language='ja';assert.equal(feedback(h.state.publishError),messages[key][2]);
  assert.equal(h.state.pending.current,command);assert.equal(feedback('specific server validation'),'specific server validation');
});

test('turning preview off never silently drops a URL held outside the text; explicit insert preserves history and metadata',async()=>{
  const h=composerHarness(),photo=png();Object.assign(h.state,{text:'保留正文  ',composeFile:photo,topic:'work',locationName:'線上',mentions:[{user_id:'peer',display_name:'人'}]});
  await h.submit();assert.equal(h.calls.length,0);assert.equal(h.state.publishError,'retainedLink');assert.equal(h.state.text,'保留正文  ');
  h.state.insertRetainedLink();assert.equal(h.state.text,'保留正文  \nhttps://example.com/read');assert.equal(h.state.lastTextKind,'replace');assert.equal(h.state.composeFile,photo);assert.equal(h.state.topic,'work');assert.equal(h.state.locationName,'線上');assert.equal(h.state.mentions.length,1);assert.equal(h.calls.length,0);
});

test('retained-link insertion refuses overflow; explicit remove only clears the URL/title, with both actions locked while pending',()=>{
  const h=composerHarness(),photo=png();Object.assign(h.state,{text:'長'.repeat(2000),composeFile:photo,topic:'event'});h.state.insertRetainedLink();assert.equal(h.state.text.length,2000);assert.equal(h.state.publishError,'linkTooLong');
  const url=h.state.url,title=h.state.title;h.state.pending.current={kind:'link'};h.state.insertRetainedLink();h.state.removeRetainedLink();h.state.toggleLinkPreview(true);assert.equal(h.state.url,url);assert.equal(h.state.title,title);assert.equal(h.state.linkPreview,false);
  h.state.pending.current=null;h.state.publishLock.current={};h.state.removeRetainedLink();assert.equal(h.state.url,url);h.state.publishLock.current=null;
  h.state.removeRetainedLink();assert.equal(h.state.url,'');assert.equal(h.state.title,'');assert.equal(h.state.text.length,2000);assert.equal(h.state.composeFile,photo);assert.equal(h.state.topic,'event');assert.equal(h.calls.length,0);
});

test('preview with a missing session reports a recoverable error before any request',async()=>{
  const h=composerHarness();h.state.linkPreview=true;h.state.client.csrfToken=null;await h.submit();assert.equal(h.calls.length,0);assert.equal(h.state.publishError,'sessionChanged');assert.equal(h.state.pending.current,null);
});

test('ordinary text-only publication keeps the native payload and never requests a preview',async()=>{
  const h=composerHarness();h.state.text='普通貼文';h.state.url='';const sent=h.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/social-posts/notes');assert.deepEqual(h.calls[0].body,{text:'普通貼文',topic:'mood',mention_ids:[]});h.calls[0].resolve(h.ack('note'));await sent;assert.equal(h.state.closed,1);
});

test('obsolete composer handlers cannot change mode, insert/remove a URL or publish for a replacement client',async()=>{
  const h=composerHarness();h.state.currentClient.current={sessionGeneration:1};h.state.text='new private draft';h.state.publishError='new feedback';
  h.state.toggleLinkPreview(true);h.state.insertRetainedLink();h.state.removeRetainedLink();await h.submit();assert.equal(h.state.linkPreview,false);assert.equal(h.state.url,'https://example.com/read');assert.equal(h.state.text,'new private draft');assert.equal(h.state.publishError,'new feedback');assert.equal(h.calls.length,0);
});

// Execute the real TSX load callback and the alert's actual onClick expression, not a model of pagination.
function feedHarness() {
  const start=composerCode.indexOf('  const load = useCallback('),end=composerCode.indexOf('  function retryFeed()',start);
  assert.ok(start>=0&&end>start);
  const retryMarkup=composerSource.match(/<button\b[^>]*onClick=\{([^}]+)\}>重試<\/button>/);
  assert.ok(retryMarkup,'feed error retry remains wired');
  const calls:{path:string;resolve:(value:any)=>void;reject:(error:unknown)=>void}[]=[];
  const writes:{path:string;method:string;resolve:(value:any)=>void;reject:(error:unknown)=>void}[]=[];
  const state:any={items:[],cursor:null,error:'',loading:false,more:false,canHide:false,loadSequence:{current:0},pendingFeedLoad:{current:false},activeFeedLoad:{current:null},failedFeedLoad:{current:null},focusing:{current:null},newPosts:{current:[]},feedScope:{current:null},currentClient:{current:null},URLSearchParams,Error,useCallback:(fn:any)=>fn};
  for(const [setter,key] of [['setLoading','loading'],['setMore','more'],['setError','error'],['setCursor','cursor'],['setCanHide','canHide'],['setItems','items']])state[setter]=(value:any)=>{state[key]=typeof value==='function'?value(state[key]):value;};
  state.crypto={randomUUID};state.ApiError=ApiError;state.refreshSequence={current:0};state.saving=false;state.actionError='';
  state.selection={current:{platform:'note',tag:'',version:0}};state.URL=URL;state.window={location:{href:'https://workshop.example.test/?social-post=post-2#social'},history:{replaceState:()=>{}}};state.setTag=(value:string)=>{state.tag=value;};state.setDirectPost=(value:string|null)=>{state.directPost=value;};
  state.setSaving=(value:boolean)=>{state.saving=value;};state.setActionError=(value:string)=>{state.actionError=value;};state.setNotice=(value:string)=>{state.notice=value;};
  state.prepareSocialImage=async(file:File)=>{if(state.prepareFailure)throw new Error('prepare failed');return file;};
  state.accessAwareFetch=(path:string,init:RequestInit)=>new Promise((resolve,reject)=>writes.push({path,method:init.method!,resolve,reject}));
  const client={sessionGeneration:1,csrfToken:'fixture-csrf',get:(path:string)=>new Promise((resolve,reject)=>calls.push({path,resolve,reject})),post:(path:string)=>new Promise((resolve,reject)=>writes.push({path,method:'POST',resolve,reject}))};
  const actionRetry=composerSource.match(/onClick=\{([^}]+)\}>重新載入貼文狀態/)?.[1]??retryMarkup[1];
  const actionFunction=composerSource.includes('function refreshAfterAction()')?composerFunction('refreshAfterAction'):'';
  const make=runInNewContext(`(function(client,feedSession,tag,directPost,platform){${composerCode.slice(start,end)}\n${composerFunction('retryFeed')}\n${composerFunction('uploadLinkThumb')}\n${composerFunction('hide')}\n${composerFunction('clearDirectPost')}\n${composerFunction('selectTag')}\n${actionFunction}\nreturn {load,retry:${retryMarkup[1]},recoverAction:${actionRetry},uploadLinkThumb,hide,selectTag};})`,state);
  const render=(patch:Record<string,unknown>={})=>{
    state.feedScope.current={client,session:client.sessionGeneration,platform:'note',tag:'',directPost:null,...state.feedScope.current,...patch};
    const scope=state.feedScope.current;state.currentClient.current=scope.client;state.selection.current={...state.selection.current,platform:scope.platform,tag:scope.tag};
    return make(scope.client,scope.session,scope.tag,scope.directPost,scope.platform) as {load:(platform:string,cursor?:string)=>Promise<void>;retry:()=>void;recoverAction:()=>void;uploadLinkThumb:(post:any,file:File)=>Promise<void>;hide:(post:any)=>Promise<void>;selectTag:(next:string)=>void};
  };
  const page=(ids:string[],cursor:string|null='B')=>({items:ids.map(post_id=>({post_id,kind:'note',tags:[]})),next_cursor:cursor,can_hide:false});
  return {state,client,calls,writes,render,page,ui:render()};
}

test('feed JSX retry keeps failed cursor and loaded cards through repeated failures, then appends deduplicated IDs',async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const next=h.ui.load('note','B');h.calls[1].reject(new Error('offline'));await next;
  assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['A']);assert.equal(h.state.cursor,'B');
  h.ui.retry();h.ui.retry();assert.equal(h.calls.length,3);assert.equal(h.state.more,true);assert.equal(h.state.loading,false);
  assert.equal(h.calls[2].path,'/social-posts?kind=note&cursor=B');h.calls[2].reject(new Error('still offline'));await microtasks();
  h.ui.retry();assert.equal(h.calls[3].path,h.calls[2].path);h.calls[3].resolve(h.page(['A','B'],'C'));await microtasks();
  assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['A','B']);assert.equal(h.state.cursor,'C');assert.equal(h.state.error,'');assert.equal(h.state.failedFeedLoad.current,null);assert.equal(h.state.more,false);
});

test('feed initial retry coalesces, while explicit refresh supersedes retry and intentionally replaces the first page',async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].reject(new Error('offline'));await first;
  h.ui.retry();h.ui.retry();assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/social-posts?kind=note');
  const fresh=h.ui.load('note');assert.equal(h.calls.length,3);h.calls[1].reject(new Error('obsolete'));await microtasks();assert.equal(h.state.loading,true);assert.equal(h.state.error,'');
  h.calls[2].resolve(h.page(['fresh']));await fresh;assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['fresh']);
  const more=h.ui.load('note','B');h.calls[3].reject(new Error('offline'));await more;h.ui.retry();
  const reset=h.ui.load('note');assert.equal(h.calls[5].path,'/social-posts?kind=note');h.calls[5].resolve(h.page(['reset'],null));await reset;
  h.calls[4].resolve(h.page(['obsolete-page'],'C'));await microtasks();assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['reset']);assert.equal(h.state.cursor,null);
});

for(const scope of [{platform:''},{tag:'work'},{directPost:'post-2'},{session:2},{replaceClient:true}])test(`feed retry cannot cross a newer scope or let its delayed result/finally overwrite it: ${JSON.stringify(scope)}`,async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].reject(new Error('offline'));await first;h.ui.retry();assert.equal(h.calls.length,2);
  const patch:any={...scope};if(patch.replaceClient){delete patch.replaceClient;patch.client={sessionGeneration:1,get:h.client.get};}
  if(patch.session)h.client.sessionGeneration=patch.session;
  const newer=h.render(patch),platform=h.state.feedScope.current.platform;
  const count=h.calls.length;h.ui.retry();await h.ui.load('note','B');assert.equal(h.calls.length,count,'obsolete handlers do not start requests');
  const pending=newer.load(platform);assert.equal(h.state.loading,true);h.calls[1].reject(new Error('obsolete failure'));await microtasks();assert.equal(h.state.error,'');assert.equal(h.state.loading,true);
  h.calls.at(-1)!.resolve(h.page(['new-scope'],null));await pending;assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['new-scope']);assert.equal(h.state.cursor,null);
});

test('feed duplicate load-more coalesces and superseded success cannot append; unmount invalidates pending retry',async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const more=h.ui.load('note','B');await h.ui.load('note','B');assert.equal(h.calls.length,2);
  h.state.loadSequence.current++;const newer=h.render({tag:'fresh'}),fresh=newer.load('note');
  h.calls[1].resolve(h.page(['stale'],'C'));await more;assert.equal(h.state.loading,true);assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['A']);
  h.calls[2].reject(new Error('offline'));await fresh;newer.retry();h.state.loadSequence.current++;h.calls[3].resolve(h.page(['unmounted']));await microtasks();assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['A']);
});

test('feed direct lookup and first-page retry preserve query scope and locally published cards without duplicate IDs',async()=>{
  const h=feedHarness();h.state.newPosts.current=[{post_id:'local',kind:'note',tags:['work']}];
  const tagged=h.render({tag:'work'}),first=tagged.load('note');h.calls[0].reject(new Error('offline'));await first;tagged.retry();assert.equal(h.calls[1].path,'/social-posts?kind=note&tag=work');
  h.calls[1].resolve(h.page(['remote'],null));await microtasks();assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['local','remote']);
  const direct=h.render({directPost:'post-2'}),read=direct.load('note');assert.equal(h.calls[2].path,'/social-posts?post_id=post-2');h.calls[2].reject(new Error('offline'));await read;direct.retry();assert.equal(h.calls[3].path,h.calls[2].path);h.calls[3].resolve(h.page([],null));await microtasks();assert.deepEqual(plain(h.state.items),[]);assert.equal(h.state.error,'');
});

test('Short pagination error retains the same child type/key but disables automatic pagination until explicit retry',async()=>{
  const h=feedHarness(),ui=h.render({platform:'shorts'});
  const line=composerSource.split('\n').find(line=>line.includes('<ShortVideoFeed posts={items}'))!.trim();assert.ok(line.startsWith('{')&&line.endsWith('}'));
  const code=transformSync(`globalThis.element=(${line.slice(1,-1)});`,{loader:'tsx',target:'es2023'}).code;
  const ShortVideoFeed=()=>null;
  const render=()=>runInNewContext(`${code};element`,{...h.state,platform:'shorts',directPost:null,load:ui.load,ShortVideoFeed,React:{createElement:(type:any,props:any)=>({type,key:props.key??null,props})},shortLiking:null});
  const first=ui.load('shorts');h.calls[0].resolve(h.page(['A']));await first;const before=render();assert.equal(before.props.hasMore,true);
  const next=ui.load('shorts','B');h.calls[1].reject(new Error('offline'));await next;const failed=render();
  assert.equal(failed.type,before.type);assert.equal(failed.key,before.key);assert.equal(failed.props.posts,h.state.items);assert.equal(failed.props.hasMore,false);
  failed.props.onLoadMore();failed.props.onLoadMore();assert.equal(h.calls.length,2,'no automatic retries while the failed page awaits an explicit retry');
  ui.retry();const retrying=render();assert.equal(retrying.type,before.type);assert.equal(retrying.props.loadingMore,true);retrying.props.onLoadMore();assert.equal(h.calls.length,3);
  h.calls[2].resolve(h.page(['B'],null));await microtasks();assert.equal(render().type,before.type);assert.equal(render().props.hasMore,false);
});

for(const outcome of ['success','failure'])for(const change of ['session','client','tag','direct'])test(`feed ${outcome} is fenced by ${change} before the replacement effect starts a request`,async()=>{
  const h=feedHarness(),pending=h.ui.load('note');
  const patch:any=change==='session'?{session:++h.client.sessionGeneration}:change==='client'?{client:{sessionGeneration:1,get:h.client.get}}:change==='tag'?{tag:'new'}:{directPost:'new-post'};
  h.render(patch);h.state.error='new scope feedback';h.state.items=[{post_id:'new-scope'}];h.state.cursor='new-cursor';
  assert.equal(h.state.loadSequence.current,1,'no newer load/sequence can mask a missing scope guard');
  if(outcome==='success')h.calls[0].resolve(h.page(['stale'],'old-cursor'));else h.calls[0].reject(new Error('stale failure'));
  await pending;assert.deepEqual(plain(h.state.items),[{post_id:'new-scope'}]);assert.equal(h.state.cursor,'new-cursor');assert.equal(h.state.error,'new scope feedback');assert.equal(h.state.loading,true,'stale finally cannot clear a new scope loading state');
});

test('a pending explicit refresh cannot be superseded by the old load-more cursor or a stale failed-page retry',async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const more=h.ui.load('note','B');h.calls[1].reject(new Error('offline'));await more;
  const refresh=h.ui.load('note');assert.equal(h.calls.length,3);assert.equal(h.state.failedFeedLoad.current,null);
  h.ui.retry();await h.ui.load('note','B');assert.equal(h.calls.length,3,'old pagination cannot replace a pending first-page refresh');
  h.calls[2].resolve(h.page(['fresh'],'D'));await refresh;const next=h.ui.load('note','D');assert.equal(h.calls[3].path,'/social-posts?kind=note&cursor=D');h.calls[3].resolve(h.page(['next'],null));await next;
  assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['fresh','next']);
  assert.match(composerSource,/disabled=\{loading \|\| more\} onClick=\{\(\) => void load\(platform, cursor\)\}/);
});

for(const action of ['prepare','upload','hide'])test(`existing-post ${action} error after successful feed has read-only recovery and never replays the write`,async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  if(action==='prepare')h.state.prepareFailure=true;
  const attempt=action==='hide'?h.ui.hide({post_id:'A'}):h.ui.uploadLinkThumb({post_id:'A'},png());await microtasks();
  if(action!=='prepare'){assert.equal(h.writes.length,1);h.writes[0].reject(new Error('result unknown'));}await attempt;
  assert.ok(h.state.actionError||h.state.error);const before=h.writes.length;
  h.ui.recoverAction();h.ui.recoverAction();assert.equal(h.calls.length,2,'action recovery starts one read-only refresh');assert.equal(h.calls[1].path,'/social-posts?kind=note');assert.equal(h.writes.length,before,'no PUT/POST replay');
  assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['A'],'visible cards retained until read completes');
  h.calls[1].resolve(h.page(['fresh'],null));await microtasks();assert.ok(h.state.actionError,'a GET does not confirm the previous write outcome');assert.equal(h.state.error,'');assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['fresh']);
  assert.match(composerSource,/onClick=\{refreshAfterAction\}>重新載入貼文狀態/);
});

for(const order of ['feed-first','action-first'])test(`feed and action errors retain separate origins and recovery in ${order} order`,async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const failFeed=async()=>{const read=h.ui.load('note','B');h.calls.at(-1)!.reject(new Error('page B failed'));await read;};
  const failAction=async()=>{const write=h.ui.hide({post_id:'A'});h.writes.at(-1)!.reject(new Error('hide outcome unknown'));await write;};
  if(order==='feed-first'){await failFeed();await failAction();}else{await failAction();await failFeed();}
  assert.equal(h.state.error,'page B failed');assert.equal(h.state.actionError,'hide outcome unknown');h.ui.retry();assert.equal(h.calls.at(-1)!.path,'/social-posts?kind=note&cursor=B');assert.equal(h.writes.length,1);
  h.calls.at(-1)!.resolve(h.page(['B'],null));await microtasks();assert.equal(h.state.error,'');assert.equal(h.state.actionError,'hide outcome unknown');
  h.ui.recoverAction();h.calls.at(-1)!.reject(new Error('refresh failed'));await microtasks();assert.equal(h.state.error,'refresh failed');assert.equal(h.state.actionError,'hide outcome unknown');
  h.ui.retry();assert.equal(h.calls.at(-1)!.path,'/social-posts?kind=note');h.calls.at(-1)!.resolve(h.page(['A'],null));await microtasks();assert.equal(h.state.actionError,'hide outcome unknown');assert.equal(h.writes.length,1);
});

for(const action of ['upload','hide'])for(const change of ['session','client'])for(const outcome of ['success','failure'])test(`late ${action} ${outcome} cannot update another ${change} scope or clear its action/loading state`,async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const pending=action==='hide'?h.ui.hide({post_id:'A'}):h.ui.uploadLinkThumb({post_id:'A'},png());await microtasks();assert.equal(h.writes.length,1);
  const patch=change==='session'?{session:++h.client.sessionGeneration}:{client:{sessionGeneration:1,get:h.client.get,post:h.client.post,csrfToken:'new'}};h.render(patch);
  h.state.items=[{post_id:'new-scope'}];h.state.notice='new notice';h.state.actionError='new action error';h.state.saving=true;
  if(outcome==='success')h.writes[0].resolve(action==='hide'?{}:{ok:true,json:async()=>({post_id:'A',thumbnail_url:'/old'})});else h.writes[0].reject(new Error('old failure'));await pending;
  assert.deepEqual(plain(h.state.items),[{post_id:'new-scope'}]);assert.equal(h.state.notice,'new notice');assert.equal(h.state.actionError,'new action error');assert.equal(h.state.saving,true);
  const reads=h.calls.length;h.ui.recoverAction();await h.ui.hide({post_id:'A'});await h.ui.uploadLinkThumb({post_id:'A'},png());assert.equal(h.calls.length,reads);assert.equal(h.writes.length,1);
});

test('thumbnail preparation interrupted by logout cannot upload or display an old failure',async()=>{
  const h=feedHarness();let release!:(file:File)=>void;h.state.prepareSocialImage=()=>new Promise(resolve=>release=resolve);
  const pending=h.ui.uploadLinkThumb({post_id:'A'},png());h.client.sessionGeneration++;h.state.actionError='new session';release(png());await pending;assert.equal(h.writes.length,0);assert.equal(h.state.actionError,'new session');
});

test('read-only action recovery retains uncertainty and an explicit new thumbnail choice remains usable on that post',async()=>{
  const h=feedHarness(),first=h.ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const failed=h.ui.uploadLinkThumb({post_id:'A'},png());await microtasks();h.writes[0].reject(new Error('upload outcome unknown'));await failed;
  h.ui.recoverAction();h.calls[1].resolve(h.page(['A'],null));await microtasks();assert.equal(h.state.actionError,'upload outcome unknown');assert.equal(h.state.saving,false);assert.equal(h.writes.length,1);
  const explicit=h.ui.uploadLinkThumb({post_id:'A'},jpeg());await microtasks();assert.equal(h.writes[1].path,'/api/v1/social-posts/A/thumbnail');assert.equal(h.writes[1].method,'PUT');assert.equal(h.state.actionError,'');
  h.writes[1].resolve({ok:true,json:async()=>({post_id:'A',thumbnail_url:'/updated'})});await explicit;assert.equal(h.state.notice,'縮圖已更新。');assert.equal(h.state.saving,false);assert.equal(h.writes.filter(w=>w.method==='POST').length,0);
});

for(const action of ['upload','hide'])for(const change of ['session','client'])test(`actual ${change} effect resets old ${action} saving state without letting its completion unlock a new action`,async()=>{
  const h=feedHarness();
  const effect=composerSource.match(/useEffect\(\(\)=>\{(\s*\+\+imageSequence\.current;pending\.current=null;publishLock\.current=null;[\s\S]*?)\},\[client,client\.sessionGeneration\]\)/);assert.ok(effect);
  Object.assign(h.state,{imageSequence:{current:0},pending:{current:null},publishLock:{current:null},newTextHistory:()=>({value:''})});
  for(const name of ['setTextHistory','setOriginalDraft','setComposeFile','setPreparingImage','setUrl','setTitle','setLinkPreview','setTopic','setMentions','setLocationName','setCheckIn','setPublishing','setPublishError'])h.state[name]=()=>{};
  const old=action==='hide'?h.ui.hide({post_id:'A'}):h.ui.uploadLinkThumb({post_id:'A'},png());await microtasks();assert.equal(h.state.saving,true);
  const patch=change==='session'?{session:++h.client.sessionGeneration}:{client:{sessionGeneration:1,get:h.client.get,post:h.client.post,csrfToken:'new'}};
  const newer=h.render(patch);runInNewContext(`(()=>{${effect[1]}})()`,h.state);assert.equal(h.state.saving,false,'actual new-session effect unlocks controls');assert.equal(h.state.actionError,'');
  const next=action==='hide'?newer.hide({post_id:'B'}):newer.uploadLinkThumb({post_id:'B'},jpeg());await microtasks();assert.equal(h.writes.length,2);assert.equal(h.state.saving,true);
  h.writes[0].reject(new Error('old outcome'));await old;assert.equal(h.state.saving,true,'obsolete finally cannot unlock the new action');assert.equal(h.state.actionError,'');
  h.writes[1].reject(new Error('new outcome'));await next;assert.equal(h.state.saving,false);assert.equal(h.state.actionError,'new outcome');
});

for(const phase of ['pending','failed'])test(`repeated same hashtag clicks preserve ${phase} pagination and its exact retry cursor`,async()=>{
  const h=feedHarness(),ui=h.render({tag:'work'}),first=ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const next=ui.load('note','B');if(phase==='failed'){h.calls[1].reject(new Error('offline'));await next;}
  const sequence=h.state.loadSequence.current,version=h.state.selection.current.version;
  ui.selectTag('work');ui.selectTag('work');assert.equal(h.state.loadSequence.current,sequence);assert.equal(h.state.selection.current.version,version);assert.equal(h.calls.length,2);
  if(phase==='failed'){ui.retry();assert.equal(h.calls[2].path,'/social-posts?kind=note&cursor=B&tag=work');h.calls[2].resolve(h.page(['B'],null));await microtasks();}
  else{h.calls[1].resolve(h.page(['B'],null));await next;}
  assert.equal(h.state.more,false);assert.equal(h.state.error,'');assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['A','B']);assert.equal(h.state.cursor,null);
});

test('a genuinely different hashtag still invalidates old pagination and repeated selection does not invalidate its new read',async()=>{
  const h=feedHarness(),ui=h.render({tag:'work'}),first=ui.load('note');h.calls[0].resolve(h.page(['A']));await first;
  const old=ui.load('note','B'),sequence=h.state.loadSequence.current;ui.selectTag('news');assert.equal(h.state.loadSequence.current,sequence+1);assert.equal(h.state.feedScope.current.tag,'news');
  ui.selectTag('news');assert.equal(h.state.loadSequence.current,sequence+1,'same-tick duplicate does not invalidate the selected intent');
  const newer=h.render(),fresh=newer.load('note');assert.equal(h.calls[2].path,'/social-posts?kind=note&tag=news');newer.selectTag('news');
  h.calls[1].resolve(h.page(['old'],null));await old;assert.equal(h.state.loading,true);h.calls[2].resolve(h.page(['new'],null));await fresh;assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['new']);assert.equal(h.state.loading,false);
});

test('selecting the same hashtag from a direct post still exits that lookup and loads the tagged wall',async()=>{
  const h=feedHarness(),ui=h.render({tag:'work',directPost:'post-2'}),first=ui.load('note');h.calls[0].resolve(h.page(['A'],null));await first;
  const sequence=h.state.loadSequence.current;ui.selectTag('work');assert.ok(h.state.loadSequence.current>sequence);assert.equal(h.state.feedScope.current.directPost,null);assert.equal(h.state.feedScope.current.tag,'work');
  const newer=h.render(),wall=newer.load('note');assert.equal(h.calls[1].path,'/social-posts?kind=note&tag=work');h.calls[1].resolve(h.page(['tagged'],null));await wall;assert.deepEqual(plain(h.state.items.map((p:any)=>p.post_id)),['tagged']);
});

// Execute the E2E observer predicate itself so unrelated POST receipts cannot
// masquerade as duplicate publication, while both create APIs remain counted.
test('composer E2E observer counts both create routes and excludes social subresource traffic',()=>{
  const source=readFileSync(new URL('../e2e/social-feed.spec.ts',import.meta.url),'utf8');
  const code=transformSync(source,{loader:'ts',target:'es2023',format:'esm'}).code;
  const predicate=code.match(/^function isSocialPostCreation\([^]*?^}/m);assert.ok(predicate);
  const matches=runInNewContext(`(${predicate[0]})`,{URL}) as (method:string,url:string)=>boolean;
  const origin='https://workshop.example.test',root='/api/v1/social-posts';
  for(const path of [root,root+'/notes']){
    assert.equal(matches('POST',origin+path),true);
    for(const method of ['GET','PUT','DELETE'])assert.equal(matches(method,origin+path),false);
  }
  for(const path of [root+'/post-id/read',root+'/post-id/likes',root+'/post-id/comments',root+'/post-id/thumbnail',root+'/notes-extra'])assert.equal(matches('POST',origin+path),false);
  const traffic=[root+'/post-id/read',root+'/notes',root+'/post-id/read'];
  assert.equal(traffic.filter(path=>matches('POST',origin+path)).length,1);
  assert.equal([...traffic,root].filter(path=>matches('POST',origin+path)).length,2);
  assert.equal([...traffic,root+'/notes'].filter(path=>matches('POST',origin+path)).length,2);
});
