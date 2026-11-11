import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute the actual JSX handler, not a copy of its algorithm. These ports
// exercise event ownership/boundaries; they do not establish native focus.
const source=readFileSync(process.env.DAILY_RESULT_SOURCE??new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
const dialogStart=source.indexOf('<dialog ref={shareDialog}');
const handlerStart=source.indexOf('onKeyDown={',dialogStart)+'onKeyDown={'.length;
const handlerEnd=source.indexOf('}>',handlerStart);
assert.ok(dialogStart>=0&&handlerStart>dialogStart&&handlerEnd>handlerStart&&handlerEnd<source.indexOf('<header>',dialogStart),'extract only the real share dialog JSX handler');
const handler=source.slice(handlerStart,handlerEnd);
const code=transformSync(`const handler=${handler};`,{loader:'ts',target:'es2022'}).code;
type Control={name:string;tabIndex:number;disabled:boolean;rects:boolean;visibility:string;inert:boolean;focus:()=>void;getClientRects:()=>unknown[];closest:()=>unknown;matches:(selector:string)=>boolean};
function harness(){
    const document={activeElement:null as Control|null};let queries=0;
    function control(name:string,overrides:Partial<Control>={}):Control{
        const node:Control={name,tabIndex:0,disabled:false,rects:true,visibility:'visible',inert:false,
            focus(){document.activeElement=node;},getClientRects(){return node.rects?[{}]:[];},closest(){return node.inert?{}:null;},matches(selector){assert.equal(selector,':disabled');return node.disabled;},...overrides};return node;
    }
    let controls=[control('Close'),control('photo'),control('copy'),control('Back')];
    const handler=runInNewContext(`${code};handler`,{document,getComputedStyle:(node:Control)=>({visibility:node.visibility})});
    function key(key='Tab',shiftKey=false,modifiers:Record<string,boolean>={}){
        let prevented=false,stopped=false;
        handler({key,shiftKey,...modifiers,currentTarget:{querySelectorAll(selector:string){queries++;
            for(const required of ['a[href]','summary','button:not([disabled])','input:not([disabled])','select:not([disabled])','textarea:not([disabled])','[tabindex]'])assert.ok(selector.includes(required),required);
            return controls;}},preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
        return {prevented,stopped};
    }
    return {document,control,key,get controls(){return controls;},set controls(next:Control[]){controls=next;},get queries(){return queries;}};
}

test('real share handler wraps Back Tab to Close and Close Shift+Tab to Back',()=>{
    const h=harness(),[close,,,back]=h.controls;back.focus();assert.deepEqual(h.key(),{prevented:true,stopped:true});assert.equal(h.document.activeElement,close);
    assert.deepEqual(h.key('Tab',true),{prevented:true,stopped:true});assert.equal(h.document.activeElement,back);
});
test('middle navigation remains native and never bubbles into fullscreen trap',()=>{
    const h=harness();h.controls[1].focus();assert.deepEqual(h.key(),{prevented:false,stopped:true});assert.equal(h.document.activeElement,h.controls[1]);
    assert.deepEqual(h.key('Tab',true),{prevented:false,stopped:true});
});
for(const [name,excluded]of [
    ['display:none',{rects:false}],['hidden visibility',{visibility:'hidden'}],['collapsed visibility',{visibility:'collapse'}],
    ['inert ancestor',{inert:true}],['disabled fieldset or control',{disabled:true}],['negative tabindex',{tabIndex:-1}],
] as [string,Partial<Control>][])test(`boundaries exclude ${name}`,()=>{
    const h=harness(),[close,,,back]=h.controls;h.controls=[h.control('excluded first',excluded),...h.controls,h.control('excluded last',excluded)];
    back.focus();assert.deepEqual(h.key(),{prevented:true,stopped:true});assert.equal(h.document.activeElement,close);
    assert.deepEqual(h.key('Tab',true),{prevented:true,stopped:true});assert.equal(h.document.activeElement,back);
});
test('manual fields and current enabled targets are queried again for every key',()=>{
    const h=harness(),[close,,,back]=h.controls;const manual=h.control('manual link input');h.controls=[close,manual,back];
    manual.focus();assert.deepEqual(h.key(),{prevented:false,stopped:true});
    back.disabled=true;manual.focus();assert.deepEqual(h.key(),{prevented:true,stopped:true});assert.equal(h.document.activeElement,close);
    assert.deepEqual(h.key('Tab',true),{prevented:true,stopped:true});assert.equal(h.document.activeElement,manual);assert.equal(h.queries,3);
});
test('one or zero available controls have safe boundaries',()=>{
    const h=harness(),close=h.controls[0];h.controls=[close];close.focus();assert.deepEqual(h.key(),{prevented:true,stopped:true});assert.equal(h.document.activeElement,close);
    assert.deepEqual(h.key('Tab',true),{prevented:true,stopped:true});h.controls=[];assert.deepEqual(h.key(),{prevented:false,stopped:true});
});
test('Escape, activation, replay keys and modified browser shortcuts are not intercepted',()=>{
    const h=harness();h.controls.at(-1)!.focus();
    for(const key of ['Escape','Enter',' '])assert.deepEqual(h.key(key),{prevented:false,stopped:false});
    for(const modifier of ['ctrlKey','altKey','metaKey'])assert.deepEqual(h.key('Tab',false,{[modifier]:true}),{prevented:false,stopped:true});
    assert.equal(h.queries,0);
});
