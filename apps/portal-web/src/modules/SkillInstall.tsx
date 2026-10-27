import {useId,useRef,useState} from 'react';
import {SKILL_INSTALL_TARGETS,SkillInstallError,buildInstallZip,copyText,fetchInstallBundle,installCommands,type InstallBundle,type SkillInstallTarget} from './skill-install-client';
import './SkillInstall.css';

type Status={kind:'idle'|'busy'|'done'|'error';text:string};

/** 技能書介紹視窗裡的「安裝到我的 Agent」。提供 zip 下載與可複製的安裝指令。 */
export function SkillInstall({bookId}:{bookId:string}){
  const id=useId(),[target,setTarget]=useState<SkillInstallTarget>('claude-code');
  const [status,setStatus]=useState<Status>({kind:'idle',text:''}),[commands,setCommands]=useState<{shell:string;powershell:string}|null>(null);
  const [name,setName]=useState<string|null>(null);
  const cached=useRef<Promise<InstallBundle>|null>(null),where=SKILL_INSTALL_TARGETS[target];
  function bundle(){
    if(!cached.current){cached.current=fetchInstallBundle(bookId).then(value=>{setName(value.name);return value;});cached.current.catch(()=>{cached.current=null;});}
    return cached.current;
  }
  async function run(action:()=>Promise<string>){
    setStatus({kind:'busy',text:'正在取得並驗證收錄版本…'});
    try{setStatus({kind:'done',text:await action()});}
    catch(error){
      setStatus({kind:'error',text:error instanceof SkillInstallError?error.message:'安裝沒有完成，請改用下載或指令。'});
    }
  }
  const downloadZip=()=>run(async()=>{
    const value=await bundle(),link=document.createElement('a');
    link.href=URL.createObjectURL(buildInstallZip(value,target));link.download=value.name+'.zip';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),10_000);
    return '已下載 '+value.name+'.zip。解壓縮後，把「'+value.name+'」資料夾放進 '+where.userPath+'。';
  });
  const showCommands=()=>run(async()=>{
    const value=installCommands(await bundle(),target);setCommands(value);
    return await copyText(navigator.clipboard,value.shell)
      ?'已複製 macOS／Linux 指令；Windows 請用下方 PowerShell。'
      :'無法自動複製；指令在下方，請自行選取複製（macOS／Linux 用第一段，Windows 用 PowerShell）。';
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
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={downloadZip}>下載 zip</button>
        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={showCommands}>複製安裝指令</button>
      </div>
      <p role="status" aria-live="polite" className={'skill-install-status '+status.kind}>{status.text}</p>
      {commands&&<div className="stack"><p className="field-hint">macOS／Linux</p><pre className="skill-intro-command"><code>{commands.shell}</code></pre><p className="field-hint">Windows PowerShell</p><pre className="skill-intro-command"><code>{commands.powershell}</code></pre></div>}
      <p className="field-hint">解壓縮後，把{name?'「'+name+'」資料夾':'zip 內的技能資料夾'}放進 <code>{where.userPath}</code>，或使用安裝指令。</p>
      <p className="field-hint">安裝的是工坊收錄版本，每個檔案都會先核對內容。指令會先在暫存資料夾準備檔案；若已有同名技能資料夾就停止，不覆寫、不刪除既有檔案。.freedom-install.json 只記錄版本與指紋。</p>
    </div>
  </details>;
}
