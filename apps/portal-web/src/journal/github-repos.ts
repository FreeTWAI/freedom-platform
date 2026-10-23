// Repository links come only from the already-approved source-message text.
export function githubParts(text:string){
 const parts:{text:string;href?:string}[]=[];let last=0;
 for(const match of text.matchAll(/https?:\/\/[^\s<>"'（），。；！？「」]+/g)){
  const raw=match[0].replace(/[.,;!?\])]+$/,'');let url;try{url=new URL(raw);}catch{continue;}
  if(url.hostname!=='github.com'||url.username||url.password||url.port||!/^https?:\/\/github\.com\//i.test(raw))continue;
  const segments=url.pathname.split('/').filter(Boolean);
  if(['settings','users','orgs','organizations','topics','collections','sponsors','marketplace','features','search','login','signup','sessions','notifications'].includes(segments[0]?.toLowerCase()))continue;
  if(segments.length!==2||!/^[-A-Za-z0-9]+$/.test(segments[0])||!/^[-A-Za-z0-9_.]+$/.test(segments[1])||['.','..'].includes(segments[1]))continue;
  const repo=segments[1].replace(/\.git$/,'');if(!repo||['.','..'].includes(repo))continue;
  const href=`https://github.com/${segments[0]}/${repo}`;
  if(match.index>last)parts.push({text:text.slice(last,match.index)});
  parts.push({text:href,href});last=match.index+raw.length;
 }
 if(last<text.length)parts.push({text:text.slice(last)});return parts;
}
export function relatedRepositories(messages:{text:string}[]=[]){const found=new Map();for(const message of messages)for(const part of githubParts(message.text||''))if(part.href&&!found.has(part.href.toLowerCase()))found.set(part.href.toLowerCase(),part.href);return [...found.values()];}
