import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent,type PointerEvent,type MouseEvent} from 'react';
import {PARTY_GAMES,PARTY_RULES as R,type PartyGameId} from './catalog';
import {actParty,advanceParty,newParty,partySummary,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition,type PartyAction,type PartyRun} from './domain';
import type {RunResult} from '../result-card';
import type {PartyStage} from './stage';
import {syncDiagnostics} from '../diagnostics';
import {holidayCells,holidayInput} from './light-holiday';
import {loadPartyStage} from './stage-loader';
import {LightPartyScene} from './LightPartyScene';
import {partyViewport} from './viewport';
import {partyInputStamp,acceptsPartyInput,partyResultImage,chairView} from './light-party';
import './party.css';

/** PT-2/6: UI owns input and lifecycle; the pure domain owns every score. */
export function PartyGame({game,seed,onBack,onResult,onStart}:{game:PartyGameId;seed:number;onStart?:(target:HTMLElement|null)=>void;onBack:()=>void;onResult:(r:RunResult)=>void}) {
  const spec=PARTY_GAMES.find(g=>g.id===game)!;
  const live=useRef<PartyRun>(newParty(game,seed)),stage=useRef<PartyStage|null>(null),host=useRef<HTMLDivElement>(null);
  const frame=useRef(0),last=useRef<number|null>(null),lastDraw=useRef<number|null>(null),lastUi=useRef(0),loop=useRef<(t:number)=>void>(()=>{}),gesture=useRef<{id:number;x:number;y:number;round:number|null;stamp:number}|null>(null);
  const audio=useRef<AudioContext|null>(null),soundRef=useRef(false),motionRef=useRef(!matchMedia('(prefers-reduced-motion: reduce)').matches),settled=useRef(false);
  const [,repaint]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[restart,setRestart]=useState(false),[sound,setSound]=useState(false),[motion,setMotion]=useState(motionRef.current);
  const mode=useRef<'loading'|'native'|'light'|'failed'>('loading'),attempt=useRef<{cancel:()=>void}|null>(null),input=useRef(holidayInput()),controls=useRef(holidayInput());
  const restartButton=useRef<HTMLButtonElement>(null),confirmRestart=useRef<HTMLButtonElement>(null),resumeButton=useRef<HTMLButtonElement>(null);
  const [light,setLight]=useState(false);
  const holidayRoot=useRef<HTMLElement>(null),holidayOverlay=useRef<HTMLDivElement>(null),holidayModal=useRef<HTMLDialogElement>(null),helpButton=useRef<HTMLButtonElement>(null),helpClose=useRef<HTMLButtonElement>(null);
  const [viewport,setViewport]=useState(()=>partyViewport(640,480));
  // Measure real chrome, including 200% text and safe insets. Scene pixels fill
  // the whole owner; only scoring targets stay inside the unobscured core.
  useLayoutEffect(()=>{
    const root=holidayRoot.current,canvas=host.current;if(!root||!canvas)return;
    const bar=root.closest('.fullscreen-game')?.querySelector<HTMLElement>('.fullscreen-game__bar');
    const heading=root.querySelector<HTMLElement>('.pt-holiday-heading'),hud=root.querySelector<HTMLElement>('.pt-scoreboard');
    const elements=[root,heading,hud,root.querySelector<HTMLElement>('.pt-controls'),root.querySelector<HTMLElement>('.pt-holiday-footer'),bar].filter((el):el is HTMLElement=>!!el);
    let redraw=0;
    const measure=()=>{
      const bounds=canvas.getBoundingClientRect();if(bounds.width<=0||bounds.height<=0)return;
      const toolbar=bar?Math.ceil(bar.getBoundingClientRect().width+8):0;
      if(root.style.getPropertyValue('--pt-toolbar-width')!==`${toolbar}px`)root.style.setProperty('--pt-toolbar-width',`${toolbar}px`);
      const top=Math.max(...[heading,hud,bar].filter((el):el is HTMLElement=>!!el).map(el=>el.getBoundingClientRect().bottom-bounds.top),0)+8;
      const foot=[root.querySelector<HTMLElement>('.pt-controls'),root.querySelector<HTMLElement>('.pt-holiday-footer')].filter((el):el is HTMLElement=>!!el&&el.getBoundingClientRect().height>0);
      const bottom=Math.max(0,...foot.map(el=>bounds.bottom-el.getBoundingClientRect().top))+8;
      const footerHeight=root.querySelector<HTMLElement>('.pt-holiday-footer')?.getBoundingClientRect().height??0;
      if(root.style.getPropertyValue('--pt-footer-height')!==`${footerHeight}px`)root.style.setProperty('--pt-footer-height',`${footerHeight}px`);
      const rootStyle=getComputedStyle(root),left=Math.max(0,parseFloat(rootStyle.paddingLeft)||0),right=Math.max(0,parseFloat(rootStyle.paddingRight)||0);
      const next=partyViewport(bounds.width,bounds.height,top,bottom,left,right);
      for(const [key,value] of [['--pt-scene-top',top],['--pt-scene-bottom',bottom],['--pt-scene-left',left],['--pt-scene-right',right]] as const)if(canvas.style.getPropertyValue(key)!==`${value}px`)canvas.style.setProperty(key,`${value}px`);
      setViewport(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
      cancelAnimationFrame(redraw);redraw=requestAnimationFrame(()=>{redraw=0;safeDraw();});
    };
    const observer=new ResizeObserver(measure);elements.forEach(el=>observer.observe(el));
    window.addEventListener('resize',measure);measure();
    return()=>{observer.disconnect();cancelAnimationFrame(redraw);window.removeEventListener('resize',measure);};
  },[game,light,ready]);
  const restoreHolidayFocus=useRef<'restart'|'help'|null>(null);
  const [help,setHelp]=useState(false);
  useLayoutEffect(()=>{
    if(!restart&&!help){
      const target=restoreHolidayFocus.current;restoreHolidayFocus.current=null;
      if(target==='restart')restartButton.current?.focus({preventScroll:true});
      if(target==='help')helpButton.current?.focus({preventScroll:true});
      return;
    }
    const bar=holidayRoot.current?.closest('.fullscreen-game')?.querySelector<HTMLElement>('.fullscreen-game__bar');
    const prior=bar?.inert;if(bar)bar.inert=true;
    const dialog=holidayModal.current,panel=holidayOverlay.current;
    // Native top-layer modality makes Escape dismiss this panel before fullscreen.
    // Bind its fixed rect to the in-stage panel, including resize and page scroll.
    const place=()=>{if(!dialog||!panel)return;const rect=panel.getBoundingClientRect();Object.assign(dialog.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});};
    let observer:ResizeObserver|undefined;
    if(dialog&&panel){place();dialog.showModal();observer=new ResizeObserver(place);observer.observe(panel);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);}
    (restart?confirmRestart.current:helpClose.current)?.focus({preventScroll:true});
    const contain=(event:FocusEvent)=>{const panel=holidayOverlay.current;if(panel&&event.target instanceof Node&&!panel.contains(event.target)){(restart?confirmRestart.current:helpClose.current)?.focus({preventScroll:true});}};
    document.addEventListener('focusin',contain);
    return()=>{observer?.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);if(dialog?.open)dialog.close();if(bar)bar.inert=prior??false;document.removeEventListener('focusin',contain);};
  },[game,restart,help]);
  // begin() runs before React removes inert from the scene. Focus the same host
  // after that DOM commit, without moving focus on ordinary score updates.
  useLayoutEffect(()=>{
    if(live.current.status==='playing')host.current?.focus({preventScroll:true});
    // Pause disables its initiating button. Keep keyboard/Escape ownership in
    // this stage instead of leaving focus on a disabled button or the body.
    else if(live.current.status==='paused'&&!restart&&!help)resumeButton.current?.focus({preventScroll:true});
  },[game,live.current.status]);
  const escapeCapture=useRef<(event:globalThis.KeyboardEvent)=>void>(()=>{});
  escapeCapture.current=event=>{input.current.cancel();controls.current.cancel();gesture.current=null;if(restart){event.preventDefault();event.stopPropagation();keepRun();}else if(help){event.preventDefault();event.stopPropagation();closeHelp();}};
  useEffect(()=>{
    // Cancel holds before React. Only an open confirmation owns this Escape.
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')escapeCapture.current(event);};
    window.addEventListener('keydown',escape,true);
    return()=>window.removeEventListener('keydown',escape,true);
  },[]);
  function refresh(){repaint(n=>n+1);}
  function stop(){cancelAnimationFrame(frame.current);frame.current=0;last.current=null;lastDraw.current=null;gesture.current=null;input.current.cancel();controls.current.cancel();}
  function draw(){
    const s=live.current;
    if(stage.current)stage.current.update(s,motionRef.current);
    if(host.current){const stats=stage.current?.stats();syncDiagnostics(host.current,{renderCalls:stats?.calls??0,renderTriangles:stats?.triangles??0,renderGeometries:stats?.geometries??0,renderTextures:stats?.textures??0,anchors:JSON.stringify(stage.current?.anchors()??[]),elapsed:s.elapsed,round:s.game==='holiday'?s.round:0,lane:s.game==='chair'?s.lane:0,tofuOffset:s.game==='tofu'?tofuPosition(s)[tofuAxis(s)]-s.layers[s.layers.length-1][tofuAxis(s)]:''});}
  }
  function failStage(message:string){live.current=pauseParty(live.current);stop();mode.current='failed';attempt.current?.cancel();stage.current=null;draw();setReady(false);setError(message);refresh();}
  function safeDraw(){try{draw();return true;}catch{failStage('場景暫時無法顯示。本局仍保留，選擇可用玩法後可繼續。');return false;}}
  function pauseRun(message='這局先停在這裡。'){const next=pauseParty(live.current);if(next===live.current)return;live.current=next;stop();setNotice(message);safeDraw();refresh();}
  function kick(){if(!frame.current&&live.current.status==='playing')frame.current=requestAnimationFrame(t=>loop.current(t));}
  function soundEffect(good:boolean){if(!soundRef.current)return;try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume().catch(()=>{});const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;osc.type='sine';osc.frequency.setValueAtTime(good?520:180,t);osc.frequency.exponentialRampToValueAtTime(good?820:95,t+.1);gain.gain.setValueAtTime(.055,t);gain.gain.exponentialRampToValueAtTime(.001,t+.13);osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.15);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{/* Optional audio never decides an action. */}}
  loop.current=t=>{
    frame.current=0;if((mode.current!=='native'&&mode.current!=='light')||live.current.status!=='playing')return;
    const dt=last.current===null?0:t-last.current;last.current=t;
    if(dt>R.stallMs){pauseRun('畫面剛才停了一下，已替你暫停。準備好再繼續。');return;}
    const before=live.current;live.current=advanceParty(before,dt);
    const changed=live.current.score!==before.score||live.current.status!==before.status||partyInputStamp(live.current)!==partyInputStamp(before);
    if(live.current.score!==before.score)soundEffect(live.current.score>before.score);
    // Advance every simulation frame; bound the expensive 3D presentation to 30fps.
    // Input, pause, context recovery and the final frame still draw immediately.
    const drawInterval=1000/30,drawElapsed=lastDraw.current===null?0:t-lastDraw.current;
    if(changed||lastDraw.current===null||drawElapsed>=drawInterval||live.current.status!=='playing'){
      lastDraw.current=lastDraw.current===null?t:t-drawElapsed%drawInterval;
      if(!safeDraw())return;
    }
    // Landing, wave resolution and earned scores are semantic events, not a
    // throttled animation sample. Publish them in the same simulation frame.
    if(changed||t-lastUi.current>=(mode.current==='light'?1000/30:R.uiMs)||live.current.status==='done'){lastUi.current=t;refresh();}
    if(live.current.status==='playing')kick();else stop();
  };
  useEffect(()=>{
    stop();mode.current='loading';setReady(false);setError('');setLight(false);
    const owner=loadPartyStage({
      load:()=>import('./stage').then(({createPartyStage})=>(lost:()=>void)=>{if(!host.current)throw Error('Scene owner is gone.');return createPartyStage(host.current,game,lost);}),
      install:created=>{stage.current=created;draw();},
      ready:()=>{mode.current='native';setReady(true);},
      failed:reason=>failStage(reason==='lost'?'3D 畫面已中斷，本局已暫停。選擇玩法後可以繼續。':reason==='timeout'?'3D 場景載入較久。本局仍保留，可以重試。':'無法開啟 3D 場景。本局仍保留，可以重試。'),
      timeoutMs:R.loaderMs,
    });
    attempt.current=owner;
    return()=>{owner.cancel();if(attempt.current===owner)attempt.current=null;stop();stage.current=null;};
  },[game,retry]);
  useEffect(()=>{if(restart)confirmRestart.current?.focus();},[restart]);
  function chooseLight(){live.current=pauseParty(live.current);stop();attempt.current?.cancel();stage.current=null;mode.current='light';setLight(true);setError('');setReady(true);setNotice('已改用輕量玩法，分數與進度保留。按繼續才會計時。');draw();refresh();host.current?.focus({preventScroll:true});}
  function retryStage(){live.current=pauseParty(live.current);stop();attempt.current?.cancel();stage.current=null;mode.current='loading';setReady(false);setError('');setRetry(n=>n+1);}
  function keepRun(){restoreHolidayFocus.current='restart';setRestart(false);}
  useEffect(()=>{const hidden=()=>{if(document.hidden)pauseRun('離開畫面時已暫停，回來後按繼續。');};const blur=()=>pauseRun('這局已暫停，準備好再繼續。');document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);stop();void audio.current?.close().catch(()=>{});};},[]);
  function begin(){if(restart||!['ready','paused'].includes(live.current.status))return;if(mode.current!=='native'&&mode.current!=='light')return;live.current=live.current.status==='paused'?resumeParty(live.current):startParty(live.current);setNotice('');last.current=null;if(!safeDraw())return;onStart?.(host.current);refresh();kick();host.current?.focus({preventScroll:true});}
  function action(a:PartyAction){if(mode.current!=='native'&&mode.current!=='light')return;const before=live.current;live.current=actParty(before,a);if(before!==live.current){if(a.kind==='pick')soundEffect(live.current.score>before.score);safeDraw();refresh();}}
  function reset(){restoreHolidayFocus.current='restart';stop();live.current=newParty(game,seed);settled.current=false;setRestart(false);setNotice('');safeDraw();refresh();host.current?.focus({preventScroll:true});}
  function result(){
    const completed=live.current;if(restart)return;if(completed.status!=='done'||settled.current)return;
    settled.current=true;
    try{
      if(!safeDraw()){settled.current=false;return;}
      const image=mode.current==='light'?partyResultImage(completed):stage.current?.capture();
      if(!image)throw Error('No result image.');
      onResult({game,seed:completed.seed,title:spec.title,...partySummary(completed),image});
    }catch{settled.current=false;setNotice('這局已完成，圖片還沒產生。可以重試查看成果。');}
  }
  function closeHelp(){restoreHolidayFocus.current='help';setHelp(false);}
  function holidayKey(e:KeyboardEvent<HTMLElement>){
    if(restart||help){
      if(e.key==='Tab'){
        const choices=Array.from(holidayOverlay.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')??[]).filter(node=>node.getClientRects().length>0);
        const first=choices[0],last=choices[choices.length-1];
        if(first&&(!holidayOverlay.current?.contains(document.activeElement)||e.shiftKey&&document.activeElement===first)){e.preventDefault();last.focus();}
        else if(last&&!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        e.stopPropagation();
      }
      return;
    }
    key(e);
  }
  function key(e:KeyboardEvent<HTMLElement>){
    if(e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape'){e.preventDefault();input.current.cancel();controls.current.cancel();if(restart)keepRun();else pauseRun();return;}
    if(restart)return;
    if((e.target instanceof HTMLButtonElement||e.target instanceof HTMLAnchorElement)&&[' ','Enter'].includes(e.key))return;
    if(e.key==='Enter'&&live.current.status!=='playing'){e.preventDefault();if(live.current.status==='done')result();else begin();return;}
    const k=e.key.toLowerCase();let a:PartyAction|null=null;
    if(game==='chair')a=k==='arrowleft'||k==='a'?{kind:'lane',direction:-1}:k==='arrowright'||k==='d'?{kind:'lane',direction:1}:k===' '?{kind:'jump'}:null;
    if(game==='tofu'&&k===' ')a={kind:'drop'};
    if(game==='holiday'&&/^[1-6]$/.test(k)&&live.current.game==='holiday')a={kind:'pick',hole:Number(k)-1,round:live.current.round};
    if(a){e.preventDefault();action(a);}
  }
  function down(e:PointerEvent<HTMLDivElement>){if(live.current.status!=='playing'||e.button!==0||!e.isPrimary||gesture.current)return;e.preventDefault();gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,round:live.current.game==='holiday'?live.current.round:null,stamp:partyInputStamp(live.current)};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus({preventScroll:true});}
  function up(e:PointerEvent<HTMLDivElement>){const g=gesture.current;if(!g||g.id!==e.pointerId)return;gesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(live.current.status!=='playing')return;const dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(game!=='holiday'&&!acceptsPartyInput(live.current,g.stamp))return;
    if(game==='chair'){if(Math.abs(dx)>=R.gesturePx&&Math.abs(dx)>Math.abs(dy))action({kind:'lane',direction:dx<0?-1:1});else action({kind:'jump'});}
    else if(game==='tofu')action({kind:'drop'});
    else if(live.current.game==='holiday'){const hole=stage.current?.pick(e.clientX,e.clientY);if(hole!==null&&hole!==undefined)action({kind:'pick',hole,round:g.round??-1});}
  }
  // Buttons keep native focus/AT behavior, but releases cannot target a later wave.
  function controlHandlers(id:number,a:PartyAction|(()=>PartyAction|null)){
    const resolve=()=>typeof a==='function'?a():a;
    const press=(owner:string)=>{if(resolve())controls.current.down(id,owner,partyInputStamp(live.current));else controls.current.cancel(id);};
    const commit=(stamp:number|null)=>{const next=resolve();if(next&&!restart&&acceptsPartyInput(live.current,stamp))action(next);};
    return {
      onPointerDown:(e:PointerEvent<HTMLButtonElement>)=>{if(e.button===0&&e.isPrimary)press(`pointer:${e.pointerId}`);},
      onPointerUp:(e:PointerEvent<HTMLButtonElement>)=>controls.current.up(id,`pointer:${e.pointerId}`),
      onPointerCancel:(e:PointerEvent<HTMLButtonElement>)=>controls.current.cancel(id,`pointer:${e.pointerId}`),
      onLostPointerCapture:(e:PointerEvent<HTMLButtonElement>)=>controls.current.lost(id,`pointer:${e.pointerId}`),
      onBlur:()=>controls.current.cancel(id),
      onKeyDown:(e:KeyboardEvent<HTMLButtonElement>)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat&&!e.altKey&&!e.ctrlKey&&!e.metaKey)press(`key:${e.key}`);}},
      onKeyUp:(e:KeyboardEvent<HTMLButtonElement>)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(e.altKey||e.ctrlKey||e.metaKey){controls.current.cancel(id);return;}commit(controls.current.click(id,partyInputStamp(live.current),`key:${e.key}`));}},
      onClick:(e:MouseEvent<HTMLButtonElement>)=>commit(e.detail===0?controls.current.assistive(id,partyInputStamp(live.current)):controls.current.pointerClick(id)),
    };
  }
  function laneHandlers(target:-1|0|1){
    // A numbered destination is not a relative arrow: recheck the live lane on
    // release, and never queue a second move or bypass the domain's cooldown.
    return controlHandlers(10+target,()=>{const run=live.current;if(run.game!=='chair'||Math.abs(target-run.lane)!==1)return null;return {kind:'lane',direction:target<run.lane?-1:1};});
  }
  const s=live.current,playing=s.status==='playing',done=s.status==='done',duration=game==='chair'?R.chairMs:game==='tofu'?R.tofuMs:R.holidayMs;
  const aligned=s.game==='tofu'&&!s.fall&&Math.abs(tofuPosition(s)[tofuAxis(s)]-s.layers[s.layers.length-1][tofuAxis(s)])<=R.tofuPerfect;
  const summary=partySummary(s);
  function holeControls(){if(s.game!=='holiday')return null;return <div className={`pt-hole-controls${light?' pt-light-grid':''}`} style={light?{left:viewport.core.x,top:viewport.core.y,width:viewport.core.width,height:viewport.core.height}:undefined} aria-label="六格假日蒸籠">{holidayCells(s).map(cell=><button key={cell.hole} className={cell.kind==='good'?'pt-good':cell.kind==='boss'?'pt-boss':''} aria-label={`第 ${cell.hole+1} 格：${cell.label}`} disabled={!ready||!!error||!cell.enabled}
    onPointerDown={e=>{if(e.button===0&&e.isPrimary)input.current.down(cell.hole,`pointer:${e.pointerId}`,s.round);}}
    onPointerUp={e=>input.current.up(cell.hole,`pointer:${e.pointerId}`)}
    onPointerCancel={e=>input.current.cancel(cell.hole,`pointer:${e.pointerId}`)}
    onLostPointerCapture={e=>input.current.lost(cell.hole,`pointer:${e.pointerId}`)}
    onBlur={()=>input.current.cancel(cell.hole)}
    onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat&&!e.altKey&&!e.ctrlKey&&!e.metaKey)input.current.down(cell.hole,`key:${e.key}`,s.round);}}}
    onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(e.altKey||e.ctrlKey||e.metaKey){input.current.cancel(cell.hole);return;}const round=input.current.click(cell.hole,s.round,`key:${e.key}`);if(round!==null)action({kind:'pick',hole:cell.hole,round});}}}
    onClick={e=>{const round=e.detail===0?input.current.assistive(cell.hole,s.round):input.current.pointerClick(cell.hole);if(round!==null)action({kind:'pick',hole:cell.hole,round});}}>
    <b>{cell.hole+1}</b>{light&&<svg viewBox="0 0 100 90" aria-hidden="true" focusable="false"><ellipse cx="50" cy="76" rx="43" ry="10" fill="#d4b88b" stroke="#443b37" strokeWidth="3"/>{(cell.kind==='good'||cell.kind==='boss')&&<><path d="M22 70 Q15 22 48 22 Q82 20 79 70Z" fill="#fff8e8" stroke="#443b37" strokeWidth="3"/><circle cx="38" cy="45" r="3" fill="#443b37"/><circle cx="62" cy="45" r="3" fill="#443b37"/><path d="M41 55 Q50 63 59 55" fill="none" stroke="#443b37" strokeWidth="3"/>{cell.kind==='good'?<path d="M48 24 Q43 3 69 8 Q68 26 48 24Z" fill="#7d9973" stroke="#443b37" strokeWidth="3"/>:<><path d="M27 26 V17 H73 V26Z" fill="#897c9b" stroke="#443b37" strokeWidth="3"/><path d="M46 61 H54 L59 73 L50 79 L41 73Z" fill="#897c9b" stroke="#443b37" strokeWidth="2"/></>}</>}<path d="M10 72 Q50 87 90 72 V81 Q50 96 10 81Z" fill="#dec49c" stroke="#443b37" strokeWidth="3"/></svg>}<span className="pt-target-label">{cell.kind==='good'?'休':cell.kind==='boss'?'會':cell.kind==='empty'?'空':cell.label==='已選'?'已':'等'}</span></button>)}</div>;}
  // Every party game shares one bounded shell; controls never own the hit-test host.
  {
    const modal=restart||help,covered=modal||!ready||!!error||!playing,holiday=s.game==='holiday',compactTools=holiday||s.game==='tofu'||s.game==='chair';
    const next=s.game==='chair'?chairView(s).waves[0]:null;
    return <section ref={holidayRoot} className={`pt-root pt-${game} pt-holiday-stage${holiday?' pt-holiday-composition':''}${s.game==='chair'?' pt-chair-stage pt-chair-composition':s.game==='tofu'?' pt-tofu-stage pt-tofu-composition':''}`} onKeyDown={holidayKey} data-party-mode={light?'light':'3d'} data-party-state={s.status} data-party-score={s.score}>
      <header className="pt-holiday-heading" inert={modal}><h1>{spec.title}</h1><button className="fw-arcade-secondary" aria-label="回遊戲大廳" title="回遊戲大廳" onClick={onBack}>↩</button></header>
      <div className="pt-scoreboard" aria-label="本局狀態"><div><small>本局得分</small><strong>{s.score}<span>分</span></strong></div><div><small>剩餘時間</small><strong>{Math.ceil((duration-s.elapsed)/1000)}<span>秒</span></strong></div><div><small>{s.game==='chair'?'下班意志':s.game==='tofu'?'豆腐樓層':'最長連擊'}</small>{s.game==='chair'?<strong aria-label={`剩餘 ${s.lives} 顆心`}><span className="pt-life-icon" aria-hidden="true">♥</span> {s.lives}</strong>:s.game==='tofu'?<strong aria-label={`完成 ${s.layers.length-1} / ${R.tofuGoal} 層，還能失手 ${R.tofuMisses-s.misses} 次`}>{s.layers.length-1}/{R.tofuGoal}<span className="pt-hud-detail">餘 {R.tofuMisses-s.misses} 次</span></strong>:<strong aria-label={`最長連擊 ${s.bestCombo} 次`}>{s.bestCombo}<span>連</span></strong>}</div></div>
      <div className="pt-holiday-field pt-play-area" data-light={light?'true':'false'}>
        <div className="pt-holiday-world" inert={covered}>
          <div ref={host} className={`pt-canvas${light?' pt-light-stage':''}`} tabIndex={0} role="application" aria-label={`${spec.title} ${light?'輕量玩法':'3D 場景'}。${s.game==='chair'?'左右滑換路，輕點場景跳躍；也可選相鄰跑道或用 A / D、空白鍵。':s.game==='tofu'?spec.keys:'按 1–6 或點休假，避開開會。'}`} data-party-live-viewport="" data-party-stage={error?'failed':ready?'ready':'loading'} onPointerDown={light&&s.game==='holiday'?undefined:down} onPointerUp={light&&s.game==='holiday'?undefined:up} onBlur={()=>{gesture.current=null;}} onLostPointerCapture={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}} onPointerCancel={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}}/>
          {light&&(s.game==='holiday'?<div className="pt-holiday-light-board"><svg className="pt-paper-scenery" viewBox={`${viewport.viewBox.x} ${viewport.viewBox.y} ${viewport.viewBox.width} ${viewport.viewBox.height}`} aria-hidden="true" focusable="false"><rect x="-5000" y="-5000" width="10000" height="10000" fill="#f4dfb1"/><circle cx="550" cy="-140" r="90" fill="#fff4cf"/><path d="M-3000 200 Q-800 -300 0 120 T1300 60 T4000 150 V4000 H-3000Z" fill="#b7ba78"/><path d="M-3000 380 Q-400 -20 300 280 T1600 190 T4000 350 V4000 H-3000Z" fill="#72966b"/><path d="M-3000 570 Q0 200 450 510 T4000 500 V4000 H-3000Z" fill="#426e54"/>{Array.from({length:25},(_,i)=><g key={i} transform={`translate(${-1200+i*130} ${-250+Math.sin(i)*30})`}><path d="M0 0L130 0" stroke="#8a6951" strokeWidth="3"/><path d="M12 0L62 70L112 0Z" fill={i%2?'#d5825f':'#f7df9b'}/></g>)}</svg>{holeControls()}</div>:<div className={s.game==='chair'?'pt-chair-light-board':'pt-tofu-light-board'}><LightPartyScene run={s} viewport={viewport}/></div>)}
        </div>
        <div className="pt-gameplay-core" aria-hidden="true" style={{left:viewport.core.x,top:viewport.core.y,width:viewport.core.width,height:viewport.core.height}}/>
        {s.game==='chair'?<div className="pt-controls pt-chair-controls" aria-label="遊戲操作" inert={covered}><div className="pt-lane-selector" role="group" aria-label="選擇跑道，每次換一條相鄰跑道">{([-1,0,1] as const).map(lane=><button key={lane} data-chair-lane={lane} aria-label={`第 ${lane+2} 道`} aria-pressed={lane===s.lane} aria-disabled={Math.abs(lane-s.lane)!==1} title={lane===s.lane?'目前跑道':Math.abs(lane-s.lane)>1?'先選第 2 道':'切換跑道'} disabled={!playing||!ready||!!error} {...laneHandlers(lane)}>{lane+2}道</button>)}</div><button className="pt-primary-control" aria-label="跳一下！" disabled={!playing||!ready||!!error} {...controlHandlers(1,{kind:'jump'})}>跳一下</button></div>:s.game==='tofu'?<div className="pt-controls pt-tofu-controls" aria-label="遊戲操作" inert={covered}><button className="pt-drop pt-primary-control" aria-label={s.fall?'豆腐降落中…':'豆腐落下！'} disabled={!playing||!ready||!!error||!!s.fall} {...controlHandlers(3,{kind:'drop'})}><span aria-hidden="true">{s.fall?'降落中':'落下'}</span></button></div>:!light&&<div className="pt-controls" aria-label="遊戲操作" inert={covered}>{holeControls()}</div>}
        <div className="pt-holiday-footer">
        <div className="pt-holiday-feedback" inert={modal}><p className="pt-live-label">{light?'輕量玩法 · ':''}{s.game==='chair'?`假日票 ${s.tickets} 張 · ${s.resolved} / ${R.chairWaves} 波`:s.game==='tofu'?`還能失手 ${R.tofuMisses-s.misses} 次 · 完美貼齊 ${s.perfects} 次`:`已守住 ${s.saved} 個假日 · ${Math.min(20,s.round+1)} / 20 波`}</p><p className="pt-feedback" role="status">{playing&&s.elapsed-s.feedbackAt<1100?s.feedback:playing?s.game==='chair'?next?`第 ${next.index+1} 波 · ${next.kind==='meeting'?'會議桌要換路':'推車可以跳'}`:'前方暫時沒有障礙':s.game==='tofu'?s.fall?'豆腐穩穩落下…':aligned?'對齊了！現在落下':`${tofuAxis(s).toUpperCase()} 軸移動 · 等對齊再落下`:'點休假，避開開會。':notice||(s.game==='chair'?'左右滑換路，輕點跳躍。':s.game==='tofu'?'點場景、落下按鈕或空白鍵。':'葉子是休假，領帶是開會。')}</p></div>
      <div className="pt-holiday-tools-viewport" inert={modal}><div className="pt-tools" aria-label="遊戲工具"><button className="fw-arcade-secondary" disabled={!playing} aria-label={compactTools?'暫停':undefined} title={compactTools?'暫停':undefined} onClick={()=>pauseRun()}>{compactTools?<span aria-hidden="true">Ⅱ</span>:<>暫停 <span aria-hidden="true">Ⅱ</span></>}</button><button ref={restartButton} className="fw-arcade-secondary" aria-label={compactTools?'重新開始':undefined} title={compactTools?'重新開始':undefined} onClick={()=>{pauseRun();setRestart(true);}}>{compactTools?<span aria-hidden="true">↻</span>:'重新開始'}</button><button ref={helpButton} className="fw-arcade-secondary" aria-label={compactTools?'玩法與設定':undefined} title={compactTools?'玩法與設定':undefined} onClick={()=>{pauseRun('看完玩法後，按繼續回到這一局。');setHelp(true);}}>{compactTools?<span aria-hidden="true">?</span>:'玩法與設定'}</button><button className="fw-arcade-secondary" aria-pressed={sound} aria-label={compactTools?`音效${sound?'開':'關'}`:undefined} title={compactTools?`音效${sound?'開':'關'}`:undefined} onClick={()=>{soundRef.current=!sound;setSound(!sound);if(!sound)soundEffect(true);}}>{compactTools?<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9h4l5-4v14l-5-4H4z"/>{sound?<path d="M16 8q5 4 0 8m3-11q8 7 0 14"/>:<path d="m17 9 5 6m0-6-5 6"/>}</svg>:<>音效{sound?'開':'關'}</>}</button><button className="fw-arcade-secondary" aria-pressed={!motion} aria-label={compactTools?`減少動態${motion?'關':'開'}`:undefined} title={compactTools?`減少動態${motion?'關':'開'}`:undefined} onClick={()=>{motionRef.current=!motion;setMotion(!motion);safeDraw();}}>{compactTools?<span aria-hidden="true">{motion?'動':'靜'}</span>:<>減少動態{motion?'關':'開'}</>}</button>{light&&<button className="fw-arcade-secondary" aria-label={compactTools?'重試 3D，保留這局':undefined} title={compactTools?'重試 3D，保留這局':undefined} onClick={retryStage}>{compactTools?<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 9 5v9l-9 5-9-5V8zm0 10L3 8m9 5 9-5m-9 5v9"/></svg>:'重試 3D，保留這局'}</button>}</div></div>
        </div>
        {covered&&<div className="pt-holiday-overlay" ref={holidayOverlay}>
          {modal?<dialog ref={holidayModal} className="pt-holiday-modal" aria-label={restart?'重新開始這局':'玩法與設定'} onCancel={event=>{event.preventDefault();if(restart)keepRun();else closeHelp();}}>{restart?<div className="pt-panel pt-restart" role="group" aria-label="確認重新開始"><h2>{s.game==='chair'?'再逃一次會議？':s.game==='tofu'?'再疊一座豆腐樓？':'再守一次假日？'}</h2><p>這局會從零開始，題目不變。</p><button ref={confirmRestart} onClick={reset}>確定重來</button><button className="fw-arcade-secondary" onClick={keepRun}>保留這局</button></div>
          :<div className="pt-panel pt-holiday-help"><h2>{s.game==='chair'?'會議可以等，下班不能。':s.game==='tofu'?'手要穩，豆腐要嫩。':'搶救休假，放過開會。'}</h2><p>{spec.rule} {s.game==='chair'?'撞到會扣一顆心；三顆心用完就結束。換路需要移動時間，按住等下一波不算。':s.game==='tofu'?'堆到 12 層就完成；三次失手或 60 秒結束。沒有對齊的部分會被切掉，下一塊會變窄。':'空蒸籠也會扣分。每波只有短短一刻，按住等下一波不算。'}</p><p>{s.game==='chair'?'左右滑至少 28 像素換路，輕點場景跳躍。也可選相鄰的跑道號碼或按跳一下；選中的號碼是目前跑道。鍵盤 A / D 或方向鍵換路，空白鍵跳躍。會議桌要躲開，矮推車可以跳過；葉子黃票是假日票。':s.game==='tofu'?'豆腐交替沿 X、Z 軸移動，靠齊下層時點場景、落下按鈕或按空白鍵。落下後等它落定；按住跨層不會替下一塊落下。完美貼齊保留大小並增加連擊。':'直接點 3D 角色、六格按鈕，或按鍵盤 1–6。葉子和「休假」、領帶和「開會」會一起標示。'}</p><p>同題 #{seed} · {s.game==='chair'?'30 秒、22 波、3 顆心':s.game==='tofu'?'60 秒、12 層、3 次失手':'24 秒、20 波'}。離開視窗會暫停，按繼續才重新計時。重新整理或離頁會重新開始；分數不計入平台貢獻。</p><button ref={helpClose} onClick={closeHelp}>回到遊戲</button></div>}</dialog>
          :error||!ready?<div className="pt-panel" role={error?'alert':'status'}><h2>{error?'場景先休息一下。':'正在搭建你的迷你世界…'}</h2><p>{error||'角色和道具就快到齊了。'}</p><button onClick={chooseLight}>改用輕量玩法</button>{error&&<button onClick={retryStage}>重建 3D 場景</button>}<button className="fw-arcade-secondary" onClick={onBack}>先回遊戲大廳</button></div>
          :<div className="pt-panel" aria-label={done?'本局完成':s.status==='paused'?'遊戲暫停':'開玩說明'}><p className="pt-kicker">{done?'本局完成':s.status==='paused'?'這局幫你留著。':s.game==='chair'?'30 秒 · 22 波 · 3 顆心':s.game==='tofu'?'60 秒 · 12 層 · 3 次失手':'24 秒 · 20 波假日'}</p><h2>{done?summary.caption:s.status==='paused'?'準備好再繼續。':s.game==='chair'?'會議可以等，下班不能。':s.game==='tofu'?'手要穩，豆腐要嫩。':'把假日，好好搶回來。'}</h2><p>{done?summary.details:s.status==='paused'?notice:spec.rule}</p>{s.status==='ready'&&<p>{s.game==='chair'?'左右滑換路，輕點場景跳躍；也可選相鄰跑道或按跳一下。':s.game==='tofu'?'等豆腐靠齊，點場景、落下按鈕或空白鍵。':'點角色、六格按鈕或按 1–6。'}離頁會重新開始。</p>}<button ref={resumeButton} onClick={done?result:begin}>{done?'查看這局成果':s.status==='paused'?'繼續這一局':'開始派對！'}</button>{done&&light&&<a className="pt-download" download={`${s.game}-${s.seed}.svg`} href={partyResultImage(s)}>下載本局成果 SVG</a>}{done&&light&&s.game==='tofu'&&<p>輕量成果卡呈現本局實際堆疊與成績，不是 3D 截圖。</p>}{done&&light&&s.game==='chair'&&<p>輕量成果卡只記錄本局總計，沒有保存逐波路線。</p>}{done&&notice&&<p role="status">{notice}</p>}</div>}
        </div>}
      </div>
    </section>;
  }
}
