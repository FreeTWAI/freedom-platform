import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('../../apps/portal-web/src/modules/SkillShare.tsx',import.meta.url),'utf8');
const actionSource=readFileSync(new URL('../../apps/portal-web/src/useLocalAction.ts',import.meta.url),'utf8');
const origin='https://workshop.example.test';
const content={introductions:['分享介紹一','分享介紹二'],illustration_url:'/brand/skill-illustrations/social-post.webp',illustration_alt:'合成介紹圖片'};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
type Node={type:string;props:any};
const all=(tree:any):Node[]=>!tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(all)];
function harness(){
  const hooks:any[]=[],effects:(()=>void)[]=[],requests:any[]=[],copies:string[]=[],shares:any[]=[],timers=new Map<number,{fn:()=>void;ms:number}>();
  let index=0,timerId=0;
  const props:any={bookId:'social-post',title:'合成技能書'};
  const effect=(fn:()=>unknown,deps:unknown[])=>{const i=index++;if(!hooks[i]||deps.some((value,n)=>value!==hooks[i].deps[n])){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn();});}};
  const react={useId:()=> 'skill-share',useRef:(value:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},useCallback:(fn:any)=>fn,useLayoutEffect:effect,useEffect:effect,useState:(value:any)=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];}};
  const elements=new Map<any,any>();
  const jsx=(type:string,p:any)=>{if(p?.ref){if(!elements.has(p.ref))elements.set(p.ref,{open:false,focused:false,selected:false,showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},select(){this.selected=true;}});p.ref.current=elements.get(p.ref);}return {type,props:p};};
  const navigator={share:async(data:any)=>{shares.push(data);},clipboard:{writeText:async(text:string)=>{copies.push(text);}}};
  const actionModule={exports:{} as any};runInNewContext(transformSync(actionSource,{loader:'ts',format:'cjs'}).code,{module:actionModule,exports:actionModule.exports,require:()=>react});
  const module={exports:{} as any};runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{
    module,exports:module.exports,crypto:webcrypto,URL,AbortController,window:{location:{origin}},navigator,
    setTimeout:(fn:()=>void,ms:number)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:(id:number)=>timers.delete(id),
    fetch:(path:string,options:any)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),
    require:(name:string)=>{if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../useLocalAction')return actionModule.exports;if(name==='../language')return {useLanguage:()=>({t:(key:string)=>key})};if(name.endsWith('.css'))return {};throw Error(name);},
  });
  const render=()=>{index=0;const tree=module.exports.SkillShare(props);while(effects.length)effects.shift()!();return tree;};
  const view=()=>{render();return render();};
  const node=(predicate:(node:Node)=>boolean)=>all(view()).find(predicate);
  const button=(label:string)=>node(n=>n.type==='button'&&(n.props.children===label||n.props['aria-label']===label));
  const click=(label:string)=>{const item=button(label);assert.ok(item,label);assert.ok(!item.props.disabled,label+' enabled');return item.props.onClick();};
  const request=(path:string)=>{const item=requests.findLast(r=>r.path===path);assert.ok(item,path);return item;};
  const response=(path:string,body:any,ok=true)=>request(path).resolve({ok,status:ok?200:503,json:async()=>body});
  const expire=async()=>{for(const [id,timer] of [...timers]){assert.equal(timer.ms,8000);timers.delete(id);timer.fn();}await flush();view();};
  const start=async()=>{click('分享技能');await flush();view();};
  const text=()=>all(view()).map(n=>typeof n.props.children==='string'?n.props.children:'').join('\n');
  const url=()=>node(n=>n.props.className==='skill-share-url')?.props.children;
  const close=()=>click('關閉分享預覽');
  const unmount=()=>{for(const hook of hooks)hook?.cleanup?.();};
  return {props,requests,copies,shares,timers,module,navigator,view,node,button,click,request,response,expire,start,text,url,close,unmount};
}
const introPath='/api/v1/skills/social-post/share-content';
async function anonymous(h:ReturnType<typeof harness>){h.response('/api/v1/session',{});await flush();}
async function loaded(h:ReturnType<typeof harness>){h.response(introPath,content);await flush();h.view();}

