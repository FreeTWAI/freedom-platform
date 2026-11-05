import {readFileSync,readdirSync} from 'node:fs';
import {TESTER_FEATURE_MODULES} from '../../modules/tester-map/ownership.js';
import {QUEST_STAGES,TESTER_AREAS} from '../../modules/tester-map/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTesterProgress,testerCommandSchema,aggregateTesterFeedback,testerFeatureSteps} from '../../modules/tester-map/account.js';
import {QUEST_STEP_IDS,testerMedals} from '../../modules/tester-map/index.js';
import {accountText} from '../../apps/portal-web/src/modules/tester-map/text.js';

test('account merge is an ordered union, idempotent across devices and derives the same medals',()=>{
  const [a,b,c]=QUEST_STEP_IDS;
  const local={group:'A' as const,done:[b,a,a]}, account={group:null,done:[c,b]};
  const merged=mergeTesterProgress(account,local);
  assert.deepEqual(merged,{group:'A',done:[a,b,c]});
  assert.deepEqual(mergeTesterProgress(merged,local),merged);
  assert.deepEqual(mergeTesterProgress(merged,{group:'B',done:[c]}),merged);
  assert.deepEqual(testerMedals(mergeTesterProgress(merged,local)),testerMedals(merged));
  assert.deepEqual(mergeTesterProgress(merged,{group:null,done:['unknown']}),merged);
});
test('strict commands accept only allowlisted steps and bounded one-line plain text, never caller identities or timestamps',()=>{
  const base={action:'feedback',step_id:QUEST_STEP_IDS[0],result:'problem',note:'  Button did not open  '};
  assert.equal(testerCommandSchema.parse(base).action,'feedback');
  assert.equal((testerCommandSchema.parse(base) as {note:string}).note,'Button did not open');
  for(const note of ['x'.repeat(201),'line\nbreak','line\rbreak','\t','\u0000','<script>','\u2028','\u202e'])assert.equal(testerCommandSchema.safeParse({...base,note}).success,false,JSON.stringify(note));
  for(const extra of [{user_id:'peer'},{updated_at:'2026-01-01'},{feature_id:'foreign'},{email:'private@example.test'}])assert.equal(testerCommandSchema.safeParse({...base,...extra}).success,false);
  for(const patch of [{result:'done'},{step_id:'unknown'}])assert.equal(testerCommandSchema.safeParse({...base,...patch}).success,false);
  assert.equal(testerCommandSchema.safeParse({...base,note:'字'.repeat(200)}).success,true);
  assert.equal(testerCommandSchema.safeParse({action:'merge',group:'F',done:[]}).success,false);
  assert.equal(testerCommandSchema.safeParse({action:'merge',group:null,done:['unknown']}).success,false);
});
test('aggregation counts each tester once per feature, uses latest step feedback, bounds issues and strips identities',()=>{
  const step=testerFeatureSteps[0], timestamp=(n:number)=>`2026-11-01T00:00:${String(n).padStart(2,'0')}Z`;
  const rows=Array.from({length:8},(_,n)=>({user_id:`tester-${n}`,step_id:step.step_id,result:'problem' as const,note:`issue ${n}`,updated_at:timestamp(n)}));
  const result=aggregateTesterFeedback([...rows,{...rows[0],result:'pass',note:'fixed',updated_at:timestamp(20)},rows[0]]);
  const feature=result.find(item=>item.feature_id===step.feature_id)!;
  assert.equal(feature.testers,8);assert.equal(feature.passed,1);assert.equal(feature.pass_rate,1/8);
  assert.equal(feature.issues.length,5);assert.equal(feature.issues[0].note,'issue 7');
  assert.doesNotMatch(JSON.stringify(result),/user_id|tester-0|fixed/);
  assert.equal(aggregateTesterFeedback([]).every(item=>item.testers===0&&item.pass_rate===null),true);
  const mapping=testerFeatureSteps.find(a=>testerFeatureSteps.some(b=>a.feature_id===b.feature_id&&a.step_id!==b.step_id));
  if(mapping){const other=testerFeatureSteps.find(b=>b.feature_id===mapping.feature_id&&b.step_id!==mapping.step_id)!;
    const multi=aggregateTesterFeedback([{user_id:'one',step_id:mapping.step_id,result:'pass',note:'',updated_at:timestamp(1)},{user_id:'one',step_id:other.step_id,result:'problem',note:'',updated_at:timestamp(2)}]).find(item=>item.feature_id===mapping.feature_id)!;
    assert.equal(multi.testers,1);assert.equal(multi.pass_rate,0);
  }
});
test('all account and feedback UI strings include the five interface languages',()=>{
  for(const [key,values] of Object.entries(accountText)){assert.equal(values.length,5,key);for(const value of values)assert.ok(value.trim(),key);}
});

test('each quest step explicitly maps every inventory feature to an existing module id',()=>{
 const walk=(root:string):string[]=>readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${root}/${entry.name}`):entry.name==='freedom.module.json'?[`${root}/${entry.name}`]:[]);
 const modules=new Set(['modules','packages','apps'].flatMap(walk).map(file=>JSON.parse(readFileSync(file,'utf8')).module_id));
 const features=new Set(TESTER_AREAS.flatMap(area=>area.features.map(feature=>feature.id)));
 for(const stage of QUEST_STAGES)for(const step of stage.steps){
   assert.ok(step.features.length,step.id);
   for(const feature of step.features){assert.ok(features.has(feature),feature);assert.ok(Object.hasOwn(TESTER_FEATURE_MODULES,feature),feature);assert.ok(modules.has(TESTER_FEATURE_MODULES[feature]),feature);}
 }
 assert.deepEqual(new Set(Object.keys(TESTER_FEATURE_MODULES)),new Set(testerFeatureSteps.map(item=>item.feature_id)));
});
