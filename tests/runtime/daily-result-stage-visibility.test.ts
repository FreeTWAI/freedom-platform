import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import sharp from 'sharp';

// Execute the actual browser helper against controlled DOM/screenshot ports.
// This proves measurement/cleanup sensitivity, not browser paint or focus.
const helper=readFileSync(process.env.DAILY_RESULT_STAGE_HELPER_SOURCE??new URL('../e2e/helpers/daily-result-stage.ts',import.meta.url),'utf8');
const start=helper.indexOf('async function labelInName('),end=helper.indexOf('\nexport async function verifyDailyResult(');
assert.ok(start>0&&end>start);
const code=transformSync(helper.slice(start,end),{loader:'ts',target:'es2022'}).code;
const controlNames=['系統分享圖片／連結','下載完整成果 PNG','同一題再來一次','更多分享方式'];
const bounds={x:0,y:0,width:100,height:100,left:0,top:0,right:100,bottom:100};
type Options={ancestorHidden?:boolean;disconnected?:boolean;changed?:number;noOp?:boolean;transparent?:boolean;hidden?:boolean;zeroSize?:boolean;changedStyle?:boolean;clippedControl?:boolean;captureError?:boolean;referenceWidth?:number;flat?:boolean;insertNeighbor?:boolean;noStylesheet?:boolean};
async function harness(options:Options={}){
    const attachments=new Map<string,any>(),screenshots:any[]=[],exposedChecks:string[]=[],style={visibility:'visible',opacity:'1',display:'block',fontSize:'28px'};
    const inline='font-size: 28px;';let restored=false,suppressed=false,disposed=false;
    const originalRule={cssText:'.original { color: black; }'},neighbor={cssText:'.neighbor { color: red; }'};
    const sheet={href:'https://fixture.invalid/assets/app.css',disabled:false,cssRules:[originalRule],
        insertRule(cssText:string,index:number){this.cssRules.splice(index,0,{cssText});suppressed=true;return index;},
        deleteRule(index:number){this.cssRules.splice(index,1);suppressed=false;restored=true;}};
    function node(name:string,rect=bounds){return {get isConnected(){return !(restored&&options.disconnected);},parentElement:null as any,tagName:name?'BUTTON':'SECTION',className:name?'result-control':'daily-result',name,
        getAttribute(key:string){return key==='style'?(restored&&options.changedStyle?'font-size: 14px;':inline):key==='aria-label'?name:null;},
        getBoundingClientRect(){return {...rect,width:restored&&options.zeroSize&&!name?0:rect.width};},
        hasAttribute(){return false;},checkVisibility(){return !(restored&&options.hidden);},
        closest(selector:string){return selector==='[inert]'?null:stage;},contains(target:unknown){return target===this;},
        querySelectorAll(){return [summary,dock,...controls];},
    };}
    const stage={getBoundingClientRect:()=>bounds};
    const controls=controlNames.map((name,i)=>node(name,{...bounds,x:i%2*50,y:Math.floor(i/2)*50,width:50,height:50,left:i%2*50,top:Math.floor(i/2)*50,right:i%2*50+50,bottom:Math.floor(i/2)*50+50}));
    const summary=node('summary'),dock=node('dock'),root=node('');
    const ancestor=node('stage ancestor');root.parentElement=ancestor;
    const document={styleSheets:options.noStylesheet?[]:[sheet],elementFromPoint(x:number,y:number){return controls.find(c=>{const r=c.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;});},
        createRange(){let current:ReturnType<typeof node>;return {selectNodeContents(el:ReturnType<typeof node>){current=el;},getClientRects(){return [current.getBoundingClientRect()];}};}};
    function locator(el:ReturnType<typeof node>){return {el,innerText:async()=>el.name,getAttribute:async(key:string)=>el.getAttribute(key),
        async evaluate(fn:(el:unknown)=>unknown){if(el!==root)exposedChecks.push(el.name);if(restored&&options.clippedControl&&el===controls[0])return false;return fn(el);},
        getByRole(_role:string,{name}:{name:string}){const control=controls.find(c=>c.name===name);assert.ok(control);return locator(control);},
    };}
    const result=locator(root);
    const data=Buffer.alloc(100*100*3);
    for(let i=0;i<100*100;i++)data.fill(options.flat?100:i%2?220:30,i*3,i*3+3);
    const reference=await sharp(data,{raw:{width:100,height:100,channels:3}}).png().toBuffer();
    const completed=Buffer.from(data);for(let i=0;i<(options.changed??3000);i++)completed.fill(255,i*3,i*3+3);
    const actual=await sharp(completed,{raw:{width:100,height:100,channels:3}}).png().toBuffer();
    const host={async screenshot(settings:any){screenshots.push(settings);if(!suppressed)return actual;if(options.insertNeighbor)sheet.cssRules.unshift(neighbor);if(options.captureError)throw Error('controlled capture failure');if(options.noOp)return actual;if(options.referenceWidth)return sharp(reference).resize(options.referenceWidth,100).png().toBuffer();return reference;}};
    function expect(value:any,message?:string){return {
        toBe(expected:any){assert.equal(value,expected,message??'');},toEqual(expected:any){assert.deepEqual(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(expected)),message??'');},
        toBeGreaterThan(expected:number){assert.ok(value>expected,message??`${value} > ${expected}`);},toBeGreaterThanOrEqual(expected:number){assert.ok(value>=expected,message??`${value} >= ${expected}`);},
        not:{toBe(expected:any){assert.notEqual(value,expected);}},
        async toBeVisible(){assert.ok(!(restored&&options.hidden));},
        async toHaveAccessibleName(pattern:RegExp){assert.match(value.el.name,pattern);},
        async toHaveCSS(property:string,expected:string){const observed=property==='background-color'?'rgba(0, 0, 0, 0)':property==='background-image'?'none':property==='opacity'&&(suppressed||restored&&options.transparent)?'0':(style as any)[property];assert.equal(observed,expected);},
    };}
    const context={sharp,Buffer,expect,document,URL,location:{origin:'https://fixture.invalid'},innerWidth:100,innerHeight:100,
        getComputedStyle:(el:any)=>({...style,visibility:restored&&(options.hidden||options.ancestorHidden&&el===ancestor)?'hidden':'visible',opacity:restored&&options.transparent?'0':'1'})};
    const stagePixels=runInNewContext(`${code};stagePixels`,context);
    return {attachments,screenshots,exposedChecks,sheet,originalRule,neighbor,cleanup:()=>({suppressed,disposed}),run:()=>stagePixels({locator:(selector:string)=>selector==='[data-daily-result]'?result:host,
        async evaluateHandle(fn:()=>unknown){const value=fn();return {evaluate:async(callback:(value:unknown)=>unknown)=>callback(value),dispose:async()=>{disposed=true;}};}},
        {attach:async(name:string,payload:any)=>attachments.set(name,payload)},'cash','controlled')};
}

