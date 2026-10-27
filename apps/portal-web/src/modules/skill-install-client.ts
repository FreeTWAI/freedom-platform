/**
 * 技能書一鍵安裝（瀏覽器端）。
 * 檔案包來自同源 /api/v1/skills/:id/install-bundle（CSP connect-src 'self'），
 * 寫入前逐檔重算 git blob SHA-1 與 manifest digest，任何不符就整批放棄。
 */
export const SKILL_INSTALL_RECEIPT_FILE='.freedom-install.json';
export const SKILL_INSTALL_TARGETS={
  'claude-code':{label:'Claude Code',userPath:'~/.claude/skills',windowsPath:'$env:USERPROFILE\\.claude\\skills',projectPath:'.claude/skills'},
  codex:{label:'Codex',userPath:'~/.codex/skills',windowsPath:'$env:USERPROFILE\\.codex\\skills',projectPath:'.agents/skills'},
  openclaw:{label:'OpenClaw',userPath:'~/.openclaw/skills',windowsPath:'$env:USERPROFILE\\.openclaw\\skills',projectPath:'skills'},
} as const;
export type SkillInstallTarget=keyof typeof SKILL_INSTALL_TARGETS;
export type InstallFile={path:string;sha:string;bytes:Uint8Array};
export type InstallBundle={book_id:string;name:string;repository:string;commit:string;manifest_digest:string;files:InstallFile[]};
export class SkillInstallError extends Error{constructor(public code:string,message:string){super(message);}}

function hex(buffer:ArrayBuffer){return [...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function gitBlobSha1(bytes:Uint8Array){
  const head=new TextEncoder().encode('blob '+bytes.length+'\0'),all=new Uint8Array(head.length+bytes.length);
  all.set(head);all.set(bytes,head.length);
  return hex(await crypto.subtle.digest('SHA-1',all));
}
async function manifestDigest(files:readonly {path:string;sha:string}[]){
  const text=[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).map(file=>file.path+' '+file.sha).join('\n');
  return 'sha256:'+hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
}
export function isSafeInstallPath(path:string){
  return path.length>0&&path.length<=300&&!path.startsWith('/')&&!path.includes('\\')&&!/[\u0000-\u001f]/.test(path)
    &&path.split('/').every(segment=>segment!==''&&segment!=='.'&&segment!=='..');
}
function decodeBase64(value:string){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}

/** 驗證伺服器回應的形狀與內容；不信任任何欄位。 */
export async function parseInstallBundle(data:unknown):Promise<InstallBundle>{
  const value=data as Record<string,unknown>|null;
  if(!value||value.format!=='freedom.skill-install-bundle/v1'||typeof value.book_id!=='string'||typeof value.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.name)
    ||typeof value.repository!=='string'||!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(value.repository)||typeof value.commit!=='string'||!/^[0-9a-f]{40}$/.test(value.commit)||typeof value.manifest_digest!=='string'||!Array.isArray(value.files))
    throw new SkillInstallError('bundle_invalid','安裝資料格式不正確。');
  const files:InstallFile[]=[];
  for(const raw of value.files as unknown[]){
    const file=raw as Record<string,unknown>|null;
    if(!file||typeof file.path!=='string'||!isSafeInstallPath(file.path)||typeof file.sha!=='string'||typeof file.content_base64!=='string')throw new SkillInstallError('bundle_invalid','安裝資料格式不正確。');
    const bytes=decodeBase64(file.content_base64);
    if(await gitBlobSha1(bytes)!==file.sha)throw new SkillInstallError('integrity_failed','檔案驗證失敗：'+file.path);
    files.push({path:file.path,sha:file.sha,bytes});
  }
  if(!files.some(file=>file.path==='SKILL.md')||await manifestDigest(files)!==value.manifest_digest)throw new SkillInstallError('integrity_failed','技能書指紋不一致，已停止安裝。');
  return {book_id:value.book_id,name:value.name,repository:value.repository,commit:value.commit,manifest_digest:value.manifest_digest,files};
}

export async function fetchInstallBundle(bookId:string,signal?:AbortSignal){
  const response=await fetch('/api/v1/skills/'+encodeURIComponent(bookId)+'/install-bundle',{credentials:'omit',signal,headers:{Accept:'application/json'}});
  const data=await response.json().catch(()=>null) as {error?:string;message?:string}|null;
  if(!response.ok)throw new SkillInstallError(data?.error??'bundle_unavailable',data?.message??'安裝資料暫時無法取得，請稍後再試。');
  return parseInstallBundle(data);
}

/** 本機收據：只有版本與指紋，不含路徑、帳號或檔案內容。不是平台的 verified 安裝紀錄。 */
export function installReceipt(bundle:InstallBundle,target:SkillInstallTarget,method:'folder'|'zip'){
  return {schema:'freedom.local-install-receipt/v0',package:{book_id:bundle.book_id,name:bundle.name,repository:bundle.repository,commit:bundle.commit},
    target,method,manifest_digest:bundle.manifest_digest,file_count:bundle.files.length,installed_at:new Date().toISOString()};
}

// ---- 寫入資料夾（File System Access API；Chrome／Edge 桌面版） ----
type WritableLike={write(data:Uint8Array|string):Promise<void>;close():Promise<void>};
type FileHandleLike={createWritable():Promise<WritableLike>};
export type DirectoryHandleLike={name:string;getDirectoryHandle(name:string,options?:{create?:boolean}):Promise<DirectoryHandleLike>;getFileHandle(name:string,options?:{create?:boolean}):Promise<FileHandleLike>;removeEntry(name:string,options?:{recursive?:boolean}):Promise<void>;keys():AsyncIterable<string>;requestPermission?(options:{mode:'readwrite'}):Promise<string>};
type PickerWindow=Window&{showDirectoryPicker?:(options:{id?:string;mode?:'readwrite'})=>Promise<DirectoryHandleLike>};

export function supportsFolderInstall(){return typeof window!=='undefined'&&window.isSecureContext&&typeof (window as PickerWindow).showDirectoryPicker==='function';}
export async function pickSkillsFolder(target:SkillInstallTarget){
  const picker=(window as PickerWindow).showDirectoryPicker;
  if(!picker||!window.isSecureContext)throw new SkillInstallError('unsupported','這個瀏覽器不能直接寫入資料夾，請改用下載。');
  try{return await picker({id:'freedom-skills-'+target,mode:'readwrite'});}
  catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw new SkillInstallError('cancelled','已取消。');throw error;}
}

