import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');

test('disabled primary button follows the shared opaque disabled button rule',()=>{
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
  const sharedDisabled=rules.find(rule=>rule.selector===':root .btn:disabled');
  assert.ok(sharedDisabled,'expected :root .btn:disabled rule');
  assert.deepEqual(sharedDisabled.values,{
    background:'var(--bg)',
    color:'var(--muted)',
    'border-color':'var(--muted)',
    'border-style':'dashed',
    opacity:'1',
    'box-shadow':'none',
    cursor:'not-allowed'
  });

  const primaryDisabled=rules.find(rule=>rule.selector.includes('.btn-primary:disabled'));
  assert.equal(primaryDisabled,undefined,'must not split .btn-primary:disabled from the shared rule');
});