test('earned-stage helper uses snapshot-only paint suppression and keeps original screenshot, four targets and threshold',async()=>{
    const h=await harness();await h.run();
    assert.deepEqual(JSON.parse(JSON.stringify(h.screenshots)),[{animations:'disabled'},{animations:'disabled'}]);
    assert.deepEqual(h.sheet.cssRules,[h.originalRule]);assert.deepEqual(h.cleanup(),{suppressed:false,disposed:true});
    assert.equal(h.attachments.get('controlled-completed-stage.png').contentType,'image/png');
    const exposure=JSON.parse(h.attachments.get('controlled-stage-exposure.json').body);
    assert.equal(exposure.unchangedPixels,7000);assert.equal(exposure.changedPixels,3000);assert.equal(exposure.minimumFraction,.5);assert.equal(exposure.tolerance,2);
    assert.deepEqual([...new Set(h.exposedChecks)].sort(),[...controlNames].sort());
    const observation=JSON.parse(h.attachments.get('controlled-result-restoration.json').body);
    assert.equal(observation.checkpoint,'complete');assert.deepEqual(observation.after,observation.before);
    assert.equal(observation.preCompleted[0].fontSize,'28px');assert.equal(observation.preCompleted[0].connected,true);
    assert.equal(observation.preCompleted.at(-1).kind,'ancestor');assert.equal(observation.before.at(-1).bounds.width,100);assert.equal(observation.after.at(-1).visibility,'visible');
});
for(const [name,options]of [
    ['no-op paint suppression',{noOp:true}],['more than half the stage covered',{changed:5001}],
    ['unrestored opacity',{transparent:true}],['hidden restored result',{hidden:true}],['zero-size restored root',{zeroSize:true}],['hidden restored ancestor',{ancestorHidden:true}],['detached result owner',{disconnected:true}],
    ['lost inline font style',{changedStyle:true}],['clipped or blocked actual target',{clippedControl:true}],
    ['reference geometry changed',{referenceWidth:99}],['blank reference',{flat:true}],
    ['capture rejection',{captureError:true}],
] as [string,Options][])test(`earned-stage measurement rejects ${name} and retains before/after diagnostics`,async()=>{
    const h=await harness(options);await assert.rejects(h.run());
    const observation=JSON.parse(h.attachments.get('controlled-result-restoration.json').body);
    assert.notEqual(observation.checkpoint,'complete');assert.equal(observation.before[0].opacity,'1');assert.ok(observation.after);
});
test('exact half-stage exposure remains accepted, with nonzero painted overlay changes',async()=>{
    const h=await harness({changed:5000});await h.run();assert.equal(JSON.parse(h.attachments.get('controlled-stage-exposure.json').body).exposedFraction,.5);
});

