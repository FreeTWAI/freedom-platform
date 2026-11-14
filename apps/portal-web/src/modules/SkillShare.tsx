import {useEffect,useRef,useState} from 'react';
import {ShareButton,type ShareLink} from '../share/ShareButton';
import './SkillDiscovery.css';

export type SkillShareContent={introductions:string[];illustration_url:string;illustration_alt:string};

/** One deadline includes response-body reads. Abort alone is not enough when a
 * transport ignores its signal; late results must not replace the fallback. */
async function boundedShareRequest<T>(signal:AbortSignal|undefined,read:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  let rejectRequest!:(reason:Error)=>void;
  const stopped=new Promise<never>((_,reject)=>{rejectRequest=reject;});
  const cancel=()=>{rejectRequest(new Error('share_request_cancelled'));controller.abort();};
  const timer=setTimeout(()=>{rejectRequest(new Error('share_request_timeout'));controller.abort();},8000);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  try{
    return await Promise.race([stopped,Promise.resolve().then(()=>{
      if(controller.signal.aborted)throw new Error('share_request_cancelled');
      return read(controller.signal);
    })]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}

export function skillSharePath(bookId:string){return `/development/skills/${encodeURIComponent(bookId)}`;}
/** Public share URL; `intro` is the 1-based introduction number used by the public page. */
export function skillShareUrl(bookId:string,intro?:number,origin=window.location.origin){return shareUrl(skillSharePath(bookId),intro,origin);}
function shareUrl(path:string,intro?:number,origin=window.location.origin){
  const url=new URL(path,origin);if(intro)url.searchParams.set('intro',String(intro));return url.href;
}
/** A published 社群技能書 shares its own public page, like a platform book. */
export function submissionSharePath(submissionId:string){return `/development/submissions/${encodeURIComponent(submissionId)}`;}
// Platform illustrations, drawn 社群技能書 art, or a published member upload.
const illustrationPath=/^(?:\/brand\/skill-illustrations\/[a-z0-9-]+\.webp|\/art\/community-skills\/[a-z0-9-]+\.webp|\/api\/v1\/skill-submissions\/[0-9a-f-]{36}\/illustration)$/;
export function isSkillIllustrationUrl(value:unknown):value is string{return typeof value==='string'&&illustrationPath.test(value);}
/** Loads authored share introductions and the landscape illustration for one book; throws on missing or invalid content. */
export function fetchSkillShareContent(bookId:string,signal?:AbortSignal){return fetchShareContent(`/api/v1/skills/${encodeURIComponent(bookId)}/share-content`,signal);}
export function fetchSubmissionShareContent(submissionId:string,signal?:AbortSignal){return fetchShareContent(`/api/v1/skill-submissions/${encodeURIComponent(submissionId)}/share-content`,signal);}
async function fetchShareContent(path:string,signal?:AbortSignal):Promise<SkillShareContent>{
  return boundedShareRequest(signal,async requestSignal=>{
  const response=await fetch(path,{credentials:'omit',signal:requestSignal,headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(response.status===404?'share_content_missing':'share_content_unavailable');
  const data=await response.json() as Partial<SkillShareContent>|null;
  const introductions=Array.isArray(data?.introductions)?data.introductions:[];
  if(!introductions.length||!introductions.every(value=>typeof value==='string'&&value.trim().length>0))throw new Error('share_content_empty');
  const illustration=isSkillIllustrationUrl(data?.illustration_url)?data.illustration_url:'';
  return {introductions,illustration_url:illustration,illustration_alt:illustration&&typeof data?.illustration_alt==='string'?data.illustration_alt:''};
  });
}
/** Uniform index from crypto randomness (rejection sampling); never repeats `avoid` when another choice exists. */
export function randomIntroductionIndex(length:number,avoid?:number){
  if(length<=1)return 0;
  const skip=avoid!==undefined&&Number.isInteger(avoid)&&avoid>=0&&avoid<length,choices=skip?length-1:length;
  const limit=Math.floor(0x100000000/choices)*choices,buffer=new Uint32Array(1);
  let value:number;do{crypto.getRandomValues(buffer);value=buffer[0];}while(value>=limit);
  const index=value%choices;return skip&&index>=avoid!?index+1:index;
}

export function SkillShare({bookId,submissionId,title,active=true}:{bookId?:string;submissionId?:string;title:string;active?:boolean}){
  const key=submissionId?`submission:${submissionId}`:bookId;
  const [introductions,setIntroductions]=useState<string[]|undefined>(undefined);
  const generation=useRef(0),request=useRef<AbortController|null>(null),trackRequest=useRef<AbortController|null>(null);
  function abortPending(){
    generation.current++;request.current?.abort();request.current=null;trackRequest.current?.abort();trackRequest.current=null;
  }
  useEffect(()=>{
    abortPending();
    setIntroductions(undefined);
    return abortPending;
  },[key,active]);
  if(!key)return null;
  const fallbackUrl=submissionId?submissionSharePath(submissionId):skillSharePath(bookId!);
  const target=submissionId?`submission:${submissionId}`:`book:${bookId}`;
  async function loadContent(){
    if(!active)return;
    const controller=new AbortController(),run=++generation.current;
    request.current?.abort();request.current=controller;
    try{
      const content=await (submissionId?fetchSubmissionShareContent(submissionId,controller.signal):fetchSkillShareContent(bookId!,controller.signal));
      if(run!==generation.current||controller.signal.aborted)return;
      request.current=null;
      setIntroductions(content.introductions);
    }catch{
      if(run===generation.current&&!controller.signal.aborted){request.current=null;setIntroductions(undefined);}
    }
  }
  async function makeLink():Promise<ShareLink>{
    if(!active)throw new Error('inactive');
    const controller=new AbortController();
    trackRequest.current?.abort();trackRequest.current=controller;
    return boundedShareRequest<ShareLink>(controller.signal,async signal=>{
      const session=await fetch('/api/v1/session',{credentials:'same-origin',signal,headers:{Accept:'application/json'}});
      const csrf=session.ok?(await session.json() as {csrf_token?:string}).csrf_token:'';
      if(!csrf)throw new Error('no_session');
      if(signal.aborted)throw new Error('share_request_cancelled');
      const response=await fetch('/api/v1/promotion/links',{
        method:'POST',
        credentials:'same-origin',
        signal,
        headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRF-Token':csrf,'Idempotency-Key':crypto.randomUUID()},
        body:JSON.stringify({kind:'skill_book',target}),
      });
      const link=response.ok?await response.json() as {path?:string}:null;
      if(!link?.path)throw new Error('share_link_failed');
      return {path:link.path};
    });
  }
  return <ShareButton
    title={title}
    fallbackUrl={fallbackUrl}
    makeLink={makeLink}
    introductions={introductions}
    label="分享技能"
    disabled={!active}
    preserveShell
    onOpen={()=>{void loadContent();}}
    onClose={abortPending}
  />;
}
