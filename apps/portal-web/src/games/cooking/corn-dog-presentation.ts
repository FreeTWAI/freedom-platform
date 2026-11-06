import type {MarketRun} from './market-domain';

/** Presentation only: never advances, scores or changes the player's run. */
export function cornDogPresentation(run:MarketRun){
 const cooking=run.recipe==='corn-dog'&&(run.status==='playing'||run.status==='paused');
 const temperature=Number.isFinite(run.temperature)?run.temperature:25;
 const warmth=Math.max(0,Math.min(1,(temperature-120)/65));
 const submerged=cooking?run.portions.filter(p=>p.kind==='sausage'&&!p.lifted).length:0;
 const bubbleCount=warmth>0?Math.min(24,submerged*6):0;
 return Object.freeze({
  warmth,
  bubbleCount,
  bubbleOpacity:bubbleCount? .18+warmth*.3:0,
  // The lamp represents the current control, not a made-up doneness score.
  heaterGlow:cooking&&run.status==='playing'?run.heat/3:0,
  dialAngle:-Math.PI*.65+run.heat/3*Math.PI*1.3,
 });
}
