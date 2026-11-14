/** freedom.guild-launchpad/v2 — dependency-free, copyable browser client. */
export function createGuildTool({parentOrigin,toolId,guildKey}={}) {
 const version='freedom.guild-launchpad/v2', pending=new Map();let mount=null,origin=null,disposed=false,waiters=[];
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('mount_changed'));}pending.clear();};
 function receive(e){
  if(disposed||e.source!==parent||e.source===window||parentOrigin&&e.origin!==parentOrigin)return;
  const m=e.data;if(!m||typeof m!=='object'||m.version!==version)return;
  if(m.type==='init'){
   if(Object.keys(m).sort().join(',')!=='guild_key,nonce,tool_id,type,version'||!/^guild_[a-zA-Z0-9_]+$/.test(m.guild_key)||!/^[a-z][a-z0-9-]{0,47}$/.test(m.tool_id)||!/^[0-9a-f-]{36}$/.test(m.nonce)||toolId&&m.tool_id!==toolId||guildKey&&m.guild_key!==guildKey)return;
   if(origin&&origin!==e.origin)return;
   fail();origin=e.origin;mount=m;for(const r of waiters)r();waiters=[];
  }else if(m.type==='response'&&mount&&e.origin===origin&&m.nonce===mount.nonce&&m.tool_id===mount.tool_id&&m.guild_key===mount.guild_key&&typeof m.ok==='boolean'){
   const p=pending.get(m.request_id);if(!p)return;pending.delete(m.request_id);clearTimeout(p.timer);m.ok?p.resolve(m.result):p.reject(new Error(m.error?.code??'operation_failed'));
  }
 }
 addEventListener('message',receive);
 return Object.freeze({
  ready(){if(disposed)return Promise.reject(new Error('disposed'));return mount?Promise.resolve():new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('host_unavailable')),12000);waiters.push(()=>{clearTimeout(timer);resolve();});});},
  async request(operation,payload={}){
   if(disposed||!mount)throw new Error('host_not_ready');if(pending.size>=8)throw new Error('too_many_requests');
   const request_id=crypto.randomUUID(),message={...mount,type:'request',request_id,operation,payload};
   if(new TextEncoder().encode(JSON.stringify(message)).length>1400000)throw new Error('message_too_large');
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(request_id);reject(new Error('request_timeout'));},operation==='share.compose'?300000:15000);pending.set(request_id,{resolve,reject,timer});parent.postMessage(message,origin);});
  },
  dispose(){disposed=true;fail();removeEventListener('message',receive);mount=null;}
 });
}
