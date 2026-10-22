import {useCallback,useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import {ApiError,type PortalClient} from '../../../../apps/portal-web/src/api';
import {createAttempt,unknownFailure,type Attempt} from './attempt';
import {createConsoleReadRequests} from '../../hosted-ui/read-requests';
import {NOT_ALLOWED,permissionHelp,setupNext} from '../ui/view';
export type RegisterLeave=(guard:((next:string|null)=>boolean)|null)=>void;
export type ReadSlot<T>={data:T|null;state:'idle'|'loading'|'ready'|'failed';time:string|null;error:string;status?:number};
const empty:ReadSlot<never>={data:null,state:'idle',time:null,error:''};
type Descriptor={path:string;schema:z.ZodType;match?:(value:unknown)=>boolean};
export type Command={label:string;method?:'post'|'put';path:string;body:Record<string,unknown>;ifMatch?:string;schema:z.ZodType;match?:(value:unknown)=>boolean;sensitive?:boolean;settled?:(success:boolean)=>void;success?:(value:unknown)=>void;failed?:(cause:unknown)=>void;freshAgain?:()=>void;freshRecovery?:(resume:(verificationId:string)=>void)=>void};
export function errorText(cause:unknown,sensitive=false){
 if(cause instanceof ApiError){if(cause.status===403&&cause.code!=='fresh_auth_required')return NOT_ALLOWED+'。'+permissionHelp;
  const next=setupNext[cause.code??'']??'請更新資料後再試。';
  // Provider-account errors must never reflect a submitted password or credential fragment.
  return (sensitive?'':cause.detail?cause.detail+' ':'操作未完成。')+next;
 }
 return '無法確認回應，請稍後重試。';
}
export function useController(client:PortalClient,root:string,registerLeave:RegisterLeave){
 const [reads,setReads]=useState<Record<string,ReadSlot<unknown>>>({}),[phase,setPhase]=useState<'idle'|'sending'|'unknown'>('idle'),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [dirty,setDirty]=useState<Record<string,boolean>>({}),[pending,setPending]=useState<string[]>([]),[refused,setRefused]=useState<string|null>(null),[pendingReason,setPendingReason]=useState<'saved'|'conflict'>('saved');
 const slots=useRef(reads);slots.current=reads;
 const descriptors=useRef(new Map<string,Descriptor>()),requests=useRef(createConsoleReadRequests()),abort=useRef(new AbortController()),mounted=useRef(false),generation=useRef(client.sessionGeneration);
 const held=useRef<{attempt:Attempt;command:Command;unresolved:boolean;recoveryVerificationId?:string}|null>(null),busy=useRef(false),dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const legacyGuard=useRef<((next:string|null)=>boolean)|null>(null);
 const live=()=>mounted.current&&!abort.current.signal.aborted&&generation.current===client.sessionGeneration;
 const load=useCallback((key:string,descriptor?:Descriptor,replace=false):Promise<boolean>=>{
  if(descriptor)descriptors.current.set(key,descriptor);const d=descriptors.current.get(key);if(!d)return Promise.resolve(false);
  return requests.current.run(key,d.path,async({signal,isCurrent})=>{
   const current=()=>live()&&isCurrent();if(!current())return false;
   setReads(old=>({...old,[key]:{...(old[key]??empty),state:'loading',error:''}}));
   try{const value=d.schema.parse(await client.get(root+d.path,{signal,suppressConsole:true}));if(!current())return false;if(d.match&&!d.match(value))throw Error('read_target_mismatch');
    const slot:ReadSlot<unknown>={data:value,state:'ready',time:new Date().toISOString(),error:''};slots.current={...slots.current,[key]:slot};setReads(old=>({...old,[key]:slot}));setPending(old=>old.filter(k=>k!==key));return true;
   }catch(cause){if(!current())return false;const status=cause instanceof ApiError?cause.status:undefined;
    const privateUnavailable=cause instanceof ApiError&&(cause.accessExpired||[401,403,404].includes(cause.status));
    setReads(old=>({...old,[key]:{...(old[key]??empty),state:'failed',error:errorText(cause),status,...(privateUnavailable?{data:null,time:null}:{})}}));return false;}
  },{replace});
 },[client,root]);
 useEffect(()=>{mounted.current=true;generation.current=client.sessionGeneration;abort.current=new AbortController();return()=>{mounted.current=false;requests.current.cancelAll();abort.current.abort();descriptors.current.clear();};},[client,root]);
 const guard=useRef<(next:string|null)=>boolean>(()=>true);
 guard.current=next=>{
  if(legacyGuard.current&&!legacyGuard.current(next))return false;
  if(held.current||busy.current){setNotice('尚未確認原操作的結果，請按「重試」確認後再離開。');return false;}
  return !Object.values(dirtyRef.current).some(Boolean)||window.confirm('還有尚未儲存的內容，要離開嗎？');
 };
 useEffect(()=>{registerLeave(next=>guard.current(next));const unload=(e:BeforeUnloadEvent)=>{if(held.current||busy.current||Object.values(dirtyRef.current).some(Boolean)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{registerLeave(null);window.removeEventListener('beforeunload',unload);};},[registerLeave]);
 async function refresh(reason:'saved'|'conflict'='saved'){setPendingReason(reason);const keys=[...descriptors.current.keys()].filter(k=>k!=='contact'&&k!=='reservations-probe');setPending(keys);await Promise.all(keys.map(key=>load(key,undefined,true)));}
 async function send(a:Attempt,command:Command,recoveryVerificationId=held.current?.recoveryVerificationId){
  if(!live()||busy.current||held.current&&held.current.attempt.key!==a.key)return;
  held.current={attempt:a,command,unresolved:held.current?.unresolved??false,recoveryVerificationId};busy.current=true;setPhase('sending');setError('');setNotice('');
  let result:unknown,cause:unknown;
  try{result=command.schema.parse(await client[a.method](a.path,a.body,{idempotencyKey:a.key,ifMatch:a.ifMatch,commerceRecoveryVerificationId:recoveryVerificationId,signal:abort.current.signal,suppressConsole:true}));if(command.match&&!command.match(result))throw Error('response_target_mismatch');}
  catch(e){cause=e;}
  if(!live())return;busy.current=false;
  if(cause&&unknownFailure(cause)){held.current.unresolved=true;setPhase('unknown');return;}
  if(cause instanceof ApiError&&cause.code==='fresh_auth_required'&&held.current.unresolved&&command.freshRecovery){
   setPhase('unknown');setError('原操作結果仍未確認，請驗證身分後繼續確認。');
   command.freshRecovery(id=>{if(live()&&held.current?.attempt===a&&!busy.current)void send(a,command,id);});return;
  }
  // A denied replay cannot tell us whether the earlier lost acknowledgement committed.
  // Keep the original command through authority changes; never mint a replacement.
  if(cause instanceof ApiError&&held.current.unresolved&&[403,404].includes(cause.status)){
   setPhase('unknown');setError(errorText(cause,command.sensitive));setRefused(command.path);await load('store',undefined,true);return;
  }
  held.current=null;setPhase('idle');command.settled?.(!cause);
  if(!cause){setNotice('已保存：'+command.label+'。');await refresh();if(live())command.success?.(result);return;}
  setError(errorText(cause,command.sensitive));command.failed?.(cause);
  if(cause instanceof ApiError){
   if(cause.code==='fresh_auth_required'){command.freshAgain?.();return;}
   if(cause.status===403){setRefused(command.path);await load('store',undefined,true);}
   if(cause.status===412||['version_conflict','invalid_version'].includes(cause.code??''))await refresh('conflict');
  }
 }
 function command(input:Command){if(held.current||busy.current||pending.length||refused||!live())return;void send(createAttempt({method:input.method??'post',path:input.path,body:input.body,ifMatch:input.ifMatch}),input);}
 const markDirty=useCallback((name:string,value:boolean)=>{dirtyRef.current={...dirtyRef.current,[name]:value};setDirty(old=>old[name]===value?old:{...old,[name]:value});},[]);
 const unregister=useCallback((key:string)=>{requests.current.cancel(key);descriptors.current.delete(key);setPending(old=>old.filter(k=>k!==key));},[]);
 const forget=useCallback((key:string)=>{requests.current.cancel(key);descriptors.current.delete(key);setReads(old=>{const next={...old};delete next[key];return next;});},[]);
 return {client,root,reads,unregister,slot:<T,>(key:string)=>(reads[key]??empty) as ReadSlot<T>,load,forget,markDirty,command,phase,notice,error,pending,pendingReason,refused,
  locked:phase!=='idle'||pending.length>0||!!refused,retry:()=>{const h=held.current;if(h)void send(h.attempt,h.command);},
  recheck:async()=>{if(await load('store'))setRefused(null);},registerLegacy:useCallback<RegisterLeave>(g=>{legacyGuard.current=g;},[])};
}
export type Controller=ReturnType<typeof useController>;
