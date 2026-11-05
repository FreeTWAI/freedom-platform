import {defaultProfileLayout} from '../../packages/shared/member-profile.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProfileReader,profileSettingsReadReady,decodeProfileSettings,readProfileSettings,ProfileSettingsFormatError,profileSettingsReadMessage,profilePublicationPreview,profileMutationBlocksLeave} from '../../apps/portal-web/src/modules/profile-publication-controller.js';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {subscribeGameConsole} from '../../apps/portal-web/src/game-console-core.js';
import {parseProfileRoute,visitorProfileHash,canOpenGuestProfile,directoryVisitorProfileHref} from '../../apps/portal-web/src/modules/profile-publication-route.js';
const id='10000000-0000-4000-8000-000000000001';
const tick=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
test('settings read failures use closed categories without exposing payload or server details',()=>{
 const classify=(status:number,extra:ConstructorParameters<typeof ApiError>[0]={message:'SECRET'})=>profileSettingsReadMessage(new ApiError({...extra,status}));
 assert.match(classify(401),/登入/);
 assert.match(classify(403,{message:'SECRET',code:'onboarding_required',definitiveResponse:true}),/主要公會/);
 assert.doesNotMatch(classify(403,{message:'SECRET',code:'onboarding_required'}),/主要公會/);
 assert.doesNotMatch(classify(403,{message:'SECRET',code:'other'}),/主要公會|SECRET/);
 assert.match(classify(429),/頻繁/);assert.match(classify(500),/服務/);
 assert.match(classify(0,{message:'SECRET',network:true}),/網路/);
 assert.match(classify(200,{message:'SECRET',network:true}),/未完整/);
 assert.equal(profileSettingsReadMessage(new Error('SECRET')),'設定暫時無法讀取。');
 let failure:unknown;try{decodeProfileSettings({display_name:'PRIVATE',unexpected:'SECRET'});}catch(error){failure=error;}
 assert(failure instanceof ProfileSettingsFormatError);assert.match(profileSettingsReadMessage(failure),/格式/);
 assert.doesNotMatch(String(failure),/PRIVATE|SECRET/);
 assert.equal(decodeProfileSettings({visibility:'private',display_name:'',bio:'',links:[],avatar_url:null,aggregate_version:null}).visibility,'private');
});
test('private settings read does not broadcast server error details or send telemetry',async()=>{
 const events:unknown[]=[],calls:string[]=[];const unsubscribe=subscribeGameConsole(event=>events.push(event));const original=globalThis.fetch;
 const windowDescriptor=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:{},configurable:true});
 try{
  globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json({type:'about:blank',title:'PRIVATE TITLE',status:403,code:'onboarding_required',detail:'PRIVATE DETAIL'},{status:403});};
  const client=new PortalClient();client.csrfToken='synthetic-token';
  // Positive control: this environment must detect the normal console and telemetry paths.
  await assert.rejects(client.get('/me/profile-publication'));
  assert.equal(events.length,1);assert.deepEqual(calls,['/api/v1/me/profile-publication','/api/v1/me/client-errors']);
  events.length=0;calls.length=0;
  await assert.rejects(readProfileSettings(client,new AbortController().signal),error=>error instanceof ApiError&&profileSettingsReadMessage(error).includes('主要公會'));
  assert.deepEqual(events,[]);assert.deepEqual(calls,['/api/v1/me/profile-publication']);
 }finally{globalThis.fetch=original;unsubscribe();if(windowDescriptor)Object.defineProperty(globalThis,'window',windowDescriptor);else Reflect.deleteProperty(globalThis,'window');}
});
test('profile routes reject malformed/duplicate/unknown parameters; OAuth is not a guest profile',()=>{
 assert.deepEqual(parseProfileRoute('#profile'),{kind:'workspace'});assert.deepEqual(parseProfileRoute('#profile?view=settings'),{kind:'settings'});
 assert.deepEqual(parseProfileRoute(visitorProfileHash(id)),{kind:'visitor',id});
 for(const hash of ['#profile?member=bad',`#profile?member=${id}&member=${id}`,`#profile?member=${id}&view=settings`,'#profile?view=bad','#profile?unknown=1'])assert.deepEqual(parseProfileRoute(hash),{kind:'invalid'});
 assert.equal(parseProfileRoute('#verify-email/token'),null);
 for(const query of ['?code=x&state=y','?error=access_denied','?state=x'])assert.equal(canOpenGuestProfile(visitorProfileHash(id),query),false);
 assert.equal(canOpenGuestProfile(visitorProfileHash(id),''),true);
});
test('overlapping focus/pageshow refresh shares one read; no retained cross-scope result',async()=>{
 let reads=0,current=true,finish:(value:string)=>void=()=>{};
 const reader=createProfileReader(()=>{reads++;return new Promise<string>(resolve=>{finish=resolve;});},()=>current);
 reader.start();void reader.refresh();void reader.refresh();assert.equal(reads,1);
 finish('owner A');await tick();assert.equal(reader.getSnapshot().value,'owner A');
 current=false;assert.equal(reader.getSnapshot().value,null);reader.stop();
});
test('hide aborts and clears synchronously; late read cannot repaint; visible starts one fresh read',async()=>{
 const finishes:Array<(value:string)=>void>=[],signals:AbortSignal[]=[];
 const reader=createProfileReader(signal=>{signals.push(signal);return new Promise<string>(resolve=>finishes.push(resolve));},()=>true);
 reader.start();reader.hide();assert.equal(signals[0].aborted,true);assert.equal(reader.getSnapshot().value,null);
 finishes[0]('hidden stale');await tick();assert.equal(reader.getSnapshot().value,null);
 void reader.refresh();void reader.refresh();assert.equal(signals.length,2);finishes[1]('current');await tick();assert.equal(reader.getSnapshot().value,'current');reader.stop();
});
test('StrictMode stop/start ignores first request and allows one new request; failure never retains prior data',async()=>{
 const finishes:Array<(value:string)=>void>=[];
 const reader=createProfileReader(()=>new Promise<string>(resolve=>finishes.push(resolve)),()=>true);
 reader.start();reader.stop();reader.start();finishes[0]('stale');finishes[1]('new');await tick();assert.equal(reader.getSnapshot().value,'new');reader.stop();
 let calls=0;const failing=createProfileReader(async()=>{if(++calls===1)return 'ok';throw new Error('denied');},()=>true);
 failing.start();await tick();assert.equal(failing.getSnapshot().value,'ok');await failing.refresh();assert.equal(failing.getSnapshot().status,'error');assert.equal(failing.getSnapshot().value,null);failing.stop();
});

