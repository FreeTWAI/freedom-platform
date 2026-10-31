import {marketGrade,type MarketRun} from './market-domain';
/** UX-13: the player's actual total, without rankings, axes or commentary. */
export function MarketScore({run}:{run:MarketRun}){
 const score=marketGrade(run).score;
 return <section className="mk-score" aria-label="料理分數"><div><strong>{score}<small>分</small></strong></div></section>;
}
