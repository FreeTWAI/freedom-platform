import {useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import {ApiError, PortalClient} from '../api';
import type {SessionPayload} from '../types';
import {MemberGameUpload as UploadController, memberGameLeaveRisk, type GameCommand, type MemberGameTransport} from './member-game-upload';
import './community-game-submission.css';

type Owner = {client:PortalClient;userId:string;generation:number;controller:UploadController;check:()=>Promise<void>};
const validSession = (value:SessionPayload) => typeof value?.user?.user_id==='string' && typeof value.csrf_token==='string' && value.csrf_token.length>0;

/** Anonymous /play makes no member request until this separate area is explicitly opened. */
export function MemberGameUpload({hidden}:{hidden:boolean}) {
  const [owner,setOwner]=useState<Owner|null>(null),[connecting,setConnecting]=useState(false),[notice,setNotice]=useState(''),[verification,setVerification]=useState<'ready'|'checking'|'failed'>('ready');
  const openButton=useRef<HTMLButtonElement>(null),restoreFocus=useRef(false);
  const active=useRef<Owner|null>(null),lifetime=useRef(0),connectingRef=useRef(false),sessionRead=useRef<AbortController|null>(null);
  function end(message:string) {
    lifetime.current++;sessionRead.current?.abort();sessionRead.current=null;
    const previous=active.current;active.current=null;previous?.controller.dispose();if(previous)previous.client.csrfToken=null;
    connectingRef.current=false;setConnecting(false);setOwner(null);setNotice(message);setVerification('ready');restoreFocus.current=true;
  }
  async function connect() {
    if(connectingRef.current||active.current)return;
    connectingRef.current=true;setConnecting(true);setNotice('');
    const epoch=++lifetime.current,client=new PortalClient(),read=new AbortController();sessionRead.current=read;
    try {
      const session=await client.get<SessionPayload>('/session',{skipAuthHandler:true,background:true,suppressConsole:true,signal:read.signal});
      if(epoch!==lifetime.current)return;
      if(!validSession(session))throw Error('invalid_session');
      client.csrfToken=session.csrf_token;const generation=client.sessionGeneration;
      const current=()=>active.current?.client===client && lifetime.current===epoch && client.sessionGeneration===generation;
      const expired=()=>{if(active.current?.client===client)end('登入或帳號已變更，已清除本頁檔案與操作。請重新開啟會員管理；未確認操作仍可能已保存。');};
      client.onUnauthorized=expired;
      let checks=0;
      async function check(signal?:AbortSignal) {
        if(!current())throw Error('stale_session');
        const attempt=++checks;setVerification('checking');
        try {
          const next=await client.get<SessionPayload>('/session',{skipAuthHandler:true,background:true,suppressConsole:true,signal});
          if(!current())throw Error('stale_session');
          if(!validSession(next)||next.user.user_id!==session.user.user_id||next.csrf_token!==session.csrf_token){expired();throw Error('changed_session');}
          if(current()&&attempt===checks)setVerification('ready');
        } catch(error) {if(current()){if(error instanceof ApiError&&(error.status===401||error.status===403||error.accessExpired))expired();else if(attempt===checks)setVerification('failed');}throw error;}
      }
      const transport:MemberGameTransport={
        current,
        // A later denial cannot settle an earlier unknown command. Controller owns that distinction.
        refused:error=>error instanceof ApiError&&error.definitiveResponse&&!error.network&&['invalid_game_source','game_source_type','game_source_too_large','version_required','idempotency_required','version_conflict','game_draft_withdrawn','game_draft_not_found','game_draft_quota'].includes(error.code??''),
        async read(id,signal){await check(signal);if(!current())throw Error('stale_session');try{return await client.get(`/me/game-drafts/${id}`,{signal,background:true,suppressConsole:true});}catch(error){if(current()&&error instanceof ApiError&&(error.status===401||error.status===403||error.accessExpired))expired();throw error;}},
        async send(command:GameCommand,signal){
          await check(signal);if(!current())throw Error('stale_session');
          try {
            if(command.kind==='create')return await client.post('/me/game-drafts',command.body,{idempotencyKey:command.key,signal,background:true,suppressConsole:true});
            if(command.kind==='upload')return await client.uploadGameSource(command.before.game_id,command.source!,{idempotencyKey:command.key,ifMatch:command.before.version,signal});
            return await client.post(`/me/game-drafts/${command.before.game_id}/withdraw`,{},{idempotencyKey:command.key,ifMatch:command.before.version,signal,background:true,suppressConsole:true});
          } catch(error) {if(current()&&error instanceof ApiError&&(error.status===401||error.status===403||error.accessExpired))expired();throw error;}
        },
      };
      const next={client,userId:session.user.user_id,generation,controller:new UploadController(transport),check:()=>check()};
      active.current=next;setOwner(next);setNotice('');setVerification('ready');
    } catch {if(epoch===lifetime.current)setNotice('無法確認會員登入。請先回自由工坊登入及完成入門，再回到此頁開啟。');}
    finally {if(epoch===lifetime.current){connectingRef.current=false;setConnecting(false);sessionRead.current=null;}}
  }
  useEffect(()=>{if(!owner&&!connecting&&restoreFocus.current){restoreFocus.current=false;openButton.current?.focus();}},[owner,connecting]);
  useEffect(()=>{
    let checking=false;
    const check=()=>{if(document.hidden||checking||!active.current)return;checking=true;void active.current.check().catch(()=>{}).finally(()=>{checking=false;});};
    const hide=()=>end('本頁管理已關閉；請重新確認會員登入。');
    const timer=setInterval(check,60_000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);window.addEventListener('pagehide',hide);
    return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);window.removeEventListener('pagehide',hide);lifetime.current++;sessionRead.current?.abort();active.current?.controller.dispose();active.current=null;};
  },[]);
  return <section hidden={hidden} className="game-submission" aria-label="會員私有遊戲來源">
    <details><summary>上傳自己的遊戲（會員私有保存）</summary><div className="game-submission-content">
      <p>單一 UTF-8 .html，最多 256 KiB。只保存私有來源；尚無審核、試玩或公開上架。保存是否開放以目前伺服器政策為準。</p>
      {owner?<><div hidden={verification!=='ready'}><UploadWorkspace key={`${owner.userId}:${owner.generation}`} controller={owner.controller}/></div>{verification!=='ready'&&<p role="status">{verification==='checking'?'正在重新確認會員登入，暫時隱藏私人資料。':'無法確認會員登入，私人資料暫時隱藏；本頁原操作與檔案仍保留。'}</p>}{verification==='failed'&&<button className="fw-arcade-secondary" onClick={()=>void owner.check().catch(()=>{})}>重新確認會員登入</button>}<button className="fw-arcade-secondary" onClick={()=>{
        const state=owner.controller.getSnapshot();
        if(memberGameLeaveRisk(state)&&!window.confirm('關閉會清除本頁檔案與重試資料。未確認操作可能已保存，關閉不等於撤回。仍要關閉？'))return;
        end('已清除本頁檔案與會員管理資料；伺服器上的已存草稿不會刪除。');
      }}>關閉會員管理並清除本頁資料</button></>:<button ref={openButton} className="fw-arcade-secondary" disabled={connecting} onClick={()=>void connect()}>{connecting?'正在確認登入…':'使用目前會員帳號開啟'}</button>}
      {notice&&<p role="status">{notice}</p>}
      {!owner&&<a href="/">回自由工坊登入／完成入門</a>}
      <p>來源不會在此頁執行或預覽。請勿上傳密碼、金鑰、私人資料或未授權內容。GitHub 公開投稿是下方的另一個選項。</p>
    </div></details>
  </section>;
}

