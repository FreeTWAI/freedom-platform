import {useEffect,useRef,useState} from 'react';
import {CLASSES_V2,EXTRA_DATA_V2,QUESTIONS_V2,DIMENSION_META_V2,RADAR_AXES_V2,DIMENSIONS,CAREER_GUILDS,directionDraft,calculateResult,lifestyleBaseline,completeAnswers,STORAGE_KEY,QUESTS,freshProgress,type Quest} from '../../../../modules/newbie-village/index';
import {useLanguage} from '../language';
import type {InterfaceMessage} from '../interface-messages';
import './NewbieVillage.css';
import {restoreVillage,resumeView,villageText,type VillageStep,type VillageView} from '../../../../modules/newbie-village/journey';
const labels:Record<Quest,InterfaceMessage>={framework:'nv.framework',quiz:'nv.quiz',card:'nv.card',guild:'nv.guild',checkin:'nv.checkin'};
const HISTORY_KEY='freedomNewbieView';
export function NewbieVillage({registerLeave}:{registerLeave?:(guard:((nextHash:string|null)=>boolean)|null)=>void}={}){
  const {t,language}=useLanguage();
  const text=(key:Parameters<typeof villageText>[1])=>villageText(language,key);
  const [initial]=useState(()=>{try{const restored=restoreVillage(localStorage.getItem(STORAGE_KEY));const historyView=window.history.state?.[HISTORY_KEY];return {...restored,view:historyView?resumeView(restored.progress,historyView):restored.view,readError:false}}catch{return {...restoreVillage(null),readError:true}}});
  const [p,setP]=useState(initial.progress),[view,setView]=useState(initial.view);
  const lastSavedProgress=useRef(initial.progress),leaveGuard=useRef<(nextHash:string|null)=>boolean>(()=>true);
  const [storageError,setStorageError]=useState(false),[saved,setSaved]=useState(false),[readError,setReadError]=useState(initial.readError);
  const [copyStatus,setCopyStatus]=useState<InterfaceMessage|null>(null),[clearOpen,setClearOpen]=useState(false),[clearFailed,setClearFailed]=useState(false),[cleared,setCleared]=useState(false);
  const headingRef=useRef<HTMLHeadingElement>(null),questionRef=useRef<HTMLLegendElement>(null),clearRef=useRef<HTMLButtonElement>(null),cancelRef=useRef<HTMLButtonElement>(null);
  const focusQuestion=useRef(false),focusStep=useRef(false),skipSave=useRef(true),copyRequest=useRef(0);
  const {step,index}=view,showResult=view.result&&completeAnswers(p.answers);
  useEffect(()=>{
    if(skipSave.current){skipSave.current=false;return}
    if(readError)return;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({...p,journey:view}));lastSavedProgress.current=p;setStorageError(false);setSaved(true);setCleared(false)}catch{setStorageError(true);setSaved(false)}
  },[p,view,readError]);
  useEffect(()=>{if(focusQuestion.current){questionRef.current?.focus();focusQuestion.current=false}else if(focusStep.current){headingRef.current?.focus();focusStep.current=false}},[view]);
  const unsaved=(readError||storageError)&&p!==lastSavedProgress.current;
  leaveGuard.current=nextHash=>nextHash===null||nextHash==='#newbie-village'||!unsaved||window.confirm(text('leave'));
  useEffect(()=>{registerLeave?.(nextHash=>leaveGuard.current(nextHash));return()=>registerLeave?.(null)},[registerLeave]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(unsaved){event.preventDefault();event.returnValue=''}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[unsaved]);
  useEffect(()=>{if(clearOpen)cancelRef.current?.focus()},[clearOpen]);
  useEffect(()=>{
    // Store navigation metadata only: never answers or private text in browser history.
    window.history.replaceState({...window.history.state,[HISTORY_KEY]:initial.view},'');
    const back=()=>{if(window.location.hash==='#newbie-village'){copyRequest.current++;setCopyStatus(null);focusStep.current=true;setView(resumeView(pRef.current,window.history.state?.[HISTORY_KEY]));setClearOpen(false)}};
    window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);
  },[initial]);
  const pRef=useRef(p);pRef.current=p;
  const navigate=(next:VillageView)=>{copyRequest.current++;setCopyStatus(null);focusStep.current=true;setView(next);window.history.pushState({...window.history.state,[HISTORY_KEY]:next},'')};
  const go=(next:VillageStep)=>navigate({...view,step:next});
  const finish=(quest:Quest)=>setP(old=>({...old,done:[...new Set([...old.done,quest])]}));
  const result=calculateResult(p.answers),career=CLASSES_V2[result.primary],extra=EXTRA_DATA_V2[result.primary];
  const q=QUESTIONS_V2[index],selected=p.answers[index],answered=p.answers.filter(a=>a.length).length;
  const suggestedCareers=[...new Set([result.primary,...DIMENSIONS.map(d=>result.dimensionWinners[d])])];
  const baseline=p.baseline||lifestyleBaseline(p.answers);
  const draft=completeAnswers(p.answers)?directionDraft({...result,baseline:p.baseline,action:p.action,checkin:p.checkin}):[t('nv.card'),`${t('nv.baseline')}：${p.baseline}`,`${t('nv.firstWeek')}：${p.action}`,`${t('nv.checkin')}：${p.checkin}`].join('\n');
  const changeQuestion=(i:number)=>{focusQuestion.current=true;const next={...view,index:i,result:false};setView(next);window.history.replaceState({...window.history.state,[HISTORY_KEY]:next},'')};
  const toggle=(option:number)=>{setCopyStatus(null);setP(old=>{const a=old.answers[index];const next=q.multi?(a.includes(option)?a.filter(v=>v!==option):a.length<(q.maxSelect??1)?[...a,option]:a):[option];return {...old,answers:old.answers.map((v,i)=>i===index?next:v),done:old.done.filter(v=>v!=='quiz')}})};
  const point=(i:number,value:number)=>{const angle=(-90+i*60)*Math.PI/180;return `${200+Math.cos(angle)*value*25},${200+Math.sin(angle)*value*25}`};
  const closeClear=()=>{setClearOpen(false);clearRef.current?.focus()};
  const clear=()=>{
    copyRequest.current++;
    try{localStorage.removeItem(STORAGE_KEY)}catch{setClearFailed(true);return}
    const progress=freshProgress(),next=resumeView(progress);skipSave.current=true;lastSavedProgress.current=progress;
    setP(progress);setView(next);setSaved(false);setStorageError(false);setReadError(false);setClearFailed(false);setCleared(true);setCopyStatus(null);closeClear();
    window.history.replaceState({...window.history.state,[HISTORY_KEY]:next},'');
  };
  const edit=(field:'baseline'|'action'|'checkin',value:string)=>{copyRequest.current++;setCopyStatus(null);setP(old=>({...old,[field]:value,done:old.done.filter(q=>q!==(field==='checkin'?'checkin':'card'))}))};
  const backup=[...QUESTIONS_V2.flatMap((q,i)=>p.answers[i].length?[q.q,...p.answers[i].map(j=>q.options[j].text),'']:[]),draft].join('\n');
  return <div className="newbie-village stack" onClickCapture={event=>{
    // Authenticated navigation is guarded by the shell. Anonymous links owned here
    // require the same explicit discard; global anonymous Back/Home remain shell-owned.
    if(registerLeave||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=(event.target as Element).closest('a[href]');
    if(link&&link.getAttribute('target')!=='_blank'&&!leaveGuard.current(link.getAttribute('href'))){event.preventDefault();event.stopPropagation()}
  }}>
    <p>{text('purpose')}</p><p className="help-box">{t('nv.privacy')}</p>
    <details className="nv-privacy"><summary>{text('local')}</summary><p>{t('nv.intro')}</p></details>
    {readError?<p role="alert">{text('readFailed')}</p>:storageError?<p role="alert">{t('nv.storageFailed')}</p>:saved?<p role="status" className="field-hint">{text('saved')}</p>:null}
    {(readError||storageError)&&<div className="help-box stack"><strong>{text('unsaved')}</strong><details><summary>{text('backup')}</summary><textarea aria-label={text('backup')} readOnly value={backup} onFocus={event=>event.target.select()}/></details></div>}
    {cleared&&<p role="status">{text('cleared')}</p>}
    <nav aria-label={text('overview')} className="nv-step-nav">
      <button className="btn btn-secondary btn-small" aria-current={step==='overview'?'step':undefined} onClick={()=>go('overview')}>{text('overview')}</button>
      {QUESTS.map((quest,i)=><button key={quest} className="btn btn-secondary btn-small" aria-current={step===quest?'step':undefined} onClick={()=>go(quest)}>{i+1}. {t(labels[quest])}{p.done.includes(quest)&&<span aria-label={text('completed')}> ✓</span>}</button>)}
    </nav>
    {step==='overview'?<section className="card stack" id="nv-overview">
      <h2 ref={headingRef} tabIndex={-1}>{text('overview')}</h2><p>{text('estimate')}</p>
      <div className="nv-actions"><button className="btn btn-small" onClick={()=>go('quiz')}>{showResult?t('nv.results'):answered?text('resume'):text('start')}</button><a className="btn btn-secondary btn-small" href="#guilds">{text('skip')}</a></div>
      <p role="status">{t('nv.progress',{count:p.done.length})}</p>
      <ol className="nv-quests">{QUESTS.map(quest=><li key={quest}><button className="btn btn-secondary btn-small" onClick={()=>go(quest)}>{t(labels[quest])}</button>{p.done.includes(quest)&&<span className="badge"> ✓ {text('completed')}</span>}</li>)}</ol>
    </section>:<>
    <div className="nv-actions"><button className="btn btn-secondary btn-small" onClick={()=>go('overview')}>{text('back')}</button></div>
    {step==='framework'&&<section id="nv-framework" className="card stack"><h2 ref={headingRef} tabIndex={-1}>{t('nv.framework')}</h2>
      <div lang="zh-Hant"><h3>做自己 · personality</h3><p>受 Holland 的環境適配觀點啟發：在哪種環境會自然發光？記下一次做事不覺得累的經驗。</p>
      <h3>過生活 · lifestyle</h3><p>受 Schein 生涯定錨觀點啟發：你不會放棄什麼？先寫不想要的工作情境、可投入時間與生活底線。</p>
      <h3>用強項 · capability</h3><p>受優勢發展觀點啟發：從既有專業、產業經驗與投入出發，用 AI 放大。AI Twist：Talent × AI × Investment = Strength。</p>
      <p>三維度可以不同，不必硬湊成單一人格。先守生活底線，再選一個能驗證的小實驗。</p></div>

      <button className="btn btn-small" onClick={()=>{finish('framework');go('quiz')}}>{text('frameworkNext')}</button>
    </section>}
    {step==='quiz'&&<section id="nv-quiz" className="card stack"><h2 ref={headingRef} tabIndex={-1}>{t('nv.quiz')}</h2>
      {!showResult?<><p>{t('nv.question',{count:index+1})} · {answered} / 15</p><progress max={15} value={answered} aria-label={t('nv.quiz')}/>
      <fieldset><legend lang="zh-Hant" ref={questionRef} tabIndex={-1}>{q.q}</legend>{q.multi&&<p>{t('nv.multi')}</p>}
      {q.options.map((option,i)=><label className="nv-option" key={i} lang="zh-Hant"><input type={q.multi?'checkbox':'radio'} name={`nv-question-${index}`} checked={selected.includes(i)} disabled={!!q.multi&&!selected.includes(i)&&selected.length===(q.maxSelect??1)} onChange={()=>toggle(i)}/><span>{option.text}</span></label>)}</fieldset>
      <div className="nv-actions"><button className="btn btn-secondary btn-small" disabled={index===0} onClick={()=>changeQuestion(index-1)}>{t('nv.previous')}</button><button className="btn btn-small" disabled={!selected.length} onClick={()=>{if(index<14)changeQuestion(index+1);else if(completeAnswers(p.answers)){finish('quiz');navigate({...view,result:true})}else changeQuestion(p.answers.findIndex(a=>!a.length))}}>{t(index===14?'nv.results':'nv.next')}</button></div></>:<>
      <h3>{t('nv.resultTitle')}</h3><h4 lang="zh-Hant">{career.name}</h4><p lang="zh-Hant">{career.plainIntro}</p>
      <section className="card stack nv-next-step" aria-labelledby="nv-next-step-title" data-testid="nv-next-step">
        <h4 id="nv-next-step-title">{t('nv.nextStep')}</h4><h5>{t('nv.firstWeek')}</h5><ol lang="zh-Hant">{career.actions.map(a=><li key={a}><p>{a}</p><button className="btn btn-secondary btn-small" lang={language} onClick={()=>{if(!p.action.trim())edit('action',a);go('card')}}>{p.action.trim()?text('nextCard'):text('useAction')}</button></li>)}</ol>
        <button className="btn btn-small" onClick={()=>go('card')}>{text('nextCard')}</button>
      </section>
      <details className="nv-result-details"><summary>{text('details')}</summary>
      <div className="nv-dimensions" lang="zh-Hant">{DIMENSIONS.map(d=><div key={d}><strong>{DIMENSION_META_V2[d].label}</strong><p>{CLASSES_V2[result.dimensionWinners[d]].name}</p></div>)}</div>
      <h4>{t('nv.baseline')}</h4><p className="nv-preserve" lang="zh-Hant">{baseline}</p>
      <svg viewBox="0 0 400 400" role="img" aria-label="六軸雷達：答題分數加權的職業特徵示意，不是能力診斷" className="nv-radar">
        <title>六軸雷達</title>{[1,2,3,4,5].map(level=><polygon key={level} points={RADAR_AXES_V2.map((_,i)=>point(i,level)).join(' ')} className="nv-grid"/>)}
        <polygon points={RADAR_AXES_V2.map((axis,i)=>point(i,result.axes[axis.key])).join(' ')} className="nv-shape"/>
        {RADAR_AXES_V2.map((axis,i)=>{const [x,y]=point(i,6.3).split(',');return <text key={axis.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{axis.label}<tspan x={x} dy="18">{result.axes[axis.key]} / 5</tspan></text>})}
      </svg>
      <details lang="zh-Hant"><summary>計分與雷達怎麼算？</summary><p>各選項分數相加；複選超過一項時，每項乘 0.7。三維度各自加總，最高分是該維度的職業。同分依原始順序：{Object.values(CLASSES_V2).map(c=>c.name).join('、')}。</p><p>雷達用全部職業分數加權作者的六軸特徵，除以總分，最低 1，四捨五入至 0.5。這是作答偏好示意，不是實際能力評量。</p><ol>{QUESTIONS_V2.map((question,i)=><li key={i}>{question.q}<ul>{p.answers[i].map(j=><li key={j}>{question.options[j].text}：{Object.entries(question.options[j].scores).map(([key,n])=>`${CLASSES_V2[key as keyof typeof CLASSES_V2].name} +${n}`).join('、')}</li>)}</ul></li>)}</ol></details>
      <h4>{t('nv.day')}</h4><ul lang="zh-Hant">{extra.dayInLife.map(x=><li key={x.time}>{x.time} · {x.act}</li>)}</ul>
      <h4>{t('nv.rhythm')}</h4><ul lang="zh-Hant">{extra.monthPlan.map(x=><li key={x.week}>{x.week} · {x.goal}</li>)}</ul>
      <h4>{t('nv.stuck')}</h4><ul lang="zh-Hant">{extra.painPoints.map(x=><li key={x.pain}>{x.pain} → {x.solution}</li>)}</ul>

      </details>
      <button className="btn btn-secondary btn-small" onClick={()=>navigate({...view,index:0,result:false})}>{t('nv.retake')}</button></>}
    </section>}
    {step==='card'&&<section id="nv-card" className="card stack"><h2 ref={headingRef} tabIndex={-1}>{t('nv.card')}</h2><p>{text('cardHint')}</p>
      <label>{t('nv.baseline')}<textarea maxLength={4000} value={p.baseline} onChange={e=>edit('baseline',e.target.value)}/></label>
      <label>{t('nv.firstWeek')}<textarea maxLength={4000} value={p.action} onChange={e=>edit('action',e.target.value)}/></label>
      {(p.baseline.trim()||p.action.trim())&&<><pre>{draft}</pre><button className="btn btn-secondary btn-small" onClick={async()=>{const request=++copyRequest.current;try{await navigator.clipboard.writeText(draft);if(request===copyRequest.current)setCopyStatus('nv.copied')}catch{if(request===copyRequest.current)setCopyStatus('nv.copyFailed')}}}>{t('nv.copy')}</button></>}
      {copyStatus&&<p role="status">{t(copyStatus)}</p>}<button className="btn btn-small" disabled={!p.baseline.trim()||!p.action.trim()} onClick={()=>{finish('card');go('guild')}}>{text('saveCard')}</button>
    </section>}
    {step==='guild'&&<section id="nv-guild" className="card stack"><h2 ref={headingRef} tabIndex={-1}>{t('nv.guild')}</h2><p>{t('nv.suggestion')}</p>
      {completeAnswers(p.answers)&&suggestedCareers.map(c=><div key={c}><strong lang="zh-Hant">{CLASSES_V2[c].name}</strong>{CAREER_GUILDS[c].map(g=><div key={g.guildId}><a href={`#guilds/${g.guildId}`}>{g.name}</a><p lang="zh-Hant">{g.justification}</p></div>)}</div>)}
      <div className="nv-actions"><a className="btn btn-secondary btn-small" href="#guilds">{t('nv.allGuilds')}</a><a className="btn btn-secondary btn-small" href="#squads">{t('nv.squads')}</a><button className="btn btn-small" onClick={()=>{finish('guild');go('checkin')}}>{text('explored')}</button></div><p lang="zh-Hant">此勾選只表示本人已查看，不會替你加入公會、建立小隊或傳送作答。</p></section>}
    {step==='checkin'&&<section id="nv-checkin" className="card stack"><h2 ref={headingRef} tabIndex={-1}>{t('nv.checkin')}</h2><p>{text('checkinHint')}</p><label>{t('nv.checkinHint')}<textarea maxLength={4000} value={p.checkin} onChange={e=>edit('checkin',e.target.value)}/></label><button className="btn btn-small" disabled={!p.checkin.trim()} onClick={()=>{finish('checkin');go('overview')}}>{text('saveCheckin')}</button></section>}
    </>}
    <footer className="nv-footer stack"><p lang="zh-Hant">題目、選項、職業與結果示例：Jason、Hao 哥（作者已授權本倉使用）。示例中的客戶、收入與成交目標不是平台承諾；請依自己的條件調整。</p>
    <button ref={clearRef} className="btn btn-secondary btn-small" aria-expanded={clearOpen} onClick={()=>{setClearOpen(true);setClearFailed(false)}}>{t('nv.clear')}</button>
    {clearOpen&&<section className="help-box stack" aria-labelledby="nv-clear-title" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();closeClear()}}}>
      <h3 id="nv-clear-title">{text('clearTitle')}</h3><p>{text('clearHint')}</p>{clearFailed&&<p role="alert">{text('clearFailed')}</p>}
      <div className="nv-actions"><button ref={cancelRef} className="btn btn-secondary btn-small" onClick={closeClear}>{text('cancel')}</button><button className="btn btn-secondary btn-small" onClick={clear}>{text('clearConfirm')}</button></div>
    </section>}</footer>
  </div>;
}
