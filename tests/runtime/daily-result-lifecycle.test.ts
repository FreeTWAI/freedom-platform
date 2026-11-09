import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Executes the production Result closure without rewriting its handlers/effects.
// Controlled hook/DOM ports test ownership and races, not browser layout, focus,
// native dialogs, real React reconciliation, rasterization or native share UI.
const source=readFileSync(process.env.DAILY_RESULT_SOURCE ?? new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
const start=source.indexOf('function Result('),end=source.indexOf('\nexport function AbsurdDaily(',start);
assert.ok(start>=0&&end>start,'production Result closure exists');
const code=transformSync(source.slice(start,end),{loader:'tsx',jsxFactory:'element',jsxFragment:'Fragment',target:'es2022'}).code;
type Node={type:unknown;props:Record<string,any>;children:any[];dom?:Port};
function deferred<T=any>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
class Port {
  open=false;isConnected=true;style:Record<string,string>={};focuses=0;selects=0;
  showModal(){this.open=true;} close(){this.open=false;} focus(){this.focuses++;} select(){this.selects++;}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
}
const photos=[{image:'data:image/png;base64,photo-A',caption:'A caption',details:'A details',stars:1},{image:'data:image/png;base64,photo-B',caption:'B caption',details:'B details',stars:3}];
const result={game:'photo',seed:42,title:'Saved photo',...photos[0],photos};
function harness(extra:Record<string,unknown>={}){
  let cursor=0,dirty=false,mounted=true,tree:Node,renderCount=0,replayCount=0;
  const slots:any[]=[],pending:{index:number;effect:()=>any;deps:any[]}[]=[],ports=new Map<string,Port>();
  const exportsCalls:{selected:any;signal:AbortSignal;task:ReturnType<typeof deferred>}[]=[],jpegCalls:{signal:AbortSignal;task:ReturnType<typeof deferred>}[]=[],created:unknown[]=[],revoked:string[]=[],redirects:string[]=[],drafts:any[]=[],shares:any[]=[],copies:string[]=[];
  let saveFailure=false,clipboardFailure=false;
  const native=deferred();
  const navigator:any={canShare:()=>true,share:(payload:any)=>{shares.push(payload);return native.promise;},clipboard:{writeText:async(text:string)=>{copies.push(text);if(clipboardFailure)throw new Error('clipboard unavailable');}}};
  const document={activeElement:new Port(),querySelector:()=>null,addEventListener(){},removeEventListener(){}};
  const hooks={
    useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,(next:any)=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;if(mounted)dirty=true;}}];},
    useRef(initial:any){const i=cursor++;return (slots[i]??={current:initial});},
    useEffect(effect:()=>any,deps:any[]){const i=cursor++;if(!slots[i]||deps.some((v,j)=>!Object.is(v,slots[i].deps[j])))pending.push({index:i,effect,deps});},
  };
  const context={...hooks,useLayoutEffect:hooks.useEffect,element:(type:unknown,props:any,...children:any[])=>({type,props:props??{},children}),Fragment:'fragment',
    HTMLElement:Port,document,window:{addEventListener(){},removeEventListener(){}},ResizeObserver:class {observe(){}disconnect(){}},getComputedStyle:()=>({getPropertyValue:()=>''}),
    AbortController,Error,Date,URLSearchParams,URL:class extends URL {static createObjectURL(blob:unknown){created.push(blob);return `blob:result-${created.length}`;}static revokeObjectURL(url:string){revoked.push(url);}},
    location:{origin:'https://example.test',assign:(url:string)=>redirects.push(url)},sessionStorage:{},navigator,
    partyOf:()=>null,gameOf:(game:string)=>game,challengeUrl:(origin:string,game:string,seed:number)=>`${origin}/play?game=${game}&seed=${seed}`,
    gameShareText:(selected:any,link:string)=>`${selected.caption}\n${selected.details}\n${link}`,ResultShare:'ResultShare',
    saveGameDraft:(_storage:unknown,draft:unknown)=>{drafts.push(draft);if(saveFailure)throw new Error('quota');},
    resultExports:(selected:any,_logo:unknown,signal:AbortSignal)=>{const task=deferred();exportsCalls.push({selected,signal,task});return task.promise;},
  };
  const Result=runInNewContext(`${code};Result`,context);
  let props:any={result,inStage:true,onBack(){},onNext(){},onReplay(){replayCount++;},...extra};
  function bind(node:any,path='root'){
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach((child,i)=>bind(child,`${path}.${i}`));return;}
    const dom=ports.get(path)??new Port();ports.set(path,dom);node.dom=dom;
    if(node.props?.ref)node.props.ref.current=dom;
    node.children?.forEach((child:any,i:number)=>bind(child,`${path}.${i}`));
  }
  function flush(){let rounds=0;do{assert.ok(rounds++<30,'hooks settle');dirty=false;cursor=0;renderCount++;tree=Result(props);bind(tree);for(const item of pending.splice(0)){slots[item.index]?.cleanup?.();slots[item.index]={deps:item.deps,cleanup:item.effect()};}}while(dirty&&mounted);}
  function nodes(node:any=tree):Node[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap((child:any)=>child==null?[]:nodes(child));return [node,...node.children.flatMap((child:any)=>child==null?[]:nodes(child))];}
  function content(node:any):string{if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(content).join('');if(typeof node==='object')return content(node.children);return String(node);}
  function find(label:string){const found=nodes().find(n=>n.props['aria-label']===label||n.type==='button'&&content(n)===label);assert.ok(found,`control ${label}`);return found;}
  function click(label:string){const node=find(label);assert.ok(!node.props.disabled,`${label} enabled`);node.props.onClick({currentTarget:node.dom});flush();}
  async function settle(){await new Promise<void>(resolve=>setImmediate(resolve));flush();}
  function completePng(index=exportsCalls.length-1){const png=new Blob([`png-${index}`],{type:'image/png'}),file={name:`result-${index}.png`};exportsCalls[index].task.resolve({png,file,prepareJpegs:(signal:AbortSignal)=>{const task=deferred();jpegCalls.push({signal,task});return task.promise;}});return {png,file};}
  function unmount(){mounted=false;for(const slot of slots)slot?.cleanup?.();for(const port of ports.values())port.isConnected=false;}
  flush();
  return {nodes,find,click,settle,flush,completePng,unmount,exportsCalls,jpegCalls,created,revoked,redirects,drafts,shares,copies,native,navigator,ports,
    content:()=>content(tree),get renderCount(){return renderCount;},get replayCount(){return replayCount;},
    update(next:Record<string,unknown>){props={...props,...next};flush();},failSave(){saveFailure=true;},failClipboard(){clipboardFailure=true;}};
}

