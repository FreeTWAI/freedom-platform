import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';

// Execute the unmodified production handlers. This is a routing/ownership
// harness, not React, native focus, pointer-capture or WebGL evidence.
const source=readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
function between(name:string,next:string){
  const start=source.indexOf(`    function ${name}(`),end=source.indexOf(`    function ${next}(`,start);
  assert.ok(start>=0&&end>start,`${name} production closure`);
  return source.slice(start,end);
}
const handlers=stripTypeScriptTypes(between('keyboard','pointerDown')+between('pointerDown','pointerMove'));
type Game='photo'|'stamp'|'cash';
function board(game:Game){
  let active='button',prevented=0,captured=0,focuses=0,actions=0;
  const options:unknown[]=[];
  const live={current:{started:true,paused:false,done:false,pointer:null as unknown,targetPan:{x:.2,y:.3},cash:{index:4},stamps:{practice:false,index:2},stampPoint:{x:0,y:0},clock:{elapsed:1000},raised:false}};
  const context={game,live,ready:true,pendingResult:{current:null as unknown},section:{current:{focus(option:unknown){active='board';focuses++;options.push(option);}}},
    syncClock(){},beginStamps:(value:unknown)=>value,stage:{current:{point:()=>({x:.1,y:.2})}},render(){},
    shoot(){actions++;},applyStamp(){actions++;},applyCash(){actions++;},pan(){},clamp:(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value)),setPaused(){}};
  const api=runInNewContext(`${handlers};({keyboard,pointerDown})`,context) as {keyboard:(event:unknown)=>void;pointerDown:(event:unknown)=>void};
  const pointer={button:0,isPrimary:true,pointerId:7,clientX:100,clientY:200,preventDefault(){prevented++;},currentTarget:{setPointerCapture(id:number){assert.equal(id,7);captured++;}}};
  const key=(key=game==='cash'?'ArrowRight':' ',extra:Record<string,unknown>={})=>api.keyboard({key,repeat:false,target:{closest:()=>active==='button'?{}:null},preventDefault(){prevented++;},...extra});
  return {context,live,api,pointer,key,control:()=>{active='button';},stats:()=>({active,prevented,captured,focuses,actions,options})};
}

for(const game of ['photo','stamp','cash'] as const)test(`${game}: accepted scene pointer restores keyboard ownership after a control`,()=>{
  const h=board(game);
  h.key();assert.equal(h.stats().actions,0,'a focused control retains native keys');
  h.api.pointerDown(h.pointer);
  assert.equal(h.stats().active,'board');assert.equal(h.stats().focuses,1);assert.equal(h.stats().captured,1);
  assert.equal(JSON.stringify(h.stats().options),JSON.stringify([{preventScroll:true}]));
  assert.equal((h.live.current.pointer as {index:number}).index,game==='cash'?4:2);
  h.key();assert.equal(h.stats().actions,1);
  h.control();h.key();assert.equal(h.stats().actions,1,'returning to a control must not classify, stamp or shoot');
  h.live.current.pointer=null;h.api.pointerDown(h.pointer);h.key();assert.equal(h.stats().actions,2);assert.equal(h.stats().focuses,2);
});

test('rejected pointers never steal focus, prevent defaults, capture or replace the active gesture',()=>{
  for(const game of ['photo','stamp','cash'] as const)for(const reason of ['loading','not-started','paused','done','pending-result','other-pointer','secondary','right-button'] as const){
    const h=board(game);
    if(reason==='loading')h.context.ready=false;
    if(reason==='not-started')h.live.current.started=false;
    if(reason==='paused')h.live.current.paused=true;
    if(reason==='done')h.live.current.done=true;
    if(reason==='pending-result')h.context.pendingResult.current={};
    if(reason==='other-pointer')h.live.current.pointer={id:99};
    if(reason==='secondary')h.pointer.isPrimary=false;
    if(reason==='right-button')h.pointer.button=2;
    const before=h.live.current.pointer;h.api.pointerDown(h.pointer);
    assert.equal(h.live.current.pointer,before,`${game}/${reason}`);
    assert.deepEqual(h.stats(),{active:'button',prevented:0,captured:0,focuses:0,actions:0,options:[]},`${game}/${reason}`);
  }
});

test('restored keyboard ownership still respects modifiers, repeated action keys and pause',()=>{
  for(const game of ['photo','stamp','cash'] as const){
    const h=board(game);h.api.pointerDown(h.pointer);
    for(const flag of ['repeat','altKey','metaKey','ctrlKey'])h.key(undefined,{[flag]:true});
    assert.equal(h.stats().actions,0);
    h.live.current.paused=true;h.key();assert.equal(h.stats().actions,0);
    h.live.current.paused=false;h.key();assert.equal(h.stats().actions,1);
  }
});
