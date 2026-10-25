import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import type {PortalClient} from '../api';
import {normalizeShareUrl} from '../../../../packages/shared/share-url';
import {MemberAvatar} from './MemberAvatar';
import {useLanguage,type InterfaceLanguage} from '../language';

const textToolMessages={
 newTab:['在新分頁開啟','Opens in a new tab','新しいタブで開きます','새 탭에서 열립니다','Se abre en una pestaña nueva'],
 emoji:['插入 emoji','Insert emoji','絵文字を挿入','이모지 삽입','Insertar emoji'],
 insert:['插入 {emoji}','Insert {emoji}','{emoji}を挿入','{emoji} 삽입','Insertar {emoji}'],
 mention:['標註會員','Mention a member','メンバーをメンション','회원 멘션','Mencionar a un miembro'],
 search:['搜尋會員','Search members','メンバーを検索','회원 검색','Buscar miembros'],
 searchLabel:['搜尋標註會員','Search members to mention','メンションするメンバーを検索','멘션할 회원 검색','Buscar miembros para mencionar'],
 searching:['搜尋中…','Searching…','検索中…','검색 중…','Buscando…'],
 empty:['沒有符合的會員。','No matching members.','該当するメンバーはいません。','일치하는 회원이 없습니다.','No se encontraron miembros.'],
 limit:['文字或標註人數已達上限。','The text or mention limit has been reached.','文字数またはメンション数の上限に達しました。','글자 수 또는 멘션 수 제한에 도달했습니다.','Se alcanzó el límite de texto o menciones.'],
 unavailable:['會員暫時無法載入。','Members could not be loaded.','メンバーを読み込めません。','회원을 불러올 수 없습니다.','No se pudieron cargar los miembros.'],
} as const satisfies Record<string,readonly [string,string,string,string,string]>;
const textToolLanguageIndex:Record<InterfaceLanguage,number>={'zh-Hant':0,en:1,ja:2,ko:3,es:4};

export type Mention={user_id:string;display_name:string};
export const SOCIAL_TOPICS={mood:'近況心情',event:'社群活動',work:'作品分享'} as const;
export function SocialIcon({name}:{name:'camera'|'smile'|'like'|'comment'|'share'|'send'|'pin'|'eye'}){
 const paths:Record<string,ReactNode>={
 camera:<><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="3.5"/></>,
 smile:<><circle cx="12" cy="12" r="9"/><path d="M8 14q4 5 8 0M8 9h1m6 0h1"/></>,
 like:<path d="M7 10v11H3V10zm0 0 5-7c3 0 2 4 1 7h6c2 0 2 2 1 5l-2 6H7"/>,
 comment:<path d="M21 11a9 9 0 0 1-9 9H8l-5 2 1-6a9 9 0 1 1 17-5ZM8 9h8m-8 4h5"/>,
 share:<path d="m14 3 7 7-7 7v-5C6 12 4 16 3 20 2 11 6 7 14 7z"/>,
 send:<path d="m3 3 18 9-18 9 4-9zm4 9h14"/>,
 pin:<><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2.5"/></>,
 eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
 };
 return <svg className="social-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{paths[name]}</svg>;
}
export function SocialMemberLink({client,member,children}:{client:PortalClient;member:Mention;children?:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),seq=useRef(0),id=useId();
 const [card,setCard]=useState<{nickname:string;avatar_url?:string;primary_guild?:{name:string}|null}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>{++seq.current;},[]);
 async function show(){const token=++seq.current;setCard(null);setError('');setBusy(true);dialog.current?.showModal();try{const next=await client.get<NonNullable<typeof card>>(`/members/${member.user_id}`);if(seq.current===token)setCard(next);}catch(e){if(seq.current===token)setError(e instanceof Error?e.message:'會員資料暫時無法載入。');}finally{if(seq.current===token)setBusy(false);}}
 function close(){++seq.current;dialog.current?.close();trigger.current?.focus();}
 return <><button ref={trigger} type="button" className="social-text-link" onClick={()=>void show()}>{children??member.display_name}</button><dialog ref={dialog} className="social-publish-dialog social-member-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();close();}}><header className="social-publish-head"><h2 id={id}>會員名片</h2><button className="btn btn-ghost" type="button" onClick={close}>關閉名片</button></header>{busy&&<p role="status">載入中…</p>}{error&&<p role="alert">{error}</p>}{card&&<div className="social-member-summary"><MemberAvatar nickname={card.nickname} avatarUrl={card.avatar_url}/><strong>{card.nickname}</strong>{card.primary_guild&&<p>{card.primary_guild.name}</p>}</div>}</dialog></>;
}
/** Only the canonical challenge URL emitted by AbsurdDaily is linkable.
 * Do not normalize untrusted input: URL parsers accept encoded paths, credentials,
 * backslashes and other spellings that must remain plain text here.
 */
