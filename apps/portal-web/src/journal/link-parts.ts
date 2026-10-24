export function linkParts(text:string){
 const parts:{text:string;href?:string}[]=[];let last=0;
 for(const match of text.matchAll(/https?:\/\/[^\s<>"'（），。；！？「」]+/g)){
  let url=match[0].replace(/[.,;!?]+$/,'');
  let extraClosing=(url.match(/\)/g)?.length??0)-(url.match(/\(/g)?.length??0);
  while(extraClosing>0&&url.endsWith(')')){url=url.slice(0,-1).replace(/[.,;!?]+$/,'');extraClosing--;}
  try{const parsed=new URL(url);if(!parsed.hostname||parsed.username||parsed.password)continue;}catch{continue;}
  if(match.index>last)parts.push({text:text.slice(last,match.index)});
  parts.push({text:url,href:url});last=match.index+url.length;
 }
 if(last<text.length)parts.push({text:text.slice(last)});
 return parts;
}
