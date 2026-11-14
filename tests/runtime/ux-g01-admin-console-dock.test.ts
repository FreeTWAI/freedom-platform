import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import postcss from 'postcss';
import {GameConsoleProvider} from '../../apps/portal-web/src/GameConsole.js';

const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');

test('AdminConsoleShell passes headless to GameConsoleProvider so the dock is not mounted on /admin',()=>{
  const app=read('App.tsx');
  const start=app.indexOf('function AdminConsoleShell()');
  const end=app.indexOf('\nfunction ',start+1);
  assert.ok(start>=0&&end>start);
  const body=app.slice(start,end);
  assert.match(body,/<GameConsoleProvider[^>]*\bheadless\b/);
  assert.doesNotMatch(body,/\bstandalone\b/);

  const withDock=renderToStaticMarkup(createElement(GameConsoleProvider,{feedEnabled:false,standalone:true},createElement('div',null,'admin')));
  assert.match(withDock,/class="game-console\b/);
  const headlessHtml=renderToStaticMarkup(createElement(GameConsoleProvider,{feedEnabled:false,headless:true},createElement('div',null,'admin')));
  assert.doesNotMatch(headlessHtml,/class="game-console\b/);
  assert.doesNotMatch(headlessHtml,/class="game-console-page\b/);
});

test('non-headless game-console pages reserve bottom space at least equal to the 54px dock at every width',()=>{
  const css=read('GameConsole.css');
  const pageRules:{media:string|null;paddingBottom:string}[]=[];
  postcss.parse(css).walkRules('.game-console-page',rule=>{
    let paddingBottom='';
    rule.walkDecls('padding-bottom',decl=>{paddingBottom=decl.value;});
    if(!paddingBottom)return;
    const parent=rule.parent;
    pageRules.push({media:parent?.type==='atrule'?parent.params:null,paddingBottom});
  });
  assert.ok(pageRules.length>=1);
  for(const rule of pageRules){
    const match=/^calc\((\d+)px\b|^(\d+)px$/.exec(rule.paddingBottom.trim());
    assert.ok(match,`unexpected padding-bottom: ${rule.paddingBottom}`);
    const px=Number(match[1]??match[2]);
    assert.ok(px>=54,`padding-bottom ${px}px is smaller than 54px dock`);
  }
});
