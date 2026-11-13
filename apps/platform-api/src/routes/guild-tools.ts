import {exchangeToolToken,toolTokenStatus,toolJwks,type ToolSigner} from '../../../../modules/guild-tools/tokens.js';
import {createOriginChallenge} from '../../../../modules/guild-tools/origin-proof.js';
import {Hono} from 'hono';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {changeTool,listTools,manageAccess,registerTool,toolContext} from '../../../../modules/guild-tools/service.js';
import {toolUrl} from '../../../../modules/guild-tools/validation.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import type {PreviewFetch} from '../../../../modules/community/link-preview.js';
// The preview script is a constant, allowed by its hash. Per-preview values travel in an inert
// JSON data block that the script parses, so no code is ever built from data; '<', '>' and '&'
// are escaped so the data cannot close its element.
const PREVIEW_SCRIPT=`const t=JSON.parse(document.getElementById('preview-data').textContent),f=document.querySelector('iframe');let ready=false,count=0,start=Date.now();const bounded=(v,n)=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;let c=0;for(const k in v)if(++c>n)return false;return true};f.src=t.entry_url;f.onload=()=>{t.nonce=crypto.randomUUID();f.contentWindow.postMessage({version:'freedom.guild-launchpad/v2',type:'init',tool_id:t.tool_id,guild_key:t.guild_key,nonce:t.nonce},t.profile==='origin'?t.origin:'*')};addEventListener('message',e=>{if(e.source!==f.contentWindow||e.origin!==(t.profile==='origin'?t.origin:'null'))return;if(Date.now()-start>=60000){start=Date.now();count=0}if(++count>120)return;const m=e.data;if(!bounded(m,8)||!bounded(m.payload,0)||typeof m.operation!=='string'||m.operation.length>40||m.version!=='freedom.guild-launchpad/v2'||m.tool_id!==t.tool_id||m.guild_key!==t.guild_key||m.nonce!==t.nonce||m.type!=='request'||typeof m.request_id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(m.request_id))return;const ok=m.operation==='context.get';f.contentWindow.postMessage({version:m.version,type:'response',tool_id:t.tool_id,guild_key:t.guild_key,nonce:t.nonce,request_id:m.request_id,ok,...(ok?{result:{guild:t.guild_key,tool:t.tool_id,theme:'light',locale:'zh-TW',signed_in:false,preview:true,platform_origin:t.platform_origin}}:{error:{code:'preview_only',message:'加入後才能使用'}})},t.profile==='origin'?t.origin:'*');if(ok&&!ready){ready=true;parent.postMessage({type:'guild-tool-preview-ready',id:t.preview_id},t.platform_origin)}});`;
const PREVIEW_SCRIPT_HASH=createHash('sha256').update(PREVIEW_SCRIPT).digest('base64');
const dataJson=(value:unknown)=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
export function createPublicGuildToolRoutes(pool:Pool,origin:string,signer?:ToolSigner){
 const app=new Hono();
 app.get('/.well-known/guild-tool-jwks.json',c=>{c.header('Cache-Control','no-store');return c.json(toolJwks(signer));});
 app.post('/api/v1/public/guild-tool-token/status',async c=>{c.header('Cache-Control','no-store');return c.json(await toolTokenStatus(pool,await c.req.json(),origin,signer));});
 app.get('/api/v1/public/guilds/:guild/tools',async c=>c.json(await listTools(pool,c.req.param('guild'))));
 app.get('/guild-tool-preview/:id',async c=>{
 requireCondition(/^[0-9a-f-]{36}$/.test(c.req.param('id')),404,'not_found','找不到預覽。');
 const r=(await pool.query("SELECT tool_id,guild_key,entry_url,origin,profile FROM guild_tools WHERE id=$1 AND state='pending' AND updated_at>clock_timestamp()-interval '1 hour'",[c.req.param('id')])).rows[0];
 requireCondition(r,404,'not_found','預覽已過期，請重新登錄。');const u=toolUrl(r.entry_url,origin);requireCondition(u.origin===r.origin,404,'not_found','找不到預覽。');
 const data=dataJson({...r,nonce:randomUUID(),preview_id:c.req.param('id'),platform_origin:origin});
 c.header('Content-Security-Policy',`default-src 'none'; script-src 'sha256-${PREVIEW_SCRIPT_HASH}'; frame-src ${u.origin}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`);
 return c.html(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>工具預覽</title><iframe title="工具預覽" sandbox="${r.profile==='origin'?'allow-scripts allow-same-origin':'allow-scripts'}" width="100%" height="520" referrerpolicy="no-referrer"></iframe><script type="application/json" id="preview-data">${data}</script><script>${PREVIEW_SCRIPT}</script></html>`);
 });return app;
}
export function createGuildToolRoutes(pool:Pool,origin:string,fetcher?:PreviewFetch,signer?:ToolSigner){
 const app=new Hono<PlatformEnv>();
 app.post('/guilds/:guild/tools/:tool/token',async c=>{c.header('Cache-Control','no-store');return c.json(await exchangeToolToken(pool,c.get('actor'),c.req.param('guild'),c.req.param('tool'),await c.req.json(),origin,signer));});
 app.get('/guilds/:guild/tools/access',async c=>c.json({...await manageAccess(pool,c.get('actor'),c.req.param('guild')),registration_available:Boolean(fetcher),token_exchange_available:Boolean(signer)}));
 app.get('/guilds/:guild/tools/:tool/context',async c=>c.json(await toolContext(pool,c.get('actor'),c.req.param('guild'),c.req.param('tool'))));
 app.post('/guilds/:guild/tools/origin-challenges',async c=>{requireCondition(fetcher,503,'tool_egress_unavailable','此環境尚未安裝安全網址檢查。');return c.json(await createOriginChallenge(pool,c.get('actor'),c.req.param('guild'),await c.req.json(),origin),201);});
 app.post('/guilds/:guild/tools',async c=>c.json(await registerTool(pool,await moduleCommand(c),c.req.param('guild'),origin,fetcher),201));
 for(const action of ['accept','disable','report'] as const)app.post(`/guilds/:guild/tools/:tool/${action}`,async c=>c.json(await changeTool(pool,await moduleCommand(c),c.req.param('guild'),c.req.param('tool'),action)));
 return app;
}
