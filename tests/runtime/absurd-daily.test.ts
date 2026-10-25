import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginStamps,cashDeck,challengeUrl,gradePhoto,newCash,newStamps,pause,photoPose,resume,RULES,seedOf,sortCash,stamp,stampTarget,tick} from '../../apps/portal-web/src/games/domain.js';
import {GAME_HANDOFF_KEY,HANDOFF_TTL,parseGameDraft,readGameDraft,saveGameDraft,clearGameDraft} from '../../apps/portal-web/src/games/result-bridge.js';
test('AD-2 validates seed and emits a public challenge without result or identity',()=>{for(const bad of [0,-1,Infinity,NaN,'1x','0x12','4294967296',null,{},1.5])assert.equal(seedOf(bad),20261023);assert.equal(seedOf('4294967295'),4294967295);const u=new URL(challengeUrl('https://example.org','photo',12));assert.equal(u.pathname,'/play');assert.deepEqual([...u.searchParams],[['game','photo'],['seed','12']]);});
test('AD-5 every seeded deck contains exactly one million and six unique decoys; last note is fixed',()=>{for(let seed=1;seed<=400;seed++){const d=cashDeck(seed);assert.equal(d.length,30);assert.equal(new Set(d.map(c=>c.id)).size,30);assert.equal(d.reduce((sum,c)=>sum+c.amount,0),RULES.targetCash);assert.equal(d.filter(c=>c.valid).length,24);assert.equal(new Set(d.filter(c=>!c.valid).map(c=>c.label)).size,6);assert.equal(d.at(-1)?.amount,100000);assert.deepEqual(d,cashDeck(seed));}assert.notDeepEqual(cashDeck(1),cashDeck(2));});
test('AD-5 wrong sort changes neither progress nor money; stale and rapid actions do not consume a card',()=>{let s=newCash(9);const valid=cashDeck(9)[0].valid;let out=sortCash(s,0,!valid,0);assert.equal(out.kind,'wrong');assert.equal(out.state.index,0);assert.equal(out.state.amount,0);assert.equal(out.state.mistakes,1);s=out.state;assert.equal(sortCash(s,0,valid,20).state,s);s=sortCash(s,0,valid,200).state;assert.equal(s.index,1);assert.equal(sortCash(s,0,valid,400).state,s);for(const now of [NaN,Infinity,-1])assert.equal(sortCash(s,1,true,now).state,s);});
test('AD-5 a full run settles once with exact original facts',()=>{let s=newCash(100);for(const card of cashDeck(100))s=sortCash(s,s.index,card.valid,s.index*250).state;assert.equal(s.amount,1_000_000);assert.equal(s.index,30);assert.equal(s.rejected,6);assert.equal(s.endedAt,7250);assert.equal(sortCash(s,30,true,9000).state,s);});
test('AD-4 fixed seeded target, finite bounds, miss marks and completed clock',()=>{for(let seed=1;seed<100;seed++)for(let i=0;i<12;i++){const t=stampTarget(seed,i);assert.ok(Math.abs(t.x)<.7&&Math.abs(t.y)<.6);assert.deepEqual(t,stampTarget(seed,i));}let s=newStamps(42,false);assert.equal(stamp(s,0,{x:NaN,y:0},0).state,s);assert.equal(stamp(s,0,{x:2,y:0},0).state,s);s=beginStamps(s,0);s=stamp(s,0,{x:1.1,y:1.1},250).state;assert.equal(s.index,0);assert.equal(s.misses,1);assert.equal(s.marks.length,1);for(let i=0;i<12;i++){const prev=s;s=stamp(s,i,stampTarget(42,i),500+i*250).state;assert.equal(prev.index,i);assert.equal(s.index,i+1);assert.equal(stamp(s,i,stampTarget(42,i),9000).state,s);}assert.equal(s.endedAt,3250);assert.equal(s.startedAt,0);assert.equal(s.misses,1);assert.equal(stamp(s,12,{x:0,y:0},5000).state,s);});
test('AD-4 practice is uncounted; its stale pointer cannot stamp the first real document',()=>{const initial=newStamps(3);const p=stamp(initial,-1,stampTarget(3,0),200);assert.equal(p.kind,'practice');assert.equal(p.state.index,0);assert.equal(p.state.practice,false);assert.equal(p.state.startedAt,null);assert.equal(stamp(p.state,0,stampTarget(3,0),250).kind,'ignored');assert.equal(stamp(p.state,-1,stampTarget(3,0),1000).state,p.state);});
test('AD-3 actual visible anchors and occlusion drive objective and funny captions',()=>{assert.equal(gradePhoto('pigeons',['bird0','bird2'],5).stars,2);assert.equal(gradePhoto('pigeons',['bird0','bird1','bird2'],5).stars,3);assert.match(gradePhoto('backdrop',['board'],5,true).caption,/背景出席/);assert.equal(gradePhoto('umbrella',['feet','head','umbrella'],5).stars,3);assert.match(gradePhoto('umbrella',['feet'],5).caption,/兩隻鞋/);assert.equal(photoPose('pigeons',0,1).birds.filter(x=>x>0).length,0);assert.equal(photoPose('pigeons',6,1).birds.filter(x=>x>0).length,3);assert.ok(photoPose('umbrella',5,1).lift>2);});
test('AD-2 foreground clock counts elapsed time, pauses, and never charges the background interval',()=>{let c={elapsed:0,last:null as number|null,running:true};c=tick(c,100);c=tick(c,450);assert.equal(c.elapsed,350);c=pause(c);c=tick(c,10000);assert.equal(c.elapsed,350);c=resume(c);c=tick(c,20000);c=tick(c,20100);assert.equal(c.elapsed,450);assert.equal(tick(c,NaN),c);});
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
test('AD-2 an input timestamp ahead of a queued render cannot double count foreground time',()=>{
  let clock={elapsed:0,last:100,running:true};clock=tick(clock,350) as typeof clock;
  assert.equal(tick(clock,330),clock);clock=tick(clock,400) as typeof clock;assert.equal(clock.elapsed,300);
});
test('AD-7 bounded guest draft survives reload, reads are pure, and stale clearing cannot delete a newer result',()=>{const s=storage(),now=Date.now(),draft={version:1 as const,createdAt:now,game:'photo' as const,seed:7,title:'這張能交嗎？',text:'真的拍到了。',image:'data:image/jpeg;base64,YWJjZA=='};saveGameDraft(s,draft,now);const before=s.getItem(GAME_HANDOFF_KEY);assert.deepEqual(readGameDraft(s,now),draft);assert.equal(s.getItem(GAME_HANDOFF_KEY),before);clearGameDraft(s,now-1);assert.equal(s.getItem(GAME_HANDOFF_KEY),before);clearGameDraft(s,now);assert.equal(readGameDraft(s,now),null);});
test('AD-7 malformed, expired, future, oversized and unavailable storage cannot falsely succeed',()=>{const now=Date.now(),draft={version:1,createdAt:now,game:'cash',seed:7,title:'盤點',text:'道具鈔',image:'data:image/jpeg;base64,YWJjZA=='};for(const changed of [{version:2},{createdAt:now-HANDOFF_TTL-1},{createdAt:now+61000},{seed:NaN},{seed:0},{image:'data:text/html;base64,AAAA'},{title:''},{text:'x'.repeat(2001)}])assert.equal(parseGameDraft(JSON.stringify({...draft,...changed}),now),null);assert.equal(parseGameDraft('{bad',now),null);assert.equal(readGameDraft({getItem(){throw Error('denied');},setItem(){},removeItem(){}},now),null);assert.throws(()=>saveGameDraft({getItem(){return null;},setItem(){throw Error('quota');},removeItem(){}},draft as any,now),/quota/);});

