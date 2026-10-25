import {useEffect,useRef,useState} from 'react';
import {CLASSES_V2,EXTRA_DATA_V2,QUESTIONS_V2,DIMENSION_META_V2,RADAR_AXES_V2,DIMENSIONS,CAREER_GUILDS,calculateResult,lifestyleBaseline,completeAnswers,STORAGE_KEY,QUESTS,parseProgress,freshProgress,type Progress,type Quest} from '../../../../modules/newbie-village/index';
import {useLanguage} from '../language';
import type {InterfaceMessage} from '../interface-messages';
import './NewbieVillage.css';
const labels:Record<Quest,InterfaceMessage>={framework:'nv.framework',quiz:'nv.quiz',card:'nv.card',guild:'nv.guild',checkin:'nv.checkin'};
export function NewbieVillage(){
  const {t}=useLanguage();
  const [p,setP]=useState<Progress>(()=>{try{return parseProgress(localStorage.getItem(STORAGE_KEY))}catch{return freshProgress()}});
  const [index,setIndex]=useState(0),[showResult,setShowResult]=useState(()=>p.done.includes('quiz')),[storageError,setStorageError]=useState(false),[copyStatus,setCopyStatus]=useState<InterfaceMessage|null>(null);
  const questionRef=useRef<HTMLLegendElement>(null),focusQuestion=useRef(false);
  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(p));setStorageError(false)}catch{setStorageError(true)}},[p]);
  useEffect(()=>{if(focusQuestion.current){questionRef.current?.focus();focusQuestion.current=false}},[index,showResult]);
  const finish=(quest:Quest)=>setP(old=>({...old,done:[...new Set([...old.done,quest])]}));
  const result=calculateResult(p.answers),career=CLASSES_V2[result.primary],extra=EXTRA_DATA_V2[result.primary];
  const [primaryGuild,secondaryGuild]=CAREER_GUILDS[result.primary];
  const q=QUESTIONS_V2[index],selected=p.answers[index];
  const suggestedCareers=[...new Set([result.primary,...DIMENSIONS.map(d=>result.dimensionWinners[d])])];
  const baseline=p.baseline||lifestyleBaseline(p.answers),action=p.action||career.actions[0];
  const draft=`方向卡（本人選擇的草稿）\n做自己：${CLASSES_V2[result.dimensionWinners.personality].name}\n過生活：${CLASSES_V2[result.dimensionWinners.lifestyle].name}\n用強項：${CLASSES_V2[result.dimensionWinners.capability].name}\n過生活底線：${baseline}\n第一週行動：${action}\n完成條件與回顧：${p.checkin}\n公會僅供建議，由本人另行選擇。`;
  const changeQuestion=(i:number)=>{focusQuestion.current=true;setIndex(i)};
  const toggle=(option:number)=>setP(old=>{const a=old.answers[index];const next=q.multi?(a.includes(option)?a.filter(v=>v!==option):a.length<(q.maxSelect??1)?[...a,option]:a):[option];return {...old,answers:old.answers.map((v,i)=>i===index?next:v)}});
  const point=(i:number,value:number)=>{const angle=(-90+i*60)*Math.PI/180;return `${200+Math.cos(angle)*value*25},${200+Math.sin(angle)*value*25}`};
  return <div className="newbie-village stack">
    <p>{t('nv.intro')}</p><p className="help-box">{t('nv.privacy')}</p>
    {storageError&&<p role="alert">{t('nv.storageFailed')}</p>}
    <p role="status">{t('nv.progress',{count:p.done.length})}</p>
    <ol className="nv-quests">{QUESTS.map(quest=><li key={quest}><a href={`#nv-${quest}`} onClick={e=>{e.preventDefault();document.getElementById(`nv-${quest}`)?.scrollIntoView({block:'start'})}}>{t(labels[quest])}</a>{p.done.includes(quest)&&<span className="badge"> ✓ {t('nv.badge')}</span>}</li>)}</ol>
    <section id="nv-framework" className="card stack"><h2>{t('nv.framework')}</h2>
      <div lang="zh-Hant"><h3>做自己 · personality</h3><p>受 Holland 的環境適配觀點啟發：在哪種環境會自然發光？記下一次做事不覺得累的經驗。</p>
      <h3>過生活 · lifestyle</h3><p>受 Schein 生涯定錨觀點啟發：你不會放棄什麼？先寫不想要的工作情境、可投入時間與生活底線。</p>
      <h3>用強項 · capability</h3><p>受優勢發展觀點啟發：從既有專業、產業經驗與投入出發，用 AI 放大。AI Twist：Talent × AI × Investment = Strength。</p>
      <p>三維度可以不同，不必硬湊成單一人格。先守生活底線，再選一個能驗證的小實驗。</p></div>
      <button className="btn btn-secondary btn-small" onClick={()=>finish('framework')}>{t('nv.done')}</button>
    </section>
    <section id="nv-quiz" className="card stack"><h2>{t('nv.quiz')}</h2>
      {!showResult?<><p>{t('nv.question',{count:index+1})}</p><progress max={15} value={p.answers.filter(a=>a.length).length} aria-label={t('nv.quiz')}/>
      <fieldset><legend lang="zh-Hant" ref={questionRef} tabIndex={-1}>{q.q}</legend>{q.multi&&<p>{t('nv.multi')}</p>}
      {q.options.map((option,i)=><label className="nv-option" key={i} lang="zh-Hant"><input type={q.multi?'checkbox':'radio'} name={`nv-question-${index}`} checked={selected.includes(i)} disabled={!!q.multi&&!selected.includes(i)&&selected.length===(q.maxSelect??1)} onChange={()=>toggle(i)}/><span>{option.text}</span></label>)}</fieldset>
      <div className="nv-actions"><button className="btn btn-secondary btn-small" disabled={index===0} onClick={()=>changeQuestion(index-1)}>{t('nv.previous')}</button><button className="btn btn-small" disabled={!selected.length} onClick={()=>{if(index<14)changeQuestion(index+1);else if(completeAnswers(p.answers)){finish('quiz');focusQuestion.current=true;setShowResult(true)}}}>{t(index===14?'nv.results':'nv.next')}</button></div></>:<>
      <h3 tabIndex={-1} ref={questionRef}>{t('nv.resultTitle')}</h3><h4 lang="zh-Hant">{career.name}</h4><p lang="zh-Hant">{career.plainIntro}</p>
      <section className="card stack nv-next-step" aria-labelledby="nv-next-step-title" data-testid="nv-next-step">
        <h4 id="nv-next-step-title">{t('nv.nextStep')}</h4>
        <ol lang="zh-Hant">{career.actions.map(a=><li key={a}>{a}</li>)}</ol>
        <div className="nv-actions">
          <a className="btn btn-secondary btn-small" href={`#guilds/${primaryGuild.guildId}`}>{t('nv.primaryGuild')}：<span lang="zh-Hant">{primaryGuild.name}</span></a>
          {secondaryGuild&&<a className="btn btn-secondary btn-small" href={`#guilds/${secondaryGuild.guildId}`}>{t('nv.secondaryGuild')}：<span lang="zh-Hant">{secondaryGuild.name}</span></a>}
        </div>
        <p className="muted">{t('nv.coachingSoon')}</p>
      </section>
      <div className="nv-dimensions" lang="zh-Hant">{DIMENSIONS.map(d=><div key={d}><strong>{DIMENSION_META_V2[d].label}</strong><p>{CLASSES_V2[result.dimensionWinners[d]].name}</p></div>)}</div>
      <h4>{t('nv.baseline')}</h4><p className="nv-preserve" lang="zh-Hant">{baseline}</p>
      <svg viewBox="0 0 400 400" role="img" aria-label="六軸雷達：答題分數加權的職業特徵示意，不是能力診斷" className="nv-radar">
        <title>六軸雷達</title>{[1,2,3,4,5].map(level=><polygon key={level} points={RADAR_AXES_V2.map((_,i)=>point(i,level)).join(' ')} className="nv-grid"/>)}
        <polygon points={RADAR_AXES_V2.map((axis,i)=>point(i,result.axes[axis.key])).join(' ')} className="nv-shape"/>
        {RADAR_AXES_V2.map((axis,i)=>{const [x,y]=point(i,6.3).split(',');return <text key={axis.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{axis.label}<tspan x={x} dy="18">{result.axes[axis.key]} / 5</tspan></text>})}
      </svg>
      <details lang="zh-Hant"><summary>計分與雷達怎麼算？</summary><p>各選項分數相加；複選超過一項時，每項乘 0.7。三維度各自加總，最高分是該維度的職業。同分依原始順序：{Object.values(CLASSES_V2).map(c=>c.name).join('、')}。</p><p>雷達用全部職業分數加權作者的六軸特徵，除以總分，最低 1，四捨五入至 0.5。這是作答偏好示意，不是實際能力評量。</p><ol>{QUESTIONS_V2.map((question,i)=><li key={i}>{question.q}<ul>{p.answers[i].map(j=><li key={j}>{question.options[j].text}：{Object.entries(question.options[j].scores).map(([key,n])=>`${CLASSES_V2[key as keyof typeof CLASSES_V2].name} +${n}`).join('、')}</li>)}</ul></li>)}</ol></details>
      <p>{t('nv.suggestion')}</p>{suggestedCareers.map(c=><div key={c}><strong lang="zh-Hant">{CLASSES_V2[c].name}</strong>{CAREER_GUILDS[c].map(g=><div key={g.guildId}><a href={`#guilds/${g.guildId}`}>{g.name}</a><p lang="zh-Hant">{g.justification}</p></div>)}</div>)}
      <h4>{t('nv.firstWeek')}</h4><ol lang="zh-Hant">{career.actions.map(a=><li key={a}>{a}</li>)}</ol>
      <h4>{t('nv.day')}</h4><ul lang="zh-Hant">{extra.dayInLife.map(x=><li key={x.time}>{x.time} · {x.act}</li>)}</ul>
      <h4>{t('nv.rhythm')}</h4><ul lang="zh-Hant">{extra.monthPlan.map(x=><li key={x.week}>{x.week} · {x.goal}</li>)}</ul>
      <h4>{t('nv.stuck')}</h4><ul lang="zh-Hant">{extra.painPoints.map(x=><li key={x.pain}>{x.pain} → {x.solution}</li>)}</ul>
      <button className="btn btn-secondary btn-small" onClick={()=>{focusQuestion.current=true;setShowResult(false)}}>{t('nv.retake')}</button></>}
    </section>
    <section id="nv-card" className="card stack"><h2>{t('nv.card')}</h2>
      <label>{t('nv.baseline')}<textarea maxLength={4000} value={p.baseline} onChange={e=>setP({...p,baseline:e.target.value})}/></label>
      <label>{t('nv.firstWeek')}<textarea maxLength={4000} value={p.action} onChange={e=>setP({...p,action:e.target.value})}/></label>
      {completeAnswers(p.answers)&&<><pre>{draft}</pre><button className="btn btn-secondary btn-small" onClick={async()=>{try{await navigator.clipboard.writeText(draft);setCopyStatus('nv.copied')}catch{setCopyStatus('nv.copyFailed')}}}>{t('nv.copy')}</button></>}
      {copyStatus&&<p role="status">{t(copyStatus)}</p>}<button className="btn btn-secondary btn-small" disabled={!p.baseline.trim()||!p.action.trim()} onClick={()=>finish('card')}>{t('nv.done')}</button>
    </section>
    <section id="nv-guild" className="card stack"><h2>{t('nv.guild')}</h2><p>{t('nv.suggestion')}</p><div className="nv-actions"><a className="btn btn-secondary btn-small" href="#guilds">{t('nv.allGuilds')}</a><a className="btn btn-secondary btn-small" href="#squads">{t('nv.squads')}</a><button className="btn btn-secondary btn-small" onClick={()=>finish('guild')}>{t('nv.done')}</button></div><p lang="zh-Hant">此勾選只表示本人已查看或自行加入，不會替你加入公會、建立小隊或傳送作答。</p></section>
    <section id="nv-checkin" className="card stack"><h2>{t('nv.checkin')}</h2><label>{t('nv.checkinHint')}<textarea maxLength={4000} value={p.checkin} onChange={e=>setP({...p,checkin:e.target.value})}/></label><button className="btn btn-secondary btn-small" disabled={!p.checkin.trim()} onClick={()=>finish('checkin')}>{t('nv.done')}</button></section>
    <p lang="zh-Hant">題目、選項、職業與結果示例：Jason、Hao 哥（作者已授權本倉使用）。示例中的客戶、收入與成交目標不是平台承諾；請依自己的條件調整。</p>
    <button className="btn btn-secondary btn-small" onClick={()=>{try{localStorage.removeItem(STORAGE_KEY)}catch{setStorageError(true)}setP(freshProgress());setIndex(0);setShowResult(false);setCopyStatus(null)}}>{t('nv.clear')}</button>
  </div>;
}
