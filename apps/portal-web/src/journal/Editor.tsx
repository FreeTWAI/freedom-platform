import {useEffect,useRef,useState} from 'react';
import type {JournalSnapshot} from '../../../../modules/community-journal/payload.js';
import {communityOf,communityLabel,communitySnapshot,type JournalCommunity} from '../../../../modules/community-journal/community.js';
import {Journal} from './App.js';
import {personView,journalView} from './journal-api.js';
type Submission={submission_id:string;source_revision:string;payload_sha256:string;status:string;created_at:string};
type Key={key_id:string;label:string;expires_at:string;revoked_at:string|null};
type Session={user:{user_id:string};csrf_token:string};
type State={aggregate_version:string;published_submission_id:string|null;keys:Key[];submissions:Submission[]};
export function Editor(){
 const [state,setState]=useState<State|null>(null),[csrf,setCsrf]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[secret,setSecret]=useState<string|null>(null),[selected,setSelected]=useState<(Submission&{payload:JournalSnapshot})|null>(null),[consent,setConsent]=useState(false),[date,setDate]=useState(''),[community,setCommunity]=useState<JournalCommunity>('freedom');
 async function get<T>(path:string):Promise<T>{const response=await fetch('/api/v1'+path,{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.detail||'目前無法讀取。');return data;}
 const generation=useRef(0),actor=useRef<Session|null>(null);
 const current=(revision:number)=>revision===generation.current&&!document.hidden;
 function clearPrivate(){actor.current=null;setCsrf('');setSecret(null);setSelected(null);setConsent(false);setDate('');setState(null);setBusy(false);}
 useEffect(()=>{
  const refresh=async()=>{const revision=++generation.current;clearPrivate();setError('');try{const session=await get<Session>('/session');if(!current(revision))return;const data=await get<State>('/me/community-journal');if(current(revision)){actor.current=session;setCsrf(session.csrf_token);setState(data);}}catch(e){if(current(revision)){++generation.current;clearPrivate();setError(e instanceof Error?e.message:'無法讀取。');}}};
  const visible=()=>{if(document.hidden){++generation.current;clearPrivate();setError('');}else void refresh();};
  void refresh();document.addEventListener('visibilitychange',visible);
  return()=>{++generation.current;actor.current=null;document.removeEventListener('visibilitychange',visible);};
 },[]);
 async function write(path:string,body:unknown,version?:string){
  const response=await fetch('/api/v1/me/community-journal'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':crypto.randomUUID(),...(version?{'If-Match':`"${version}"`}:{})},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.detail||'操作未完成。');return data;
 }
 async function act<T>(action:()=>Promise<T>,commit?:(result:T)=>void){
  const revision=++generation.current,startedActor=actor.current;
  if(!startedActor||document.hidden)return;
  setBusy(true);setError('');
  try{
   const result=await action();if(!current(revision))return;
   const data=await get<State>('/me/community-journal');if(!current(revision))return;
   const session=await get<Session>('/session');if(!current(revision))return;
   if(session.user.user_id!==startedActor.user.user_id||session.csrf_token!==startedActor.csrf_token)throw new Error('登入狀態已變更。');
   setState(data);commit?.(result);
  }catch(e){if(current(revision)){++generation.current;clearPrivate();setError((e instanceof Error?e.message:'操作未確認。')+' 請重新整理核對狀態。');}}
  finally{if(current(revision))setBusy(false);}
 }
 const stories=selected?Object.fromEntries(communitySnapshot(selected.payload,community).journals.map(j=>[j.date,{...journalView(j),published:false}])):{};
 return <main className="page-main"><a href="/journal">回到共創誌</a><h1>共創誌投稿審閱</h1>{error&&<p role="alert">{error}</p>}{!state&&!error&&<p role="status">讀取中…</p>}{state&&<>
 <section><h2>投稿金鑰</h2><p>金鑰只能投稿草稿。只顯示一次，請交給你的投稿工具妥善保存。</p><button className="primary-button" disabled={busy} onClick={()=>void act(()=>write('/keys',{label:'Mio 日誌同步',expires_in_days:30}),data=>setSecret(data.token))}>建立 30 天投稿金鑰</button>{secret&&<div><code>{secret}</code><button onClick={()=>setSecret(null)}>已保存，隱藏金鑰</button></div>}<ul>{state.keys.map(k=><li key={k.key_id}>{k.label} · {k.revoked_at?'已撤銷':`到期 ${k.expires_at}`} {!k.revoked_at&&<button disabled={busy} onClick={()=>void act(()=>write('/keys/'+k.key_id+'/revoke',{}),()=>setSecret(null))}>撤銷</button>}</li>)}</ul></section>
 <section><h2>投稿版本</h2><p>發布會以這份完整快照取代公開內容。未列入的文章與人物也會從公開頁移除。</p>{!state.submissions.length&&<p>還沒有投稿。</p>}<ul>{state.submissions.map(s=><li key={s.submission_id}>{s.created_at} · {s.status==='ready_for_review'?'待審閱':s.status==='published'?'公開中':s.status==='withdrawn'?'已撤回':'歷史版本'} <button disabled={busy} onClick={()=>void act(()=>get<Submission&{payload:JournalSnapshot}>('/me/community-journal/submissions/'+s.submission_id),data=>{setSelected(data);setCommunity(data.payload.journals[0]?communityOf(data.payload.journals[0]):'freedom');setDate(data.payload.journals[0]?.date||'');setConsent(false);})}>查看內容</button></li>)}</ul></section>
 {selected&&<section><h2>完整快照預覽</h2><p>來源版本：<code>{selected.source_revision}</code></p><p>內容摘要：<code>{selected.payload_sha256}</code></p><h3>人物資料（{selected.payload.people.length} 位）</h3>{selected.payload.people.map(p=><div key={communityOf(p)+':'+p.slug}><h4>{communityLabel(communityOf(p))} / {p.display_name}</h4><p>{p.role} · {p.category} · {p.tags.join('、')}</p><p>{p.intro}</p></div>)}<label>文章 <select value={community+':'+date} onChange={e=>{const entry=selected.payload.journals.find(j=>communityOf(j)+':'+j.date===e.target.value);if(entry){setCommunity(communityOf(entry));setDate(entry.date);}}}>{selected.payload.journals.map(j=><option key={communityOf(j)+':'+j.date} value={communityOf(j)+':'+j.date}>{communityLabel(communityOf(j))} / {j.date} {j.title}</option>)}</select></label>{date&&<Journal key={community} community={community} date={date} people={communitySnapshot(selected.payload,community).people.map(personView)} stories={stories} onDateChange={setDate}/>}{selected.status==='ready_for_review'&&<><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我已核對這份快照全部內容，並確認可以公開。</label><button className="primary-button" disabled={!consent||busy} onClick={()=>void act(()=>write('/submissions/'+selected.submission_id+'/publish',{consent_to_publish:true,payload_sha256:selected.payload_sha256},state.aggregate_version),()=>{setSelected(null);setConsent(false);})}>發布這個版本</button><button disabled={busy} onClick={()=>void act(()=>write('/submissions/'+selected.submission_id+'/discard',{}),()=>setSelected(null))}>捨棄這份草稿</button></>}</section>}
 {state.published_submission_id&&<button disabled={busy} onClick={()=>void act(()=>write('/withdraw',{},state.aggregate_version),()=>setSelected(null))}>撤回目前公開版本</button>}
 </>}</main>;
}
