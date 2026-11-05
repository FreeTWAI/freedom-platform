import './zod-csp';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ApiError,PortalClient} from './api';
import {GitHubBookSocial,GitHubSocialProvider} from './modules/GitHubSocial';
import type {SessionPayload} from './types';
import {skillBookStarUrl} from './modules/SkillBookCover';

// Public HTML stays readable and actionable without JavaScript. Private Star
// state is loaded only in this visitor's browser and never enters cached HTML.
export async function enhanceSkillSocial(node:HTMLElement,signal:AbortSignal):Promise<boolean>{
  const bookId=node.dataset.skillSocial,repositoryUrl=skillBookStarUrl({repository_url:node.dataset.repository??''});
  if(!bookId||!/^[a-z0-9-]+$/.test(bookId)||!repositoryUrl||signal.aborted)return false;
  const canRender=()=>!signal.aborted&&node.isConnected&&!node.contains(document.activeElement);
  if(!canRender())return false;
  const client=new PortalClient();
  const widget=<GitHubBookSocial bookId={bookId} repositoryUrl={repositoryUrl} returnTo={'/development/skills/'+bookId}/>;
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
