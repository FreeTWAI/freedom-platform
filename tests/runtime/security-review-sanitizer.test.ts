import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {chromium,type Browser,type Page} from '@playwright/test';
import {serveStatic} from '@hono/node-server/serve-static';
import {serve} from '@hono/node-server';
import type {Server} from 'node:http';
import {sanitizeReadme} from '../../modules/shares/sanitize.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {serveBuildAssets} from '../../apps/platform-api/src/static-assets-node.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createShare} from '../../modules/shares/service.js';
import {refreshRepository} from '../../modules/shares/repository-cache.js';
import type {Actor} from '../../modules/identity-membership/service.js';

// A separate process makes an event-loop denial reproducible without hanging the runner.
test('bounded README whitespace cannot monopolize the sanitizer process',()=>{
 const source=`import {sanitizeReadme} from ${JSON.stringify(new URL('../../modules/shares/sanitize.ts',import.meta.url).href)};
 for (const suffix of ['x','/ x','title="safe"']) sanitizeReadme('<p'+' '.repeat(131072)+suffix+'>text</p>','fixture/repo');`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{timeout:2500,encoding:'utf8'});
 assert.equal(result.error,undefined,'128 KiB README whitespace must finish within 2.5 seconds: '+result.error?.message);
 assert.equal(result.status,0,result.stderr);
});

const execute='globalThis.securityReviewExecuted=true';
const attacks=[
 `<script>${execute}</script><script/x>${execute}</script><script>${execute}</script foo>`,
 `<!--><img src=x onerror="${execute}">--><p>safe</p>`,
 `<![CDATA[<img src=x onerror="${execute}">]]>`,
 `<a href=javascript:${execute}>bad</a><img src=x onerror=${execute}>`,
 `<a href="jav&#x61;script:${execute}">bad</a><a href="&#106avascript:${execute}">bad</a>`,
 `<a href="java&#9;script:${execute}">bad</a><a href="java&Tab;script:${execute}">bad</a>`,
 `<a href="javascript&colon;${execute}">bad</a><a href="data:text/html,<script>${execute}</script>">bad</a>`,
 `<a href="//evil.example/path">offsite link</a><img src="//evil.example/image">`,
 `<a href="https:\\evil.example">bad</a><a href=" https://safe.example/ ">good</a>`,
 `<table><a href="javascript:${execute}"><tr><td><p>nested</table></a>`,
 `<svg><foreignObject><p onmouseover="${execute}">x</p></foreignObject></svg>`,
 `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=${execute}>">`,
 `<template><img src=x onerror="${execute}"></template>`,
 `<noscript><p title="</noscript><img src=x onerror=${execute}>">x</p>`,
 `<base href="https://evil.example"><form action="https://evil.example"><input name=cookie></form>`,
 `<meta http-equiv=refresh content="0;url=javascript:${execute}">`,
 `<img src="https://raw.githubusercontent.com/fixture/repo/main/x" srcset="https://evil.example/x 1x" style="position:fixed" onerror="${execute}">`,
 `<p id=app name=location class=overlay style="background:url(javascript:${execute})">safe</p>`,
 `<a href="https://safe.example/" href="javascript:${execute}">duplicate</a>`,
 `<img src="https://raw.githubusercontent.com.evil.example/x"><img src="https://evil@raw.githubusercontent.com/x">`,
 `<a href="java\0script:${execute}">nul</a><img\0src=x onerror=${execute}>`,
 `<a href="ｊavascript:${execute}">unicode</a><a href="java\u2028script:${execute}">unicode</a>`,
 `<p title='\"><img src=x onerror="${execute}">'>attribute</p>`,
 `<textarea></textarea><xmp></xmp><iframe srcdoc='<script>${execute}</script>'></iframe>`,
 `<details open ontoggle="${execute}"><summary>open</summary></details>`,
 `<p>&lt;img src=x onerror=${execute}&gt;&amp;#60;script&amp;#62;</p>`,
 ...['\t','\n','\r','\u0001','\u007f','\u0085'].map(c=>`<a href="java${c}script:${execute}">control</a>`),
 ...['javascript:','data:','vbscript:','file:','http:'].map(s=>`<a href="${s}${execute}">scheme</a><img src="${s}${execute}">`),
 '<p><b><i>unclosed', '<p title="unfinished', '<div>'.repeat(100)+'bounded',
];

