import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
// Uses the installed test toolchain of the invoking repo; no dependency copies.
const {transformSync}=createRequire(resolve(process.cwd(),'package.json'))('esbuild');
const source=readFileSync(new URL('../../apps/portal-web/src/modules/EventMemberCards.tsx',import.meta.url),'utf8');
const compiled=transformSync(source+'\nexport {EventMemberCardsContent};',{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
type Node={type:any;props:any};
function find(tree:any,check:(node:Node)=>boolean):Node|undefined{
  if(!tree||typeof tree!=='object')return;
  if(check(tree))return tree;
  for(const child of [tree.props?.children].flat(Infinity)){const value=find(child,check);if(value)return value;}
}
const tick=()=>new Promise<void>(done=>setImmediate(done));
const token='a'.repeat(43),path='/member-cards/'+token;
const publicCard={nickname:'只讀公開暱稱',primary_guild:null,capabilities:[],avatar_url:null,profile_links:[]};
// Executes actual component source with controlled hook/DOM/transport doubles.
// Not a React scheduler, native dialog, keyboard/layout or browser acceptance test.
function harness(){
  const hooks:any[]=[],effects:(()=>void)[]=[];let index=0,focused='';
  const listeners=new Map<string,Set<()=>void>>(),requests:any[]=[];
  const events={addEventListener:(type:string,fn:()=>void)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);},removeEventListener:(type:string,fn:()=>void)=>listeners.get(type)?.delete(fn)};
  const win={...events,location:{origin:'https://freetwai.com',href:'https://freetwai.com/#events/event-a'}},doc={...events,visibilityState:'visible'};
  const element={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const react={useId:()=> 'test-card',useRef:(initial:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:initial});},
    useState:(initial:any)=>{const i=index++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],(next:any)=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];},
    useEffect:(fn:()=>unknown,deps:any[])=>{const i=index++;if(!hooks[i]||deps.some((d,n)=>d!==hooks[i].deps[n])){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn();});}}};
  const jsx=(type:any,props:any)=>({type,props}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,window:win,document:doc,URL,AbortController,
    require:(name:string)=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./MemberCardQr'?{MemberCardQr:'MemberCardQr'}:name==='./MemberECard'?{MemberECard:'MemberECard'}:{}});
  const client={sessionGeneration:1,get:(url:string,options:any)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),post:()=>{throw new Error('unexpected mutation');}};
  const props={client,eventId:'event-a',userId:'member-a'};
  function render(){index=0;const tree=module.exports.EventMemberCardsContent(props);find(tree,n=>{if(n.props.ref)n.props.ref.current=n.type==='dialog'?element:{isConnected:true,focus:()=>{focused=n.props['aria-label']??n.props.children;}};return false;});return tree;}
  function view(){render();while(effects.length)effects.shift()!();return render();}
  function click(label:string){const button=find(view(),n=>n.type==='button'&&(n.props.children===label||n.props['aria-label']===label));assert.ok(button,label);button.props.onClick();}
  function emit(type:string){for(const fn of listeners.get(type)??[])fn();}
  view();
  return {view,click,emit,client,requests,win,doc,element,module,focused:()=>focused,props,unmount(){for(const hook of hooks)hook?.cleanup?.();},qr(){return find(view(),n=>n.type==='MemberCardQr');},dialog(){return find(view(),n=>n.type==='dialog')!;}};
}
async function ready(h:ReturnType<typeof harness>){h.click('出示我的名片');h.requests[0].resolve({enabled:true,share_path:path,profile_links:[{handle:'private settings must not render'}]});await tick();h.requests[1].resolve(publicCard);await tick();assert.ok(h.qr());}
test('capability path validation rejects IDs, redirects, credentials, query/hash and malformed paths',()=>{
  const h=harness(),parse=h.module.exports.eventMemberCardUrl;
  assert.equal(parse(path,'https://freetwai.com'),'https://freetwai.com'+path);
  for(const invalid of [null,'',path+'/',path+'?email=private',path+'#secret','https://evil.test'+path,'//evil.test'+path,'/members/user', '/member-cards/short'])assert.equal(parse(invalid,'https://freetwai.com'),null);
  h.unmount();
});
test('merely mounting and reading scan instructions performs no requests',()=>{const h=harness();assert.equal(h.requests.length,0);assert.equal(find(h.view(),n=>n.type==='details')?.props.children.length>0,true);h.unmount();});
test('opening reads only enabled settings and actual public projection, no private member API or writes',async()=>{const h=harness();await ready(h);assert.deepEqual(h.requests.map(r=>r.url),['/me/member-card-share','/public'+path]);assert.equal(h.qr()!.props.url,'https://freetwai.com'+path);assert.equal(find(h.view(),n=>n.type==='MemberECard')!.props.nickname,publicCard.nickname);h.unmount();});
test('disabled sharing offers setup without automatically publishing or reading a public card',async()=>{const h=harness();h.click('出示我的名片');h.requests[0].resolve({enabled:false,share_path:path});await tick();assert.equal(h.requests.length,1);assert.equal(h.qr(),undefined);assert.equal(find(h.view(),n=>n.type==='a')!.props.href,'/#account');h.unmount();});
test('invalid enabled path fails closed before public GET',async()=>{const h=harness();h.click('出示我的名片');h.requests[0].resolve({enabled:true,share_path:'https://evil.test'+path});await tick();assert.equal(h.requests.length,1);assert.ok(find(h.view(),n=>n.props.role==='alert'));h.unmount();});
test('repeated open is one GET; close aborts held settings and restores opener focus',async()=>{const h=harness();h.click('出示我的名片');h.click('出示我的名片');assert.equal(h.requests.length,1);h.click('關閉名片');assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.focused(),'出示我的名片');h.requests[0].resolve({enabled:true,share_path:path});await tick();assert.equal(h.requests.length,1);assert.equal(h.qr(),undefined);h.unmount();});
test('Escape clears held public GET and late response cannot reopen the dialog',async()=>{const h=harness();h.click('出示我的名片');h.requests[0].resolve({enabled:true,share_path:path});await tick();h.dialog().props.onCancel({preventDefault(){}});h.requests[1].resolve(publicCard);await tick();assert.equal(h.element.open,false);assert.equal(h.qr(),undefined);h.unmount();});
test('Back and hash navigation dismiss without synthetic history and reject held responses',async()=>{for(const event of ['popstate','hashchange']){const h=harness();h.click('出示我的名片');h.win.location.href='https://freetwai.com/#home';h.emit(event);h.requests[0].resolve({enabled:true,share_path:path});await tick();assert.equal(h.element.open,false);assert.equal(h.qr(),undefined);assert.equal(h.requests.length,1);h.unmount();}});
test('session change before held settings resolves prevents follow-on read',async()=>{const h=harness();h.click('出示我的名片');h.client.sessionGeneration++;h.requests[0].resolve({enabled:true,share_path:path});await tick();assert.equal(h.requests.length,1);assert.equal(h.qr(),undefined);h.emit('freedom-game-console-session-end');assert.equal(h.element.open,false);h.unmount();});
test('unmount for a newer event ignores held public response',async()=>{const h=harness();h.click('出示我的名片');h.requests[0].resolve({enabled:true,share_path:path});await tick();h.unmount();h.requests[1].resolve(publicCard);await tick();assert.equal(h.element.open,false);assert.equal(h.qr(),undefined);});
test('focus revalidation clears old QR immediately and revoked token error never preserves it',async()=>{const h=harness();await ready(h);h.emit('focus');assert.equal(h.qr(),undefined);h.requests[2].resolve({enabled:true,share_path:path});await tick();h.requests[3].reject(new Error('404 revoked'));await tick();assert.equal(h.qr(),undefined);assert.ok(find(h.view(),n=>n.props.role==='alert'));h.unmount();});
test('newer focus read wins over an older successful read; hidden page clears QR',async()=>{const h=harness();await ready(h);h.emit('focus');h.emit('pageshow');h.requests[3].resolve({enabled:false,share_path:null});await tick();h.requests[2].resolve({enabled:true,share_path:path});await tick();assert.equal(h.qr(),undefined);assert.equal(h.requests.length,4);h.doc.visibilityState='hidden';h.emit('visibilitychange');assert.equal(h.qr(),undefined);h.doc.visibilityState='visible';h.emit('visibilitychange');assert.equal(h.requests.length,5);h.unmount();});
test('late native close event cannot dismiss a newly reopened dialog',()=>{const h=harness();h.click('出示我的名片');h.click('關閉名片');h.click('出示我的名片');h.dialog().props.onClose();assert.equal(h.element.open,true);assert.equal(h.requests.length,2);h.unmount();});
test('component owner key includes event, member and session; account has one top-level share editor',()=>{assert.match(source,/\$\{props.userId\}:\$\{props.client.sessionGeneration\}:\$\{props.eventId\}/);const account=readFileSync(new URL('../../apps/portal-web/src/modules/Membership.tsx',import.meta.url),'utf8');assert.equal(account.match(/<MemberShare client=/g)?.length,1);assert.ok(account.indexOf('<MemberShare client=')<account.indexOf('<strong>個人資料</strong>'));assert.doesNotMatch(source,/client\.post|history\.(pushState|replaceState)|getUserMedia/);});

