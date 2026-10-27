import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProfileReader,profilePublicationPreview,profileMutationBlocksLeave} from '../../apps/portal-web/src/modules/profile-publication-controller.js';
import {parseProfileRoute,visitorProfileHash,canOpenGuestProfile} from '../../apps/portal-web/src/modules/profile-publication-route.js';
const id='10000000-0000-4000-8000-000000000001';
const tick=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
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
 if(result.success)assert.deepEqual(result.data,{display_name:'Draft preview',bio:'Valid draft',links:[],avatar_url:null});
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
