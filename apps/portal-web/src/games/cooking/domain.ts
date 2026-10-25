import { COOKING_RULES as RULES, recipeOf, type CookingStep, type Direction, type Recipe } from './catalog';

export type CookingPhase = 'ready'|'playing'|'paused'|'step-result'|'done';
export type StepReport = {step: number; score: number; elapsed: number; mistakes: number};
export type ActiveStep = {amount: number; count: number; mistakes: number; quality: number; weight: number; heat: number; flipped: boolean; holdAt: number|null; lastAt: number; angle: number|null; foam: number};
export type CookingRun = {version: 1; id: string; recipeId: string; seed: number; step: number; status: CookingPhase; elapsed: number; stepElapsed: number; lastNow: number|null; active: ActiveStep; reports: StepReport[]};
export type CookingAction =
  | {kind: 'start'|'pause'|'resume'|'next'|'cancel'|'cut-key'|'stir-key'|'hold-start'|'hold-end'|'flip'|'skim'|'take-out'|'place-key'; step: number}
  | {kind: 'heat'; step: number; value: number}
  | {kind: 'cut'; step: number; x1: number; y1: number; x2: number; y2: number}
  | {kind: 'stir'; step: number; x: number; y: number}
  | {kind: 'fold'; step: number; index: number; direction: Direction}
  | {kind: 'place'; step: number; index: number; x: number; y: number};
