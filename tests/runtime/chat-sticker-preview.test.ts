import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {CHAT_STICKERS,findChatSticker} from '../../modules/member-communications/stickers.js';

// Execute the actual picker and its event handlers, with a small deterministic
// hook host. This pure tier cannot establish browser layout, focus or API/DB ACKs.
type Element={type:unknown;props:Record<string,any>;children:any[]};
function picker(){
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/ChatContent.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
  const start=source.indexOf('function ChatExtras('),end=source.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start);
  const slots:any[]=[],effects:(()=>void)[]=[];let cursor=0,dirty=false,tree:Element;
  const sends:string[]=[],changes:unknown[]=[],props={draft:{reply:{message_id:'retained-reply'}},onChange:(value:unknown)=>changes.push(value),onSendSticker:(id:string)=>sends.push(id),disabled:false,target:'original-target',previewFeedback:false};
  const same=(left:any[],right:any[])=>left?.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
  const render=runInNewContext(`${source.slice(start,end)}; ChatExtras`,{
    CHAT_STICKERS,findChatSticker,ChatSticker:()=>null,ChatStickerPreview:'enhanced-preview',ChatQuote:()=>null,
    useId:()=> 'picker',
    useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],(value:any)=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
    useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??=( {current:initial} );},
    useEffect:(fn:()=>void,deps:any[])=>{const i=cursor++;if(!same(slots[i],deps)){slots[i]=deps;effects.push(fn);}},
    React:{createElement:(type:unknown,props:Record<string,any>|null,...children:any[]):Element=>{const element={type,props:props??{},children:children.flat(Infinity)};if(props?.ref&&typeof props.ref==='object')props.ref.current={focus:()=>{}};return element;}},
  });
  function renderWithoutEffects(){dirty=false;cursor=0;tree=render(props);return tree;}
  function flush(){let cycles=0;do{assert.ok(cycles++<10);dirty=false;cursor=0;tree=render(props);effects.splice(0).forEach(fn=>fn());}while(dirty);return tree;}
  function all(node:any):Element[]{return node&&typeof node==='object'?[node,...(node.children??[]).flatMap((child:any)=>all(child))]:[];}
  function button(label:string){const result=all(tree).find(node=>node.type==='button'&&(node.props['aria-label']===label||node.children.includes(label)));assert.ok(result,`Missing button ${label}`);return result;}
  function click(label:string){const node=button(label);node.props.onClick({currentTarget:{focus:()=>{}}});flush();}
  flush();
  return {props,sends,changes,flush,renderWithoutEffects,all:()=>all(tree),button,click};
}

test('choosing a sticker only previews it; confirmation calls the existing sender once and never changes another draft',()=>{
  const h=picker();h.click('選擇貼圖');h.click('工坊夥伴');h.click('預覽貼圖：你好');
  assert.deepEqual(h.sends,[]);assert.deepEqual(h.changes,[]);
  const confirm=h.button('送出這張貼圖').props.onClick;confirm();confirm();h.flush();
  assert.deepEqual(h.sends,['workshop-v1-hello']);assert.deepEqual(h.changes,[]);
  assert.equal(h.all().some(node=>node.props.className==='chat-sticker-picker'),false);
});

test('cancel and close discard only the preview; stale confirm callbacks cannot send',()=>{
  const h=picker();h.click('選擇貼圖');h.click('工坊夥伴');h.click('預覽貼圖：你好');
  const stale=h.button('送出這張貼圖').props.onClick;h.click('取消預覽');stale();h.flush();assert.deepEqual(h.sends,[]);
  h.click('預覽貼圖：謝謝');h.click('關閉貼圖');stale();h.flush();assert.deepEqual(h.sends,[]);assert.deepEqual(h.changes,[]);
  h.click('選擇貼圖');assert.equal(h.all().some(node=>node.props.className==='chat-sticker-confirm'),false);
});

