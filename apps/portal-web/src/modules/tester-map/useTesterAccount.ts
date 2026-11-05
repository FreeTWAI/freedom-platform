import {importGuestTesterProgress} from './import-progress';
import {useEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../../api';
import {emptyProgress,readTesterProgress,writeTesterProgress,resetTesterProgress,TESTER_PROGRESS_KEY,type TesterProgress} from '../../../../../modules/tester-map/index';
import type {TesterAccountView,TesterCommand} from '../../../../../modules/tester-map/account';

type Pending = {body: TesterCommand; key: string; version?: string};
export function useTesterAccount(client?: PortalClient) {
  const [progress,setProgress] = useState<TesterProgress>(() => client ? emptyProgress() : readTesterProgress());
  const [view,setView] = useState<TesterAccountView|null>(null), [busy,setBusy] = useState(Boolean(client));
  const [error,setError] = useState<'error'|'conflict'|null>(null);
  const live = useRef(false), generation = useRef(client?.sessionGeneration), pending = useRef<Pending|null>(null), inFlight=useRef(false);
  const current = () => live.current && generation.current === client?.sessionGeneration;
  const load = async () => {
    if (!client) return;
    const next = await client.get<TesterAccountView>('/me/tester-map',{suppressConsole:true});
    if (current()) {setView(next);setProgress(next.progress);}
  };
  const run = async () => {
    if (!client || !pending.current || inFlight.current || !current()) return;
    inFlight.current=true;setBusy(true);setError(null);
    const operation=pending.current;
    try {
      if(operation.body.action==='merge')await importGuestTesterProgress(client);
      else await client.post('/me/tester-map',operation.body,{idempotencyKey:operation.key,ifMatch:operation.version,suppressConsole:true});
      if (!current()) return;
      await load();
      if (current()) {pending.current=null;return true;}
    } catch (cause) {
      if (current()) {
        if(cause instanceof ApiError && cause.definitiveResponse && [400,403,412,422,428,409].includes(cause.status)) {
          pending.current=null;setError('conflict');
        } else setError('error');
      }
    } finally {inFlight.current=false;if(current())setBusy(false);}
  };
  useEffect(() => {
    live.current=true;generation.current=client?.sessionGeneration;
    if(client) {const local=readTesterProgress();pending.current={body:{action:'merge',group:local.group,done:[...local.done]},key:crypto.randomUUID()};void run();}
    else {
      const sync=(event:StorageEvent) => {if(event.key===TESTER_PROGRESS_KEY || event.key===null)setProgress(readTesterProgress());};
      window.addEventListener('storage',sync);
      return () => {live.current=false;window.removeEventListener('storage',sync);};
    }
    return () => {live.current=false;};
  },[client]);
  const mutate = (body: TesterCommand) => {
    if (busy || error || pending.current || !view) return;
    pending.current={body,key:crypto.randomUUID(),version:view.version};return run();
  };
  const save = async (next: TesterProgress) => {
    if(client) return Boolean(await mutate({action:'progress',group:next.group,done:[...next.done]}));
    else {setProgress(next);writeTesterProgress(next);return true;}
  };
  const reset = async () => {
    if(client)return Boolean(await mutate({action:'clear'}));
    else {resetTesterProgress();setProgress(emptyProgress());return true;}
  };
  const reload=async()=>{setBusy(true);try{await load();if(current())setError(null);}catch{if(current())setError('conflict');}finally{if(current())setBusy(false);}};
  return {progress,save,reset,view,busy:busy||Boolean(error),working:busy,error,retry:run,reload,mutate};
}
export type TesterAccount = ReturnType<typeof useTesterAccount>;