test('one Result owner keeps dialog, selection and completed exports through repeated open/close',async()=>{
  const h=harness();assert.equal(h.exportsCalls.length,1);h.completePng();await h.settle();h.jpegCalls[0].task.resolve({site:'site-A',preview:'preview-A'});await h.settle();
  const dialog=h.nodes().find(n=>n.type==='dialog')!.dom;
  const download=h.find('下載完整成果 PNG').props.href;
  for(let i=0;i<3;i++){h.click('更多分享方式');assert.equal(dialog!.open,true);h.click('關閉分享');assert.equal(dialog!.open,false);assert.equal(h.nodes().find(n=>n.type==='dialog')!.dom,dialog);}
  assert.equal(h.exportsCalls.length,1);assert.equal(h.jpegCalls.length,1);assert.equal(h.exportsCalls[0].signal.aborted,false);assert.equal(h.jpegCalls[0].signal.aborted,false);assert.deepEqual(h.revoked,[]);assert.equal(h.find('下載完整成果 PNG').props.href,download);assert.equal(h.find('底片 1 · 委託 1/3').props['aria-pressed'],true);
  const target=new Port();h.update({shareRequest:{serial:1,target}});assert.equal(dialog!.open,true);h.click('關閉分享');assert.equal(target.focuses,1);assert.equal(h.exportsCalls.length,1);
  h.unmount();assert.deepEqual(h.revoked,[download]);assert.equal(h.exportsCalls[0].signal.aborted,true);assert.equal(h.jpegCalls[0].signal.aborted,true);
});

