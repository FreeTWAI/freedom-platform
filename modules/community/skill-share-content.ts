import {communityCatalog} from './catalog.js';
import {getSkillPageContent,skillShareCardAlt} from './skill-page-content.js';
import memberShared0 from './share-introductions/hrflow.json' with {type:'json'};
import memberShared1 from './share-introductions/hdsljp-api.json' with {type:'json'};
import memberShared2 from './share-introductions/usage.json' with {type:'json'};
import memberShared3 from './share-introductions/photo-border-remover.json' with {type:'json'};
import memberShared4 from './share-introductions/ga4-lp-analytics.json' with {type:'json'};
import memberShared5 from './share-introductions/sns-feedback-collect.json' with {type:'json'};
import memberShared6 from './share-introductions/ultracode-token-optimization.json' with {type:'json'};
import memberShared7 from './share-introductions/keynote-pptx-doctor.json' with {type:'json'};
import memberShared8 from './share-introductions/webchat-mcp.json' with {type:'json'};
import memberShared9 from './share-introductions/gemini-voice-lab.json' with {type:'json'};
import memberShared10 from './share-introductions/story-bible.json' with {type:'json'};
import memberShared11 from './share-introductions/human-mode.json' with {type:'json'};
import memberShared12 from './share-introductions/project-hub.json' with {type:'json'};
import memberShared13 from './share-introductions/taiwanese-english-checker.json' with {type:'json'};
import communityAuthor0 from './share-introductions/bidding-radar-concept.json' with {type:'json'};
import communityAuthor1 from './share-introductions/aiwff-runtime.json' with {type:'json'};
import communityAuthor2 from './share-introductions/n8n-marketing-flows.json' with {type:'json'};
import communityAuthor3 from './share-introductions/anti-gambling-trader-tw.json' with {type:'json'};
import communityAuthor4 from './share-introductions/web-card-game-skill.json' with {type:'json'};
import communityAuthor5 from './share-introductions/ai-avatar-bot.json' with {type:'json'};
import communityAuthor6 from './share-introductions/ai-manga-translator.json' with {type:'json'};
import communityAuthor7 from './share-introductions/line-persona.json' with {type:'json'};
import communityAuthor8 from './share-introductions/open-seo-advisor.json' with {type:'json'};
import communityAuthor9 from './share-introductions/video-to-podcast-toolkit.json' with {type:'json'};
import communityAuthor10 from './share-introductions/autovtuber.json' with {type:'json'};
import communityAuthor11 from './share-introductions/coding-audit-harness.json' with {type:'json'};
import localWorkspaceMcp from './share-introductions/local-workspace-mcp.json' with {type:'json'};
import editkin from './share-introductions/editkin.json' with {type:'json'};
import positioningCompanion from './share-introductions/positioning-companion.json' with {type:'json'};
import freedomPartyGuildLounge from './share-introductions/freedom-party-guild-lounge.json' with {type:'json'};
// Prewritten share introductions per skill book; a dice picks one line when a member shares the book.
import agentKit from './share-introductions/agent-kit.json' with {type:'json'};
import aiSister from './share-introductions/ai-sister.json' with {type:'json'};
import careerGuide from './share-introductions/career-guide.json' with {type:'json'};
import commercialProduction from './share-introductions/commercial-production.json' with {type:'json'};
import communityOps from './share-introductions/community-ops.json' with {type:'json'};
import eventSpace from './share-introductions/event-space.json' with {type:'json'};
import haoStudio from './share-introductions/hao-studio.json' with {type:'json'};
import humanDesign from './share-introductions/human-design.json' with {type:'json'};
import mediaGenerator from './share-introductions/media-generator.json' with {type:'json'};
import multiAiChat from './share-introductions/multi-ai-chat.json' with {type:'json'};
import multiAiDesktop from './share-introductions/multi-ai-desktop.json' with {type:'json'};
import musicMv from './share-introductions/music-mv.json' with {type:'json'};
import partnership from './share-introductions/partnership.json' with {type:'json'};
import posPro from './share-introductions/pos-pro.json' with {type:'json'};
import projectDelivery from './share-introductions/project-delivery.json' with {type:'json'};
import projectTemplate from './share-introductions/project-template.json' with {type:'json'};
import projectionMapping from './share-introductions/projection-mapping.json' with {type:'json'};
import reconciliation from './share-introductions/reconciliation.json' with {type:'json'};
import securityScanner from './share-introductions/security-scanner.json' with {type:'json'};
import shortDrama from './share-introductions/short-drama.json' with {type:'json'};
import socialPost from './share-introductions/social-post.json' with {type:'json'};
import storefront from './share-introductions/storefront.json' with {type:'json'};
import supplierClient from './share-introductions/supplier-client.json' with {type:'json'};
import typoStudio from './share-introductions/typo-studio.json' with {type:'json'};
import videoAutopilot from './share-introductions/video-autopilot.json' with {type:'json'};