test('a stalled introduction request reaches the existing plain-link fallback and remains retryable',async()=>{
  const h=harness();await h.start();await anonymous(h);assert.equal(h.button('正在準備分享…')?.props.disabled,true);
  await h.expire();assert.equal(h.request(introPath).options.signal.aborted,true);assert.ok(h.text().includes('分享介紹暫時無法載入'));
  assert.equal(h.url(),origin+'/development/skills/social-post');await h.click('複製連結');assert.deepEqual(h.copies,[h.url()]);
  h.click('重試');await flush();await anonymous(h);await loaded(h);assert.ok(h.text().includes('分享介紹'));assert.equal(h.button('複製介紹與連結')?.props.disabled,false);assert.equal(h.timers.size,0);
});

test('a stalled introduction response body is bounded, not only its headers',async()=>{
  const h=harness();await h.start();await anonymous(h);h.request(introPath).resolve({ok:true,json:()=>new Promise(()=>{})});await flush();
  await h.expire();assert.ok(h.text().includes('分享介紹暫時無法載入'));assert.equal(h.button('複製連結')?.props.disabled,false);
});

for(const stage of ['session','session-body','promotion','promotion-body'])test(`stalled ${stage} falls back to the public reading URL without replaying tracking writes`,async()=>{
  const h=harness();await h.start();await loaded(h);
  if(stage==='session-body')h.request('/api/v1/session').resolve({ok:true,json:()=>new Promise(()=>{})});
  if(stage.startsWith('promotion')){h.response('/api/v1/session',{csrf_token:'synthetic-csrf'});await flush();if(stage==='promotion-body')h.request('/api/v1/promotion/links').resolve({ok:true,json:()=>new Promise(()=>{})});}
  assert.equal(h.button('複製介紹與連結')?.props.disabled,true);await h.expire();
  assert.match(h.url(),/^https:\/\/workshop\.example\.test\/development\/skills\/social-post\?intro=[12]$/);
  assert.equal(h.button('複製介紹與連結')?.props.disabled,false);assert.ok(h.text().includes('使用公開介紹連結分享'));assert.ok(!h.text().includes('登入後分享可累積'));
  await h.click('複製介紹與連結');await flush();await h.click('分享');await flush();assert.equal(h.copies.length,1);assert.equal(h.shares.length,1);
  assert.equal(h.requests.filter(r=>r.path==='/api/v1/promotion/links').length,stage.startsWith('promotion')?1:0);assert.equal(h.timers.size,0);
});

test('late session completion after deadline cannot initiate a tracking POST',async()=>{
  const h=harness();await h.start();await loaded(h);await h.expire();const prior=h.url();h.response('/api/v1/session',{csrf_token:'synthetic-csrf'});await flush();
  assert.equal(h.requests.filter(r=>r.path==='/api/v1/promotion/links').length,0);assert.equal(h.url(),prior);
});

test('late successful tracking cannot replace the already offered fallback or claim points',async()=>{
  const h=harness();await h.start();await loaded(h);h.response('/api/v1/session',{csrf_token:'synthetic-csrf'});await flush();await h.expire();const prior=h.url();
  h.response('/api/v1/promotion/links',{path:'/go/abcdefghij',points:{week:99,all:99}});await flush();assert.equal(h.url(),prior);assert.ok(!h.text().includes('99 分'));
});

test('late introduction cannot replace fallback or a later retry result even if transport ignores abort',async()=>{
  const h=harness();await h.start();await anonymous(h);const old=h.request(introPath);await h.expire();
  h.click('重試');await flush();await anonymous(h);h.response(introPath,{...content,introductions:['新版介紹']});await flush();h.view();
  old.resolve({ok:true,json:async()=>({...content,introductions:['舊版介紹']})});await flush();assert.ok(h.text().includes('新版介紹'));assert.ok(!h.text().includes('舊版介紹'));assert.equal(h.timers.size,0);
});

test('successful tracking retains the same intro, link and real returned point counts',async()=>{
  const h=harness();await h.start();await loaded(h);h.response('/api/v1/session',{csrf_token:'synthetic-csrf'});await flush();h.response('/api/v1/promotion/links',{path:'/go/abcdefghij',points:{week:2,all:7}});await flush();
  assert.match(h.url(),/\/go\/abcdefghij\?intro=[12]$/);assert.equal(h.timers.size,0);await h.click('複製介紹與連結');assert.ok(h.copies[0].endsWith(h.url()));
  assert.equal(h.request(introPath).options.credentials,'omit');assert.equal(h.request('/api/v1/promotion/links').options.method,'POST');
});

