import {communityCatalog,type SkillBook} from '../community/catalog.js';
import {Problem} from '../../packages/shared/problem.js';

/**
 * 技能書安裝的檔案包。
 *
 * 只服務目錄內已收錄、且鎖定 40 碼 source_commit 的技能書，不接受任意 repo 或分支，
 * 因此不會變成任意 GitHub 代理。commit 不可變，檔案包可長期快取。
 * 每個檔案以 git blob SHA-1 對照 tree 驗證；瀏覽器端再驗一次後才提供 zip 下載。
 * 這是「讀取收錄版本」，不是 SPEC-SKL-03 的 MemberSkillInstallation，也不產生 verified 狀態。
 */
export const SKILL_INSTALL_BUNDLE_FORMAT='freedom.skill-install-bundle/v1';
export const SKILL_INSTALL_LIMITS={files:300,totalBytes:8*1024*1024,fileBytes:2*1024*1024};
const EXCLUDED=[/^\.github\//,/^\.gitignore$/,/^\.gitattributes$/,/^tests?\//,/^\.vscode\//];
const REQUEST_TIMEOUT_MS=10_000;
const CACHE_LIMIT=32;

export type SkillInstallSource={book_id:string;owner:string;repo:string;commit:string;fallback_owner?:string;fallback_repo?:string};
export type SkillInstallFile={path:string;sha:string;size:number;content_base64:string};
export type SkillInstallBundle={format:typeof SKILL_INSTALL_BUNDLE_FORMAT;book_id:string;name:string;repository:string;commit:string;manifest_digest:string;total_bytes:number;files:SkillInstallFile[]};
export type SkillInstallFallbackRecord={book_id:string;original_repository:string;fallback_repository:string;commit:string;reason:'original_commit_missing';recorded_at:string};
type Fetcher=typeof fetch;
const recordedFallbacks=new Map<string,SkillInstallFallbackRecord>();
export function recordedSkillInstallFallbacks():SkillInstallFallbackRecord[]{return [...recordedFallbacks.values()];}
export function clearRecordedSkillInstallFallbacks(){recordedFallbacks.clear();}
export function parseGithubOwnerRepo(url:string|null|undefined):{owner:string;repo:string}|null{
  if(!url)return null;
  const match=/^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/?$/.exec(url);
  if(!match||match[2].endsWith('.git'))return null;
  return {owner:match[1],repo:match[2]};
}

export function skillInstallSource(bookId:string,books:readonly SkillBook[]=communityCatalog.skill_books):SkillInstallSource|null{
  const book=books.find(item=>item.id===bookId);
  const commit=book?.source_commit??book?.guide?.source_commit;
  if(!book||!commit||!/^[0-9a-f]{40}$/.test(commit))return null;
  const primary=parseGithubOwnerRepo(book.upstream_url?.trim()||book.repository_url);
  if(!primary)return null;
  const copy=parseGithubOwnerRepo(book.repository_url);
  const distinctCopy=copy&&(copy.owner.toLowerCase()!==primary.owner.toLowerCase()||copy.repo.toLowerCase()!==primary.repo.toLowerCase())?copy:null;
  return {book_id:book.id,owner:primary.owner,repo:primary.repo,commit,...(distinctCopy?{fallback_owner:distinctCopy.owner,fallback_repo:distinctCopy.repo}:{})};
}

export function isSafeBundlePath(path:string){
  return path.length>0&&path.length<=300&&!path.startsWith('/')&&!path.includes('\\')&&!/[\u0000-\u001f]/.test(path)
    &&path.split('/').every(segment=>segment!==''&&segment!=='.'&&segment!=='..');
}
export function isInstalledPath(path:string){return !EXCLUDED.some(pattern=>pattern.test(path));}

/** SKILL.md frontmatter 的 name，作為本機資料夾名稱；不合格時退回 repo 名稱。 */
export function skillFolderName(skillMarkdown:string,fallback:string){
  const frontmatter=/^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMarkdown)?.[1];
  const name=frontmatter&&/^name:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,63})["']?\s*$/m.exec(frontmatter)?.[1];
  return name||fallback.toLowerCase().replace(/[^a-z0-9._-]/g,'-').slice(0,64);
}

