import {useEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {useModuleMutation} from './shared';
import type {GuildSummary,OnboardingView} from './Onboarding';
import {GuildTopicFilter,GuildTags} from './GuildFilters';
import type {GuildTopic} from '../../../../packages/shared/guild-topics';
import {GuildQuestionFields} from './GuildQuestions';
import {useLanguage} from '../language';
import {SkillBookStarGate} from './SkillBookCover';
const recoveryMessages = {
  'zh-Hant': {checking:'正在確認加入狀態…', incomplete:'尚未完成加入，你的公會選擇與答案仍保留。請按「加入公會，開始參與」繼續。', failed:'暫時無法確認加入狀態，請再試一次。你的公會選擇與答案仍保留。'},
  en: {checking:'Checking membership…', incomplete:'Joining is not complete. Your guild and answers are still here. Select “Join guild and get started” to continue.', failed:'Membership could not be confirmed. Please try again. Your guild and answers are still here.'},
  ja: {checking:'参加状態を確認中…', incomplete:'参加はまだ完了していません。選んだギルドと回答は保持されています。「ギルドに参加して始める」で続けてください。', failed:'参加状態を確認できませんでした。もう一度お試しください。選んだギルドと回答は保持されています。'},
  ko: {checking:'가입 상태 확인 중…', incomplete:'아직 가입이 완료되지 않았습니다. 선택한 길드와 답변은 유지됩니다. “길드에 가입하고 시작하기”를 눌러 계속하세요.', failed:'가입 상태를 확인하지 못했습니다. 다시 시도하세요. 선택한 길드와 답변은 유지됩니다.'},
  es: {checking:'Comprobando la afiliación…', incomplete:'La afiliación aún no se ha completado. Tu gremio y respuestas se conservan. Selecciona «Unirme al gremio y empezar» para continuar.', failed:'No se pudo confirmar la afiliación. Inténtalo de nuevo. Tu gremio y respuestas se conservan.'},
} as const;
type QuickDirectory={items:GuildSummary[];loading:boolean;error:string;reload:()=>void};
export function QuickStart({client,onCompleted,directory}:{client:PortalClient;onCompleted:()=>void;directory?:QuickDirectory}){
  const {language,t}=useLanguage();
  const [localGuilds,setGuilds]=useState<GuildSummary[]>([]),[primary,setPrimary]=useState(''),[query,setQuery]=useState(''),[topic,setTopic]=useState<GuildTopic|''>('');
  const [step,setStep]=useState<1|2>(1),[answersByGuild,setAnswersByGuild]=useState<Record<string,Record<string,string>>>({});
  const [localLoading,setLoading]=useState(true),[localError,setLoadError]=useState(''),[recovering,setRecovering]=useState(false);
  const [recoveryFeedback,setRecoveryFeedback]=useState<'incomplete'|'failed'|null>(null);
  const recoveryRequest=useRef<AbortController|null>(null),joiningRequest=useRef(false);
  const recoveryText=recoveryMessages[language];
  const generation=useRef(0),heading=useRef<HTMLHeadingElement>(null),skipFocus=useRef(true),{mutate,busy,error}=useModuleMutation(client);
  const guilds=directory?.items??localGuilds,loading=directory?.loading??localLoading,loadError=localError||directory?.error||'';
  const supplied=directory!==undefined;
  async function load(){const sequence=++generation.current;setLoading(true);setLoadError('');try{const data=await client.get<{items:GuildSummary[]}>('/guilds/directory');if(sequence===generation.current)setGuilds(data.items);}catch(cause){if(sequence===generation.current)setLoadError(cause instanceof Error?cause.message:'公會暫時無法載入。');}finally{if(sequence===generation.current)setLoading(false);}}
  useEffect(()=>{if(!supplied)void load();return()=>{generation.current++;};},[client,supplied]);
  useEffect(()=>()=>{recoveryRequest.current?.abort();recoveryRequest.current=null;},[client,client.sessionGeneration]);
  useEffect(()=>{if(skipFocus.current){skipFocus.current=false;return;}heading.current?.focus();},[step]);
  const selected=guilds.find(guild=>guild.guild_key===primary),questions=selected?.entry_questions?.questions??[],answers=answersByGuild[primary]??{};
  const ready=questions.length>0&&questions.every(question=>answers[question.id]);
  async function join(){
    if(!selected||!ready||busy||recovering||joiningRequest.current||recoveryRequest.current)return;
    joiningRequest.current=true;setRecoveryFeedback(null);
    const sequence=generation.current,session=client.sessionGeneration;
    try{
      const result=await mutate<OnboardingView>('/me/onboarding/quick-start',{guild_keys:[selected.guild_key],primary_guild_key:selected.guild_key,confirmed:true,guild_answers:answers});
      if(sequence===generation.current&&session===client.sessionGeneration&&result?.completed===true)onCompleted();
    }finally{joiningRequest.current=false;}
  }
  async function recover(){
    if(busy||joiningRequest.current||recoveryRequest.current)return;
    const request=new AbortController(),sequence=generation.current,session=client.sessionGeneration;
    recoveryRequest.current=request;setRecovering(true);setRecoveryFeedback(null);
    const current=()=>!request.signal.aborted&&recoveryRequest.current===request&&sequence===generation.current&&session===client.sessionGeneration;
    try{
      const view=await client.get<OnboardingView>('/me/onboarding',{signal:request.signal});
      if(!current())return;
      if(!view||typeof view.completed!=='boolean')throw new Error('Incomplete onboarding response');
      if(view.completed)onCompleted();
      else setRecoveryFeedback('incomplete');
    }catch{
      if(current())setRecoveryFeedback('failed');
    }finally{
      if(current())setRecovering(false);
      if(recoveryRequest.current===request)recoveryRequest.current=null;
    }
  }
  const visible=guilds.filter(guild=>(!topic||guild.tags?.includes(topic))&&(!query.trim()||`${guild.name} ${guild.purpose} ${guild.skill_books.map(book=>book.title).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <section className="quick-start card stack" aria-label={t('quick.region')}>
    <header><h2 ref={heading} tabIndex={-1} id="quick-start-step-title">{step===1?t('quick.choose'):t('quick.questions',{name:selected?.name??'這個公會',count:questions.length})}</h2>{step===1&&<p>{t('quick.intro')}</p>}</header>
    {step===1&&<><label className="field">{t('quick.search')}<input type="search" value={query} onChange={event=>setQuery(event.target.value)} maxLength={100} placeholder={t('quick.example')}/></label>
      <GuildTopicFilter value={topic} onChange={setTopic}/>
      <div className="actions quick-join-actions"><button type="button" className="btn btn-primary" disabled={!selected||!questions.length||loading||busy||recovering} onClick={()=>setStep(2)}>{t(selected&&questions.length?'quick.nextCount':'quick.next',{count:questions.length})}</button>{selected&&<span className="field-hint">{t('quick.selected',{name:selected.name})}</span>}</div>
      {loading&&<p role="status">{t('quick.loading')}</p>}
      {loadError&&<div className="banner banner-error" role="alert"><p>{language==='zh-Hant'?loadError:t('error.generic')}</p><button type="button" className="btn btn-ghost" disabled={loading||busy} onClick={()=>{setLoadError('');if(directory)directory.reload();else void load();}}>{t('quick.reload')}</button></div>}
      {!loading&&!loadError&&<><p className="field-hint">{t('quick.count',{count:visible.length,total:guilds.length})}</p><fieldset className="quick-guild-options" disabled={busy||recovering}><legend>{t('quick.choose')}</legend>{visible.map(guild=><label className={`quick-guild-option${primary===guild.guild_key?' is-selected':''}`} key={guild.guild_key}>
        <input type="radio" name="quick-primary" value={guild.guild_key} checked={primary===guild.guild_key} onChange={()=>setPrimary(guild.guild_key)}/><span><strong lang="zh-Hant">{guild.name}</strong><span className="quick-guild-purpose multiline-text" lang="zh-Hant">{guild.purpose}</span><GuildTags tags={guild.tags}/><span className="field-hint">{t('quick.books',{count:guild.skill_books.length})}</span></span>
      </label>)}</fieldset>{!visible.length&&<p>{t('quick.noGuilds')}</p>}</>}
    </>}
    {step===2&&selected&&<><p className="quick-guild-purpose multiline-text" lang="zh-Hant">{selected.purpose}</p><div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||recovering} onClick={()=>setStep(1)}>{t('quick.change')}</button></div>
      <div lang="zh-Hant"><GuildQuestionFields questions={questions} answers={answers} disabled={busy||recovering} onChange={(questionId,optionId)=>setAnswersByGuild(current=>({...current,[selected.guild_key]:{...(current[selected.guild_key]??{}),[questionId]:optionId}}))}/></div>
      <p className="field-hint">{t('quick.answerHint')}</p>
      <SkillBookStarGate books={selected.skill_books}/>
      <div className="actions quick-join-finish"><button type="button" className="btn btn-primary" disabled={!ready||busy||recovering} onClick={()=>void join()}>{t(busy?'quick.joining':'quick.join')}</button></div>
    </>}
    {step===2&&!selected&&<button type="button" className="btn btn-ghost" onClick={()=>setStep(1)}>{t('quick.change')}</button>}
    {(error||recovering||recoveryFeedback)&&<div className={`banner ${recovering||recoveryFeedback==='incomplete'?'banner-info':'banner-error'}`}
      role={recovering||recoveryFeedback==='incomplete'?'status':'alert'} aria-busy={recovering}>
      <p>{recovering?recoveryText.checking:recoveryFeedback?recoveryText[recoveryFeedback]:(language==='zh-Hant'?error:t('error.generic'))}</p>
      <button type="button" className="btn btn-ghost" disabled={busy||recovering} onClick={()=>void recover()}>{t('quick.recover')}</button>
    </div>}
  </section>;
}
