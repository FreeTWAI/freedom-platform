import {SKILL_FLOW_ICONS,SKILL_FLOW_LIMITS,skillFlowLines,type SkillFlow} from '../development/skill-flow.js';
import agentKit from './skill-pages/agent-kit.json' with {type:'json'};
import aiAvatarBot from './skill-pages/ai-avatar-bot.json' with {type:'json'};
import aiMangaTranslator from './skill-pages/ai-manga-translator.json' with {type:'json'};
import aiSister from './skill-pages/ai-sister.json' with {type:'json'};
import aiwffRuntime from './skill-pages/aiwff-runtime.json' with {type:'json'};
import antiGamblingTraderTw from './skill-pages/anti-gambling-trader-tw.json' with {type:'json'};
import autovtuber from './skill-pages/autovtuber.json' with {type:'json'};
import biddingRadarConcept from './skill-pages/bidding-radar-concept.json' with {type:'json'};
import careerGuide from './skill-pages/career-guide.json' with {type:'json'};
import codingAuditHarness from './skill-pages/coding-audit-harness.json' with {type:'json'};
import commercialProduction from './skill-pages/commercial-production.json' with {type:'json'};
import communityOps from './skill-pages/community-ops.json' with {type:'json'};
import editkin from './skill-pages/editkin.json' with {type:'json'};
import eventSpace from './skill-pages/event-space.json' with {type:'json'};
import freedomPartyGuildLounge from './skill-pages/freedom-party-guild-lounge.json' with {type:'json'};
import ga4LpAnalytics from './skill-pages/ga4-lp-analytics.json' with {type:'json'};
import geminiVoiceLab from './skill-pages/gemini-voice-lab.json' with {type:'json'};
import haoStudio from './skill-pages/hao-studio.json' with {type:'json'};
import hdsljpApi from './skill-pages/hdsljp-api.json' with {type:'json'};
import hrflow from './skill-pages/hrflow.json' with {type:'json'};
import humanDesign from './skill-pages/human-design.json' with {type:'json'};
import humanMode from './skill-pages/human-mode.json' with {type:'json'};
import keynotePptxDoctor from './skill-pages/keynote-pptx-doctor.json' with {type:'json'};
import linePersona from './skill-pages/line-persona.json' with {type:'json'};
import localWorkspaceMcp from './skill-pages/local-workspace-mcp.json' with {type:'json'};
import mediaGenerator from './skill-pages/media-generator.json' with {type:'json'};
import multiAiChat from './skill-pages/multi-ai-chat.json' with {type:'json'};
import multiAiDesktop from './skill-pages/multi-ai-desktop.json' with {type:'json'};
import musicMv from './skill-pages/music-mv.json' with {type:'json'};
import n8nMarketingFlows from './skill-pages/n8n-marketing-flows.json' with {type:'json'};
import openSeoAdvisor from './skill-pages/open-seo-advisor.json' with {type:'json'};
import partnership from './skill-pages/partnership.json' with {type:'json'};
import photoBorderRemover from './skill-pages/photo-border-remover.json' with {type:'json'};
import posPro from './skill-pages/pos-pro.json' with {type:'json'};
import positioningCompanion from './skill-pages/positioning-companion.json' with {type:'json'};
import projectDelivery from './skill-pages/project-delivery.json' with {type:'json'};
import projectHub from './skill-pages/project-hub.json' with {type:'json'};
import projectTemplate from './skill-pages/project-template.json' with {type:'json'};
import projectionMapping from './skill-pages/projection-mapping.json' with {type:'json'};
import reconciliation from './skill-pages/reconciliation.json' with {type:'json'};
import securityScanner from './skill-pages/security-scanner.json' with {type:'json'};
import shortDrama from './skill-pages/short-drama.json' with {type:'json'};
import snsFeedbackCollect from './skill-pages/sns-feedback-collect.json' with {type:'json'};
import socialPost from './skill-pages/social-post.json' with {type:'json'};
import storefront from './skill-pages/storefront.json' with {type:'json'};
import storyBible from './skill-pages/story-bible.json' with {type:'json'};
import supplierClient from './skill-pages/supplier-client.json' with {type:'json'};
import taiwaneseEnglishChecker from './skill-pages/taiwanese-english-checker.json' with {type:'json'};
import typoStudio from './skill-pages/typo-studio.json' with {type:'json'};
import ultracodeTokenOptimization from './skill-pages/ultracode-token-optimization.json' with {type:'json'};
import usage from './skill-pages/usage.json' with {type:'json'};
import videoAutopilot from './skill-pages/video-autopilot.json' with {type:'json'};
import videoToPodcastToolkit from './skill-pages/video-to-podcast-toolkit.json' with {type:'json'};
import webCardGameSkill from './skill-pages/web-card-game-skill.json' with {type:'json'};
import webchatMcp from './skill-pages/webchat-mcp.json' with {type:'json'};

