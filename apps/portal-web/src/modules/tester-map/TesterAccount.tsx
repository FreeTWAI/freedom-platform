import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {useLanguage} from '../../language';
import type {PortalClient} from '../../api';
import {PageTools} from '../../PageTools';
import {TESTER_AREAS,type Localized,type QuestStep} from '../../../../../modules/tester-map/index';
import {testerNoteSchema} from '../../../../../modules/tester-map/account';
import type {TesterFeatureReport} from '../../../../../modules/tester-map/account';
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
  const [result,setResult]=useState<'pass'|'problem'>(saved?.result??'pass'),[note,setNote]=useState(saved?.note??'');
  useEffect(()=>{setResult(saved?.result??'pass');setNote(saved?.note??'');},[saved?.result,saved?.note,saved?.updated_at]);
  if(!context?.client)return null;
  const {account,client}=context;
  return <details className="stack"><summary>{pick(accountText.feedback)}</summary>
    <fieldset disabled={account.busy}><legend>{pick(accountText.feedback)}</legend>
      <label><input type="radio" name={`feedback-${step.id}`} checked={result==='pass'} onChange={()=>setResult('pass')}/>{pick(accountText.pass)}</label>
      <label><input type="radio" name={`feedback-${step.id}`} checked={result==='problem'} onChange={()=>setResult('problem')}/>{pick(accountText.problem)}</label>
      <label>{pick(accountText.note)}<input maxLength={200} value={note} onChange={event=>setNote(event.target.value)}/></label>
      <button type="button" className="btn btn-secondary btn-small" disabled={!testerNoteSchema.safeParse(note).success} onClick={()=>void account.mutate({action:'feedback',step_id:step.id,result,note})}>{pick(accountText.save)}</button>
    </fieldset>
    {saved&&<p role="status">{pick(accountText.saved)} · {pick(saved.result==='pass'?accountText.pass:accountText.problem)}{saved.note?` · ${saved.note}`:''}</p>}
    {saved?.result==='problem'&&<><p className="field-hint">{pick(accountText.privacy)}</p><PageTools pageId="tester-map" client={client} ideaDraft={{title:pick(step.title),body:`${step.id}\n${saved.note}\n\n${pick(step.check)}`,label:pick(accountText.publicIssue)}}/></>}
  </details>;
}
function TesterReport({client}:{client:PortalClient}) {
  const pick=useTesterText(), [features,setFeatures]=useState<TesterFeatureReport[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const [owner]=useState(client.sessionGeneration),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const load=async()=>{if(busy)return;setBusy(true);setError(false);try {const data=await client.get<{features:TesterFeatureReport[]}>('/tester-map/report',{suppressConsole:true});if(live.current&&owner===client.sessionGeneration)setFeatures(data.features);}catch{if(live.current&&owner===client.sessionGeneration){setFeatures(null);setError(true);}}finally{if(live.current&&owner===client.sessionGeneration)setBusy(false);}};
  if(owner!==client.sessionGeneration)return null;
  return <section className="card stack"><h3>{pick(accountText.report)}</h3><p className="field-hint">{pick(accountText.reportHelp)}</p>
    <button className="btn btn-secondary btn-small" type="button" disabled={busy} onClick={()=>void load()}>{pick(busy?accountText.busy:accountText.reload)}</button>
    {error&&<p role="alert">{pick(accountText.reportError)}</p>}
    {features&&<ul>{features.map(feature=>{
      const name=TESTER_AREAS.flatMap(area=>area.features).find(item=>item.id===feature.feature_id)?.name;
      return <li key={feature.feature_id}><strong>{name?pick(name):feature.feature_id}</strong><p>{pick(accountText.counts)}: {feature.testers} / {feature.pass_rate===null?'—':`${Math.round(feature.pass_rate*100)}%`}</p>
        <ul>{feature.issues.map((issue,index)=><li key={`${issue.step_id}-${index}`}><p>{issue.note||pick(accountText.problem)}</p><time>{new Date(issue.updated_at).toLocaleDateString()}</time><p className="field-hint">{pick(accountText.privacy)}</p><PageTools pageId="tester-map" client={client} ideaDraft={{title:name?pick(name):feature.feature_id,body:`${feature.feature_id} / ${issue.step_id}\n${issue.note}`,label:pick(accountText.publicIssue)}}/></li>)}</ul>
      </li>;
    })}</ul>}
  </section>;
}
