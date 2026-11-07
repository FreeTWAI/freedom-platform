import {escapeHtml} from '../../packages/shared/html.js';
import type {SkillPageContent} from '../community/skill-page-content.js';
import {skillFlowCss,skillFlowFigure,skillFlowIcon} from './skill-flow.js';

const escape=escapeHtml;
const pad2=(value:number)=>String(value).padStart(2,'0');
const tick='<svg class="sp-tick" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>';
// Latin counts about half a CJK glyph; long titles step down so the hero keeps two or three lines.
const titleSize=(title:string)=>{const units=[...title].reduce((sum,char)=>sum+(/[\u0000-ɏ]/.test(char)?.55:1),0);return units<=11?'short':units<=21?'medium':'long';};
export type SkillPageGuide={
 format:string;audience:readonly string[];status:string;features:readonly string[];prerequisites:readonly string[];
 first_steps:readonly string[];first_result:string;reviewed_at:string;quickstart?:{context:string;commands:string}|null;
};
export type SkillPageHero={
 title:string;kind:string;category:string;format:string;purpose:string;coverUrl?:string|null;
 /** Trusted markup built by the caller from escaped values. */
 actions:string;credit:string;badges:string;content:SkillPageContent|null;
};
/** Title, punchline and the outcome card; the cover stays as the shelf thumbnail. */
export function skillPageHero(hero:SkillPageHero){
 const split=hero.title.indexOf('：');
 const title=split>0?'<span class="sp-name">'+escape(hero.title.slice(0,split))+'</span><span class="sp-rest">'+escape(hero.title.slice(split))+'</span>':escape(hero.title);
 const cover=hero.coverUrl?'<figure class="public-skill-cover"><img src="'+escape(hero.coverUrl)+'" alt="" width="768" height="512"></figure>':'';
 const outcomes=hero.content?'<div class="sp-receipt-wrap"><div class="sp-receipt"><div class="sp-receipt-head">'+cover+'<p class="sp-receipt-label" id="skill-outcomes-title">你會拿到</p><span class="sp-receipt-count" aria-hidden="true">'+pad2(hero.content.outcomes.length)+'</span></div><ul class="sp-outcomes" aria-labelledby="skill-outcomes-title">'+hero.content.outcomes.map(item=>'<li>'+tick+'<span>'+escape(item)+'</span></li>').join('')+'</ul><p class="sp-receipt-foot">'+escape(hero.format)+'</p></div></div>':'';
 return '<section class="public-skill-entry"><div class="sp-hero'+(outcomes?'':' sp-hero-single')+'"><div class="sp-hero-copy">'+(outcomes?'':cover)+'<p class="sp-eyebrow">'+escape(hero.kind)+' · '+escape(hero.category)+'</p><h1 class="sp-title" data-size="'+titleSize(hero.title)+'">'+title+'</h1>'
  +(hero.content?'<p class="sp-headline"><span>'+escape(hero.content.headline)+'</span></p>':'')+'<p class="public-skill-purpose">'+escape(hero.purpose)+'</p><div class="public-skill-actions">'+hero.actions+'</div><div class="sp-hero-notes">'+hero.credit+hero.badges+'</div></div>'+outcomes+'</div></section>';
}
export function skillPageFlow(content:SkillPageContent){
 return '<section class="sp-band sp-flow-band" aria-labelledby="skill-flow-title"><div class="sp-wrap"><div class="sp-problem" id="skill-problem"><span class="sp-problem-label">原本卡在哪</span><p>'+escape(content.problem)+'</p></div><div class="sp-head"><div><p class="sp-kicker">從問題到成果</p><h2 id="skill-flow-title">'+escape(content.flow.title)+'</h2></div><p class="sp-head-lead">'+escape(content.flow.lead)+'</p></div>'+skillFlowFigure(content.flow)+'<div class="sp-mechanism"><span class="sp-chip">'+skillFlowIcon('layers')+'</span><div><h3>背後的原理</h3><p>'+escape(content.mechanism)+'</p></div></div></div></section>';
}
/** Every authored guide sentence appears once, in reading order: who, what, cautions, then the first practice. */
export function skillPageUsage(guide:SkillPageGuide){
 const grid=(count:number)=>count===4?' sp-grid-2':'';
 const audience='<h3 class="sp-sub">適合這些人</h3><ul class="sp-audience">'+guide.audience.map(item=>'<li><span class="sp-chip">'+skillFlowIcon('user')+'</span><span>'+escape(item)+'</span></li>').join('')+'</ul>';
 const features='<h3 class="sp-sub">主要功能</h3><ol class="sp-features'+grid(guide.features.length)+'">'+guide.features.map((item,index)=>'<li><span class="sp-num" aria-hidden="true">'+pad2(index+1)+'</span><p>'+escape(item)+'</p></li>').join('')+'</ol>';
 const status='<details class="sp-usage-details"><summary>適用環境與使用範圍</summary><p>'+escape(guide.status)+'</p></details>';
 const prepare='<div class="sp-prepare"><h3>開始前準備</h3><ul>'+guide.prerequisites.map(item=>'<li>'+tick+'<span>'+escape(item)+'</span></li>').join('')+'</ul></div>';
 const steps='<h3 class="sp-sub">練習步驟</h3><ol class="sp-steps'+(guide.first_steps.length===4?' sp-grid-2':'')+'">'+guide.first_steps.map((item,index)=>'<li><span class="sp-step-num" aria-hidden="true">'+pad2(index+1)+'</span><p>'+escape(item)+'</p></li>').join('')+'</ol>';
 const quickstart=guide.quickstart?'<div class="sp-quick"><h3>原作的起步指令</h3><p>'+escape(guide.quickstart.context)+'</p><pre><code>'+escape(guide.quickstart.commands)+'</code></pre></div>':'';
 const result='<div class="sp-result"><span class="sp-chip">'+skillFlowIcon('star')+'</span><div><h3>練習成果</h3><p>'+escape(guide.first_result)+'</p></div></div>';
 return '<section class="public-skill-introduction" aria-labelledby="skill-use-title"><div class="sp-band sp-usage"><div class="sp-wrap"><div class="sp-head"><div><p class="sp-kicker">把它用在你的工作裡</p><h2 id="skill-use-title">用途與適用範圍</h2></div></div>'+audience+'<details class="sp-usage-details"><summary>查看完整功能</summary>'+features+'</details></div></div>'
  +'<div class="sp-start" id="skill-start"><div class="sp-wrap"><p class="sp-kicker">第一次使用</p><h2>開始使用</h2>'+prepare+steps+quickstart+result+status+'</div></div></section>';
}
export function skillPageBand(html:string,name:string){return html?'<div class="sp-band '+name+'"><div class="sp-wrap">'+html+'</div></div>':'';}