test('target changes and disabled states cannot confirm a stale selection',()=>{
  const h=picker();h.click('選擇貼圖');h.click('工坊夥伴');h.click('預覽貼圖：你好');
  const stale=h.button('送出這張貼圖').props.onClick;h.props.target='new-target';h.flush();stale();assert.deepEqual(h.sends,[]);
  h.click('選擇貼圖');h.click('預覽貼圖：謝謝');h.props.disabled=true;h.flush();
  h.button('送出這張貼圖').props.onClick();assert.deepEqual(h.sends,[]);
});


test('an old confirmation cannot send a newer preview, even of the same sticker',()=>{
  const h=picker();h.click('選擇貼圖');h.click('工坊夥伴');h.click('預覽貼圖：你好');
  const stale=h.button('送出這張貼圖').props.onClick;h.click('取消預覽');h.click('預覽貼圖：你好');stale();h.flush();assert.deepEqual(h.sends,[]);
  h.click('取消預覽');h.click('預覽貼圖：謝謝');stale();h.flush();assert.deepEqual(h.sends,[]);
  h.click('送出這張貼圖');assert.deepEqual(h.sends,['workshop-v1-thanks']);
});

test('target and disabled guards take effect during render before cleanup effects',()=>{
  for(const change of ['target','disabled'] as const){
    const h=picker();h.click('選擇貼圖');h.click('工坊夥伴');h.click('預覽貼圖：你好');
    const stale=h.button('送出這張貼圖').props.onClick;
    if(change==='target')h.props.target='new-target';else h.props.disabled=true;
    h.renderWithoutEffects();stale();assert.deepEqual(h.sends,[]);h.flush();
  }
});

// The adjacent member picker is another disclosure in the same chat surface.
// Exercise the real component, not a copied search implementation. Native
// details focus/layout requires the separate browser regression, not this tier.
describe('member discovery disclosure (separate from sticker protocol)',()=>{
test('toolbar discovery action opens before focusing the preserved input and tolerates unmount',()=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/MemberMessages.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
  const start=source.indexOf('function focusMemberDiscovery('),end=source.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start);
  let focused=0;const input={value:'保留的搜尋',focus(){assert.equal(details.open,true);focused++;}};
  const details={open:false,querySelector:(selector:string)=>{assert.equal(selector,'input');return input;}};
  const action=runInNewContext(`${source.slice(start,end)};focusMemberDiscovery`,{document:{getElementById:(id:string)=>id==='discovery'?details:null}});
  action('discovery');assert.equal(focused,1);assert.equal(input.value,'保留的搜尋');
  details.open=false;action('discovery');assert.equal(focused,2);action('unmounted');assert.equal(focused,2);
});

test('member discovery starts collapsed and retains search/results across re-renders',async()=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/MemberMessages.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
  const start=source.indexOf('function MemberPicker('),end=source.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start);
  const slots:any[]=[];let cursor=0,tree:Element;const calls:string[]=[];
  let resolve!:(value:unknown)=>void;
  const render=runInNewContext(`${source.slice(start,end)};MemberPicker`,{
    PAGE:20,URLSearchParams,MemberAvatar:()=>null,fail:(error:Error)=>error.message,
    merge:(left:any[],right:any[])=>[...left,...right],useId:()=> 'member-picker',
    useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(value:any)=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??={current:initial};},
    React:{createElement:(type:unknown,props:Record<string,any>|null,...children:any[]):Element=>({type,props:props??{},children:children.flat(Infinity)})},
  });
  const props={id:'discovery',me:'self',onSelect:()=>{},client:{get:(path:string)=>{calls.push(path);return new Promise(r=>{resolve=r;});}}};
  const all=(node:any):Element[]=>node&&typeof node==='object'?[node,...(node.children??[]).flatMap(all)]:[];
  const flush=()=>{cursor=0;tree=render(props);return all(tree);};
  let nodes=flush();assert.equal(tree!.type,'details');assert.equal(tree!.props.open,undefined);
  assert.equal(nodes.find(node=>node.type==='summary')?.children[0],'開始新對話');
  nodes.find(node=>node.type==='input')!.props.onChange({target:{value:'合成夥伴'}});nodes=flush();
  nodes.find(node=>node.type==='form')!.props.onSubmit({preventDefault(){}});
  nodes=flush();assert.equal(calls.length,1);assert.equal(nodes.find(node=>node.type==='input')!.props.value,'合成夥伴');
  assert.equal(nodes.find(node=>node.type==='button'&&node.props.type==='submit')!.props.disabled,true);
  resolve({items:[{user_id:'other',nickname:'合成夥伴',is_self:false}],next_offset:null});
  await new Promise<void>(done=>setImmediate(done));nodes=flush();
  assert.ok(nodes.some(node=>node.type==='ul'&&node.props['aria-label']==='會員搜尋結果'));
  // Opening/closing native details does not unmount the child form or reset its hooks.
  nodes=flush();assert.equal(nodes.find(node=>node.type==='input')!.props.value,'合成夥伴');assert.equal(calls.length,1);
});
});

