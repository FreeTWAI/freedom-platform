import type {Handler} from 'hono';
import type {Pool} from 'pg';
import {z} from 'zod';
import {agentOperations,type AgentOperation} from './agent-allowlist.js';
import {agentContract} from '../../../modules/client-connections/agent-contract.js';
import {authenticateAgent,recordAgentResponse} from '../../../modules/client-connections/agent-authority.js';
import {Problem,requireCondition} from '../../../packages/shared/problem.js';
import type {PlatformEnv} from './module-context.js';
import type {PlatformRuntime} from './runtime.js';

export const mcpVersions=['2025-06-18','2025-11-25'] as const;
const latest=mcpVersions[1];
const object=z.record(z.string(),z.unknown());
const envelope=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number().int()]).optional(),method:z.string(),params:object.optional()}).strict();
const initialize=z.object({protocolVersion:z.string(),capabilities:object,clientInfo:z.object({name:z.string(),version:z.string()}).passthrough(),_meta:object.optional()}).strict();
const call=z.object({name:z.string(),arguments:object.optional(),_meta:object.optional()}).strict();
const emptyParams=z.object({_meta:object.optional()}).strict();
const definitions=Object.values(agentContract.paths).flatMap(path=>Object.values(path));
const tools=agentOperations.filter(op=>op.granted!==false).map(op=>{
 const definition=definitions.find(entry=>entry.operationId===op.id);
 if(!definition)throw new Error(`Missing MCP contract: ${op.id}`);
 return {op,validator:z.fromJSONSchema(definition['x-input-schema']),tool:{name:op.id,title:op.title,description:op.title,
  inputSchema:definition['x-input-schema'],annotations:{readOnlyHint:op.method==='GET',destructiveHint:['shares.retract','events.rsvp','events.waitlist'].includes(op.id),idempotentHint:op.id!=='tools.identity',openWorldHint:true}}};
});
function available(op:AgentOperation,runtime:PlatformRuntime,registered:(op:AgentOperation)=>boolean){
 if(!registered(op))return false;
 if(op.featureFlag==='FREEDOM_EVENT_PARTICIPATION_ENABLED'&&runtime.eventParticipationEnabled!==true)return false;
 if(op.featureFlag==='FREEDOM_SOCIAL_ACHIEVEMENTS_ENABLED'&&runtime.socialAchievementsEnabled!==true)return false;
 if(op.featureFlag&&!['FREEDOM_EVENT_PARTICIPATION_ENABLED','FREEDOM_SOCIAL_ACHIEVEMENTS_ENABLED'].includes(op.featureFlag))return false;
 return op.id!=='tools.identity'||Boolean(runtime.guildToolSigner);
}
/** A fixed operation adapter, not a URL proxy. The nested in-process request
 * re-enters the complete REST boundary and domain transaction with the original
 * bearer. Only that boundary accounts a dispatched call; no forwarding headers,
 * cookies, actor overrides, network fetches, or caller-selected URLs exist. */
