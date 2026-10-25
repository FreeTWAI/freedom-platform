import type { PointerEventHandler } from 'react';
import type { Shape } from './catalog';
import { cookingProgress, currentStep, cutGuide, plateTarget, type CookingRun } from './domain';

const colors:Record<Shape,string>={greens:'#88a96d',carrot:'#e9a14d',meat:'#c97b67',rice:'#f5deb1',dough:'#efca8d',noodle:'#e3b469',egg:'#f1c15d',fruit:'#d87564',cream:'#f7e9ce',chocolate:'#9a6850',fish:'#e4a28b'};
function Ingredient({shape,x,y,size=70,angle=0}:{shape:Shape;x:number;y:number;size?:number;angle?:number}) {
  return <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${size/70})`} stroke="#73513b" strokeWidth="2.5" strokeLinejoin="round" fill={colors[shape]}>
    {shape==='greens'?<><path d="M0 29C-48 10-40-24-13-26C-12-47 21-42 25-20C55-7 29 22 0 29Z"/><path d="M0 27L9-21M1 9L-17-4M5-4L22-10" fill="none" stroke="#58774c"/></>:
    shape==='carrot'?<><path d="M-31-20Q-2-41 29-17L0 32Z"/><path d="M-7-26L-18-43M4-28L8-46" stroke="#698759" strokeWidth="6"/><path d="M-13-9L3-11M-6 5L5 3" fill="none"/></>:
    shape==='egg'?<><path d="M-33 9C-44-15-21-30-6-23C15-43 42-13 31 13C10 36-21 35-33 9Z" fill="#fff3d9"/><circle r="16" fill="#efb942"/></>:
    shape==='noodle'?<><path d="M-29-12Q-9-37 22-17Q42 4 5 6Q-29 9-16 24Q4 38 27 17" fill="none" stroke="#b47b36" strokeWidth="13"/><path d="M-29-12Q-9-37 22-17Q42 4 5 6Q-29 9-16 24Q4 38 27 17" fill="none" stroke="#edc67f" strokeWidth="8"/></>:
    shape==='fruit'?<><path d="M-26-18Q-1-32 24-18L3 32Q-4 40-10 26Z"/><path d="M-18-24L-7-36L0-25L12-35L19-24" fill="#79955c"/></>:
    shape==='rice'?<path d="M-33 22Q-33-26 0-30Q35-26 34 22Z"/>:
    shape==='cream'?<path d="M-32 22Q-36 5-14-3Q-31-20-3-22Q-6-35 9-39Q8-24 23-13Q36-5 20 3Q43 12 32 22Z"/>:
    shape==='chocolate'?<><rect x="-28" y="-25" width="56" height="50" rx="7"/><path d="M0-25V25M-28 0H28" fill="none"/></>:
    shape==='fish'?<><path d="M-34-14Q0-38 31-12L23 23Q-12 34-34 11Z"/><path d="M-17-17L-12 21M0-22L6 22M17-18L21 16" stroke="#f9dcc0" strokeWidth="5"/></>:
    shape==='meat'?<><path d="M-31-14Q-9-39 22-26Q46-9 20 21Q-6 40-30 16Z"/><path d="M-12-20Q15-24 19-9" fill="none" stroke="#f0c1a6" strokeWidth="6"/></>:
    <path d="M-34 10Q-39-21-7-29Q19-36 34-6Q42 28 6 31Q-24 31-34 10Z"/>}
  </g>;
}
/** CK-2/5: native vector utensils and live ingredients use the same matte outline palette as the raster art. */
export function CookingScene({run,point,onPointerDown,onPointerMove,onPointerUp,onPointerCancel}:{run:CookingRun;point:{x:number;y:number}|null;onPointerDown:PointerEventHandler<SVGSVGElement>;onPointerMove:PointerEventHandler<SVGSVGElement>;onPointerUp:PointerEventHandler<SVGSVGElement>;onPointerCancel:PointerEventHandler<SVGSVGElement>}) {
  const s=currentStep(run),a=run.active,p=cookingProgress(run),hold=a.holdAt===null?0:Math.min(1.7,(run.elapsed-a.holdAt)/s.holdMs),target=plateTarget(run);
  const glyphs=Array.from({length:Math.min(s.goal,8)},(_,i)=>i);
  return <svg className={`ck-scene ck-scene-${s.kind}`} viewBox="0 0 800 560" role="img" aria-label={`${s.title}操作區`} data-cooking-scene={s.kind} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel}>
    <rect width="800" height="560" fill="#efe2ca"/>
    <path d="M0 510H800M0 38H800" stroke="#d9c5a8" strokeWidth="2"/>
    {s.kind==='slice'?<>
      <rect x="119" y="111" width="560" height="328" rx="41" fill="#d9ae76" stroke="#88603f" strokeWidth="3"/><rect x="140" y="131" width="518" height="287" rx="30" fill="#e9c693" stroke="#bb8c56" strokeWidth="2"/>
      {glyphs.map(i=><Ingredient key={i} shape={s.shape} x={235+i*330/(s.goal-1)} y={i<a.count?346:276} size={i<a.count?42:65} angle={i<a.count?i*24-40:0}/>)}
      {run.status==='playing'&&<path d={`M${cutGuide(run)*800} 175V364`} stroke="#9c4d36" strokeWidth="4" strokeDasharray="12 9"/>}
      <g transform={`translate(${point?point.x*800:cutGuide(run)*800+55} ${point?point.y*560:130}) rotate(-15)`}><path d="M-18-12H15V70Q-3 94-18 73Z" fill="#e6e5d5" stroke="#73513b" strokeWidth="3"/><rect x="-14" y="-77" width="25" height="66" rx="8" fill="#9e6a4d" stroke="#73513b" strokeWidth="3"/></g>
    </>:s.kind==='mix'?<>
      <ellipse cx="400" cy="323" rx="220" ry="153" fill="#b77962" stroke="#73513b" strokeWidth="3"/><ellipse cx="400" cy="290" rx="220" ry="139" fill="#fbefdb" stroke="#73513b" strokeWidth="3"/><ellipse cx="400" cy="290" rx="190" ry="113" fill={colors[s.shape]} stroke="#c9a077" strokeWidth="2"/>
      <path d="M302 264Q414 195 505 274Q543 332 412 355" stroke="#ae8057" strokeWidth="4" fill="none" strokeDasharray="12 10"/>
      <g transform={`translate(${point?point.x*800:400+Math.cos(a.amount)*100} ${point?point.y*560:290+Math.sin(a.amount)*65}) rotate(-25)`}><rect x="-10" y="-149" width="20" height="155" rx="10" fill="#d9b17a" stroke="#73513b" strokeWidth="3"/><ellipse rx="24" ry="35" fill="#bc8853" stroke="#73513b" strokeWidth="3"/></g>
      <path d="M550 200L571 228L535 236" fill="none" stroke="#a54c37" strokeWidth="5"/>
    </>:s.kind==='knead'?<>
      <rect x="122" y="113" width="556" height="330" rx="32" fill="#d9ae76" stroke="#88603f" strokeWidth="3"/><ellipse cx="400" cy="304" rx={135+Math.min(hold,1)*35} ry={95-Math.min(hold,1)*28} fill="#efcf96" stroke="#88603f" strokeWidth="3"/><path d="M322 274Q391 239 470 274" fill="none" stroke="#bd9863" strokeWidth="3"/>
      <g transform={`translate(400 ${185+Math.min(hold,1)*43})`}><path d="M-48 20V-34Q-48-52-34-47L-24-14V-62Q-23-80-9-69L-4-20V-79Q2-95 14-77L17-18L25-58Q39-69 43-51L43 5L62-7Q83-3 67 15L41 46H-25Z" fill="#e5ac84" stroke="#73513b" strokeWidth="3"/></g>
      <path d="M270 412H530" stroke="#c5aa81" strokeWidth="14" strokeLinecap="round"/><path d="M385 412H439" stroke="#7c9d70" strokeWidth="14"/><circle cx={270+Math.min(hold,1.7)/1.7*260} cy="412" r="11" fill="#a54c37" stroke="#ffefd5" strokeWidth="3"/>
    </>:s.kind==='pan'||s.kind==='boil'?<>
      <rect x="174" y="379" width="452" height="90" rx="20" fill="#a8b4a0" stroke="#73513b" strokeWidth="3"/><circle cx="560" cy="424" r="18" fill="#ead7af" stroke="#73513b" strokeWidth="3"/>
      <path d="M303 388Q282 351 312 326Q318 350 333 355Q345 322 365 310Q350 359 383 386M412 388Q398 354 428 324Q424 351 452 360Q465 325 482 322Q466 358 498 388" fill={a.heat>75?'#ce704c':'#e8b15b'} stroke="#b87f43" strokeWidth="2"/>
      {s.kind==='pan'?<><path d="M562 296L736 237" stroke="#73513b" strokeWidth="31" strokeLinecap="round"/><ellipse cx="400" cy="305" rx="211" ry="98" fill="#886b57" stroke="#73513b" strokeWidth="3"/><ellipse cx="400" cy="286" rx="211" ry="90" fill="#bda484" stroke="#73513b" strokeWidth="3"/>
      {[0,1,2].map(i=><Ingredient key={i} shape={s.shape} x={310+i*86} y={285+(i%2)*18-(a.flipped?12:0)} size={67} angle={a.flipped?180:0}/>)}</>:<><path d="M195 256V337Q400 450 605 337V256" fill="#c38168" stroke="#73513b" strokeWidth="3"/><ellipse cx="400" cy="254" rx="205" ry="94" fill="#f0c68c" stroke="#73513b" strokeWidth="3"/>
      {[0,1,2,3].map(i=><circle key={i} cx={293+i*72} cy={244+(i%2)*32} r={6+a.foam*18} fill="#f8e4b7" stroke="#c49662" strokeWidth="2"/>)}<Ingredient shape={s.shape} x={410} y={256} size={68}/></>}
      {a.amount>.12&&<path d="M340 151Q319 129 340 102M413 143Q436 121 413 95M476 154Q457 132 476 110" stroke="#b9aa91" strokeWidth="4" strokeLinecap="round" fill="none"/>}
    </>:s.kind==='bake'?<>
      <rect x="154" y="101" width="492" height="370" rx="31" fill="#ba7760" stroke="#73513b" strokeWidth="3"/><rect x="189" y="194" width="422" height="227" rx="21" fill="#75523e" stroke="#73513b" strokeWidth="3"/><rect x="214" y="218" width="372" height="178" rx="13" fill={a.amount>1?'#b0794c':'#edc588'}/>
      <path d="M236 365H563M236 373H563" stroke="#88603f" strokeWidth="4"/><Ingredient shape={s.shape} x={400} y={314} size={100}/><rect x="280" y="170" width="241" height="17" rx="8" fill="#e8c29b" stroke="#73513b" strokeWidth="3"/><circle cx="229" cy="145" r="20" fill="#f4dab1" stroke="#73513b" strokeWidth="3"/><path d={`M229 145l${Math.sin(a.heat/100*5)*13} ${-Math.cos(a.heat/100*5)*13}`} stroke="#73513b" strokeWidth="3"/><rect x="477" y="126" width="112" height="34" rx="6" fill="#f6e5c8"/><text x="533" y="150" textAnchor="middle" fill="#73513b" fontSize="20" fontFamily="monospace">{Math.round(100+a.heat*1.5)}°</text>
    </>:s.kind==='pour'?<>
      <path d="M320 222L343 449Q400 480 457 449L480 222Z" fill="#f9e9cd" stroke="#73513b" strokeWidth="3"/><path d={`M335 ${445-a.amount*201}H465L453 445Q400 469 347 445Z`} fill={colors[s.shape]} stroke="#be9a70" strokeWidth="2"/><path d={`M321 ${445-s.target*201}H479`} stroke="#7e9e70" strokeWidth="5" strokeDasharray="12 8"/>
      <g transform={`translate(300 111) rotate(${a.holdAt===null?-10:-37})`}><path d="M-75-41H43L66-21H39V71Q-14 91-62 66Z" fill="#dba37b" stroke="#73513b" strokeWidth="3"/><path d="M-74-19Q-119-21-108 27Q-104 48-66 40" fill="none" stroke="#73513b" strokeWidth="12"/></g>
      {a.holdAt!==null&&<path d="M365 131Q386 150 399 242" fill="none" stroke={colors[s.shape]} strokeWidth="17" strokeLinecap="round"/>}
    </>:s.kind==='fold'?<>
      <rect x="130" y="104" width="540" height="348" rx="31" fill="#cdb58c" stroke="#88603f" strokeWidth="3"/><path d="M400 143L588 280L400 417L212 280Z" fill="#f4ddb0" stroke="#99764f" strokeWidth="3"/><Ingredient shape={s.shape} x={400} y={280} size={90}/>
      {a.count>0&&<path d="M212 280L400 198L400 362Z" fill="#e9c691" stroke="#99764f" strokeWidth="3"/>}{a.count>1&&<path d="M588 280L400 198L400 362Z" fill="#f0d19e" stroke="#99764f" strokeWidth="3"/>}{a.count>2&&<path d="M400 417L303 280H497Z" fill="#e5bd81" stroke="#99764f" strokeWidth="3"/>}
      <text x="400" y="492" textAnchor="middle" fontSize="42" fill="#a34b35">{({left:'←',right:'→',up:'↑',down:'↓'} as const)[s.directions[a.count]??'up']}</text>
    </>:<>
      <ellipse cx="414" cy="327" rx="231" ry="154" fill="#e5ca9f"/><ellipse cx="400" cy="297" rx="231" ry="154" fill="#fbefdc" stroke="#99764f" strokeWidth="3"/><ellipse cx="400" cy="297" rx="194" ry="122" fill="none" stroke="#d9b98d" strokeWidth="3"/>
      {glyphs.filter(i=>i<a.count).map(i=>{const q=plateTarget({...run,active:{...a,count:i}});return <Ingredient key={i} shape={s.shape} x={q.x*800} y={q.y*560} size={68}/>;})}
      {a.count<s.goal&&<><circle cx={target.x*800} cy={target.y*560} r="44" fill="#c1d0ad70" stroke="#708960" strokeDasharray="8 7" strokeWidth="3"/><Ingredient shape={s.shape} x={point?point.x*800:102} y={point?point.y*560:300} size={73}/></>}
    </>}
    <text x="400" y="42" textAnchor="middle" fontSize="18" fill="#796354" fontFamily="system-ui">{s.ingredient}</text>
    <rect x="272" y="526" width="256" height="6" rx="3" fill="#d9c3a4"/><rect x="272" y="526" width={256*p} height="6" rx="3" fill="#9a6048"/>
  </svg>;
}
