import {ApiError,requireItems,type PortalClient} from '../api';
import type {PersonalContentItem} from './MyContent';

export const PERSONAL_SPACE_PAGE_SIZE=6;
export type PersonalSpaceScope={client:PortalClient;owner:string;generation:number};
/** Render-time fence, including a replacement client with the same numeric generation. */
export function isPersonalSpaceScope(saved:PersonalSpaceScope|null,client:PortalClient,owner:string):boolean{
  return saved!==null&&saved.client===client&&saved.owner===owner&&saved.generation===client.sessionGeneration;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Construct a fixed same-origin link; inventory-provided URLs are not navigation authority. */
export function personalPostPath(item:Pick<PersonalContentItem,'id'|'kind'|'status'|'actions'>):string|null{
  return item.kind==='social_post'&&item.status==='active'&&item.actions.includes('view')&&UUID.test(item.id)?`/?social-post=${item.id}#social`:null;
}
export type PersonalPostPreview={post_id:string;title:string;note:string|null;created_at:string;thumbnail_url:string|null};
export type PersonalPostResult={state:'ready';post:PersonalPostPreview}|{state:'unavailable'}|{state:'error';retryable:boolean}|{state:'retrying'};
/** No retained cache. Only this owner, this request lifetime, and this displayed page. */
export async function readPersonalPostPage(client:PortalClient,owner:string,items:readonly PersonalContentItem[],signal:AbortSignal,onResult:(id:string,result:PersonalPostResult)=>void):Promise<void>{
  const generation=client.sessionGeneration;
  const live=()=>!signal.aborted&&client.sessionGeneration===generation;
  const page=items.slice(0,PERSONAL_SPACE_PAGE_SIZE);
  const unique=[...new Map(page.filter(item=>personalPostPath(item)).map(item=>[item.id,item])).values()];
  await Promise.all(unique.map(async item=>{
    try{
      const rows=requireItems<PersonalPostPreview&{mine:boolean;author:{user_id:string}}>(await client.get(`/social-posts?post_id=${encodeURIComponent(item.id)}`,{signal}),'個人動態');
      if(!live())return;
      const post=rows.find(row=>row.post_id===item.id&&row.mine===true&&row.author?.user_id===owner);
      if(!post){onResult(item.id,{state:'unavailable'});return;}
      onResult(item.id,{state:'ready',post:{post_id:post.post_id,title:post.title,note:post.note,created_at:post.created_at,thumbnail_url:post.thumbnail_url===`/api/v1/social-posts/${item.id}/thumbnail`?post.thumbnail_url:null}});
    }catch(error){
      if(!live())return;
      if(error instanceof ApiError&&[401,403,404,410].includes(error.status))onResult(item.id,{state:'unavailable'});
      else onResult(item.id,{state:'error',retryable:error instanceof ApiError&&!error.accessExpired&&(error.network||error.status>=500||error.status===408||error.status===429)});
    }
  }));
}

/** One displayed page lifetime. Manual retries read only the failed card, never the inventory. */
export function createPersonalPostPageReader(client:PortalClient,owner:string,items:readonly PersonalContentItem[],signal:AbortSignal,onResult:(id:string,result:PersonalPostResult)=>void){
  const generation=client.sessionGeneration;
  const page=items.slice(0,PERSONAL_SPACE_PAGE_SIZE);
  const results=new Map<string,PersonalPostResult>();
  const live=()=>!signal.aborted&&client.sessionGeneration===generation;
  const publish=(id:string,result:PersonalPostResult)=>{if(live()){results.set(id,result);onResult(id,result);}};
  let started=false;
  return {
    load:async()=>{if(started||!live())return;started=true;await readPersonalPostPage(client,owner,page,signal,publish);},
    retry:async(id:string)=>{
      const previous=results.get(id),item=page.find(item=>item.id===id&&personalPostPath(item));
      if(!live()||!item||previous?.state!=='error'||!previous.retryable)return;
      // Synchronous consumption closes the double-click window before React renders disabled.
      publish(id,{state:'retrying'});
      await readPersonalPostPage(client,owner,[item],signal,publish);
    },
  };
}