test('draft preview projects only visitor fields and accepts valid drafts with visibility',()=>{
 const draft={visibility:'private',display_name:'Draft preview',bio:'Valid draft',links:[]};
 const result=profilePublicationPreview(draft);assert.equal(result.success,true);
 if(result.success)assert.deepEqual(result.data,{display_name:'Draft preview',bio:'Valid draft',links:[],avatar_url:null,layout:defaultProfileLayout,cover:null});
 assert.equal(profilePublicationPreview({...draft,display_name:''}).success,false);
});

for(const type of ['profile-publication-settings',`visitor-profile:${id}`])test(`${type} leave guard sees commands before React rerenders and retains unknown-result protection`,async()=>{
 const {setSharingDraftAccount,sharingMutationState}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
 const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
 const {ApiError}=await import('../../apps/portal-web/src/api.js');
 setSharingDraftAccount('owner',type==='profile-publication-settings'?101:102);
 const state=sharingMutationState({userId:'owner',type});
 const guard=()=>!profileMutationBlocksLeave(state);
 let resolve:(value:unknown)=>void=()=>{},reject:(reason:unknown)=>void=()=>{};
 const client={post:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})} as unknown as import('../../apps/portal-web/src/api.js').PortalClient;
 assert.equal(guard(),true);
 const operation=performModuleMutation(client,state,'/synthetic-command',{},1);
 // Same installed guard, no render/effect cycle between command and navigation.
 assert.equal(guard(),false);
 reject(new ApiError({message:'Lost response',network:true}));await operation;assert.equal(guard(),false);
 const retry=performModuleMutation(client,state,'/synthetic-command',{},1);assert.equal(guard(),false);
 resolve({updated:true});await retry;assert.equal(guard(),true);
 const oldOperation=performModuleMutation(client,state,'/synthetic-command',{},2);assert.equal(guard(),false);
 setSharingDraftAccount(null,103);assert.equal(guard(),true,'stale account guard must not trap the new session');
 resolve({updated:true});await oldOperation;assert.equal(profileMutationBlocksLeave(null),false);
});