import {CATEGORIES,RECIPES,recipeOf,recipeSearch,TECHNIQUES} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {actCooking,advanceCooking,cookingProgress,cookingScore,currentStep,cutGuide,newCookingRun,parseCookingRun,plateTarget,type CookingRun,type CookingAction} from '../../apps/portal-web/src/games/cooking/domain.js';
import {COOKBOOK_KEY,COOKBOOK_BACKUP,COOKING_RUN_KEY,RUN_TTL,emptyCookbook,parseCookbook,readCookbook,updateCookbook,readCookingRun,saveCookingRun,clearCookingRun} from '../../apps/portal-web/src/games/cooking/storage.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {PARTY_GAMES,PARTY_RULES as PT,partyOf} from '../../apps/portal-web/src/games/party/catalog.js';
import {actParty,advanceParty,chairWave,holidayTargets,newParty,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition,type PartyRun,type ChairRun,type TofuRun,type HolidayRun} from '../../apps/portal-web/src/games/party/domain.js';
import {ART_FRAMES} from '../../apps/portal-web/src/games/cooking/FoodArt.js';
import {ART_CLIPS} from '../../apps/portal-web/src/games/cooking/art-clips.js';
import {GAME_SHARE_PLATFORMS,gameShareText,gameSocialLink} from '../../apps/portal-web/src/games/result-share.js';

