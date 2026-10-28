import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

// Actual component handlers, mutation hook and client auth accessors with explicit
// hook/transport ports. These are not React-renderer, browser or server tests.
const source=readFileSync('apps/portal-web/src/modules/GuildMembers.tsx','utf8');
const shared=readFileSync('apps/portal-web/src/modules/shared.tsx','utf8');
const apiSource=readFileSync('apps/portal-web/src/api.ts','utf8');
function between(value:string,start:string,end:string){const a=value.indexOf(start),b=value.indexOf(end,a);assert.ok(a>=0&&b>a,'actual source extraction boundary');return value.slice(a,b);}
const auth=between(apiSource,'export class PortalClient {','  onUnauthorized:');
const AuthClient=runInNewContext(stripTypeScriptTypes(auth.replace('export ','')+'}')+';PortalClient',{Map});
const errorCode=between(apiSource,'export class ApiError extends Error {','export type InstanceSelectionCandidate');
const ApiFailure=runInNewContext(stripTypeScriptTypes(errorCode.replace('export ',''))+';ApiError',{Error});
// Preserve the real module-level decoder history used on successful mutations.
const mutationPrelude=between(shared,'const decoderUnknownRequests =','export function useModuleMutation(');
const mutationCode=(mutationPrelude+shared.slice(shared.indexOf('export function useModuleMutation('))).replace(/^export /gm,'');
assert.ok(shared.indexOf('export function useModuleMutation(')>=0);
const loadCode=between(source,'  const load = useCallback(','\n  useEffect(');
const applyCode=between(source,'  async function apply(','\n  function submit(');
const fenceStart=source.indexOf('  const operationLifetime = useRef(');
const fenceCode=fenceStart<0?'':source.slice(fenceStart,source.indexOf('  async function apply(',fenceStart));
assert.ok(source.includes('return () => { generation.current++; }; }, [load, filters]);'),'actual read cleanup');
type Pending={body:unknown;options:{idempotencyKey:string};resolve:(value:unknown)=>void;reject:(error:Error)=>void};
type Props={client:any;guildKey:string;viewerId:string;masterId:string};
function harness(){
 const refs:{current:any}[]=[],writes:Pending[]=[],reads:{path:string;session:number}[]=[],effects:string[]=[];
 let cursor=0,setup:(()=>()=>void)|undefined,cleanup:(()=>void)|undefined,heldRead:((value:unknown)=>void)|undefined,holdRead=false;
 const createClient=()=>{const client=new AuthClient();client.csrfToken='synthetic-session';client.post=(_path:string,body:unknown,options:Pending['options'])=>new Promise((resolve,reject)=>writes.push({body,options,resolve,reject}));client.get=(path:string)=>{reads.push({path,session:client.sessionGeneration});return holdRead?new Promise(resolve=>heldRead=resolve):Promise.resolve({items:[],total:0,next_offset:null});};return client;};
 let props:Props={client:createClient(),guildKey:'synthetic-guild',viewerId:'synthetic-master',masterId:'synthetic-master'};
 const context:any={ApiError:ApiFailure,Error,crypto:globalThis.crypto,URLSearchParams,
  generation:{current:0},filtersRef:{current:{sort:'nickname',search:''}},offsetRef:{current:0},
  useRef:(initial:unknown)=>refs[cursor++]??(refs[cursor-1]={current:initial}),
  useCallback:(fn:unknown)=>fn,useSyncExternalStore:(_subscribe:unknown,read:()=>unknown)=>read(),
  useEffect:(run:()=>()=>void)=>{setup=run;},
  sharingMutationState:()=>{throw new Error('GuildMembers must retain its local mutation scope');},
  onChanged:()=>effects.push('onChanged'),
 };
 for(const name of ['setLoadError','setLoading','setMembers','setNext','setTotal','setConfirm'])context[name]=()=>effects.push(name);
 const build=runInNewContext(stripTypeScriptTypes(mutationCode+'\n(function({client,guildKey,viewerId,masterId}){const {mutate,setError:setActionError}=useModuleMutation(client);'+loadCode+fenceCode+applyCode+';return {apply,load};})'),context);
 let handlers:any;
 const render=()=>{cursor=0;handlers=build(props);};
 render();cleanup=setup?.();
 return {writes,reads,effects,get client(){return props.client;},get state(){return refs[0].current;},get apply(){return handlers.apply;},get load(){return handlers.load;},
  unmount(){context.generation.current++;cleanup?.();},
  setup(){cleanup=setup?.();},
  change(kind:'client'|'guild'|'viewer'|'master'){cleanup?.();props={...props,...(kind==='client'?{client:createClient()}:kind==='guild'?{guildKey:'other-guild'}:kind==='viewer'?{viewerId:'other-viewer'}:{masterId:'other-master'})};render();cleanup=setup?.();},
  restoreMaster(){cleanup?.();props={...props,masterId:props.viewerId};render();cleanup=setup?.();},
  holdRead(){holdRead=true;},releaseRead(){assert.ok(heldRead);heldRead({items:[],total:0,next_offset:null});},
 };
}
const apply=(h:ReturnType<typeof harness>)=>h.apply({},'/guilds/synthetic-guild/members/synthetic-member/tier',{member_tier:'full'},3);
const microtasks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
for(const change of ['unmount','session','client','guild','viewer','master'] as const)for(const outcome of ['success','failure'] as const)test('member mutation '+outcome+' after '+change+' has no obsolete read or parent callback',async()=>{
 const h=harness(),pending=apply(h);
 if(change==='unmount')h.unmount();else if(change==='session')h.client.csrfToken='synthetic-replacement';else h.change(change);
 h.effects.length=0;
 if(outcome==='success')h.writes[0].resolve({confirmed:true});else h.writes[0].reject(new ApiFailure({message:'Synthetic failure',status:403}));
 await pending;assert.equal(h.reads.length,0);assert.deepEqual(h.effects,[]);
});
for(const change of ['unmount','session','client','guild','viewer','master'] as const)test('obsolete member action entry is refused after '+change,async()=>{
 const h=harness(),old=h.apply;
 if(change==='unmount')h.unmount();else if(change==='session')h.client.csrfToken='synthetic-replacement';else h.change(change);
 const pending=old({},'/synthetic',{member_tier:'full'},3);await microtasks();const writes=h.writes.length;for(const write of h.writes)write.resolve({confirmed:true});await pending;assert.equal(writes,0);
});
test('revoking and restoring the master does not revive the previous command',async()=>{
 const h=harness(),pending=apply(h);h.change('master');h.restoreMaster();h.effects.length=0;h.writes[0].resolve({confirmed:true});await pending;assert.equal(h.reads.length,0);assert.equal(h.effects.length,0);
 const fresh=apply(h);h.writes[1].resolve({confirmed:true});await fresh;assert.equal(h.reads.length,1);assert.ok(h.effects.includes('onChanged'));
});
test('StrictMode cleanup/setup rejects the old capture but permits a fresh operation',async()=>{
 const h=harness(),pending=apply(h);h.unmount();h.setup();h.writes[0].resolve({confirmed:true});await pending;assert.equal(h.reads.length,0);
 const fresh=apply(h);h.writes[1].resolve({confirmed:true});await fresh;assert.equal(h.reads.length,1);
});
test('an old failure/finally cannot clear a replacement mount mutation lock or error',async()=>{
 const old=harness(),oldPending=apply(old);old.unmount();const fresh=harness(),newPending=apply(fresh);assert.equal(fresh.state.snapshot.busy,true);
 old.writes[0].reject(new ApiFailure({message:'Synthetic old failure',status:403}));await oldPending;
 assert.equal(fresh.state.snapshot.busy,true);assert.equal(fresh.state.snapshot.error,null);
 fresh.writes[0].resolve({confirmed:true});await newPending;assert.equal(fresh.reads.length,1);assert.equal(fresh.state.snapshot.busy,false);
});
test('ordinary list refresh does not invalidate a still-current mutation',async()=>{
 const h=harness(),pending=apply(h);await h.load();h.writes[0].resolve({confirmed:true});await pending;assert.equal(h.reads.length,2);assert.ok(h.effects.includes('onChanged'));
});
test('ownership lost during the post-ACK refresh prevents the parent callback',async()=>{
 const h=harness();h.holdRead();const pending=apply(h);h.writes[0].resolve({confirmed:true});await microtasks();assert.equal(h.reads.length,1);
 h.unmount();h.client.csrfToken='synthetic-replacement';h.effects.length=0;h.releaseRead();await pending;assert.deepEqual(h.effects,[]);
});
test('same-owner duplicate click, unknown receipt retry and definitive correction keep original mutation semantics',async()=>{
 const h=harness(),pending=apply(h);await apply(h);assert.equal(h.writes.length,1);
 h.writes[0].reject(new ApiFailure({message:'Synthetic unknown',network:true}));await pending;
 const retry=apply(h);assert.equal(h.writes[1].options.idempotencyKey,h.writes[0].options.idempotencyKey);h.writes[1].resolve({confirmed:true});await retry;
 const rejected=apply(h);h.writes[2].reject(new ApiFailure({message:'Synthetic definitive rejection',status:400}));await rejected;
 const corrected=apply(h);assert.notEqual(h.writes[3].options.idempotencyKey,h.writes[2].options.idempotencyKey);h.writes[3].resolve({confirmed:true});await corrected;
});
