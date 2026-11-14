import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from '@typescript/typescript6';

test('event links retain referral credit through canonical and legacy routes',()=>{
 const source=readFileSync('apps/portal-web/src/modules/EventsPanel.tsx','utf8');
 const file=ts.createSourceFile('EventsPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration='';
 file.forEachChild(node=>{if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(file)==='referralCode'))declaration=node.getText(file);});
 assert.ok(declaration);
 const js=ts.transpile(declaration+'\nthis.read=referralCode;');
 const id='12345678-1234-1234-1234-123456789abc', code='abcdefghijklmnop';
 for(const prefix of ['#events/','#explore/events/']){
  const sandbox:any={window:{location:{hash:prefix+id+'?ref='+code,pathname:'/',search:''}},localStorage:{getItem:()=>null,setItem:()=>{}},URLSearchParams};
  runInNewContext(js,sandbox);
  assert.equal(sandbox.read(id),code);
 }
});