test('CK-6: all result kinds encode social handoffs as text/link intents without credentials or publish instructions',()=>{
  for(const game of ['photo','stamp','cash','kitchen'] as const){const link=`https://example.org/play?game=${game}&seed=42${game==='kitchen'?'&recipe=egg-fried-rice':''}`,result={game,title:'黃金蛋炒飯 & <作品>',caption:'這局真的很香！',details:'3 顆星 · 99 分',seed:42,image:'data:image/jpeg;base64,YWJjZA=='};const text=gameShareText(result,link);
    assert.ok(text.includes(link));assert.ok(text.includes(result.details));
    for(const platform of GAME_SHARE_PLATFORMS){const u=new URL(gameSocialLink(platform.id,link,text));assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');if(platform.id==='facebook'){assert.equal(u.searchParams.get('u'),link);assert.equal(u.searchParams.get('text'),null);}else if(platform.id==='instagram'){assert.equal(u.origin,'https://www.instagram.com');assert.equal(u.search,'');}else assert.equal(u.searchParams.get('text'),text);}
  }
});

test('CK-7: a failed favorite write survives completion against an older valid primary, then retries with fresh score maxima',()=>{
  const base=storage(),now=Date.now(),r=cook('egg-fried-rice').run;let saved=updateCookbook(base,emptyCookbook(),{kind:'complete',run:r},now);
  const denied={...base,setItem(){throw Error('quota');}};saved=updateCookbook(denied,saved.book,{kind:'favorite',id:'rice-balls'},now+1);assert.equal(saved.available,false);assert.deepEqual(saved.book.favorites,['rice-balls']);
  saved=updateCookbook(base,saved.book,{kind:'complete',run:cook('rice-balls').run},now+2,true);assert.equal(saved.available,true);assert.deepEqual(readCookbook(base,now+2).book.favorites,['rice-balls']);assert.equal(Object.keys(saved.book.best).length,2);
});

test('CK-2: all 64 image owners bind to real transparent atlases, measured frames and bounded delivery bytes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/cooking-art.json',import.meta.url),'utf8'));assert.equal(manifest.assets.length,8);let bytes=0;
  for(const c of CATEGORIES){const entry=manifest.assets.find((a:{category:string})=>a.category===c.id);const raw=await readFile(new URL(`../../${entry.file}`,import.meta.url)),info=await sharp(raw).metadata();assert.deepEqual([info.width,info.height],[1600,800]);assert.equal(info.hasAlpha,true);assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);assert.equal(raw.length,entry.bytes);bytes+=raw.length;assert.deepEqual(ART_FRAMES[c.id],entry.frames);assert.equal(ART_CLIPS[c.id].length,8);for(const [x,y,w,h] of ART_FRAMES[c.id])assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=1600&&y+h<=800);for(const clip of ART_CLIPS[c.id])assert.match(clip,/^M[0-9 LHV]+Z$/);}
  assert.ok(bytes<=2.5*1024*1024);
});

