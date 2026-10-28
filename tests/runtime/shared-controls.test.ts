import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import {transformSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');
const sheets=['styles.css','rpg-theme.css','light-theme.css','versefolk-theme.css'].map(read);
function declarations(source:string,selector:string){const values:Record<string,string>={};postcss.parse(source).walkRules(rule=>{if(rule.selector===selector)rule.walkDecls(d=>{values[d.prop]=d.value;});});return values;}
function luminance(hex:string){const rgb=hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const tokens=(theme:string)=>Object.assign({},declarations(sheets[0],':root'),declarations(sheets[1],':root'),theme==='dark'?{}:declarations(sheets[2],'html:is([data-theme="light"],[data-theme="versefolk"])'),theme==='versefolk'?declarations(sheets[3],'html[data-theme="versefolk"]'):{});
for(const theme of ['light','dark','versefolk'])test(`shared ${theme} default/secondary enabled, hover, focus and disabled token pairs remain readable`,()=>{
  const t=tokens(theme);
  for(const bg of ['--control-bg','--control-hover'])assert.ok(contrast(t[bg],t['--control-ink'])>=4.5,`${theme} ${bg}`);
  assert.ok(contrast(t['--bg'],t['--muted'])>=4.5,`${theme} disabled label`);
  assert.equal(declarations(sheets[0],'.btn').background,'var(--control-bg,#252d39)');
  assert.equal(declarations(sheets[0],'.btn').color,'var(--control-ink,#f4f6ef)');
});
test('shared states use paired tokens, exclude primary/ghost/module and never dim disabled labels',()=>{
  const hover=declarations(sheets[1],'.btn:where(:not(.btn-primary,.btn-ghost,.btn-module)):is(:hover,:focus-visible):not(:disabled)');
  assert.equal(hover.background,'var(--control-hover)');assert.equal(hover.color,'var(--control-ink)');assert.equal(hover['border-color'],'var(--focus)');
  const disabled=declarations(sheets[1],':root .btn:disabled');
  assert.deepEqual(disabled,{background:'var(--bg)',color:'var(--muted)','border-color':'var(--muted)','border-style':'dashed',opacity:'1','box-shadow':'none',cursor:'not-allowed'});
  assert.equal(declarations(sheets[1],'.btn-primary').background,'var(--green)');assert.equal(declarations(sheets[1],'.btn-ghost').background,'transparent');
  assert.equal(declarations(sheets[1],'.btn')['min-height'],'44px');assert.equal(declarations(sheets[1],':focus-visible').outline,'3px solid var(--focus)');
});
test('negative control detects the screenshot dark surface/light-theme ink mismatch',()=>{
  for(const theme of ['light','versefolk'])assert.ok(contrast('#252d39',tokens(theme)['--ink'])<2);
  const regressed=sheets[0].replace('background:var(--control-bg,#252d39);color:var(--control-ink,#f4f6ef)','background:#252d39;color:var(--ink)');
  assert.notEqual(declarations(regressed,'.btn').background,'var(--control-bg,#252d39)');
});
test('share dialog keeps one scrolling surface and wrapping 44px controls',()=>{
  const css=read('modules/SocialZone.css');assert.equal(declarations(css,'.social-publish-dialog').overflow,'auto');
  assert.equal(declarations(css,'.social-share-preview').overflow,undefined);
  assert.equal(declarations(css,'.social-share-dialog summary')['min-height'],'44px');
  assert.equal(declarations(css,'.social-share-dialog .social-share-actions')['flex-wrap'],'wrap');
  assert.equal(declarations(css,'.social-share-dialog .social-share-actions .btn')['white-space'],'normal');
});
test('standalone styles retain a readable fallback pair without the RPG sheet',()=>{
  assert.ok(contrast('#252d39','#f4f6ef')>=4.5);
  assert.equal(declarations(sheets[0],'.btn').background,'var(--control-bg,#252d39)');
  assert.equal(declarations(sheets[0],'.btn').color,'var(--control-ink,#f4f6ef)');
});

test('Short overlay styling and white focus ring match only the direct share trigger, never dialog buttons',()=>{
  const css=read('modules/ShortVideoFeed.css');
  assert.doesNotMatch(css,/\.short-video-share\s+\.btn/);
  const overlay=declarations(css,'.short-video-feed .short-video-share > .btn');
  assert.equal(overlay.color,'#fff');assert.equal(overlay.background,'rgb(0 0 0 / 0.45)');assert.equal(overlay['min-height'],'44px');
  assert.equal(declarations(css,'.short-video-action:focus-visible, .short-video-share > .btn:focus-visible').outline,'2px solid #fff');
  assert.equal(declarations(css,'.short-video-feed .short-video-share > .btn svg').color,'inherit');
  const feed=read('modules/ShortVideoFeed.tsx'),share=read('modules/SocialPostShare.tsx');
  assert.ok(feed.includes('<span className="short-video-share">{renderShare(post)}</span>'));
  assert.match(share,/return <>\s*<button[\s\S]*?<\/button>\s*<dialog/);
  const regression=css.replaceAll('.short-video-share > .btn','.short-video-share .btn');
  assert.match(regression,/\.short-video-share\s+\.btn/);
  assert.ok(contrast('#ffffff','#8c8c8c')<4.5,'old white-on-translucent-black over white dialog fails');
});

test('Newbie enabled-only override cannot replace the shared disabled border; the old selector is a negative control',()=>{
  const css=read('modules/NewbieVillage.css');
  const original='.newbie-village .btn:not(.btn-primary):not(.btn-danger):not(.btn-ghost)';
  assert.equal(declarations(css,original).border,undefined);
  assert.equal(declarations(css,original+':not(:disabled)').border,'1px solid var(--line)');
  const regression=css.replace(original+':not(:disabled)',original);
  assert.equal(declarations(regression,original).border,'1px solid var(--line)');
  assert.ok((original.match(/\.[a-z-]+/g)||[]).length>3,'old five-class specificity outranks root/btn/disabled');
});

// Text/background interpolation can lose contrast even when both endpoint pairs pass.
test('shared buttons switch foreground/background pairs immediately in both directions',()=>{
  const safe=(css:string)=>assert.equal(declarations(css,'.btn').transition,'border-color .16s');
  safe(sheets[1]);
  assert.equal(declarations(sheets[1],'button,a').transition,'background-color .16s,color .16s,border-color .16s');
  const regression=sheets[1].replace('transition:border-color .16s;','');
  assert.throws(()=>safe(regression),assert.AssertionError);
  const native=readFileSync(new URL('../e2e/public-social-posts.spec.ts',import.meta.url),'utf8');
  assert.ok(native.includes("'disabled','reenabled'"));
  assert.ok(native.includes("state==='reenabled'"));
  assert.ok(native.includes("['none','border-color'].includes(property.trim())"));
});

test('actual native control evaluator composites alpha layers and rejects unreadable or unsupported paint',()=>{
  const source=readFileSync(new URL('../e2e/public-social-posts.spec.ts',import.meta.url),'utf8');
  const start=source.indexOf('function measureSharedControl('),end=source.indexOf('// End source-bound shared control measurement.',start);
  assert.ok(start>=0&&end>start);assert.ok(source.includes('probe.evaluate(measureSharedControl)'));
  const compiled=transformSync(source.slice(start,end)+'\nmeasureSharedControl;',{loader:'ts',target:'es2022'}).code;
  const evaluate=runInNewContext(compiled,{getComputedStyle:(node:any)=>node.style});
  const element=(backgroundColor:string,color='rgb(244, 246, 239)',parentElement:any=null,extra:Record<string,string>={})=>({parentElement,style:{backgroundColor,color,backgroundImage:'none',opacity:'1',outlineStyle:'solid',borderStyle:'solid',transitionProperty:'border-color',...extra},getBoundingClientRect:()=>({height:44}),matches:()=>true});
  const dialog=element('rgb(20, 22, 27)');
  const opaque=evaluate(element('rgb(37, 45, 57)'));assert.ok(opaque.contrast>=4.5);
  const transparent=evaluate(element('rgba(0, 0, 0, 0)',undefined,dialog));assert.deepEqual(Array.from(transparent.background),[20,22,27]);assert.ok(transparent.contrast>=4.5);
  const hover=evaluate(element('rgba(255, 255, 255, 0.0431373)',undefined,dialog));assert.ok(hover.contrast>=4.5);assert.ok(Math.abs(hover.background[0]-30.1372655)<.001);
  const nested=evaluate(element('rgba(255, 255, 255, 0.25)',undefined,element('rgba(0, 0, 0, 0.5)',undefined,element('rgb(100, 100, 100)'))));assert.deepEqual(Array.from(nested.background),[101.25,101.25,101.25]);
  assert.ok(evaluate(element('rgb(255, 255, 255)')).contrast<4.5,'opaque white must still fail for pale text');
  assert.ok(evaluate(element('rgb(37, 45, 57)','rgb(41, 61, 85)')).contrast<4.5,'original dark-on-dark screenshot remains a failure');
  assert.ok(evaluate(element('rgb(20, 22, 27)','rgba(244, 246, 239, 0.1)')).contrast<4.5,'translucent foreground cannot pass as opaque');
  assert.throws(()=>evaluate(element('rgba(0, 0, 0, 0)')),/No known opaque background/);
  assert.throws(()=>evaluate(element('rgb(0, 0, 0)',undefined,null,{opacity:'0.5'})),/Unsupported opacity/);
  assert.throws(()=>evaluate(element('rgb(0, 0, 0)',undefined,null,{backgroundImage:'linear-gradient(black, white)'})),/Unsupported background image/);
  assert.throws(()=>evaluate(element('color(display-p3 0 0 0)')),/Unsupported computed color/);
  assert.throws(()=>evaluate(element('rgb(20, 22, 27)',undefined,element('rgb(0, 0, 0)',undefined,null,{opacity:'0.5'}))),/Unsupported opacity/,'opaque control still inherits ancestor group opacity');
  assert.ok(evaluate(element('rgb(20, 22, 27)',undefined,element('rgb(0, 0, 0)',undefined,null,{backgroundImage:'linear-gradient(black, white)'}))).contrast>=4.5,'opaque control hides ancestor background image');
  // The original helper discarded alpha and treated the ghost's white tint as an opaque white surface.
  const discardAlpha=compiled.replace('alpha: parts[3] ?? 1','alpha: 1');
  assert.notEqual(discardAlpha,compiled);
  const regressed=runInNewContext(discardAlpha,{getComputedStyle:(node:any)=>node.style});
  assert.ok(regressed(element('rgba(255, 255, 255, 0.0431373)',undefined,dialog)).contrast<4.5);
  assert.ok(contrast('#f4f6ef','#ffffff')<4.5);assert.ok(hover.contrast>contrast('#f4f6ef','#ffffff'));
});
