import { repositoryAdapter } from './repository.js';
import { linkAdapter } from './link.js';
import { eventAdapter } from './event.js';
import { existingAdapter } from './existing.js';
import type { ShareAdapter, ShareInput, ShareKind } from '../types.js';
const adapters:Record<ShareKind,ShareAdapter>={repository:repositoryAdapter,link:linkAdapter,event:eventAdapter,work:existingAdapter('work','showcases','/#showcase/'),post:existingAdapter('post','community_social_posts','/?social-post={id}#social'),service:existingAdapter('service','member_services','/services/')};
export function shareAdapter(input:ShareInput):ShareAdapter {
  let kind=input.kind;
  if(input.url&&(!kind||kind==='link'||kind==='repository')){try{if(new URL(input.url).hostname==='github.com')kind='repository';else kind??='link';}catch{kind??='link';}}
  return adapters[kind??'link'];
}
