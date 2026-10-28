import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {AR_EXPERIENCE_MAX_BYTES,AR_SCENE_MAX_TARGETS,inspectArExperience} from '../../../../../packages/asset-storage/ar-target';
import {ArCamera,cameraIssue} from './camera';
import {cardTexture,effectTexture,effectCaptionQuad,drawArCard,drawArEffect,projectTarget,composeArSnapshot,encodeArSnapshot,type ArContent} from './render';
import {readArPacket} from './packet';
import {ArPhotoShare} from './share';
import type {ArSpatialRenderer} from './spatial';
import type {PortalClient} from '../../api';

export type ScanEntry={title:string;url:string};
export type LocalScan={bytes:Uint8Array;content:ArContent};
type Cached={item:ArContent;texture:HTMLCanvasElement;caption?:HTMLCanvasElement;media?:HTMLImageElement|HTMLVideoElement;until:number};
type Pose={index:number;world:number[];projection:number[];dimension:[number,number];at:number};
async function pattern(url:string,signal:AbortSignal,remaining:number){
  if(!/^\/api\/v1\/public\/ar\/[A-Za-z0-9_-]{43}\/pattern$/.test(url))throw new Error('ar_invalid_url');
  const response=await fetch(url,{signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error('ar_pattern_unavailable');
  return readArPacket(response,signal,Math.min(AR_EXPERIENCE_MAX_BYTES,remaining));
}
export function ArScanner({entries,local,client,onClose}:{entries:readonly ScanEntry[];local?:LocalScan;client:PortalClient;onClose?:()=>void}){
  const video=useRef<HTMLVideoElement>(null),overlay=useRef<HTMLCanvasElement>(null),spatialCanvas=useRef<HTMLCanvasElement>(null),root=useRef<HTMLElement>(null),expandButton=useRef<HTMLButtonElement>(null);
  const camera=useRef(new ArCamera()),spatial=useRef<ArSpatialRenderer|null>(null),run=useRef(0),abort=useRef<AbortController|null>(null),mounted=useRef(false),owner=useRef(client.sessionGeneration),refreshing=useRef(new Set<number>());
  const [phase,setPhase]=useState<'loading'|'idle'|'starting'|'scanning'|'paused'|'error'>('loading'),[message,setMessage]=useState(''),[found,setFound]=useState<ArContent|null>(null),[photo,setPhoto]=useState<File|null>(null),[photoText,setPhotoText]=useState(''),[torch,setTorch]=useState(false),[capturing,setCapturing]=useState(false);
  const [expanded,setExpanded]=useState(false),[facing,setFacing]=useState<'environment'|'user'>('environment'),[loaded,setLoaded]=useState(0),[renderMode,setRenderMode]=useState<'idle'|'webgl'|'fallback'>('idle');
  const preparedPackets=useRef<Uint8Array[]>([]),[reload,setReload]=useState(0),[sound,setSound]=useState(false);
  const captureToken=useRef(0);
  const data=useRef<Cached[]>([]),pose=useRef<Pose|null>(null),lastIndex=useRef(-1),animation=useRef(0),drawFrame=useRef<(now:number,force?:boolean)=>void>(()=>{}),reduced=useRef(false);
  const live=(id:number)=>mounted.current&&run.current===id&&client.sessionGeneration===owner.current;
  function clearOverlay(){
    for(const entry of data.current)if(entry.media instanceof HTMLVideoElement)entry.media.pause();
    const c=overlay.current?.getContext('2d');if(c)c.clearRect(0,0,c.canvas.width,c.canvas.height);
    spatial.current?.clear();pose.current=null;
    if(lastIndex.current!==-1){lastIndex.current=-1;if(mounted.current)setFound(null);}
  }
  function releaseRendering(terminal=false){cancelAnimationFrame(animation.current);animation.current=0;drawFrame.current=()=>{};spatial.current?.dispose(terminal);spatial.current=null;}
  function stop(next:'paused'|'idle'='paused'){
    run.current++;abort.current?.abort();abort.current=null;camera.current.stop();refreshing.current.clear();clearOverlay();releaseRendering();
    for(const entry of data.current)if(entry.media instanceof HTMLVideoElement)entry.media.muted=true;
    setTorch(false);setSound(false);setRenderMode('idle');setPhase(next);if(next==='paused')setMessage('相機已暫停。可以分享照片，或繼續掃描。');
  }
  useEffect(()=>{
    mounted.current=true;const hide=()=>{if(document.visibilityState==='hidden')stop();},pagehide=()=>stop();
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)'),motionChanged=()=>{reduced.current=motion.matches;};motionChanged();motion.addEventListener('change',motionChanged);
    document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);
    return()=>{mounted.current=false;run.current++;abort.current?.abort();camera.current.stop();releaseRendering(true);document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pagehide);motion.removeEventListener('change',motionChanged);};
  },[]);
  useEffect(()=>{
    if(!expanded)return;
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';expandButton.current?.focus();
    return()=>{document.body.style.overflow=overflow;if(previous?.isConnected&&previous.getClientRects().length)previous.focus({preventScroll:true});else root.current?.querySelector<HTMLButtonElement>('.ar-photo-share button')?.focus({preventScroll:true});};
  },[expanded]);
  useEffect(()=>{const interval=setInterval(()=>{const current=pose.current;if(current&&(performance.now()-current.at>700||data.current[current.index]?.until<=performance.now()))clearOverlay();if(client.sessionGeneration!==owner.current)stop('idle');},250);return()=>clearInterval(interval);},[client]);
  async function currentContent(entry:ScanEntry,signal:AbortSignal):Promise<ArContent>{
    if(!/^\/api\/v1\/public\/ar\/[A-Za-z0-9_-]{43}$/.test(entry.url))throw new Error('ar_invalid_url');
    return client.get<ArContent>(entry.url.slice('/api/v1'.length),{signal,skipAuthHandler:true,background:true});
  }
  const entryKey=entries.map(entry=>entry.url).join('|');
  useEffect(()=>{
    stop('idle');const id=run.current,control=new AbortController();abort.current=control;setPhase('loading');setLoaded(0);setMessage('正在載入這次要掃描的圖案…');preparedPackets.current=[];data.current=[];
    const urls:string[]=[],resources:(HTMLImageElement|HTMLVideoElement)[]=[];
    const disposeMedia=()=>{for(const media of resources){if(media instanceof HTMLVideoElement){media.pause();media.removeAttribute('src');media.load();}else media.removeAttribute('src');}for(const url of urls)URL.revokeObjectURL(url);};
    void (async()=>{
      try{
        if(!local&&(!entries.length||entries.length>AR_SCENE_MAX_TARGETS))throw new Error('ar_scene_empty');
        // Metadata is small; binary media stays sequential under its scene budget.
        const contents=local?[local.content]:await Promise.all(entries.map(entry=>currentContent(entry,control.signal)));
        const packets:Uint8Array[]=[],cache:Cached[]=[];let total=0;
        for(let i=0;i<contents.length;i++){
          if(!live(id))return;
          const bytes=local?local.bytes:await pattern(contents[i].pattern_url,control.signal,32*1024*1024-total);total+=bytes.length;
          if(total>32*1024*1024)throw new Error('ar_scene_size');
          const experience=inspectArExperience(bytes);packets.push(bytes);let media:HTMLImageElement|HTMLVideoElement|undefined;
          if(experience.binding?.kind==='image'||experience.binding?.kind==='video'){
            const b=experience.binding,url=URL.createObjectURL(new Blob([new Uint8Array(b.media)],{type:b.mime}));urls.push(url);
            if(b.kind==='image'){const image=new Image();resources.push(image);image.src=url;await image.decode();media=image;}
            else{const movie=document.createElement('video');resources.push(movie);movie.src=url;movie.muted=true;movie.playsInline=true;movie.loop=true;movie.preload='metadata';media=movie;}
          }
          if(!live(id)){disposeMedia();return;}
          cache.push({item:contents[i],texture:cardTexture(contents[i]),caption:contents[i].binding?.kind==='effect'?effectTexture(contents[i]):undefined,media,until:local?Infinity:performance.now()+15000});setLoaded(i+1);
        }
        if(!live(id))return;preparedPackets.current=packets;data.current=cache;setPhase('idle');setMessage('圖案準備好了，開啟相機開始掃描。');
      }catch(error){
        if(!live(id)||control.signal.aborted)return;disposeMedia();control.abort();setPhase('error');
        setMessage(error instanceof Error&&error.message==='ar_scene_empty'?'還沒有可掃描的圖案，請先製作或選擇圖案。':error instanceof Error&&error.message==='ar_scene_size'?'這組媒體超過 32 MB，請返回並選一個圖案掃描。':'圖案或公開內容無法載入，請重試；也可以請分享者確認是否已撤下。');
      }
    })();
    return()=>{control.abort();disposeMedia();};
  },[entryKey,local,reload]);
  function refresh(index:number,id:number,control:AbortController){
    if(local||refreshing.current.has(index))return;refreshing.current.add(index);
    void currentContent(entries[index],control.signal).then(item=>{
      if(live(id))data.current[index]={...data.current[index],item,texture:cardTexture(item),caption:item.binding?.kind==='effect'?effectTexture(item):undefined,until:performance.now()+15000};
    }).catch(()=>{if(live(id)){preparedPackets.current=[];stop();setPhase('error');setMessage('公開內容已關閉或暫時無法讀取，請重新載入圖案。');}}).finally(()=>{if(live(id))refreshing.current.delete(index);});
  }
  async function start(nextFacing=facing){
    if(phase==='starting'||!preparedPackets.current.length)return;
    camera.current.stop();clearOverlay();releaseRendering();abort.current?.abort();const id=++run.current,control=new AbortController();abort.current=control;
    setFacing(nextFacing);setPhase('starting');setMessage('正在開啟相機與辨識…');setPhoto(null);setSound(false);setTorch(false);setRenderMode('idle');
    try{
      let lastDraw=0;
      const draw=(now:number,force=false)=>{
        if(!live(id))return;const current=pose.current,v=video.current,c=overlay.current?.getContext('2d');
        if(!current||!v||!c)return;
        const cached=data.current[current.index];
        if(!cached||now-current.at>700||cached.until<=now){clearOverlay();if(cached&&cached.until<=now)refresh(current.index,id,control);return;}
        if(!force&&now-lastDraw<1000/30)return;lastDraw=now;
        if(c.canvas.width!==v.videoWidth||c.canvas.height!==v.videoHeight){c.canvas.width=v.videoWidth;c.canvas.height=v.videoHeight;}
        c.clearRect(0,0,c.canvas.width,c.canvas.height);
        const quad=projectTarget(current.world,current.projection,current.dimension,c.canvas.width,c.canvas.height);if(!quad){clearOverlay();return;}
        const aspect=current.dimension[0]/current.dimension[1],time=reduced.current?0:now;
        let rendered=false;
        if(cached.item.binding?.kind==='effect'&&spatial.current){
          rendered=spatial.current.render(cached.item.binding.effect??'sparkle',current.world,current.projection,current.dimension,time,v.videoWidth,v.videoHeight);
          if(!rendered){spatial.current.dispose();spatial.current=null;setRenderMode('fallback');}
        }else spatial.current?.clear();
        if(cached.media instanceof HTMLImageElement)drawArCard(c,cached.media,quad,cached.media.naturalWidth,cached.media.naturalHeight,aspect);
        else if(cached.media instanceof HTMLVideoElement&&cached.media.readyState>=2)drawArCard(c,cached.media,quad,cached.media.videoWidth,cached.media.videoHeight,aspect);
        else if(rendered)drawArCard(c,cached.caption??cached.texture,effectCaptionQuad(quad),undefined,undefined,aspect*.84/.24);
        else drawArCard(c,cached.texture,quad,undefined,undefined,aspect);
        if(cached.item.binding?.kind==='effect'&&!rendered)drawArEffect(c,quad,cached.item.binding.effect??'sparkle',time);
      };
      drawFrame.current=draw;
      // Acquires permission synchronously from this user's gesture.
      const startup=camera.current.start(video.current!,preparedPackets.current,(event,projection,dimensions)=>{
        if(!live(id))return;
        if(event.type==='error'){stop();setPhase('error');setMessage('辨識已停止，請重新開啟相機。');return;}
        if(event.type!=='updateMatrix')return;
        if(!event.worldMatrix||!dimensions[event.targetIndex]){clearOverlay();return;}
        const cached=data.current[event.targetIndex];if(!cached)return;
        if(!projectTarget(event.worldMatrix,projection,dimensions[event.targetIndex],video.current?.videoWidth??0,video.current?.videoHeight??0)){clearOverlay();return;}
        if(cached.until<=performance.now()){clearOverlay();refresh(event.targetIndex,id,control);return;}
        pose.current={index:event.targetIndex,world:event.worldMatrix,projection,dimension:dimensions[event.targetIndex],at:performance.now()};
        if(lastIndex.current!==event.targetIndex){
          for(const entry of data.current)if(entry.media instanceof HTMLVideoElement)entry.media.pause();
          if(cached.media instanceof HTMLVideoElement)void cached.media.play().catch(()=>{if(live(id))setMessage('請按「播放影片」讓內容開始播放。');});
          lastIndex.current=event.targetIndex;setFound(cached.item);setMessage('已找到圖案。移動鏡頭看立體效果，或拍照留念。');
        }
      },nextFacing);
      if(data.current.some(entry=>entry.item.binding?.kind==='effect'))void import('./spatial').then(module=>{
        if(!live(id))return;spatial.current=module.ArSpatialRenderer.create(spatialCanvas.current!);setRenderMode(spatial.current?'webgl':'fallback');
      }).catch(()=>{if(live(id))setRenderMode('fallback');});
      await startup;
      if(live(id)){
        setPhase('scanning');setMessage('把完整圖案放入框內，保持平整，慢慢靠近。');
        const tick=(now:number)=>{if(!live(id))return;draw(now);animation.current=requestAnimationFrame(tick);};animation.current=requestAnimationFrame(tick);
      }
    }catch(error){if(!live(id))return;stop();setPhase('error');setMessage(error instanceof Error&&error.message==='ar_scene_empty'?'還沒有可掃描的圖案，請先製作或選擇圖案。':cameraIssue(error));}
  }
  async function capture(){
    if(capturing)return;let snapshot:HTMLCanvasElement,destination:string|undefined;
    try{
      // Composite immediately after drawing: the WebGL back buffer is transient.
      drawFrame.current(performance.now(),true);snapshot=composeArSnapshot(video.current!,overlay.current!,spatialCanvas.current!);destination=found?.destination;
    }catch(error){setMessage(error instanceof Error?error.message:'照片未完成，請重試。');return;}
    const token=++captureToken.current;setCapturing(true);stop();const owned=run.current;
    try{
      const file=await encodeArSnapshot(snapshot);
      if(live(owned)&&token===captureToken.current){setExpanded(false);setPhoto(file);setPhotoText(local?'我在自由工坊製作了一個 AR 圖案！':`一起用自由工坊 AR 探索圖案與夥伴！ ${window.location.origin}${destination??window.location.pathname}`);setMessage('相機已暫停。可以分享照片，或繼續掃描。');}
    }catch{if(live(owned)&&token===captureToken.current){setPhase('error');setMessage('照片未產生，請重新開啟相機再拍一次。');}}
    finally{snapshot.width=0;snapshot.height=0;if(mounted.current&&token===captureToken.current)setCapturing(false);}
  }
  function trapExpanded(event:KeyboardEvent<HTMLElement>){
    if(!expanded)return;if(event.key==='Escape'){event.preventDefault();setExpanded(false);return;}
    if(event.key!=='Tab')return;
    const buttons=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select,summary')??[]).filter(element=>element.getClientRects().length);
    const first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  const active=phase==='scanning',total=local?1:entries.length;
  return <section ref={root} className={`ar-scanner${expanded?' is-expanded':''}`} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={local?'試掃圖案':'AR 相機'} onKeyDown={trapExpanded}>
    <header className="ar-row"><div><p className="eyebrow">FREEDOM AR</p><h2>{local?'先用相機試掃':'讓圖案，帶你認識夥伴'}</h2></div><div className="ar-view-actions">{!photo&&<button ref={expandButton} className="btn btn-ghost" type="button" aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'縮小相機':'展開相機'}</button>}{onClose&&<button className="btn btn-ghost" type="button" onClick={()=>{stop('idle');onClose();}}>返回</button>}</div></header>
    <div className={`ar-stage${active?' is-active':''}`} hidden={!!photo}>
      <video ref={video} muted playsInline aria-label="相機即時畫面"/><canvas ref={overlay} className="ar-flat-layer" aria-hidden="true"/><canvas ref={spatialCanvas} className="ar-spatial-layer" aria-hidden="true"/>
      {!active&&<div className="ar-stage-intro"><span className="ar-scan-glyph" aria-hidden="true">⌗</span><strong>{capturing?'正在產生照片…':phase==='starting'||phase==='loading'?'準備中…':phase==='paused'?'相機已暫停':'掃衣服圖案、海報或活動名片'}</strong><p>開啟相機後才開始辨識。畫面只在這台裝置處理。</p>{phase==='loading'&&total>0&&<p>已準備 {loaded} / {total} 個圖案</p>}</div>}
      {active&&<><div className={`ar-camera-badge${found?' is-found':''}`}><span aria-hidden="true"/>{found?'圖案已鎖定':'尋找圖案中'}</div>{!found&&<div className="ar-reticle" aria-hidden="true"/>}{found&&<div className="ar-found-label">{found.title}{renderMode==='webgl'&&found.binding?.kind==='effect'&&<span>3D</span>}</div>}</>}
    </div>
    <p className={`ar-status${phase==='error'?' banner banner-error':''}`} role={phase==='error'?'alert':'status'} aria-live="polite">{capturing?'正在產生照片…':message||'先選擇要掃的圖案，再開啟相機。'}</p>
    <div className="ar-actions ar-camera-actions">
      {!active&&<button className="btn btn-primary" type="button" disabled={capturing||phase==='starting'||phase==='loading'||!preparedPackets.current.length} onClick={()=>{void start();}}>{phase==='starting'?'準備相機…':phase==='error'?'重新開啟':phase==='paused'?'繼續掃描':'開啟相機'}</button>}
      {(phase==='starting'||phase==='loading')&&<button className="btn btn-ghost" type="button" onClick={()=>stop()}>取消</button>}
      {active&&<><button className="btn btn-primary ar-shutter" type="button" disabled={capturing} onClick={()=>{void capture();}}>{capturing?'正在產生照片…':'拍照'}</button><button className="btn btn-ghost" type="button" onClick={()=>stop()}>暫停相機</button><button className="btn btn-ghost" type="button" disabled={capturing} onClick={()=>{stop('idle');void start(facing==='environment'?'user':'environment');}}>切換鏡頭</button><button className="btn btn-ghost" type="button" aria-pressed={torch} onClick={()=>{const id=run.current;void camera.current.torch(!torch).then(supported=>{if(live(id)){if(supported)setTorch(!torch);else setMessage('這台相機未提供補光燈，請移到光線充足的位置。');}}).catch(()=>{if(live(id))setMessage('補光燈未開啟，可以繼續掃描。');});}}>補光</button></>}
      {phase==='error'&&!preparedPackets.current.length&&<button className="btn btn-ghost" type="button" onClick={()=>setReload(value=>value+1)}>重新載入圖案</button>}
      {phase==='paused'&&!preparedPackets.current.length&&<button className="btn btn-ghost" type="button" onClick={()=>setReload(value=>value+1)}>載入圖案</button>}
      {found?.binding?.kind==='video'&&<button className="btn btn-ghost" type="button" aria-pressed={sound} onClick={()=>{const media=data.current[lastIndex.current]?.media;if(media instanceof HTMLVideoElement){media.muted=sound;setSound(!sound);void media.play().catch(()=>setMessage('影片未開始播放，可以重新掃描後重試。'));}}}>{sound?'關閉聲音':'播放影片／開啟聲音'}</button>}
      {found&&!local&&<a className="btn btn-ghost" href={found.destination} target="_blank" rel="noopener noreferrer" onClick={()=>stop()}>查看內容</a>}
    </div>
    {renderMode==='fallback'&&active&&<p className="field-hint">目前使用精簡特效，可以繼續掃描與拍照。</p>}
    {photo&&<ArPhotoShare file={photo} text={photoText} onClose={()=>setPhoto(null)}/>}
    <details className="ar-tips"><summary>掃不到、鏡頭打不開？</summary><ul><li>衣服拉平、圖案完整入鏡，避開反光和太暗的角落。</li><li>掃描的是已製作的特定圖案，印相同 Logo 不會自動辨識成不同的人。</li><li>LINE、IG 等 App 內的瀏覽器若無法開鏡頭，請用 Safari 或 Chrome 開啟這個頁面。</li></ul><p>AR 顯示分享者的公開內容，不代表身分、出席或合作信用驗證。</p></details>
  </section>;
}
