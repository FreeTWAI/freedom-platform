import {z} from 'zod';
export const BRIDGE_VERSION='freedom.guild-launchpad/v2' as const;
// Native routes remain owned by the platform. Only the arcade may opt into a frame.
export const NATIVE_TOOL_ROUTES=[
 'guild_commerce_sales/store','guild_commerce_sales/retail-kit','guild_commerce_sales/rehearsal',
 'guild_product_quality_supply/catalog','guild_product_quality_supply/supplier-kit',
 'guild_marketing/marketing','guild_ai_vibe/cocreation','guild_ai_project/work',
 'guild_opportunity_partnership/engagement','guild_talent_direction/assessment',
 'guild_talent_direction/village','guild_custom_032fd02e754549e9b1e056e2b95b8d50/tester-map','guild_ar/ar',
] as const;
export const isNativeTool=(guild:string,tool:string)=>NATIVE_TOOL_ROUTES.some(route=>route===guild+'/'+tool);
export const MAX_MESSAGE_BYTES=1400000;
export const SCOPES=['context:read','share:compose','device-state:own','ui:open','navigate','resize','session:exchange'] as const;
export const toolInput=z.object({tool_id:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),title:z.string().trim().min(1).max(6),entry_url:z.string().max(2048),bridge_version:z.literal(BRIDGE_VERSION),profile:z.enum(['sandboxed','origin']).default('sandboxed'),scopes:z.array(z.enum(SCOPES)).max(7).refine(a=>new Set(a).size===a.length&&a.includes('context:read')),permissions:z.array(z.enum(['downloads','fullscreen'])).max(2).default([])}).strict().refine(t=>t.profile==='origin'||!t.scopes.includes('session:exchange'));
export type ToolInput=z.infer<typeof toolInput>;
export type ToolRecord=ToolInput & {id:string;guild_key:string;revision:number;state:'pending'|'enabled'|'disabled';origin:string};
const key=z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/).refine(k=>!['__proto__','constructor','prototype'].includes(k));
export const operationPayloads={
 'context.get':z.object({}).strict(),
 'session.exchange':z.object({}).strict(),
 'share.compose':z.object({kind:z.enum(['repository','event','work','link']).optional(),url:z.string().url().max(2048).optional(),text:z.string().max(500).optional(),image:z.instanceof(Blob).refine(b=>b.size<=2*1024*1024&&['image/png','image/jpeg','image/webp'].includes(b.type)).optional()}).strict(),
 'device-state.get':z.object({key}).strict(),
 'device-state.put':z.object({key,value:z.string().max(1300000).nullable()}).strict(),
 'ui.open':z.object({panel:z.literal('game-upload')}).strict(),
 navigate:z.object({action:z.enum(['start','work','skills','tools','information'])}).strict(),
 resize:z.object({height:z.number().int().min(240).max(1600)}).strict(),
} as const;
export type Operation=keyof typeof operationPayloads;
export const operationScope:Record<Operation,typeof SCOPES[number]>={'session.exchange':'session:exchange','context.get':'context:read','share.compose':'share:compose','device-state.get':'device-state:own','device-state.put':'device-state:own','ui.open':'ui:open',navigate:'navigate',resize:'resize'};
const envelope=z.object({version:z.literal(BRIDGE_VERSION),type:z.literal('request'),tool_id:key,guild_key:z.string().max(80).regex(/^guild_[a-zA-Z0-9_]+$/),nonce:z.string().uuid(),request_id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),operation:z.enum(Object.keys(operationPayloads) as [Operation,...Operation[]]),payload:z.unknown()}).strict();
export function parseRequest(value:unknown){
 // Reject unexpected structure before serializing: a hostile frame cannot force a
 // recursive stringify of an arbitrary tree, cyclic object or millions of keys.
 const boundedObject=(v:unknown,max:number)=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;let count=0;for(const _key in v)if(++count>max)return false;return true;};
 if(!boundedObject(value,8))return null;
 const parsed=envelope.safeParse(value);if(!parsed.success)return null;
 if(!boundedObject(parsed.data.payload,4))return null;
 const payload=operationPayloads[parsed.data.operation].safeParse(parsed.data.payload);
 if(!payload.success)return null;const result={...parsed.data,payload:payload.data};
 try{if(new TextEncoder().encode(JSON.stringify(result)).length>MAX_MESSAGE_BYTES)return null;}catch{return null;}
 return result;
}
export function frameSandbox(tool:Pick<ToolRecord,'profile'|'permissions'>){return 'allow-scripts'+(tool.profile==='origin'?' allow-same-origin':'')+(tool.permissions.includes('downloads')?' allow-downloads':'');}
