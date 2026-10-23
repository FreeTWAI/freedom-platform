export function linkParts(text:string){
 const parts:{text:string;href?:string}[]=[];let last=0;
 for(const match of text.matchAll(/https?:\/\/[^\s<>"'（），。；！？「」]+/g)){
  const url=match[0].replace(/[.,;!?]+$/,'');
  try{const parsed=new URL(url);if(!parsed.hostname||parsed.username||parsed.password)continue;}catch{continue;}
  if(match.index>last)parts.push({text:text.slice(last,match.index)});
  parts.push({text:url,href:url});last=match.index+url.length;
 }
 if(last<text.length)parts.push({text:text.slice(last)});
 return parts;
}