test('CK-3: 64 original recipes have eight complete categories, unique art identities and real operation plans',()=>{
  assert.equal(RECIPES.length,64);assert.equal(new Set(RECIPES.map(r=>r.id)).size,64);assert.equal(new Set(RECIPES.map(r=>`${r.category}/${r.art}`)).size,64);
  for(const c of CATEGORIES)assert.equal(RECIPES.filter(r=>r.category===c.id).length,8);
  for(const r of RECIPES){assert.ok(r.steps.length>=3&&r.steps.length<=4);assert.ok(r.ingredients.length>=3);assert.ok(r.estimatedSeconds>=20);assert.ok(r.art>=0&&r.art<8);assert.equal(recipeOf(r.id),r);assert.ok(r.steps.every(s=>TECHNIQUES[s.kind]));}
  assert.deepEqual([...new Set(RECIPES.flatMap(r=>r.steps.map(s=>s.kind)))].sort(),Object.keys(TECHNIQUES).sort());assert.ok(recipeSearch(recipeOf('strawberry-cake')!,'草莓 烘烤'));assert.equal(recipeSearch(RECIPES[0],'不存在的食材'),false);assert.equal(recipeOf('__proto__'),null);
});
function cook(recipeId:string){let run=newCookingRun(recipeOf(recipeId)!,42,`run_${recipeId}`),now=0;const send=(action:Omit<CookingAction,'step'>)=>{now+=150;run=actCooking(run,{...action,step:run.step} as CookingAction,now);};send({kind:'start'});
  let guard=0;while(run.status!=='done'&&guard++<2000){if(run.status==='step-result'){send({kind:'next'});continue;}const s=currentStep(run),a=run.active;
    if(s.kind==='slice'){const x=cutGuide(run);send({kind:'cut',x1:x,y1:.23,x2:x,y2:.78} as CookingAction);}
    if(s.kind==='mix'){for(let i=0;i<=48&&run.status==='playing';i++){const angle=i*Math.PI/12;now+=35;run=actCooking(run,{kind:'stir',step:run.step,x:.5+.3*Math.cos(angle),y:.52+.3*Math.sin(angle)},now);}}
    if(s.kind==='knead'){send({kind:'hold-start'});now+=s.holdMs;run=actCooking(run,{kind:'hold-end',step:run.step},now);}
    if(['pan','boil','bake'].includes(s.kind)){send({kind:'heat',value:s.heat} as CookingAction);now+=100;run=advanceCooking(run,now);if(s.kind==='pan'&&run.active.amount>.5&&!run.active.flipped)send({kind:'flip'});if(s.kind==='boil'&&run.active.foam>=.2)send({kind:'skim'});if(s.kind==='bake'&&run.active.amount>=.79)send({kind:'take-out'});}
    if(s.kind==='pour'){send({kind:'hold-start'});while(run.active.amount<s.target&&run.status==='playing'){now+=50;run=advanceCooking(run,now);}send({kind:'hold-end'});}
    if(s.kind==='fold')send({kind:'fold',index:a.count,direction:s.directions[a.count]} as CookingAction);
    if(s.kind==='plate')send({kind:'place',index:a.count,...plateTarget(run)} as CookingAction);
  }
  assert.equal(run.status,'done',recipeId);return {run,now};
}
test('CK-4/5: actual pointer coordinates, holds, heat and ordered gestures complete all 64 dishes once',()=>{
  for(const recipe of RECIPES){const {run,now}=cook(recipe.id);assert.equal(run.reports.length,recipe.steps.length);assert.ok(cookingScore(run)>=85,`${recipe.id}: ${cookingScore(run)}`);assert.equal(cookingProgress(run),1);assert.deepEqual(parseCookingRun(JSON.parse(JSON.stringify(run))),run);assert.deepEqual(actCooking(run,{kind:'next',step:run.step},now+100),run);assert.deepEqual(advanceCooking(run,now+99999),run);}
});
test('CK-5: wrong cut, stale step, rapid input, invalid coordinates and rewind cannot fabricate progress',()=>{
  let r=newCookingRun(RECIPES[0],42,'gesture_case');r=actCooking(r,{kind:'start',step:0},100);assert.equal(actCooking(r,{kind:'cut-key',step:1},200),r);assert.equal(actCooking(r,{kind:'cut-key',step:0},99),r);
  r=actCooking(r,{kind:'cut',step:0,x1:.2,y1:.5,x2:.8,y2:.5},300);assert.equal(r.active.count,0);assert.equal(r.active.mistakes,1);r=actCooking(r,{kind:'cut-key',step:0},500);const count=r.active.count;r=actCooking(r,{kind:'cut-key',step:0},510);assert.equal(r.active.count,count);
  for(const bad of [NaN,Infinity,-1,2]){const before=r.active.count;r=actCooking(r,{kind:'cut',step:0,x1:bad,y1:.1,x2:bad,y2:.8},700);assert.equal(r.active.count,before);}
});
test('CK-5/7: background time, cancelled holds, reversed mixing and out-of-bowl motion add no work',()=>{
  const dish=recipeOf('rice-balls')!;let r=newCookingRun(dish,42,'hold_case');r=actCooking(r,{kind:'start',step:0},0);const before=r.active.amount;
  for(let i=0;i<30;i++)r=actCooking(r,{kind:'stir',step:0,x:.5+.3*Math.cos(-i*.3),y:.52+.3*Math.sin(-i*.3)},i*20);assert.equal(r.active.amount,before);r=actCooking(r,{kind:'stir',step:0,x:1,y:1},700);assert.equal(r.active.angle,null);
  r=actCooking(r,{kind:'pause',step:0},750);const paused=JSON.stringify(r);assert.equal(JSON.stringify(advanceCooking(r,999999)),paused);r=actCooking(r,{kind:'resume',step:0},999999);assert.equal(r.elapsed,750);r=advanceCooking(r,1999999);assert.equal(r.elapsed,1000750);
  const knead=recipeOf('italian-meatballs')!;let k=newCookingRun(knead,42,'cancel_case');k={...k,step:2,status:'playing',reports:[{step:0,score:100,elapsed:0,mistakes:0},{step:1,score:100,elapsed:0,mistakes:0}],lastNow:0};k=actCooking(k,{kind:'hold-start',step:2},20);k=actCooking(k,{kind:'cancel',step:2},400);k=actCooking(k,{kind:'hold-end',step:2},800);assert.equal(k.active.count,0);
});
test('CK-5: flip and skimming are required; over-baking has a reachable low-score ending',()=>{
  const source=cook('egg-fried-rice').run;let r={...newCookingRun(RECIPES[0],42,'pan_case'),step:1,status:'playing' as const,lastNow:0,reports:[source.reports[0]]};r=actCooking(r,{kind:'heat',step:1,value:58},0) as typeof r;for(let t=500;t<=8500;t+=500)r=advanceCooking(r,t) as typeof r;assert.equal(r.status,'playing');assert.equal(r.active.amount>=1,true);r=actCooking(r,{kind:'flip',step:1},9000) as typeof r;assert.equal(r.status,'step-result');
  const recipe=recipeOf('chocolate-brownie')!;let b:CookingRun={...newCookingRun(recipe,42,'bake_case'),step:2,status:'playing',lastNow:0,reports:[{step:0,score:100,elapsed:0,mistakes:0},{step:1,score:100,elapsed:0,mistakes:0}]};for(let t=500;t<=12000&&b.status==='playing';t+=500)b=advanceCooking(b,t);assert.equal(b.status,'done');assert.ok(b.reports.at(-1)!.score<30);
});
test('CK-7: pure checkpoint reads restore a paused run; malformed, future and expired data fail closed',()=>{
  const s=storage(),now=Date.now();let r=newCookingRun(RECIPES[0],42,'checkpoint');r=actCooking(r,{kind:'start',step:0},1);r=actCooking(r,{kind:'cut-key',step:0},150);assert.equal(saveCookingRun(s,r,now),true);const raw=s.getItem(COOKING_RUN_KEY);const restored=readCookingRun(s,now).run!;assert.equal(restored.status,'paused');assert.equal(restored.active.count,1);assert.equal(s.getItem(COOKING_RUN_KEY),raw);clearCookingRun(s,'another-run');assert.equal(s.getItem(COOKING_RUN_KEY),raw);assert.equal(readCookingRun(s,now+RUN_TTL+1).run,null);
  for(const change of [{version:2},{step:99},{elapsed:Infinity},{status:'ready'},{reports:[]}])assert.equal(parseCookingRun({...cook('egg-fried-rice').run,...change}),null);
  s.setItem(COOKING_RUN_KEY,JSON.stringify({version:1,savedAt:now+61000,run:r}));assert.equal(readCookingRun(s,now).run,null);clearCookingRun(s,r.id);
});
test('CK-7: cookbook preserves best score, backs up only valid primary and recovers without any read-side writes',()=>{
  const s=storage(),now=Date.now(),first=cook('egg-fried-rice').run;let saved=updateCookbook(s,emptyCookbook(),{kind:'complete',run:first},now);assert.equal(saved.book.best[first.recipeId].score,cookingScore(first));saved=updateCookbook(s,saved.book,{kind:'favorite',id:first.recipeId},now);const good=s.getItem(COOKBOOK_BACKUP);assert.ok(good);
  const worse={...first,id:'other_run',reports:first.reports.map(r=>({...r,score:20}))};saved=updateCookbook(s,saved.book,{kind:'complete',run:worse},now);assert.equal(saved.book.best[first.recipeId].score,cookingScore(first));s.setItem(COOKBOOK_KEY,'{broken');const backup=s.getItem(COOKBOOK_BACKUP),read=readCookbook(s,now);assert.match(read.notice,/備份/);assert.equal(s.getItem(COOKBOOK_KEY),'{broken');assert.equal(s.getItem(COOKBOOK_BACKUP),backup);updateCookbook(s,read.book,{kind:'retry'},now);assert.equal(s.getItem(COOKBOOK_BACKUP),backup);
  for(const raw of ['{}','{broken',JSON.stringify({...saved.book,version:2}),JSON.stringify({...saved.book,favorites:['unknown']}),JSON.stringify({...saved.book,best:{unknown:{score:90}}})])assert.equal(parseCookbook(raw,now),null);
});
test('CK-7: denied/quota storage keeps a truthful in-memory book, with an explicit retry path',()=>{
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};assert.equal(readCookbook(denied).available,false);assert.equal(readCookingRun(denied).run,null);assert.equal(saveCookingRun(denied,newCookingRun(RECIPES[0],42,'denied')),false);const saved=updateCookbook(denied,emptyCookbook(),{kind:'complete',run:cook('egg-fried-rice').run});assert.equal(saved.available,false);assert.equal(Object.keys(saved.book.best).length,1);assert.match(saved.notice,/尚未保存/);
});
test('CK-6: cooking handoff remains bounded v1 and contains a recipe, never a publish command',()=>{
  const now=Date.now(),draft={version:1 as const,createdAt:now,game:'kitchen' as const,recipe:'egg-fried-rice',seed:42,title:'黃金蛋炒飯',text:'我的料理成果',image:'data:image/jpeg;base64,YWJjZA=='};assert.deepEqual(parseGameDraft(JSON.stringify({...draft,autoPublish:true}),now),draft);assert.equal(parseGameDraft(JSON.stringify({...draft,recipe:'../../private'}),now),null);assert.equal(parseGameDraft(JSON.stringify({...draft,recipe:undefined}),now),null);
});