test('PHOTO selects exactly saved image, caption and details; old PNG and JPEG cannot publish',async()=>{
  const h=harness();h.click('更多分享方式');h.click('底片 2 · 委託 3/3');assert.equal(h.exportsCalls[0].signal.aborted,true);assert.equal(h.exportsCalls.length,2);
  const chosen=h.exportsCalls[1].selected;assert.equal(chosen.image,photos[1].image);assert.equal(chosen.caption,photos[1].caption);assert.equal(chosen.details,photos[1].details);
  assert.ok(h.nodes().filter(n=>n.type==='img'&&n.props.alt).every(n=>n.props.src===photos[1].image));assert.ok(h.content().includes('B caption'));assert.ok(h.content().includes('B details'));
  h.completePng(0);await h.settle();assert.equal(h.created.length,0);assert.equal(h.jpegCalls.length,0);
  h.completePng(1);await h.settle();assert.equal(h.created.length,1);const url=h.find('下載完整成果 PNG').props.href;
  h.click('底片 2 · 委託 3/3');assert.equal(h.exportsCalls.length,2);assert.equal(h.jpegCalls[0].signal.aborted,false);
  h.click('關閉分享');h.click('更多分享方式');assert.equal(h.find('底片 2 · 委託 3/3').props['aria-pressed'],true);assert.equal(h.exportsCalls.length,2);
  h.click('底片 1 · 委託 1/3');assert.equal(h.jpegCalls[0].signal.aborted,true);assert.deepEqual(h.revoked,[url]);h.jpegCalls[0].task.resolve({site:'stale-site',preview:'stale-preview'});await h.settle();assert.equal(h.find('發到自由工坊').props.disabled,true);assert.equal(h.created.length,1);h.unmount();
});

test('PNG remains downloadable/shareable after JPEG failure and JPEG retry does not regenerate PNG',async()=>{
  const h=harness();const png=h.completePng();await h.settle();h.jpegCalls[0].task.reject(new Error('JPEG failed'));await h.settle();
  const url=h.find('下載完整成果 PNG').props.href;assert.equal(h.find('系統分享圖片／連結').props.disabled,false);assert.equal(h.find('發到自由工坊').props.disabled,true);
  h.click('更多分享方式');h.click('重試準備工坊圖片');assert.equal(h.jpegCalls.length,2);assert.equal(h.jpegCalls[0].signal.aborted,true);assert.equal(h.exportsCalls.length,1);assert.deepEqual(h.created,[png.png]);assert.deepEqual(h.revoked,[]);
  h.jpegCalls[1].task.resolve({site:'site-retry',preview:'preview-retry'});await h.settle();assert.equal(h.find('發到自由工坊').props.disabled,false);assert.equal(h.find('下載完整成果 PNG').props.href,url);
  h.failSave();h.click('發到自由工坊');assert.equal(h.drafts[0].image,'site-retry');assert.ok(h.drafts[0].text.includes('A caption\nA details'));assert.deepEqual(h.redirects,[]);assert.ok(h.content().includes('成果還沒保存'));h.unmount();
});

test('failed PNG can retry once and selection abort makes stale rejection harmless',async()=>{
  const h=harness();h.exportsCalls[0].task.reject(new Error('PNG failed'));await h.settle();const retry=h.find('重試產生成果圖').props.onClick;retry();retry();h.flush();assert.equal(h.exportsCalls.length,2);
  h.click('更多分享方式');h.click('底片 2 · 委託 3/3');assert.equal(h.exportsCalls[1].signal.aborted,true);h.exportsCalls[1].task.reject(new Error('late failure'));await h.settle();assert.equal(h.find('成果圖整理中').props.disabled,true);h.completePng(2);await h.settle();assert.equal(h.created.length,1);h.unmount();
});

test('native sharing is singleflight, cancellation preserves output and stale share cannot overwrite new owner',async()=>{
  const h=harness();const png=h.completePng();await h.settle();const handler=h.find('系統分享圖片／連結').props.onClick;handler();handler();h.flush();assert.equal(h.shares.length,1);assert.equal(h.shares[0].files[0],png.file);assert.ok(h.shares[0].text.includes('A caption\nA details'));
  const cancelled=new Error('cancel');cancelled.name='AbortError';h.native.reject(cancelled);await h.settle();assert.ok(h.content().includes('已取消分享'));assert.equal(h.find('系統分享圖片／連結').props.disabled,false);assert.equal(h.created.length,1);assert.deepEqual(h.revoked,[]);h.unmount();
  const stale=harness();stale.completePng();await stale.settle();stale.click('系統分享圖片／連結');stale.click('更多分享方式');stale.click('底片 2 · 委託 3/3');stale.native.reject(new Error('old share failed'));await stale.settle();assert.ok(!stale.content().includes('系統分享未完成'));assert.equal(stale.nodes().filter(n=>n.type==='input').length,0);stale.unmount();
});