const url=process.env.TEST_DATABASE_URL;
assert.ok(url?.includes('/fp_'),'explicit disposable database required');
const schema=`fp_security_readme_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const origin=`http://127.0.0.1:${process.env.FREEDOM_E2E_PORT??46451}`;
const app=createApp(pool,origin,'local');
app.use('/*',serveBuildAssets('./apps/portal-web/dist'));
app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
let browser:Browser,page:Page,shareId:string,server:Server;
let upstreamHtml='';
const fetcher:typeof fetch=async input=>{
 const path=new URL(String(input)).pathname;
 if(path.endsWith('/readme'))return new Response(upstreamHtml);
 if(path.endsWith('/releases/latest'))return new Response(null,{status:404});
 return Response.json({id:91234,full_name:'fixture/security-readme',private:false,visibility:'public',archived:false,fork:false,owner:{id:91235,login:'fixture'},default_branch:'main',description:'Synthetic README',stargazers_count:1});
};
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 const actor={user_id:DEMO_USERS[0].user_id,community_id:DEMO_COMMUNITY,session_hash:randomUUID()} as Actor;
 await pool.query('UPDATE users SET email=$2,email_verified_at=now(),onboarding_required=false,onboarding_completed_at=now() WHERE user_id=$1',[actor.user_id,'security-readme@example.com']);
 await pool.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,[actor.session_hash,actor.user_id]);
 const share=await createShare(pool,{actor,body:{url:'https://github.com/fixture/security-readme'},operation:'POST /shares',key:randomUUID()},{fetcher});shareId=share.share_id;
 // Independently sanitize each input before assembling: a dropped unclosed raw-text element
 // must not accidentally mask a later attack in the same corpus.
 upstreamHtml=attacks.map(x=>sanitizeReadme(x,'fixture/security-readme')).join('\n');
 const repo=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[shareId])).rows[0].repo_id;
 await refreshRepository(pool,repo,{fetcher},true);
 server=await new Promise<Server>(resolve=>{const listener=serve({fetch:app.fetch,hostname:'127.0.0.1',port:Number(new URL(origin).port)},()=>resolve(listener as Server));});
 browser=await chromium.launch({headless:true});page=await browser.newPage({locale:'zh-TW'});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
});
after(async()=>{await browser?.close();if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
async function safeDom(selector:string){
 const unsafe=await page.locator(selector).evaluate(root=>Array.from(root.querySelectorAll('*')).flatMap(el=>{
  const out:string[]=[];
  if(/^(SCRIPT|STYLE|SVG|MATH|TEMPLATE|NOSCRIPT|IFRAME|OBJECT|EMBED|FORM|INPUT|BASE|META)$/.test(el.tagName))out.push(el.tagName);
  for(const a of el.attributes){if(/^(on|style$|srcset$|id$|name$|class$|data-)/i.test(a.name))out.push(a.name);if(['href','src'].includes(a.name)&&new URL(a.value,location.href).protocol!=='https:')out.push(a.value);}
  return out;
 }));
 assert.deepEqual(unsafe,[]);assert.equal(await page.evaluate(()=>Boolean((globalThis as any).securityReviewExecuted)),false);
}
function assertCsp(value:string|null){
 assert.ok(value);for(const directive of ["script-src 'self'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'"])assert.ok(value.includes(directive),value);
 assert.ok(!value.includes("'unsafe-inline'"));assert.ok(!value.includes("'unsafe-eval'"));
}
test('HTML parsing attacks stay inert in Chromium without relying on CSP',async()=>{
 for(const input of attacks){await page.setContent('<main>'+sanitizeReadme(input,'fixture/security-readme')+'</main>');await safeDom('main');}
 assert.throws(()=>sanitizeReadme('<div>'.repeat(101),'fixture/repo'),/nesting/);
 assert.throws(()=>sanitizeReadme('x'.repeat(1048577),'fixture/repo'),/too_large/);
 assert.throws(()=>sanitizeReadme('𠮷'.repeat(262145),'fixture/repo'),/too_large/);
});
test('public share final document and response CSP keep hostile README inert',async()=>{
 const response=await page.goto(`${origin}/s/${shareId}`);assert.equal(response?.status(),200);assertCsp(response?.headers()['content-security-policy']??null);
 await page.locator('.share-readme').waitFor();await safeDom('.share-readme');
 assert.equal(await page.locator('base,meta[http-equiv],script,iframe,form').count(),0);
});
test('built portal SharePage final DOM and response CSP keep hostile README inert',async()=>{
 const response=await page.goto(`${origin}/#home`);assertCsp(response?.headers()['content-security-policy']??null);
 await page.getByLabel('電子郵件',{exact:true}).fill('security-readme@example.com');
 await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
 const login=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login'));
 await page.getByRole('button',{name:'登入',exact:true}).click();
 const loggedIn=await login;assert.equal(loggedIn.status(),200,await loggedIn.text());
 await page.locator('.nav-primary').waitFor({state:'attached'});
 await page.evaluate(id=>{location.hash='#shares/'+id;},shareId);
 await page.locator('.share-readme').waitFor();await safeDom('.share-readme');
 assert.equal(await page.locator('.share-page base,.share-page meta,.share-page script,.share-page iframe').count(),0);
});

test('hidden share remains in the sharer contribution list with the waiting state and no public link',async()=>{
 await pool.query("UPDATE shares SET state='hidden' WHERE share_id=$1",[shareId]);
 await page.evaluate(()=>{location.hash='#me/credit';});
 const card=page.locator('.share-page article').filter({hasText:'fixture/security-readme'});
 await card.getByText('暫停公開，等待確認',{exact:false}).waitFor();
 assert.equal(await card.locator('a').count(),0);
 assert.match(await card.innerText(),/分享 1/);
 const response=await page.request.get(`${origin}/s/${shareId}`);assert.equal(response.status(),404);
});
