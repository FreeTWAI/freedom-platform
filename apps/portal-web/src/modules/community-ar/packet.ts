import {AR_EXPERIENCE_MAX_BYTES} from '../../../../../packages/asset-storage/ar-target';

/** Keep only received bytes. Small patterns must not reserve a 20 MiB arena.
 * The scene's remaining budget is enforced before accepting another chunk. */
export async function readArPacket(response:Response,signal:AbortSignal,remaining=AR_EXPERIENCE_MAX_BYTES):Promise<Uint8Array>{
  const limit=Math.min(AR_EXPERIENCE_MAX_BYTES,remaining);
  const reader=response.body?.getReader();
  if(!reader)throw new Error('ar_pattern_unavailable');
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  const chunks:Uint8Array[]=[];let count=0;
  try{
    if(!Number.isSafeInteger(limit)||limit<32)throw new Error('ar_scene_size');
    for(;;){
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const next=await reader.read();
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      if(next.done)break;
      if(next.value.length>limit-count||chunks.length>=8192)throw new Error('ar_scene_size');
      if(next.value.length){chunks.push(next.value);count+=next.value.length;}
    }
    const bytes=new Uint8Array(count);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
