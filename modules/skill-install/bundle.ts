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
export const SKILL_INSTALL_LIMITS={files:80,totalBytes:2*1024*1024,fileBytes:512*1024,archiveBytes:6*1024*1024,compressedBytes:4*1024*1024,treeBytes:2*1024*1024,requests:6,cacheBytes:8*1024*1024,inflight:2};
const EXCLUDED=[/^\.github\//,/^\.gitignore$/,/^\.gitattributes$/,/^tests?\//,/^\.vscode\//];
const REQUEST_TIMEOUT_MS=10_000;


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

// Buffer only bounded responses, including data that GitHub omitted from Content-Length.
async function boundedBytes(response:Response,limit:number,tooLarge:()=>Problem):Promise<Uint8Array>{
  const length=response.headers.get('content-length');
  if(length&&/^\d+$/.test(length)&&Number(length)>limit)throw tooLarge();
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  const parts:Uint8Array[]=[];let total=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw tooLarge();parts.push(value);}
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const result=new Uint8Array(total);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;
}
function packageTooLarge(source:SkillInstallSource){return new Problem(422,'skill_package_too_large',`這本技能書太大，請前往原作：https://github.com/${source.owner}/${source.repo}`);}
async function boundedJson(response:Response,limit:number,source:SkillInstallSource):Promise<unknown>{
  const bytes=await boundedBytes(response,limit,()=>packageTooLarge(source));
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new Problem(502,'skill_source_mismatch','技能書來源資料無法驗證。');}
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
    const data=await boundedJson(response,131072,{book_id:'',owner:'github',repo:'repository',commit:''}) as {id?:unknown;full_name?:unknown;private?:unknown;visibility?:unknown};
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

async function readTree(fetcher:Fetcher,source:SkillInstallSource,token?:string|null,followRedirects=true,originalSource:SkillInstallSource=source):Promise<ResolvedTree>{
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
    return readTree(fetcher,{...source,owner:renamed.owner,repo:renamed.repo},token,false,originalSource);
  }
  if(response.status===404||response.status===409||response.status===422)throw new Problem(404,'skill_source_unavailable','找不到這本技能書的收錄版本。');
  if(response.status!==200)throw new Problem(503,'skill_source_unreachable','暫時無法讀取技能書來源，請稍後再試。',60);
  const data=await boundedJson(response,SKILL_INSTALL_LIMITS.treeBytes,originalSource) as {truncated?:boolean;tree?:TreeEntry[]};
  if(!data||typeof data!=='object')throw new Problem(502,'skill_source_mismatch','技能書來源資料無法驗證。');
  if(data.truncated||!Array.isArray(data.tree))throw packageTooLarge(originalSource);
  return {owner:source.owner,repo:source.repo,tree:data.tree};
}

