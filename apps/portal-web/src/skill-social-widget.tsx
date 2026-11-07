import './zod-csp';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ApiError,PortalClient} from './api';
import {GitHubBookSocial,GitHubSocialProvider} from './modules/GitHubSocial';
import type {SessionPayload} from './types';
import {skillBookStarUrl} from './modules/SkillBookCover';
import type {CardDesign,CardLink,CardProfileLink} from './modules/MemberECard';

type PublicAuthorCard={name:string;role:string;card_path:string;card:{nickname:string;headline:string|null;design:CardDesign;primary_guild:{name:string}|null;capabilities:string[];avatar_url:string|null;links:CardLink[];profile_links:CardProfileLink[]}};
/** Mount the same card the member publishes, without reading a private member DTO. */
export async function renderSkillAuthorCards(node:HTMLElement,value:unknown,signal:AbortSignal):Promise<()=>void>{
  const {MemberECard,cardDesigns}=await import('./modules/MemberECard');
  if(signal.aborted||!node.isConnected)throw new DOMException('Author card request ended','AbortError');
  const items=(value as {items?:unknown}|null)?.items;
  if(!Array.isArray(items))throw new Error('invalid_author_cards');
  for(const item of items){
    const card=item?.card;
    if(!item||typeof item.name!=='string'||typeof item.role!=='string'||!/^\/member-cards\/[A-Za-z0-9_-]{43}$/.test(item.card_path)||!card||typeof card.nickname!=='string'||!cardDesigns.some(([design])=>design===card.design)||!Array.isArray(card.capabilities)||!card.capabilities.every((label:unknown)=>typeof label==='string')||!Array.isArray(card.links)||!Array.isArray(card.profile_links)||card.avatar_url!==null&&card.avatar_url!=='/api/v1/public'+item.card_path+'/avatar')throw new Error('invalid_author_card');
  }
  const root=createRoot(node);
  flushSync(()=>root.render(items.length?(items as PublicAuthorCard[]).map(({role,card_path,card})=><section className="sp-author-card-entry" key={card_path}><p className="sp-author-role">{role}</p><MemberECard design={card.design} nickname={card.nickname} headline={card.headline} guildName={card.primary_guild?.name??null} capabilities={card.capabilities} avatarUrl={card.avatar_url} links={card.links} profileLinks={card.profile_links} heading="h3" shareUrl={new URL(card_path,window.location.origin).href}/><p><a href={card_path} target="_blank" rel="noopener noreferrer">開啟完整工坊名片 ↗</a></p></section>):<p>目前沒有可查看的作者工坊名片。</p>));
  return ()=>root.unmount();
}

// Public HTML stays readable and actionable without JavaScript. Private Star
// state is loaded only in this visitor's browser and never enters cached HTML.
export async function enhanceSkillSocial(node:HTMLElement,signal:AbortSignal):Promise<boolean>{
  const bookId=node.dataset.skillSocial,repositoryUrl=skillBookStarUrl({repository_url:node.dataset.repository??''});
  if(!bookId||!/^[a-z0-9-]+$/.test(bookId)||!repositoryUrl||signal.aborted)return false;
  const canRender=()=>!signal.aborted&&node.isConnected&&!node.contains(document.activeElement);
  if(!canRender())return false;
  const client=new PortalClient();
  const widget=<GitHubBookSocial bookId={bookId} repositoryUrl={repositoryUrl} compact={node.hasAttribute('data-skill-social-compact')} returnTo={'/development/skills/'+bookId}/>;
  try{
    const session=await client.get<SessionPayload>('/session',{skipAuthHandler:true,signal});
    if(!canRender())return false;
    client.csrfToken=session.csrf_token;
    // Commit this one-time replacement before another focus event can enter SSR links.
    flushSync(()=>createRoot(node).render(<GitHubSocialProvider client={client} session={session}>{widget}</GitHubSocialProvider>));
    return true;
  }catch(error){
    if(error instanceof ApiError&&error.status===401&&canRender()){flushSync(()=>createRoot(node).render(widget));return true;}
    // Preserve the working GitHub links if session discovery is unavailable.
  }
  return false;
}