const AGENT_HOME=new Set(['.claude','.codex','.openclaw','.agents']);
export async function writeBundleToFolder(root:DirectoryHandleLike,bundle:InstallBundle,target:SkillInstallTarget,confirm:(message:string)=>Promise<boolean>|boolean){
  if(root.requestPermission&&await root.requestPermission({mode:'readwrite'})!=='granted')throw new SkillInstallError('denied','沒有取得寫入權限。');
  let base=root,where=root.name;
  if(root.name!=='skills'&&root.name!==bundle.name){
    // 選到 .claude 等 agent 家目錄時，自動放進底下的 skills。
    if(AGENT_HOME.has(root.name)){base=await root.getDirectoryHandle('skills',{create:true});where=root.name+'/skills';}
    else if(!await confirm('你選的資料夾是「'+root.name+'」，不是 skills。仍要裝在這裡嗎？'))throw new SkillInstallError('cancelled','已取消。');
  }
  let folder:DirectoryHandleLike|undefined=root.name===bundle.name?root:undefined,created=false;
  if(!folder){
    try{folder=await base.getDirectoryHandle(bundle.name,{create:false});}
    catch(error){if(!(error instanceof Error)||error.name!=='NotFoundError')throw error;}
  }
  if(folder!==root)where+='/'+bundle.name;
  if(folder)for await(const _ of folder.keys())throw new SkillInstallError('exists','「'+bundle.name+'」資料夾已經存在。為了不動到裡面的檔案，這次沒有覆寫；要更新請先自行移走或刪除這個資料夾再安裝，或改用下載 zip。');
  const entries=new Set<string>();
  try{
    if(!folder){folder=await base.getDirectoryHandle(bundle.name,{create:true});created=true;}
    for(const file of bundle.files){
      const parts=file.path.split('/');let directory=folder;
      for(const [index,segment] of parts.slice(0,-1).entries()){
        directory=await directory.getDirectoryHandle(segment,{create:true});
        if(index===0)entries.add(segment);
      }
      const handle=await directory.getFileHandle(parts[parts.length-1],{create:true});
      if(parts.length===1)entries.add(parts[0]);
      const writable=await handle.createWritable();
      await writable.write(file.bytes);await writable.close();
    }
    const handle=await folder.getFileHandle(SKILL_INSTALL_RECEIPT_FILE,{create:true});
    entries.add(SKILL_INSTALL_RECEIPT_FILE);
    const receipt=await handle.createWritable();
    await receipt.write(JSON.stringify(installReceipt(bundle,target,'folder'),null,2)+'\n');await receipt.close();
  }catch{
    // 只清理由本次安裝建立的資料夾或頂層項目；清理失敗仍回報原本的寫入失敗。
    if(created)await base.removeEntry(bundle.name,{recursive:true}).catch(()=>{});
    else if(folder)for(const name of entries)await folder.removeEntry(name,{recursive:true}).catch(()=>{});
    throw new SkillInstallError('write_failed','安裝沒有完成，已移除這次寫入的檔案；原有檔案沒有變動。');
  }
  return {where};
}

