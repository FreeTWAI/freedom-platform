import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {QUESTIONS_V2,DIMENSION_MAP_V2,DIMENSION_META_V2,RADAR_AXES_V2,CLASSES_V2,EXTRA_DATA_V2,CAREER_KEYS,CAREER_GUILDS,DIMENSIONS,calculateResult,lifestyleBaseline,validAnswer,completeAnswers,parseProgress,freshProgress,badges} from '../../modules/newbie-village/index.js';
import {skillBooksForGuild} from '../../modules/community/catalog.js';
const answers=QUESTIONS_V2.map(()=>[0]);
// Digest of the six tables extracted from the authorized source, independently
// compared byte-for-byte as parsed values before recording this fixture.
test('authorized source wording and score tables retain their exact snapshot',()=>{
  const digest=createHash('sha256').update(JSON.stringify([CLASSES_V2,EXTRA_DATA_V2,QUESTIONS_V2,DIMENSION_MAP_V2,DIMENSION_META_V2,RADAR_AXES_V2])).digest('hex');
  assert.equal(digest,'dbc9047a43e8a7839583974bdd47d54a6196c6e55a545e856ca4093a7f069300');
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
  const expected={content:1,automation:12,coach:4,visual:1,product:18,marketing:6,outsourcer:5,consultant:8};
  assert.deepEqual(r.scores,expected);
  for(const c of CAREER_KEYS)assert.equal(DIMENSIONS.reduce((sum,d)=>sum+r.scoresByDim[d][c],0),r.scores[c]);
  const one=QUESTIONS_V2.map(()=>[] as number[]);one[13]=[0,1];
  const multi=calculateResult(one);assert.equal(multi.scores.product,.7);assert.equal(multi.scores.automation,.7);assert.equal(multi.scores.content,.7);assert.equal(multi.scores.coach,.7);assert.equal(multi.scores.visual,.7);
  assert.equal(calculateResult([]).primary,'content');
  assert.deepEqual(calculateResult([]).dimensionWinners,{personality:'content',lifestyle:'content',capability:'content'});
  for(const [axis,n] of Object.entries(r.axes)){
    const total=Object.values(expected).reduce((a,b)=>a+b,0);
    const weighted=CAREER_KEYS.reduce((sum,c)=>sum+EXTRA_DATA_V2[c].traits[axis as keyof typeof EXTRA_DATA_V2.content.traits]*expected[c],0)/total;
    assert.equal(n,Math.round(Math.max(1,weighted)*2)/2);
  }
  assert.ok(lifestyleBaseline(answers).includes(QUESTIONS_V2[13].options[0].text));
});
test('every career maps to 1–2 existing catalog guild ids with definition-backed justification',()=>{
  assert.deepEqual(Object.keys(CAREER_GUILDS),CAREER_KEYS);
  const seed=readFileSync(new URL('../../migrations/002_positioning_guilds.sql',import.meta.url),'utf8');
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
});
test('module and page sources contain no network primitives or HTTP URLs',()=>{
  const root=new URL('../../modules/newbie-village/',import.meta.url);
  const files=readdirSync(root).filter(f=>/\.(ts|tsx|js|css)$/.test(f)).map(f=>new URL(f,root));
  files.push(new URL('../../apps/portal-web/src/modules/NewbieVillage.tsx',import.meta.url),new URL('../../apps/portal-web/src/modules/NewbieVillage.css',import.meta.url));
  for(const file of files)assert.doesNotMatch(readFileSync(file,'utf8'),/fetch|XMLHttpRequest|sendBeacon|https?:\/\//i,String(file));
});
