import {AppearanceCommandAckSchema,StorefrontAppearanceInputSchema,type AppearanceCommandAck,type AppearanceRole} from '../../../../contracts/guild-launchpad/v1/storefront-appearance';
import type {z} from 'zod';

export type AppearanceFields=z.infer<typeof StorefrontAppearanceInputSchema>;
interface Placement {readonly tenantId:string;readonly instanceId:string}
interface Original extends Placement {readonly expected:string;readonly key:string;readonly hadUnknown:boolean}
export type AppearanceAttempt=Original&({readonly kind:'settings';readonly body:AppearanceFields}
  |{readonly kind:AppearanceRole;readonly action:'upload'|'remove';readonly file:File|null});
export function appearanceFields(value:AppearanceFields):AppearanceFields{
  const parsed=StorefrontAppearanceInputSchema.parse(value);
  return Object.freeze({...parsed,featured_product_ids:Object.freeze([...parsed.featured_product_ids]) as unknown as string[]});
}
export function appearanceAcknowledgement(raw:unknown,attempt:AppearanceAttempt):AppearanceCommandAck|null{
  const parsed=AppearanceCommandAckSchema.safeParse(raw);if(!parsed.success)return null;
  const ack=parsed.data,completed=String(BigInt(attempt.expected)+(ack.changed?1n:0n));
  if(ack.completed_version!==completed||(attempt.kind!=='settings'&&attempt.action==='upload'&&!ack.changed))return null;
  const prefix=`/api/v1/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}/appearance-media/`;
  if([ack.current.cover,ack.current.logo].some(image=>image&&!image.read_path.startsWith(prefix)))return null;
  if(ack.current.version===completed){
    if(attempt.kind==='settings'){
      const {template_id,accent_preset,announcement,featured_product_ids}=ack.current;
      if(JSON.stringify({template_id,accent_preset,announcement,featured_product_ids})!==JSON.stringify(attempt.body))return null;
    }else if(attempt.action==='upload'?!ack.current[attempt.kind]:ack.current[attempt.kind]!==null)return null;
  }
  return ack;
}
export function retainedAppearanceFailure(value:AppearanceAttempt,unknown:boolean):AppearanceAttempt{
  return Object.freeze({...value,hadUnknown:value.hadUnknown||unknown});
}
export function reviewAppearanceAttempt(value:AppearanceAttempt,expected:string,key:string):AppearanceAttempt{
  if(value.hadUnknown)throw Error('appearance_original_result_unknown');
  return Object.freeze({...value,expected,key,hadUnknown:false});
}
const pending=new WeakMap<object,Map<string,Map<string,AppearanceAttempt>>>();
let count=0;
const placement=(value:Placement)=>JSON.stringify([value.tenantId,value.instanceId]);
const unload=(event:BeforeUnloadEvent)=>{if(count){event.preventDefault();event.returnValue='';}};
function watch(){if(typeof window==='undefined')return;window.removeEventListener('beforeunload',unload);if(count)window.addEventListener('beforeunload',unload);}
function same(a:AppearanceAttempt,b:AppearanceAttempt){
  return a.key===b.key&&a.expected===b.expected&&a.kind===b.kind&&(a.kind==='settings'&&b.kind==='settings'
    ?JSON.stringify(a.body)===JSON.stringify(b.body):a.kind!=='settings'&&b.kind!=='settings'&&a.action===b.action&&a.file===b.file);
}
export function heldAppearanceAttempt(client:object,userId:string,target:Placement){return pending.get(client)?.get(userId)?.get(placement(target))??null;}
/** RAM only, isolated by member/store; never automatically replays after login. */
export function holdAppearanceAttempt(client:object,userId:string,value:AppearanceAttempt){
  let members=pending.get(client);if(!members){members=new Map();pending.set(client,members);}
  let stores=members.get(userId);if(!stores){stores=new Map();members.set(userId,stores);}
  const key=placement(value),prior=stores.get(key);
  if(prior?.hadUnknown&&!same(prior,value))throw Error('appearance_original_result_unknown');
  if(!prior)count++;stores.set(key,retainedAppearanceFailure(value,prior?.hadUnknown===true));watch();
}
export function restoreAppearanceAttempt(client:object,userId:string,target:Placement){
  const prior=heldAppearanceAttempt(client,userId,target);if(!prior)return null;
  const restored=retainedAppearanceFailure(prior,true);holdAppearanceAttempt(client,userId,restored);return restored;
}
export function releaseAppearanceAttempt(client:object,userId:string,value:AppearanceAttempt){
  const stores=pending.get(client)?.get(userId),current=stores?.get(placement(value));
  if(current&&same(current,value)){stores!.delete(placement(value));count--;if(!stores!.size)pending.get(client)!.delete(userId);watch();}
}
export function forgetRefusedAppearanceAttempt(client:object,userId:string,value:AppearanceAttempt){
  if(!heldAppearanceAttempt(client,userId,value)?.hadUnknown)releaseAppearanceAttempt(client,userId,value);
}