test('replacing the client at equal member/session/event remounts an empty owner before any new read',async()=>{
  const old=harness();await ready(old);old.emit('focus');assert.equal(old.requests.length,3);
  // Execute the real wrapper with retained hook slots and model only React's key
  // reconciliation. This is not proof of React's commit/paint ordering.
  const slots:any[]=[];let cursor=0;
  const jsx=(type:any,props:any,key:any)=>({type,props,key}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,URL,
    require:(name:string)=>name==='react'?{useRef:(value:any)=>{const i=cursor++;return slots[i]??(slots[i]={current:value});}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{}});
  const render=(props:any)=>{cursor=0;return module.exports.EventMemberCards(props);};
  const first=render(old.props),next=harness();
  assert.notEqual(old.client,next.client);
  assert.equal(old.client.sessionGeneration,next.client.sessionGeneration);
  const replacement=render(next.props);
  assert.notEqual(replacement.key,first.key,'a different transport owner must remount even at equal numeric session generation');
  assert.equal(render(next.props).key,replacement.key,'same owner rerender must not remount');
  old.unmount();assert.equal(old.element.open,false);assert.equal(next.qr(),undefined);assert.equal(next.requests.length,0);
  next.click('出示我的名片');assert.equal(next.qr(),undefined);assert.equal(next.requests.length,1);
  old.requests[2].resolve({enabled:true,share_path:path});await tick();assert.equal(old.requests.length,3);assert.equal(next.qr(),undefined);
  next.requests[0].resolve({enabled:false,share_path:null});await tick();assert.equal(next.qr(),undefined);next.unmount();
});
