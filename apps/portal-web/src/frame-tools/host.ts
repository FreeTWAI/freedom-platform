import {BRIDGE_VERSION,parseRequest,operationScope,type ToolRecord,type Operation} from '../../../../modules/guild-tools/contract';
export type HostPorts={execute:(operation:Operation,payload:any,signal:AbortSignal)=>Promise<unknown>;ready:()=>void;failure:(code:string)=>void};
/** One instance per mount/account. A frame navigation invalidates the entire generation. */
export class ToolHost {
 private controller=new AbortController();private nonce=crypto.randomUUID();private generation=0;private active=true;private ids=new Set<string>();private count=0;private start=Date.now();private pending=0;
 constructor(private frame:()=>Window|null,private tool:ToolRecord,private ports:HostPorts){}
 init(){this.controller.abort();this.controller=new AbortController();this.generation++;this.nonce=crypto.randomUUID();this.ids.clear();this.pending=0;this.send({version:BRIDGE_VERSION,type:'init',tool_id:this.tool.tool_id,guild_key:this.tool.guild_key,nonce:this.nonce});}
 dispose(){this.controller.abort();this.active=false;this.generation++;}
 private send(value:unknown){this.frame()?.postMessage(value,this.tool.profile==='sandboxed'?'*':this.tool.origin);}
 async receive(event:Pick<MessageEvent,'source'|'origin'|'data'>){
 if(!this.active||event.source!==this.frame()||!event.source||event.origin!==(this.tool.profile==='sandboxed'?'null':this.tool.origin))return;
 if(Date.now()-this.start>=60000){this.start=Date.now();this.count=0;}
 if(++this.count>120){this.ports.failure('rate_limit');return;}
 const m=parseRequest(event.data);if(!m||m.tool_id!==this.tool.tool_id||m.guild_key!==this.tool.guild_key||m.nonce!==this.nonce||this.ids.has(m.request_id))return;
 if(this.ids.size>=1024||this.pending>=8)return;
 this.ids.add(m.request_id);this.pending++;const generation=this.generation;
 const reply=(body:unknown)=>{if(this.active&&generation===this.generation)this.send({version:BRIDGE_VERSION,type:'response',tool_id:this.tool.tool_id,guild_key:this.tool.guild_key,nonce:this.nonce,request_id:m.request_id,...body as object});};
 try{
 if(m.operation==='session.exchange'&&this.tool.profile!=='origin')throw Error('profile_denied');
 if(!this.tool.scopes.includes(operationScope[m.operation]))throw Error('scope_denied');
 if(m.operation==='context.get')this.ports.ready();
 const result=await this.ports.execute(m.operation,m.payload,this.controller.signal);reply({ok:true,result});
 }catch{reply({ok:false,error:{code:'operation_unavailable',message:'此操作目前無法完成。'}});}finally{if(generation===this.generation)this.pending--;}
 }
}
