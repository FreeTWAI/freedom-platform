import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute the actual callback closure with independently scheduled render,
// commit, effects and animation frames. This is not a browser/Google acceptance
// test; google-login.spec.ts retains its real toBeFocused assertion unchanged.
type Element={type:unknown;props:Record<string,any>;children:any[]};
function callbackHost(){
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/GoogleSignIn.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
  const start=source.indexOf('function GoogleCallback('),end=source.indexOf('\nexport {',start);assert.ok(start>=0&&end>start);
  const slots:any[]=[],effects:(()=>void)[]=[],frames:(()=>void)[]=[],listeners=new Map<string,()=>void>();
  let cursor=0,tree:Element,active='body',focusCount=0,mounted=true,resolve!:(value:unknown)=>void;
  const input={disabled:false,focus(){if(!this.disabled){active='factor';focusCount++;}}};
  const pending=new Promise(resolvePromise=>{resolve=resolvePromise;});
  const proof={totp_required:true,challenge:'synthetic-challenge'};
  const entry={intent:'login',entry:'/',state:'synthetic-state',code:'synthetic-code',cancelled:false,invalid:false};
  const props={entry,client:{post:()=>pending}};
  const same=(a:any[]|undefined,b:any[])=>a?.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const component=runInNewContext(`${source.slice(start,end)};GoogleCallback`,{
    useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],(value:any)=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??={current:initial};},
    useEffect:(fn:()=>void,deps:any[])=>{const i=cursor++;if(!same(slots[i]?.deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
    React:{createElement:(type:unknown,props:Record<string,any>|null,...children:any[])=>({type,props:props??{},children:children.flat(Infinity)})},
    requestAnimationFrame:(fn:()=>void)=>frames.push(fn),
    window:{location:{href:'https://example.test/'},addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},
    googleError:()=> 'Failed',ApiError:class extends Error {},leaveGoogleCallback:()=>{},
    activateGoogleLogin:()=>{throw Error('Unexpected activation in focus-only fixture');},
  });
  function all(node:any):Element[]{return node&&typeof node==='object'?[node,...(node.children??[]).flatMap(all)]:[];}
  function render(){assert.ok(mounted);cursor=0;tree=component(props);}
  function commit(){
    assert.ok(mounted);
    for(const slot of slots)if(slot?.current===input)slot.current=null;
    for(const node of all(tree))if(node.type==='input'&&node.props.ref){node.props.ref.current=input;input.disabled=!!node.props.disabled;}
    effects.splice(0).forEach(fn=>fn());
  }
  function flushFrames(){frames.splice(0).forEach(fn=>fn());}
  async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
  function unmount(){mounted=false;effects.length=0;for(const slot of slots){slot?.cleanup?.();if(slot?.current===input)slot.current=null;}}
  render();commit();
  return {
    async respond(){resolve(proof);await settle();},render,commit,flushFrames,unmount,
    move(){listeners.get('hashchange')?.();},
    async replaceChallenge(){proof.challenge='replacement-challenge';props.client={post:()=>pending};render();commit();await settle();},
    type(){const node=all(tree).find(node=>node.type==='input');assert.ok(node);node.props.onChange({target:{value:'123'}});},
    focusElsewhere(){active='cancel';},get active(){return active;},get focusCount(){return focusCount;},
  };
}

test('a frame before render/commit cannot lose the initial challenge focus',async()=>{
  const h=callbackHost();await h.respond();h.flushFrames();
  assert.equal(h.focusCount,0,'the input does not exist before commit');
  h.render();h.commit();h.flushFrames();assert.equal(h.active,'factor');assert.equal(h.focusCount,1);
});
test('a frame between render and ref attachment cannot lose focus',async()=>{
  const h=callbackHost();await h.respond();h.render();h.flushFrames();
  assert.equal(h.focusCount,0);h.commit();h.flushFrames();assert.equal(h.active,'factor');assert.equal(h.focusCount,1);
});
test('ordinary commit-before-frame control focuses once and has no delayed duplicate',async()=>{
  const h=callbackHost();await h.respond();h.render();h.commit();h.flushFrames();h.flushFrames();
  assert.equal(h.active,'factor');assert.equal(h.focusCount,1);
});
test('typing and unrelated rerenders do not steal focus back from the member',async()=>{
  const h=callbackHost();await h.respond();h.render();h.commit();h.flushFrames();h.type();h.focusElsewhere();
  h.render();h.commit();h.flushFrames();h.render();h.commit();h.flushFrames();
  assert.equal(h.active,'cancel');assert.equal(h.focusCount,1);
});
test('unmount before the provider response prevents a late focus',async()=>{
  const h=callbackHost();h.unmount();await h.respond();h.flushFrames();assert.equal(h.focusCount,0);
});
test('unmount after response but before commit prevents focus',async()=>{
  const h=callbackHost();await h.respond();h.render();h.unmount();h.flushFrames();assert.equal(h.focusCount,0);
});
test('navigation invalidation before challenge commit prevents focus',async()=>{
  const h=callbackHost();await h.respond();h.move();h.render();h.commit();h.flushFrames();assert.equal(h.focusCount,0);
});
test('a replacement challenge focuses once after its own commit, not on later input renders',async()=>{
  const h=callbackHost();await h.respond();h.render();h.commit();h.flushFrames();h.focusElsewhere();
  await h.replaceChallenge();h.flushFrames();h.render();h.commit();h.flushFrames();
  assert.equal(h.active,'factor');assert.equal(h.focusCount,2);h.focusElsewhere();h.type();h.render();h.commit();h.flushFrames();
  assert.equal(h.active,'cancel');assert.equal(h.focusCount,2);
});
test('navigation after render but before the queued focus effect invalidates that effect',async()=>{
  const h=callbackHost();await h.respond();h.render();h.move();h.commit();h.flushFrames();assert.equal(h.focusCount,0);
});