// This harness drives the actual preview's load/decode effects. It does not
// simulate paint, cache performance or network delivery of a chat message.
function imagePreview(cached=false,width=512,thumbCachedBroken=false,holdEffects=false){
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/ChatContent.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
  const start=source.indexOf('function ChatStickerImagePreview('),end=source.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start);
  const slots:any[]=[],effects:(()=>void)[]=[];let cursor=0,tree:Element,cleanup:(()=>void)|undefined,effect:(()=>()=>void)|undefined,retries=0,updates=0;
  const deferred:{resolve:()=>void;reject:()=>void}[]=[];
  const thumb={complete:thumbCachedBroken,naturalWidth:thumbCachedBroken?0:144};
  const img={complete:cached,naturalWidth:width,decode:()=>new Promise<void>((resolve,reject)=>deferred.push({resolve,reject:()=>reject(Error('decode failed'))}))};
  const render=runInNewContext(`${source.slice(start,end)};ChatStickerImagePreview`,{
    useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],(value:any)=>{updates++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??={current:initial};},
    useEffect:(fn:()=>()=>void)=>{const i=cursor++;if(!(i in slots)){slots[i]=true;effect=fn;effects.push(()=>{cleanup=fn();});}},
    React:{createElement:(type:unknown,props:Record<string,any>|null,...children:any[]):Element=>{if(props?.ref)props.ref.current=props.className==='chat-preview-thumb'?thumb:img;return {type,props:props??{},children:children.flat(Infinity)};}},
  });
  const all=(node:any):Element[]=>node&&typeof node==='object'?[node,...(node.children??[]).flatMap(all)]:[];
  function flush(){cursor=0;tree=render({image:'/synthetic/full.webp',thumbnail:'/synthetic/thumb.webp',label:'合成貼圖',onRetry:()=>{retries++;}});if(!holdEffects)effects.splice(0).forEach(fn=>fn());return all(tree);}
  const node=(className:string)=>{const found=flush().find(n=>n.props.className===className);assert.ok(found,className);return found;};
  flush();
  return {img,thumb,deferred,node,flush,mount:()=>{holdEffects=false;flush();},load:()=>node('chat-preview-full').props.onLoad({currentTarget:img}),error:()=>node('chat-preview-full').props.onError(),status:()=>flush().find(n=>n.props.role==='status')!.children[0],unmount:()=>cleanup?.(),replay:()=>{cleanup?.();cleanup=effect?.();},updates:()=>updates,retries:()=>retries};
}
const previewTick=()=>new Promise<void>(done=>setImmediate(done));

