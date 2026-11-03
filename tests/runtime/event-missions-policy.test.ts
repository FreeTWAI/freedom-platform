import test from 'node:test';
import assert from 'node:assert/strict';
import {MISSION_TEMPLATES,chooseMissions,changeMission} from '../../modules/event-missions/policy.js';
for(let seed=0;seed<MISSION_TEMPLATES.length;seed++)test(`stable bounded three assignments seed ${seed}`,()=>{
 const slots=chooseMissions(seed);assert.equal(slots.length,3);assert.equal(new Set(slots.map(s=>s.template_id)).size,3);assert.deepEqual(chooseMissions(seed),slots);
 for(let slot=0;slot<3;slot++)for(let index=0;index<6;index++){
  const replaced=changeMission(slots,{action:'replace',slot},index);assert.equal(new Set(replaced.map(s=>s.template_id)).size,3);assert.ok(!slots.some(s=>s.template_id===replaced[slot].template_id));
  for(let other=0;other<3;other++)if(other!==slot)assert.deepEqual(replaced[other],slots[other]);
 }
});
test('self-reported completion and skip never mutate original or produce proof',()=>{
 const slots=chooseMissions(0),done=changeMission(slots,{action:'mark_done',slot:0},0),skipped=changeMission(done,{action:'skip',slot:1},0);
 assert.equal(slots[0].state,'active');assert.equal(done[0].state,'self_reported');assert.equal(skipped[1].state,'skipped');assert.deepEqual(Object.keys(done[0]).sort(),['state','template_id']);
});
test('out of range slots rejected',()=>{for(const slot of [-1,3,0.5,NaN])assert.throws(()=>changeMission(chooseMissions(0),{action:'skip',slot},0));});

test('unknown action does not silently become skipped',()=>{assert.throws(()=>changeMission(chooseMissions(0),{action:'approve',slot:0} as never,0));});
