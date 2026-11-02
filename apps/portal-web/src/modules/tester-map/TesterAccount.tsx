import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {useLanguage} from '../../language';
import type {PortalClient} from '../../api';
import {PageTools} from '../../PageTools';
import {TESTER_AREAS,type Localized,type QuestStep} from '../../../../../modules/tester-map/index';
import {testerNoteSchema} from '../../../../../modules/tester-map/account';
import type {TesterModuleReport,TesterReportItem} from '../../../../../modules/tester-map/account';
import {accountText} from './text';
import type {TesterAccount} from './useTesterAccount';
const indexes = {'zh-Hant':0,en:1,ja:2,ko:3,es:4} as const;
export function useTesterText() {const {language}=useLanguage();return (value:Localized)=>value[indexes[language]];}
export const TesterAccountContext=createContext<{account:TesterAccount;client?:PortalClient}|null>(null);

export function TesterAccountPanel({account,client}:{account:TesterAccount;client?:PortalClient}) {
  const pick=useTesterText();
  return <div className="stack">
    <p className="banner banner-info">{pick(client?accountText.account:accountText.local)}</p>
    {account.working&&<p role="status">{pick(accountText.busy)}</p>}
    {account.error&&<div role="alert"><p>{pick(accountText[account.error])}</p><button className="btn btn-secondary btn-small" type="button" onClick={()=>void (account.error==='conflict'?account.reload():account.retry())}>{pick(account.error==='conflict'?accountText.reload:accountText.retry)}</button></div>}
    {client&&account.view?.can_report&&<TesterReport client={client}/>}
  </div>;
}
export function TesterStepFeedback({step}:{step:QuestStep}) {
  const context=useContext(TesterAccountContext), pick=useTesterText();
  const saved=context?.account.view?.feedback.find(item=>item.step_id===step.id);
  const [problem,setProblem]=useState(false),[note,setNote]=useState(saved?.note??''),[thanks,setThanks]=useState(false);
  useEffect(()=>{setNote(saved?.note??'');},[saved?.result,saved?.note,saved?.updated_at]);
  if(!context?.client)return null;
  const {account,client}=context;
  const send=async(result:'pass'|'problem')=>{if(await account.mutate({action:'feedback',step_id:step.id,result,note:result==='pass'?'':note})){setThanks(true);setProblem(false);}};
  return <div className="stack">
    <div className="actions" aria-label={pick(accountText.feedback)}>
      <button type="button" className="btn btn-secondary btn-small" disabled={account.busy} onClick={()=>void send('pass')}>{pick(accountText.pass)}</button>
      <button type="button" className="btn btn-secondary btn-small" disabled={account.busy} onClick={()=>{setProblem(true);setThanks(false);}}>{pick(accountText.problem)}</button>
    </div>
    <details className="stack" open={problem} onToggle={event=>setProblem(event.currentTarget.open)}><summary>{pick(accountText.feedback)}</summary>
      <fieldset disabled={account.busy}><legend>{pick(accountText.problem)}</legend>
        <label>{pick(accountText.note)}<input maxLength={200} value={note} onChange={event=>setNote(event.target.value)}/></label>
        <button type="button" className="btn btn-secondary btn-small" disabled={!testerNoteSchema.safeParse(note).success} onClick={()=>void send('problem')}>{pick(accountText.save)}</button>
      </fieldset>
    </details>
    {saved&&<p role="status"><span className="chip">{pick(accountText[saved.status??'sent'])}{saved.issue_number?` #${saved.issue_number}`:''}</span> · {pick(accountText.saved)} · {pick(saved.result==='pass'?accountText.pass:accountText.problem)}{saved.note?` · ${saved.note}`:''}</p>}
    {thanks&&<p role="status">{pick(accountText.thanks)}</p>}
    {saved?.result==='problem'&&<><p className="field-hint">{pick(accountText.privacy)}</p><PageTools pageId="tester-map" client={client} ideaDraft={{title:pick(step.title),body:`${step.id}\n${saved.note}\n\n${pick(step.check)}`,label:pick(accountText.publicIssue)}}/></>}
  </div>;
}
function TesterReport({client}:{client:PortalClient}) {
  const pick=useTesterText(), [modules,setModules]=useState<TesterModuleReport[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const [owner]=useState(client.sessionGeneration),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const load=async()=>{if(busy)return;setBusy(true);setError(false);try {const data=await client.get<{modules:TesterModuleReport[]}>('/tester-map/report',{suppressConsole:true});if(live.current&&owner===client.sessionGeneration)setModules(data.modules);}catch{if(live.current&&owner===client.sessionGeneration){setModules(null);setError(true);}}finally{if(live.current&&owner===client.sessionGeneration)setBusy(false);}};
  if(owner!==client.sessionGeneration)return null;
  return <section className="card stack" id="tester-builder-report"><h3>{pick(accountText.report)}</h3><p className="field-hint">{pick(accountText.reportHelp)}</p>
    <a className="btn btn-secondary btn-small" href="#tester-map" onClick={event=>{event.preventDefault();void load();document.getElementById('tester-builder-report')?.scrollIntoView({block:'start'});}}>{pick(accountText.report)}</a>
    <button className="btn btn-secondary btn-small" type="button" disabled={busy} onClick={()=>void load()}>{pick(busy?accountText.busy:accountText.reload)}</button>
    {error&&<p role="alert">{pick(accountText.reportError)}</p>}
    {modules?.map(module=><section key={module.module_id} data-report-module={module.module_id}><h4>{module.module_id}</h4>
      {module.features.map(feature=>{
        const name=TESTER_AREAS.flatMap(area=>area.features).find(item=>item.id===feature.feature_id)?.name;
        return <div key={feature.feature_id}><h5>{name?pick(name):feature.feature_id}</h5>
          <p>{pick(accountText.counts)}: {feature.testers} / {feature.pass_rate===null?'—':`${Math.round(feature.pass_rate*100)}%`}</p>
          {feature.steps?.map(step=><div key={step.step_id}><strong>{step.step_id}</strong><p>{pick(accountText.results)}: {step.passed} / {step.problems}</p>
            <ul>{step.items.map(item=><li key={item.feedback_id}><p>{pick(item.result==='pass'?accountText.pass:accountText.problem)}</p><p>{item.note}</p>
              <TesterTriage key={`${item.feedback_id}-${item.status}-${item.issue_number}`} client={client} item={item} reload={load}/>
              <p className="field-hint">{pick(accountText.privacy)}</p>
              <PageTools pageId="tester-map" client={client} ideaDraft={{title:name?pick(name):feature.feature_id,body:`${feature.feature_id} / ${step.step_id}\n${item.note}`,label:pick(accountText.publicIssue)}}/>
            </li>)}</ul>
          </div>)}
        </div>;
      })}
    </section>)}
  </section>;
}
function TesterTriage({client,item,reload}:{client:PortalClient;item:TesterReportItem;reload:()=>Promise<void>}) {
  const pick=useTesterText(),[status,setStatus]=useState<'seen'|'issue'|'fixed'>(item.status==='sent'?'seen':item.status),[issue,setIssue]=useState(item.issue_number?.toString()??'');
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),pending=useRef<{body:unknown;key:string}|null>(null);
  const live=useRef(true),owner=useRef(client.sessionGeneration);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const save=async()=>{
    if(busy)return;
    pending.current??={body:{feedback_id:item.feedback_id,status,issue_number:issue?Number(issue):null},key:crypto.randomUUID()};
    setBusy(true);setFailed(false);
    try {await client.post('/tester-map/report/triage',pending.current.body,{idempotencyKey:pending.current.key,suppressConsole:true});
      if(live.current&&owner.current===client.sessionGeneration){pending.current=null;await reload();}
    }catch{if(live.current&&owner.current===client.sessionGeneration)setFailed(true);}
    finally{if(live.current&&owner.current===client.sessionGeneration)setBusy(false);}
  };
  return <div className="stack"><span className="chip">{pick(accountText[item.status])}{item.issue_number?` #${item.issue_number}`:''}</span>
    <fieldset disabled={busy||Boolean(pending.current)}><legend>{pick(accountText.feedback)}</legend>
      <select aria-label={pick(accountText.feedback)} value={status} onChange={event=>setStatus(event.target.value as typeof status)}>{(['seen','issue','fixed'] as const).map(value=><option key={value} value={value}>{pick(accountText[value])}</option>)}</select>
      <label>{pick(accountText.issueNumber)}<input type="number" min="1" max="2147483647" value={issue} onChange={event=>setIssue(event.target.value)}/></label>
    </fieldset>
    <button className="btn btn-secondary btn-small" type="button" disabled={busy||(!pending.current&&((status==='issue'&&!issue)||(Boolean(issue)&&(!Number.isInteger(Number(issue))||Number(issue)<1||Number(issue)>2147483647))))} onClick={()=>void save()}>{pick(failed?accountText.retry:accountText.save)}</button>
    {failed&&<p role="alert">{pick(accountText.error)}</p>}
  </div>;
}
