import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {CookingScene as Illustration} from './CookingIllustration';
import {currentStep,cutGuide,plateTarget} from './domain';
import type {KitchenStage} from './kitchen-stage';
import {KITCHEN_VIEW} from './catalog';
import {syncDiagnostics} from '../diagnostics';
type Props=ComponentProps<typeof Illustration>&{onSettled:(ready:boolean)=>void;readRun:()=>ComponentProps<typeof Illustration>['run'];captureRef:{current:((run:ComponentProps<typeof Illustration>['run'])=>string)|null}};

/** UX-7: native hit geometry survives lazy loading and genuine WebGL failure. */
export function CookingScene(props:Props){
 const {run,point,onSettled,readRun,captureRef}=props,host=useRef<HTMLDivElement>(null),stage=useRef<KitchenStage|null>(null),live=useRef({readRun,point}),frame=useRef(0),motion=useRef(!matchMedia('(prefers-reduced-motion: reduce)').matches);
 // A restored completed run already exports its saved/native preview; do not build a second kitchen just to discard it.
 const [sceneRequested,setSceneRequested]=useState(run.status!=='done');
 useEffect(()=>{if(run.status!=='done')setSceneRequested(true);},[run.status]);
 const [mode,setMode]=useState<'loading'|'3d'|'light'>('loading'),[attempt,setAttempt]=useState(0),[lightweight,setLightweight]=useState(false),[notice,setNotice]=useState('');live.current={readRun,point};
 function draw(time:number){if(!stage.current)return;try{stage.current.update(live.current.readRun(),live.current.point,time,motion.current);const stats=stage.current.stats();if(host.current)syncDiagnostics(host.current,{renderCalls:stats.calls,renderTriangles:stats.triangles,renderGeometries:stats.geometries,renderTextures:stats.textures});}catch{cancelAnimationFrame(frame.current);stage.current?.dispose();stage.current=null;captureRef.current=null;setMode('light');setNotice('已切換輕量畫面，這一盤繼續。');onSettled(true);}}
 useEffect(()=>{let current=true;setNotice('');if(!sceneRequested||lightweight){setMode('light');onSettled(true);return;}
  setMode('loading');onSettled(false);let owned:KitchenStage|null=null;
  const fallback=()=>{if(!current)return;setMode('light');setNotice('先用輕量畫面開煮，也能再試立體料理台。');onSettled(true);};
  const deadline=setTimeout(()=>{if(current){current=false;setMode('light');setNotice('先用輕量畫面開煮，也能再試立體料理台。');onSettled(true);}},KITCHEN_VIEW.loaderMs);
  void import('./kitchen-stage').then(({createKitchenStage})=>{if(!current||!host.current)return;owned=createKitchenStage(host.current,()=>{if(current){cancelAnimationFrame(frame.current);owned?.dispose();stage.current=null;captureRef.current=null;setMode('light');setNotice('已切換輕量畫面，這一盤繼續。');onSettled(true);}});stage.current=owned;owned.update(live.current.readRun(),live.current.point,performance.now(),motion.current);clearTimeout(deadline);captureRef.current=final=>{if(!stage.current)throw Error('料理畫面未就緒');stage.current.update(final,null,performance.now(),false);return stage.current.capture();};setMode('3d');onSettled(true);}).catch(()=>{clearTimeout(deadline);owned?.dispose();stage.current=null;captureRef.current=null;fallback();});
  return()=>{current=false;clearTimeout(deadline);cancelAnimationFrame(frame.current);owned?.dispose();stage.current=null;captureRef.current=null;};
 },[attempt,lightweight,onSettled,sceneRequested]);
 useEffect(()=>{if(mode!=='3d')return;if(run.status!=='playing'){draw(performance.now());return;}const loop=(time:number)=>{draw(time);if(stage.current)frame.current=requestAnimationFrame(loop);};frame.current=requestAnimationFrame(loop);return()=>cancelAnimationFrame(frame.current);},[mode,run.status]);
 useEffect(()=>{if(mode==='3d'&&run.status!=='playing')draw(performance.now());},[run,point,mode]);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>{motion.current=!media.matches;draw(performance.now());};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const step=currentStep(run),target=plateTarget(run),guide=mode==='3d'&&run.status==='playing';
 return <><div className={`ck-live-scene ck-visual-${mode}`} data-cooking-visual={mode}>
  <div ref={host} className="ck-kitchen-canvas" aria-hidden="true"/>
  <Illustration {...props}/>
  {guide&&<svg className="ck-toy-guides" viewBox="0 0 800 560" aria-hidden="true">
    {step.kind==='slice'&&<><path d={`M${cutGuide(run)*800} 175V364`} stroke="#453c33" strokeWidth="11" strokeLinecap="round"/><path d={`M${cutGuide(run)*800} 175V364`} stroke="#fff0c4" strokeWidth="6" strokeDasharray="15 12" strokeLinecap="round"/><path d={`M${cutGuide(run)*800-15} 342l15 22 15-22`} stroke="#fff0c4" strokeWidth="6" fill="none"/></>}
    {step.kind==='mix'&&<><ellipse cx="400" cy="291" rx="159" ry="105" fill="none" stroke="#fff0c4" strokeWidth="5" strokeDasharray="14 14"/><path d="m540 226 26 21-31 9" stroke="#fff0c4" strokeWidth="7" fill="none"/></>}
    {step.kind==='fold'&&<text x="400" y="430" textAnchor="middle" fontSize="80" fill="#fff5d6" stroke="#705037" strokeWidth="2">{({left:'←',right:'→',up:'↑',down:'↓'} as const)[step.directions[run.active.count]??'up']}</text>}
    {step.kind==='plate'&&<><circle cx={target.x*800} cy={target.y*560} r="46" fill="#7dbb9a55" stroke="#fff6d9" strokeWidth="6" strokeDasharray="12 8"/><path d="M106 344q55 45 99 0" fill="none" stroke="#fff5d6" strokeWidth="6"/></>}
  </svg>}
 </div><div className="ck-visual-tools"><button className="ad-secondary" disabled={!sceneRequested} aria-pressed={lightweight||mode==='light'} onClick={()=>{if(lightweight||mode==='light'){setLightweight(false);setAttempt(n=>n+1);}else setLightweight(true);}}>{!sceneRequested?'料理已完成':lightweight||mode==='light'?'立體料理台':'輕量插畫'}</button>{mode==='loading'&&<small role="status">料理台準備中…</small>}{notice&&<small role="status">{notice}</small>}</div></>;
}
