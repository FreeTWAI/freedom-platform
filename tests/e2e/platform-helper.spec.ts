import {test,expect,type Page,type Locator} from './fixtures.js';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {EXPERIENCE_PROFILES} from '../../apps/portal-web/src/experience-profiles.js';
import type {HelperHostUpdate} from './platform-helper-fixture.js';

let javascript='',css='';
test.beforeAll(async()=>{
  const result=await build({entryPoints:[fileURLToPath(new URL('./platform-helper-fixture.ts',import.meta.url))],bundle:true,write:false,outfile:'platform-helper-fixture.js',external:['/art/*'],format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
  javascript=result.outputFiles.find(file=>file.path.endsWith('.js'))!.text;
  css=result.outputFiles.find(file=>file.path.endsWith('.css'))!.text;
});
test.beforeEach(async({page,baseURL})=>{
  const origin=new URL(baseURL!).origin;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/__platform-helper-isolated')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="zh-Hant" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/__platform-helper-isolated.css"></head><body><div id="root"></div><script src="/__platform-helper-isolated.js"></script></body></html>'});
    if(url.pathname==='/__platform-helper-isolated.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:javascript});
    if(url.pathname==='/__platform-helper-isolated.css')return route.fulfill({contentType:'text/css; charset=utf-8',body:css});
    return route.abort(); // No application API, model provider or external asset requests.
  });
  await page.goto(`${origin}/__platform-helper-isolated`);
  await expect(page.getByRole('button',{name:'問路助手',exact:true})).toBeVisible();
});
async function open(page:Page){await page.getByRole('button',{name:'問路助手',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();}
async function host(page:Page,update:HelperHostUpdate){await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('platform-helper-test-host',{detail})),update);}
const question=(page:Page)=>page.getByLabel('你想做什麼？（最多 240 字）');

test('isolated component: keyboard launch, native Escape, focus return and clean reopen',async({page})=>{
  const launcher=page.getByRole('button',{name:'問路助手',exact:true});
  await launcher.focus();await page.keyboard.press('Enter');await expect(question(page)).toBeFocused();
  await question(page).fill('未送出的合成問題');await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();await expect(launcher).toBeFocused();
  await launcher.press('Enter');await expect(question(page)).toHaveValue('');await expect(question(page)).toBeFocused();
  await page.getByRole('button',{name:'關閉',exact:true}).click();await expect(launcher).toBeFocused();
});
test('isolated component: close-reopen ignores a delayed prior close event',async({page})=>{
  await open(page);
  await page.evaluate(()=>{
    const close=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='關閉')!;
    const launcher=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='問路助手')!;
    close.click();launcher.click();
  });
  await expect(page.getByRole('dialog')).toBeVisible();await question(page).fill('新開啟的問題');
  await page.locator('dialog').dispatchEvent('close');
  await expect(question(page)).toHaveValue('新開啟的問題');
  await expect(page.getByRole('button',{name:'問路助手',exact:true})).toHaveAttribute('aria-expanded','true');
});
test('isolated component: IME stays composing, submit clears input and does not bubble to host',async({page})=>{
  await open(page);await question(page).fill('怎麼學AI');
  await question(page).dispatchEvent('compositionstart');
  await question(page).dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});
  await page.locator('dialog form').evaluate(form=>(form as HTMLFormElement).requestSubmit());
  await expect(question(page)).toHaveValue('怎麼學AI');await expect(page.getByRole('button',{name:'前往技能書架',exact:true})).toHaveCount(0);
  await question(page).dispatchEvent('compositionend');await page.getByRole('button',{name:'詢問',exact:true}).click();
  await expect(question(page)).toHaveValue('');await expect(page.getByRole('button',{name:'前往技能書架',exact:true})).toBeVisible();
  await expect(page.getByTestId('escaped-submits')).toHaveText('0');
});
test('isolated component: declined navigation preserves draft; accepted page change closes',async({page})=>{
  await page.getByLabel('合成業務草稿').fill('仍須保存的草稿');await open(page);
  await page.getByRole('button',{name:'學 AI',exact:true}).click();await page.getByRole('button',{name:'前往技能書架',exact:true}).click();
  await expect(page.getByTestId('host-calls')).toHaveText('1');await expect(page.getByTestId('host-page')).toHaveText('todos');
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByLabel('合成業務草稿')).toHaveValue('仍須保存的草稿');
  await host(page,{allow:true});await page.getByRole('button',{name:'前往技能書架',exact:true}).click();
  await expect(page.getByTestId('host-page')).toHaveText('skills');await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('合成業務草稿')).toHaveValue('仍須保存的草稿');
});
for(const boundary of ['account','page','blocked'] as const)test(`isolated component: ${boundary} change removes old questions and results`,async({page})=>{
  await open(page);await page.getByRole('button',{name:'學 AI',exact:true}).click();await question(page).fill('舊工作階段問題');
  await host(page,boundary==='account'?{accountScope:'synthetic-next'}:boundary==='page'?{pageId:'guilds'}:{blocked:true});
  await expect(page.getByRole('dialog')).not.toBeVisible();
  if(boundary==='blocked'){await expect(page.getByRole('button',{name:'問路助手',exact:true})).toHaveCount(0);await host(page,{blocked:false});}
  await open(page);await expect(question(page)).toHaveValue('');await expect(page.getByRole('button',{name:'前往技能書架',exact:true})).toHaveCount(0);
});
test('isolated component: unknown query is not echoed and unavailable destinations disappear',async({page})=>{
  await open(page);const raw='synthetic-private-query-827';await question(page).fill(raw);await question(page).press('Enter');
  await expect(question(page)).toHaveValue('');await expect(page.getByRole('dialog')).not.toContainText(raw);
  await expect(page.getByText('目前只能辨識少數站內方向', {exact:false})).toBeVisible();
  await page.getByRole('button',{name:'學 AI',exact:true}).click();await host(page,{available:[]});
  await expect(page.getByRole('button',{name:'前往技能書架',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'前往職業公會',exact:true})).toHaveCount(0);
});
for(const width of [320,390])test(`isolated component: ${width}px short viewport and enlarged text keep close reachable`,async({page})=>{
  await page.setViewportSize({width,height:480});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await open(page);await page.getByRole('button',{name:'學 AI',exact:true}).click();
  const close=page.getByRole('button',{name:'關閉',exact:true});await expect(close).toBeVisible();
  const rect=await close.boundingBox();expect(rect).not.toBeNull();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);expect(rect!.y+rect!.height).toBeLessThanOrEqual(480);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'前往技能書架',exact:true}).scrollIntoViewIfNeeded();await close.click();await expect(page.getByRole('dialog')).not.toBeVisible();
});

