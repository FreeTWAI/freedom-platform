import {useEffect,useRef,useState} from 'react';
import {ArSpatialRenderer,multiply4,previewProjection,transform4,type SpatialEffect} from './spatial';

export function SpatialPreview({effect}:{effect:SpatialEffect}){
  const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),redraw=useRef(()=>{});
  const [angle,setAngle]=useState(18),[paused,setPaused]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches),[unavailable,setUnavailable]=useState(false),[retry,setRetry]=useState(0);
  const current=useRef({effect,angle,paused});
  useEffect(()=>{current.current={effect,angle,paused};redraw.current();},[effect,angle,paused]);
  useEffect(()=>{
    const element=canvas.current!,container=host.current!,renderer=ArSpatialRenderer.create(element);
    if(!renderer){setUnavailable(true);return;}
    setUnavailable(false);let frame=0,intersecting=true,visible=document.visibilityState!=='hidden',last=0,frozen=0,disposed=false;
    const draw=(now:number)=>{
      frame=0;if(disposed||!visible)return;
      const settings=current.current;
      if(now-last>=1000/30||settings.paused){
        const width=Math.min(960,Math.max(280,container.clientWidth)*Math.min(devicePixelRatio||1,1.5)),height=width*.62;
        if(!settings.paused)frozen=now;
        const world=multiply4(transform4([0,0,-2.3],[-.14,settings.angle*Math.PI/180,0],[1,1,1]),transform4([-.5,-.5,0],[0,0,0],[1,1,1]));
        if(!renderer.render(settings.effect,world,previewProjection(width/height),[1,1],frozen,width,height)){setUnavailable(true);return;}
        last=now;
      }
      if(!settings.paused)frame=requestAnimationFrame(draw);
    };
    const schedule=()=>{if(!disposed&&visible&&!frame)frame=requestAnimationFrame(draw);};redraw.current=schedule;
    const resize=new ResizeObserver(schedule);resize.observe(container);
    const updateVisibility=()=>{visible=intersecting&&document.visibilityState!=='hidden';if(!visible){cancelAnimationFrame(frame);frame=0;}else schedule();};
    const intersection=new IntersectionObserver(([entry])=>{intersecting=entry.isIntersecting;updateVisibility();});intersection.observe(container);
    const visibility=updateVisibility;
    const lost=()=>{cancelAnimationFrame(frame);frame=0;setUnavailable(true);};element.addEventListener('webglcontextlost',lost);
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)'),motionChanged=()=>{if(motion.matches)setPaused(true);};
    document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',motionChanged);schedule();
    return()=>{disposed=true;redraw.current=()=>{};cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();element.removeEventListener('webglcontextlost',lost);document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',motionChanged);renderer.dispose(true);};
  },[retry]);
  return <div className="ar-spatial-preview" ref={host}>
    <div className="ar-spatial-preview-stage"><canvas key={retry} ref={canvas} role="img" aria-label="有深度與透視的 3D 特效預覽"/><span className="ar-preview-badge">3D 效果預覽 · 不開相機</span></div>
    {unavailable?<p role="status">這台裝置暫時無法顯示 3D 預覽，掃描時會使用精簡特效。<button type="button" className="btn btn-ghost" onClick={()=>setRetry(n=>n+1)}>重試預覽</button></p>:<div className="ar-preview-controls"><label>轉動預覽<input type="range" min="-55" max="55" value={angle} onChange={event=>setAngle(Number(event.target.value))}/></label><button type="button" className="btn btn-ghost" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?'播放動畫':'暫停動畫'}</button></div>}
    <p className="field-hint">轉動看看出框的深度。實際掃描時，效果會跟隨圖案的方向。</p>
  </div>;
}