type PaxFields={path?:string;size?:number};
function tarString(bytes:Uint8Array):string{
  const zero=bytes.indexOf(0);return new TextDecoder('utf-8',{fatal:true}).decode(zero<0?bytes:bytes.subarray(0,zero));
}
function tarNumber(bytes:Uint8Array):number{
  const text=tarString(bytes).trim();
  if(!/^[0-7]+$/.test(text))throw Error('invalid tar number');
  const result=parseInt(text,8);if(!Number.isSafeInteger(result))throw Error('invalid tar number');return result;
}
function paxFields(bytes:Uint8Array):PaxFields{
  const fields:PaxFields={};let offset=0;
  while(offset<bytes.length){
    let space=offset;while(space<bytes.length&&bytes[space]!==32)space++;
    const lengthText=tarString(bytes.subarray(offset,space));
    if(!/^[1-9][0-9]*$/.test(lengthText))throw Error('invalid pax record');
    const length=Number(lengthText),end=offset+length;
    if(!Number.isSafeInteger(length)||end>bytes.length||end<=space+1||bytes[end-1]!==10)throw Error('invalid pax record');
    const record=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(space+1,end-1));
    const equals=record.indexOf('=');if(equals<1)throw Error('invalid pax record');
    const name=record.slice(0,equals),value=record.slice(equals+1);
    if(name==='path')fields.path=value;
    if(name==='size'){if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('invalid pax size');fields.size=Number(value);}
    offset=end;
  }
  return fields;
}
async function archiveFiles(response:Response,source:SkillInstallSource,entries:TreeEntry[]):Promise<{files:SkillInstallFile[];skillMarkdown:string}>{
  const tooLarge=()=>packageTooLarge(source);
  const compressed=await boundedBytes(response,SKILL_INSTALL_LIMITS.compressedBytes,tooLarge);
  let inflated:Uint8Array;
  try{
    const stream=new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream('gzip'));
    inflated=await boundedBytes(new Response(stream),SKILL_INSTALL_LIMITS.archiveBytes,tooLarge);
  }catch(error){if(error instanceof Problem)throw error;throw new Problem(502,'skill_source_mismatch','技能書壓縮檔無法驗證。');}
  const expected=new Map(entries.map(entry=>[entry.path,entry]));
  const files:SkillInstallFile[]=[];const found=new Set<string>();let root:string|undefined,pax:PaxFields|undefined,skillMarkdown='',actualTotal=0,ended=false;
  try{
    for(let offset=0;offset+512<=inflated.length;){
      const header=inflated.subarray(offset,offset+512);offset+=512;
      if(header.every(byte=>byte===0)){ended=true;break;}
      const checksum=tarNumber(header.subarray(148,156));
      let computed=0;for(let i=0;i<512;i++)computed+=i>=148&&i<156?32:header[i];
      if(checksum!==computed)throw Error('invalid tar checksum');
      const type=header[156],headerSize=tarNumber(header.subarray(124,136));
      const size=(type===120||type===103)?headerSize:(pax?.size??headerSize);
      if(!Number.isSafeInteger(size)||size<0||offset+size>inflated.length)throw Error('invalid tar size');
      const body=inflated.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;
      if(offset>inflated.length)throw Error('truncated tar');
      if(type===120||type===103){if(size>32768)throw Error('large pax header');const parsed=paxFields(body);if(type===120)pax=parsed;continue;}
      const name=tarString(header.subarray(0,100)),prefix=tarString(header.subarray(345,500));
      const full=pax?.path??(prefix?`${prefix}/${name}`:name);pax=undefined;
      const slash=full.indexOf('/');if(slash<1){if(type===53)continue;throw Error('missing archive root');}
      const currentRoot=full.slice(0,slash),path=full.slice(slash+1).replace(/\/$/,'');
      if(root===undefined)root=currentRoot;
      if(root!==currentRoot)throw Error('invalid archive root');
      if(type===53&&path==='')continue;
      if(!isSafeBundlePath(path))throw Error('invalid archive path');
      if(type===53)continue;
      if(!isInstalledPath(path))continue;
      const entry=expected.get(path);
      if(!entry||found.has(path)||(type!==0&&type!==48)||body.length!==entry.size)throw Error('archive tree mismatch');
      actualTotal+=body.length;if(body.length>SKILL_INSTALL_LIMITS.fileBytes||actualTotal>SKILL_INSTALL_LIMITS.totalBytes)throw tooLarge();
      if(await gitBlobSha1(body)!==entry.sha)throw Error('archive hash mismatch');
      found.add(path);if(path==='SKILL.md')skillMarkdown=new TextDecoder().decode(body);
      files.push({path,sha:entry.sha,size:body.length,content_base64:base64(body)});
    }
    if(!ended||found.size!==entries.length)throw Error('incomplete archive');
  }catch(error){if(error instanceof Problem)throw error;throw new Problem(502,'skill_source_mismatch','技能書內容與收錄版本不一致，已停止安裝。');}
  return {files,skillMarkdown};
}

