import type { RunResult } from './result-card';

export const GAME_SHARE_PLATFORMS = [
  {id:'x',label:'X'}, {id:'threads',label:'Threads'},
  {id:'facebook',label:'Facebook'}, {id:'instagram',label:'Instagram'},
] as const;
export type GameSharePlatform = typeof GAME_SHARE_PLATFORMS[number]['id'];

/** CK-6: text/link handoff only. These URLs never attach local files or publish. */
export function gameSocialLink(platform:GameSharePlatform,link:string,text:string):string {
  const target = new URL(platform==='x'?'https://x.com/intent/tweet':platform==='threads'?'https://www.threads.com/intent/post':platform==='facebook'?'https://www.facebook.com/sharer/sharer.php':'https://www.instagram.com/');
  if(platform==='x'||platform==='threads') target.searchParams.set('text',text);
  if(platform==='facebook') target.searchParams.set('u',link);
  return target.toString();
}
export function gameShareText(result:RunResult,link:string):string {
  return `${result.title}\n${result.caption}\n${result.details}\n\n${link}\n換你試試看？ #${result.game==='kitchen'?'料理小宇宙':'離譜日常'}`;
}
