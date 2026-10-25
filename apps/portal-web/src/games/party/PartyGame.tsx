import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {PARTY_GAMES,PARTY_RULES as R,type PartyGameId} from './catalog';
import {actParty,advanceParty,holidayOpen,holidayTargets,newParty,partySummary,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition,type PartyAction,type PartyRun} from './domain';
import type {RunResult} from '../result-card';
import type {PartyStage} from './stage';
import './party.css';

/** PT-2/6: UI owns input and lifecycle; the pure domain owns every score. */
export function PartyGame({game,seed,onBack,onResult}:{game:PartyGameId;seed:number;onBack:()=>void;onResult:(r:RunResult)=>void}) {
  const spec=PARTY_GAMES.find(g=>g.id===game)!;
  const live=useRef<PartyRun>(newParty(game,seed)),stage=useRef<PartyStage|null>(null),host=useRef<HTMLDivElement>(null);
  const frame=useRef(0),last=useRef<number|null>(null),lastUi=useRef(0),loop=useRef<(t:number)=>void>(()=>{}),gesture=useRef<{id:number;x:number;y:number}|null>(null);
  const audio=useRef<AudioContext|null>(null),soundRef=useRef(false),motionRef=useRef(!matchMedia('(prefers-reduced-motion: reduce)').matches),settled=useRef(false);
  const [,repaint]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[restart,setRestart]=useState(false),[sound,setSound]=useState(false),[motion,setMotion]=useState(motionRef.current);
  function refresh(){repaint(n=>n+1);}
  function stop(){cancelAnimationFrame(frame.current);frame.current=0;last.current=null;gesture.current=null;}
  function draw(){if(!stage.current)return;const s=live.current;stage.current.update(s,motionRef.current);if(host.current){const stats=stage.current.stats();host.current.dataset.renderCalls=String(stats.calls);host.current.dataset.renderTriangles=String(stats.triangles);host.current.dataset.renderGeometries=String(stats.geometries);host.current.dataset.renderTextures=String(stats.textures);host.current.dataset.anchors=JSON.stringify(stage.current.anchors());host.current.dataset.elapsed=String(s.elapsed);host.current.dataset.round=String(s.game==='holiday'?s.round:0);host.current.dataset.lane=String(s.game==='chair'?s.lane:0);host.current.dataset.tofuOffset=s.game==='tofu'?String(tofuPosition(s)[tofuAxis(s)]-s.layers[s.layers.length-1][tofuAxis(s)]):'';}}
  function safeDraw(){try{draw();return true;}catch{live.current=pauseParty(live.current);stop();setReady(false);setError('場景暫時無法顯示。本局仍保留，重建後可繼續。');refresh();return false;}}
  function pauseRun(message='這局先停在這裡。'){const next=pauseParty(live.current);if(next===live.current)return;live.current=next;stop();setNotice(message);safeDraw();refresh();}
  function kick(){if(!frame.current&&live.current.status==='playing')frame.current=requestAnimationFrame(t=>loop.current(t));}
  function soundEffect(good:boolean){if(!soundRef.current)return;try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume().catch(()=>{});const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;osc.type='sine';osc.frequency.setValueAtTime(good?520:180,t);osc.frequency.exponentialRampToValueAtTime(good?820:95,t+.1);gain.gain.setValueAtTime(.055,t);gain.gain.exponentialRampToValueAtTime(.001,t+.13);osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.15);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{/* Optional audio never decides an action. */}}
  loop.current=t=>{
    frame.current=0;if(!stage.current||live.current.status!=='playing')return;
    const dt=last.current===null?0:t-last.current;last.current=t;
    if(dt>R.stallMs){pauseRun('畫面剛才停了一下，已替你暫停。準備好再繼續。');return;}
    const before=live.current;live.current=advanceParty(before,dt);
    if(live.current.score!==before.score)soundEffect(live.current.score>before.score);
    if(!safeDraw())return;
    if(t-lastUi.current>=R.uiMs||live.current.status==='done'){lastUi.current=t;refresh();}
    if(live.current.status==='playing')kick();else stop();
  };
  useEffect(()=>{
    let current=true;setReady(false);setError('');
    const timeout=setTimeout(()=>{if(current){current=false;setError('3D 場景載入較久。可以重試，或先玩其他遊戲。');}},R.loaderMs);
    void import('./stage').then(({createPartyStage})=>{
      if(!current||!host.current)return;
      const created=createPartyStage(host.current,game,()=>{if(current){live.current=pauseParty(live.current);stop();setReady(false);setError('3D 畫面已中斷，本局已暫停。重建場景後可以繼續。');refresh();}});
      if(!current){created.dispose();return;}stage.current=created;draw();clearTimeout(timeout);setReady(true);
    }).catch(()=>{if(current){clearTimeout(timeout);setError('無法開啟 3D 場景。請重試，或換個支援 WebGL 的瀏覽器。');}});
    return()=>{current=false;clearTimeout(timeout);stop();stage.current?.dispose();stage.current=null;};
  },[game,retry]);
  useEffect(()=>{const hidden=()=>{if(document.hidden)pauseRun('離開畫面時已暫停，回來後按繼續。');};const blur=()=>pauseRun('這局已暫停，準備好再繼續。');document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);stop();void audio.current?.close().catch(()=>{});};},[]);
  function begin(){if(!ready||error)return;live.current=live.current.status==='paused'?resumeParty(live.current):startParty(live.current);setNotice('');last.current=null;if(!safeDraw())return;refresh();kick();host.current?.focus({preventScroll:true});host.current?.closest('.pt-play-area')?.scrollIntoView({block:'start',behavior:'instant'});}
  function action(a:PartyAction){if(!ready||error)return;const before=live.current;live.current=actParty(before,a);if(before!==live.current){if(a.kind==='pick')soundEffect(live.current.score>before.score);safeDraw();refresh();}}
  function reset(){stop();live.current=newParty(game,seed);settled.current=false;setRestart(false);setNotice('');safeDraw();refresh();}
  function result(){if(live.current.status!=='done'||!stage.current||settled.current)return;settled.current=true;if(!safeDraw()){settled.current=false;return;}try{onResult({game,seed,title:spec.title,...partySummary(live.current),image:stage.current.capture()});}catch{settled.current=false;setNotice('這局已完成，圖片還沒產生。可以重試查看成果。');}}
  function key(e:KeyboardEvent<HTMLElement>){
    if(e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape'){e.preventDefault();pauseRun();return;}
    if(e.target instanceof HTMLButtonElement&&[' ','Enter'].includes(e.key))return;
    if(e.key==='Enter'&&live.current.status!=='playing'){e.preventDefault();if(live.current.status==='done')result();else begin();return;}
    const k=e.key.toLowerCase();let a:PartyAction|null=null;
    if(game==='chair')a=k==='arrowleft'||k==='a'?{kind:'lane',direction:-1}:k==='arrowright'||k==='d'?{kind:'lane',direction:1}:k===' '?{kind:'jump'}:null;
    if(game==='tofu'&&k===' ')a={kind:'drop'};
    if(game==='holiday'&&/^[1-6]$/.test(k)&&live.current.game==='holiday')a={kind:'pick',hole:Number(k)-1,round:live.current.round};
    if(a){e.preventDefault();action(a);}
  }
  function down(e:PointerEvent<HTMLDivElement>){if(live.current.status!=='playing'||e.button!==0||!e.isPrimary)return;e.preventDefault();gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus({preventScroll:true});}
  function up(e:PointerEvent<HTMLDivElement>){const g=gesture.current;if(!g||g.id!==e.pointerId)return;gesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(live.current.status!=='playing')return;const dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(game==='chair'){if(Math.abs(dx)>=R.gesturePx&&Math.abs(dx)>Math.abs(dy))action({kind:'lane',direction:dx<0?-1:1});else action({kind:'jump'});}
    else if(game==='tofu')action({kind:'drop'});
    else if(live.current.game==='holiday'){const hole=stage.current?.pick(e.clientX,e.clientY);if(hole!==null&&hole!==undefined)action({kind:'pick',hole,round:live.current.round});}
  }
  const s=live.current,playing=s.status==='playing',done=s.status==='done',duration=game==='chair'?R.chairMs:game==='tofu'?R.tofuMs:R.holidayMs;
  const roundTargets=s.game==='holiday'?holidayTargets(s.seed,s.round):null,open=s.game==='holiday'&&holidayOpen(s),summary=partySummary(s);
  return <section className={`pt-root pt-${game}`} onKeyDown={key} data-party-state={s.status} data-party-score={s.score}>
    <header className="pt-heading"><div><p className="pt-kicker">日常派對 / {spec.tag}</p><h1>{spec.title}</h1><p>{spec.subtitle}</p></div><button className="ad-secondary" onClick={onBack}>回遊戲大廳</button></header>
    <div className="pt-layout"><div className="pt-play-area">
      <div className="pt-scoreboard" aria-label="本局狀態"><div><small>本局得分</small><strong>{s.score}<span>分</span></strong></div><div><small>{s.game==='tofu'?'豆腐樓層':'剩餘時間'}</small><strong>{s.game==='tofu'?`${s.layers.length-1} / ${R.tofuGoal}`:Math.ceil((duration-s.elapsed)/1000)}{s.game!=='tofu'&&<span>秒</span>}</strong></div><div><small>{s.game==='chair'?'下班意志':s.game==='tofu'?'還能失手':'最長連擊'}</small><strong>{s.game==='chair'?`${'♥'.repeat(s.lives)}${'♡'.repeat(R.chairLives-s.lives)}`:s.game==='tofu'?`${R.tofuMisses-s.misses} 次`:`${s.bestCombo} 次`}</strong></div></div>
      <div className="pt-scene-frame"><div ref={host} className="pt-canvas" tabIndex={0} role="application" aria-label={`${spec.title} 3D 場景。${spec.keys}`} data-party-stage={error?'failed':ready?'ready':'loading'} onPointerDown={down} onPointerUp={up} onPointerCancel={e=>{if(gesture.current?.id===e.pointerId)gesture.current=null;}}/>
        {playing&&<span className="pt-live-label">{s.game==='chair'?`假日票 ${s.tickets} 張`:s.game==='tofu'?`完美貼齊 ${s.perfects} 次`:`已守住 ${s.game==='holiday'?s.saved:0} 個假日`}</span>}
      </div>
      {(error||!ready)&&<div className="pt-panel" role={error?'alert':'status'}><span className="pt-panel-symbol" aria-hidden="true">✳</span><h2>{error?'場景先休息一下。':'正在搭建你的迷你世界…'}</h2><p>{error||'角色和道具就快到齊了。'}</p>{error&&<button onClick={()=>setRetry(n=>n+1)}>重建 3D 場景</button>}<button className="ad-secondary" onClick={onBack}>先回遊戲大廳</button></div>}
      {ready&&!error&&!playing&&<div className="pt-panel" aria-label={done?'本局完成':s.status==='paused'?'遊戲暫停':'開玩說明'}><span className="pt-panel-symbol" aria-hidden="true">{done?'✦':s.status==='paused'?'Ⅱ':'↗'}</span><div><p className="pt-kicker">{done?'本局完成':s.status==='paused'?'休息一下再出發':`${spec.duration} · 一看就會玩`}</p><h2>{done?summary.caption:s.status==='paused'?'這局幫你留著。':game==='chair'?'會議可以等，下班不能。':game==='tofu'?'手要穩，豆腐要嫩。':'把假日，好好搶回來。'}</h2><p>{done?summary.details:s.status==='paused'?notice:spec.rule}</p></div><button onClick={done?result:begin}>{done?'查看這局成果':s.status==='paused'?'繼續這一局':'開始派對！'}<span aria-hidden="true"> ↗</span></button></div>}
      <p className="pt-feedback" role="status">{playing&&s.elapsed-s.feedbackAt<1100?s.feedback:playing?'放輕鬆，這局只管好玩。':notice||'每個小小失誤，都有它的喜感。'}</p>
      <div className="pt-controls" aria-label="遊戲操作">
        {s.game==='chair'?<><button disabled={!playing||!!error} aria-label="往左換路" onClick={()=>action({kind:'lane',direction:-1})}>← <span>往左</span></button><button className="pt-primary-control" disabled={!playing||!!error} onClick={()=>action({kind:'jump'})}>跳一下！ <span aria-hidden="true">↑</span></button><button disabled={!playing||!!error} aria-label="往右換路" onClick={()=>action({kind:'lane',direction:1})}><span>往右</span> →</button></>:s.game==='tofu'?<button className="pt-drop pt-primary-control" disabled={!playing||!!error||!!s.fall} onClick={()=>action({kind:'drop'})}>{s.fall?'豆腐降落中…':'豆腐落下！'} <span aria-hidden="true">↓</span></button>:<div className="pt-hole-controls">{Array.from({length:6},(_,i)=>{const kind=open&&!(s.pressed&(1<<i))?(i===roundTargets?.good?'休假':i===roundTargets?.boss?'開會':'空蒸籠'):'等待';return <button key={i} className={kind==='休假'?'pt-good':kind==='開會'?'pt-boss':''} aria-label={`第 ${i+1} 格：${kind}`} disabled={!playing||!!error||!open||!!(s.pressed&(1<<i))} onClick={()=>action({kind:'pick',hole:i,round:s.round})}><b>{i+1}</b><span>{kind}</span></button>;})}</div>}
      </div>
      <div className="pt-tools"><button className="ad-secondary" disabled={!playing} onClick={()=>pauseRun()}>暫停 <span aria-hidden="true">Ⅱ</span></button><button className="ad-secondary" onClick={()=>{pauseRun();setRestart(true);}}>重新開始</button><button className="ad-secondary" aria-pressed={sound} onClick={()=>{soundRef.current=!sound;setSound(!sound);if(!sound)soundEffect(true);}}>音效{sound?'開':'關'}</button><button className="ad-secondary" aria-pressed={!motion} onClick={()=>{motionRef.current=!motion;setMotion(!motion);safeDraw();}}>減少動態{motion?'關':'開'}</button></div>
      {restart&&<div className="pt-restart" role="group" aria-label="確認重新開始"><p>這局會從零開始，題目不變。</p><button onClick={reset}>確定重來</button><button className="ad-secondary" onClick={()=>setRestart(false)}>保留這局</button></div>}
    </div><aside className="pt-rule-card"><span className="pt-rule-number">0{PARTY_GAMES.findIndex(g=>g.id===game)+1}</span><p className="pt-kicker">這局怎麼玩</p><h2>{game==='chair'?'勇敢下班。':game==='tofu'?'嫩中求穩。':'拒絕加班。'}</h2><p>{spec.rule}</p><div className="pt-rule-hint"><span aria-hidden="true">⌨</span><p>{spec.keys}</p></div><p>{game==='chair'?'手機：左右滑換路，輕點跳躍。會議桌要躲開，矮推車可以跳過。':game==='tofu'?'一層比一層窄也沒關係。完美貼齊會連擊，三次失手就下課。':'戴葉子的笑臉是休假；戴帽子、領帶的是開會。文字按鈕也能玩。'}</p><div className="pt-seed">同題 #{seed}<small>朋友打開分享連結，挑戰相同題目。</small></div><small>短局遊戲：重新整理或離頁會重新開始。這裡的分數不計入平台貢獻。</small></aside></div>
  </section>;
}
