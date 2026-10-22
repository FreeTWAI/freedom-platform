import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {publicSkillPath,skillAccountHref,skillAcquisitionFromSearch,skillReadingPath,validateSkillReturn} from '../../packages/shared/skill-acquisition.js';
import {publicSkillAcquisition,skillAcquisitionCss} from '../../modules/development/skill-acquisition.js';

const book='/development/skills/social-post';
const submission='/development/submissions/b371a8d0-0453-4e7e-8730-03cc9803f4e8';
for (const path of [book,submission]) {
  test(`public reading path round-trips through registration and login: ${path}`,()=>{
    assert.equal(publicSkillPath(path),path);
    for(const register of [false,true]){
      const href=skillAccountHref(path,7,register)!;
      const query=new URL(href,'https://fixture.invalid').search;
      assert.deepEqual(skillAcquisitionFromSearch(query),{path,intro:7});
      assert.equal(skillReadingPath(skillAcquisitionFromSearch(query)!),path+'?intro=7#skill-use-title');
      assert.equal(new URLSearchParams(query).get('join'),register?'1':null);
    }
  });
}
for(const path of ['https://evil.invalid/','//evil.invalid','/\\evil.invalid','/development/skills/../admin',
  '/development/skills/%2e%2e','/development/skills/social-post?token=secret','/development/skills/social-post#private',
  '/development/skills/social-post/SKILL.md','/development/skills/social-post.md','/development/skills/'+'a'.repeat(65),
  book+'\n',book+'\r',submission+'\n',book+' ', '/development/submissions/not-a-uuid','/api/v1/me/skill-books','/events/b371a8d0-0453-4e7e-8730-03cc9803f4e8','/shops/demo']) {
  test(`non-reading destination is refused: ${path}`,()=>{
    assert.equal(publicSkillPath(path),null);
    assert.equal(skillAccountHref(path,1,true),null);
    assert.equal(skillReadingPath({path,intro:1}),null);
    assert.equal(skillAcquisitionFromSearch('?return_to='+encodeURIComponent(path)),null);
  });
}
test('duplicates cannot choose one of two return destinations',()=>{
  assert.equal(skillAcquisitionFromSearch('?return_to='+book+'&return_to='+submission),null);
  assert.equal(skillAcquisitionFromSearch('?join=1'),null);
});
test('only an authored introduction number survives; unrelated tracking and secrets are discarded',()=>{
  for(const intro of ['7\n','7\r',' 7','0','01','101','-1','1.5','1e1','<script>','7&token=secret']){
    assert.deepEqual(skillAcquisitionFromSearch('?return_to='+book+'&skill_intro='+encodeURIComponent(intro)),{path:book,intro:null});
  }
  assert.deepEqual(skillAcquisitionFromSearch('?return_to='+book+'&skill_intro=7&skill_intro=8'),{path:book,intro:null});
  assert.equal(skillReadingPath(skillAcquisitionFromSearch('?return_to='+book+'&skill_intro=100&token=secret&ref=someone')!),book+'?intro=100#skill-use-title');
  assert.equal(skillAccountHref(book,null,true),'/?join=1&return_to=%2Fdevelopment%2Fskills%2Fsocial-post');
});
test('return validation is an anonymous no-store read of the canonical path, not the selected quote',async()=>{
  const calls: [RequestInfo|URL,RequestInit|undefined][]=[];
  const fetcher:typeof fetch=async(input,init)=>{calls.push([input,init]);return new Response('<html/>',{headers:{'content-type':'text/html; charset=utf-8'}});};
  assert.equal(await validateSkillReturn({path:book,intro:7},{fetcher}),true);
  assert.equal(calls.length,1);assert.equal(calls[0][0],book);
  assert.equal(calls[0][1]?.credentials,'omit');assert.equal(calls[0][1]?.cache,'no-store');
  assert.equal(calls[0][1]?.redirect,'error');assert.equal(calls[0][1]?.method,'GET');assert.ok(calls[0][1]?.signal);
});
for(const status of [401,403,404,410,500]){
  test(`unavailable publication ${status} cannot receive an authenticated return`,async()=>{
    assert.equal(await validateSkillReturn({path:submission,intro:null},{fetcher:async()=>new Response('',{status})}),false);
  });
}
test('JSON or redirected responses are not accepted as a public reading page',async()=>{
  assert.equal(await validateSkillReturn({path:book,intro:null},{fetcher:async()=>Response.json({ok:true})}),false);
  const response=new Response('',{headers:{'content-type':'text/html'}});Object.defineProperty(response,'redirected',{value:true});
  assert.equal(await validateSkillReturn({path:book,intro:null},{fetcher:async()=>response}),false);
});
test('invalid paths, aborted attempts and network failures leave the new account usable',async()=>{
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw new Error('offline');};
  assert.equal(await validateSkillReturn({path:'https://evil.invalid',intro:null},{fetcher}),false);assert.equal(calls,0);
  const controller=new AbortController();controller.abort();
  assert.equal(await validateSkillReturn({path:book,intro:null},{fetcher,signal:controller.signal}),false);assert.equal(calls,0);
  assert.equal(await validateSkillReturn({path:book,intro:null},{fetcher}),false);assert.equal(calls,1);
});
test('an in-progress read aborts on mode change; a late success is not accepted',async()=>{
  const controller=new AbortController();let release!:(r:Response)=>void;let signal:AbortSignal|null|undefined;
  const result=validateSkillReturn({path:book,intro:7},{signal:controller.signal,fetcher:async(_input,init)=>{signal=init?.signal;return new Promise(resolve=>{release=resolve;});}});
  controller.abort();assert.equal(signal?.aborted,true);release(new Response('',{headers:{'content-type':'text/html'}}));
  assert.equal(await result,false);
});
test('content checking has a bounded deadline instead of blocking completed registration forever',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const result=validateSkillReturn({path:book,intro:null},{fetcher:async(_input,init)=>new Promise((_resolve,reject)=>{
    init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  })});
  t.mock.timers.tick(8_000);assert.equal(await result,false);
});
test('CTA remains readable, actionable and honest with JavaScript disabled',()=>{
  const html=publicSkillAcquisition(book,7);
  assert.ok(html.includes('不用註冊就能閱讀'));assert.ok(html.includes('依加入資格領取指定技能書'));
  assert.ok(html.includes('外部工具、模型與服務的授權及費用'));assert.ok(html.includes('href="#skill-use-title"'));
  assert.ok(html.includes('join=1&amp;return_to='));assert.ok(html.includes('&amp;skill_intro=7'));
  assert.ok(html.includes('data-skill-library href="/#skills" hidden'));assert.ok(!html.includes('<form'));
  assert.ok(!html.includes('position:fixed'));assert.match(skillAcquisitionCss,/min-height:44px/);
  assert.equal(publicSkillAcquisition('javascript:alert(1)'), '');
});
const script=await readFile(new URL('../../apps/portal-web/public/skill-acquisition.js',import.meta.url),'utf8');
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function harness(fetcher: typeof fetch, present=true){
  const selectors=['data-skill-join','data-skill-login','data-skill-library','data-skill-guilds','data-skill-account-status'];
  const nodes=Object.fromEntries(selectors.map(name=>['['+name+']',{hidden:name==='data-skill-library'||name==='data-skill-guilds',textContent:''}]));
  const listeners:Record<string,()=>void>={};
  const document={visibilityState:'visible',querySelectorAll:()=>present?[{querySelector:(name:string)=>nodes[name]}]:[],addEventListener:(name:string,callback:()=>void)=>{listeners[name]=callback;}};
  runInNewContext(script,{document,window:{addEventListener:(name:string,callback:()=>void)=>{listeners[name]=callback;}},fetch:fetcher,AbortController,setTimeout,clearTimeout});
  return {nodes,listeners,document};
}
test('anonymous readers get signup while known members get the existing library, with no write',async()=>{
  for(const member of [false,true]){
    const requests:RequestInit[]=[];
    const h=harness(async(path,init)=>{requests.push(init!);return String(path).endsWith('/site')?Response.json({registration_enabled:true}):member?Response.json({user:{user_id:'synthetic-member'}}):new Response('',{status:401});});
    await flush();assert.equal(h.nodes['[data-skill-join]'].hidden,member);
    assert.equal(h.nodes['[data-skill-library]'].hidden,!member);assert.equal(requests.length,2);
    assert.ok(requests.every(init=>init.method===undefined&&init.body===undefined&&init.cache==='no-store'));
    assert.deepEqual(requests.map(init=>init.credentials),['omit','same-origin']);h.listeners.pagehide();
  }
});
test('closed registration keeps login and reading, not an unavailable signup promise',async()=>{
  const h=harness(async path=>String(path).endsWith('/site')?Response.json({registration_enabled:false}):new Response('',{status:401}));
  await flush();assert.equal(h.nodes['[data-skill-join]'].hidden,true);assert.equal(h.nodes['[data-skill-login]'].hidden,false);
  assert.match(h.nodes['[data-skill-account-status]'].textContent,/暫停新帳號註冊/);h.listeners.pagehide();
});
test('status errors preserve working links and do not claim the reader is logged in',async()=>{
  const h=harness(async()=>{throw new Error('offline');});await flush();
  assert.equal(h.nodes['[data-skill-join]'].hidden,false);assert.equal(h.nodes['[data-skill-library]'].hidden,true);
  assert.match(h.nodes['[data-skill-account-status]'].textContent,/暫時無法確認/);h.listeners.pagehide();
});
test('return-event bursts coalesce; hidden pages cancel and ignore old member replies',async()=>{
  const pending:{resolve:(r:Response)=>void;signal:AbortSignal}[]=[];
  const h=harness(async(_path,init)=>new Promise(resolve=>pending.push({resolve,signal:init!.signal!})));
  h.listeners.focus();h.listeners.pageshow();assert.equal(pending.length,2);
  h.document.visibilityState='hidden';h.listeners.visibilitychange();assert.ok(pending.every(call=>call.signal.aborted));
  pending[0].resolve(Response.json({registration_enabled:true}));pending[1].resolve(Response.json({user:{user_id:'old'}}));await flush();
  assert.equal(h.nodes['[data-skill-library]'].hidden,true);
  h.document.visibilityState='visible';h.listeners.visibilitychange();assert.equal(pending.length,4);
  pending[2].resolve(Response.json({registration_enabled:false}));pending[3].resolve(new Response('',{status:401}));await flush();
  assert.match(h.nodes['[data-skill-account-status]'].textContent,/暫停/);h.listeners.pagehide();
});
test('pages without a skill CTA perform no acquisition reads',async()=>{
  let calls=0;harness(async()=>{calls++;return Response.json({});},false);await flush();assert.equal(calls,0);
});
