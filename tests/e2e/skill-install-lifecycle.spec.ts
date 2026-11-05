import {createHash} from 'node:crypto';
import {test,expect} from './fixtures.js';
import {navigate} from './navigation.js';

const skill='---\nname: lifecycle-demo\n---\n# Synthetic skill\n';
const sha=createHash('sha1').update(`blob ${Buffer.byteLength(skill)}\0${skill}`).digest('hex');
const manifest='SKILL.md '+sha;
const bundle={format:'freedom.skill-install-bundle/v1',book_id:'local-workspace-mcp',name:'lifecycle-demo',repository:'Example/lifecycle-demo',commit:'a'.repeat(40),manifest_digest:'sha256:'+createHash('sha256').update(manifest).digest('hex'),files:[{path:'SKILL.md',sha,content_base64:Buffer.from(skill).toString('base64')}]};

for(const width of [1280,390])for(const action of ['複製安裝指令','下載 zip'])test(`closed install ignores late ${action} and explicit reopen works at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.addInitScript(({bundle,manifest})=>{
  const state={requests:[] as {release:()=>void;signal:AbortSignal|null}[],writes:[] as string[],verified:0,urls:0};
  Object.assign(window,{installLifecycle:state});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{state.writes.push(text);}}});
  const fetch=window.fetch.bind(window),digest=crypto.subtle.digest.bind(crypto.subtle),createURL=URL.createObjectURL.bind(URL);
  URL.createObjectURL=blob=>{if(blob instanceof Blob&&blob.type==='application/zip')state.urls++;return createURL(blob);};
  crypto.subtle.digest=async(algorithm,data)=>{
   const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
   const isManifest=new TextDecoder().decode(bytes)===manifest,result=await digest(algorithm,data);
   if(isManifest)state.verified++;return result;
  };
  window.fetch=(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   if(url.endsWith('/api/v1/skills/local-workspace-mcp/install-bundle'))return new Promise<Response>(resolve=>{
    // Deliberately ignore abort, including after close, to exercise the UI fence.
    state.requests.push({signal:init?.signal??null,release:()=>resolve(new Response(JSON.stringify(bundle),{headers:{'Content-Type':'application/json'}}))});
   });
   return fetch(input,init);
  };
 },{bundle,manifest});
 await page.route('**/api/v1/me/skill-books',route=>route.fulfill({json:{items:[]}}));
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
 await navigate(page,'技能書架');await page.getByRole('button',{name:'未解鎖',exact:true}).click();
 const trigger=page.locator('.community-library [data-book-id="local-workspace-mcp"]').getByRole('button',{name:'預覽技能書',exact:true});
 await trigger.click();const dialog=page.getByRole('dialog',{name:'Local Workspace MCP 本機工作助手',exact:true}),install=dialog.locator('.skill-install');
 await install.locator('summary').click();await install.getByRole('button',{name:action,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).installLifecycle.requests.length)).toBe(1);
 if(width===390)await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:'關閉技能書介紹',exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>(window as any).installLifecycle.requests[0].signal?.aborted)).toBe(true);
 await page.evaluate(()=>(window as any).installLifecycle.requests[0].release());
 await expect.poll(()=>page.evaluate(()=>(window as any).installLifecycle.verified)).toBe(1);
 expect(await page.evaluate(()=>{const s=(window as any).installLifecycle;return {writes:s.writes.length,urls:s.urls};})).toEqual({writes:0,urls:0});
 await trigger.click();await install.locator('summary').click();await install.getByRole('radio',{name:'Codex',exact:true}).check();await install.getByRole('button',{name:action,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).installLifecycle.requests.length)).toBe(2);
 const download=action==='下載 zip'?page.waitForEvent('download'):null;
 await page.evaluate(()=>(window as any).installLifecycle.requests[1].release());
 if(download){const file=await download;expect(file.suggestedFilename()).toBe('lifecycle-demo.zip');expect(await file.failure()).toBeNull();await expect(install.getByRole('status')).toContainText('~/.codex/skills');}
 else {await expect(install.getByRole('status')).toContainText('已複製');expect(await page.evaluate(()=>(window as any).installLifecycle.writes)).toEqual([expect.stringContaining('dest="$HOME/.codex/skills/lifecycle-demo"')]);}
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
