import {IngredientIcon} from './IngredientIcon';
import {INGREDIENTS,type MarketRun} from './market-domain';

/** A bounded, original SVG projection of this run, never a replacement score or
 * recipe simulation. The surrounding application owns gestures and keyboard. */
export function MarketIllustration({run,selected}:{run:MarketRun;selected:number}){
 const plated=run.status==='done'||(run.recipe==='corn-dog'&&run.portions.length>0&&run.portions.every(p=>p.lifted));
 return <svg viewBox="0 0 600 500" aria-hidden="true" className="mk-illustration">
  <rect width="600" height="500" fill="#b58354"/>
  {[90,190,290,390].map(y=><path key={y} d={`M0 ${y}h600`} stroke="#956339" strokeWidth="3"/>)}
  <ellipse cx="300" cy="265" rx="246" ry="184" fill={plated?'#f6edda':'#32372f'} stroke={plated?'#bc9c72':'#777e70'} strokeWidth="14"/>
  {!plated&&<path d="M520 280 588 310" stroke="#47382a" strokeWidth="26" strokeLinecap="round"/>}
  {run.portions.map((p,i)=>{const cols=Math.min(4,Math.max(1,run.portions.length)),rows=Math.ceil(run.portions.length/cols),w=380/cols,h=Math.min(120,270/rows),x=110+(i%cols)*w,y=245-rows*h/2+Math.floor(i/cols)*h,cooked=p.side?p.b:p.a;
   return <g key={i} data-market-portion={i}>
    <rect x={x} y={y} width={w-5} height={h-5} rx="18" fill={p.coated?'#e4b45c':'#f7ebce'} stroke={selected===i?'#b94a2c':'#9c794e'} strokeWidth={selected===i?5:2}/>
    <svg x={x+6} y={y+3} width={w-17} height={Math.max(20,h-30)} viewBox="0 0 64 48"><IngredientIcon kind={p.kind}/></svg>
    <rect x={x+4} y={y+3} width={w-13} height={Math.max(20,h-30)} rx="14" fill="#523121" opacity={Math.max(0,Math.min(.65,(cooked-.25)*.55))}/>
    <text x={x+(w-5)/2} y={y+h-12} textAnchor="middle" fontSize="14" fill="#392f2c">{p.lifted?'瀝油':INGREDIENTS[p.kind].name} {Math.round(cooked*100)}%</text>
   </g>;
  })}
  {run.sauces.map((line,i)=><polyline key={i} points={line.points.map(p=>`${p.x*600},${p.y*500}`).join(' ')} fill="none" stroke={{ketchup:'#bc3823',mustard:'#d4aa20',garlic:'#fff3cd'}[line.sauce]} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"/>)}
  {!run.portions.length&&<text x="300" y="265" textAnchor="middle" fontSize="24" fill="#f6edda">從食材盤加一份，自己掌鍋</text>}
 </svg>;
}
