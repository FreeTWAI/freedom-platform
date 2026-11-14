import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');

test('disabled primary button keeps its filled style muted without a bright or dashed outline',()=>{
  const css=read('rpg-theme.css');
  const rules:{selector:string;values:Record<string,string>}[]=[];
  postcss.parse(css).walkRules(rule=>{
    if(!rule.selector.includes(':disabled'))return;
    const values:Record<string,string>={};
    rule.walkDecls(decl=>{values[decl.prop]=decl.value;});
    rules.push({selector:rule.selector,values});
  });

  const appliesToDisabledPrimary=(selector:string)=>
    selector.split(',').some(part=>{
      const trimmed=part.trim();
      if(!trimmed.includes(':disabled'))return false;
      if(trimmed.includes(':not(.btn-primary)'))return false;
      if(trimmed.includes('.btn-primary'))return true;
      return trimmed.includes('.btn');
    });

  const matchingPrimaryRules=rules.filter(rule=>appliesToDisabledPrimary(rule.selector));
  assert.ok(matchingPrimaryRules.length>=1,'expected a disabled primary rule');
  for(const rule of matchingPrimaryRules){
    assert.notEqual(rule.values['border-style'],'dashed',`${rule.selector} must not give .btn-primary a dashed border`);
    assert.notEqual(rule.values['border-color'],'var(--muted)',`${rule.selector} must not give .btn-primary a bright muted outline`);
    assert.notEqual(rule.values.background,'var(--bg)',`${rule.selector} must not clear .btn-primary background fill`);
  }

  const primaryDisabled=rules.find(rule=>rule.selector.includes('.btn-primary:disabled'));
  assert.ok(primaryDisabled,'expected explicit .btn-primary:disabled rule');
  const opacity=Number(primaryDisabled.values.opacity);
  assert.ok(Number.isFinite(opacity)&&opacity>0&&opacity<=0.65,'disabled primary button must use reduced opacity');
  assert.equal(primaryDisabled.values['border-color'],'transparent');
  assert.equal(primaryDisabled.values['border-style'],'solid');
  assert.equal(primaryDisabled.values.cursor,'not-allowed');
});
