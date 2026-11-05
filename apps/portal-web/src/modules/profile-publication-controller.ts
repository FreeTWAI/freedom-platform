import type {SharingMutationState} from './authoring-drafts';
import {ProfilePublicationSettingsSchema,VisitorProfile,type VisitorProfileData} from '../../../../packages/shared/member-profile';
import {ApiError,type PortalClient} from '../api';
export function profilePublicationPreview(draft:Pick<VisitorProfileData,'display_name'|'bio'|'links'>&Partial<Pick<VisitorProfileData,'layout'>>){return VisitorProfile.safeParse({display_name:draft.display_name,bio:draft.bio,links:draft.links,avatar_url:null,layout:draft.layout,cover:null});}

// Do not retain or display the server payload or validation issues in this error.
export class ProfileSettingsFormatError extends Error {
 constructor(){super('Profile settings response invalid');this.name='ProfileSettingsFormatError';}
}
export function decodeProfileSettings(value:unknown){
 const result=ProfilePublicationSettingsSchema.safeParse(value);
 if(!result.success)throw new ProfileSettingsFormatError();
 return result.data;
}
export async function readProfileSettings(client:Pick<PortalClient,'get'>,signal:AbortSignal){
 // This private read must not put server-provided problem text into the shared console.
 // Background also disables this request's client-error telemetry. The editor has its own loading state.
 return decodeProfileSettings(await client.get('/me/profile-publication',{signal,background:true,suppressConsole:true}));
}
/** Closed categories only: never render raw server details or response data. */
export function profileSettingsReadMessage(error:unknown){
 if(error instanceof ProfileSettingsFormatError)return '收到的設定資料格式不符，請稍後重試。';
 if(!(error instanceof ApiError))return '設定暫時無法讀取。';
 if(error.accessExpired||error.status===401)return '登入狀態需要重新確認，請重新登入後再試。';
 if(error.status===403&&error.definitiveResponse&&error.code==='onboarding_required')return '請先選擇主要公會並完成加入，再設定個人頁。';
 if(error.status===403)return '目前無法存取個人頁設定。';
 if(error.status===429)return '讀取太頻繁，請稍後再試。';
 if(error.status>=500)return '服務暫時無法讀取設定，請稍後重試。';
 if(error.status>=200&&error.status<300)return '設定回應未完整收到，請重試。';
 if(error.network)return '無法連線讀取設定，請確認網路後重試。';
 return '設定暫時無法讀取。';
}

/** Read the command store at navigation time, not a previous React render. */
export function profileMutationBlocksLeave(state:SharingMutationState|null){return Boolean(state?.live()&&(state.snapshot.busy||state.snapshot.lastFailureUnknown));}

export type ProfileReadState<T>={status:'loading'|'ready'|'error';value:T|null;error:unknown};
/** Only the exact successful read already applied to the draft may enable editing.
 * Compare against the live reader snapshot again at command time. */
export function profileSettingsReadReady<T>(state:ProfileReadState<T>,applied:T|null){
 return state.status==='ready'&&state.value!==null&&state.value===applied;
}
/** One in-flight read, no cross-scope cache, synchronous hidden/abort invalidation. */
export function createProfileReader<T>(read:(signal:AbortSignal)=>Promise<T>,current:()=>boolean){
 const empty:ProfileReadState<T>={status:'loading',value:null,error:null};
 let state:ProfileReadState<T>={status:'loading',value:null,error:null},active=false,request:AbortController|null=null,epoch=0;
 const listeners=new Set<()=>void>();
 const publish=(next:ProfileReadState<T>)=>{state=next;for(const listener of listeners)listener();};
 async function refresh(){
  if(!active||!current()||request)return;
  const controller=new AbortController(),sequence=++epoch;request=controller;publish({status:'loading',value:null,error:null});
  try{const value=await read(controller.signal);if(active&&current()&&epoch===sequence&&!controller.signal.aborted)publish({status:'ready',value,error:null});}
  catch(error){if(active&&current()&&epoch===sequence&&!controller.signal.aborted)publish({status:'error',value:null,error});}
  finally{if(request===controller)request=null;}
 }
 function clear(){epoch++;request?.abort();request=null;publish({status:'loading',value:null,error:null});}
 return {getSnapshot:()=>current()?state:empty,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
 start:()=>{active=true;void refresh();},stop:()=>{active=false;clear();},hide:clear,refresh};
}
