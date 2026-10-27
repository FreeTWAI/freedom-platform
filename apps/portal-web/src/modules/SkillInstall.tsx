import {useId,useRef,useState} from 'react';
import {SKILL_INSTALL_TARGETS,SkillInstallError,buildInstallZip,fetchInstallBundle,installCommands,pickSkillsFolder,supportsFolderInstall,writeBundleToFolder,type InstallBundle,type SkillInstallTarget} from './skill-install-client';
import './SkillInstall.css';

type Status={kind:'idle'|'busy'|'done'|'error';text:string};

/** 技能書介紹視窗裡的「安裝到我的 Agent」。只寫入使用者在選擇視窗明確選定的資料夾。 */
export function SkillInstall({bookId}:{bookId:string}){
  const id=useId(),[target,setTarget]=useState<SkillInstallTarget>('claude-code');
  const [status,setStatus]=useState<Status>({kind:'idle',text:''}),[commands,setCommands]=useState<{shell:string;powershell:string}|null>(null);
  const cached=useRef<Promise<InstallBundle>|null>(null),folderSupported=supportsFolderInstall(),where=SKILL_INSTALL_TARGETS[target];
  function bundle(){
    if(!cached.current){cached.current=fetchInstallBundle(bookId);cached.current.catch(()=>{cached.current=null;});}
    return cached.current;
  }
  async function run(action:()=>Promise<string>){
    setStatus({kind:'busy',text:'正在取得並驗證收錄版本…'});
    try{setStatus({kind:'done',text:await action()});}
    catch(error){
      if(error instanceof SkillInstallError&&error.code==='cancelled'){setStatus({kind:'idle',text:''});return;}
      setStatus({kind:'error',text:error instanceof SkillInstallError?error.message:'安裝沒有完成，請改用下載或指令。'});
    }
  }
  const installFolder=()=>run(async()=>{
    // 先開選擇視窗（必須在使用者點擊的當下），同時下載檔案包。
    const pending=bundle(),root=await pickSkillsFolder(target),value=await pending;
    const result=await writeBundleToFolder(root,value,target,message=>window.confirm(message));
    return '已安裝「'+value.name+'」到 '+result.where+'（版本 '+value.commit.slice(0,12)+'，'+value.files.length+' 個檔案）。重新開啟 '+where.label+' 後即可使用。';
  });
  const downloadZip=()=>run(async()=>{
    const value=await bundle(),link=document.createElement('a');
    link.href=URL.createObjectURL(buildInstallZip(value,target));link.download=value.name+'.zip';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),10_000);
    return '已下載 '+value.name+'.zip。解壓縮後，把「'+value.name+'」資料夾放進 '+where.userPath+'。';
  });
  const showCommands=()=>run(async()=>{
    const value=installCommands(await bundle(),target);setCommands(value);
    await navigator.clipboard?.writeText(value.shell).catch(()=>{});
    return '已複製 macOS／Linux 指令；Windows 請用下方 PowerShell。';
  });
  const busy=status.kind==='busy';
  return <details className="skill-intro-details skill-install">
    <summary>安裝到我的 Agent</summary>
    <div className="stack">
      <fieldset className="skill-install-targets" disabled={busy}><legend className="field-hint">裝到哪個 Agent</legend>
        {(Object.keys(SKILL_INSTALL_TARGETS) as SkillInstallTarget[]).map(key=><label key={key}><input type="radio" name={id+'-target'} value={key} checked={target===key} onChange={()=>{setTarget(key);setCommands(null);}}/>{SKILL_INSTALL_TARGETS[key].label}</label>)}
      </fieldset>
      <p className="field-hint">個人資料夾：<code>{where.userPath}</code>　專案資料夾：<code>{where.projectPath}</code></p>
      <div className="actions">
        {folderSupported&&<button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={installFolder}>一鍵安裝</button>}
        <button type="button" className={'btn btn-small '+(folderSupported?'btn-ghost':'btn-primary')} disabled={busy} onClick={downloadZip}>下載 zip</button>
        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={showCommands}>複製安裝指令</button>
      </div>
      <p role="status" aria-live="polite" className={'skill-install-status '+status.kind}>{status.text}</p>
      {commands&&<div className="stack"><p className="field-hint">macOS／Linux</p><pre className="skill-intro-command"><code>{commands.shell}</code></pre><p className="field-hint">Windows PowerShell</p><pre className="skill-intro-command"><code>{commands.powershell}</code></pre></div>}
      <p className="field-hint">{folderSupported?'按「一鍵安裝」後選擇 '+where.userPath+'（選到上一層的 .claude 等資料夾也可以）。這類資料夾預設隱藏：macOS 按 Cmd＋Shift＋.，Windows 可在網址列貼上路徑。':'這個瀏覽器不能直接寫入資料夾；桌面版 Chrome 或 Edge 可以一鍵安裝。'}</p>
      <p className="field-hint">安裝的是工坊收錄版本，每個檔案都會先核對內容。網頁只能寫入你選的那個資料夾，不會讀取其他檔案；資料夾內的 .freedom-install.json 只記錄版本與指紋。</p>
    </div>
  </details>;
}
