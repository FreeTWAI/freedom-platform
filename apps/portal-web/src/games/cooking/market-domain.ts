/** UX-9a: pure, bounded foreground simulation. Rendering and persistence never mutate a run. */
export const MARKET_IDS=['egg-fried-rice','steak-dinner','shawarma','corn-dog'] as const;
export type MarketId=typeof MARKET_IDS[number];
export const marketOf=(value:unknown):MarketId|null=>MARKET_IDS.includes(value as MarketId)?value as MarketId:null;
export const MARKET_RULES={portions:16,strokes:8,points:32,maxMs:300000,saveBytes:32768,ttl:604800000,cooldown:350,targets:[25,145,185,235],degreesPerSecond:28,cookDivisor:3200,drainMs:3000} as const;
export const INGREDIENTS={rice:{name:'白飯',color:'#e8d5a1',grams:120},egg:{name:'雞蛋',color:'#f1ba39',grams:50},scallion:{name:'蔥花',color:'#5c8b3e',grams:10},shrimp:{name:'蝦仁',color:'#ec9c79',grams:40},carrot:{name:'紅蘿蔔',color:'#d66e30',grams:20},steak:{name:'牛排',color:'#a54c3d',grams:180},potato:{name:'薯條',color:'#e0b861',grams:45},broccoli:{name:'花椰菜',color:'#527b36',grams:30},bread:{name:'餅皮',color:'#dcba7c',grams:65},meat:{name:'烤肉片',color:'#945433',grams:30},lettuce:{name:'生菜',color:'#7d9f49',grams:15},tomato:{name:'番茄',color:'#c65439',grams:25},sausage:{name:'熱狗',color:'#b66a48',grams:70}} as const;
export type Ingredient=keyof typeof INGREDIENTS;
export const MARKET_MENUS:Record<MarketId,readonly Ingredient[]>={'egg-fried-rice':['rice','egg','scallion','shrimp','carrot'],'steak-dinner':['steak','potato','egg','broccoli'],shawarma:['bread','lettuce','tomato','potato'],'corn-dog':['sausage']};
export type Portion={kind:Ingredient;a:number;b:number;side:0|1;flips:number;coated:boolean;lifted:boolean;drain:number};
export type Sauce='ketchup'|'mustard'|'garlic';
export type SauceLine={sauce:Sauce;points:{x:number;y:number}[]};
export type MarketRun={version:1;recipe:MarketId;seed:number;elapsed:number;status:'ready'|'playing'|'paused'|'done';temperature:number;heat:0|1|2|3;portions:Portion[];salt:number;stirs:number;tosses:number;spilled:number;aroma:number;shaves:number;folds:number;lastAction:number;sauces:SauceLine[]};
export type MarketAction={kind:'start'|'pause'|'stir'|'toss'|'coat'|'lift'|'shave'|'fold'|'salt'|'serve';index?:number}|{kind:'heat';value:0|1|2|3}|{kind:'add';ingredient:Ingredient}|{kind:'flip';index:number}|{kind:'sauce';line:SauceLine};
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function newMarket(recipe:MarketId,seed:number):MarketRun{return {version:1,recipe,seed:seed>>>0,elapsed:0,status:'ready',temperature:25,heat:2,portions:[],salt:0,stirs:0,tosses:0,spilled:0,aroma:0,shaves:0,folds:0,lastAction:-1000,sauces:[]};}
export function advanceMarket(run:MarketRun,ms:number):MarketRun{
 if(run.status!=='playing'||!Number.isFinite(ms)||ms<=0)return run;
 const delta=Math.min(ms,1000,MARKET_RULES.maxMs-run.elapsed),dt=delta/1000,target=MARKET_RULES.targets[run.heat],temperature=run.temperature+clamp(target-run.temperature,-28*dt,28*dt);
 const portions=run.portions.map(p=>{if(p.lifted)return {...p,drain:Math.min(10000,p.drain+delta)};if(run.recipe==='shawarma')return p;const key=p.side?'b':'a';return {...p,[key]:clamp(p[key]+Math.max(0,(temperature+run.temperature)/2-95)/MARKET_RULES.cookDivisor*dt,0,1.5)};});
 return {...run,elapsed:run.elapsed+delta,temperature,portions,...(run.elapsed+delta>=MARKET_RULES.maxMs?{status:'paused' as const}:{})};
}
export function mainPortions(r:MarketRun){return r.portions.filter(p=>p.kind===(r.recipe==='egg-fried-rice'?'rice':r.recipe==='steak-dinner'?'steak':r.recipe==='shawarma'?'meat':'sausage'));}
export function canServe(r:MarketRun){return mainPortions(r).length>0&&(r.recipe!=='shawarma'||r.folds===3);}
export function marketMass(r:MarketRun){return Math.max(0,r.portions.reduce((s,p)=>s+INGREDIENTS[p.kind].grams,0)-r.spilled);}
export function applyMarket(run:MarketRun,action:MarketAction):{run:MarketRun;message:string}{
 const no=(message='')=>({run,message});
 if(action.kind==='pause')return {run:run.status==='playing'?{...run,status:'paused'}:run,message:''};
 if(action.kind==='start')return run.status==='ready'||run.status==='paused'&&run.elapsed<MARKET_RULES.maxMs?{run:{...run,status:'playing'},message:'開攤！食材直接放，想怎麼做都可以。'}:no();
 if(run.status!=='playing')return no();
 if(action.kind==='heat')return MARKET_RULES.targets[action.value]===undefined?no():{run:{...run,heat:action.value},message:action.value?'火力已調整。':'已關火，鍋子會慢慢降溫。'};
 if(action.kind==='serve')return canServe(run)?{run:{...run,status:'done'},message:'上桌！這就是你的獨家配方。'}:no(run.recipe==='shawarma'?'先削些烤肉，再把餅皮折三次。':'先放入主食材，再決定何時上桌。');
 if(action.kind==='sauce'){
  if(run.sauces.length>=MARKET_RULES.strokes)return no('醬已經很夠了，留一點給下一盤。');
  const line=action.line;if(!['ketchup','mustard','garlic'].includes(line.sauce)||line.points.length<2||line.points.length>MARKET_RULES.points||line.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))return no();
  return {run:{...run,sauces:[...run.sauces,{sauce:line.sauce,points:line.points.map(p=>({...p}))}]},message:'醬線留下來了。你的手寫招牌！'};
 }
 if(run.elapsed-run.lastAction<MARKET_RULES.cooldown)return no();
 let next:MarketRun={...run,lastAction:run.elapsed,portions:run.portions.map(p=>({...p}))},message='';
 switch(action.kind){
  case 'add':{
   if(!MARKET_MENUS[run.recipe].includes(action.ingredient))return no();
   if(run.portions.length>=MARKET_RULES.portions)return no('這鍋滿了！先把這一盤做好。');
   if(run.recipe==='shawarma'&&run.folds)return no('餅皮已折好，下次再加料。');
   next.portions.push({kind:action.ingredient,a:0,b:0,side:0,flips:0,coated:false,lifted:false,drain:0});message=`${INGREDIENTS[action.ingredient].name}下鍋！`;break;
  }
  case 'salt':next.salt=Math.min(8,run.salt+1);message=next.salt>3?'老闆，鹽有點豪邁喔。':'一撮鹽，香氣起來了。';break;
  case 'flip':{const p=next.portions[action.index];if(!p||p.lifted)return no();p.side=p.side?0:1;p.flips=Math.min(100,p.flips+1);message='翻面！看另一面的煎色。';break;}
  case 'stir':case 'toss':{
   if(run.recipe!=='egg-fried-rice'||!run.portions.length)return no('先放一份白飯，再開始翻炒。');
   next.stirs=Math.min(200,run.stirs+1);next.tosses=Math.min(200,run.tosses+(action.kind==='toss'?1:0));
   next.portions=next.portions.map(p=>({...p,side:p.side?0:1}));
   const burn=run.portions.some(p=>Math.max(p.a,p.b)>1.05);next.aroma=clamp(run.aroma+(run.temperature>=155&&run.temperature<=215&&!burn?6:1),0,100);
   if(action.kind==='toss'&&(run.portions.length>9||run.temperature>220))next.spilled=Math.min(run.spilled+marketMass(run),run.spilled+12);
   message=next.spilled>run.spilled?'炒飯起飛，隔壁攤也分到一口！':'顆粒翻起來，鍋氣再加一點。';break;
  }
  case 'coat':{if(run.recipe!=='corn-dog')return no();const p=action.index===undefined?next.portions.find(p=>!p.coated):next.portions[action.index];if(!p||p.coated)return no('先選一支還沒裹糊的熱狗。');p.coated=true;message='轉一圈，裹上厚厚麵糊。';break;}
  case 'lift':{if(run.recipe!=='corn-dog')return no();const p=action.index===undefined?next.portions.find(p=>!p.lifted):next.portions[action.index];if(!p||p.lifted)return no('這支已經在瀝油架了。');p.lifted=true;message='起鍋！放架上瀝油三秒，再擠醬。';break;}
  case 'shave':{
   if(run.recipe!=='shawarma'||run.shaves>=12||run.folds||run.portions.length>=16)return no('這份烤肉已經夠豪邁了。');
   if(!run.portions.some(p=>p.kind==='bread'))return no('先鋪一張餅皮接住烤肉。');
   next.shaves++;const cook=clamp((run.temperature-70)/150,.05,1.2);next.portions.push({kind:'meat',a:cook,b:cook,side:0,flips:0,coated:false,lifted:true,drain:0});message='刷！薄薄肉片掉到餅上。';break;
  }
  case 'fold':if(run.recipe!=='shawarma'||!mainPortions(run).length||run.folds>=3)return no('先削肉、放配菜，再包起來。');next.folds++;message=next.folds===3?'封口完成！招牌沙威瑪可以上桌。':`第${next.folds}折，餡料收進來。`;break;
 }
 return {run:next,message};
}
export function marketGrade(r:MarketRun){
 const main=mainPortions(r),average=(f:(p:Portion)=>number)=>main.length?main.reduce((s,p)=>s+f(p),0)/main.length:0;
 const cooked=average(p=>(p.a+p.b)/2),burn=average(p=>Math.max(0,Math.max(p.a,p.b)-1));
 const doneness=Math.round(clamp(1-Math.abs(cooked-.72)/.85-burn*1.8)*100);
 const technique=r.recipe==='egg-fried-rice'?Math.min(100,r.stirs*9+r.aroma*.4):r.recipe==='steak-dinner'?average(p=>Math.min(1,p.flips)*100):r.recipe==='shawarma'?Math.min(100,r.shaves*18+r.folds*12):average(p=>(p.coated?50:0)+(p.lifted?25:0)+Math.min(25,p.drain/120));
 const balance=Math.max(0,100-Math.abs(r.salt-1)*12-r.spilled*.5-Math.max(0,r.sauces.length-4)*8);
 const finish=r.recipe==='corn-dog'?average(p=>(p.coated?35:0)+(p.lifted?35:0)+Math.min(30,p.drain/100)):r.recipe==='shawarma'?r.folds/3*100:Math.min(100,main.length?55+new Set(r.portions.map(p=>p.kind)).size*12:0);
 const metrics=[{name:'熟度',value:doneness},{name:r.recipe==='corn-dog'?'酥脆':'手感',value:Math.round(technique)},{name:'調味',value:Math.round(balance)},{name:'完成度',value:Math.round(finish)}],score=Math.round(clamp(metrics.reduce((s,m)=>s+m.value,0)/4,10,100));
 const title=r.spilled>=36?'隔壁攤的免費試吃':burn>.25?'炭烤派掌門人':marketMass(r)>900?'這盤有自己的重力場':r.salt>4?'海水的代言人':score>=85?'夜市隱藏版主廚':score>=65?'今天這攤有料':'很有個人的想法';
 return {score,metrics,title,details:`${marketMass(r)} g · ${Math.floor(r.elapsed/1000)} 秒 · ${r.recipe==='shawarma'?r.shaves+'刀烤肉':r.recipe==='corn-dog'?main.length+'支熱狗':r.recipe==='egg-fried-rice'?r.tosses+'次拋鍋':main.length+'塊牛排'}${r.spilled?` · 灑出${r.spilled} g`:''}`,quip:r.spilled?'鍋子裝不下你的野心，地板先吃了。':score>=85?'客人說再來一份，你決定先收攤吃自己的。':burn>.2?'這個煎色，連炭火都想跟你拜師。':'配方不必一樣，這盤就是你做的。'};
}
const keys=(x:object,allowed:string[])=>Object.keys(x).every(k=>allowed.includes(k));
export function parseMarket(value:unknown):MarketRun|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const r=value as MarketRun;
 const range=(v:number,a:number,b:number,int=false)=>Number.isFinite(v)&&v>=a&&v<=b&&(!int||Number.isInteger(v));
 if(!keys(r,Object.keys(newMarket('corn-dog',1)))||r.version!==1||!marketOf(r.recipe)||!range(r.seed,0,4294967295,true)||!['ready','playing','paused','done'].includes(r.status)||!range(r.elapsed,0,300000)||!range(r.temperature,25,235)||!range(r.heat,0,3,true)||!range(r.salt,0,8,true)||!range(r.stirs,0,200,true)||!range(r.tosses,0,r.stirs,true)||!range(r.spilled,0,1920)||!range(r.aroma,0,100)||!range(r.shaves,0,12,true)||!range(r.folds,0,3,true)||!range(r.lastAction,-1000,r.elapsed)||!Array.isArray(r.portions)||r.portions.length>16||!Array.isArray(r.sauces)||r.sauces.length>8)return null;
 for(const p of r.portions){if(!p||!keys(p,['kind','a','b','side','flips','coated','lifted','drain'])||!(MARKET_MENUS[r.recipe].includes(p.kind)||r.recipe==='shawarma'&&p.kind==='meat')||!range(p.a,0,1.5)||!range(p.b,0,1.5)||!range(p.side,0,1,true)||!range(p.flips,0,100,true)||typeof p.coated!=='boolean'||typeof p.lifted!=='boolean'||!range(p.drain,0,10000))return null;}
 for(const line of r.sauces){if(!line||!keys(line,['sauce','points'])||!['ketchup','mustard','garlic'].includes(line.sauce)||!Array.isArray(line.points)||line.points.length<2||line.points.length>32||line.points.some(p=>!p||!keys(p,['x','y'])||!range(p.x,0,1)||!range(p.y,0,1)))return null;}
 if(r.recipe==='shawarma'&&mainPortions(r).length!==r.shaves||r.status==='done'&&!canServe(r))return null;
 return structuredClone(r);
}
export const MARKET_SAVE_KEY='freedom.cooking.market.v1';
export function saveMarket(storage:Pick<Storage,'setItem'|'getItem'>,run:MarketRun,now=Date.now()){try{if(!parseMarket(run))return false;const raw=JSON.stringify({savedAt:now,run});if(raw.length>MARKET_RULES.saveBytes)return false;storage.setItem(MARKET_SAVE_KEY,raw);return storage.getItem(MARKET_SAVE_KEY)===raw;}catch{return false;}}
export function readMarket(storage:Pick<Storage,'getItem'>,now=Date.now()):MarketRun|null{try{const raw=storage.getItem(MARKET_SAVE_KEY);if(!raw||raw.length>MARKET_RULES.saveBytes)return null;const x=JSON.parse(raw),r=parseMarket(x.run);if(!rangeDate(x.savedAt,now)||!r)return null;return {...r,status:r.status==='playing'?'paused':r.status};}catch{return null;}}
function rangeDate(v:unknown,now:number){return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=now+60000&&now-v<=MARKET_RULES.ttl;}
