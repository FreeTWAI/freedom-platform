import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');
const selector='.app-frame:has(.social-comment-composer:focus-within) .floating-messages[aria-expanded=false]';
function rules(source:string,target:string){const found:{media:string|null;values:Record<string,string>}[]=[];postcss.parse(source).walkRules(rule=>{if(rule.selector!==target)return;const values:Record<string,string>={};rule.walkDecls(decl=>{values[decl.prop]=decl.value;});const parent=rule.parent;found.push({media:parent?.type==='atrule'?parent.params:null,values});});return found;}
test('feed trigger remains sticky on desktop but returns to document flow only at the existing mobile breakpoint',()=>{
 const css=read('modules/SocialZone.css'),all=rules(css,'.social-composer-start');
 assert.equal(all.find(rule=>rule.media===null)?.values.position,'sticky');
 assert.deepEqual(all.filter(rule=>rule.media!==null),[{media:'(max-width:760px)',values:{position:'static',top:'auto','z-index':'auto'}}]);
});
test('only the closed launcher is removed from painting and tab order during mobile composer focus',()=>{
 assert.deepEqual(rules(read('modules/FloatingMessages.css'),selector),[{media:'(max-width:760px)',values:{display:'none'}}]);
 assert.deepEqual(rules(read('modules/FloatingMessages.css'),'.floating-messages[aria-expanded=true]'),[{media:null,values:{display:'none'}}]);
 assert.equal(rules(read('modules/FloatingMessages.css'),'.floating-message-panel[hidden]')[0].values.display,'none');
});
test('selectors bind the actual app wrapper, persistent inbox, launcher state and comment form',()=>{
 const app=read('App.tsx'),floating=read('modules/FloatingMessages.tsx'),comments=read('modules/SocialInteractions.tsx');
 const wrapper=app.indexOf('<div className="app-frame social-layout">'),inbox=app.indexOf('<FloatingMessages',wrapper),end=app.indexOf('</FloatingMessages>',inbox);
 assert.ok(wrapper>=0&&inbox>wrapper&&end>inbox);assert.match(app.slice(end),/^<\/FloatingMessages>}\s*<\/div>/);
 assert.match(floating,/<button ref={trigger} className="floating-messages"/);assert.match(floating,/aria-expanded={open} aria-controls="floating-message-panel"/);
 assert.match(floating,/<section ref={panel}[\s\S]*?hidden={!open}/);assert.match(comments,/<form className="social-comment-composer"/);
 assert.match(read('modules/SocialZone.tsx'),/<button ref={composerTrigger} type="button" className="social-write-trigger" aria-label={composerText\('title'\)} aria-haspopup="dialog"/);
});
test('negative controls reject the screenshot sticky rule and an unsafe all-states launcher selector',()=>{
 const css=read('modules/SocialZone.css').replace('position:static;top:auto;z-index:auto','position:sticky;top:0;z-index:20');
 assert.notEqual(rules(css,'.social-composer-start').at(-1)?.values.position,'static');
 assert.equal(rules(read('modules/FloatingMessages.css').replace('[aria-expanded=false]',''),selector).length,0);
});
