import {useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import type {Recipe} from './catalog';
import type {DishStage} from './dish-stage';
import type {MarketRun} from './market-domain';
import {FoodArt} from './FoodArt';
import {syncDiagnostics} from '../diagnostics';
import {deferOptionalPreview} from '../deferred-preview';

/** UX-8/9: inspect the actual meal; two fingers zoom, one finger turns. No simulation here. */
export function DishShowcase({recipe,market,exportSettled,preview}:{recipe:Recipe;market?:MarketRun;exportSettled:boolean;preview:string}){
 const loaded=useRef(false),host=useRef<HTMLDivElement>(null),stage=useRef<DishStage|null>(null),startPreview=useRef<(()=>void)|null>(null),pointers=useRef(new Map<number,{x:number;y:number}>()),[state,setState]=useState<'waiting'|'loading'|'ready'|'fallback'>('waiting'),[attempt,setAttempt]=useState(0),description=useId();
 const diagnostics=()=>{if(!host.current||!stage.current)return;const s=stage.current.stats();syncDiagnostics(host.current,{renderCalls:s.calls,renderTriangles:s.triangles,renderGeometries:s.geometries,renderTextures:s.textures});};
 const failure=()=>{stage.current?.dispose();stage.current=null;pointers.current.clear();setState('fallback');};
 useEffect(()=>{let current=true,owned:DishStage|null=null;setState('waiting');pointers.current.clear();
  const fail=()=>{if(current){owned?.dispose();failure();}};
  let deadline:ReturnType<typeof setTimeout>|undefined;
  // Prefer primary export; the bounded defer does not abort or fail a late PNG.
  const deferred=deferOptionalPreview(()=>{
   if(!current)return;setState('loading');
   deadline=setTimeout(()=>{if(current){fail();current=false;}},15000);
   void import('./dish-stage').then(({createDishStage})=>{loaded.current=true;if(!current||!host.current)return;owned=createDishStage(host.current,recipe.id,fail,market);stage.current=owned;clearTimeout(deadline);diagnostics();setState('ready');}).catch(()=>{clearTimeout(deadline);fail();});
  });
  startPreview.current=deferred.release;
  return()=>{current=false;deferred.dispose();if(startPreview.current===deferred.release)startPreview.current=null;clearTimeout(deadline);pointers.current.clear();owned?.dispose();stage.current=null;};
 },[recipe.id,attempt,market]);
 // A late PNG after the maximum defer must not rebuild an already-owned stage.
 useEffect(()=>{if(exportSettled)startPreview.current?.();},[recipe.id,attempt,market,exportSettled]);
 const command=(kind:'turn'|'zoom'|'reset',delta=0)=>{try{if(kind==='reset')stage.current?.reset();else stage.current?.[kind](delta);diagnostics();}catch{failure();}};
 const down=(e:PointerEvent<HTMLDivElement>)=>{if(state!=='ready'||e.button!==0||pointers.current.size>=2)return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});e.currentTarget.setPointerCapture(e.pointerId);};
 const move=(e:PointerEvent<HTMLDivElement>)=>{const all=pointers.current,p=all.get(e.pointerId);if(!p)return;if(all.size===2){const other=[...all.entries()].find(([id])=>id!==e.pointerId)![1],before=Math.hypot(p.x-other.x,p.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);command('zoom',(after-before)*.006);}else command('turn',(e.clientX-p.x)*.012);all.set(e.pointerId,{x:e.clientX,y:e.clientY});};
 const release=(e:PointerEvent<HTMLDivElement>)=>{pointers.current.delete(e.pointerId);};
 return <section className="ck-dish-showcase" aria-label={`${recipe.name}3D成品`} data-dish-view={state}>
  <div className="ck-dish-header"><strong>料理上桌！</strong><span>3D 成品</span></div>
  <div className="ck-dish-surface" tabIndex={0} role="img" aria-label={`${recipe.name}，可旋轉縮放的3D成品`} aria-describedby={description} onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();command('turn',e.key==='ArrowLeft'?-.25:.25);}if(e.key==='Home'){e.preventDefault();command('reset');}if(['+','=','-'].includes(e.key)){e.preventDefault();command('zoom',e.key==='-'?-.1:.1);}}}>
   <div className="ck-dish-canvas" ref={host} aria-hidden="true"/>{state!=='ready'&&(market?<div className="ck-food-art"><img src={preview} alt={`${recipe.name}・本局成品`} width="960" height="720"/></div>:<FoodArt recipe={recipe}/>)}
  </div><div className="ck-dish-tools"><p id={description}>{state==='ready'?'拖曳旋轉，雙指縮放。方向鍵與＋／－也可以。':state==='waiting'?'正在準備分享成果，接著載入立體料理。':state==='loading'?'正在端出立體料理…':'3D暫時無法載入，分享成果與成績仍保留。'}</p>{state==='ready'?<div><button className="ad-secondary" aria-label="向左旋轉料理" onClick={()=>command('turn',-.35)}>↶</button><button className="ad-secondary" aria-label="縮小料理" onClick={()=>command('zoom',-.15)}>−</button><button className="ad-secondary" onClick={()=>command('reset')}>回正</button><button className="ad-secondary" aria-label="放大料理" onClick={()=>command('zoom',.15)}>＋</button><button className="ad-secondary" aria-label="向右旋轉料理" onClick={()=>command('turn',.35)}>↷</button></div>:state==='fallback'&&<button className="ad-secondary" onClick={()=>{if(!loaded.current){location.reload();return;}setAttempt(n=>n+1);}}>重試3D成品</button>}</div>
 </section>;
}