describe('chat-only image preview feedback (not send acknowledgements)',()=>{
  test('enhanced feedback is opt-in and toggling presentation never sends a sticker',()=>{
    const h=picker();h.click('選擇貼圖');h.click('預覽貼圖：謝謝');
    assert.equal(h.all().filter(n=>n.type==='enhanced-preview').length,0);
    h.props.previewFeedback=true;h.flush();assert.equal(h.all().filter(n=>n.type==='enhanced-preview').length,1);
    h.props.previewFeedback=false;h.flush();assert.equal(h.all().filter(n=>n.type==='enhanced-preview').length,0);assert.deepEqual(h.sends,[]);
  });

  test('retry and a different selection get fresh image lifecycles; legacy atlas keeps its existing renderer',()=>{
    const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/ChatContent.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
    const start=source.indexOf('function ChatStickerPreview('),end=source.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start);
    let attempt=0,focusCount=0;const onRetryFocus=()=>{assert.equal(attempt,0);focusCount++;};
    const render=runInNewContext(`${source.slice(start,end)};ChatStickerPreview`,{findChatSticker,ChatSticker:'legacy-sticker',ChatStickerImagePreview:'image-preview',useState:()=>[attempt,(fn:(value:number)=>number)=>{attempt=fn(attempt);}],React:{createElement:(type:unknown,props:Record<string,any>)=>({type,props})}});
    const first=render({id:'freetwai-v2-thanks',onRetryFocus});assert.equal(first.type,'image-preview');assert.equal(first.props.key,'freetwai-v2-thanks:0');first.props.onRetry();assert.equal(focusCount,1);
    const retry=render({id:'freetwai-v2-thanks',onRetryFocus});assert.equal(retry.props.key,'freetwai-v2-thanks:1');assert.equal(retry.props.image,first.props.image);
    const other=render({id:'freetwai-v2-trust',onRetryFocus});assert.notEqual(other.props.key,retry.props.key);
    assert.equal(render({id:'workshop-v1-hello',onRetryFocus}).type,'legacy-sticker');
  });

  test('load waits for decode, duplicate load decodes once, and terminal events do not flip state',async()=>{
    const h=imagePreview();assert.equal(h.status(),'正在載入清晰預覽…');h.load();h.load();await previewTick();assert.equal(h.deferred.length,1);
    assert.equal(h.node('chat-preview-full').props['data-ready'],false);
    h.deferred[0].resolve();await previewTick();assert.equal(h.status(),'清晰預覽已載入。');assert.equal(h.node('chat-preview-full').props['data-ready'],true);
    h.error();assert.equal(h.status(),'清晰預覽已載入。');
  });
  test('cached-broken thumbnails and errors before the passive effect still get text fallback',()=>{
    const cached=imagePreview(false,512,true);assert.ok(cached.node('chat-preview-fallback'));
    const early=imagePreview(false,512,false,true);early.node('chat-preview-thumb').props.onError();early.thumb.complete=true;early.thumb.naturalWidth=0;early.mount();
    assert.ok(early.node('chat-preview-fallback'));assert.equal(early.status(),'正在載入清晰預覽…');
  });
  test('cached complete images decode without waiting for a missing load event',async()=>{
    const h=imagePreview(true);await previewTick();assert.equal(h.deferred.length,1);h.deferred[0].resolve();await previewTick();assert.equal(h.status(),'清晰預覽已載入。');
    const broken=imagePreview(true,0);assert.match(String(broken.status()),/載入失敗/);assert.equal(broken.deferred.length,0);
  });
  test('errors retain the thumbnail or accessible text and image retry never sends a message',async()=>{
    const h=imagePreview();h.load();await previewTick();h.error();h.deferred[0].resolve();await previewTick();assert.match(String(h.status()),/載入失敗/);
    assert.ok(h.node('chat-preview-thumb'));h.node('chat-preview-thumb').props.onError();assert.ok(h.node('chat-preview-fallback'));
    const retry=h.flush().find(n=>n.type==='button'&&n.children.includes('重試載入圖片'));assert.ok(retry);retry.props.onClick();assert.equal(h.retries(),1);
    assert.equal(h.flush().filter(n=>n.props.role==='status').length,1);
  });
  test('decode rejection is terminal, and old decode after unmount or effect replay cannot win',async()=>{
    const rejected=imagePreview();rejected.load();await previewTick();rejected.deferred[0].reject();await previewTick();assert.match(String(rejected.status()),/載入失敗/);
    const gone=imagePreview();gone.load();await previewTick();gone.unmount();const updates=gone.updates();gone.deferred[0].resolve();await previewTick();assert.equal(gone.updates(),updates);
    const replay=imagePreview(true);await previewTick();replay.replay();await previewTick();assert.equal(replay.deferred.length,2);replay.deferred[0].resolve();await previewTick();assert.equal(replay.status(),'正在載入清晰預覽…');replay.deferred[1].resolve();await previewTick();assert.equal(replay.status(),'清晰預覽已載入。');
  });
});
