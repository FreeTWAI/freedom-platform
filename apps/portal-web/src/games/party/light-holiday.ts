import {holidayOpen,holidayTargets,partySummary,type HolidayRun} from './domain';

/** Presentation only. Every enabled cell and identity comes from the live domain. */
export function holidayCells(run:HolidayRun) {
  const targets=holidayTargets(run.seed,run.round),open=holidayOpen(run);
  return Array.from({length:6},(_,hole)=>{
    const pressed=!!(run.pressed&(1<<hole));
    const kind=!open||pressed?'waiting':hole===targets.good?'good':hole===targets.boss?'boss':'empty';
    return {hole,kind,label:kind==='good'?'休假':kind==='boss'?'開會':kind==='empty'?'空蒸籠':pressed?'已選':'等待',enabled:open&&!pressed};
  });
}

/** Native clicks retain the down-time wave; AT clicks without a down remain usable. */
export function holidayInput() {
  const held=new Map<number,{owner:string;round:number;cancelled:boolean;released:boolean}>();
  return {
    down(hole:number,owner:string,round:number){const old=held.get(hole);if(old&&!old.cancelled&&!old.released&&old.owner!==owner&&old.round===round)return false;held.set(hole,{owner,round,cancelled:false,released:false});return true;},
    up(hole:number,owner:string){const press=held.get(hole);if(press?.owner===owner)press.released=true;},
    cancel(hole?:number,owner?:string){for(const [cell,press]of held){if((hole===undefined||cell===hole)&&(owner===undefined||press.owner===owner))press.cancelled=true;}},
    lost(hole:number,owner:string){const press=held.get(hole);if(press?.owner===owner&&!press.released)press.cancelled=true;},
    pointerClick(hole:number){const press=held.get(hole);if(!press?.owner.startsWith('pointer:')||!press.released)return null;held.delete(hole);return press.cancelled?null:press.round;},
    assistive(hole:number,round:number){const press=held.get(hole);if(press&&!press.cancelled&&!press.released)return null;held.delete(hole);return round;},
    click(hole:number,round:number,owner?:string){const press=held.get(hole);if(!press)return owner===undefined?round:null;if(owner!==undefined&&press.owner!==owner)return null;held.delete(hole);return press.cancelled?null:press.round;},
  };
}

const xml=(value:string|number)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** A labelled scorecard of this completed run, not a fabricated 3D screenshot. */
export function holidayResultSvg(run:HolidayRun) {
  if(run.status!=='done')throw Error('The holiday run is not complete.');
  const summary=partySummary(run);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><rect width="960" height="720" fill="#fff8e8"/><rect x="36" y="36" width="888" height="648" rx="28" fill="#efe7d9" stroke="#443b37" stroke-width="4"/><g fill="#443b37" text-anchor="middle" font-family="sans-serif"><text x="480" y="112" font-size="30">假日保衛戰 · 本局成果</text><text x="480" y="157" font-size="22">輕量成果卡（依本局紀錄繪製）</text><text x="480" y="288" font-size="88" font-weight="bold">${xml(run.score)} 分</text><text x="480" y="362" font-size="30">搶救 ${xml(run.saved)} 個假日 · 誤選 ${xml(run.mistakes)} 次</text><text x="480" y="416" font-size="28">最長 ${xml(run.bestCombo)} 連擊 · 完成 ${xml(run.elapsed/1000)} 秒</text><text x="480" y="492" font-size="26">${xml(summary.caption)}</text><text x="480" y="562" font-size="25">同題 #${xml(run.seed)}</text><text x="480" y="620" font-size="20">本機遊戲紀錄，不是平台貢獻或驗證排行榜</text></g></svg>`;
}
export function holidayResultImage(run:HolidayRun){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(holidayResultSvg(run))}`;}
