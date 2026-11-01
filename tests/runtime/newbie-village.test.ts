import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {QUESTIONS_V2,DIMENSION_MAP_V2,DIMENSION_META_V2,RADAR_AXES_V2,CLASSES_V2,EXTRA_DATA_V2,CAREER_KEYS,CAREER_GUILDS,DIMENSIONS,directionDraft,DIRECTION_DRAFT_BASE_URL,calculateResult,lifestyleBaseline,validAnswer,completeAnswers,parseProgress,freshProgress,badges} from '../../modules/newbie-village/index.js';
import {skillBooksForGuild} from '../../modules/community/catalog.js';
const answers=QUESTIONS_V2.map(()=>[0]);
// Digest of the six tables after the 18-guild extension (original 15 questions, original
// option order and wording kept; 11 careers, added options and rebalanced weights added).
// Any change to wording or weights must update this fixture deliberately.
test('extended wording and score tables retain their recorded snapshot',()=>{
  const digest=createHash('sha256').update(JSON.stringify([CLASSES_V2,EXTRA_DATA_V2,QUESTIONS_V2,DIMENSION_MAP_V2,DIMENSION_META_V2,RADAR_AXES_V2])).digest('hex');
  assert.equal(digest,'82089b3cb5e0c119d276f557d66aaf1bcaca6a9564d1aa78726b05079cc4af5d');
});
test('original 8 careers, question wording and option order are preserved for stored answers',()=>{
  assert.deepEqual(CAREER_KEYS.slice(0,8),['content','automation','coach','visual','product','marketing','outsourcer','consultant']);
  assert.equal(CAREER_KEYS.length,19);
  assert.equal(QUESTIONS_V2[0].q,'週六下午空三小時，你最想做？');
  assert.deepEqual(QUESTIONS_V2[0].options.slice(0,4).map(o=>o.text),['寫個腳本解掉一個煩人的重複動作','把這週的靈感剪成一支短片','寫一篇把某個觀念講清楚的長文','約個剛認識的前輩喝咖啡']);
  assert.equal(QUESTIONS_V2[14].options[4].text,'養一個作品庫，作品自己帶客戶來');
});
test('random-answer simulation: every career is top 2%–15% of the time',()=>{
  let seed=20261025;const rnd=()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296};
  const N=20000,top=Object.fromEntries(CAREER_KEYS.map(k=>[k,0])) as Record<string,number>;
  for(let n=0;n<N;n++){
    const a=QUESTIONS_V2.map(q=>{const x=Math.floor(rnd()*q.options.length);if(!q.multi||rnd()<.5)return [x];let y;do y=Math.floor(rnd()*q.options.length);while(y===x);return [x,y]});
    top[calculateResult(a).primary]++;
  }
  for(const c of CAREER_KEYS){const share=top[c]/N;assert.ok(share>=.02&&share<=.15,`${c} ${share}`)}
});
test('every career is reachable as primary by a consistent answer pattern',()=>{
  for(const c of CAREER_KEYS){
    const a=QUESTIONS_V2.map(q=>{let best=0,gap=-Infinity;q.options.forEach((o,i)=>{const mine=o.scores[c]??0,other=Math.max(0,...Object.entries(o.scores).filter(([k])=>k!==c).map(([,v])=>v as number));if(mine-other>gap){gap=mine-other;best=i}});return [best]});
    assert.equal(calculateResult(a).primary,c);
  }
});
test('15 original questions have valid dimensions, options and career score keys',()=>{
  assert.equal(QUESTIONS_V2.length,15);
  assert.equal(Object.keys(DIMENSION_MAP_V2).length,15);
  QUESTIONS_V2.forEach((q,i)=>{
    assert.ok(q.q.trim());assert.ok(DIMENSIONS.includes(DIMENSION_MAP_V2[i]));assert.ok(q.options.length>=3);
    q.options.forEach(o=>{assert.ok(o.text);assert.ok(Object.keys(o.scores).length);for(const [key,n] of Object.entries(o.scores)){assert.ok(CAREER_KEYS.includes(key as never));assert.ok(Number.isFinite(n)&&n>0)}});
    assert.equal(q.multi??false,i===13);if(q.multi)assert.equal(q.maxSelect,2);
  });
  assert.ok(completeAnswers(answers));assert.ok(!completeAnswers(answers.slice(0,14)));
  assert.ok(!validAnswer([0,0],13));assert.ok(!validAnswer([0,1],0));assert.ok(!validAnswer([99],0));
});
test('deterministic scores, independent dimensions and original multi-select 0.7 weighting',()=>{
  const r=calculateResult(answers);assert.deepEqual(r,calculateResult(answers));
  const expected={"content":1,"automation":16,"coach":5,"visual":1,"product":15,"marketing":10,"outsourcer":7,"consultant":9,"video":3,"music":5,"stage":0,"host":6,"researcher":3,"engineer":17,"security":8,"broker":7,"shopkeeper":12,"maker":0,"accountant":8};
  assert.deepEqual(r.scores,expected);
  for(const c of CAREER_KEYS)assert.equal(DIMENSIONS.reduce((sum,d)=>sum+r.scoresByDim[d][c],0),r.scores[c]);
  const one=QUESTIONS_V2.map(()=>[] as number[]);one[13]=[0,1];
  const multi=calculateResult(one);assert.equal(multi.scores.product,.7);assert.ok(Math.abs(multi.scores.automation-2.1)<1e-9);assert.equal(multi.scores.content,.7);assert.equal(multi.scores.coach,.7);assert.equal(multi.scores.visual,.7);assert.ok(Math.abs(multi.scores.music-2.1)<1e-9);
  assert.equal(calculateResult([]).primary,'content');
  assert.deepEqual(calculateResult([]).dimensionWinners,{personality:'content',lifestyle:'content',capability:'content'});
  for(const [axis,n] of Object.entries(r.axes)){
    const total=Object.values(expected).reduce((a,b)=>a+b,0);
    const weighted=CAREER_KEYS.reduce((sum,c)=>sum+EXTRA_DATA_V2[c].traits[axis as keyof typeof EXTRA_DATA_V2.content.traits]*expected[c],0)/total;
    assert.equal(n,Math.round(Math.max(1,weighted)*2)/2);
  }
  assert.ok(lifestyleBaseline(answers).includes(QUESTIONS_V2[13].options[0].text));
});
test('every career maps to 1–2 existing catalog guild ids with definition-backed justification, covering all 18 guilds',()=>{
  assert.deepEqual(Object.keys(CAREER_GUILDS),CAREER_KEYS);
  const seed=['002_positioning_guilds','009_specialist_guilds','020_creative_guilds'].map(f=>readFileSync(new URL(`../../migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
  const guilds=new Set(Object.values(CAREER_GUILDS).flat().map(g=>g.guildId));assert.equal(guilds.size,18);
  for(const c of CAREER_KEYS)for(const k of ['tech','creative','sales','discipline','vision','network'] as const)assert.ok(Number.isFinite(EXTRA_DATA_V2[c].traits[k]));
  for(const c of CAREER_KEYS){assert.ok(CAREER_KEYS.includes(EXTRA_DATA_V2[c].ally.key as never));assert.ok(CAREER_KEYS.includes(EXTRA_DATA_V2[c].rival.key as never));}
  for(const c of CAREER_KEYS){
    assert.ok(CLASSES_V2[c].name);assert.ok(EXTRA_DATA_V2[c].dayInLife.length);assert.equal(EXTRA_DATA_V2[c].monthPlan.length,4);assert.ok(EXTRA_DATA_V2[c].painPoints.length);
    assert.ok(CAREER_GUILDS[c].length>=1&&CAREER_GUILDS[c].length<=2);
    for(const g of CAREER_GUILDS[c]){assert.ok(skillBooksForGuild(g.guildId).length>0);assert.ok(seed.includes(`'${g.guildId}'`));assert.ok(g.justification.includes('公會定義'));assert.ok(seed.includes(g.justification.split('「')[1].split('」')[0]));}
  }
});
test('local progress rejects malformed storage and preserves valid answers, drafts and badges',()=>{
  for(const raw of [null,'bad','null','{"version":2}','x'.repeat(50001)])assert.deepEqual(parseProgress(raw),freshProgress());
  const p={...freshProgress(),answers,done:['framework','quiz','card','guild','checkin'] as const,baseline:'生活底線',action:'小實驗',checkin:'證據'};
  const restored=parseProgress(JSON.stringify(p));assert.deepEqual(restored,p);assert.equal(badges(restored).length,5);
  assert.deepEqual(parseProgress('{"version":1,"done":["quiz","unknown"],"answers":[[999]]}').done,[]);
  // Preserve the useful long-draft round trip without a profile/login/width matrix.
  const longText=('合成草稿 🌱\nhttps://example.invalid/'+'a'.repeat(180)+'\n').repeat(20).slice(0,4000);
  const longProgress={...p,baseline:longText,action:longText,checkin:longText};
  const longRestored=parseProgress(JSON.stringify(longProgress));
  assert.deepEqual(longRestored,longProgress);
  const draft=directionDraft({...calculateResult(longRestored.answers),baseline:longRestored.baseline,action:longRestored.action,checkin:longRestored.checkin});
  assert.ok(draft.includes('過生活底線：'+longText));
  assert.ok(draft.includes('第一週行動：'+longText));
  assert.ok(draft.includes('完成條件與回顧：'+longText));
});
test('module and page sources contain no network primitives or HTTP URLs',()=>{
  const root=new URL('../../modules/newbie-village/',import.meta.url);
  const files=readdirSync(root).filter(f=>/\.(ts|tsx|js|css)$/.test(f)).map(f=>new URL(f,root));
  files.push(new URL('../../apps/portal-web/src/modules/NewbieVillage.tsx',import.meta.url),new URL('../../apps/portal-web/src/modules/NewbieVillage.css',import.meta.url));
  for(const file of files){
    // Only this fixed URL declaration is allowed; draft links do not perform requests.
    const source=readFileSync(file,'utf8'),allowed="export const DIRECTION_DRAFT_BASE_URL='https://freetwai.com';";
    const checked=file.href===new URL('draft.ts',root).href?source.replace(allowed,''):source;
    assert.doesNotMatch(checked,/fetch|XMLHttpRequest|sendBeacon|https?:\/\//i,String(file));
  }
});
test('float regression: product and engineer both 12.4 resolve to product by original career order',()=>{
  const r=calculateResult([[4],[4],[1],[2],[2],[4],[0],[1],[0],[0],[3],[0],[4],[3,4],[4]]);
  assert.equal(r.scores.product,12.4);assert.equal(r.scores.engineer,12.4);
  assert.ok(CAREER_KEYS.indexOf('product')<CAREER_KEYS.indexOf('engineer'));
  assert.equal(r.primary,'product');
});
test('career and dimension ties use exact tenths and stable original order (seeded sweep)',()=>{
  let seed=20261026;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const exactWinner=(t:Record<string,number>)=>{const max=Math.max(...CAREER_KEYS.map(k=>t[k]));return CAREER_KEYS.find(k=>t[k]===max)};
  let careerTies=0,dimTies=0;
  for(let n=0;n<5000;n++){
    const answers=QUESTIONS_V2.map(q=>{const a=[Math.floor(rnd()*q.options.length)];if((q.maxSelect??1)>1&&rnd()<.5){const b=Math.floor(rnd()*q.options.length);if(b!==a[0])a.push(b)}return a});
    const total:Record<string,number>={},dims:Record<string,Record<string,number>>={};
    for(const k of CAREER_KEYS)total[k]=0;for(const d of DIMENSIONS){dims[d]={};for(const k of CAREER_KEYS)dims[d][k]=0}
    QUESTIONS_V2.forEach((q,i)=>{const w=answers[i].length>1?7:10;for(const j of answers[i])for(const [k,p] of Object.entries(q.options[j].scores)){total[k]+=p*w;dims[DIMENSION_MAP_V2[i]][k]+=p*w}});
    const r=calculateResult(answers);
    const maxT=Math.max(...Object.values(total));if(CAREER_KEYS.filter(k=>total[k]===maxT).length>1)careerTies++;
    assert.equal(r.primary,exactWinner(total));
    for(const d of DIMENSIONS){const m=Math.max(...Object.values(dims[d]));if(CAREER_KEYS.filter(k=>dims[d][k]===m).length>1)dimTies++;assert.equal(r.dimensionWinners[d],exactWinner(dims[d]))}
  }
  assert.ok(careerTies>0&&dimTies>0,`expected ties in sweep (career ${careerTies}, dimension ${dimTies})`);
});

test('direction draft preserves wording and inserts primary and secondary guild links before the disclaimer',()=>{
  assert.equal(DIRECTION_DRAFT_BASE_URL,'https://freetwai.com');
  const dimensionWinners={personality:'content',lifestyle:'coach',capability:'product'} as const;
  const draft=directionDraft({dimensionWinners,primary:'automation',baseline:'每週三小時',action:'完成小工具',checkin:'留下筆記'});
  assert.equal(draft,[
    '方向卡（本人選擇的草稿）',`做自己：${CLASSES_V2.content.name}`,`過生活：${CLASSES_V2.coach.name}`,`用強項：${CLASSES_V2.product.name}`,
    '過生活底線：每週三小時','第一週行動：完成小工具','完成條件與回顧：留下筆記',
    '主公會：AI 開發公會（https://freetwai.com/#guilds/guild_ai_vibe）',
    '副公會：AI 導入與驗證公會（https://freetwai.com/#guilds/guild_ai_field）',
    '公會僅供建議，由本人另行選擇。',
  ].join('\n'));
});
test('direction draft omits secondary guild for the single-guild content career',()=>{
  assert.equal(CAREER_GUILDS.content.length,1);
  const draft=directionDraft({...calculateResult([]),baseline:'',action:'',checkin:''});
  assert.ok(!draft.includes('副公會：'));
  assert.deepEqual(draft.split('\n').slice(-2),['主公會：成長與行銷公會（https://freetwai.com/#guilds/guild_marketing）','公會僅供建議，由本人另行選擇。']);
});

// Source/token contract only; actual cascade and interaction are covered in E2E.
test('newbie plain and secondary actions own a paired surface without overriding semantic variants',()=>{
  const css=readFileSync(new URL('../../apps/portal-web/src/modules/NewbieVillage.css',import.meta.url),'utf8');
  const selector='.newbie-village .btn:not(.btn-primary):not(.btn-danger):not(.btn-ghost)';
  const rule=css.slice(css.indexOf(selector)).match(/^[^{]+\{([^}]+)\}/)?.[1];
  assert.ok(css.includes(selector),'scope must include plain quiz actions and exclude semantic variants');
  assert.ok(rule);assert.match(rule,/color:\s*var\(--ink\)/);assert.match(rule,/background:\s*var\(--bg-elev\)/);
  assert.match(rule,/border:\s*1px solid var\(--line\)/);
  assert.ok(css.includes(selector+':hover:not(:disabled)'));
  assert.ok(css.includes(selector+':focus-visible'));
  assert.match(css,/outline:2px solid var\(--focus\)/);
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/NewbieVillage.tsx',import.meta.url),'utf8');
  const classes=[...source.matchAll(/className="(btn[^"]*)"/g)].map(m=>m[1]);
  assert.ok(classes.length>=11,'all workflow actions retain the scoped style contract');
  assert.ok(classes.includes('btn btn-small'),'plain next/result action must be covered');
  assert.ok(classes.every(value=>value==='btn btn-small'||value==='btn btn-secondary btn-small'));
});
test('all newbie appearance palettes pair readable text and focus with the actual surface tokens',async()=>{
  const {EXPERIENCE_PROFILES}=await import('../../apps/portal-web/src/experience-profiles.js');
  function tokens(file:string){
    const css=readFileSync(new URL(`../../apps/portal-web/src/${file}`,import.meta.url),'utf8');
    return Object.fromEntries([...css.matchAll(/(--(?:ink|bg-elev|focus))\s*:\s*(#[\da-fA-F]+)/g)].map(match=>[match[1],match[2]]));
  }
  function luminance(hex:string){
    const expanded=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;
    const rgb=[1,3,5].map(i=>parseInt(expanded.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  }
  function ratio(a:string,b:string){const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (values[1]+.05)/(values[0]+.05);}
  for(const profile of Object.values(EXPERIENCE_PROFILES)){
    const palette={...tokens('styles.css'),...tokens('rpg-theme.css'),...(profile.baseTheme!=='dark'?tokens('light-theme.css'):{}),...(profile.baseTheme==='versefolk'?tokens('versefolk-theme.css'):{}),...(profile.skin==='dragon'?tokens('dragon-theme.css'):{})};
    assert.ok(ratio(palette['--ink'],palette['--bg-elev'])>=4.5,profile.id+' text');
    assert.ok(ratio(palette['--focus'],palette['--bg-elev'])>=3,profile.id+' focus');
  }
});

import {resumeView,restoreVillage,villageText} from '../../modules/newbie-village/journey.js';
test('legacy progress resumes first unanswered question without changing answers or card',()=>{
  const progress={...freshProgress(),answers:QUESTIONS_V2.map((_,i)=>i<6?[0]:[]),baseline:'不可覆寫',action:'我的行動',checkin:'回顧'};
  const restored=restoreVillage(JSON.stringify(progress));
  assert.deepEqual(restored.progress,progress);
  assert.deepEqual(restored.view,{step:'overview',index:6,result:false});
  assert.deepEqual(parseProgress(JSON.stringify({...progress,journey:{step:'card',index:6,result:false}})),progress);
});
test('village cursor validates stored metadata and never shows results for incomplete answers',()=>{
  const p=freshProgress();
  assert.deepEqual(resumeView(p,{step:'outside',index:99,result:true}),{step:'overview',index:0,result:false});
  assert.deepEqual(resumeView(p,{step:'quiz',index:4,result:true}),{step:'quiz',index:4,result:false});
  assert.deepEqual(resumeView({...p,answers},{step:'quiz',index:14,result:true}),{step:'quiz',index:14,result:true});
  for(const raw of [null,'bad','null','x'.repeat(50001)])assert.deepEqual(restoreVillage(raw).progress,p);
  const restored=restoreVillage(JSON.stringify({...p,answers,journey:{step:'card',index:14,result:true}}));
  assert.deepEqual(restored.view,{step:'card',index:14,result:true});
  // Clearing does not resurrect data from older history entries; metadata is validated against current answers.
  assert.equal(resumeView(p,restored.view).result,false);
});
test('new village controls have all five language variants',()=>{
  for(const key of ['purpose','start','back','readFailed','clearFailed','clearConfirm','cancel','saveCard','saveCheckin'] as const){
    const values=['zh-Hant','en','ja','ko','es'].map(language=>villageText(language,key));
    assert.equal(new Set(values).size,5);
    assert.ok(values.every(value=>value.trim().length>0));
  }
});

// Source-level history integration: execute the real shell listener and module
// writer, not a copied router. Browser event ordering/rendering stays an E2E tier.
function villageHistoryHarness(){
  const compile=(file:string)=>transformSync(readFileSync(new URL(`../../apps/portal-web/src/${file}`,import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const app=compile('App.tsx'),marker=app.indexOf('const transition = messageHistoryTransition.current;');
  const start=app.lastIndexOf('const changed =',marker),end=app.indexOf('\n    };',marker);
  assert.ok(start>=0&&end>start,'actual shell history listener');
  const village=compile('modules/NewbieVillage.tsx'),writerStart=village.indexOf('function writeVillageView('),writerEnd=village.indexOf('\n}',writerStart);
  assert.ok(writerStart>=0&&writerEnd>writerStart,'actual village history writer');
  const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
  const initial={freedomNewbieView:{step:'overview',index:0,result:false},preserved:'presentation'};
  const location={href:'http://localhost/#newbie-village',hash:'#newbie-village',pathname:'/',search:''};
  const calls={guard:0,route:0,open:0,close:0,push:0,replace:0,after:0};
  const move=(hash:string)=>{location.hash=hash;location.href=`http://localhost/${hash}`};
  const history={state:clone(initial) as any,
    pushState(state:unknown){calls.push++;this.state=clone(state)},
    replaceState(state:unknown,_title:string,url?:string){calls.replace++;this.state=clone(state);if(url)move(new URL(url,location.href).hash)},
    go(){throw Error('unexpected legacy-chat traversal')},
  };
  let changed:(event:{type:string})=>void;
  const state={window:{location,history,dispatchEvent:(event:{type:string})=>changed(event)},HashChangeEvent:class{constructor(public type:string){}},HISTORY_KEY:'freedomNewbieView',
    messageLocation:{current:{href:location.href,state:history.state}},messageHistoryTransition:{current:null as null|{after:(()=>void)|null}},
    acceptedHash:{current:location.hash},allow:false,pageLeaveGuard:{current:(_hash:string)=>{calls.guard++;return state.allow}},
    isMessagesHistoryEntry:(value:any)=>value?.freedomMessagesOpen===true,isMessagesHash:(hash:string)=>hash.split('?')[0]==='#messages',
    setTab:()=>{calls.route++},setLocationHash:()=>{},setMessagesOpen:(open:boolean)=>{if(!open)calls.close++},
    launchpadEnabled:false,tabFromHash:()=>'',openMessages:()=>{calls.open++},
  };
  changed=runInNewContext(`${app.slice(start,end+7)};changed`,state);
  const write=runInNewContext(`${village.slice(writerStart,writerEnd+2)};writeVillageView`,state) as (view:{step:string;index:number;result:boolean},replace?:boolean)=>void;
  const event=(type='popstate')=>changed({type});
  const depart=(hash='#guilds')=>{move(hash);history.state=null;event();event('hashchange')};
  return {state,calls,history,write,event,depart,move,clone};
}

test('village metadata pushes/replaces update the shell cancellation snapshot without routing or private text',()=>{
  const h=villageHistoryHarness(),guild={step:'guild',index:0,result:false};
  h.write({step:'card',index:0,result:false});h.write(guild);
  assert.equal(h.calls.push,2);assert.equal(h.calls.route,0);assert.equal(h.calls.guard,0);
  assert.deepEqual(h.clone(h.state.messageLocation.current.state),{freedomNewbieView:guild,preserved:'presentation'});
  h.depart();assert.equal(h.state.window.location.hash,'#newbie-village');
  assert.deepEqual(h.history.state.freedomNewbieView,guild);assert.equal(h.calls.guard,1);assert.equal(h.calls.route,0);
  const quiz={step:'quiz',index:7,result:false};h.write(quiz,true);assert.equal(h.calls.push,2);
  h.depart();assert.deepEqual(h.history.state.freedomNewbieView,quiz);assert.equal(h.calls.guard,2);
});

test('genuine same-route Back updates the snapshot; accepted departure still routes once',()=>{
  const h=villageHistoryHarness();h.write({step:'guild',index:0,result:false});
  const older={freedomNewbieView:{step:'card',index:0,result:false},preserved:'older'};
  h.history.state=older;h.event();
  assert.equal(h.state.messageLocation.current.state,older);h.depart();assert.deepEqual(h.history.state,older);
  h.state.allow=true;h.depart();assert.equal(h.state.acceptedHash.current,'#guilds');assert.equal(h.calls.route,1);assert.equal(h.history.state,null);
});

test('same-href chat changes and pending history transitions keep their original branches',()=>{
  const h=villageHistoryHarness();h.history.state={...h.history.state,freedomMessagesOpen:true};h.event();
  assert.equal(h.calls.open,1);assert.equal(h.calls.route,1);
  h.state.messageHistoryTransition.current={after:()=>{h.calls.after++}};
  h.history.state={freedomNewbieView:{step:'card',index:0,result:false}};
  h.event('hashchange');assert.equal(h.calls.after,0);assert.equal(h.calls.route,1);
  h.event();assert.equal(h.calls.after,1);assert.equal(h.calls.route,2);assert.equal(h.calls.close,1);
  h.event('hashchange');assert.equal(h.calls.after,1);assert.equal(h.calls.route,2);assert.equal(h.calls.guard,0);
});