for(const captureError of [false,true])test(`paint reference removes only its owned rule after ${captureError?'failed':'successful'} capture`,async()=>{
    const h=await harness({insertNeighbor:true,captureError});
    if(captureError)await assert.rejects(h.run(),/controlled capture failure/);else await h.run();
    assert.deepEqual(h.sheet.cssRules,[h.neighbor,h.originalRule]);
    assert.deepEqual(h.cleanup(),{suppressed:false,disposed:true});
});
test('paint reference fails closed without a same-origin stylesheet',async()=>{
    const h=await harness({noStylesheet:true});await assert.rejects(h.run(),/No same-origin stylesheet/);
    assert.equal(h.screenshots.length,1);assert.equal(h.attachments.has('controlled-stage-exposure.json'),false);
});

test('fallback regression retains outer wrap, inner modal wrap, Escape return and real replay focus',()=>{
    const source=readFileSync(new URL('../e2e/absurd-daily.spec.ts',import.meta.url),'utf8');
    const start=source.indexOf("test('fallback keeps keyboard focus inside game, result and replay'");
    const body=source.slice(start,source.indexOf("for (const outcome of ['resolve','reject']",start));
    assert.match(body,/const last=result\.getByRole\('button',\{name:'更多分享方式',exact:true\}\)/);
    for(const control of ['關閉分享','回遊樂場'])assert.ok(body.includes(`share.getByRole('button',{name:'${control}',exact:true})`));
    assert.match(body,/await back\.focus\(\); await page\.keyboard\.press\('Tab'\); await expect\(close\)\.toBeFocused\(\)/);
    assert.match(body,/press\('Shift\+Tab'\); await expect\(back\)\.toBeFocused\(\)/);
    assert.ok(body.includes("await expect(share).toBeHidden(); await expect(last).toBeFocused();"));
    assert.ok(body.includes("await expect(dialog.getByRole('button',{name:'退出全螢幕'})).toBeFocused();"));
    assert.ok(body.includes("await page.getByRole('button',{name:'同一題再來一次'}).click();"));
    assert.ok(body.includes("await expect(page.locator('.fw-arcade-board')).toBeFocused();"));
});
