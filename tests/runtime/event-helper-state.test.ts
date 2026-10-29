import test from 'node:test';
import assert from 'node:assert/strict';
import {nextEventHelperState,type EventHelperState,type EventHelperAction} from '../../modules/community/event-helper-state.js';
const states:(EventHelperState|null)[]=[null,'applied','accepted','declined','withdrawn'];
const actions:EventHelperAction[]=['offer','withdraw','accept','decline'];
const allowed:Record<string,EventHelperState>={'null/offer':'applied','withdrawn/offer':'applied','applied/withdraw':'withdrawn','accepted/withdraw':'withdrawn','applied/accept':'accepted','applied/decline':'declined'};
for(const state of states)for(const action of actions)test(`helper transition ${state}/${action}`,()=>{
  const next=allowed[`${state}/${action}`];
  if(next)assert.equal(nextEventHelperState(state,action),next);
  else assert.throws(()=>nextEventHelperState(state,action),(e:any)=>e.status===409&&e.code==='helper_state_conflict');
});
test('unknown action never coerces to withdrawal or approval',()=>{
  for(const action of ['join','approve','',null,{},true])assert.throws(()=>nextEventHelperState('applied',action as EventHelperAction));
});