function UploadWorkspace({controller}:{controller:UploadController}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot),id=useId();
  const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[lookup,setLookup]=useState(''),[consent,setConsent]=useState(false),[withdraw,setWithdraw]=useState(false);
  const withdrawButton=useRef<HTMLButtonElement>(null);
  const idle=state.phase==='idle',draft=state.draft;
  useEffect(()=>{setConsent(false);setWithdraw(false);},[state.fileEpoch,state.draft?.version]);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{const s=controller.getSnapshot();if(memberGameLeaveRisk(s)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[controller]);
  return <div className="member-game-workspace">
    <p>名稱與介紹可先建立私人草稿，並不代表來源保存已開放。草稿編號需要自行保留；重載後貼上編號讀取，沒有自動列出所有草稿。</p>
    <form onSubmit={event=>{event.preventDefault();void controller.create(title,description);}}>
      <label className="game-submission-field" htmlFor={`${id}-title`}>私人遊戲名稱<input id={`${id}-title`} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={80} disabled={!idle}/></label>
      <label className="game-submission-field" htmlFor={`${id}-description`}>私人玩法介紹<textarea id={`${id}-description`} value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000} rows={3} disabled={!idle}/></label>
      <button className="fw-arcade-secondary" disabled={!idle} type="submit">建立私人草稿（不含檔案）</button>
    </form>
    <form onSubmit={event=>{event.preventDefault();void controller.load(lookup.trim().toLowerCase());}}>
      <label className="game-submission-field" htmlFor={`${id}-lookup`}>已有草稿編號<input id={`${id}-lookup`} value={lookup} onChange={e=>setLookup(e.target.value)} maxLength={36} spellCheck={false} disabled={!idle}/></label>
      <button className="fw-arcade-secondary" disabled={!idle} type="submit">讀取這份私人草稿</button>
    </form>
    {state.draftId&&<div className="game-submission-field"><label htmlFor={`${id}-saved-id`}>請保留這個草稿編號</label><input id={`${id}-saved-id`} readOnly value={state.draftId} onFocus={e=>e.currentTarget.select()}/><button className="fw-arcade-secondary" disabled={!idle} onClick={()=>void controller.load(state.draftId)}>重新讀取目前狀態</button></div>}
    <p role="status" aria-live="polite">{state.phase==='writing'?'正在傳送，請勿重複操作。':state.phase==='selecting'?'正在本機讀取檔案，尚未傳送。':state.phase==='reading'?'正在確認目前狀態…':state.status}</p>
    {state.retry&&<button className="fw-arcade-secondary" disabled={state.phase!=='unknown'} onClick={()=>void controller.retry()}>重試原操作（不建立新操作）</button>}
    {draft&&<div className="member-game-current" aria-label="目前私人草稿狀態">
      <h3>{draft.title}</h3><p>{draft.description}</p><p>狀態：{draft.state==='withdrawn'?'已撤回':draft.state==='quarantined'?'已私有保存，未審核':'僅有草稿，未上傳來源'}；版本 {draft.version}，來源版本 {draft.source_revision}。</p>
      {draft.state!=='withdrawn'&&<>
        <p>{draft.upload_available?'目前可傳送私有來源；送出時仍會重新核對政策與容量。':'來源保存尚未開放或暫時無法使用，目前不能上傳。'}</p>
        <label className="game-submission-field" htmlFor={`${id}-file`}>選擇單一 HTML 遊戲檔案<input key={state.fileEpoch} id={`${id}-file`} type="file" accept=".html,text/html" disabled={!idle||!draft.upload_available} onChange={e=>{setConsent(false);void controller.selectFile(e.currentTarget.files?.[0]??null);}}/></label>
        {state.selected&&<><p>已選擇 {state.selected.name}（{state.selected.byteSize} bytes），尚未傳送。</p><button className="fw-arcade-secondary" disabled={!idle} onClick={controller.clearFile}>清除已選檔案</button><label className="game-submission-consent"><input type="checkbox" disabled={!idle} checked={consent} onChange={e=>setConsent(e.target.checked)}/>我確認有權提供此檔案，同意傳給自由工坊私有保存；這不是公開發布授權。</label></>}
        <button className="fw-arcade-secondary" disabled={!idle||!state.selected||!consent||!draft.upload_available} onClick={()=>void controller.change('upload')}>傳送檔案到私有保存</button>
        <button ref={withdrawButton} className="fw-arcade-secondary" disabled={!idle} aria-expanded={withdraw} aria-controls={`${id}-withdraw`} onClick={()=>setWithdraw(value=>!value)}>撤回這份私人草稿</button>
        {withdraw&&<div id={`${id}-withdraw`} className="member-game-withdraw" role="group" aria-label="確認撤回私人草稿" aria-describedby={`${id}-withdraw-warning`}><p id={`${id}-withdraw-warning`}>撤回後不能再上傳，這個階段不能恢復。來源歷史與已用容量會保留，不是刪除檔案。</p><button className="fw-arcade-secondary" disabled={!idle} onClick={()=>{setWithdraw(false);void controller.change('withdraw');}}>確認撤回</button><button className="fw-arcade-secondary" disabled={!idle} onClick={()=>{setWithdraw(false);withdrawButton.current?.focus();}}>取消撤回</button></div>}
      </>}
    </div>}
    <p>選檔和重試資料只在本頁記憶體。重新整理、離站或切換帳號會清除；未確認寫入可能已完成。已保存來源沒有下載或預覽入口。</p>
  </div>;
}
