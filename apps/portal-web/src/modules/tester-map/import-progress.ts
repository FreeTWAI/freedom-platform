import type {PortalClient} from '../../api';
import {readTesterProgress,resetTesterProgress,writeTesterProgress,type TesterProgress} from '../../../../../modules/tester-map/index';

type Import = {generation:number; snapshot:TesterProgress; key:string; done:boolean; flight?:Promise<void>};
const imports = new WeakMap<PortalClient,Import>();
/** Shared by login and the map: one immutable, retryable import per session lifetime. */
export function importGuestTesterProgress(client:PortalClient):Promise<void> {
  let entry=imports.get(client);
  if(!entry || entry.generation!==client.sessionGeneration) {
    entry={generation:client.sessionGeneration,snapshot:readTesterProgress(),key:crypto.randomUUID(),done:false};
    imports.set(client,entry);
  }
  const run=entry;
  if(run.done)return Promise.resolve();
  if(run.flight)return run.flight;
  run.flight=(async()=>{
    if(run.snapshot.done.length || run.snapshot.group) {
      await client.post('/me/tester-map',{action:'merge',group:run.snapshot.group,done:[...run.snapshot.done]},
        {idempotencyKey:run.key,suppressConsole:true});
      if(client.sessionGeneration!==run.generation)return;
      // Leave new guest-tab edits untouched; account records never enter this key.
      const current=readTesterProgress();
      const rest={group:current.group===run.snapshot.group?null:current.group,done:current.done.filter(id=>!run.snapshot.done.includes(id))};
      if(rest.done.length||rest.group)writeTesterProgress(rest);else resetTesterProgress();
    }
    if(client.sessionGeneration===run.generation)run.done=true;
  })().finally(()=>{run.flight=undefined;});
  return run.flight;
}