// Shared elements are scoped to html.skill-page and the rest use sp-/sf- classes that only skill pages render,
// so other development pages keep the dark guide styles from developmentCss.
export const skillPageCss=`
html.skill-page{color-scheme:light;--sp-paper:#f3f0e7;--sp-paper-2:#faf8f2;--sp-card:#fffdf8;--sp-ink:#111d19;--sp-ink-soft:#33443d;--sp-muted:#55645d;--sp-line:rgba(17,29,25,.13);--sp-line-strong:rgba(17,29,25,.3);--sp-lime:#c4ff20;--sp-lime-soft:#efffc2;--sp-lime-ink:#3b6800;--sp-info:#2a59c9;--sp-info-soft:#dfe8ff;--sp-coral:#c2412a;--sp-coral-soft:#ffe4dc;--sp-chip:#ebe7da;--sp-dark:#111d19;--sp-dark-2:#1b2a24;--sp-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Noto Sans Mono CJK TC",monospace;font-family:Inter,"Noto Sans TC","Noto Sans CJK TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;background:var(--sp-paper);color:var(--sp-ink);line-height:1.65;scroll-padding-top:16px}
html.skill-page body{max-width:none;margin:0;padding:0;background:radial-gradient(circle at 6% 0,rgba(196,255,32,.34),transparent 26rem),radial-gradient(circle at 96% 10%,rgba(168,199,250,.32),transparent 30rem),var(--sp-paper) no-repeat;-webkit-font-smoothing:antialiased}
html.skill-page a{color:var(--sp-ink);text-decoration-thickness:1px;text-underline-offset:.2em}
html.skill-page :is(a,button,summary):focus-visible{outline:3px solid var(--sp-info);outline-offset:4px}
html.skill-page :is(h1,h2,h3){color:var(--sp-ink);border:0;padding:0;text-wrap:balance}
html.skill-page :is(p,li,figcaption){text-wrap:pretty}
html.skill-page h2{margin:0}
html.skill-page li{margin:0}
html.skill-page nav{width:min(calc(100% - 40px),1120px);margin:0 auto;padding:10px 0;gap:6px 26px;border-bottom:1px solid var(--sp-line)}
html.skill-page nav a{color:var(--sp-ink-soft);font-size:.92rem;font-weight:700;text-decoration:none}
html.skill-page nav a:first-child{color:var(--sp-ink);font-weight:850;margin-right:auto;gap:10px}
html.skill-page nav a:first-child::before{content:"";width:12px;height:12px;border-radius:4px;background:var(--sp-lime);box-shadow:0 0 0 1px var(--sp-ink)}
html.skill-page nav a:hover{color:var(--sp-ink);text-decoration:underline}
html.skill-page footer{width:min(calc(100% - 40px),1120px);margin:0 auto;padding:28px 0 44px;border-top:1px solid var(--sp-line);color:var(--sp-muted);font-size:.9rem}
.sp-wrap{width:min(calc(100% - 40px),1120px);margin-inline:auto}
.sp-band{padding:80px 0}
.sp-kicker{margin:0 0 12px;color:var(--sp-lime-ink);font-size:.8rem;font-weight:900;letter-spacing:.14em}
.sp-head{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:20px 56px;align-items:end}
html.skill-page .sp-head h2{font-size:clamp(1.9rem,3.7vw,3rem);line-height:1.12;letter-spacing:-.035em;font-weight:900}
.sp-head-lead{margin:0;color:var(--sp-ink-soft);font-size:1.02rem;line-height:1.75}
.sp-chip{display:inline-grid;place-items:center;flex:none;width:40px;height:40px;border-radius:12px;background:var(--sp-chip);color:var(--sp-ink)}
.sp-chip .sf-icon{width:21px;height:21px}
.sp-tick{flex:none;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
html.skill-page .public-skill-entry{display:block;margin:0;padding:0;border:0;border-radius:0;background:none;overflow:hidden}
html.skill-page .public-skill-entry>.sp-hero{width:min(calc(100% - 40px),1120px);margin:0 auto;padding:68px 0 84px;display:grid;grid-template-columns:minmax(0,1.12fr) minmax(300px,.88fr);gap:clamp(36px,6vw,80px);align-items:center}
html.skill-page .public-skill-entry>.sp-hero-single{grid-template-columns:minmax(0,1fr)}
.sp-eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 20px;color:var(--sp-ink-soft);font-size:.8rem;font-weight:850;letter-spacing:.1em}
.sp-eyebrow::before{content:"";flex:none;width:9px;height:9px;border-radius:50%;background:var(--sp-lime-ink);box-shadow:0 0 0 5px rgba(59,104,0,.14)}
html.skill-page .sp-title{margin:0 0 20px;font-size:clamp(2.35rem,5.2vw,4.1rem);line-height:1.08;letter-spacing:-.045em;font-weight:900;overflow-wrap:anywhere}
html.skill-page .sp-title[data-size="medium"]{font-size:clamp(2.1rem,4.3vw,3.4rem)}
html.skill-page .sp-title[data-size="long"]{font-size:clamp(1.85rem,3.4vw,2.7rem);line-height:1.15}
.sp-title .sp-rest{color:var(--sp-ink-soft);font-weight:800}
.sp-headline{margin:0 0 18px;font-size:clamp(1.25rem,2.3vw,1.7rem);font-weight:850;line-height:1.45;letter-spacing:-.01em}
.sp-headline span{padding:0 .12em;background:linear-gradient(transparent 60%,var(--sp-lime) 60%,var(--sp-lime) 94%,transparent 94%);-webkit-box-decoration-break:clone;box-decoration-break:clone}
html.skill-page .public-skill-purpose{max-width:38em;margin:0 0 30px;color:var(--sp-ink-soft);font-size:1.1rem;line-height:1.8}
html.skill-page .public-skill-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px 14px}
html.skill-page .public-skill-actions a{box-sizing:border-box;max-width:100%;min-height:48px;padding:10px 20px;border:1px solid var(--sp-ink);border-radius:999px;background:rgba(255,255,255,.5);color:var(--sp-ink);font-size:.92rem;font-weight:850;text-decoration:none;transition:transform .16s ease}
html.skill-page .public-skill-actions a:first-child{background:var(--sp-ink);border-color:var(--sp-ink);color:#fff;box-shadow:0 8px 24px rgba(17,29,25,.18)}
html.skill-page .public-skill-actions a:first-child::after{content:"↓";margin-left:8px}
html.skill-page .public-skill-actions a:nth-child(n+3){padding:10px 6px;border-color:transparent;background:none;text-decoration:underline;text-underline-offset:.3em}
html.skill-page .public-skill-actions a:hover{transform:translateY(-2px)}
.sp-hero-notes{margin-top:24px;color:var(--sp-ink-soft);font-size:.86rem;font-weight:650}
.sp-hero-notes p{margin:0 0 8px}
html.skill-page .public-skill-badges{margin:10px 0 0;gap:8px}
html.skill-page .public-skill-badges span{padding:4px 11px;border:1px solid var(--sp-line-strong);border-radius:999px;background:rgba(255,255,255,.55);color:var(--sp-ink);font-size:.8rem;font-weight:700}
html.skill-page .public-author-claim-people{margin:6px 0 0;padding-left:20px}
.sp-receipt-wrap{position:relative;padding:22px 18px}
.sp-receipt-wrap::before{content:"";position:absolute;inset:-4% -4% 22% 16%;border-radius:48% 52% 40% 60%;background:#bfd4ff;transform:rotate(5deg)}
.sp-receipt-wrap::after{content:"";position:absolute;left:-2%;bottom:2%;width:34%;height:30%;border-radius:50%;background:rgba(196,255,32,.55);filter:blur(28px)}
.sp-receipt{position:relative;z-index:1;overflow:hidden;border-radius:22px;background:var(--sp-dark);color:#eef4ef;box-shadow:0 26px 80px rgba(17,29,25,.24);transform:rotate(-1.6deg)}
.sp-receipt-head{display:flex;align-items:center;gap:14px;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.12)}
html.skill-page .sp-receipt .public-skill-cover{flex:none;width:66px;max-width:none;margin:0}
html.skill-page .public-skill-entry .sp-receipt .public-skill-cover img{display:block;width:66px;height:44px;max-height:none;aspect-ratio:3/2;object-fit:cover;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:#2a3933}
.sp-receipt-label{margin:0;color:#c7d3cd;font-size:.8rem;font-weight:850;letter-spacing:.12em}
.sp-receipt-count{margin-left:auto;padding:3px 10px;border-radius:999px;background:rgba(196,255,32,.16);color:var(--sp-lime);font-family:var(--sp-mono);font-size:.78rem;font-weight:800}
html.skill-page .sp-outcomes{list-style:none;margin:0;padding:22px 24px 8px;display:grid;gap:16px}
html.skill-page .sp-outcomes li{display:flex;gap:12px;align-items:flex-start;font-size:1.04rem;font-weight:750;line-height:1.5}
.sp-outcomes .sp-tick{width:22px;height:22px;padding:3px;box-sizing:border-box;border-radius:50%;background:var(--sp-lime);color:var(--sp-dark);margin-top:1px}
.sp-receipt-foot{margin:18px 0 0;padding:14px 24px;background:var(--sp-lime);color:var(--sp-dark);font-size:.86rem;font-weight:850;line-height:1.5}
html.skill-page .sp-hero-single .public-skill-cover{width:96px;max-width:none;margin:0 0 22px}
html.skill-page .public-skill-entry .sp-hero-single .public-skill-cover img{width:96px;height:64px;max-height:none;aspect-ratio:3/2;border:1px solid var(--sp-line);border-radius:12px}
.sp-flow-band{background:rgba(255,253,248,.62);border-block:1px solid var(--sp-line)}
.sp-problem{display:grid;grid-template-columns:150px minmax(0,1fr);align-items:start;gap:24px;margin-bottom:48px;padding:0 0 28px;border-bottom:1px solid var(--sp-line)}
.sp-problem-label{display:inline-flex;align-items:center;gap:10px;font-size:.85rem;font-weight:850;color:var(--sp-coral)}
.sp-problem-label::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.sp-problem p{margin:0;max-width:46em;font-size:1.15rem;line-height:1.75;color:var(--sp-ink-soft)}
.sp-mechanism{display:flex;align-items:flex-start;gap:18px;margin:28px 0 0;padding:22px 0 0;border-top:1px solid var(--sp-line)}
html.skill-page .sp-mechanism h3{margin:0 0 8px;font-size:1rem}
.sp-mechanism p{margin:0;max-width:58em;color:var(--sp-ink-soft);font-size:1rem;line-height:1.8}
.sp-usage-details{margin-top:24px;border-top:1px solid var(--sp-line);padding-top:12px}
.sp-usage-details summary{display:flex;align-items:center;min-height:44px;cursor:pointer;font-size:.94rem;font-weight:750;gap:12px}
.sp-usage-details summary::after{content:"+";margin-left:auto;font-size:1.3rem}
.sp-usage-details[open] summary::after{content:"−"}
.sp-usage-details summary::-webkit-details-marker{display:none}
.sp-usage-details>p{max-width:60em}
.sp-start .sp-usage-details{border-color:rgba(255,255,255,.18);color:#c7d3cd}
.sp-start .sp-usage-details summary{color:#eef4ef}
@media(max-width:720px){.sp-problem{grid-template-columns:1fr;gap:12px;margin-bottom:32px}.sp-problem p{font-size:1rem}.sp-mechanism{gap:12px}.sp-mechanism .sp-chip{width:32px;height:32px}}
.sp-sub{margin:44px 0 16px;font-size:1.05rem;font-weight:850}
html.skill-page .sp-audience{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}
html.skill-page .sp-audience li{display:flex;gap:14px;align-items:center;padding:18px 20px;border:1px solid var(--sp-line);border-radius:18px;background:var(--sp-card);font-weight:700;line-height:1.55}
html.skill-page .sp-features{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px}
html.skill-page .sp-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
html.skill-page .sp-features li{padding:24px;border:1px solid var(--sp-line);border-radius:22px;background:var(--sp-card)}
.sp-num{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:11px;background:var(--sp-lime);color:var(--sp-dark);font-family:var(--sp-mono);font-size:.8rem;font-weight:850}
.sp-features li:nth-child(3n+2) .sp-num{background:var(--sp-info-soft);color:var(--sp-info)}
.sp-features li:nth-child(3n) .sp-num{background:var(--sp-coral-soft);color:var(--sp-coral)}
.sp-features p{margin:18px 0 0;color:var(--sp-ink-soft);line-height:1.8}
.sp-status{display:flex;gap:16px;align-items:flex-start;margin:36px 0 0;padding:22px 24px;border:1px solid rgba(194,65,42,.28);border-radius:18px;background:#fff6f2}
.sp-status .sp-chip{background:var(--sp-coral-soft);color:var(--sp-coral)}
.sp-status h3{margin:0 0 6px;font-size:1rem}
.sp-status p{margin:0;color:var(--sp-ink-soft);line-height:1.85}
.sp-start{padding:84px 0;background:var(--sp-dark);color:#e8efe9}
html.skill-page .sp-start :is(h2,h3){color:#fff}
html.skill-page .sp-start h2{font-size:clamp(1.9rem,3.7vw,3rem);line-height:1.12;letter-spacing:-.035em;font-weight:900}
.sp-start .sp-kicker{color:var(--sp-lime)}
html.skill-page .sp-start a{color:var(--sp-lime)}
html.skill-page .sp-start :is(a,button,summary):focus-visible{outline-color:var(--sp-lime)}
.sp-prepare{margin:36px 0 0;padding:24px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:var(--sp-dark-2)}
.sp-prepare h3{margin:0 0 14px;font-size:1rem}
html.skill-page .sp-prepare ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
html.skill-page .sp-prepare li{display:flex;gap:12px;align-items:flex-start;color:#d6e0da;line-height:1.75}
.sp-prepare .sp-tick{width:20px;height:20px;margin-top:4px;color:var(--sp-lime)}
html.skill-page .sp-start .sp-sub{color:#fff}
html.skill-page .sp-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));border-top:1px solid rgba(255,255,255,.16)}
html.skill-page .sp-steps li{padding:24px 24px 8px 0;margin-right:24px;border-right:1px solid rgba(255,255,255,.12)}
html.skill-page .sp-steps li:last-child{border-right:0;margin-right:0}
.sp-step-num{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#fff;color:var(--sp-dark);font-family:var(--sp-mono);font-size:.76rem;font-weight:850}
.sp-steps p{margin:16px 0 0;color:#cfdad3;line-height:1.85;overflow-wrap:anywhere}
.sp-quick{margin:36px 0 0}
.sp-quick h3{margin:0 0 8px;font-size:1rem}
.sp-quick p{margin:0 0 12px;color:#cfdad3}
html.skill-page .sp-quick pre{margin:0;padding:18px 20px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:#0a120f;color:#e9ffd0;font-family:var(--sp-mono);font-size:.88rem;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.sp-result{display:flex;gap:16px;align-items:flex-start;margin:36px 0 0;padding:22px 24px;border:1px solid rgba(196,255,32,.4);border-radius:20px;background:var(--sp-dark-2)}
.sp-result .sp-chip{background:var(--sp-lime);color:var(--sp-dark)}
.sp-result h3{margin:0 0 4px;font-size:1rem}
.sp-result p{margin:0;color:#fff;font-weight:700;line-height:1.7}
html.skill-page .public-skill-introduction{max-width:none;margin:0;padding:0;border:0;border-radius:0;background:none}
html.skill-page .public-skill-next{margin:0;padding:0;border:0;border-radius:0;background:none}
html.skill-page .public-skill-next>h2,html.skill-page :is(.public-share,.public-skill-acquisition,.public-collaboration,.public-skill-source,.sp-events-band section)>h2{font-size:clamp(1.6rem,3vw,2.3rem);line-height:1.2;letter-spacing:-.03em;font-weight:900}
html.skill-page .public-skill-next>p{max-width:46em;margin:12px 0 0;color:var(--sp-ink-soft)}
html.skill-page .public-skill-destinations{margin:28px 0 0;gap:16px}
html.skill-page .public-skill-destinations>li{padding:22px 24px;border:1px solid var(--sp-line);border-radius:20px;background:var(--sp-card)}
html.skill-page .public-skill-destinations a{color:var(--sp-ink);font-size:1.05rem;font-weight:850;text-decoration:none}
html.skill-page .public-skill-destinations a:hover{text-decoration:underline}
html.skill-page .public-skill-destinations p{color:var(--sp-ink-soft)}
html.skill-page .public-skill-destinations .public-skill-destination{color:var(--sp-muted);font-family:var(--sp-mono);font-size:.8rem}
.sp-band.sp-next-band{padding-bottom:40px}
.sp-band.sp-share-band{padding-top:40px}
.sp-share-grid{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:28px 56px;align-items:center;padding:36px;border:1px solid var(--sp-line);border-radius:28px;background:var(--sp-card);box-shadow:0 24px 70px rgba(17,29,25,.08)}
html.skill-page .public-skill-illustration{margin:0}
html.skill-page .public-skill-illustration img{display:block;width:100%;height:auto;max-height:none;aspect-ratio:40/21;object-fit:cover;border:1px solid var(--sp-line);border-radius:18px;background:var(--sp-paper)}
html.skill-page .public-skill-illustration figcaption{margin-top:10px;color:var(--sp-muted);font-size:.85rem;text-align:left}
html.skill-page .public-share{margin:0;gap:14px}
html.skill-page .public-share>p{margin:0;color:var(--sp-ink-soft)}
html.skill-page .public-share-intro{border-left-color:var(--sp-lime-ink)}
html.skill-page .public-share-intro footer{width:auto;color:var(--sp-info)}
html.skill-page .skill-share button{min-height:48px;padding:10px 22px;border:1px solid var(--sp-ink);background:var(--sp-ink);color:#fff;font-weight:850}
html.skill-page .skill-share button:focus-visible{outline:3px solid var(--sp-info)}
html.skill-page .skill-share .public-share-secondary{border:1px solid var(--sp-line-strong);background:transparent;color:var(--sp-ink)}
html.skill-page .public-share-platforms a{border-color:var(--sp-line-strong);background:#fff;color:var(--sp-ink);font-weight:800}
html.skill-page .public-share-platforms a:hover{border-color:var(--sp-ink)}
html.skill-page .public-share-platforms [data-share-platform="x"]{--share-platform:#111111}
html.skill-page .public-share-platforms [data-share-platform="threads"]{--share-platform:#7a3cff}
html.skill-page .public-share-dialog{border:1px solid var(--sp-line-strong);background:var(--sp-card);color:var(--sp-ink);box-shadow:0 30px 90px rgba(17,29,25,.3)}
html.skill-page .public-share-dialog::backdrop{background:rgba(17,29,25,.5)}
html.skill-page .public-share-count{color:var(--sp-info)}
html.skill-page .public-share-text{border-left-color:var(--sp-lime-ink)}
html.skill-page :is(.public-share-url,.public-share-status){color:var(--sp-muted)}
html.skill-page .public-share-error{color:var(--sp-coral)}
html.skill-page .public-share-manual textarea{background:#fff;color:var(--sp-ink);border-color:var(--sp-line-strong)}
html.skill-page .public-skill-acquisition{margin:0;padding:36px;border:1px solid rgba(59,104,0,.35);border-radius:28px;background:linear-gradient(135deg,var(--sp-lime-soft),var(--sp-card) 62%)}
html.skill-page .public-skill-acquisition>p{max-width:46em;color:var(--sp-ink-soft)}
html.skill-page .public-skill-acquisition ul{padding-left:22px;color:var(--sp-ink-soft)}
html.skill-page .public-skill-acquisition li{margin:6px 0}
html.skill-page .skill-acquisition-actions a{min-height:48px;padding:10px 20px;border:1px solid var(--sp-ink);background:rgba(255,255,255,.6);color:var(--sp-ink);font-weight:850}
html.skill-page .skill-acquisition-actions a.skill-acquisition-primary{background:var(--sp-ink);border-color:var(--sp-ink);color:#fff}
html.skill-page :is(.skill-acquisition-note,.skill-acquisition-status){color:var(--sp-muted)}
.sp-band.sp-join-band{padding-top:0}
.sp-facts{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:20px;align-items:start}
html.skill-page :is(.public-github-social,.public-skill-source){margin:0;padding:28px;border:1px solid var(--sp-line);border-radius:24px;background:var(--sp-card)}
html.skill-page .public-github-social>p{margin:10px 0 0;color:var(--sp-muted);font-size:.9rem}
html.skill-page .public-skill-support>a,html.skill-page .public-github-social :is(.btn,.github-count-control){border:1px solid var(--sp-line-strong);background:#fff;color:var(--sp-ink);font-weight:750}
html.skill-page .public-skill-support>a{text-decoration:none}
html.skill-page .public-skill-support>span{color:var(--sp-muted)}
html.skill-page .github-book-social{border-top:0;padding-top:0}
html.skill-page :is(.github-social-source a,.github-book-metrics dt,.github-book-social .github-metrics-note,.public-github-social .muted){color:var(--sp-muted)}
html.skill-page :is(.github-social-source a:hover,.github-social-source a:focus-visible,.github-watch-link,.github-watch-link:hover,.github-watch-link:focus-visible,.github-count-control.github-fork-link){color:var(--sp-info)}
html.skill-page .github-book-metrics dd{color:var(--sp-ink)}
html.skill-page .github-book-social .github-star-control{color:var(--sp-ink)}
html.skill-page .github-star-control .github-star-icon{color:var(--sp-lime-ink)}
html.skill-page .github-book-social .skill-book-star[aria-pressed="true"]{color:var(--sp-lime-ink);border-color:var(--sp-lime-ink);background:var(--sp-lime-soft)}
html.skill-page .public-github-social button:focus-visible{outline-color:var(--sp-info)}
html.skill-page .public-skill-source>p{margin:12px 0 0;color:var(--sp-ink-soft)}
html.skill-page .public-skill-source dl{margin:18px 0 0;padding-top:6px;border-top:1px solid var(--sp-line)}
html.skill-page .public-skill-source dt{margin:0;color:var(--sp-muted);font-size:.88rem}
html.skill-page .public-skill-source dd{color:var(--sp-ink);overflow-wrap:anywhere}
html.skill-page .public-skill-source code{font-family:var(--sp-mono);font-size:.85rem}
.sp-band.sp-facts-band{padding-top:0}
html.skill-page .public-collaboration{margin:0;padding:36px;border:1px solid var(--sp-line);border-radius:28px;background:var(--sp-card)}
html.skill-page .public-collaboration>p,html.skill-page :is(.collaboration-repository,.collaboration-note){color:var(--sp-ink-soft)}
html.skill-page .public-collaboration .public-skill-actions a{min-height:44px;padding:8px 18px;border:1px solid var(--sp-line-strong);background:#fff;color:var(--sp-ink);font-weight:800;box-shadow:none}
html.skill-page .public-collaboration .public-skill-actions a::after{content:none}
html.skill-page .public-collaboration .public-skill-actions a:nth-child(n+3){padding:8px 18px;border-color:var(--sp-line-strong);text-decoration:none}
html.skill-page .collaboration-task{border:1px solid var(--sp-line);background:var(--sp-paper-2)}
html.skill-page .collaboration-state{border-color:var(--sp-line-strong);color:var(--sp-ink-soft)}
html.skill-page .collaboration-milestones li{margin:10px 0}
.sp-band:is(.sp-collab-band,.sp-events-band,.sp-details-band){padding-top:0}
html.skill-page .sp-events-band section{padding:28px;border:1px solid var(--sp-line);border-radius:24px;background:var(--sp-card)}
html.skill-page .sp-events-band li{margin:8px 0}
html.skill-page .public-skill-details{margin:0;border:1px solid var(--sp-line);border-radius:24px;background:var(--sp-card);padding:0 28px}
html.skill-page .public-skill-details>summary{padding:20px 0;font-weight:850}
html.skill-page .public-skill-details[open]{padding-bottom:24px}
html.skill-page .public-skill-details h2{margin:28px 0 10px;font-size:1.2rem}
html.skill-page .public-skill-details li{margin:8px 0}
html.skill-page .public-skill-details pre{border:1px solid var(--sp-line);background:var(--sp-paper-2);color:var(--sp-ink);font-family:var(--sp-mono);font-size:.88rem}
${skillFlowCss}
@media (max-width:900px){html.skill-page .public-skill-entry>.sp-hero{grid-template-columns:minmax(0,1fr);padding:48px 0 64px}.sp-receipt-wrap{max-width:520px}.sp-head{grid-template-columns:minmax(0,1fr)}.sp-share-grid,.sp-facts{grid-template-columns:minmax(0,1fr)}}
@media (max-width:720px){.sp-band,.sp-start{padding-block:56px}.sp-band.sp-next-band{padding-bottom:24px}.sp-band.sp-share-band{padding-top:24px}.sp-band:is(.sp-join-band,.sp-facts-band,.sp-collab-band,.sp-events-band,.sp-details-band){padding-top:0}html.skill-page .sp-grid-2{grid-template-columns:minmax(0,1fr)}html.skill-page .sp-steps{border-top:0}html.skill-page .sp-steps li{margin:0;padding:20px 0;border-right:0;border-top:1px solid rgba(255,255,255,.14)}.sp-share-grid,html.skill-page :is(.public-skill-acquisition,.public-collaboration){padding:22px;border-radius:22px}html.skill-page :is(.public-github-social,.public-skill-source,.sp-events-band section){padding:20px}html.skill-page .public-skill-details{padding:0 20px}.sp-receipt{transform:none}.sp-receipt-wrap{padding:14px 6px}.sp-receipt-wrap::before{inset:0 -2% 26% 20%}}
@media (max-width:480px){html.skill-page nav{width:calc(100% - 32px)}html.skill-page nav a:first-child{width:100%}.sp-wrap,html.skill-page .public-skill-entry>.sp-hero,html.skill-page footer{width:calc(100% - 32px)}html.skill-page .public-skill-actions a:first-child{width:100%;justify-content:center}.sp-outcomes{padding:18px 18px 6px}.sp-receipt-head,.sp-receipt-foot{padding-inline:18px}.sp-status,.sp-result{flex-direction:column}}
@media (prefers-reduced-motion:reduce){html.skill-page .public-skill-actions a{transition:none}html.skill-page .public-skill-actions a:hover{transform:none}}
`;