const bound = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const active = (): ActiveStep => ({amount:0,count:0,mistakes:0,quality:0,weight:0,heat:40,flipped:false,holdAt:null,lastAt:-1000,angle:null,foam:0});
export function newCookingRun(recipe: Recipe, seed: number, id: string): CookingRun {
  if (!recipeOf(recipe.id) || !Number.isInteger(seed) || seed <= 0 || seed > 0xffffffff || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error('料理資料無效。');
  return {version:1,id,recipeId:recipe.id,seed,step:0,status:'ready',elapsed:0,stepElapsed:0,lastNow:null,active:active(),reports:[]};
}
export const currentStep = (run: CookingRun) => recipeOf(run.recipeId)!.steps[run.step];
export const cutGuide = (run: CookingRun) => .22 + .56 * (run.active.count + 1) / (currentStep(run).goal + 1);
export function plateTarget(run: CookingRun) {const angle = -Math.PI / 2 + run.active.count * 2 * Math.PI / currentStep(run).goal; return {x:.5 + .23 * Math.cos(angle), y:.53 + .18 * Math.sin(angle)};}
export function cookingProgress(run: CookingRun) {if(run.status==='step-result'||run.status==='done')return 1;const s=currentStep(run),a=run.active; return bound(s.kind==='mix'?a.amount/(s.goal*Math.PI*2):['slice','knead','fold','plate'].includes(s.kind)?a.count/s.goal:s.kind==='pour'?a.amount/s.target:a.amount);}
export function cookingScore(run: CookingRun) {return run.reports.length?Math.round(run.reports.reduce((sum,r)=>sum+r.score,0)/run.reports.length):0;}
export const cookingStars = (score: number) => score>=85?3:score>=60?2:1;
function finish(run: CookingRun, quality: number): CookingRun {
  if(run.status!=='playing' || run.reports.length!==run.step) return run;
  const report:StepReport={step:run.step,score:Math.round(bound(quality-run.active.mistakes*7,10,100)),elapsed:Math.round(run.stepElapsed),mistakes:run.active.mistakes};
  return {...run,status:run.step===recipeOf(run.recipeId)!.steps.length-1?'done':'step-result',lastNow:null,active:{...run.active,holdAt:null,angle:null},reports:[...run.reports,report]};
}
function settle(run: CookingRun): CookingRun {
  const s=currentStep(run),a=run.active;
  if (['slice','fold','plate','knead'].includes(s.kind) && a.count>=s.goal) return finish(run,s.kind==='knead'?a.quality/Math.max(1,a.weight):100);
  if(s.kind==='mix' && a.amount>=s.goal*Math.PI*2-.001) return finish(run,100);
  if(s.kind==='pan' && a.amount>=1 && a.flipped || s.kind==='boil' && a.amount>=1 && a.count>=s.goal) return finish(run,a.quality/Math.max(1,a.weight));
  if(s.kind==='bake' && a.amount>=1.15) return finish(run,20);
  if(s.kind==='pour' && a.amount>=1) return finish(run,25);
  return run;
}
/** CK-4/7: injected monotonic foreground clock; a long frame cannot instantly burn a dish. */
export function advanceCooking(run: CookingRun, now: number): CookingRun {
  if(run.status!=='playing' || !Number.isFinite(now) || now<0 || run.lastNow!==null && now<run.lastNow) return run;
  const actual=run.lastNow===null?0:now-run.lastNow,dt=Math.min(RULES.maxSimulatedTickMs,actual);
  if(!dt) return {...run,lastNow:now};
  const a={...run.active},s=currentStep(run),next={...run,lastNow:now,elapsed:Math.min(86400000,run.elapsed+actual),stepElapsed:Math.min(86400000,run.stepElapsed+actual),active:a};
  if(['pan','boil','bake'].includes(s.kind)) {
    const match=bound(1-Math.max(0,Math.abs(a.heat-s.heat)-6)/32),quality=100*match;
    a.amount=Math.min(1.2,a.amount+dt/s.durationMs*(.25+.75*match));
    a.quality+=Math.max(0,quality-(s.kind==='boil'?a.foam*22:0))*dt; a.weight+=dt;
    if(s.kind==='boil') a.foam=bound(a.foam+dt/s.durationMs*(.8+(a.heat>s.heat+14?.7:0)));
  } else if(s.kind==='pour' && a.holdAt!==null) a.amount=Math.min(1,a.amount+dt/s.durationMs);
  return settle(next);
}
/** CK-5: all gestures and keyboard alternatives enter this single mutation boundary. */
export function actCooking(input: CookingRun, action: CookingAction, now: number): CookingRun {
  if(!Number.isFinite(now) || now<0 || input.lastNow!==null && now<input.lastNow || action.step!==input.step || (action.kind==='place'||action.kind==='fold') && action.index!==input.active.count) return input;
  let run=advanceCooking(input,now);
  if(action.kind==='start' && run.status==='ready' || action.kind==='resume' && run.status==='paused') return {...run,status:'playing',lastNow:now,active:{...run.active,holdAt:null,angle:null}};
  if(action.kind==='pause') return run.status==='playing'?{...run,status:'paused',lastNow:null,active:{...run.active,holdAt:null,angle:null}}:run;
  if(action.kind==='next') return run.status==='step-result'?{...run,step:run.step+1,status:'playing',stepElapsed:0,lastNow:now,active:active()}:run;
  if(run.status!=='playing') return run;
  const a={...run.active},s=currentStep(run); run={...run,active:a};
  if(action.kind==='cancel') {a.holdAt=null;a.angle=null;return run;}
  if(action.kind==='heat') {if(['pan','boil','bake'].includes(s.kind)&&Number.isFinite(action.value)) a.heat=bound(action.value,0,100);return run;}
  if(action.kind==='hold-start') {if(['knead','pour'].includes(s.kind)&&a.holdAt===null) a.holdAt=run.elapsed;return run;}
  if(action.kind==='hold-end') {
    if(a.holdAt===null) return run;
    const held=run.elapsed-a.holdAt;a.holdAt=null;
    if(held<RULES.minHoldMs) return run;
    if(s.kind==='knead') {a.count++;a.quality+=bound(100-Math.abs(held-s.holdMs)/8,15,100);a.weight++;}
    if(s.kind==='pour'&&a.amount>=.25) return finish(run,bound(100-Math.abs(a.amount-s.target)*300,10,100));
    return settle(run);
  }
  if(action.kind==='stir' && s.kind==='mix') {
    if(!Number.isFinite(action.x)||!Number.isFinite(action.y)) return run;
    const dx=action.x-.5,dy=action.y-.52,r=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
    if(r<RULES.minStirRadius||r>RULES.maxStirRadius) {a.angle=null;return run;}
    if(a.angle!==null) {let delta=angle-a.angle; if(delta>Math.PI)delta-=Math.PI*2;if(delta<-Math.PI)delta+=Math.PI*2;
      if(Math.abs(delta)<=RULES.maxStirDelta) a.amount=Math.max(0,a.amount+delta);
    }
    a.angle=angle;return settle(run);
  }
  if(run.elapsed-a.lastAt<RULES.actionCooldownMs) return run;
  const accepted=()=>{a.lastAt=run.elapsed;};
  if((action.kind==='cut'||action.kind==='cut-key')&&s.kind==='slice') {
    if(action.kind==='cut') {
      if(![action.x1,action.y1,action.x2,action.y2].every(n=>Number.isFinite(n)&&n>=0&&n<=1)) return run;
      if(Math.hypot(action.x2-action.x1,action.y2-action.y1)<RULES.minCutDistance)return run;
      if(Math.abs(action.x2-action.x1)>.14 || Math.min(action.y1,action.y2)>.43 || Math.max(action.y1,action.y2)<.6 || Math.abs((action.x1+action.x2)/2-cutGuide(run))>.13) {a.mistakes++;accepted();return run;}
    }
    a.count++;accepted();
  } else if(action.kind==='stir-key' && s.kind==='mix') {a.amount+=Math.PI*2;a.angle=null;accepted();}
  else if(action.kind==='flip' && s.kind==='pan' && !a.flipped && a.amount>=.25) {a.flipped=true;if(a.amount<.35||a.amount>.8)a.mistakes++;accepted();}
  else if(action.kind==='skim' && s.kind==='boil' && a.foam>=.18 && a.count<s.goal) {a.foam=0;a.count++;accepted();}
  else if(action.kind==='take-out' && s.kind==='bake' && a.amount>=.25) return finish(run,bound(100-Math.abs(a.amount-.8)*240,10,100)*.7+(a.quality/Math.max(1,a.weight))*.3);
  else if(action.kind==='fold' && s.kind==='fold' && action.index===a.count) {if(action.direction===s.directions[a.count])a.count++;else a.mistakes++;accepted();}
  else if((action.kind==='place'||action.kind==='place-key') && s.kind==='plate') {
    if(action.kind==='place') {if(action.index!==a.count||![action.x,action.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))return run;const target=plateTarget(run);if(Math.hypot(action.x-target.x,action.y-target.y)>RULES.plateRadius){a.mistakes++;accepted();return run;}}
    a.count++;accepted();
  }
  return settle(run);
}

/** CK-7: bounded checkpoint parser; never resume wall-clock time after reload. */
export function parseCookingRun(value: unknown): CookingRun|null {
  if(!value||typeof value!=='object')return null;
  const x=value as CookingRun,recipe=recipeOf(x.recipeId),a=x.active;
  if(x.version!==1||!recipe||typeof x.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(x.id)||!Number.isInteger(x.seed)||x.seed<=0||x.seed>0xffffffff||!Number.isInteger(x.step)||x.step<0||x.step>=recipe.steps.length||!['ready','playing','paused','step-result','done'].includes(x.status)||![x.elapsed,x.stepElapsed].every(n=>Number.isFinite(n)&&n>=0&&n<=86400000)||x.lastNow!==null&&(!Number.isFinite(x.lastNow)||x.lastNow<0)||x.stepElapsed>x.elapsed||!a||!Array.isArray(x.reports))return null;
  const s=recipe.steps[x.step],settled=x.status==='step-result'||x.status==='done';
  if(x.reports.length!==x.step+(settled?1:0)||x.status==='done'&&x.step!==recipe.steps.length-1||x.status==='step-result'&&x.step===recipe.steps.length-1||x.status==='ready'&&(x.step!==0||x.elapsed!==0))return null;
  if(![a.amount,a.count,a.mistakes,a.quality,a.weight,a.heat,a.lastAt,a.foam].every(Number.isFinite)||a.amount<0||a.amount>(s.kind==='mix'?s.goal*Math.PI*2+Math.PI*2:1.21)||!Number.isInteger(a.count)||a.count<0||a.count>s.goal||!Number.isInteger(a.mistakes)||a.mistakes<0||a.mistakes>100000||a.quality<0||a.quality>8640000000||a.weight<0||a.weight>86400000||a.heat<0||a.heat>100||a.foam<0||a.foam>1||a.lastAt< -1000||a.lastAt>x.elapsed||typeof a.flipped!=='boolean'||a.holdAt!==null&&(!Number.isFinite(a.holdAt)||a.holdAt<0||a.holdAt>x.elapsed)||a.angle!==null&&(!Number.isFinite(a.angle)||Math.abs(a.angle)>Math.PI))return null;
  if(x.reports.some((r,i)=>!r||r.step!==i||!Number.isInteger(r.score)||r.score<10||r.score>100||!Number.isFinite(r.elapsed)||r.elapsed<0||r.elapsed>x.elapsed||!Number.isInteger(r.mistakes)||r.mistakes<0||r.mistakes>100000))return null;
  return {version:1,id:x.id,recipeId:recipe.id,seed:x.seed,step:x.step,status:x.status==='playing'?'paused':x.status,elapsed:x.elapsed,stepElapsed:x.stepElapsed,lastNow:null,active:{amount:a.amount,count:a.count,mistakes:a.mistakes,quality:a.quality,weight:a.weight,heat:a.heat,flipped:a.flipped,holdAt:null,lastAt:a.lastAt,angle:null,foam:a.foam},reports:x.reports.map(r=>({step:r.step,score:r.score,elapsed:r.elapsed,mistakes:r.mistakes}))};
}
