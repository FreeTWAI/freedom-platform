import type {MarketRun} from './market-domain';

/** Visual heat cue, not a new doneness or scoring value. */
export function shawarmaPresentation(run:MarketRun,reducedMotion:boolean){
 const temperature=Number.isFinite(run.temperature)?run.temperature:25;
 const elapsed=Number.isFinite(run.elapsed)?Math.max(0,run.elapsed):0;
 return {cooked:Math.max(0,Math.min(1,(temperature-90)/180)),rotation:reducedMotion?0:elapsed/1200};
}
