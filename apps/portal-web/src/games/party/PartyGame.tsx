import {GameCover} from '../GameCover';
import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {PARTY_GAMES,PARTY_RULES as R,type PartyGameId} from './catalog';
import {actParty,advanceParty,newParty,partySummary,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition,type PartyAction,type PartyRun} from './domain';
import type {RunResult} from '../result-card';
import type {PartyStage} from './stage';
import {syncDiagnostics} from '../diagnostics';
import {holidayCells,holidayInput,holidayResultImage} from './light-holiday';
import {loadPartyStage} from './stage-loader';
import './party.css';

/** PT-2/6: UI owns input and lifecycle; the pure domain owns every score. */
export function PartyGame({game,seed,onBack,onResult}:{game:PartyGameId;seed:number;onBack:()=>void;onResult:(r:RunResult)=>void}) {
  const spec=PARTY_GAMES.find(g=>g.id===game)!;
  const live=useRef<PartyRun>(newParty(game,seed)),stage=useRef<PartyStage|null>(null),host=useRef<HTMLDivElement>(null);
  const frame=useRef(0),last=useRef<number|null>(null),lastDraw=useRef<number|null>(null),lastUi=useRef(0),loop=useRef<(t:number)=>void>(()=>{}),gesture=useRef<{id:number;x:number;y:number;round:number|null}|null>(null);
  const audio=useRef<AudioContext|null>(null),soundRef=useRef(false),motionRef=useRef(!matchMedia('(prefers-reduced-motion: reduce)').matches),settled=useRef(false);
  const [,repaint]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[restart,setRestart]=useState(false),[sound,setSound]=useState(false),[motion,setMotion]=useState(motionRef.current);
  const mode=useRef<'loading'|'native'|'light'|'failed'>('loading'),attempt=useRef<{cancel:()=>void}|null>(null),input=useRef(holidayInput());
  const restartButton=useRef<HTMLButtonElement>(null),confirmRestart=useRef<HTMLButtonElement>(null);
  const [light,setLight]=useState(false);
  const escapeCapture=useRef<(event:globalThis.KeyboardEvent)=>void>(()=>{});
  escapeCapture.current=event=>{input.current.cancel();gesture.current=null;if(restart){event.preventDefault();event.stopPropagation();keepRun();}};
  useEffect(()=>{
    // Cancel holds before React. Only an open confirmation owns this Escape.
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')escapeCapture.current(event);};
    window.addEventListener('keydown',escape,true);
    return()=>window.removeEventListener('keydown',escape,true);
  },[]);
  function refresh(){repaint(n=>n+1);}
  function stop(){cancelAnimationFrame(frame.current);frame.current=0;last.current=null;lastDraw.current=null;gesture.current=null;input.current.cancel();}
  function draw(){
    const s=live.current;
    if(stage.current)stage.current.update(s,motionRef.current);
    if(host.current){const stats=stage.current?.stats();syncDiagnostics(host.current,{renderCalls:stats?.calls??0,renderTriangles:stats?.triangles??0,renderGeometries:stats?.geometries??0,renderTextures:stats?.textures??0,anchors:JSON.stringify(stage.current?.anchors()??[]),elapsed:s.elapsed,round:s.game==='holiday'?s.round:0,lane:s.game==='chair'?s.lane:0,tofuOffset:s.game==='tofu'?tofuPosition(s)[tofuAxis(s)]-s.layers[s.layers.length-1][tofuAxis(s)]:''});}
  }
  function failStage(message:string){live.current=pauseParty(live.current);stop();mode.current='failed';attempt.current?.cancel();stage.current=null;setReady(false);setError(message);refresh();}
  function safeDraw(){try{draw();return true;}catch{failStage('場景暫時無法顯示。本局仍保留，選擇可用玩法後可繼續。');return false;}}
  function pauseRun(message='這局先停在這裡。'){const next=pauseParty(live.current);if(next===live.current)return;live.current=next;stop();setNotice(message);safeDraw();refresh();}
  function kick(){if(!frame.current&&live.current.status==='playing')frame.current=requestAnimationFrame(t=>loop.current(t));}
  function soundEffect(good:boolean){if(!soundRef.current)return;try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume().catch(()=>{});const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;osc.type='sine';osc.frequency.setValueAtTime(good?520:180,t);osc.frequency.exponentialRampToValueAtTime(good?820:95,t+.1);gain.gain.setValueAtTime(.055,t);gain.gain.exponentialRampToValueAtTime(.001,t+.13);osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.15);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{/* Optional audio never decides an action. */}}
  loop.current=t=>{
    frame.current=0;if((mode.current!=='native'&&mode.current!=='light')||live.current.status!=='playing')return;
    const dt=last.current===null?0:t-last.current;last.current=t;
    if(dt>R.stallMs){pauseRun('畫面剛才停了一下，已替你暫停。準備好再繼續。');return;}
    const before=live.current;live.current=advanceParty(before,dt);
    if(live.current.score!==before.score)soundEffect(live.current.score>before.score);
    // Advance every simulation frame; bound the expensive 3D presentation to 30fps.
    // Input, pause, context recovery and the final frame still draw immediately.
    const drawInterval=1000/30,drawElapsed=lastDraw.current===null?0:t-lastDraw.current;
    if(lastDraw.current===null||drawElapsed>=drawInterval||live.current.status!=='playing'){
      lastDraw.current=lastDraw.current===null?t:t-drawElapsed%drawInterval;
      if(!safeDraw())return;
    }
    if(t-lastUi.current>=(mode.current==='light'?1000/30:R.uiMs)||live.current.status==='done'){lastUi.current=t;refresh();}
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
  function chooseLight(){if(game!=='holiday')return;live.current=pauseParty(live.current);stop();attempt.current?.cancel();stage.current=null;mode.current='light';setLight(true);setError('');setReady(true);setNotice('已改用輕量玩法，分數與進度保留。按繼續才會計時。');draw();refresh();host.current?.focus({preventScroll:true});}
  function retryStage(){live.current=pauseParty(live.current);stop();attempt.current?.cancel();stage.current=null;mode.current='loading';setReady(false);setError('');setRetry(n=>n+1);}
  function keepRun(){setRestart(false);restartButton.current?.focus({preventScroll:true});}
  useEffect(()=>{const hidden=()=>{if(document.hidden)pauseRun('離開畫面時已暫停，回來後按繼續。');};const blur=()=>pauseRun('這局已暫停，準備好再繼續。');document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);stop();void audio.current?.close().catch(()=>{});};},[]);
  function begin(){if(restart)return;if(mode.current!=='native'&&mode.current!=='light')return;live.current=live.current.status==='paused'?resumeParty(live.current):startParty(live.current);setNotice('');last.current=null;if(!safeDraw())return;refresh();kick();host.current?.focus({preventScroll:true});host.current?.closest('.pt-play-area')?.scrollIntoView({block:'start',behavior:'instant'});}
  function action(a:PartyAction){if(mode.current!=='native'&&mode.current!=='light')return;const before=live.current;live.current=actParty(before,a);if(before!==live.current){if(a.kind==='pick')soundEffect(live.current.score>before.score);safeDraw();refresh();}}
  function reset(){stop();live.current=newParty(game,seed);settled.current=false;setRestart(false);setNotice('');safeDraw();refresh();host.current?.focus({preventScroll:true});}
  function result(){
    const completed=live.current;if(restart)return;if(completed.status!=='done'||settled.current)return;
    settled.current=true;
    try{
      if(!safeDraw()){settled.current=false;return;}
      const image=mode.current==='light'&&completed.game==='holiday'?holidayResultImage(completed):stage.current?.capture();
      if(!image)throw Error('No result image.');
      onResult({game,seed:completed.seed,title:spec.title,...partySummary(completed),image});
    }catch{settled.current=false;setNotice('這局已完成，圖片還沒產生。可以重試查看成果。');}
  }
  function key(e:KeyboardEvent<HTMLElement>){
    if(e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape'){e.preventDefault();input.current.cancel();if(restart)keepRun();else pauseRun();return;}
    if(restart)return;
    if((e.target instanceof HTMLButtonElement||e.target instanceof HTMLAnchorElement)&&[' ','Enter'].includes(e.key))return;
    if(e.key==='Enter'&&live.current.status!=='playing'){e.preventDefault();if(live.current.status==='done')result();else begin();return;}
    const k=e.key.toLowerCase();let a:PartyAction|null=null;
    if(game==='chair')a=k==='arrowleft'||k==='a'?{kind:'lane',direction:-1}:k==='arrowright'||k==='d'?{kind:'lane',direction:1}:k===' '?{kind:'jump'}:null;
    if(game==='tofu'&&k===' ')a={kind:'drop'};
    if(game==='holiday'&&/^[1-6]$/.test(k)&&live.current.game==='holiday')a={kind:'pick',hole:Number(k)-1,round:live.current.round};
    if(a){e.preventDefault();action(a);}
  }
  function down(e:PointerEvent<HTMLDivElement>){if(live.current.status!=='playing'||e.button!==0||!e.isPrimary||gesture.current)return;e.preventDefault();gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,round:live.current.game==='holiday'?live.current.round:null};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus({preventScroll:true});}
  function up(e:PointerEvent<HTMLDivElement>){const g=gesture.current;if(!g||g.id!==e.pointerId)return;gesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(live.current.status!=='playing')return;const dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(game==='chair'){if(Math.abs(dx)>=R.gesturePx&&Math.abs(dx)>Math.abs(dy))action({kind:'lane',direction:dx<0?-1:1});else action({kind:'jump'});}
    else if(game==='tofu')action({kind:'drop'});
    else if(live.current.game==='holiday'){const hole=stage.current?.pick(e.clientX,e.clientY);if(hole!==null&&hole!==undefined)action({kind:'pick',hole,round:g.round??-1});}
  }
  const s=live.current,playing=s.status==='playing',done=s.status==='done',duration=game==='chair'?R.chairMs:game==='tofu'?R.tofuMs:R.holidayMs;
  const aligned=s.game==='tofu'&&!s.fall&&Math.abs(tofuPosition(s)[tofuAxis(s)]-s.layers[s.layers.length-1][tofuAxis(s)])<=R.tofuPerfect;
  const summary=partySummary(s);
  function holeControls(){if(s.game!=='holiday')return null;return <div className={`pt-hole-controls${light?' pt-light-grid':''}`} aria-label="六格假日蒸籠">{holidayCells(s).map(cell=><button key={cell.hole} className={cell.kind==='good'?'pt-good':cell.kind==='boss'?'pt-boss':''} aria-label={`第 ${cell.hole+1} 格：${cell.label}`} disabled={!ready||!!error||!cell.enabled}
    onPointerDown={e=>{if(e.button===0&&e.isPrimary)input.current.down(cell.hole,`pointer:${e.pointerId}`,s.round);}}
    onPointerUp={e=>input.current.up(cell.hole,`pointer:${e.pointerId}`)}
    onPointerCancel={e=>input.current.cancel(cell.hole,`pointer:${e.pointerId}`)}
    onLostPointerCapture={e=>input.current.lost(cell.hole,`pointer:${e.pointerId}`)}
    onBlur={()=>input.current.cancel(cell.hole)}
    onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat&&!e.altKey&&!e.ctrlKey&&!e.metaKey)input.current.down(cell.hole,`key:${e.key}`,s.round);}}}
    onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(e.altKey||e.ctrlKey||e.metaKey){input.current.cancel(cell.hole);return;}const round=input.current.click(cell.hole,s.round,`key:${e.key}`);if(round!==null)action({kind:'pick',hole:cell.hole,round});}}}
    onClick={e=>{const round=e.detail===0?input.current.assistive(cell.hole,s.round):input.current.pointerClick(cell.hole);if(round!==null)action({kind:'pick',hole:cell.hole,round});}}>
    <b>{cell.hole+1}</b>{light&&<svg viewBox="0 0 100 90" aria-hidden="true" focusable="false"><ellipse cx="50" cy="76" rx="43" ry="10" fill="#d4b88b" stroke="#443b37" strokeWidth="3"/>{(cell.kind==='good'||cell.kind==='boss')&&<><path d="M22 70 Q15 22 48 22 Q82 20 79 70Z" fill="#fff8e8" stroke="#443b37" strokeWidth="3"/><circle cx="38" cy="45" r="3" fill="#443b37"/><circle cx="62" cy="45" r="3" fill="#443b37"/><path d="M41 55 Q50 63 59 55" fill="none" stroke="#443b37" strokeWidth="3"/>{cell.kind==='good'?<path d="M48 24 Q43 3 69 8 Q68 26 48 24Z" fill="#7d9973" stroke="#443b37" strokeWidth="3"/>:<><path d="M27 26 V17 H73 V26Z" fill="#897c9b" stroke="#443b37" strokeWidth="3"/><path d="M46 61 H54 L59 73 L50 79 L41 73Z" fill="#897c9b" stroke="#443b37" strokeWidth="2"/></>}</>}<path d="M10 72 Q50 87 90 72 V81 Q50 96 10 81Z" fill="#dec49c" stroke="#443b37" strokeWidth="3"/></svg>}<span>{cell.label}</span></button>)}</div>;}
  return <section className={`pt-root pt-${game}`} onKeyDown={key} data-party-mode={light?'light':'3d'} data-party-state={s.status} data-party-score={s.score}>
    <header className="pt-heading"><div><p className="pt-kicker">日常派對 / {spec.tag}</p><h1>{spec.title}</h1><p>{spec.subtitle}</p></div><button className="fw-arcade-secondary" onClick={onBack}>回遊戲大廳</button></header>
    <div className="pt-layout"><div className="pt-play-area">
      <div className="pt-scoreboard" aria-label="本局狀態"><div><small>本局得分</small><strong>{s.score}<span>分</span></strong></div><div><small>{s.game==='tofu'?'豆腐樓層':'剩餘時間'}</small><strong>{s.game==='tofu'?`${s.layers.length-1} / ${R.tofuGoal}`:Math.ceil((duration-s.elapsed)/1000)}{s.game!=='tofu'&&<span>秒</span>}</strong></div><div><small>{s.game==='chair'?'下班意志':s.game==='tofu'?'還能失手':'最長連擊'}</small><strong>{s.game==='chair'?`${'♥'.repeat(s.lives)}${'♡'.repeat(R.chairLives-s.lives)}`:s.game==='tofu'?`${R.tofuMisses-s.misses} 次`:`${s.bestCombo} 次`}</strong></div></div>
      <div className="pt-scene-frame">{!light&&s.status==='ready'&&<GameCover id={game} eager className="sg-party-cover"/>}<div ref={host} className={`pt-canvas${light?' pt-light-stage':''}`} tabIndex={0} role="application" aria-label={`${spec.title} ${light?'輕量玩法':'3D 場景'}。${spec.keys}`} data-party-stage={error?'failed':ready?'ready':'loading'} onPointerDown={light?undefined:down} onPointerUp={light?undefined:up} onLostPointerCapture={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}} onPointerCancel={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}}>{light&&<><p className="pt-light-title">假日蒸籠 · 輕量玩法</p>{holeControls()}<p className="pt-light-hint">葉子是休假，領帶是開會。點格子或按 1–6。</p></>}</div>
        {playing&&!light&&<span className="pt-live-label">{s.game==='chair'?`假日票 ${s.tickets} 張`:s.game==='tofu'?s.fall?'豆腐穩穩落下…':aligned?'對齊了！現在落下':`完美貼齊 ${s.perfects} 次 · 等對齊再落下`:`已守住 ${s.game==='holiday'?s.saved:0} 個假日`}</span>}
      </div>
      {(error||!ready)&&<div className="pt-panel" role={error?'alert':'status'}><span className="pt-panel-symbol" aria-hidden="true">✳</span><h2>{error?'場景先休息一下。':'正在搭建你的迷你世界…'}</h2><p>{error||'角色和道具就快到齊了。'}</p>{game==='holiday'&&<button onClick={chooseLight}>改用輕量玩法</button>}{error&&<button onClick={retryStage}>重建 3D 場景</button>}{error&&game!=='holiday'&&<p>這款的輕量玩法尚未完成，請重試 3D 或返回大廳。</p>}<button className="fw-arcade-secondary" onClick={onBack}>先回遊戲大廳</button></div>}
      {ready&&!error&&!playing&&<div className="pt-panel" aria-label={done?'本局完成':s.status==='paused'?'遊戲暫停':'開玩說明'}><span className="pt-panel-symbol" aria-hidden="true">{done?'✦':s.status==='paused'?'Ⅱ':'↗'}</span><div><p className="pt-kicker">{done?'本局完成':s.status==='paused'?'休息一下再出發':`${spec.duration} · 一看就會玩`}</p><h2>{done?summary.caption:s.status==='paused'?'這局幫你留著。':game==='chair'?'會議可以等，下班不能。':game==='tofu'?'手要穩，豆腐要嫩。':'把假日，好好搶回來。'}</h2><p>{done?summary.details:s.status==='paused'?notice:spec.rule}</p></div><button onClick={done?result:begin}>{done?'查看這局成果':s.status==='paused'?'繼續這一局':'開始派對！'}<span aria-hidden="true"> ↗</span></button></div>}
      <p className="pt-feedback" role="status">{playing&&s.elapsed-s.feedbackAt<1100?s.feedback:playing?'放輕鬆，這局只管好玩。':notice||'每個小小失誤，都有它的喜感。'}</p>
      {!light&&<div className="pt-controls" aria-label="遊戲操作">
        {s.game==='chair'?<><button disabled={!playing||!!error} aria-label="往左換路" onClick={()=>action({kind:'lane',direction:-1})}>← <span>往左</span></button><button className="pt-primary-control" disabled={!playing||!!error} onClick={()=>action({kind:'jump'})}>跳一下！ <span aria-hidden="true">↑</span></button><button disabled={!playing||!!error} aria-label="往右換路" onClick={()=>action({kind:'lane',direction:1})}><span>往右</span> →</button></>:s.game==='tofu'?<button className="pt-drop pt-primary-control" disabled={!playing||!!error||!!s.fall} onClick={()=>action({kind:'drop'})}>{s.fall?'豆腐降落中…':'豆腐落下！'} <span aria-hidden="true">↓</span></button>:holeControls()}
      </div>}
      <div className="pt-tools"><button className="fw-arcade-secondary" disabled={!playing} onClick={()=>pauseRun()}>暫停 <span aria-hidden="true">Ⅱ</span></button><button ref={restartButton} className="fw-arcade-secondary" onClick={()=>{pauseRun();setRestart(true);}}>重新開始</button><button className="fw-arcade-secondary" aria-pressed={sound} onClick={()=>{soundRef.current=!sound;setSound(!sound);if(!sound)soundEffect(true);}}>音效{sound?'開':'關'}</button><button className="fw-arcade-secondary" aria-pressed={!motion} onClick={()=>{motionRef.current=!motion;setMotion(!motion);safeDraw();}}>減少動態{motion?'關':'開'}</button>{light&&<button className="fw-arcade-secondary" onClick={retryStage}>重試 3D，保留這局</button>}{light&&done&&s.game==='holiday'&&<a className="pt-download" download={`holiday-${s.seed}.svg`} href={holidayResultImage(s)}>下載本局成果 SVG</a>}</div>
      {restart&&<div className="pt-restart" role="group" aria-label="確認重新開始"><p>這局會從零開始，題目不變。</p><button ref={confirmRestart} onClick={reset}>確定重來</button><button className="fw-arcade-secondary" onClick={keepRun}>保留這局</button></div>}
    </div><aside className="pt-rule-card"><span className="pt-rule-number">0{PARTY_GAMES.findIndex(g=>g.id===game)+1}</span><p className="pt-kicker">這局怎麼玩</p><h2>{game==='chair'?'勇敢下班。':game==='tofu'?'嫩中求穩。':'拒絕加班。'}</h2><p>{spec.rule}</p><div className="pt-rule-hint"><span aria-hidden="true">⌨</span><p>{spec.keys}</p></div><p>{game==='chair'?'手機：左右滑換路，輕點跳躍。會議桌要躲開，矮推車可以跳過。':game==='tofu'?'一層比一層窄也沒關係。完美貼齊會連擊，三次失手就下課。':'戴葉子的笑臉是休假；戴帽子、領帶的是開會。文字按鈕也能玩。'}</p><div className="pt-seed">同題 #{seed}<small>朋友打開分享連結，挑戰相同題目。</small></div><small>短局遊戲：重新整理或離頁會重新開始。這裡的分數不計入平台貢獻。</small></aside></div>
  </section>;
}
