import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
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
