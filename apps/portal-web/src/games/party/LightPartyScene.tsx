import {partyViewport} from './viewport';
import {PARTY_RULES as R} from './catalog';
import type {ChairRun,TofuRun} from './domain';
import {chairView,tofuView,tofuFaces,TOFU_FACE_COLORS} from './light-party';

/** Essential motion follows elapsed even with reduced motion; no CSS animation. */
export function LightPartyScene({run,viewport=partyViewport(640,480)}:{run:ChairRun|TofuRun;viewport?:ReturnType<typeof partyViewport>}){
  const viewBox=`${viewport.viewBox.x} ${viewport.viewBox.y} ${viewport.viewBox.width} ${viewport.viewBox.height}`;
  if(run.game==='chair'){
    const view=chairView(run),next=view.waves[0];
    return <><svg className="pt-light-world" viewBox={viewBox} aria-hidden="true" focusable="false" data-light-world="chair" data-view-elapsed={run.elapsed} data-actual-x={run.x} data-jump={view.jump}>
      <rect x="-5000" y="-5000" width="10000" height="10000" fill="#142039"/>
      <path d="M-2400 130H3040L5000 5000H-5000Z" fill="#1c2c45"/>
      {Array.from({length:29},(_,i)=><g key={i} transform={`translate(${-1600+i*132} 0)`}><path d="M0 -3000V130" stroke="#405571" strokeWidth="5"/><rect x="18" y={-160-(i%4)*70} width="90" height={290+(i%4)*70} fill={i%2?'#263e5a':'#304b66'}/><path d="M34 -60V-40M64 -60V-40M34 -25V-5M64 -25V-5" stroke="#e8c37a" strokeWidth="5"/></g>)}
      <path d="M-2500 -120H3100M-2500 130H3100M-2500 420H3100M-2500 800H3100M-2500 1300H3100" stroke="#52647e" strokeWidth="4"/>
      <path d="M140 130L-1500 5000M500 130L2140 5000" stroke="#65d4cf" strokeWidth="5" opacity=".6"/>
      <circle cx="535" cy="69" r="23" fill="#edc883"/>
      {[0,1,2,3,4,5,6,7].map(i=><g key={i}><rect x={44+i*71} y={90-(i*13)%42} width="48" height="70" fill="#334a67"/><path d={`M${54+i*71} 83v18m13-18v18m13-18v18`} stroke="#d4b36e" strokeWidth="4"/></g>)}
      <path d="M140 130 L84 445 H556 L500 130Z" fill="#293c58" stroke="#65d4cf" strokeWidth="3"/>
      <path d="M55 442 L105 120 H535 L585 442 M72 442 L125 138 H515 L568 442" fill="none" stroke="#456b80" strokeWidth="5"/>
      {[243,397].map(x=><path key={x} d={`M${x} 45 V435`} stroke="#8795a9" strokeWidth="3" strokeDasharray="10 14"/>)}
      <path d="M93 374 H547" stroke="#7d9973" strokeWidth="4" strokeDasharray="8 7"/>
      {view.waves.map(w=><g key={w.index} data-wave={w.index} data-remaining={w.remaining}>
        <g transform={`translate(${320+w.lane*154} ${w.y})`} stroke="#443b37" strokeWidth="3" strokeLinejoin="round">
          {w.kind==='meeting'?<><path d="M-44 -24 L42 -27 L49 4 L-47 6Z" fill="#c99872"/><path d="M-34 6 V25 M35 4 V25"/><path d="M-16 -20 L8 -21 L16 -6 L-11 -5Z" fill="#fff8e8"/></>:<><path d="M-38 -5 H38 V12 H-38Z" fill="#9eac8d"/><path d="M-43 -24 H-36 V12" fill="none"/><circle cx="-25" cy="20" r="7" fill="#443b37"/><circle cx="25" cy="20" r="7" fill="#443b37"/><path d="M-8 -22 H11 L8 -5 H-5Z" fill="#fff8e8"/></>}
        </g><g transform={`translate(${320+w.ticketLane*154} ${w.y})`} stroke="#443b37" strokeWidth="3"><path d="M-25 -25 L26 -22 L23 24 L-27 20Z" fill="#e5bd68"/><path d="M-10 9 Q-16 -16 15 -14 Q18 8 -10 9Z" fill="#7d9973"/></g>
      </g>)}
      <ellipse cx={view.x} cy="402" rx="40" ry="10" fill="#c4b99e"/>
      <g transform={`translate(${view.x} ${view.y})`} stroke="#443b37" strokeWidth="3" strokeLinejoin="round">
        <path d="M0 12 V33 M0 29 L-29 39 M0 29 L29 39 M0 29 V43 M0 29 L-22 22 M0 29 L22 22" fill="none"/>
        {[-29,0,29].map(x=><circle key={x} cx={x} cy={x===0?43:39} r="5" fill="#443b37"/>)}
        <path d="M-32 -40 Q-34 -51 -22 -52 H23 Q34 -51 31 -40 L28 11 H-28Z" fill="#7d9973"/>
        <path d="M-39 -6 V12 H39 V-6 M-30 10 Q0 22 30 10" fill="none"/>
        <path d="M-20 -20 Q-29 -47 -14 -54 L-18 -78 Q-14 -92 -6 -77 L-1 -57 L7 -57 L14 -80 Q25 -90 23 -72 L21 -49 Q33 -28 20 -16Z" fill="#fff8e8"/>
        <circle cx="-6" cy="-38" r="2" fill="#443b37"/><circle cx="12" cy="-38" r="2" fill="#443b37"/><path d="M-3 -28 Q5 -21 13 -29" fill="none"/>
      </g>
    </svg><p className="pt-light-readout">{run.status==='done'?`本局完成 · ${run.tickets} 張票`:next?`第 ${next.index+1} 波 · ${next.kind==='meeting'?'會議桌要換路':'推車可以跳'} · ${Math.ceil(next.remaining/100)/10} 秒後到達`:'前方暫時沒有障礙'}<br/>左右滑換路，點場景或按空白鍵跳躍。黃票上的葉子是假日票。</p></>;
  }
  const view=tofuView(run);
  const block=(layer:Parameters<typeof tofuFaces>[0],bottom:number,key:string,active=false)=><g key={key} data-tofu-layer={key} data-x={layer.x} data-z={layer.z} data-width={layer.width} data-depth={layer.depth}>{tofuFaces(layer,bottom).map((points,i)=><polygon key={i} points={points} fill={active&&i===2?'#e5bd68':TOFU_FACE_COLORS[i]} stroke="#443b37" strokeWidth="2.5" strokeLinejoin="round"/>)}</g>;
  return <><svg className="pt-light-world" viewBox={viewBox} aria-hidden="true" focusable="false" data-light-world="tofu" data-view-elapsed={run.elapsed} data-turn={run.turn} data-axis={view.axis} data-offset={view.offset} data-fall-progress={view.progress}>
    <rect x="-5000" y="-5000" width="10000" height="10000" fill="#e7ede3"/>
    <path d="M-3000 250Q-1400 -900 -700 -200T500 -220T2100 -450T4000 100V4000H-3000Z" fill="#c8d5c8"/>
    <path d="M-3000 300Q-1200 -260 -300 120T1300 -70T4000 200V4000H-3000Z" fill="#9bb4a2"/>
    <path d="M-3000 310H4000V5000H-3000Z" fill="#b9a486"/>
    {Array.from({length:21},(_,i)=><path key={i} d={`M-3000 ${310+i*80}H4000`} stroke="#927a5d" strokeWidth="2"/>)}
    {Array.from({length:19},(_,i)=><path key={i} d={`M${-1600+i*210} -3000V310`} stroke="#81674c" strokeWidth="9"/>)}
    <path d="M-3000 -380H4000M-3000 0H4000M-3000 310H4000" stroke="#81674c" strokeWidth="10"/>
    <circle cx="488" cy="85" r="30" fill="#d8b675"/>
    <path d="M24 208 Q100 60 204 180 T400 145 T616 175 V310 H24Z" fill="#a8bbae"/>
    <path d="M24 256 Q120 145 220 225 T440 202 T616 236 V310 H24Z" fill="#809e91"/>
    <path d="M22 300H618M22 155H618M115 20V300M320 20V300M525 20V300" fill="none" stroke="#81674c" strokeWidth="7"/>
    <path d="M20 310H620V434Q620 460 594 460H46Q20 460 20 434Z" fill="#b9a486"/>
    {[330,355,380,405,430].map(y=><path key={y} d={`M24 ${y}H616`} stroke="#9f8869"/>)}
    <ellipse cx="320" cy="426" rx="146" ry="41" fill="#7aaba1" stroke="#405b60" strokeWidth="3"/><ellipse cx="320" cy="422" rx="128" ry="31" fill="none" stroke="#bda78b" strokeWidth="3"/>
    {view.layers.map((layer,i)=>block(layer,i*R.tofuHeight,String(i)))}
    {view.kept&&<polygon points={tofuFaces(view.kept,run.layers.length*R.tofuHeight)[2]} fill="none" stroke="#416851" strokeWidth="4" strokeDasharray="8 5"/>}
    {view.active&&block(view.active,view.bottom,'moving',true)}
  </svg><p className="pt-light-readout">{run.status==='done'?`完成 ${run.layers.length-1} 層 · ${run.misses} 次失手`:view.falling?view.kept?'正在落下，綠色虛線是會保留的部分。':'這塊沒有足夠重疊，正在落下。':`${view.axis.toUpperCase()} 軸移動 · ${view.aligned?'對齊了！現在落下':'等上層靠齊，再點或按空白鍵落下'}`}<br/>黃色是移動豆腐，奶油色是已落定的真實樓層。減少動態仍保留移動與落下。</p></>;
}
