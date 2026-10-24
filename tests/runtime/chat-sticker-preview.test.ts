import {test} from 'node:test';
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
  const sends:string[]=[],changes:unknown[]=[],props={draft:{reply:{message_id:'retained-reply'}},onChange:(value:unknown)=>changes.push(value),onSendSticker:(id:string)=>sends.push(id),disabled:false,target:'original-target'};
  const same=(left:any[],right:any[])=>left?.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
  const render=runInNewContext(`${source.slice(start,end)}; ChatExtras`,{
    CHAT_STICKERS,findChatSticker,ChatSticker:()=>null,ChatQuote:()=>null,
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