export async function buildSkillInstallBundle(source:SkillInstallSource,fetcher:Fetcher=globalThis.fetch,token?:string|null,onFallback?:(record:SkillInstallFallbackRecord)=>void):Promise<SkillInstallBundle>{
  let requests=0;
  const limitedFetch:Fetcher=async(input,init)=>{if(++requests>SKILL_INSTALL_LIMITS.requests)throw packageTooLarge(source);return fetcher(input,init);};
  let activeSource:SkillInstallSource=source;
  let tree:TreeEntry[];
  try{
    const resolved=await readTree(limitedFetch,activeSource,token,true);
    activeSource={...source,owner:resolved.owner,repo:resolved.repo};tree=resolved.tree;
  }catch(error){
    if(error instanceof Problem&&error.status===404&&source.fallback_owner&&source.fallback_repo&&(source.fallback_owner!==source.owner||source.fallback_repo!==source.repo)){
      const fallbackSource:SkillInstallSource={book_id:source.book_id,owner:source.fallback_owner,repo:source.fallback_repo,commit:source.commit};
      tree=(await readTree(limitedFetch,fallbackSource,token,false,source)).tree;activeSource=fallbackSource;
      const record:SkillInstallFallbackRecord={book_id:source.book_id,original_repository:source.owner+'/'+source.repo,fallback_repository:fallbackSource.owner+'/'+fallbackSource.repo,commit:source.commit,reason:'original_commit_missing',recorded_at:new Date().toISOString()};
      recordedFallbacks.set(source.book_id,record);onFallback?.(record);
    }else throw error;
  }
  if(tree.some(entry=>!entry||typeof entry!=='object'||typeof entry.type!=='string'||typeof entry.path!=='string'))throw new Problem(502,'skill_source_mismatch','技能書來源資料無法驗證。');
  const entries=tree.filter(entry=>entry.type==='blob'&&isInstalledPath(entry.path));
  if(entries.some(entry=>!isSafeBundlePath(entry.path)||!/^[0-9a-f]{40}$/.test(entry.sha))||new Set(entries.map(entry=>entry.path)).size!==entries.length)throw new Problem(422,'skill_package_invalid','技能書含有無法安全安裝的檔名。');
  if(!entries.some(entry=>entry.path==='SKILL.md'))throw new Problem(422,'not_a_skill_package','這個作品根目錄沒有 SKILL.md，不是可安裝的技能書。');
  const totalBytes=entries.reduce((sum,entry)=>sum+(entry.size??0),0);
  if(entries.length>SKILL_INSTALL_LIMITS.files||totalBytes>SKILL_INSTALL_LIMITS.totalBytes||entries.some(entry=>!Number.isSafeInteger(entry.size)||entry.size!<0||entry.size!>SKILL_INSTALL_LIMITS.fileBytes))throw packageTooLarge(source);
  let response:Response;
  try{response=await limitedFetch(`https://codeload.github.com/${activeSource.owner}/${activeSource.repo}/tar.gz/${activeSource.commit}`,{redirect:'manual',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});}
  catch(error){if(error instanceof Problem)throw error;throw new Problem(503,'skill_source_unreachable','暫時無法讀取技能書來源，請稍後再試。',60);}
  if(!response.ok||response.redirected)throw new Problem(503,'skill_source_unreachable','暫時無法讀取技能書來源，請稍後再試。',60);
  const {files,skillMarkdown}=await archiveFiles(response,source,entries);
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {format:SKILL_INSTALL_BUNDLE_FORMAT,book_id:activeSource.book_id,name:skillFolderName(skillMarkdown,activeSource.repo),repository:activeSource.owner+'/'+activeSource.repo,commit:activeSource.commit,
    manifest_digest:await manifestDigest(files),total_bytes:files.reduce((sum,file)=>sum+file.size,0),files};
}

// The Worker creates an app per request, so cache and in-flight limits must be isolate-wide.
const fetcherIds=new WeakMap<Fetcher,number>();let nextFetcherId=0,cacheBytes=0;
const bundleCache=new Map<string,{bundle:SkillInstallBundle;bytes:number}>();
// Never share pending I/O between Worker requests; only settled bundles are shared.
let inflight=0;
export function createSkillInstallBundleLoader(fetcher:Fetcher=globalThis.fetch,readToken?:()=>string|null|undefined,books?:readonly SkillBook[],onFallback?:(record:SkillInstallFallbackRecord)=>void){
  let fetcherId=fetcherIds.get(fetcher);if(fetcherId===undefined){fetcherId=++nextFetcherId;fetcherIds.set(fetcher,fetcherId);}
  return async(bookId:string)=>{
    const source=skillInstallSource(bookId,books);
    if(!source)throw new Problem(404,'skill_install_unavailable','這本技能書沒有可安裝的收錄版本。');
    const key=fetcherId+':'+source.owner+'/'+source.repo+'@'+source.commit+'#'+source.book_id+'|'+(source.fallback_owner??'')+'/'+(source.fallback_repo??'');
    const cached=bundleCache.get(key);
    if(cached){bundleCache.delete(key);bundleCache.set(key,cached);return cached.bundle;}
    if(inflight>=SKILL_INSTALL_LIMITS.inflight)throw new Problem(503,'skill_install_busy','安裝檔案準備中，請稍後再試。',5);
    inflight++;
    try{
      const bundle=await buildSkillInstallBundle(source,fetcher,readToken?.(),onFallback);
      // Account for UTF-16 strings and per-file/object overhead, not just decoded bytes.
      const bytes=JSON.stringify(bundle).length*2+bundle.files.length*256;
      if(bytes<=SKILL_INSTALL_LIMITS.cacheBytes){
        const previous=bundleCache.get(key);if(previous){cacheBytes-=previous.bytes;bundleCache.delete(key);}
        while(cacheBytes+bytes>SKILL_INSTALL_LIMITS.cacheBytes){const oldest=bundleCache.keys().next().value;if(oldest===undefined)break;cacheBytes-=bundleCache.get(oldest)!.bytes;bundleCache.delete(oldest);}
        bundleCache.set(key,{bundle,bytes});cacheBytes+=bytes;
      }
      return bundle;
    }finally{inflight--;}
  };
}