test('clipboard failure and unavailable native share expose selectable manual link in persistent panel',async()=>{
  const h=harness();h.failClipboard();h.click('更多分享方式');h.click('複製同題挑戰連結');await h.settle();const input=h.nodes().find(n=>n.type==='input')!;assert.equal(input.props.value,'https://example.test/play?game=photo&seed=42');assert.equal(input.dom!.selects,1);assert.equal(input.props.readOnly,true);
  h.click('關閉分享');h.click('更多分享方式');assert.equal(h.nodes().find(n=>n.type==='input')!.dom,input.dom);assert.equal(input.dom!.selects,2);assert.equal(h.exportsCalls.length,1);
  h.completePng();await h.settle();delete h.navigator.share;h.click('關閉分享');h.click('系統分享圖片／連結');await h.settle();assert.equal(h.nodes().find(n=>n.type==='dialog')!.dom!.open,true);assert.ok(h.content().includes('沒有系統分享選單'));assert.equal(h.shares.length,0);h.unmount();
});

test('closing the result panel invalidates a delayed clipboard fallback without cancelling exports',async()=>{
  const h=harness(),pending=deferred();h.navigator.clipboard.writeText=()=>pending.promise;
  h.completePng();await h.settle();const url=h.find('下載完整成果 PNG').props.href;
  h.click('更多分享方式');h.click('複製同題挑戰連結');h.click('關閉分享');
  const dialog=h.nodes().find(n=>n.type==='dialog')!.dom!,opener=h.find('更多分享方式').dom!,focuses=opener.focuses;
  pending.reject(new Error('late clipboard refusal'));await h.settle();
  assert.equal(dialog.open,false,'late clipboard failure must not reopen a dismissed panel');
  assert.equal(opener.focuses,focuses);assert.equal(h.nodes().filter(n=>n.type==='input').length,0);
  assert.equal(h.find('下載完整成果 PNG').props.href,url);assert.equal(h.exportsCalls[0].signal.aborted,false);assert.equal(h.jpegCalls[0].signal.aborted,false);h.unmount();
});

test('clipboard fallback belongs to the latest operation, selected photo and mounted result',async()=>{
  const reopened=harness(),dismissed=deferred();reopened.navigator.clipboard.writeText=()=>dismissed.promise;
  reopened.click('更多分享方式');reopened.click('複製同題挑戰連結');reopened.click('關閉分享');reopened.click('更多分享方式');
  dismissed.reject(new Error('previous panel refusal'));await reopened.settle();assert.equal(reopened.nodes().find(n=>n.type==='dialog')!.dom!.open,true);assert.equal(reopened.nodes().filter(n=>n.type==='input').length,0);reopened.unmount();
  const h=harness(),old=deferred(),latest=deferred();let copies=0;
  h.navigator.clipboard.writeText=()=>++copies===1?old.promise:latest.promise;
  h.click('更多分享方式');h.click('複製同題挑戰連結');h.click('複製同題挑戰連結');
  latest.resolve(undefined);await h.settle();old.reject(new Error('superseded refusal'));await h.settle();
  assert.equal(h.nodes().filter(n=>n.type==='input').length,0);assert.ok(h.content().includes('同題連結已複製'));
  const changed=deferred();h.navigator.clipboard.writeText=()=>changed.promise;h.click('複製同題挑戰連結');h.click('底片 2 · 委託 3/3');
  changed.reject(new Error('old selection refusal'));await h.settle();assert.equal(h.nodes().filter(n=>n.type==='input').length,0);
  const unmounted=deferred();h.navigator.clipboard.writeText=()=>unmounted.promise;h.click('複製同題挑戰連結');h.unmount();unmounted.reject(new Error('unmounted refusal'));await h.settle();assert.equal(h.nodes().filter(n=>n.type==='input').length,0);
  const current=harness(),active=deferred();current.navigator.clipboard.writeText=()=>active.promise;current.click('更多分享方式');current.click('複製同題挑戰連結');
  active.reject(new Error('current refusal'));await current.settle();const input=current.nodes().find(n=>n.type==='input')!;
  assert.equal(current.nodes().find(n=>n.type==='dialog')!.dom!.open,true);assert.equal(input.dom!.selects,1);current.unmount();
  const legacy=harness({inStage:false,notice:null});legacy.failClipboard();legacy.click('複製同題挑戰連結');await legacy.settle();assert.equal(legacy.nodes().filter(n=>n.type==='input').length,1);assert.ok(legacy.content().includes('請長按或選取下方連結複製'));legacy.unmount();
});