export function gameChallengeLink(token:string,origin:string){
 if(/[\u0000-\u0020\u007f-\u009f\p{Cf}%\\]/u.test(token)||!/^https?:\/\//.test(origin))return null;
 try{if(new URL(origin).origin!==origin)return null;}catch{return null;}
 const match=/^([（(「『【]*)(https?:\/\/.*?)([.,!;，。！？、；：)）」』】]*)$/u.exec(token);
 if(!match||!match[2].startsWith(origin+'/play?'))return null;
 const route=match[2].slice(origin.length);
 const challenge=/^\/play\?game=(photo|stamp|cash)&seed=([1-9][0-9]{0,9})$/.exec(route);
 const kitchen=/^\/play\?game=kitchen&recipe=([a-z][a-z-]{1,40})&seed=([1-9][0-9]{0,9})$/.exec(route);
 const seed=challenge?.[2]??kitchen?.[2];
 if(!seed||Number(seed)>4294967295)return null;
 // Recipe syntax is bounded; existence belongs to the game router and its lobby.
 const href=challenge?`/play?game=${challenge[1]}&seed=${seed}`:`/play?game=kitchen&recipe=${kitchen![1]}&seed=${seed}`;
 return {prefix:match[1],label:match[2],suffix:match[3],href};
}
/** Link ordinary external HTTPS text without normalizing away query or fragment.
 * This is a lexical URL check, not a reputation or DNS/preview request.
 */
export function externalShareLink(token:string,origin:string){
 if(!origin||token.length>2048||/[\s\u0000-\u0020\u007f-\u009f\p{Cf}\\<>"']/u.test(token))return null;
 const match=/^([（(「『【]*)(https:\/\/.+?)([.,!;，。！？、；：)）」』】]*)$/iu.exec(token);
 if(!match)return null;
 let label=match[2],suffix=match[3];
 // Keep balanced URL path parentheses; only unmatched prose closers stay outside.
 while(suffix.startsWith(')')&&(label.match(/\(/g)?.length??0)>(label.match(/\)/g)?.length??0)){
  label+=')';suffix=suffix.slice(1);
 }
 const authority=/^https:\/\/([^/?#]+)/i.exec(label)?.[1];
 // Reject credentials, even explicit default ports, encoded hosts and IP spellings
 // before URL can erase or normalize them. Unicode path/query text is still allowed.
 if(!authority||authority.length>253||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(authority))return null;
 try{
  if(/%(?![0-9a-f]{2})/i.test(label)||/[\u0000-\u001f\u007f-\u009f\p{Cf}\\]/u.test(decodeURIComponent(label)))return null;
  // A rejected local game/route must never fall through to the generic branch.
  if(new URL(label).origin===new URL(origin).origin||!normalizeShareUrl(label).ok)return null;
 }catch{return null;}
 return {prefix:match[1],label,suffix,href:label};
}
export function SocialRichText({client,text,mentions=[],onTag}:{client:PortalClient;text:string;mentions?:Mention[];onTag?:(tag:string)=>void}){
 const {language}=useLanguage();
 // Identical server/first hydration output; no browser globals during SSR.
 const [origin,setOrigin]=useState('');
 useEffect(()=>{setOrigin(window.location.origin);},[]);
 const names=new Map(mentions.map(item=>[`@${item.display_name}`,item]));
 const escaped=[...names.keys()].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const pattern=new RegExp(`(${[...escaped,'(?<![\\p{L}\\p{N}_])#[\\p{L}\\p{N}_]{1,50}(?![\\p{L}\\p{N}_])'].join('|')})`,'gu');
 const plain=(text:string,key:number)=><span key={key}>{text.split(pattern).map((part,index)=>names.has(part)?<SocialMemberLink key={index} client={client} member={names.get(part)!}>{part}</SocialMemberLink>:part.startsWith('#')&&/^#[\p{L}\p{N}_]{1,50}$/u.test(part)&&onTag?<button type="button" className="social-text-link" key={index} onClick={()=>onTag(part.slice(1))}>{part}</button>:part)}</span>;
 const mentionRanges=escaped.length?[...text.matchAll(new RegExp(escaped.join('|'),'gu'))].map(match=>({start:match.index!,end:match.index!+match[0].length})):[];
 const parts:ReactNode[]=[];let cursor=0;
 for(const match of text.matchAll(/[^ \t\r\n]+/gu)){
  const start=match.index!;
  // A nickname can contain spaces and URL-shaped text; keep its existing mention.
  if(mentionRanges.some(range=>range.start<start+match[0].length&&range.end>start))continue;
  const link=gameChallengeLink(match[0],origin)??externalShareLink(match[0],origin);if(!link)continue;
  parts.push(plain(text.slice(cursor,start)+link.prefix,start));
  parts.push(<a key={`url-${start}`} className="social-text-link" href={link.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`${link.label} (${textToolMessages.newTab[textToolLanguageIndex[language]]})`}>{link.label}</a>);
  cursor=start+match[0].length-link.suffix.length;
 }
 parts.push(plain(text.slice(cursor),text.length));
 return <>{parts}</>;
}
export function SocialTextTools({client,text,onChange,mentions,onMentions,disabled,maxLength=1000}:{client:PortalClient;text:string;onChange:(s:string)=>void;mentions:Mention[];onMentions:(v:Mention[])=>void;disabled:boolean;maxLength?:number}){
 const {language}=useLanguage();
 const t=(key:keyof typeof textToolMessages)=>textToolMessages[key][textToolLanguageIndex[language]];
 const localizedError=()=>error===textToolMessages.limit[0]?t('limit'):error===textToolMessages.unavailable[0]?t('unavailable'):error;
 const [mode,setMode]=useState<'emoji'|'mention'|null>(null),[dismissed,setDismissed]=useState<string|null>(null),[search,setSearch]=useState(''),[items,setItems]=useState<Mention[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const id=useId(),trigger=useRef<HTMLButtonElement>(null);
 const [emojiSelection,setEmojiSelection]=useState<{value:string;start:number;end:number}|null>(null);
 const composing=useRef(false),caret=useRef<{value:string;position:number;session:number}|null>(null);
 const area=()=>trigger.current?.closest('form')?.querySelector('textarea');
 useEffect(()=>{
  const input=area();if(!input)return;
  const select=()=>setEmojiSelection({value:input.value,start:input.selectionStart,end:input.selectionEnd});
  const start=()=>{composing.current=true;},end=()=>{composing.current=false;select();};
  input.addEventListener('select',select);input.addEventListener('compositionstart',start);input.addEventListener('compositionend',end);
  return()=>{input.removeEventListener('select',select);input.removeEventListener('compositionstart',start);input.removeEventListener('compositionend',end);caret.current=null;composing.current=false;};
 },[client]);
 useLayoutEffect(()=>{
  const pending=caret.current;if(!pending)return;caret.current=null;
  const input=area();
  if(disabled||client.sessionGeneration!==pending.session||text!==pending.value||!input||input.disabled||input.value!==pending.value)return;
  input.focus({preventScroll:true});input.setSelectionRange(pending.position,pending.position);
 },[text,mode,disabled,client]);
 function toggleEmoji(){
  const input=area();if(composing.current)return;
  setEmojiSelection(input?{value:input.value,start:input.selectionStart,end:input.selectionEnd}:null);
  setMode(mode==='emoji'?null:'emoji');
 }
 function insertEmoji(emoji:string){
  const input=area();if(disabled||composing.current||!input||input.disabled||input.value!==text)return;
  const start=input.selectionStart,end=input.selectionEnd,value=text.slice(0,start)+emoji+text.slice(end);
  if(value.length>maxLength)return;
  caret.current={value,position:start+emoji.length,session:client.sessionGeneration};
  onChange(value);setMode(null);
 }
 const selectedLength=emojiSelection?.value===text?emojiSelection.end-emojiSelection.start:0;
 const at=/(?:^|\s)@([^@#\n]{0,40})$/.exec(text);
 const query=mode==='mention'?search:text===dismissed?undefined:at?.[1],showMention=mode==='mention'||query!==undefined;
 useEffect(()=>{if(!showMention||disabled)return;let active=true;setItems([]);setBusy(true);setError('');const timer=setTimeout(()=>{void client.get<{items:{user_id:string;nickname:string}[]}>(`/members?limit=6&search=${encodeURIComponent(query??'')}`).then(page=>{if(active)setItems(page.items.map(item=>({user_id:item.user_id,display_name:item.nickname})));}).catch(e=>{if(active)setError(e instanceof Error?e.message:'會員暫時無法載入。');}).finally(()=>{if(active)setBusy(false);});},200);return()=>{active=false;clearTimeout(timer);};},[client,showMention,query,disabled]);
 function choose(member:Mention){const value=at?text.slice(0,text.lastIndexOf('@'))+`@${member.display_name} `:`${text}${text&&!text.endsWith(' ')?' ':''}@${member.display_name} `;if(value.length>maxLength||mentions.length>=10&&!mentions.some(m=>m.user_id===member.user_id)){setError('文字或標註人數已達上限。');return;}onChange(value);onMentions([...new Map([...mentions,member].map(m=>[m.user_id,m])).values()]);setMode(null);setSearch('');setDismissed(value);const area=trigger.current?.closest('form')?.querySelector('textarea');area?.focus();}
 return <div className="social-text-tools">
 <div className="social-tool-buttons"><button ref={trigger} type="button" className="social-icon-button" aria-label={t('emoji')} title={t('emoji')} disabled={disabled} aria-expanded={mode==='emoji'} aria-controls={id} onClick={toggleEmoji}><SocialIcon name="smile"/></button><button type="button" className="social-icon-button" disabled={disabled} aria-label={t('mention')} title={t('mention')} aria-expanded={showMention} aria-controls={id} onClick={()=>setMode(mode==='mention'?null:'mention')}>@</button></div>
 {!disabled&&(mode==='emoji'||showMention)&&<section className="social-text-picker" id={id} aria-label={mode==='emoji'?'emoji':t('mention')} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setMode(null);setDismissed(text);trigger.current?.focus();}}}>
 {mode==='emoji'?<div className="social-emoji-grid">{['😀','😂','😍','🥰','👍','👏','🎉','❤️','🙏','💪','🔥','✨'].map(emoji=><button key={emoji} type="button" aria-label={t('insert').replace('{emoji}',emoji)} disabled={text.length-selectedLength+emoji.length>maxLength} onClick={()=>insertEmoji(emoji)}>{emoji}</button>)}</div>:<><label className="field">{t('search')}<input type="search" aria-label={t('searchLabel')} maxLength={40} value={query??''} onChange={e=>{setMode('mention');setSearch(e.target.value);}}/></label>{busy?<p role="status">{t('searching')}</p>:items.map(member=><button className="social-mention-choice" type="button" key={member.user_id} onClick={()=>choose(member)}><MemberAvatar nickname={member.display_name}/><span>{member.display_name}</span></button>)}{!busy&&!items.length&&!error&&<p>{t('empty')}</p>}{error&&<p role="alert">{localizedError()}</p>}</>}
 </section>}
 </div>;
}
