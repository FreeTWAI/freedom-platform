import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

// Execute the actual browser helper against controlled DOM/screenshot ports.
// This proves measurement/cleanup sensitivity, not browser paint or focus.
const helper=readFileSync(process.env.DAILY_RESULT_STAGE_HELPER_SOURCE??new URL('../e2e/helpers/daily-result-stage.ts',import.meta.url),'utf8');
const start=helper.indexOf('async function labelInName('),end=helper.indexOf('\nexport async function verifyDailyResult(');
assert.ok(start>0&&end>start);
const code=transformSync(helper.slice(start,end),{loader:'ts',target:'es2022'}).code;
const controlNames=['系統分享圖片／連結','下載完整成果 PNG','同一題再來一次','更多分享方式'];
const bounds={x:0,y:0,width:100,height:100,left:0,top:0,right:100,bottom:100};
type Options={focusChanged?:boolean;disabledControl?:boolean;originalOpacity?:string;opacityPriority?:string;noInlineStyle?:boolean;blockCssom?:boolean;suppressionChangesLayout?:boolean;captureMutation?:boolean;ancestorHidden?:boolean;disconnected?:boolean;changed?:number;noOp?:boolean;transparent?:boolean;hidden?:boolean;zeroSize?:boolean;changedStyle?:boolean;clippedControl?:boolean;captureError?:boolean;referenceWidth?:number;flat?:boolean};
async function harness(options:Options={}){
    const attachments=new Map<string,any>(),screenshots:any[]=[],exposedChecks:string[]=[],style={visibility:'visible',opacity:'1',display:'block',fontSize:'28px'};
    const inline='font-size: 28px;';let restored=false,suppressed=false,captureMutation=false,styleAttribute=!options.noInlineStyle;
    const properties=new Map<string,{value:string;priority:string}>();
    if(styleAttribute)properties.set('font-size',{value:'28px',priority:''});
    if(options.originalOpacity)properties.set('opacity',{value:options.originalOpacity,priority:options.opacityPriority??''});
    const cssomWrites:any[]=[];
    const cssom={get length(){return properties.size;},getPropertyValue:(key:string)=>properties.get(key)?.value??'',getPropertyPriority:(key:string)=>properties.get(key)?.priority??'',
        setProperty(key:string,value:string,priority=''){
            cssomWrites.push(['set',key,value,priority]);if(options.blockCssom&&key==='opacity'&&value==='0')return;
            properties.set(key,{value,priority});styleAttribute=true;
            if(key==='opacity'&&value==='0')suppressed=true;else if(key==='opacity'){suppressed=false;restored=true;captureMutation=false;}
        },removeProperty(key:string){cssomWrites.push(['remove',key]);properties.delete(key);if(key==='opacity'){suppressed=false;restored=true;captureMutation=false;}},
    };
    const inlineStyle=()=>styleAttribute?[...properties].map(([key,{value,priority}])=>`${key}: ${value}${priority?' !'+priority:''};`).join(' '):null;
    function node(name:string,rect=bounds){return {get isConnected(){return !(restored&&options.disconnected);},parentElement:null as any,tagName:name?'BUTTON':'SECTION',className:name?'result-control':'daily-result',name,
        style:cssom,
        getAttribute(key:string){return key==='style'?(restored&&options.changedStyle?'font-size: 14px;':name?inline:inlineStyle()):key==='aria-label'?name:null;},
        removeAttribute(key:string){assert.equal(key,'style');assert.equal(properties.size,0);styleAttribute=false;},
        setAttribute(){throw Error('whole inline style writes are forbidden');},
        getBoundingClientRect(){return {...rect,width:restored&&options.zeroSize&&!name?0:suppressed&&options.suppressionChangesLayout&&!name?99:rect.width};},
        hasAttribute(key:string){return key==='style'&&(!!name||styleAttribute);},matches(selector:string){assert.equal(selector,':disabled');return !!(restored&&options.disabledControl&&name===controlNames[0]);},checkVisibility(){return !(restored&&options.hidden);},
        closest(selector:string){return selector==='[inert]'?null:stage;},contains(target:unknown){return target===this;},
        querySelectorAll(){return [summary,dock,...controls];},
    };}
    const stage={getBoundingClientRect:()=>bounds};
    const controls=controlNames.map((name,i)=>node(name,{...bounds,x:i%2*50,y:Math.floor(i/2)*50,width:50,height:50,left:i%2*50,top:Math.floor(i/2)*50,right:i%2*50+50,bottom:Math.floor(i/2)*50+50}));
    const summary=node('summary'),dock=node('dock'),root=node('');
    const ancestor=node('stage ancestor');root.parentElement=ancestor;
    const document={get activeElement(){return restored&&options.focusChanged?controls[0]:ancestor;},elementFromPoint(x:number,y:number){return controls.find(c=>{const r=c.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;});},
        createRange(){let current:ReturnType<typeof node>;return {selectNodeContents(el:ReturnType<typeof node>){current=el;},getClientRects(){return [current.getBoundingClientRect()];}};}};
    function locator(el:ReturnType<typeof node>){return {el,innerText:async()=>el.name,getAttribute:async(key:string)=>el.getAttribute(key),
        async evaluate(fn:(el:unknown,arg?:any)=>unknown,arg?:any){if(el!==root)exposedChecks.push(el.name);if(restored&&options.clippedControl&&el===controls[0])return false;return fn(el,arg);},
        getByRole(_role:string,{name}:{name:string}){const control=controls.find(c=>c.name===name);assert.ok(control);return locator(control);},
    };}
    const result=locator(root);
    const data=Buffer.alloc(100*100*3);
    for(let i=0;i<100*100;i++)data.fill(options.flat?100:i%2?220:30,i*3,i*3+3);
    const reference=await sharp(data,{raw:{width:100,height:100,channels:3}}).png().toBuffer();
    const completed=Buffer.from(data);for(let i=0;i<(options.changed??3000);i++)completed.fill(255,i*3,i*3+3);
    const actual=await sharp(completed,{raw:{width:100,height:100,channels:3}}).png().toBuffer();
    const host={async screenshot(settings:any){screenshots.push(settings);assert.equal(settings.style,undefined,'do not inject a CSP-blocked stylesheet');if(screenshots.length===1)return actual;captureMutation=!!options.captureMutation;if(options.captureError)throw Error('controlled capture failure');if(options.noOp)return actual;if(options.referenceWidth)return sharp(reference).resize(options.referenceWidth,100).png().toBuffer();return reference;}};
    function expect(value:any,message?:string){return {
        toBe(expected:any){assert.equal(value,expected,message??'');},toEqual(expected:any){assert.deepEqual(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(expected)),message??'');},
        toBeGreaterThan(expected:number){assert.ok(value>expected,message??`${value} > ${expected}`);},toBeGreaterThanOrEqual(expected:number){assert.ok(value>=expected,message??`${value} >= ${expected}`);},
        not:{toBe(expected:any){assert.notEqual(value,expected);}},
        async toBeVisible(){assert.ok(!(restored&&options.hidden));},
        async toHaveAccessibleName(pattern:RegExp){assert.match(value.el.name,pattern);},
        async toHaveCSS(property:string,expected:string){const observed=property==='background-color'?'rgba(0, 0, 0, 0)':property==='background-image'?'none':property==='opacity'&&restored&&options.transparent?'0':(style as any)[property];assert.equal(observed,expected);},
    };}
    const context={sharp,Buffer,expect,document,innerWidth:100,innerHeight:100,
        getComputedStyle:(el:any)=>({...style,visibility:restored&&(options.hidden||options.ancestorHidden&&el===ancestor)?'hidden':'visible',opacity:restored&&options.transparent?'0':el===root&&suppressed&&!captureMutation?'0':'1'})};
    const stagePixels=runInNewContext(`${code};stagePixels`,context);
    return {attachments,screenshots,exposedChecks,cssomWrites,inlineStyle,run:()=>stagePixels({locator:(selector:string)=>selector==='[data-daily-result]'?result:host},
        {attach:async(name:string,payload:any)=>attachments.set(name,payload)},'cash','controlled')};
}