// ---- zip（store 模式，無相依） ----
const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table;})();
export function crc32(bytes:Uint8Array){let c=0xffffffff;for(const byte of bytes)c=CRC_TABLE[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
export function buildInstallZip(bundle:InstallBundle,target:SkillInstallTarget){
  const encoder=new TextEncoder(),u16=(v:number)=>[v&0xff,(v>>>8)&0xff],u32=(v:number)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
  const entries=[...bundle.files,{path:SKILL_INSTALL_RECEIPT_FILE,sha:'',bytes:encoder.encode(JSON.stringify(installReceipt(bundle,target,'zip'),null,2)+'\n')}]
    .map(file=>({name:encoder.encode(bundle.name+'/'+file.path),bytes:file.bytes,crc:crc32(file.bytes)}));
  const parts:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
  for(const entry of entries){
    // version 2.0, UTF-8 names, stored, fixed 1980-01-01 timestamp
    const common=[...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(entry.crc),...u32(entry.bytes.length),...u32(entry.bytes.length),...u16(entry.name.length),...u16(0)];
    const local=new Uint8Array([...u32(0x04034b50),...common]);
    parts.push(local,entry.name,entry.bytes);
    central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...common,...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),entry.name);
    offset+=local.length+entry.name.length+entry.bytes.length;
  }
  const size=central.reduce((sum,part)=>sum+part.length,0);
  const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(size),...u32(offset),...u16(0)]);
  return new Blob([...parts,...central,end].map(part=>part.slice().buffer),{type:'application/zip'});
}

// ---- CLI ----
export function installCommands(bundle:Pick<InstallBundle,'name'|'repository'|'commit'>,target:SkillInstallTarget){
  const where=SKILL_INSTALL_TARGETS[target],repo=bundle.repository.split('/')[1],extracted=repo+'-'+bundle.commit;
  const home=where.userPath.replace('~','$HOME'),exists='「'+bundle.name+'」資料夾已經存在，這次沒有覆寫；要更新請先自行移走或刪除舊資料夾，或改用下載 zip。';
  return {
    shell:'(t=$(mktemp -d) || exit 1; trap \'install_status=$?; rm -rf "$t" || install_status=$?; exit "$install_status"\' EXIT; curl -fsSL "https://codeload.github.com/'+bundle.repository+'/tar.gz/'+bundle.commit+'" -o "$t/bundle.tar.gz" && tar -xzf "$t/bundle.tar.gz" -C "$t" && test -f "$t/'+extracted+'/SKILL.md" && { if [ -e "'+home+'/'+bundle.name+'" ] || [ -L "'+home+'/'+bundle.name+'" ]; then printf \'%s\\n\' \''+exists+'\' >&2; exit 1; fi; mkdir -p "'+home+'" && mv "$t/'+extracted+'" "'+home+'/'+bundle.name+'"; })',
    powershell:"$ErrorActionPreference='Stop'; $d=\""+where.windowsPath+'"; $dest="$d\\'+bundle.name+'"; $t=Join-Path $env:TEMP ([guid]::NewGuid().ToString()); New-Item -ItemType Directory -Path $t | Out-Null; try { $z=Join-Path $t "bundle.zip"; Invoke-WebRequest "https://codeload.github.com/'+bundle.repository+'/zip/'+bundle.commit+'" -OutFile $z; Expand-Archive -LiteralPath $z -DestinationPath $t; $s=Join-Path $t "'+extracted+'"; if (!(Test-Path -LiteralPath "$s\\SKILL.md" -PathType Leaf)) { throw "找不到 SKILL.md，已停止安裝。" }; if (Test-Path -LiteralPath $dest) { throw "'+exists+'" }; New-Item -ItemType Directory -Force -Path $d | Out-Null; Move-Item -LiteralPath $s -Destination $dest } finally { Remove-Item -LiteralPath $t -Recurse -Force }',
  };
}
