import test from 'node:test';
import assert from 'node:assert/strict';
import {missionAck,missionView} from '../../apps/portal-web/src/modules/event-missions-client.js';
import {MISSION_TEMPLATES,chooseMissions} from '../../modules/event-missions/policy.js';
const view=()=>({policy:'personal_self_exercises_v1',version:2,enabled:true,editable:true,slots:chooseMissions(0).map((s,slot)=>({...s,slot,...MISSION_TEMPLATES.find(t=>t.id===s.template_id)!}))});
test('accepts bounded private projection and inaccessible redaction',()=>{assert.equal(missionView(view()),true);assert.equal(missionView({...view(),editable:false,slots:[]}),true);assert.equal(missionView({...view(),enabled:false,slots:[]}),true);});
test('rejects stale-shaped partial/duplicate/wrong-policy payloads',()=>{
 for(const v of [null,{}, {...view(),version:0},{...view(),slots:view().slots.slice(0,2)},{...view(),slots:[view().slots[0],view().slots[0],view().slots[2]]},{...view(),editable:false},{...view(),policy:'verified_attendance'}])assert.equal(missionView(v),false);
});
test('only exact event/action/key ACK settles unknown command',()=>{
 const ack={acknowledged:true,event_id:'event',action:'clear',command_key:'command'};
 assert.equal(missionAck(ack,'event',{action:'clear'},'command'),true);
 for(const changed of [{event_id:'other'},{action:'start'},{command_key:'other'},{acknowledged:false}])assert.equal(missionAck({...ack,...changed},'event',{action:'clear'},'command'),false);
 assert.equal(missionAck({version:3},'event',{action:'clear'},'command'),false);
});