test('directory link eligibility never throws or constructs routes for invalid IDs; navigation stays strict',()=>{
 assert.equal(directoryVisitorProfileHref(id),visitorProfileHash(id));
 assert.equal(directoryVisitorProfileHref(id.toUpperCase()),visitorProfileHash(id));
 for(const value of ['member-0','',null,undefined,123,'javascript:alert(1)',`${id}&view=settings`,`${id}/`,{}])assert.equal(directoryVisitorProfileHref(value),null);
 assert.throws(()=>visitorProfileHash('member-0'),/Invalid member id/);
 assert.deepEqual(parseProfileRoute('#profile?member=member-0'),{kind:'invalid'});
});

test('strict response decoding retains original tuple/key on malformed 2xx until valid replay; late account responses cannot settle',async()=>{
 const {setSharingDraftAccount,sharingMutationState}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
 const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
 const {ProfilePublicationSettingsSchema}=await import('../../packages/shared/member-profile.js');
 setSharingDraftAccount('decode-owner',401);const state=sharingMutationState({userId:'decode-owner',type:'profile-publication-settings'});
 const requests:{body:unknown;options:unknown}[]=[];let resolve:(value:unknown)=>void=()=>{};
 const client={post:(_path:string,body:unknown,options:unknown)=>{requests.push({body,options});return new Promise(yes=>{resolve=yes;});}} as unknown as import('../../apps/portal-web/src/api.js').PortalClient;
 const body={visibility:'private',display_name:'Owner',bio:'',links:[],confirm_public:false};
 const decode=(value:unknown)=>ProfilePublicationSettingsSchema.parse(value);
 const first=performModuleMutation(client,state,'/me/profile-publication',body,'1',decode);assert.equal(profileMutationBlocksLeave(state),true);resolve({aggregate_version:'2'});assert.equal(await first,undefined);
 assert.equal(state.snapshot.lastFailureUnknown,true);assert.equal(profileMutationBlocksLeave(state),true);assert.equal(state.keys.size,1);
 const retry=performModuleMutation(client,state,'/me/profile-publication',body,'1',decode);assert.deepEqual(requests[0],requests[1]);
 resolve({visibility:'private',display_name:'Owner',bio:'',links:[],avatar_url:null,aggregate_version:'2'});assert.equal((await retry)?.aggregate_version,'2');assert.equal(state.keys.size,0);assert.equal(profileMutationBlocksLeave(state),false);
 let decoded=0;const late=performModuleMutation(client,state,'/me/profile-publication',body,'2',value=>{decoded++;return decode(value);});
 setSharingDraftAccount('other-owner',402);resolve({visibility:'private',display_name:'Old owner private text',bio:'',links:[],avatar_url:null,aggregate_version:'3'});assert.equal(await late,undefined);assert.equal(decoded,0);assert.equal(profileMutationBlocksLeave(state),false);
});