for(const action of ['close','book','parent','unmount'])test(`${action} cancels outstanding requests and ignores their late results`,async()=>{
  const h=harness();await h.start();await loaded(h);const session=h.request('/api/v1/session');
  if(action==='close')h.close();else if(action==='book'){h.props.bookId='editkin';h.view();}else if(action==='parent'){h.props.active=false;h.view();}else h.unmount();await flush();
  assert.equal(session.options.signal.aborted,true);assert.equal(h.timers.size,0);session.resolve({ok:true,json:async()=>({csrf_token:'synthetic-csrf'})});await flush();
  assert.equal(h.requests.filter(r=>r.path==='/api/v1/promotion/links').length,0);assert.equal(h.copies.length,0);assert.equal(h.shares.length,0);
});

test('published submission shares use the same bounded fallback and keep their own public destination',async()=>{
  const h=harness();delete h.props.bookId;h.props.submissionId='17c80987-1d06-4eb3-9cc4-5cc03a4987ec';await h.start();await anonymous(h);await h.expire();
  assert.equal(h.url(),origin+'/development/submissions/'+h.props.submissionId);await h.click('複製連結');assert.equal(h.copies[0],h.url());
});

test('an already cancelled public-content read never starts a network request or leaks a timer',async()=>{
  const h=harness(),controller=new AbortController();controller.abort();await assert.rejects(h.module.exports.fetchSkillShareContent('social-post',controller.signal));assert.equal(h.requests.length,0);assert.equal(h.timers.size,0);
});

test('session, tracking request and tracking body share one unchanged deadline',async()=>{
  const h=harness();await h.start();await loaded(h);const [timer]=h.timers.keys();assert.equal(h.timers.size,1);
  let finishSession!:(value:unknown)=>void,finishTracking!:(value:unknown)=>void;
  h.request('/api/v1/session').resolve({ok:true,json:()=>new Promise(resolve=>{finishSession=resolve;})});await flush();assert.deepEqual([...h.timers.keys()],[timer]);
  finishSession({csrf_token:'synthetic-csrf'});await flush();assert.deepEqual([...h.timers.keys()],[timer]);
  h.request('/api/v1/promotion/links').resolve({ok:true,json:()=>new Promise(resolve=>{finishTracking=resolve;})});await flush();assert.deepEqual([...h.timers.keys()],[timer]);
  await h.expire();const fallback=h.url();finishTracking({path:'/go/abcdefghij',points:{week:3,all:7}});await flush();assert.equal(h.url(),fallback);assert.equal(h.timers.size,0);
});

for(const action of ['book','parent','unmount'])test(`${action} before introduction resolves clears both deadlines and never opens the old preview`,async()=>{
  const h=harness();await h.start();const intro=h.request(introPath),session=h.request('/api/v1/session');
  if(action==='book'){h.props.bookId='editkin';h.view();}else if(action==='parent'){h.props.active=false;h.view();}else h.unmount();await flush();
  assert.equal(intro.options.signal.aborted,true);assert.equal(session.options.signal.aborted,true);assert.equal(h.timers.size,0);
  intro.resolve({ok:true,json:async()=>content});session.resolve({ok:true,json:async()=>({csrf_token:'synthetic-csrf'})});await flush();
  if(action!=='unmount')assert.equal(h.node(n=>n.type==='dialog')?.props.ref.current.open,false);
  assert.equal(h.requests.length,2);assert.equal(h.copies.length,0);assert.equal(h.shares.length,0);
});

