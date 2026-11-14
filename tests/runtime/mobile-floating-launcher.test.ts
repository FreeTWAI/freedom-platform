import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');

function findRules(source:string,predicate:(selector:string,media:string|null)=>boolean){
  const found:{media:string|null;selector:string;values:Record<string,string>}[]=[];
  postcss.parse(source).walkRules(rule=>{
    const parent=rule.parent;
    const media=parent?.type==='atrule'?parent.params:null;
    if(!predicate(rule.selector,media))return;
    const values:Record<string,string>={};
    rule.walkDecls(decl=>{values[decl.prop]=decl.value;});
    found.push({media,selector:rule.selector,values});
  });
  return found;
}

test('at <=640px the page reserves bottom space for the floating launcher and hides it during text focus or dialog open',()=>{
  const css=read('modules/FloatingMessages.css');
  const paddingRules=findRules(css,(selector,media)=>media==='(max-width:640px)'&&selector.includes('.app-frame:has(.floating-messages)')&&selector.includes('.main'));
  assert.equal(paddingRules.length,1);
  assert.match(paddingRules[0].values['padding-bottom']??'',/^calc\(88px \+/);

  const hideRules=findRules(css,(selector,media)=>media==='(max-width:640px)'&&selector.endsWith('.floating-messages[aria-expanded=false]'));
  assert.equal(hideRules.length,1);
  assert.equal(hideRules[0].values.display,'none');
  for(const required of ['dialog[open]','[role=dialog]:not(#floating-message-panel):not([hidden])','[aria-modal=true]:not(#floating-message-panel):not([hidden])','textarea:focus','input:not([type=checkbox])','[contenteditable]:not([contenteditable=false]):focus']){
    assert.ok(hideRules[0].selector.includes(required),`missing ${required}`);
  }
});

test('mobile tap targets enforce at least 44px min-height on disclosures, checkbox rows and chips',()=>{
  const css=read('rpg-theme.css');
  const tapRules=findRules(css,(selector,media)=>media==='(max-width:760px)'&&selector.includes('details>summary')&&selector.includes('.checkbox-row'));
  assert.equal(tapRules.length,1);
  assert.equal(tapRules[0].values['min-height'],'44px');
  for(const required of ['details>summary','.checkbox-row','.checkbox-card','.selection-chip']){
    assert.ok(tapRules[0].selector.includes(required),`missing ${required}`);
  }
});
