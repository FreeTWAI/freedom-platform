import { useEffect, useRef, useState } from 'react';
import { PlatformLogo } from '../modules/PlatformLogo';
import { GAME_SHARE_PLATFORMS, gameSocialLink, type GameSharePlatform } from './result-share';

/** CK-6: every result shares this chooser; selecting a logo performs no network action. */
export function ResultShare({link,text,ready,sharing,onNative,onStatus}:{
  link:string;text:string;ready:boolean;sharing:boolean;onNative:()=>void;onStatus:(message:string)=>void;
}) {
  const [platform,setPlatform]=useState<GameSharePlatform|null>(null),[manual,setManual]=useState(false),field=useRef<HTMLTextAreaElement>(null),active=useRef(true),copying=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{if(manual){field.current?.focus();field.current?.select();}},[manual]);
  const label=GAME_SHARE_PLATFORMS.find(p=>p.id===platform)?.label;
  async function copyText(){
    if(copying.current)return;copying.current=true;
    try{await navigator.clipboard.writeText(text);if(active.current){setManual(false);onStatus('文案與挑戰連結已複製。成果圖片請下載後附上。');}}
    catch{if(active.current){setManual(true);onStatus('請長按或選取下方文案複製，成果仍在這裡。');}}
    finally{copying.current=false;}
  }
  return <div className="ad-external-share">
    <h3>分享到其他社群</h3>
    <div className="ad-social-targets" role="group" aria-label="選擇分享平台">{GAME_SHARE_PLATFORMS.map(p=><button className="ad-secondary" key={p.id} type="button" aria-label={`分享到 ${p.label}`} aria-pressed={platform===p.id} onClick={()=>setPlatform(value=>value===p.id?null:p.id)}><PlatformLogo platform={p.id}/><span>{p.label}</span><i aria-hidden="true"/></button>)}</div>
    {platform&&<div className="ad-social-instructions" aria-label={`${label} 分享方式`}>
      <p>{platform==='instagram'?'先用系統選單選 Instagram；若沒有出現，可下載成果 PNG、複製文案，再開啟 Instagram 貼上。系統可用的 App 依裝置而定。':platform==='facebook'?'開啟 Facebook 分享同題挑戰連結。想附成果圖，可下載 PNG 並複製文案，再建立貼文。':'開啟編輯頁會帶入文案與同題挑戰連結；成果 PNG 請下載後自行附上。'}</p>
      {platform==='instagram'&&<button className="ad-secondary" disabled={!ready||sharing} onClick={onNative}>用系統選單選 Instagram</button>}
      <button className="ad-secondary" onClick={()=>void copyText()}>複製分享文案</button>
      <a className="ad-button" href={gameSocialLink(platform,link,text)} target="_blank" rel="noopener noreferrer" onClick={()=>onStatus(`已開啟 ${label} 分享入口，請在該平台確認發布。`)}>開啟 {label}{platform==='instagram'?'':' 分享'} ↗</a>
      <small>由你在目的平台確認發布；這裡不會自動發文。</small>
    </div>}
    {manual&&<label className="ad-link-field">分享文案<textarea ref={field} readOnly rows={6} value={text} onFocus={e=>e.currentTarget.select()}/></label>}
  </div>;
}