test('earned-stage helper uses property-only paint suppression and keeps original screenshot, four targets and threshold',async()=>{
    const h=await harness();await h.run();
    assert.deepEqual(JSON.parse(JSON.stringify(h.screenshots)),[{animations:'disabled'},{animations:'disabled'}]);
    assert.equal(h.attachments.get('controlled-completed-stage.png').contentType,'image/png');
    const exposure=JSON.parse(h.attachments.get('controlled-stage-exposure.json').body);
    assert.equal(exposure.unchangedPixels,7000);assert.equal(exposure.changedPixels,3000);assert.equal(exposure.minimumFraction,.5);assert.equal(exposure.tolerance,2);
    assert.deepEqual([...new Set(h.exposedChecks)].sort(),[...controlNames].sort());
    const observation=JSON.parse(h.attachments.get('controlled-result-restoration.json').body);
    assert.equal(observation.checkpoint,'complete');assert.deepEqual(observation.after,observation.before);
    assert.deepEqual(observation.restoredDeclaration,observation.originalDeclaration);
    assert.equal(observation.suppressedBefore[0].opacity,'0');assert.deepEqual(observation.suppressedAfter,observation.suppressedBefore);
    assert.deepEqual(h.cssomWrites,[['set','opacity','0','important'],['remove','opacity']]);
    assert.equal(observation.preCompleted[0].fontSize,'28px');assert.equal(observation.preCompleted[0].connected,true);
    assert.equal(observation.preCompleted.at(-1).kind,'ancestor');assert.equal(observation.before.at(-1).bounds.width,100);assert.equal(observation.after.at(-1).visibility,'visible');
});
for(const [name,options]of [
    ['blocked CSSOM suppression',{blockCssom:true}],['suppression changed layout',{suppressionChangesLayout:true}],['capture changed suppression',{captureMutation:true}],
    ['no-op paint suppression',{noOp:true}],['more than half the stage covered',{changed:5001}],
    ['unrestored opacity',{transparent:true}],['hidden restored result',{hidden:true}],['zero-size restored root',{zeroSize:true}],['hidden restored ancestor',{ancestorHidden:true}],['detached result owner',{disconnected:true}],
    ['changed keyboard focus',{focusChanged:true}],['disabled restored action',{disabledControl:true}],
    ['lost inline font style',{changedStyle:true}],['clipped or blocked actual target',{clippedControl:true}],
    ['reference geometry changed',{referenceWidth:99}],['blank reference',{flat:true}],
    ['capture rejection',{captureError:true}],
] as [string,Options][])test(`earned-stage measurement rejects ${name} and retains before/after diagnostics`,async()=>{
    const h=await harness(options);await assert.rejects(h.run());
    const observation=JSON.parse(h.attachments.get('controlled-result-restoration.json').body);
    assert.notEqual(observation.checkpoint,'complete');assert.equal(observation.before[0].opacity,'1');assert.ok(observation.after);
    if(!options.changedStyle)assert.equal(h.inlineStyle(),'font-size: 28px;');
    assert.deepEqual(h.cssomWrites.at(-1),['remove','opacity']);
});
test('exact half-stage exposure remains accepted, with nonzero painted overlay changes',async()=>{
    const h=await harness({changed:5000});await h.run();assert.equal(JSON.parse(h.attachments.get('controlled-stage-exposure.json').body).exposedFraction,.5);
});

