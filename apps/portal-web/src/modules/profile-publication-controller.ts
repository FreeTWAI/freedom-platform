import type {SharingMutationState} from './authoring-drafts';
import {VisitorProfile,type VisitorProfileData} from '../../../../packages/shared/member-profile';
export function profilePublicationPreview(draft:Pick<VisitorProfileData,'display_name'|'bio'|'links'>&Partial<Pick<VisitorProfileData,'layout'>>){return VisitorProfile.safeParse({display_name:draft.display_name,bio:draft.bio,links:draft.links,avatar_url:null,layout:draft.layout,cover:null});}

/** Read the command store at navigation time, not a previous React render. */
export function profileMutationBlocksLeave(state:SharingMutationState|null){return Boolean(state?.live()&&(state.snapshot.busy||state.snapshot.lastFailureUnknown));}

export type ProfileReadState<T>={status:'loading'|'ready'|'error';value:T|null;error:unknown};
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
