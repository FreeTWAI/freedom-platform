import {clamp,seedOf} from '../domain';
import {PARTY_RULES as R,type PartyGameId} from './catalog';

export type PartyStatus='ready'|'playing'|'paused'|'done';
type Base={seed:number;status:PartyStatus;elapsed:number;score:number;combo:number;bestCombo:number;feedback:string;feedbackAt:number};
export type ChairRun=Base&{game:'chair';lane:number;x:number;lastLaneAt:number;jumpAt:number;lives:number;resolved:number;tickets:number;hits:number;hitAt:number};
export type TofuLayer={x:number;z:number;width:number;depth:number};
export type TofuFall={at:number;axis:'x'|'z';from:TofuLayer;kept:TofuLayer|null;perfect:boolean};
export type TofuRun=Base&{game:'tofu';layers:readonly TofuLayer[];misses:number;turn:number;activeAt:number;fall:TofuFall|null;perfects:number};
export type HolidayRun=Base&{game:'holiday';pressed:number;round:number;saved:number;mistakes:number;pick:{hole:number;kind:'good'|'boss'|'empty';at:number}|null};
export type PartyRun=ChairRun|TofuRun|HolidayRun;
export type PartyAction={kind:'lane';direction:-1|1}|{kind:'jump'}|{kind:'drop'}|{kind:'pick';hole:number;round:number};

/** PT-2: integer seeded mixing is independent from clocks/rendering. */
export function partyRandom(seed:number,index:number) {
  let v=(seed+Math.imul(index+1,0x9e3779b9))|0;
  v=Math.imul(v^(v>>>16),0x21f0aaad);v=Math.imul(v^(v>>>15),0x735a2d97);
  return ((v^(v>>>15))>>>0)/4294967296;
}
export function newParty(game:PartyGameId,seed:number):PartyRun {
  const base:Base={seed:seedOf(seed),status:'ready',elapsed:0,score:0,combo:0,bestCombo:0,feedback:'',feedbackAt:-2000};
  if(game==='chair')return {...base,game,lane:0,x:0,lastLaneAt:-1000,jumpAt:-2000,lives:R.chairLives,resolved:0,tickets:0,hits:0,hitAt:-2000};
  if(game==='tofu')return {...base,game,layers:[{x:0,z:0,width:R.tofuSize,depth:R.tofuSize}],misses:0,turn:0,activeAt:0,fall:null,perfects:0};
  return {...base,game,pressed:0,round:0,saved:0,mistakes:0,pick:null};
}
export function startParty(s:PartyRun):PartyRun {return s.status==='ready'?{...s,status:'playing'}:s;}
export function pauseParty(s:PartyRun):PartyRun {return s.status==='playing'?{...s,status:'paused'}:s;}
export function resumeParty(s:PartyRun):PartyRun {return s.status==='paused'?{...s,status:'playing'}:s;}
export function chairWave(seed:number,index:number) {
  const lane=Math.floor(partyRandom(seed,index*3)*3)-1;
  const ticketLane=(lane+1+Math.floor(partyRandom(seed,index*3+1)*2)+1)%3-1;
  return {index,at:R.waveFirstMs+index*R.waveGapMs,lane,ticketLane,kind:partyRandom(seed,index*3+2)>.48?'meeting' as const:'cart' as const};
}
const move=(x:number,target:number,amount:number)=>x+Math.sign(target-x)*Math.min(Math.abs(target-x),amount);
export function chairJump(s:ChairRun,at=s.elapsed) {const age=at-s.jumpAt;return age>=0&&age<R.jumpMs?Math.sin(age/R.jumpMs*Math.PI)*R.jumpHeight:0;}
export function tofuAxis(s:TofuRun):'x'|'z' {return s.layers.length%2?'x':'z';}
export function tofuPosition(s:TofuRun,at=s.elapsed):TofuLayer {
  const top=s.layers[s.layers.length-1],axis=tofuAxis(s);
  const offset=Math.sin((at-s.activeAt)/1000*(R.tofuSpeed+(s.layers.length-1)*R.tofuSpeedStep)+partyRandom(s.seed,s.turn)*Math.PI*2)*R.tofuAmplitude;
  return {...top,[axis]:top[axis]+offset};
}
export function holidayTargets(seed:number,round:number) {
  const good=Math.floor(partyRandom(seed,round*2)*6);
  const boss=(good+1+Math.floor(partyRandom(seed,round*2+1)*5))%6;
  return {good,boss};
}
export function holidayOpen(s:HolidayRun) {const phase=s.elapsed%R.holidayRoundMs;return s.status==='playing'&&phase>=R.holidayOpenMs&&phase<R.holidayCloseMs;}
function praise<T extends PartyRun>(s:T,feedback:string):T {return {...s,feedback,feedbackAt:s.elapsed,bestCombo:Math.max(s.bestCombo,s.combo)};}