for(const original of [{originalOpacity:'1',opacityPriority:'important'},{originalOpacity:'1',opacityPriority:''},{noInlineStyle:true}]){
    test(`CSSOM restores original value, priority and attribute presence ${JSON.stringify(original)}`,async()=>{
        const h=await harness(original),before=h.inlineStyle();await h.run();assert.equal(h.inlineStyle(),before);
        if(original.originalOpacity)assert.deepEqual(h.cssomWrites.at(-1),['set','opacity','1',original.opacityPriority]);
    });
    test(`CSSOM capture failure still restores ${JSON.stringify(original)}`,async()=>{
        const h=await harness({...original,captureError:true}),before=h.inlineStyle();await assert.rejects(h.run(),/controlled capture failure/);assert.equal(h.inlineStyle(),before);
        const observed=JSON.parse(h.attachments.get('controlled-result-restoration.json').body);assert.equal(observed.checkpoint,'reference-capture');assert.deepEqual(observed.after,observed.before);assert.deepEqual(observed.restoredDeclaration,observed.originalDeclaration);
    });
}

test('installed Playwright screenshot style creates an inline style tag and is transient and element screenshot restores it in finally',()=>{
    const source=readFileSync(new URL('../../node_modules/playwright-core/lib/coreBundle.js',import.meta.url),'utf8');
    const from=source.indexOf('function inPagePrepareForScreenshots('),to=source.indexOf('\nfunction trimClipToSize(',from);
    assert.ok(from>=0&&to>from);
    const styles:{textContent?:string;removed?:boolean;remove:()=>void}[]=[];
    const document={documentElement:{append:(style:any)=>styles.push(style)},createElement:()=>{const style={textContent:'',removed:false,remove(){this.removed=true;}};return style;},
        createTreeWalker:()=>({currentNode:{},nextNode:()=>false}),querySelectorAll:()=>[],getAnimations:()=>[],addEventListener(){},removeEventListener(){}};
    const window:any={};const prepare=runInNewContext(`${source.slice(from,to)};inPagePrepareForScreenshots`,{document,window,NodeFilter:{SHOW_ELEMENT:1},Element:class{}});
    prepare('[data-daily-result] { opacity: 0 !important; }',false,true,false);
    assert.equal(createHash('sha256').update(styles[0].textContent!).digest('base64'),'RWvJGMSiNYAE0JTeiysOfjamDIEy7ZTcCzUMex/TVcA=','matches the exact stylesheet blocked by official df236 CSP');
    assert.equal(styles.length,1);assert.equal(styles[0].removed,false);assert.equal(styles[0].textContent,'[data-daily-result] { opacity: 0 !important; }');
    window.__pwCleanupScreenshot();assert.equal(styles[0].removed,true);assert.equal(window.__pwCleanupScreenshot,undefined);
    const screenshot=source.slice(source.indexOf('async screenshotElement('),source.indexOf('async _preparePageForScreenshot('));
    assert.match(screenshot,/_preparePageForScreenshot\(progress2, handle\._frame, options\.style/);
    assert.match(screenshot,/finally\s*\{\s*await progress2\.race\(this\._restorePageAfterScreenshot\(\)\)/);
});

test('fallback regression retains outer wrap, inner modal wrap, Escape return and real replay focus',()=>{
    const source=readFileSync(new URL('../e2e/absurd-daily.spec.ts',import.meta.url),'utf8');
    const start=source.indexOf("test('fallback keeps keyboard focus inside game, result and replay'");
    const body=source.slice(start,source.indexOf("for (const outcome of ['resolve','reject']",start));
    assert.ok(body.includes('test.setTimeout(120_000)'));assert.ok(body.includes("testInfo.attach('fallback-result-focus.json'"));
    assert.match(body,/const last=result\.getByRole\('button',\{name:'更多分享方式',exact:true\}\)/);
    for(const control of ['關閉分享','回遊樂場'])assert.ok(body.includes(`share.getByRole('button',{name:'${control}',exact:true})`));
    assert.match(body,/await back\.focus\(\);[\s\S]*?await page\.keyboard\.press\('Tab'\);[\s\S]*?await expect\(close\)\.toBeFocused\(\)/);
    assert.match(body,/press\('Shift\+Tab'\);[\s\S]*?await expect\(back\)\.toBeFocused\(\)/);
    assert.ok(body.includes("await expect(share).toBeHidden(); await expect(last).toBeFocused();"));
    assert.ok(body.includes("await expect(dialog.getByRole('button',{name:'退出全螢幕'})).toBeFocused();"));
    assert.ok(body.includes("await page.getByRole('button',{name:'同一題再來一次'}).click();"));
    assert.ok(body.includes("await expect(page.locator('.fw-arcade-board')).toBeFocused();"));
});
