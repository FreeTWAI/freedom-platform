import {escapeHtml} from '../../packages/shared/html.js';
import {communityCatalog} from '../community/catalog.js';
import {getSkillPageContent,type SkillPageContent} from '../community/skill-page-content.js';
import {SKILL_FLOW_ICONS,wrapFlowText} from './skill-flow.js';

const escape=escapeHtml;
export const SKILL_SHARE_CARD_SIZE={width:1200,height:630} as const;
export const SKILL_SHARE_MANIFEST='docs/design/skill-illustration-manifest.json';
export type SkillShareCard={title:string;category:string;content:SkillPageContent};
/**
 * A self-contained 1200×630 document for the OG image. scripts/render-skill-share-cards.ts screenshots it;
 * elements marked data-fit shrink until they fit their line budget, so nothing is cut off.
 */
export function skillShareCardHtml({title,category,content}:SkillShareCard){
 // Step titles break where the schematic would break 25px text in their 216px column, so phrases stay whole.
 // A full-width colon splits the name from its subtitle; each gets its own line so CJK words never break midway.
 const split=title.indexOf('：');
 const heading=split>0?'<span class="name" data-fit="1" data-min="40">'+escape(title.slice(0,split))+'</span><span class="rest" data-fit="1" data-min="28">'+escape(title.slice(split+1))+'</span>':'<span class="name" data-fit="2" data-min="40">'+escape(title)+'</span>';
 const steps=content.flow.steps.map((step,index)=>'<li'+(index===1?' class="core"':'')+'><b class="chip"><svg viewBox="0 0 24 24" aria-hidden="true">'+SKILL_FLOW_ICONS[step.icon]+'</svg></b><em>'+String(index+1).padStart(2,'0')+'</em><strong data-fit="2" data-min="18">'+wrapFlowText(step.title,25,216).map(escape).join('<br>')+'</strong></li>').join('');
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>'+css+'</style></head><body><main class="card"><header><span class="brand"><i></i>自由工坊技能書</span><span class="domain">freetwai.com</span></header><p class="eyebrow">'+escape(category)+'</p><h1>'+heading+'</h1><p class="headline" data-fit="1" data-min="24"><span>'+escape(content.headline)+'</span></p><ol class="flow">'+steps+'</ol></main></body></html>';
}
const css=`*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{font-family:"Noto Sans CJK TC","Noto Sans TC",sans-serif;color:#111d19;background:radial-gradient(circle at 4% 0,rgba(196,255,32,.5),transparent 420px),radial-gradient(circle at 100% 30%,rgba(168,199,250,.55),transparent 460px),#f3f0e7;-webkit-font-smoothing:antialiased}
.card{display:flex;flex-direction:column;width:1200px;height:630px;padding:50px 64px 56px}
header{display:flex;justify-content:space-between;align-items:center;font-size:22px;font-weight:800}
.brand{display:flex;align-items:center;gap:12px}.brand i{width:18px;height:18px;border-radius:5px;background:#c4ff20;box-shadow:0 0 0 2px #111d19}
.domain{color:#33443d;font-family:"Noto Sans Mono CJK TC",monospace;font-size:20px;font-weight:700}
.eyebrow{display:flex;align-items:center;gap:12px;margin:40px 0 0;color:#33443d;font-size:21px;font-weight:800;letter-spacing:.08em}
.eyebrow::before{content:"";width:11px;height:11px;border-radius:50%;background:#3b6800;box-shadow:0 0 0 6px rgba(59,104,0,.15)}
h1{margin:14px 0 0;font-weight:900;letter-spacing:-.035em}h1 span{display:block;text-wrap:balance}.name{font-size:62px;line-height:1.12}.rest{margin-top:6px;color:#33443d;font-size:44px;line-height:1.2;font-weight:800;letter-spacing:-.02em}
.headline{margin:18px 0 0;font-size:34px;line-height:1.35;font-weight:800;text-wrap:balance}
.headline span{padding:0 .1em;background:linear-gradient(transparent 58%,#c4ff20 58%,#c4ff20 94%,transparent 94%)}
.flow{list-style:none;margin:auto 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:44px}
.flow li{position:relative;display:grid;grid-template-columns:52px 1fr;grid-template-rows:auto auto;column-gap:16px;align-items:center;min-height:112px;padding:18px 20px;border:2px solid rgba(17,29,25,.28);border-radius:22px;background:#fffdf8}
.flow li+li::before{content:"";position:absolute;left:-46px;top:50%;width:46px;border-top:3px dashed #3b6800}
.chip{grid-row:1/3;display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:#ebe7da}
.chip svg{width:28px;height:28px;fill:none;stroke:#111d19;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.flow em{font-style:normal;font-family:"Noto Sans Mono CJK TC",monospace;font-size:15px;font-weight:700;letter-spacing:.08em;color:#55645d}
.flow strong{font-size:25px;line-height:1.3;font-weight:800}
.flow .core{border-color:#111d19;background:#111d19;color:#fff;box-shadow:0 18px 40px rgba(17,29,25,.22)}
.flow .core .chip{background:#c4ff20}.flow .core em{color:#c4ff20}`;
/** The card document for a catalog book, or null while the book has no valid page content. */
export function skillShareCardSource(id:string){
 const book=communityCatalog.skill_books.find(value=>value.id===id),content=getSkillPageContent(id);
 if(!book?.guide||!content)return null;
 return {url:`/brand/skill-illustrations/${id}.webp`,html:skillShareCardHtml({title:book.title,category:book.guide.beginner.category,content})};
}
