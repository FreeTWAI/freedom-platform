import {useCallback,useEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {useModuleMutation} from './shared';
import type {GuildSummary} from './Onboarding';

export type GuildEntryQuestion={id:string;prompt:string;options:{id:string;label:string}[]};
type GuildAnswerItem={guild_key:string;name:string;question_set_version:string;outdated:boolean;answers:{question_id:string;prompt:string;option_id:string;label:string}[]|null;aggregate_version:number|null;updated_at:string|null};

export function GuildQuestionFields({questions,answers,onChange,disabled=false,namePrefix='guild-q'}:{questions:GuildEntryQuestion[];answers:Record<string,string>;onChange:(questionId:string,optionId:string)=>void;disabled?:boolean;namePrefix?:string}){
  return <>{questions.map(question=><fieldset className="guild-question" key={question.id} disabled={disabled}><legend>{question.prompt}</legend><div className="guild-question-options">{question.options.map(option=><label className={`guild-question-option${answers[question.id]===option.id?' is-selected':''}`} key={option.id}><input type="radio" name={`${namePrefix}-${question.id}`} value={option.id} checked={answers[question.id]===option.id} onChange={()=>onChange(question.id,option.id)}/><span>{option.label}</span></label>)}</div></fieldset>)}</>;
}

export function GuildAnswersSection({client,onRiskChange}:{client:PortalClient;onRiskChange?:(dirty:boolean,locked:boolean)=>void}){
  const [items,setItems]=useState<GuildAnswerItem[]|null>(null),[directory,setDirectory]=useState<GuildSummary[]>([]);
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[directoryError,setDirectoryError]=useState(''),[notice,setNotice]=useState('');
  const [editing,setEditing]=useState(''),[draft,setDraft]=useState<Record<string,string>>({});
  const [drafts,setDrafts]=useState<Record<string,{answers:Record<string,string>;item:GuildAnswerItem}>>({});
  const [pending,setPending]=useState<{item:GuildAnswerItem;answers:Record<string,string>}|null>(null);
  const generation=useRef(0),session=useRef(client.sessionGeneration),alive=useRef(false),{mutate,busy,error,lastFailureUnknown}=useModuleMutation(client);
  const locked=busy||lastFailureUnknown;
  const dirty=Object.keys(drafts).length>0;
  useEffect(()=>{onRiskChange?.(dirty,locked);},[dirty,locked,onRiskChange]);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty||locked){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,locked]);
  useEffect(()=>{if(!busy&&!lastFailureUnknown)setPending(null);},[busy,lastFailureUnknown]);
  const questionsFor=useCallback((guildKey:string)=>directory.find(guild=>guild.guild_key===guildKey)?.entry_questions?.questions??[],[directory]);
  const load=useCallback(async(initial:boolean)=>{
    const sequence=++generation.current;if(initial)setLoading(true);setLoadError('');setDirectoryError('');
    const [answers,guilds]=await Promise.allSettled([client.get<{items:GuildAnswerItem[]}>('/me/guild-answers'),client.get<{items:GuildSummary[]}>('/guilds/directory')]);
    if(sequence!==generation.current||session.current!==client.sessionGeneration)return;
    if(answers.status==='fulfilled')setItems(answers.value.items);else setLoadError(answers.reason instanceof Error?answers.reason.message:'公會小問答暫時無法載入。');
    if(guilds.status==='fulfilled')setDirectory(guilds.value.items);else setDirectoryError(guilds.reason instanceof Error?guilds.reason.message:'題目暫時無法載入。');
    if(initial)setLoading(false);
  },[client]);
  useEffect(()=>{alive.current=true;void load(true);return()=>{alive.current=false;generation.current++;};},[load]);
  function open(item:GuildAnswerItem){
    if(locked)return;
    const questions=questionsFor(item.guild_key);
    if(!questions.length){setDirectoryError(directoryError||'題目暫時無法載入。');return;}
    const next:Record<string,string>={};
    for(const question of questions){const saved=item.answers?.find(answer=>answer.question_id===question.id&&question.options.some(option=>option.id===answer.option_id));if(saved)next[question.id]=saved.option_id;}
    setDraft(drafts[item.guild_key]?.answers??next);setEditing(item.guild_key);setNotice('');
  }
  function change(questionId:string,optionId:string,item:GuildAnswerItem){
    if(locked)return;
    const answers={...draft,[questionId]:optionId};setDraft(answers);
    setDrafts(current=>({...current,[item.guild_key]:{answers,item:current[item.guild_key]?.item??item}}));
  }
  function discard(item:GuildAnswerItem){
    if(locked||!window.confirm('捨棄這個公會尚未儲存的答案？已儲存的答案不會刪除。'))return;
    setDrafts(current=>{const next={...current};delete next[item.guild_key];return next;});setEditing('');void load(true);
  }
  async function save(item:GuildAnswerItem){
    if(busy)return;
    const request=pending??{item:drafts[item.guild_key]?.item??item,answers:structuredClone(draft)};
    const questions=questionsFor(request.item.guild_key);
    if(!pending&&(!questions.length||questions.some(question=>!request.answers[question.id])))return;
    setPending(request);
    const result=await mutate<GuildAnswerItem>(`/me/guild-answers/${request.item.guild_key}`,{answers:request.answers},request.item.aggregate_version??undefined,value=>{
      const answer=value as GuildAnswerItem;
      if(!answer||answer.guild_key!==request.item.guild_key||!Number.isInteger(answer.aggregate_version)||Number(answer.aggregate_version)<1||!Array.isArray(answer.answers))throw new Error('unconfirmed');
      return answer;
    });
    if(!alive.current||session.current!==client.sessionGeneration)return;
    if(result){setPending(null);setDrafts(current=>{const next={...current};delete next[request.item.guild_key];return next;});setEditing('');setNotice(`已儲存${request.item.name}的小問答。`);await load(false);}
  }
  return <section className="card guild-answers" aria-labelledby="guild-answers-title">
    <h2 id="guild-answers-title">公會小問答</h2><button type="button" className="btn btn-ghost" disabled={busy||loading} onClick={()=>void load(true)}>更新題目與已儲存答案</button><p className="field-hint">選填，只給你自己看，不影響公會資格。返回清單會暫存本頁輸入；按儲存才會保存。</p>
    {loading&&<p role="status">正在載入公會小問答…</p>}
    {loadError&&<div className="banner banner-error" role="alert"><p>{loadError}</p><button type="button" className="btn btn-ghost" onClick={()=>void load(items===null)}>重新載入小問答</button></div>}
    {directoryError&&<div className="banner banner-error" role="alert"><p>{directoryError}</p><button type="button" className="btn btn-ghost" onClick={()=>void load(false)}>重新載入題目</button></div>}
    {notice&&<p role="status" className="banner status-note">{notice}</p>}
    {error&&<div role="alert" className="banner banner-error"><p>{error}</p>{!locked&&<><p>輸入仍保留。若版本已更新，請先重讀，再明確捨棄本頁草稿以使用新答案。</p><button type="button" className="btn btn-ghost" disabled={loading} onClick={()=>void load(true)}>重讀已儲存的小問答</button></>}{lastFailureUnknown&&pending&&<><p>{pending.item.name}的儲存結果尚未確認。請重試原答案，暫時不要改填或離開。</p><button className="btn btn-ghost" disabled={busy} onClick={()=>void save(pending.item)}>重試原小問答</button></>}</div>}
    {!loading&&items&&!items.length&&<p>加入公會後，可以在這裡回答小問題。</p>}
    {items?.map(item=>{
      const questions=questionsFor(item.guild_key),openEditor=editing===item.guild_key;
      const ready=questions.length>0&&questions.every(question=>draft[question.id]);
      return <article className="guild-answer-card" key={item.guild_key} aria-labelledby={`guild-answers-${item.guild_key}`}>
        <header><h3 id={`guild-answers-${item.guild_key}`}>{item.name}</h3>{!openEditor&&<button type="button" className="btn btn-ghost" disabled={locked||loading||!!loadError} onClick={()=>open(item)}>{drafts[item.guild_key]?'繼續草稿':item.answers?'修改':'回答'}</button>}</header>
        {item.outdated&&<p className="field-hint">題目已更新，請重新確認</p>}
        {!openEditor&&item.answers&&<dl className="guild-answer-pairs">{item.answers.map(answer=><div key={answer.question_id}><dt>{answer.prompt}</dt><dd>{answer.label}</dd></div>)}</dl>}
        {openEditor&&<div className="stack"><GuildQuestionFields questions={questions} answers={draft} disabled={locked} namePrefix={`edit-${item.guild_key}`} onChange={(questionId,optionId)=>change(questionId,optionId,item)}/><div className="actions"><button type="button" className="btn btn-primary" disabled={!ready||locked} onClick={()=>void save(item)}>{busy?'正在儲存…':'儲存小問答'}</button><button type="button" className="btn btn-ghost" disabled={locked} onClick={()=>setEditing('')}>返回清單，保留輸入</button>{drafts[item.guild_key]&&<button type="button" className="btn btn-ghost" disabled={locked} onClick={()=>discard(item)}>捨棄未儲存答案</button>}</div></div>}
      </article>;
    })}
  </section>;
}