export const skillShareContentVersion='2026-11-06.1';
export type SkillShareContent = {introductions:string[];illustration_url:string;illustration_alt:string};

const content:Record<string,string[]> = {
  'hrflow':memberShared0,
  'hdsljp-api':memberShared1,
  'usage':memberShared2,
  'photo-border-remover':memberShared3,
  'ga4-lp-analytics':memberShared4,
  'sns-feedback-collect':memberShared5,
  'ultracode-token-optimization':memberShared6,
  'keynote-pptx-doctor':memberShared7,
  'webchat-mcp':memberShared8,
  'gemini-voice-lab':memberShared9,
  'story-bible':memberShared10,
  'human-mode':memberShared11,
  'project-hub':memberShared12,
  'taiwanese-english-checker':memberShared13,

  'bidding-radar-concept':communityAuthor0,
  'aiwff-runtime':communityAuthor1,
  'n8n-marketing-flows':communityAuthor2,
  'anti-gambling-trader-tw':communityAuthor3,
  'web-card-game-skill':communityAuthor4,
  'ai-avatar-bot':communityAuthor5,
  'ai-manga-translator':communityAuthor6,
  'line-persona':communityAuthor7,
  'open-seo-advisor':communityAuthor8,
  'video-to-podcast-toolkit':communityAuthor9,
  'autovtuber':communityAuthor10,
  'coding-audit-harness':communityAuthor11,
  'local-workspace-mcp':localWorkspaceMcp,
  'editkin':editkin,
  'positioning-companion':positioningCompanion,
  'freedom-party-guild-lounge':freedomPartyGuildLounge,
  'career-guide':careerGuide,
  'community-ops':communityOps,
  'partnership':partnership,
  'reconciliation':reconciliation,
  'project-delivery':projectDelivery,
  'music-mv':musicMv,
  'commercial-production':commercialProduction,
  'event-space':eventSpace,
  'projection-mapping':projectionMapping,
  'human-design':humanDesign,
  'supplier-client':supplierClient,
  'storefront':storefront,
  'agent-kit':agentKit,
  'project-template':projectTemplate,
  'social-post':socialPost,
  'typo-studio':typoStudio,
  'video-autopilot':videoAutopilot,
  'short-drama':shortDrama,
  'hao-studio':haoStudio,
  'media-generator':mediaGenerator,
  'pos-pro':posPro,
  'security-scanner':securityScanner,
  'ai-sister':aiSister,
  'multi-ai-desktop':multiAiDesktop,
  'multi-ai-chat':multiAiChat,
};

export function getSkillShareContent(bookId:string):SkillShareContent|null {
  if(!Object.hasOwn(content,bookId))return null;
  // The share image is rendered from the page content, so its alt text repeats the same words.
  const title=communityCatalog.skill_books.find(book=>book.id===bookId)?.title,page=getSkillPageContent(bookId);
  return {introductions:[...content[bookId]],illustration_url:`/brand/skill-illustrations/${bookId}.webp`,illustration_alt:title&&page?skillShareCardAlt(title,page):''};
}

export const skillShareContentBookIds:readonly string[]=Object.keys(content);