test('replay hands control back; unmount aborts pending work and new Result gets a fresh owner',async()=>{
  const old=harness();old.completePng();await old.settle();const url=old.find('下載完整成果 PNG').props.href;old.click('同一題再來一次');assert.equal(old.replayCount,1);old.unmount();assert.equal(old.exportsCalls[0].signal.aborted,true);assert.equal(old.jpegCalls[0].signal.aborted,true);assert.deepEqual(old.revoked,[url]);
  const fresh=harness();old.jpegCalls[0].task.resolve({site:'late',preview:'late'});await Promise.resolve();await Promise.resolve();assert.equal(fresh.created.length,0);assert.equal(fresh.find('發到自由工坊').props.disabled,true);fresh.completePng();await fresh.settle();assert.equal(fresh.created.length,1);fresh.unmount();
  const pending=harness();pending.unmount();pending.completePng();await Promise.resolve();await Promise.resolve();assert.deepEqual(pending.created,[]);assert.equal(pending.jpegCalls.length,0);
});

// Parent dispatcher is executed separately: child components are identity nodes.
// This verifies React element type/key ownership, not a mounted browser tree.
function dispatch(initial='photo'){
  let cursor=0,tree:Node,search=`?game=${initial}&seed=42`,pushes=0;
  const slots:any[]=[],listeners=new Map<string,()=>void>(),pending:(()=>void)[]=[];
  const element=(type:unknown,props:any,...children:any[])=>({type,props:props??{},children});
  const useState=(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];};
  const effect=(fn:()=>any,deps:any[])=>{const i=cursor++;if(!slots[i]||deps.some((v,j)=>!Object.is(v,slots[i][j]))){slots[i]=deps;pending.push(fn);}};
  const location={get search(){return search;},get href(){return `https://example.test/play${search}`;}};
  const components=Object.fromEntries(['FullscreenGame','GameBoard','Result','MemberGameUpload','CommunityGameSubmission','ArcadeLobby','MarketLoader','CookingLoader','PartyLoader'].map(name=>[name,name]));
  const context={...components,element,Fragment:'fragment',useState,useRef:(v:any)=>{const i=cursor++;return slots[i]??=( {current:v});},useCallback:(fn:any)=>{cursor++;return fn;},useEffect:effect,useLayoutEffect:effect,
    location,URL,URLSearchParams,initialGame:()=>new URLSearchParams(search).get('game'),recipeOf:()=>null,seedOf:()=>42,freshSeed:()=>99,
    readCookbook:()=>({book:{},available:true}),emptyCookbook:()=>({}),localBook:{},tabBook:{},
    gameOf:(g:string)=>['photo','stamp','cash'].includes(g)?g:null,partyOf:(g:string)=>g==='chair'?g:null,marketOf:()=>null,
    GAMES:[{id:'photo'},{id:'stamp'},{id:'cash'}],PARTY_GAMES:[{id:'chair'}],RECIPES:[],COOKBOOK_KEY:'book',
    window:{scrollY:0,scrollTo(){},addEventListener:(type:string,fn:()=>void)=>listeners.set(type,fn),removeEventListener(){}},
    document:{title:'',fullscreenElement:null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},
    history:{scrollRestoration:'auto',pushState:(_a:unknown,_b:unknown,url:URL)=>{search=url.search;pushes++;}},flushSync:(fn:()=>void)=>fn(),
  };
  const compiled=transformSync(source.slice(end).replace('export function AbsurdDaily','function AbsurdDaily'),{loader:'tsx',jsxFactory:'element',target:'es2022'}).code;
  const App=runInNewContext(`${compiled};AbsurdDaily`,context);
  function render(){cursor=0;tree=App();for(const fn of pending.splice(0))fn();return tree;}
  function nodes(node:any=tree):Node[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap((child:any)=>child==null?[]:nodes(child));return [node,...node.children.flatMap((child:any)=>child==null?[]:nodes(child))];}
  function find(type:string){const node=nodes().find(n=>n.type===type);assert.ok(node,`parent renders ${type}`);return node;}
  render();return {render,find,nodes,get pushes(){return pushes;},pop(game:string|null){search=game?`?game=${game}&seed=42`:'';listeners.get('popstate')!();render();}};
}

