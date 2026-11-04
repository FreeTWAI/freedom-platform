/** A retraction changes existing rows and their quotes. Refresh the loaded IDs
 * through the authorized history pages, rather than treating it as a new send. */
export async function refreshLoadedMessages<T extends {message_id:string}>(
  latest:{items:T[];next_offset:number|null},loaded:T[],
  readPage:(offset:number)=>Promise<{items:T[];next_offset:number|null}>,isCurrent:()=>boolean,
):Promise<T[]|null>{
  const wanted=new Set(loaded.map(item=>item.message_id)),confirmed=new Map<string,T>();
  for(const item of latest.items){wanted.delete(item.message_id);confirmed.set(item.message_id,item);}
  let offset=latest.next_offset;const visited=new Set<number>();
  while(wanted.size&&offset!==null){
    if(!isCurrent())return null;
    if(!Number.isSafeInteger(offset)||offset<0||offset>10000||visited.has(offset))throw new Error('較早訊息尚未更新，請重讀對話。');
    visited.add(offset);const page=await readPage(offset);
    if(!isCurrent())return null;
    for(const item of page.items)if(wanted.delete(item.message_id))confirmed.set(item.message_id,item);
    offset=page.next_offset;
  }
  // Rows no longer present in authorized history must not survive in the cache.
  return [...confirmed.values()];
}

/** A send ACK proves delivery, not that its serialized content is still current.
 * Keep irreversible redaction and known read receipts from authorized projections. */
export function reconcileMessageAck<T extends {message_id:string;retracted_at?:string|null;read_at?:string|null;reply_to?:{message_id:string};reply_to_message_id?:string}>(ack:T,known:readonly T[]):T{
  const projections=known.filter(item=>item.message_id===ack.message_id);
  const retracted=projections.find(item=>item.retracted_at);
  // Do not spread the old ACK into a tombstone: absent media fields must stay absent.
  if(retracted)return retracted;
  if(ack.retracted_at)return ack;
  const readAt=projections.find(item=>item.read_at)?.read_at;
  const current=readAt&&!ack.read_at?{...ack,read_at:readAt}:ack;
  const target=ack.reply_to?.message_id;
  if(target&&(known.some(item=>item.message_id===target&&item.retracted_at)
    ||projections.some(item=>item.reply_to_message_id===target&&!item.reply_to))){
    const {reply_to:_,...redacted}=current;
    return {...redacted,reply_to_message_id:target} as T;
  }
  return current;
}