/** PT-3..5: validate state/window/identity before any mutation. */
export function actParty(s:PartyRun,a:PartyAction):PartyRun {
  if(s.status!=='playing')return s;
  if(a.kind==='lane'&&s.game==='chair') {
    if((a.direction!==-1&&a.direction!==1)||s.elapsed-s.lastLaneAt<R.laneCooldownMs)return s;
    const lane=clamp(s.lane+a.direction,-1,1);
    return lane===s.lane?s:{...s,lane,lastLaneAt:s.elapsed};
  }
  if(a.kind==='jump'&&s.game==='chair')return s.elapsed-s.jumpAt<R.jumpMs?s:{...s,jumpAt:s.elapsed};
  if(a.kind==='drop'&&s.game==='tofu') {
    if(s.fall)return s;
    const from=tofuPosition(s),top=s.layers[s.layers.length-1],axis=tofuAxis(s),size=axis==='x'?'width':'depth';
    const perfect=Math.abs(from[axis]-top[axis])<=R.tofuPerfect;
    const lo=Math.max(from[axis]-from[size]/2,top[axis]-top[size]/2),hi=Math.min(from[axis]+from[size]/2,top[axis]+top[size]/2);
    const kept=perfect?{...top}:hi-lo>=R.tofuMinimum?{...top,[axis]:(lo+hi)/2,[size]:hi-lo}:null;
    // Score and layers settle together at landing. Replayed drops cannot enqueue twice.
    return {...s,fall:{at:s.elapsed,axis,from,kept,perfect}};
  }
  if(a.kind==='pick'&&s.game==='holiday') {
    if(!Number.isInteger(a.hole)||a.hole<0||a.hole>5||a.round!==s.round||!holidayOpen(s)||(s.pressed&(1<<a.hole)))return s;
    const targets=holidayTargets(s.seed,s.round),kind=a.hole===targets.good?'good':a.hole===targets.boss?'boss':'empty';
    const combo=kind==='good'?s.combo+1:0;
    return praise({...s,pressed:s.pressed|(1<<a.hole),combo,score:Math.max(0,s.score+(kind==='good'?100+20*Math.min(combo,10):kind==='boss'?-80:-15)),saved:s.saved+(kind==='good'?1:0),mistakes:s.mistakes+(kind==='good'?0:1),pick:{hole:a.hole,kind,at:s.elapsed}},kind==='good'?`假日搶救成功！${combo>1?`${combo} 連擊！`:''}`:kind==='boss'?'糟糕，領到一場會議。':'這格還在放空中。');
  }
  return s;
}