function partyTime<T extends PartyRun>(initial:T,target:number):T {
  let s=initial;while(s.elapsed<target&&s.status==='playing')s=advanceParty(s,Math.min(100,target-s.elapsed)) as T;return s;
}
test('PT-1/2: three original catalogs and deterministic bounded clocks reject inactive and malformed time',()=>{
  assert.equal(PARTY_GAMES.length,3);assert.equal(partyOf('mario'),null);assert.equal(partyOf('tofu'),'tofu');
  assert.deepEqual(Array.from({length:22},(_,i)=>chairWave(42,i)),Array.from({length:22},(_,i)=>chairWave(42,i)));
  assert.notDeepEqual(chairWave(42,0),chairWave(43,0));
  for(const g of PARTY_GAMES){const ready=newParty(g.id,42);assert.equal(advanceParty(ready,500),ready);let s=startParty(ready);assert.equal(startParty(s),s);for(const d of [NaN,Infinity,-1,0])assert.equal(advanceParty(s,d),s);s=advanceParty(s,50000);assert.equal(s.elapsed,1000);const paused=pauseParty(s);assert.equal(advanceParty(paused,1000),paused);assert.equal(actParty(paused,{kind:'jump'}),paused);assert.equal(resumeParty(paused).status,'playing');}
});
test('PT-3: all 22 actual lane decisions collect tickets, avoid collisions and settle the same seeded course once',()=>{
  let s=startParty(newParty('chair',42)) as ChairRun;
  for(let i=0;i<PT.chairWaves;i++){
    const w=chairWave(42,i);assert.notEqual(w.lane,w.ticketLane);
    while(s.lane!==w.ticketLane){s=actParty(s,{kind:'lane',direction:w.ticketLane>s.lane?1:-1}) as ChairRun;s=partyTime(s,s.elapsed+140);}
    s=partyTime(s,w.at);assert.equal(s.lives,3);assert.equal(s.tickets,i+1);assert.equal(s.resolved,i+1);
  }
  s=partyTime(s,PT.chairMs);assert.equal(s.status,'done');assert.equal(s.score,4280);assert.equal(s.bestCombo,22);assert.equal(advanceParty(s,1000),s);assert.equal(actParty(s,{kind:'jump'}),s);
});
test('PT-3: collision uses arrival position, carts can be jumped, meeting tables cannot',()=>{
  const base=startParty(newParty('chair',42)) as ChairRun,w=chairWave(42,0);
  let late:ChairRun={...base,elapsed:w.at-1,resolved:0,lane:w.lane,x:w.lane};late=actParty(late,{kind:'lane',direction:w.lane===1?-1:1}) as ChairRun;
  assert.equal((advanceParty(late,30) as ChairRun).lives,2,'a new target lane cannot teleport across the collision');
  for(const kind of ['cart','meeting']){const i=Array.from({length:22},(_,j)=>j).find(j=>chairWave(42,j).kind===kind)!,wave=chairWave(42,i);let s:ChairRun={...base,elapsed:wave.at-400,resolved:i,lane:wave.lane,x:wave.lane};s=actParty(s,{kind:'jump'}) as ChairRun;assert.equal((advanceParty(s,400) as ChairRun).lives,kind==='cart'?3:2);}
  const locked=actParty(base,{kind:'lane',direction:1}) as ChairRun;assert.equal(actParty(locked,{kind:'lane',direction:-1}),locked);const jump=actParty(base,{kind:'jump'});assert.equal(actParty(jump,{kind:'jump'}),jump);
});
function tofuReady(s:TofuRun,perfect:boolean):TofuRun {
  const started=s.elapsed;while(s.status==='playing'&&s.elapsed-started<5000){const axis=tofuAxis(s),offset=Math.abs(tofuPosition(s)[axis]-s.layers[s.layers.length-1][axis]);if(perfect?offset<.06:offset>2.6)return s;s=advanceParty(s,5) as TofuRun;}throw Error('no reachable seeded tofu timing');
}
test('PT-4: twelve real timed drops build twelve immutable layers, with a single landing per fall',()=>{
  let s=startParty(newParty('tofu',42)) as TofuRun;
  for(let i=0;i<PT.tofuGoal;i++){s=tofuReady(s,true);const old=s;const falling=actParty(s,{kind:'drop'}) as TofuRun;assert.equal(actParty(falling,{kind:'drop'}),falling);assert.equal(falling.layers.length,i+1);s=advanceParty(falling,PT.tofuFallMs-1) as TofuRun;assert.equal(s.layers.length,i+1);s=advanceParty(s,1) as TofuRun;assert.equal(s.layers.length,i+2);assert.equal(old.layers.length,i+1);assert.equal(s.perfects,i+1);}
  assert.equal(s.status,'done');assert.equal(s.layers.length,13);assert.equal(s.score,2925);assert.equal(advanceParty(s,500),s);
});
test('PT-4: clipped overlap narrows the real tower and three misses end the game without extra layers',()=>{
  let s=startParty(newParty('tofu',42)) as TofuRun;
  for(let i=0;i<8&&s.status==='playing';i++){s=tofuReady(s,false);s=advanceParty(actParty(s,{kind:'drop'}),PT.tofuFallMs) as TofuRun;}
  assert.equal(s.status,'done');assert.equal(s.misses,3);assert.ok(s.layers.some(l=>l.width<1||l.depth<1));assert.ok(s.layers.every(l=>l.width>=PT.tofuMinimum&&l.depth>=PT.tofuMinimum));
});
test('PT-5: all twenty real target windows work, stale rounds and repeated holes never score twice',()=>{
  let s=startParty(newParty('holiday',42)) as HolidayRun;
  for(let i=0;i<20;i++){s=partyTime(s,i*PT.holidayRoundMs+PT.holidayOpenMs);const {good,boss}=holidayTargets(42,i);assert.notEqual(good,boss);const before=s;s=actParty(s,{kind:'pick',hole:good,round:i}) as HolidayRun;assert.equal(s.saved,i+1);assert.equal(actParty(s,{kind:'pick',hole:good,round:i}),s);assert.equal(actParty(s,{kind:'pick',hole:boss,round:i-1}),s);assert.equal(before.saved,i);}
  s=partyTime(s,PT.holidayMs);assert.equal(s.status,'done');assert.equal(s.score,5100);assert.equal(s.bestCombo,20);assert.equal(s.mistakes,0);
});
test('PT-5: missed windows, bosses and empty holes break combos with a nonnegative score floor',()=>{
  let s=startParty(newParty('holiday',42)) as HolidayRun;const {good,boss}=holidayTargets(42,0);assert.equal(actParty(s,{kind:'pick',hole:good,round:0}),s);s=partyTime(s,PT.holidayOpenMs);s=actParty(s,{kind:'pick',hole:good,round:0}) as HolidayRun;assert.equal(s.combo,1);s=actParty(s,{kind:'pick',hole:boss,round:0}) as HolidayRun;assert.equal(s.combo,0);assert.equal(s.score,40);const empty=Array.from({length:6},(_,i)=>i).filter(i=>i!==good&&i!==boss);for(const hole of empty)s=actParty(s,{kind:'pick',hole,round:0}) as HolidayRun;assert.equal(s.score,0);assert.equal(actParty(s,{kind:'pick',hole:NaN,round:0}),s);s=partyTime(s,1200+120);s=actParty(s,{kind:'pick',hole:holidayTargets(42,1).good,round:1}) as HolidayRun;assert.equal(s.combo,1);s=partyTime(s,3*1200);assert.equal(s.combo,0);
});
test('PT-7: party results extend the bounded v1 whitelist and strip untrusted publishing fields',()=>{
  const now=Date.now();for(const g of PARTY_GAMES){const draft={version:1,createdAt:now,game:g.id,seed:42,title:g.title,text:'本局 120 分',image:'data:image/jpeg;base64,YWJjZA=='};assert.deepEqual(parseGameDraft(JSON.stringify({...draft,recipe:'extra',autoPublish:true,score:999999}),now),draft);assert.equal(parseGameDraft(JSON.stringify({...draft,game:'../../private'}),now),null);}
});
test('PT-6: each tiny lobby preview binds to the actual procedural renderer, dimensions and immutable bytes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/party-art.json',import.meta.url),'utf8'));
  assert.equal(manifest.format,'freedom.party-art/v1');assert.equal(manifest.previews.length,3);assert.equal(createHash('sha256').update(await readFile(new URL(`../../${manifest.source}`,import.meta.url))).digest('hex'),manifest.source_sha256);
  let bytes=0;for(const g of PARTY_GAMES){const a=manifest.previews.find((p:{game:string})=>p.game===g.id);assert.ok(a);const raw=await readFile(new URL(`../../${a.path}`,import.meta.url)),info=await sharp(raw).metadata();assert.deepEqual([info.width,info.height],[640,480]);assert.equal(raw.length,a.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),a.sha256);bytes+=raw.length;}assert.ok(bytes<100000);
});