for(const [file,signature,component,props] of [
  ['SkillBookIntro.tsx','export function SkillBookIntro','SkillBookIntro',{book:{id:'social-post',title:'合成技能書',description:'合成用途',repository_url:'https://example.test/source'}}],
  ['CommunitySkillBooks.tsx','function SubmissionIntro','SubmissionIntro',{item:{submission_id:'17c80987-1d06-4eb3-9cc4-5cc03a4987ec',title:'合成投稿',description:'合成用途',relationship:'recommender',source:{repository_url:'https://example.test/source',repository_full_name:'example/source',license_spdx:'MIT',commit_sha:''}}}],
] as const)test(`${component} retains its visited share child and propagates the parent reading state`,()=>{
  const text=readFileSync(new URL('../../apps/portal-web/src/modules/'+file,import.meta.url),'utf8');
  const start=text.indexOf(signature);assert.ok(start>=0);
  const end=file==='SkillBookIntro.tsx'?text.indexOf('\n\n\n// Copy is',start):text.length;
  const componentSource=text.slice(start,end).replace('export function SkillBookIntro','function SkillBookIntro');
  const hooks:any[]=[],refs=new Map<any,any>();let index=0;
  const react={useState:(value:any)=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],(value:any)=>hooks[i]=value];},useRef:(value:any)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},useId:()=> 'intro',useEffect:()=>{}};
  const jsx=(type:string,props:any)=>{if(props?.ref){if(!refs.has(props.ref))refs.set(props.ref,{open:false,showModal(){this.open=true;},close(){this.open=false;},focus(){}});props.ref.current=refs.get(props.ref);}return {type,props};};
  const code=transformSync(componentSource+'\nexports.component='+component+';',{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
  const exports:any={};runInNewContext(code,{exports,...react,URL,AbortController,useSkillDiscovery:()=>({data:null}),httpsLink:(value:string|undefined)=>value??null,submissionSharePath:()=>'/development/submissions/test',skillSharePath:()=>'/development/skills/social-post',isSkillIllustrationUrl:()=>false,relationshipLabels:{},client:{csrfToken:'test'},sessionClient:{csrfToken:'test'},isStorefrontReading:()=>false,
    ...Object.fromEntries(['SkillShare','SkillBookBadges','SkillBookCover','SkillBookSourceAccount','SkillBookStar','EventOutcomeBacklinks','DevelopmentEntry','CommunityBadge','GitHubSourceLinks','SkillInstall','AuthorClaimPanel','StorefrontBookUsage'].map(name=>[name,name])),
    require:()=>({jsx,jsxs:jsx}),
  });
  const render=()=>{index=0;return exports.component(props);};
  const nodes=()=>all(render());
  const shares=()=>nodes().filter(n=>n.type==='SkillShare');
  assert.equal(shares().length,component==='SkillBookIntro'?0:1);
  if(shares().length)assert.equal(shares()[0].props.active,false);
  nodes().find(n=>n.type==='button'&&n.props['aria-haspopup']==='dialog')!.props.onClick();
  assert.equal(shares().length,1);assert.equal(shares()[0].props.active,true);
  nodes().find(n=>n.type==='button'&&n.props['aria-label']==='關閉技能書介紹')!.props.onClick();
  assert.equal(shares().length,1);assert.equal(shares()[0].props.active,false);
  nodes().find(n=>n.type==='button'&&n.props['aria-haspopup']==='dialog')!.props.onClick();
  assert.equal(shares().length,1);assert.equal(shares()[0].props.active,true);
});


test('inactive parent keeps the same dialog shell, blocks hidden loads and reopens with fresh work',async()=>{
  const h=harness();await h.start();await anonymous(h);const old=h.request(introPath),shell=h.node(n=>n.type==='dialog')!.props.ref.current;
  h.props.active=false;h.view();await flush();assert.equal(shell.open,false);assert.equal(old.options.signal.aborted,true);
  assert.equal(h.button('分享技能')?.props.disabled,true);const count=h.requests.length;h.button('分享技能')!.props.onClick();await flush();assert.equal(h.requests.length,count);
  old.resolve({ok:true,json:async()=>({...content,introductions:['關閉後舊內容']})});await flush();await h.expire();assert.equal(shell.open,false);
  h.props.active=true;h.view();assert.equal(h.node(n=>n.type==='dialog')!.props.ref.current,shell);assert.equal(shell.open,false);
  await h.start();await anonymous(h);await loaded(h);assert.equal(shell.open,true);assert.ok(!h.text().includes('關閉後舊內容'));
});

test('closing a parent suppresses late clipboard feedback while retaining the unresolved capability lock',async()=>{
  const h=harness();await h.start();await anonymous(h);await loaded(h);
  let finish!:()=>void;h.navigator.clipboard.writeText=()=>new Promise<void>(resolve=>{finish=resolve;});
  const pending=h.click('複製介紹與連結');await flush();h.props.active=false;h.view();h.props.active=true;h.view();
  await h.start();await anonymous(h);await loaded(h);assert.equal(h.button('分享')?.props.disabled,true);
  finish();await pending;await flush();h.view();assert.ok(!h.text().includes('已複製'));assert.equal(h.button('複製介紹與連結')?.props.disabled,false);
});