test('Daily dispatcher keeps GameBoard type/key through result and replay replaces owner with same seed',()=>{
  const h=dispatch();const before=h.find('GameBoard');assert.equal(before.props.seed,42);assert.equal(before.props.resultView(false),null);
  before.props.onResult(result);h.render();const after=h.find('GameBoard');assert.equal(after.type,before.type);assert.equal(after.props.key,before.props.key);assert.equal(h.find('FullscreenGame').props.resultReady,true);
  const target=new Port();h.find('FullscreenGame').props.onResultShare(target);h.render();const resultView=h.find('GameBoard').props.resultView(false);assert.equal(resultView.type,'Result');assert.equal(resultView.props.result,result);assert.equal(resultView.props.inStage,true);assert.equal(resultView.props.shareRequest.target,target);
  resultView.props.onReplay();h.render();const replay=h.find('GameBoard');assert.notEqual(replay.props.key,before.props.key);assert.equal(replay.props.seed,42);assert.equal(replay.props.resultView(false),null);assert.equal(h.find('FullscreenGame').props.resultReady,false);
  replay.props.onResult(result);h.render();assert.equal(h.find('GameBoard').props.resultView(false).props.shareRequest,undefined);
});

test('Daily next/back/popstate clear completed owner; non-Daily keeps existing Result branch',()=>{
  const h=dispatch();h.find('GameBoard').props.onResult(result);h.render();h.find('GameBoard').props.resultView(false).props.onNext();h.render();assert.equal(h.find('GameBoard').props.game,'stamp');assert.equal(h.find('GameBoard').props.resultView(false),null);
  h.find('GameBoard').props.onResult({...result,game:'stamp'});h.render();h.find('GameBoard').props.resultView(false).props.onBack();h.render();h.find('ArcadeLobby');assert.equal(h.nodes().some(n=>n.type==='GameBoard'),false);
  h.pop('cash');h.find('GameBoard').props.onResult({...result,game:'cash'});h.render();h.find('FullscreenGame').props.onResultShare(new Port());h.render();h.pop('photo');assert.equal(h.find('GameBoard').props.resultView(false),null);h.find('GameBoard').props.onResult(result);h.render();assert.equal(h.find('GameBoard').props.resultView(false).props.shareRequest,undefined);
  const party=dispatch('chair');assert.equal(party.find('FullscreenGame').props.onResultShare,undefined);party.find('PartyLoader').props.onResult({...result,game:'chair'});party.render();assert.equal(party.find('Result').props.inStage,undefined);assert.equal(party.nodes().some(n=>n.type==='GameBoard'),false);
});

test('Escape closes panel without releasing export ownership and returns focus to opener',async()=>{
  const h=harness();h.completePng();await h.settle();h.click('更多分享方式');const opener=h.find('更多分享方式').dom!,dialog=h.nodes().find(n=>n.type==='dialog')!;let prevented=0;
  dialog.props.onCancel({preventDefault(){prevented++;}});h.flush();assert.equal(prevented,1);assert.equal(dialog.dom!.open,false);assert.equal(opener.focuses,1);assert.equal(h.exportsCalls.length,1);assert.equal(h.jpegCalls[0].signal.aborted,false);assert.deepEqual(h.revoked,[]);
  h.click('更多分享方式');dialog.dom!.close();dialog.props.onClose();h.flush();h.click('更多分享方式');assert.equal(dialog.dom!.open,true);assert.equal(h.exportsCalls.length,1);h.unmount();
});

test('Daily result accessible names contain each complete visible primary action label',async()=>{
  const text=(value:any):string=>value==null||typeof value==='boolean'?'':Array.isArray(value)?value.map(text).join(''):typeof value==='object'?text(value.children):String(value);
  const h=harness();
  const inspect=()=>{
    for(const label of ['系統分享圖片／連結','同一題再來一次','更多分享方式','關閉分享','發到自由工坊']){
      const node=h.find(label),visible=text(node.children).trim();assert.ok(visible);assert.ok((node.props['aria-label']??visible).includes(visible),`${label} contains ${visible}`);
    }
  };
  inspect();const pending=h.find('成果圖整理中');assert.ok(pending.props['aria-label'].includes(text(pending.children)));
  h.exportsCalls[0].task.reject(new Error('PNG unavailable'));await h.settle();const retry=h.find('重試產生成果圖');assert.ok(retry.props['aria-label'].includes(text(retry.children)));h.click('重試產生成果圖');h.completePng();await h.settle();
  const download=h.find('下載完整成果 PNG');assert.ok(download.props['aria-label'].includes(text(download.children)));inspect();h.unmount();
});