function hex(buffer:ArrayBuffer){return [...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function gitBlobSha1(bytes:Uint8Array){
  const head=new TextEncoder().encode('blob '+bytes.length+'\0'),all=new Uint8Array(head.length+bytes.length);
  all.set(head);all.set(bytes,head.length);
  return hex(await crypto.subtle.digest('SHA-1',all));
}
export async function manifestDigest(files:readonly {path:string;sha:string}[]){
  const text=[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).map(file=>file.path+' '+file.sha).join('\n');
  return 'sha256:'+hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
}
function base64(bytes:Uint8Array){
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary);
}

type TreeEntry={path:string;type:string;sha:string;size?:number};
type ResolvedTree={owner:string;repo:string;tree:TreeEntry[]};

const REPOSITORY_REDIRECT_RE=/^https:\/\/api\.github\.com\/repositories\/(\d{1,20})\//;
const GITHUB_FULL_NAME_RE=/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

function githubHeaders(token?:string|null){
  return {Accept:'application/vnd.github+json','User-Agent':'Freedom-Workshop-Skill-Install',...(token?{Authorization:'Bearer '+token}:{})};
}

async function repositoryCoordinateById(fetcher:Fetcher,id:string,token?:string|null):Promise<{owner:string;repo:string}|null>{
  try{
    const response=await fetcher('https://api.github.com/repositories/'+id,{
      redirect:'manual',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),headers:githubHeaders(token),
    });
    if(response.status!==200)return null;
    const data=await response.json() as {id?:unknown;full_name?:unknown;private?:unknown;visibility?:unknown};
    if(!data||typeof data!=='object'||typeof data.id!=='number'||!Number.isSafeInteger(data.id)||String(data.id)!==id)return null;
    if(typeof data.full_name!=='string'||!GITHUB_FULL_NAME_RE.test(data.full_name))return null;
    if(data.private===true)return null;
    if(data.visibility!==undefined&&data.visibility!=='public')return null;
    const [owner,repo]=data.full_name.split('/');
    if(!owner||!repo||repo==='.'||repo==='..')return null;
    return {owner,repo};
  }catch{
    return null;
  }
}

async function readTree(fetcher:Fetcher,source:SkillInstallSource,token?:string|null,followRedirects=true):Promise<ResolvedTree>{
  let response:Response;
  try{
    response=await fetcher('https://api.github.com/repos/'+source.owner+'/'+source.repo+'/git/trees/'+source.commit+'?recursive=1',{
      redirect:'manual',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),headers:githubHeaders(token),
    });
  }catch{
    throw new Problem(503,'skill_source_unreachable','暫時無法讀取技能書來源，請稍後再試。',60);
  }
  if(response.status>=300&&response.status<400){
    const location=response.headers.get('location');
    const match=followRedirects&&(response.status===301||response.status===302||response.status===307||response.status===308)&&location?REPOSITORY_REDIRECT_RE.exec(location):null;
    if(!match)throw new Problem(404,'skill_source_unavailable','找不到這本技能書的收錄版本。');
    const renamed=await repositoryCoordinateById(fetcher,match[1],token);
    if(!renamed)throw new Problem(404,'skill_source_unavailable','找不到這本技能書的收錄版本。');
    return readTree(fetcher,{...source,owner:renamed.owner,repo:renamed.repo},token,false);
  }
  if(response.status===404||response.status===409||response.status===422)throw new Problem(404,'skill_source_unavailable','找不到這本技能書的收錄版本。');
  if(response.status!==200)throw new Problem(503,'skill_source_unreachable','暫時無法讀取技能書來源，請稍後再試。',60);
  const data=await response.json() as {truncated?:boolean;tree?:TreeEntry[]};
  if(data.truncated||!Array.isArray(data.tree))throw new Problem(422,'skill_package_too_large','這本技能書的檔案太多，請改用下載或指令安裝。');
  return {owner:source.owner,repo:source.repo,tree:data.tree};
}

