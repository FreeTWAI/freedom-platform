import {PARTY_RULES as R} from './catalog';
import {chairJump,chairWave,partySummary,tofuAxis,tofuPosition,type ChairRun,type PartyRun,type TofuLayer,type TofuRun} from './domain';
import {holidayResultSvg} from './light-holiday';

/** A held input belongs to the wave/turn at down, never the next one. */
export function partyInputStamp(run:PartyRun){return run.game==='chair'?run.resolved:run.game==='tofu'?run.turn:run.round;}
export function acceptsPartyInput(run:PartyRun,stamp:number|null){return run.status==='playing'&&stamp!==null&&partyInputStamp(run)===stamp;}

/** Projections read the domain. They never advance time, choose a lane or score. */
export function chairView(run:ChairRun){
  const waves=Array.from({length:R.chairWaves},(_,i)=>chairWave(run.seed,i))
    .filter(w=>w.index>=run.resolved&&w.at>=run.elapsed&&w.at-run.elapsed<=R.horizonMs)
    .map(w=>({...w,remaining:w.at-run.elapsed,y:74+300*(1-(w.at-run.elapsed)/R.horizonMs)}));
  return {x:320+run.x*154,y:374-chairJump(run)*36,jump:chairJump(run),waves};
}

export function tofuView(run:TofuRun){
  const top=run.layers[run.layers.length-1],axis=run.fall?.axis??tofuAxis(run);
  const active=run.fall?.from??tofuPosition(run),offset=active[axis]-top[axis];
  const progress=run.fall?Math.max(0,Math.min(1,(run.elapsed-run.fall.at)/R.tofuFallMs)):0;
  return {layers:run.layers,active:run.status==='done'?null:active,axis,offset,progress,
    bottom:run.layers.length*R.tofuHeight+1.4*(1-progress),
    kept:run.fall?.kept??null,falling:!!run.fall,aligned:!run.fall&&Math.abs(offset)<=R.tofuPerfect};
}

/** Presentation-only axis exchange: the current domain axis is always horizontal.
 * No coordinates are written back, so X/Z clipping, scoring and replay stay canonical. */
export function tofuFrontLayer(layer:TofuLayer,axis:'x'|'z'):TofuLayer {
  return axis==='x'?{...layer}:{x:layer.z,z:layer.x,width:layer.depth,depth:layer.width};
}
/** Frontal theatre rows: original hole identity survives the layout change. */
export function holidayFrontAnchor(hole:number){
  if(!Number.isInteger(hole)||hole<0||hole>5)throw Error('Invalid holiday hole');
  return {x:(hole%3-1)*2.5,y:hole<3?3.45:.85,z:0};
}
/** Frontal, shallow-depth relief shared by the live SVG and the actual final tower. */
export function tofuFaces(layer:TofuLayer,bottom:number,axis:'x'|'z'='x'){
  layer=tofuFrontLayer(layer,axis);
  const x=layer.x-layer.width/2,z=layer.z-layer.depth/2,y=bottom+R.tofuHeight;
  const point=(a:number,b:number,h:number)=>`${320+a*42},${420+b*2-h*34}`;
  const a=point(x,z,y),b=point(x+layer.width,z,y),c=point(x+layer.width,z+layer.depth,y),d=point(x,z+layer.depth,y);
  return [ [d,c,point(x+layer.width,z+layer.depth,bottom),point(x,z+layer.depth,bottom)].join(' '),
    [b,c,point(x+layer.width,z+layer.depth,bottom),point(x+layer.width,z,bottom)].join(' '),[a,b,c,d].join(' ') ];
}
const xml=(value:string|number)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const TOFU_FACE_COLORS=['#e4cfab','#cbb58f','#fff8e8'] as const;

/** Done-only record, not a reconstructed route or a claimed 3D screenshot. */
export function partyResultSvg(run:PartyRun){
  if(run.game==='holiday')return holidayResultSvg(run);
  if(run.status!=='done')throw Error('The party run is not complete.');
  const title=run.game==='chair'?'辦公椅逃亡':'豆腐疊高高',summary=partySummary(run);
  const detail=run.game==='chair'?`${run.tickets} 張假日票 · ${run.hits} 次被攔截 · 完成 ${run.resolved} 波`:`疊了 ${run.layers.length-1} 層 · ${run.perfects} 次完美貼齊 · ${run.misses} 次失手`;
  const drawing=run.game==='tofu'?`<g data-final-tower="true" transform="translate(160 270) scale(1)">${run.layers.map((layer,i)=>tofuFaces(layer,i*R.tofuHeight,tofuView(run).axis).map((points,face)=>`<polygon points="${points}" fill="${TOFU_FACE_COLORS[face]}" stroke="#443b37" stroke-width="2"/>`).join('')).join('')}</g>`:`<text x="480" y="440" font-size="26">剩餘 ${xml(run.lives)} 顆心 · 最長 ${xml(run.bestCombo)} 連擊</text><text x="480" y="510" font-size="22">僅記錄本局總計，沒有保存逐波路線</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="900" viewBox="0 0 960 900"><rect width="960" height="900" fill="#fff8e8"/><rect x="36" y="36" width="888" height="828" rx="28" fill="#efe7d9" stroke="#443b37" stroke-width="4"/><g fill="#443b37" text-anchor="middle" font-family="sans-serif"><text x="480" y="100" font-size="30">${title} · 本局成果</text><text x="480" y="145" font-size="22">輕量成果卡（依本局紀錄繪製）</text><text x="480" y="235" font-size="64" font-weight="bold">${xml(run.score)} 分</text><text x="480" y="292" font-size="26">${xml(detail)}</text>${drawing}<text x="480" y="750" font-size="24">${xml(summary.caption)}</text><text x="480" y="796" font-size="22">同題 #${xml(run.seed)} · 完成 ${xml(run.elapsed/1000)} 秒</text><text x="480" y="833" font-size="18">本機遊戲紀錄，不是平台貢獻或驗證排行榜</text></g></svg>`;
}
export function partyResultImage(run:PartyRun){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(partyResultSvg(run))}`;}
