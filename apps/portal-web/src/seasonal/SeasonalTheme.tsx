import type {SyntheticEvent} from 'react';
import type {SeasonalDecoration} from './calendar';
import './SeasonalTheme.css';
const COPY = {
  halloween: {label:'萬聖節',title:'一起點亮萬聖夜',description:'一點南瓜色，陪你聊聊日常。'},
  christmas: {label:'聖誕節',title:'把溫暖分享出去',description:'分享一件開心的小事，或一句祝福。'},
  newyear: {label:'新年',title:'新年，一起出發',description:'從今天的一個小心願開始。'},
} as const;
const hideFailedImage=(event:SyntheticEvent<HTMLImageElement>)=>{event.currentTarget.style.visibility='hidden';};
export function SeasonalWelcome({season,onShare,disabled=false}:{season:SeasonalDecoration;onShare:()=>void;disabled?:boolean}) {
  const copy=COPY[season];
  return <section className="seasonal-welcome" aria-label={`${copy.label}問候`}>
    <div className="seasonal-welcome-copy"><span className="seasonal-chip">{copy.label} · 自由工坊</span><h2>{copy.title}</h2><button type="button" className="btn btn-secondary btn-small seasonal-share" disabled={disabled} onClick={onShare}>分享今天的小事</button></div>
    <div className="seasonal-art-column" aria-hidden="true"><img className="seasonal-hero-art" key={season} src={`/art/seasonal/${season}-hero.webp`} alt="" aria-hidden="true" width={season==='halloween'?480:384} height={season==='halloween'?320:384} loading="lazy" decoding="async" fetchPriority="low" draggable={false} onError={hideFailedImage}/></div>
  </section>;
}
