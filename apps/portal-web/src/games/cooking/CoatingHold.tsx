import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createCoatingHold} from './coating-hold';

/** Pointer/keyboard hold is optional; the adjacent original coat button is the
 * single-press accessible alternative. No synthetic pointer click submits. */
export function CoatingHold({enabled,target,onCoat}:{enabled:boolean;target:string;onCoat:()=>void}){
 const [progress,setProgress]=useState(0),current=useRef({enabled,target,onCoat});
 const control=useRef<ReturnType<typeof createCoatingHold>|null>(null);
 if(!control.current)control.current=createCoatingHold({now:()=>performance.now(),schedule:tick=>requestAnimationFrame(tick),unschedule:frame=>cancelAnimationFrame(frame),target:()=>current.current.enabled&&!document.hidden?current.current.target:null,progress:setProgress,complete:()=>current.current.onCoat()});
 useLayoutEffect(()=>{current.current={enabled,target,onCoat};},[enabled,target,onCoat]);
 useLayoutEffect(()=>{control.current?.cancel();},[enabled,target]);
 useEffect(()=>{const cancel=()=>control.current?.cancel(),escape=(event:KeyboardEvent)=>{if(event.key==='Escape')cancel();};window.addEventListener('keydown',escape,true);document.addEventListener('visibilitychange',cancel);window.addEventListener('blur',cancel);return()=>{window.removeEventListener('keydown',escape,true);document.removeEventListener('visibilitychange',cancel);window.removeEventListener('blur',cancel);cancel();};},[]);
 return <div className="mk-coating">
  <button type="button" disabled={!enabled} aria-describedby="mk-coating-hint"
   onPointerDown={event=>{if(event.button!==0||!event.isPrimary)return;if(control.current?.begin(event.pointerId)){event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}}}
   onPointerMove={event=>{const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)control.current?.release(event.pointerId);}}
   onPointerUp={event=>control.current?.release(event.pointerId)} onPointerCancel={event=>control.current?.release(event.pointerId)} onLostPointerCapture={event=>control.current?.release(event.pointerId)}
   onKeyDown={event=>{if((event.key===' '||event.key==='Enter')&&!event.repeat){event.preventDefault();control.current?.begin(-1);}if(event.key==='Escape')control.current?.cancel();}}
   onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();control.current?.release(-1);}}}
   onBlur={()=>control.current?.cancel()} onContextMenu={event=>{event.preventDefault();control.current?.cancel();}}>
   按住裹麵糊
  </button>
  <div className="mk-coating-progress" role="progressbar" aria-label="這次裹糊進度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}><span style={{width:`${progress*100}%`}}/></div>
  <small id="mk-coating-hint">按住約一秒，放開可取消；也可用「裹麵糊」按鈕直接完成。</small>
 </div>;
}