/** Authored for the public skill page: a headline, three outcomes and one three-step flow per catalog book. */
export type SkillPageContent={headline:string;problem:string;mechanism:string;outcomes:readonly [string,string,string];flow:SkillFlow};
const sources:Record<string,unknown>={
 'agent-kit':agentKit,
 'ai-avatar-bot':aiAvatarBot,
 'ai-manga-translator':aiMangaTranslator,
 'ai-sister':aiSister,
 'aiwff-runtime':aiwffRuntime,
 'anti-gambling-trader-tw':antiGamblingTraderTw,
 'autovtuber':autovtuber,
 'bidding-radar-concept':biddingRadarConcept,
 'career-guide':careerGuide,
 'coding-audit-harness':codingAuditHarness,
 'commercial-production':commercialProduction,
 'community-ops':communityOps,
 'editkin':editkin,
 'event-space':eventSpace,
 'freedom-party-guild-lounge':freedomPartyGuildLounge,
 'ga4-lp-analytics':ga4LpAnalytics,
 'gemini-voice-lab':geminiVoiceLab,
 'hao-studio':haoStudio,
 'hdsljp-api':hdsljpApi,
 'hrflow':hrflow,
 'human-design':humanDesign,
 'human-mode':humanMode,
 'keynote-pptx-doctor':keynotePptxDoctor,
 'line-persona':linePersona,
 'local-workspace-mcp':localWorkspaceMcp,
 'media-generator':mediaGenerator,
 'multi-ai-chat':multiAiChat,
 'multi-ai-desktop':multiAiDesktop,
 'music-mv':musicMv,
 'n8n-marketing-flows':n8nMarketingFlows,
 'open-seo-advisor':openSeoAdvisor,
 'partnership':partnership,
 'photo-border-remover':photoBorderRemover,
 'pos-pro':posPro,
 'positioning-companion':positioningCompanion,
 'project-delivery':projectDelivery,
 'project-hub':projectHub,
 'project-template':projectTemplate,
 'projection-mapping':projectionMapping,
 'reconciliation':reconciliation,
 'security-scanner':securityScanner,
 'short-drama':shortDrama,
 'sns-feedback-collect':snsFeedbackCollect,
 'social-post':socialPost,
 'storefront':storefront,
 'story-bible':storyBible,
 'supplier-client':supplierClient,
 'taiwanese-english-checker':taiwaneseEnglishChecker,
 'typo-studio':typoStudio,
 'ultracode-token-optimization':ultracodeTokenOptimization,
 'usage':usage,
 'video-autopilot':videoAutopilot,
 'video-to-podcast-toolkit':videoToPodcastToolkit,
 'web-card-game-skill':webCardGameSkill,
 'webchat-mcp':webchatMcp,
};
const length=(value:unknown,min:number,max:number)=>typeof value==='string'&&value===value.trim()&&[...value].length>=min&&[...value].length<=max&&!/https?:\/\/|www\.|[<>]/i.test(value);
const extra=(value:object,keys:readonly string[])=>Object.keys(value).filter(key=>!keys.includes(key));
/** Lists what the page or the schematic could not show whole; nothing is truncated at render time. */
export function skillPageContentProblems(value:unknown):string[]{
 if(!value||typeof value!=='object'||Array.isArray(value))return ['content must be an object'];
 const content=value as Partial<SkillPageContent>,problems=extra(content,['headline','problem','mechanism','outcomes','flow']).map(key=>`unknown field ${key}`);
 const check=(name:string,text:unknown,min:number,max:number)=>{if(!length(text,min,max))problems.push(`${name} must be ${min}–${max} characters of trimmed plain text without links`);};
 check('headline',content.headline,6,30);
 check('problem',content.problem,12,100);check('mechanism',content.mechanism,20,160);
 if(typeof content.headline==='string'&&!/[。！？]$/.test(content.headline))problems.push('headline must end with 。！？');
 if(!Array.isArray(content.outcomes)||content.outcomes.length!==3)problems.push('outcomes must list exactly 3 items');
 else{content.outcomes.forEach((item,index)=>check(`outcomes[${index}]`,item,4,30));if(new Set(content.outcomes).size!==3)problems.push('outcomes must differ');}
 const flow=content.flow as Partial<SkillFlow>|undefined;
 if(!flow||typeof flow!=='object'||Array.isArray(flow))return [...problems,'flow must be an object'];
 problems.push(...extra(flow,['title','lead','steps','loop','caption']).map(key=>`unknown field flow.${key}`));
 check('flow.title',flow.title,4,24);check('flow.lead',flow.lead,10,100);check('flow.caption',flow.caption,10,90);
 if(flow.loop!==undefined&&typeof flow.loop!=='boolean')problems.push('flow.loop must be true, false or absent');
 if(!Array.isArray(flow.steps)||flow.steps.length!==3)return [...problems,'flow.steps must list exactly 3 steps'];
 flow.steps.forEach((step,index)=>{
  if(!step||typeof step!=='object'){problems.push(`flow.steps[${index}] must be an object`);return;}
  problems.push(...extra(step,['icon','title','note']).map(key=>`unknown field flow.steps[${index}].${key}`));
  if(typeof step.icon!=='string'||!Object.hasOwn(SKILL_FLOW_ICONS,step.icon))problems.push(`flow.steps[${index}].icon must be one of the SKILL_FLOW_ICONS names`);
  check(`flow.steps[${index}].title`,step.title,2,14);check(`flow.steps[${index}].note`,step.note,8,60);
 });
 if(problems.length)return problems;
 const lines=skillFlowLines(flow as SkillFlow);
 lines.forEach((step,index)=>{const limit=index===1?SKILL_FLOW_LIMITS.coreTitle:SKILL_FLOW_LIMITS.sideTitle;if(step.title.length>limit)problems.push(`flow.steps[${index}].title wraps to ${step.title.length} lines; its box holds ${limit}`);});
 if(lines[1]!.note.length>SKILL_FLOW_LIMITS.coreNote)problems.push(`flow.steps[1].note wraps to ${lines[1]!.note.length} lines; the core box holds ${SKILL_FLOW_LIMITS.coreNote}`);
 return problems;
}
export const validSkillPageContent=(value:unknown):value is SkillPageContent=>skillPageContentProblems(value).length===0;
const contents=new Map(Object.entries(sources).filter(([,value])=>validSkillPageContent(value)) as [string,SkillPageContent][]);
export const skillPageContentIds=Object.freeze(Object.keys(sources));
export function getSkillPageContent(id:string){return contents.get(id)??null;}
/** Alt text for the rendered share image: the book name, the headline and the three step titles it shows. */
export function skillShareCardAlt(title:string,content:SkillPageContent){
 return '「'+title.split('：')[0]+'」分享圖：'+content.headline+'流程：'+content.flow.steps.map(step=>step.title).join('→')+'。';
}