test('decoder-enabled ambiguous tuple remains unknown after later 412/422; initially confirmed 412 stays recoverable',async()=>{
 const {setSharingDraftAccount,sharingMutationState}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
 const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
 const {ApiError}=await import('../../apps/portal-web/src/api.js');
 setSharingDraftAccount('unknown-history',501);const state=sharingMutationState({userId:'unknown-history',type:'profile-publication-settings'});
 const calls:unknown[]=[];let reply:unknown={bad:true},failure:unknown;
 const client={post:async(path:string,body:unknown,options:unknown)=>{calls.push({path,body,options});if(failure)throw failure;return reply;}} as unknown as import('../../apps/portal-web/src/api.js').PortalClient;
 const decode=(value:unknown)=>{if((value as {saved?:boolean}).saved!==true)throw Error('malformed');return value;};
 failure=new ApiError({message:'Initial confirmed conflict',status:412,definitiveResponse:true});await performModuleMutation(client,state,'/profile',{text:'initial'},'1',decode);assert.equal(state.keys.size,0);assert.equal(state.snapshot.lastFailureUnknown,false);
 failure=undefined;await performModuleMutation(client,state,'/profile',{text:'ambiguous'},'1',decode);const original=calls.at(-1);assert.equal(state.keys.size,1);assert.equal(profileMutationBlocksLeave(state),true);
 for(const status of [412,422,403,401]){failure=new ApiError({message:'Later rejection',status});await performModuleMutation(client,state,'/profile',{text:'ambiguous'},'1',decode);assert.deepEqual(calls.at(-1),original);assert.equal(state.keys.size,1);assert.equal(profileMutationBlocksLeave(state),true);}
 failure=undefined;reply={saved:true};await performModuleMutation(client,state,'/profile',{text:'ambiguous'},'1',decode);assert.deepEqual(calls.at(-1),original);assert.equal(state.keys.size,0);assert.equal(profileMutationBlocksLeave(state),false);
});

test('decoder-enabled profile commands retain first malformed 412/422 and later definitive rejection until same-key success',async()=>{
 const {setSharingDraftAccount,sharingMutationState}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
 const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
 const {PortalClient}=await import('../../apps/portal-web/src/api.js');
 const original=globalThis.fetch;let generation=600;
 try{for(const status of [412,422])for(const malformed of ['<html>gateway</html>','','{}','[]',JSON.stringify({type:'about:blank',title:'Mismatch',status:409})]){
  const client=new PortalClient();client.csrfToken='synthetic-profile-test';setSharingDraftAccount('profile-provenance',++generation);const state=sharingMutationState({userId:'profile-provenance',type:'profile-publication-settings'});const calls:unknown[]=[];let attempt=0;
  globalThis.fetch=async(_url,init)=>{calls.push({body:init?.body,key:new Headers(init?.headers).get('Idempotency-Key'),version:new Headers(init?.headers).get('If-Match')});attempt++;return attempt===1?new Response(malformed,{status}):attempt===2?Response.json({type:'about:blank',title:'Conflict',status:412},{status:412}):Response.json({saved:true});};
  const decode=(value:unknown)=>{assert.equal((value as any).saved,true);return value;};
  for(let i=0;i<2;i++){await performModuleMutation(client,state,'/profile',{name:'original'},'1',decode);assert.equal(state.keys.size,1);assert.equal(profileMutationBlocksLeave(state),true);}
  await performModuleMutation(client,state,'/profile',{name:'original'},'1',decode);assert.equal(state.keys.size,0);assert.equal(profileMutationBlocksLeave(state),false);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0],calls[2]);
 }}finally{globalThis.fetch=original;}
});


test('settings editing stays locked through reload failure and until the recovered snapshot is applied',async()=>{
 type Settings={version:string};
 const pending:{resolve:(value:Settings)=>void;reject:(error:unknown)=>void}[]=[];let current=true;
 const reader=createProfileReader(()=>new Promise<Settings>((resolve,reject)=>pending.push({resolve,reject})),()=>current);
 let applied:Settings|null=null;const canEdit=()=>profileSettingsReadReady(reader.getSnapshot(),applied);
 reader.start();assert.equal(canEdit(),false);
 const first={version:'1'};pending[0].resolve(first);await tick();assert.equal(canEdit(),false,'response must first be applied to draft');
 applied=first;assert.equal(canEdit(),true);
 const reload=reader.refresh();assert.equal(canEdit(),false,'synchronously blocks commands before rerender');
 pending[1].reject(new Error('synthetic failure'));await reload;assert.equal(canEdit(),false);assert.equal(applied,first,'does not discard draft snapshot on failure');
 const retry=reader.refresh();assert.equal(canEdit(),false);void reader.refresh();assert.equal(pending.length,3);
 const recovered={version:'2'};pending[2].resolve(recovered);await retry;assert.equal(canEdit(),false,'old applied snapshot cannot unlock new response');
 applied=recovered;assert.equal(canEdit(),true);
 current=false;assert.equal(canEdit(),false);reader.stop();
});
