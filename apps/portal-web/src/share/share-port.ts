export interface ShareComposeRequest {
  kind?:'repository'|'event'|'work'|'link'; url?:string; text?:string; image?:Blob;
  source?:{tool_id:string;guild_key:string;ref?:string};
}
export interface ShareComposeResult {status:'published'|'cancelled';share_id?:string;url?:string}
type Host=(request:ShareComposeRequest,finish:(result:ShareComposeResult)=>void)=>void;
let host:Host|undefined;
export function installShareComposer(next:Host){host=next;return()=>{if(host===next)host=undefined;};}
export function openShareComposer(request:ShareComposeRequest={}):Promise<ShareComposeResult>{
  if((request.text?.length??0)>500)return Promise.reject(new Error('文字最多 500 字。'));
  if(request.image&&(request.image.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(request.image.type)))return Promise.reject(new Error('圖片限 2 MB 的 PNG、JPEG 或 WebP。'));
  if(!host)return Promise.resolve({status:'cancelled'});
  return new Promise(resolve=>host!(request,resolve));
}