export async function buildSkillInstallBundle(source:SkillInstallSource,fetcher:Fetcher=globalThis.fetch,token?:string|null,onFallback?:(record:SkillInstallFallbackRecord)=>void):Promise<SkillInstallBundle>{
  let activeSource:SkillInstallSource=source;
  let tree:TreeEntry[];
  try{
    const resolved=await readTree(fetcher,activeSource,token,true);
    activeSource={...source,owner:resolved.owner,repo:resolved.repo};
    tree=resolved.tree;
  }catch(error){
    if(error instanceof Problem&&error.status===404&&source.fallback_owner&&source.fallback_repo&&(source.fallback_owner!==source.owner||source.fallback_repo!==source.repo)){
      const fallbackSource:SkillInstallSource={book_id:source.book_id,owner:source.fallback_owner,repo:source.fallback_repo,commit:source.commit};
      tree=(await readTree(fetcher,fallbackSource,token,false)).tree;
      activeSource=fallbackSource;
      const record:SkillInstallFallbackRecord={
        book_id:source.book_id,
        original_repository:source.owner+'/'+source.repo,
        fallback_repository:fallbackSource.owner+'/'+fallbackSource.repo,
        commit:source.commit,
        reason:'original_commit_missing',
        recorded_at:new Date().toISOString(),
      };
      recordedFallbacks.set(source.book_id,record);
      onFallback?.(record);
    }else{
      throw error;
    }
  }
  const entries=tree.filter(entry=>entry.type==='blob'&&isInstalledPath(entry.path));
  if(entries.some(entry=>!isSafeBundlePath(entry.path)||!/^[0-9a-f]{40}$/.test(entry.sha)))throw new Problem(422,'skill_package_invalid','技能書含有無法安全安裝的檔名。');
  if(!entries.some(entry=>entry.path==='SKILL.md'))throw new Problem(422,'not_a_skill_package','這個作品根目錄沒有 SKILL.md，不是可安裝的技能書。');
  const totalBytes=entries.reduce((sum,entry)=>sum+(entry.size??0),0);
  if(entries.length>SKILL_INSTALL_LIMITS.files||totalBytes>SKILL_INSTALL_LIMITS.totalBytes||entries.some(entry=>(entry.size??0)>SKILL_INSTALL_LIMITS.fileBytes))
    throw new Problem(422,'skill_package_too_large','這本技能書太大，請改用下載或指令安裝。');
  const files:SkillInstallFile[]=[];let skillMarkdown='';
  const queue=[...entries];
  const worker=async()=>{
    for(let entry=queue.shift();entry;entry=queue.shift()){
      const response=await fetcher('https://raw.githubusercontent.com/'+activeSource.owner+'/'+activeSource.repo+'/'+activeSource.commit+'/'+entry.path.split('/').map(encodeURIComponent).join('/'),{redirect:'manual',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
      if(!response.ok)throw new Problem(503,'skill_source_unreachable','暫時無法讀取技能書來源，請稍後再試。',60);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>SKILL_INSTALL_LIMITS.fileBytes||await gitBlobSha1(bytes)!==entry.sha)throw new Problem(502,'skill_source_mismatch','技能書內容與收錄版本不一致，已停止安裝。');
      if(entry.path==='SKILL.md')skillMarkdown=new TextDecoder().decode(bytes);
      files.push({path:entry.path,sha:entry.sha,size:bytes.length,content_base64:base64(bytes)});
    }
  };
  await Promise.all(Array.from({length:4},worker));
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {format:SKILL_INSTALL_BUNDLE_FORMAT,book_id:activeSource.book_id,name:skillFolderName(skillMarkdown,activeSource.repo),repository:activeSource.owner+'/'+activeSource.repo,commit:activeSource.commit,
    manifest_digest:await manifestDigest(files),total_bytes:files.reduce((sum,file)=>sum+file.size,0),files};
}

/** commit 不可變，以 repo@commit 快取；失敗不留快取，下次重試。 */
export function createSkillInstallBundleLoader(fetcher:Fetcher=globalThis.fetch,readToken?:()=>string|null|undefined,books?:readonly SkillBook[],onFallback?:(record:SkillInstallFallbackRecord)=>void){
  const cache=new Map<string,Promise<SkillInstallBundle>>();
  return async(bookId:string)=>{
    const source=skillInstallSource(bookId,books);
    if(!source)throw new Problem(404,'skill_install_unavailable','這本技能書沒有可安裝的收錄版本。');
    const key=source.owner+'/'+source.repo+'@'+source.commit+'#'+source.book_id;
    let pending=cache.get(key);
    if(!pending){
      pending=buildSkillInstallBundle(source,fetcher,readToken?.(),onFallback);
      cache.set(key,pending);
      if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value!);
      pending.catch(()=>{if(cache.get(key)===pending)cache.delete(key);});
    }
    return pending;
  };
}
