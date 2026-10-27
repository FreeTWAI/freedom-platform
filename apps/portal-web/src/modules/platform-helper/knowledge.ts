import {HELPER_PAGE_IDS,type HelperKnowledge,type HelperPage,type HelperPageId} from './model';

/** Host-supplied, reviewed public canonical records; never member/session data. */
export type CanonicalHelperInput={
  readonly metadata:Readonly<Partial<Record<HelperPageId,unknown>>>;
  readonly pageHelp:Readonly<Partial<Record<HelperPageId,unknown>>>;
  readonly availablePageIds:readonly string[];
  readonly guildLaunchpadEnabled:boolean|null|undefined;
};
export type HelperKnowledgeSnapshot={readonly knowledge:HelperKnowledge;readonly availablePageIds:readonly HelperPageId[]};
function record(value:unknown):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype||prototype===null;
}
/** Read own data properties only: inherited fields and getters are not content. */
function ownData(value:object,key:PropertyKey):unknown{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&'value' in descriptor?descriptor.value:undefined;
}
function text(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0;}

/** Pure fresh projection. Availability is presentation, never business permission. */
export function buildHelperKnowledge(input:CanonicalHelperInput):HelperKnowledgeSnapshot{
  const knowledge:Partial<Record<HelperPageId,HelperPage>>={},availablePageIds:HelperPageId[]=[];
  const snapshot={knowledge,availablePageIds};
  if(!record(input))return snapshot;
  const metadata=ownData(input,'metadata'),help=ownData(input,'pageHelp'),ids=ownData(input,'availablePageIds');
  if(!record(metadata)||!record(help)||!Array.isArray(ids))return snapshot;
  const requested=new Set<unknown>();
  for(let index=0;index<ids.length;index++)requested.add(ownData(ids,String(index)));
  for(const id of HELPER_PAGE_IDS){
    if(!requested.has(id)||(id==='stores'&&ownData(input,'guildLaunchpadEnabled')!==true))continue;
    const entry=ownData(metadata,id),description=ownData(help,id);
    if(!record(entry)||!record(description))continue;
    const title=ownData(entry,'title'),summary=ownData(description,'summary'),sourceSteps=ownData(description,'steps');
    const noteDescriptor=Object.getOwnPropertyDescriptor(description,'note');
    if(!text(title)||!text(summary)||!Array.isArray(sourceSteps))continue;
    // Optional means absent; an explicitly malformed/accessor note drops the entry.
    if(noteDescriptor&&(!('value' in noteDescriptor)||typeof noteDescriptor.value!=='string'))continue;
    const steps:string[]=[];
    for(let index=0;index<sourceSteps.length;index++){
      const step=ownData(sourceSteps,String(index));
      if(!text(step))break;
      steps.push(step);
    }
    if(steps.length!==sourceSteps.length)continue;
    knowledge[id]={id,title,summary,steps,...(noteDescriptor?{note:noteDescriptor.value as string}:{})};
    availablePageIds.push(id);
  }
  return snapshot;
}