export function agentMcp(pool:Pool,options:{origin:string;origins:ReadonlySet<string>;hosts:ReadonlySet<string>;runtime:PlatformRuntime;bodyLimit:number;
 responseHeaders:(path:string)=>Record<string,string>;registered:(op:AgentOperation)=>boolean;dispatch:(request:Request)=>Promise<Response>}):Handler<PlatformEnv>{
 return async c=>{
  for(const [name,value] of Object.entries(options.responseHeaders(c.req.path)))c.header(name,value);
  c.header('Cache-Control','private, no-store');c.header('Vary','Authorization, Origin');
  requireCondition(options.hosts.has(new URL(c.req.url).hostname),403,'host_rejected','請從自由工坊網站操作。');
  const origin=c.req.header('Origin');
  requireCondition(origin===undefined||options.origins.has(origin),403,'origin_rejected','操作來源不正確。');
  requireCondition(c.req.header('Cookie')===undefined&&c.req.header('X-CSRF-Token')===undefined,400,'ambiguous_credentials','請只使用 Agent 金鑰。');
  const actor=await authenticateAgent(pool,c.req.header('Authorization')??'');
  let delegated=false,accountStatus=200;
  const error=(id:string|number|null,code:number,message:string,status:400|200=400)=>{accountStatus=400;return c.json({jsonrpc:'2.0',id,error:{code,message}},status);};
  try{
   requireCondition(!actor.onboarding_required||Boolean(actor.onboarding_completed_at),403,'onboarding_required','請先選擇主要公會。');
   if(c.req.method!=='POST'){accountStatus=405;c.header('Allow','POST');return c.body(null,405);}
   requireCondition(/^application\/json[ \t]*(?:;|$)/i.test(c.req.header('Content-Type')??''),415,'json_required','操作需要 JSON。');
   const accept=c.req.header('Accept')??'';
   requireCondition(accept.split(',').some(t=>/^application\/json(?:\s*;|\s*$)/i.test(t.trim()))&&accept.split(',').some(t=>/^text\/event-stream(?:\s*;|\s*$)/i.test(t.trim())),406,'mcp_accept_required','請接受 application/json 與 text/event-stream。');
   requireCondition(Number(c.req.header('Content-Length')??0)<=options.bodyLimit,413,'body_too_large','內容過長。');
   let size=0;const chunks:Uint8Array[]=[];const reader=c.req.raw.body?.getReader();
   if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>options.bodyLimit){await reader.cancel();throw new Problem(413,'body_too_large','內容過長。');}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return error(null,-32700,'Parse error');}
   const parsed=envelope.safeParse(raw);if(!parsed.success)return error(null,-32600,'Invalid Request');
   const {id,method,params}=parsed.data;
   // Missing headers default to the legacy version, which requires batching
   // and is deliberately unsupported. Initialization itself needs no header.
   const version=c.req.header('MCP-Protocol-Version')??(method==='initialize'?undefined:'2025-03-26');
   if(version!==undefined&&!mcpVersions.some(v=>v===version))return error(id??null,-32600,'Unsupported protocol version');
   if(id===undefined){
    if(method==='notifications/initialized'&&emptyParams.safeParse(params??{}).success)return c.body(null,202);
    accountStatus=400;return c.body(null,400);
   }
   if(method==='initialize'){
    const input=initialize.safeParse(params);if(!input.success)return error(id,-32602,'Invalid params');
    return c.json({jsonrpc:'2.0',id,result:{protocolVersion:mcpVersions.find(v=>v===input.data.protocolVersion)??latest,capabilities:{tools:{listChanged:false}},serverInfo:{name:'freedom-workshop',version:'1.0.0'}}});
   }
   if(method==='ping'){
    if(!emptyParams.safeParse(params??{}).success)return error(id,-32602,'Invalid params');
    return c.json({jsonrpc:'2.0',id,result:{}});
   }
   if(method==='tools/list'){
    if(!emptyParams.safeParse(params??{}).success)return error(id,-32602,'Invalid params');
    // Re-authenticate immediately before projecting current scopes; no session cache.
    const current=await authenticateAgent(pool,c.req.header('Authorization')!);
    return c.json({jsonrpc:'2.0',id,result:{tools:tools.filter(({op})=>current.agent!.scopes.includes(op.scope)&&available(op,options.runtime,options.registered)).map(({tool})=>tool)}});
   }
   if(method!=='tools/call')return error(id,-32601,'Method not found');
   const input=call.safeParse(params);if(!input.success)return error(id,-32602,'Invalid params');
   const entry=tools.find(({op})=>op.id===input.data.name);
   if(!entry)return error(id,-32602,'Unknown tool');
   const args=input.data.arguments??{};
   if(!entry.validator.safeParse(args).success)return error(id,-32602,'Invalid tool arguments');
   if(!available(entry.op,options.runtime,options.registered)){
    accountStatus=403;const problem={code:'scope_required',detail:'Agent 沒有這項操作權限。',status:403};
    return c.json({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify(problem)}],structuredContent:problem}});
   }
   const path=entry.op.route.replace(/:([a-z_]+)/g,(_,name:string)=>encodeURIComponent(String(args[name])));
   const url=new URL(path,options.origin);
   if(args.query)for(const [name,value] of Object.entries(args.query as Record<string,unknown>))url.searchParams.set(name,String(value));
   const headers:Record<string,string>={Authorization:c.req.header('Authorization')!};
   if(entry.op.method!=='GET'){headers['Content-Type']='application/json';headers['Idempotency-Key']=String(args.idempotency_key);}
   if(entry.op.ifMatch)headers['If-Match']=`"${args.version}"`;
   delegated=true;
   const response=await options.dispatch(new Request(url,{method:entry.op.method,headers,...(entry.op.method!=='GET'?{body:JSON.stringify(args.body)}:{})}));
   const result=await response.json();
   return c.json({jsonrpc:'2.0',id,result:{isError:response.status>=400,content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}});
  }catch(e){accountStatus=e instanceof Problem?e.status:500;throw e;}
  finally{if(!delegated)await recordAgentResponse(pool,actor,accountStatus);}
 };
}