// Actual computed styles in a browser; source-token tests cannot replace these.
function helperColorTransitionsSettled(element:Element){
  // Changing a profile after mount starts the real theme color transitions.
  // Flush style first so getAnimations sees newly-created CSS transitions.
  void getComputedStyle(element).color;
  const colors=element.getAnimations().filter(animation=>animation instanceof CSSTransition&&
    /^(?:color|background-color|outline-color|border(?:-(?:top|right|bottom|left))?-color)$/.test(animation.transitionProperty));
  if(colors.some(animation=>animation.playState==='paused'))throw Error('Helper color transition is paused');
  return colors.every(animation=>!animation.pending&&(animation.playState==='finished'||animation.playState==='idle'));
}
async function readable(button:Locator){
  // Use the existing expect budget, not a fixed delay or disabled animations.
  // Every normal/hover/focus sample must reach its own color endpoint.
  await expect.poll(()=>button.evaluate(helperColorTransitionsSettled)).toBe(true);
  const styles=await button.evaluate(element=>{
    const style=getComputedStyle(element);
    function luminance(value:string){
      const parts=value.match(/[\d.]+/g)!.map(Number);
      if(parts.length>3&&parts[3]!==1)throw Error('Expected opaque helper colors');
      const rgb=parts.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    }
    function contrast(a:string,b:string){const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (values[1]+.05)/(values[0]+.05);}
    return {text:contrast(style.color,style.backgroundColor),focus:contrast(style.outlineColor,style.backgroundColor),outline:style.outlineStyle,width:parseFloat(style.outlineWidth),color:style.color,background:style.backgroundColor,opacity:style.opacity};
  });
  expect(styles.text).toBeGreaterThanOrEqual(4.5);return styles;
}
async function buttonStates(page:Page,button:Locator){
  await button.scrollIntoViewIfNeeded();await page.mouse.move(0,0);
  await readable(button);
  await button.hover();await readable(button);
  // Establish keyboard modality rather than asserting :focus-visible after a mouse click.
  await button.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(button).toBeFocused();
  const focused=await readable(button);expect(focused.outline).toBe('solid');expect(focused.width).toBeGreaterThanOrEqual(2);expect(focused.focus).toBeGreaterThanOrEqual(3);

}
// One representative secondary button per profile; the real-app host cases
// retain coverage of launcher, modal and destination actions across all profiles.
for(const profile of Object.values(EXPERIENCE_PROFILES))test(`isolated helper: ${profile.id} representative action retains contrast`,async({page})=>{
  await page.setViewportSize({width:390,height:640});
  await page.evaluate(value=>{document.documentElement.dataset.theme=value.baseTheme;document.documentElement.dataset.experienceProfile=value.id;if(value.skin)document.documentElement.dataset.guideSkin=value.skin;else delete document.documentElement.dataset.guideSkin;},profile);
  await buttonStates(page,page.getByRole('button',{name:'問路助手',exact:true}));
});