/** PT-2/3: resolve every crossed wave at its actual arrival, even on a slow frame. */
export function advanceParty(s:PartyRun,delta:number):PartyRun {
  if(s.status!=='playing'||!Number.isFinite(delta)||delta<=0)return s;
  const dt=Math.min(delta,R.maxAdvanceMs);
  if(s.game==='chair') {
    const end=Math.min(R.chairMs,s.elapsed+dt);let next:ChairRun={...s,elapsed:end,x:move(s.x,s.lane,R.laneSpeed*(end-s.elapsed)/1000)};
    while(next.resolved<R.chairWaves) {
      const wave=chairWave(s.seed,next.resolved);if(wave.at>end)break;
      const x=move(s.x,s.lane,R.laneSpeed*Math.max(0,wave.at-s.elapsed)/1000);
      const hit=Math.abs(x-wave.lane)<R.collisionLane&&(wave.kind==='meeting'||chairJump(s,wave.at)<.8);
      next={...next,resolved:next.resolved+1};
      if(hit)next=praise({...next,lives:next.lives-1,hits:next.hits+1,hitAt:wave.at,score:Math.max(0,next.score-30),combo:0},'被會議攔截！換條路再衝。');
      else next={...next,score:next.score+15};
      if(Math.abs(x-wave.ticketLane)<R.collisionLane) {
        const combo=next.combo+1;next=praise({...next,combo,tickets:next.tickets+1,score:next.score+100+10*Math.min(combo,10)},combo>2?`${combo} 張假日票！人生贏家。`:'假日票，收下了！');
      }
      if(next.lives<=0)return {...next,status:'done',elapsed:wave.at};
    }
    return {...next,status:end>=R.chairMs?'done':'playing'};
  }
  if(s.game==='tofu') {
    let next:TofuRun={...s,elapsed:Math.min(R.tofuMs,s.elapsed+dt)};
    if(s.fall&&next.elapsed-s.fall.at>=R.tofuFallMs) {
      const {kept,perfect,from,axis}=s.fall,size=axis==='x'?'width':'depth',combo=kept&&perfect?s.combo+1:0;
      next=praise({...next,layers:kept?[...s.layers,kept]:s.layers,misses:s.misses+(kept?0:1),turn:s.turn+1,fall:null,activeAt:s.fall.at+R.tofuFallMs,combo,score:s.score+(kept?(perfect?150+15*Math.min(combo,10):Math.floor(100*kept[size]/from[size])):0),perfects:s.perfects+(kept&&perfect?1:0)},!kept?'豆腐下班了，還有機會！':perfect?`完美貼齊！${combo>1?`${combo} 連擊`:'嫩得很穩。'}`:'切掉邊邊，繼續蓋！');
    }
    return {...next,status:next.layers.length-1>=R.tofuGoal||next.misses>=R.tofuMisses||next.elapsed>=R.tofuMs?'done':'playing'};
  }
  const elapsed=Math.min(R.holidayMs,s.elapsed+dt),round=Math.floor(elapsed/R.holidayRoundMs);
  const targets=holidayTargets(s.seed,s.round),missed=!(s.pressed&(1<<targets.good));
  return {...s,elapsed,round:Math.min(round,19),pressed:round!==s.round?0:s.pressed,combo:round!==s.round&&missed?0:s.combo,status:elapsed>=R.holidayMs?'done':'playing'};
}

/** PT-7: no reward/XP/identity interpretation; these are local game facts. */
export function partySummary(s:PartyRun) {
  const caption=s.game==='chair'?(s.lives?'這班，我真的下了。':'人還在，假日先走了。'):s.game==='tofu'?(s.layers.length-1>=R.tofuGoal?'我蓋的不是樓，是豆腐界奇蹟。':s.layers.length>6?'這棟豆腐，比我的作息還穩。':'豆腐很嫩，人生很硬。'):(s.saved>=16?'假日守護神，就是我。':s.mistakes>5?'拯救了假日，順便排了幾場會。':'今天的休假，有被好好守護。');
  const details=s.game==='chair'?`${s.score} 分 · ${s.tickets} 張假日票 · ${s.hits} 次被攔截`:s.game==='tofu'?`${s.score} 分 · 疊了 ${s.layers.length-1} 層 · ${s.perfects} 次完美貼齊`:`${s.score} 分 · 搶救 ${s.saved} 個假日 · 最長 ${s.bestCombo} 連擊`;
  return {caption,details};
}
