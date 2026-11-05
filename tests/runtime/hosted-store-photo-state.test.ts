import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, statfs, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium, type Page, type Request as BrowserRequest} from 'playwright';
import sharp from 'sharp';
import {DistributionPhotosSchema} from '../../contracts/guild-launchpad/v1/supplier-console.js';
import {photoAcknowledgement,retainedPhotoFailure,reviewPhotoAttempt,holdPhotoAttempt,heldPhotoAttempt,restorePhotoAttempt,releasePhotoAttempt,forgetRefusedPhotoAttempt,photoBlocksLeaving,type PhotoAttempt} from '../../apps/portal-web/src/modules/hosted-store-photo-state.js';
import {distributionPhotoReadClearsPrivate} from '../../modules/agent-commerce/supplier-console/ui/partner/distribution-photos.js';
import {HOSTED_STORE_MEDIA_PROFILE} from '../../contracts/guild-launchpad/v1/hosted-store-media.js';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {sendProductPhoto} from '../../apps/portal-web/src/modules/hosted-store-photo-client.js';
const tenantId='10000000-0000-4000-8000-000000000001',instanceId='10000000-0000-4000-8000-000000000002',productId='10000000-0000-4000-8000-000000000003';
const file={name:'same-original.png',type:'image/png'} as File;
const attempt:PhotoAttempt=Object.freeze({tenantId,instanceId,productId,expected:'7',key:'same-original-key',file,action:'upload',hadUnknown:false});
const ack={profile:HOSTED_STORE_MEDIA_PROFILE,product_id:productId,completed_version:'8',changed:true,current:{profile:HOSTED_STORE_MEDIA_PROFILE,product_id:productId,version:'10',photo:null}};
test('PHOTO-STATE-07 platform JSON 401 invokes member login while retaining the original unknown operation',async t=>{
  const client=new PortalClient();client.csrfToken='synthetic-session';client.accessExpired=true;
  let notified=0;client.onUnauthorized=()=>{notified++;assert.equal(client.csrfToken,null);assert.equal(client.accessExpired,false);};
  const pending=retainedPhotoFailure(attempt,true);holdPhotoAttempt(client,'member',pending);
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:'unauthorized'}, {status:401}));
  await assert.rejects(sendProductPhoto(client,pending),(e:unknown)=>e instanceof ApiError&&e.status===401&&!e.accessExpired);
  assert.equal(notified,1);assert.equal(heldPhotoAttempt(client,'member',pending)?.key,pending.key);
  assert.equal(heldPhotoAttempt(client,'member',pending)?.file,file);releasePhotoAttempt(client,'member',pending);
});
test('PHOTO-STATE-08 an old photo response cannot log out a newer member session',async t=>{
  const client=new PortalClient();client.csrfToken='synthetic-old';let notified=0;client.onUnauthorized=()=>{notified++;};
  let reply!:(response:Response)=>void;
  t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{reply=resolve;}));
  const request=sendProductPhoto(client,attempt);client.csrfToken='synthetic-new';
  reply(Response.json({code:'unauthorized'}, {status:401}));
  await assert.rejects(request,(e:unknown)=>e instanceof ApiError&&e.network);
  assert.equal(client.csrfToken,'synthetic-new');assert.equal(notified,0);
});
test('PHOTO-STATE-10 a session change while reading the photo ACK keeps the original result unknown',async t=>{
  const client=new PortalClient();client.csrfToken='synthetic-old';
  let reply!:(payload:unknown)=>void,reading!:()=>void;
  const bodyStarted=new Promise<void>(resolve=>{reading=resolve;});
  const response=Response.json(ack);
  t.mock.method(response,'json',()=>{reading();return new Promise(resolve=>{reply=resolve;});});
  t.mock.method(globalThis,'fetch',async()=>response);
  const request=sendProductPhoto(client,attempt);await bodyStarted;client.csrfToken='synthetic-new';reply(ack);
  await assert.rejects(request,(e:unknown)=>e instanceof ApiError&&e.network);
  assert.equal(client.csrfToken,'synthetic-new');
});

test('PHOTO-UI-01 selection saves automatically; a failed refresh never repeats the write and a late member response stays isolated', {timeout:60_000}, async()=>{
  const component=fileURLToPath(new URL('../../apps/portal-web/src/modules/HostedStorePhoto.tsx',import.meta.url));
  const apiModule=fileURLToPath(new URL('../../apps/portal-web/src/api.ts',import.meta.url));
  const image=await sharp({create:{width:12,height:8,channels:3,background:'#365b77'}}).png().toBuffer();
  const base=join(process.cwd(),'.rd');await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,'photo-autosave-'));
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,release:(()=>void)|undefined;
  try{
    const entry=join(dir,'harness.tsx'),bundle=join(dir,'harness.js');
    await writeFile(entry,`import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HostedStorePhoto} from ${JSON.stringify(component)};
import {PortalClient} from ${JSON.stringify(apiModule)};
const client=new PortalClient();client.csrfToken='member-a-session';
let reads=0,failRead=true,version='7';
window.photoStates=[];
function Screen(){
 const [member,setMember]=useState('member-a'),[tick,setTick]=useState(0);
 window.switchPhotoMember=(next)=>{client.csrfToken=next+'-'+crypto.randomUUID();setMember(next);};
 window.photoReads=()=>reads;
 return <HostedStorePhoto client={client} userId={member} tenantId=${JSON.stringify(tenantId)} instanceId=${JSON.stringify(instanceId)}
 product={{product_id:${JSON.stringify(productId)},title:'合成商品照片',version}} writable uploadsEnabled locked={false}
 onState={(dirty,blocking)=>{window.photoStates.push({member,dirty,blocking});}}
 onSaved={async()=>{reads++;if(failRead){failRead=false;throw new Error('synthetic read failed');}version=String(BigInt(version)+1n);setTick(tick+1);}}/>;
}
createRoot(document.getElementById('root')).render(<Screen/>);`);
    await esbuild.build({entryPoints:[entry],bundle:true,format:'iife',platform:'browser',outfile:bundle,jsx:'automatic',nodePaths:[fileURLToPath(new URL('../../node_modules',import.meta.url))],define:{'process.env.NODE_ENV':'"development"'}});
    const script=await readFile(bundle,'utf8');
    const requests:Array<{key:string;expected:string;bytes:string}>=[];
    let gate=Promise.resolve();
    browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{});
    const page=await browser.newPage();page.setDefaultTimeout(5_000);
    const path=`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/products/${productId}/photo`;
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/harness')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div><script src="/harness.js"></script></body></html>'});
      if(url.pathname==='/harness.js')return route.fulfill({contentType:'text/javascript',body:script});
      if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
      assert.equal(url.pathname,path);assert.equal(request.method(),'POST');
      const expected=request.headers()['if-match'];requests.push({key:request.headers()['idempotency-key'],expected,bytes:request.postDataBuffer()!.toString('base64')});
      const waiting=gate;await waiting;
      const completed=String(BigInt(JSON.parse(expected))+1n);
      await route.fulfill({contentType:'application/json',body:JSON.stringify({...ack,completed_version:completed,current:{...ack.current,version:completed}})});
    });
    await page.goto('http://127.0.0.1/harness');
    gate=new Promise(resolve=>{release=resolve;});
    await page.getByLabel('商品照片',{exact:true}).setInputFiles({name:'automatic.png',mimeType:'image/png',buffer:image});
    await page.waitForFunction(()=>document.body.innerText.includes('正在上傳並儲存商品照片'));
    assert.equal(await page.getByLabel('商品照片',{exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'儲存照片',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>((window as any).photoStates as Array<{blocking:boolean}>).at(-1)?.blocking),true);
    release!();release=undefined;gate=Promise.resolve();
    const refresh=page.getByRole('button',{name:'重新讀取已儲存照片',exact:true});await refresh.waitFor({state:'visible'});
    assert.equal(requests.length,1);assert.equal(requests[0].bytes,image.toString('base64'));
    assert.equal(await page.getByRole('button',{name:'重試原照片操作',exact:true}).count(),0);
    await refresh.click();await refresh.waitFor({state:'hidden'});
    assert.match(await page.getByRole('status').innerText(),/已儲存照片變更/);
    assert.equal(requests.length,1);assert.equal(await page.evaluate(()=>(window as any).photoReads()),2);
    assert.deepEqual(await page.evaluate(()=>(window as any).photoStates.at(-1)),{member:'member-a',dirty:false,blocking:false});

    gate=new Promise(resolve=>{release=resolve;});
    await page.getByLabel('商品照片',{exact:true}).setInputFiles({name:'old-member.png',mimeType:'image/png',buffer:image});
    await page.waitForFunction(()=>document.body.innerText.includes('正在上傳並儲存商品照片'));
    await page.evaluate(()=>(window as any).switchPhotoMember('member-b'));
    await page.waitForFunction(()=>!(document.body.innerText.includes('old-member.png')));
    const lateResponse=page.waitForResponse(response=>new URL(response.url()).pathname===path);
    release!();release=undefined;gate=Promise.resolve();
    await lateResponse;
    assert.equal(await page.evaluate(()=>(window as any).photoReads()),2);
    assert.equal(await page.getByRole('button',{name:'重試原照片操作',exact:true}).count(),0);
    await page.evaluate(()=>(window as any).switchPhotoMember('member-a'));
    const retry=page.getByRole('button',{name:'重試原照片操作',exact:true});await retry.waitFor({state:'visible'});
    assert.match(await page.locator('body').innerText(),/old-member.png/);assert.equal(requests.length,2);
    await retry.click();await retry.waitFor({state:'hidden'});
    // The retry button disappears on send, before its response or readback.
    await page.getByRole('status').filter({hasText:'已儲存照片變更'}).waitFor({state:'visible'});
    assert.equal(requests.length,3);assert.deepEqual(requests[2],requests[1]);
    assert.equal(await page.evaluate(()=>(window as any).photoReads()),3);
  }finally{release?.();try{await browser?.close();}finally{await rm(dir,{recursive:true,force:true});}}
});
test('PHOTO-STATE-01 unknown remains sticky across later known errors and refuses a new key/version',()=>{
  const unknown=retainedPhotoFailure(attempt,true),later=retainedPhotoFailure(unknown,false);
  assert.equal(later.hadUnknown,true);assert.equal(later.file,file);assert.equal(later.key,attempt.key);assert.equal(later.expected,'7');
  assert.throws(()=>reviewPhotoAttempt(later,'10','replacement-key'),/unknown/);
});
test('PHOTO-STATE-02 manual review alone replaces CAS/key while retaining the original File',()=>{
  const next=reviewPhotoAttempt(retainedPhotoFailure(attempt,false),'10','manual-review-key');
  assert.equal(next.file,file);assert.equal(next.expected,'10');assert.equal(next.key,'manual-review-key');assert.equal(attempt.expected,'7');
});
test('PHOTO-STATE-03 strict ACK binds original completion and allows a newer current state',()=>{
  assert.deepEqual(photoAcknowledgement(ack,attempt),ack);
  for(const wrong of [{...ack,completed_version:'10'},{...ack,changed:false},{...ack,asset_id:tenantId},{...ack,product_id:instanceId}])assert.equal(photoAcknowledgement(wrong,attempt),null);
  const photo={content_type:'image/webp',byte_size:12,width:1,height:1,read_path:`/api/v1/tenants/${instanceId}/storefronts/${instanceId}/products/${productId}/photo/10`};
  assert.equal(photoAcknowledgement({...ack,current:{...ack.current,photo}},attempt),null);
  assert.ok(photoAcknowledgement({...ack,completed_version:'7',changed:false},{...attempt,action:'remove',file:null}));
});

test('PHOTO-STATE-09 malformed completion or current versions are unconfirmed ACKs, not conversion exceptions', () => {
  assert.deepEqual(photoAcknowledgement(ack, attempt), ack);
  assert.equal(photoAcknowledgement({ ...ack, completed_version: 'abc' }, attempt), null);
  assert.equal(photoAcknowledgement({ ...ack, current: { ...ack.current, version: 'abc' } }, attempt), null);
});


test('PHOTO-STATE-04 pending original File survives same-client re-login but cannot cross member or product placement',()=>{
  const client={},otherClient={};holdPhotoAttempt(client,'member-a',attempt);
  const restored=restorePhotoAttempt(client,'member-a',attempt)!;
  assert.equal(restored.file,file);assert.equal(restored.key,attempt.key);assert.equal(restored.hadUnknown,true);
  assert.equal(heldPhotoAttempt(client,'member-b',attempt),null);assert.equal(heldPhotoAttempt(otherClient,'member-a',attempt),null);
  assert.equal(heldPhotoAttempt(client,'member-a',{...attempt,instanceId:tenantId}),null);
  releasePhotoAttempt(client,'member-a',{...attempt,key:'another-key'});assert.ok(heldPhotoAttempt(client,'member-a',attempt));
  releasePhotoAttempt(client,'member-a',attempt);assert.equal(heldPhotoAttempt(client,'member-a',attempt),null);
});


test('PHOTO-STATE-05 late refusal cannot erase remounted uncertainty, and late ACK cannot clear a newer tuple',()=>{
  const client={};holdPhotoAttempt(client,'member',attempt);
  assert.equal(heldPhotoAttempt(client,'member',attempt)?.hadUnknown,false);
  const remounted=restorePhotoAttempt(client,'member',attempt)!;
  assert.throws(()=>holdPhotoAttempt(client,'member',{...attempt,key:'new-key-before-confirmation'}),/unknown/);
  forgetRefusedPhotoAttempt(client,'member',attempt);assert.equal(heldPhotoAttempt(client,'member',attempt)?.hadUnknown,true);
  assert.equal(photoBlocksLeaving(remounted,false),true);assert.equal(photoBlocksLeaving(attempt,true),true);assert.equal(photoBlocksLeaving(attempt,false),false);
  releasePhotoAttempt(client,'member',attempt);assert.equal(heldPhotoAttempt(client,'member',attempt),null);
  const next={...attempt,key:'next-operation-key',expected:'10'};holdPhotoAttempt(client,'member',next);
  releasePhotoAttempt(client,'member',attempt);assert.equal(heldPhotoAttempt(client,'member',attempt)?.key,next.key);
  forgetRefusedPhotoAttempt(client,'member',next);assert.equal(heldPhotoAttempt(client,'member',attempt),null);
});

test('PHOTO-STATE-06 pending memory keeps the close warning after controls unmount and removes it only after completion',()=>{
  const target=new EventTarget(),prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:target});
  const client={};
  try{
    holdPhotoAttempt(client,'member',attempt);
    const during=new Event('beforeunload',{cancelable:true});target.dispatchEvent(during);assert.equal(during.defaultPrevented,true);
    restorePhotoAttempt(client,'member',attempt);
    const remounted=new Event('beforeunload',{cancelable:true});target.dispatchEvent(remounted);assert.equal(remounted.defaultPrevented,true);
    releasePhotoAttempt(client,'member',attempt);
    const complete=new Event('beforeunload',{cancelable:true});target.dispatchEvent(complete);assert.equal(complete.defaultPrevented,false);
  }finally{releasePhotoAttempt(client,'member',attempt);if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');}
});

test('distribution photo 403 and 404 clear the private projection; 503 and transport loss do not',()=>{
  assert.equal(distributionPhotoReadClearsPrivate(new ApiError({message:'denied',status:403})),true);
  assert.equal(distributionPhotoReadClearsPrivate(new ApiError({message:'missing',status:404})),true);
  assert.equal(distributionPhotoReadClearsPrivate(new ApiError({message:'busy',status:503})),false);
  assert.equal(distributionPhotoReadClearsPrivate(new ApiError({message:'down',status:500})),false);
  assert.equal(distributionPhotoReadClearsPrivate(new ApiError({message:'offline',status:0,network:true})),false);
  assert.equal(distributionPhotoReadClearsPrivate(new SyntaxError('Cannot convert abc to a BigInt')),false);
});

const choiceTenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const choiceInstance = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const choiceProduct = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const choiceUser = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const choiceTitle = '私有草稿選擇';

function choiceAbort(error: unknown, request: BrowserRequest): boolean {
  const failure = request.failure()?.errorText ?? '';
  if (failure === 'net::ERR_ABORTED') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_ABORTED|Request aborted/.test(message);
}

async function dialogClosed(page: Page, dialog: ReturnType<Page['getByRole']>, label: string) {
  try {
    await dialog.waitFor({state: 'hidden', timeout: 5_000});
  } catch (error) {
    const body = await page.locator('body').innerText();
    throw new Error(`${label}: choice dialog still open\n${body.slice(0, 600)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function privateTitleGone(page: Page, label: string) {
  try {
    await page.waitForFunction(value => !document.body.innerText.includes(value), choiceTitle, {timeout: 5_000});
  } catch (error) {
    const body = await page.locator('body').innerText();
    throw new Error(`${label}: private title still visible\n${body.slice(0, 600)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

test('DP-UI-01 distribution photo choice dialog: 503 keeps it, 403 and 404 clear it, and a late read after session generation change cannot restore the private title', {timeout: 60_000}, async () => {
  const hookModule = fileURLToPath(new URL('../../modules/agent-commerce/supplier-console/ui/partner/distribution-photos.tsx', import.meta.url));
  const apiModule = fileURLToPath(new URL('../../apps/portal-web/src/api.ts', import.meta.url));
  const bytes = await sharp({create: {width: 12, height: 8, channels: 3, background: '#234863'}}).webp().toBuffer();
  const readPath = `/api/v1/tenants/${choiceTenant}/storefronts/${choiceInstance}/distribution-photos/${choiceProduct}/photo/1`;
  const listPath = `/api/v1/tenants/${choiceTenant}/storefronts/${choiceInstance}/distribution-photos`;
  const list = DistributionPhotosSchema.parse({items: [{
    product_id: choiceProduct, sku: 'P1000', title: choiceTitle, version: '1', state: 'source_unavailable',
    photo: {content_type: 'image/webp', byte_size: bytes.length, width: 12, height: 8, read_path: readPath},
    source: null, latest: null,
  }]});
  const privateBody = JSON.stringify(list);
  const emptyBody = JSON.stringify(DistributionPhotosSchema.parse({items: []}));
  const denied = (status: 403 | 404) => JSON.stringify({type: 'about:blank', title: 'denied', status, code: 'forbidden', detail: '合成讀取被拒'});
  const diskTemp = join(homedir(), 'agent-work', 'tmp');
  await mkdir(diskTemp, {recursive: true, mode: 0o700});
  assert.ok(![0x01021994, 0x858458f6].includes((await statfs(diskTemp)).type), 'hook fixture requires disk');
  const dir = await mkdtemp(join(diskTemp, 'fp-photo-choice-'));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let releaseHold: (() => void) | undefined;
  try {
    const entry = `${dir}/harness.tsx`;
    const bundle = `${dir}/harness.js`;
    await writeFile(entry, `import {createElement, useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {PortalClient} from ${JSON.stringify(apiModule)};
  import {useDistributionPhotos} from ${JSON.stringify(hookModule)};
  const client = new PortalClient();
  client.csrfToken = 'session-a';
  const material = {
    material_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', kind: 'image', supplier_name: '合成供應商',
    subject: {kind: 'brand'}, applies_to: [${JSON.stringify(choiceProduct)}], title: '合成公開素材', description: '', access: 'public_use',
    current: {version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', version_no: 1, created_at: '2026-10-16T12:00:00.000Z', content: {kind: 'image', content_type: 'image/webp', byte_size: ${bytes.length}, width: 12, height: 8}},
  };
  function Screen() {
    const [tick, setTick] = useState(0);
    const api = useDistributionPhotos({client, userId: ${JSON.stringify(choiceUser)}, tenantId: ${JSON.stringify(choiceTenant)}, instanceId: ${JSON.stringify(choiceInstance)}, active: true, refresh: 0, enabled: true, writable: true, busy: false, onCommand: async () => {}});
    (window as unknown as {__reload: () => Promise<void>; __bumpSession: () => void}).__reload = () => api.reload();
    (window as unknown as {__bumpSession: () => void}).__bumpSession = () => { client.csrfToken = 'session-b'; setTick(value => value + 1); };
    return createElement('div', {'data-tick': String(tick)}, api.above, api.renderMaterial(material as never));
  }
  createRoot(document.getElementById('root')!).render(createElement(Screen));
  `);
    await esbuild.build({
      entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', outfile: bundle, jsx: 'automatic',
      nodePaths: [fileURLToPath(new URL('../../node_modules', import.meta.url))],
      define: {'process.env.NODE_ENV': '"development"'},
      banner: {js: 'var process = globalThis.process || {env: {NODE_ENV: "development"}};'},
    });
    const script = await readFile(bundle, 'utf8');
    type Settlement = {kind: 'response'; status: number} | {kind: 'aborted'; error: string};
    let mode: 'private' | 'empty' | '503' | '403' | '404' | 'hold' = 'private';
    let waitHold = Promise.resolve();
    let resolveHeld: (() => void) | undefined;
    let heldSeen = Promise.resolve();
    const unexpected: string[] = [];
    const lateSettlements: Array<Promise<Settlement>> = [];
    browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath: process.env.CHROMIUM_EXECUTABLE_PATH} : {});
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(15_000);
    await page.route('**/*', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/harness') return route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div><script src="/harness.js"></script></body></html>'});
      if (path === '/harness.js') return route.fulfill({contentType: 'text/javascript', body: script});
      if (path === '/favicon.ico') return route.fulfill({status: 204, body: ''});
      if (path === '/api/v1/me/client-errors') return route.fulfill({status: 204, body: ''});
      if (path === readPath && request.method() === 'GET') return route.fulfill({status: 200, contentType: 'image/webp', body: bytes});
      if (path === listPath && request.method() === 'GET') {
        if (mode === 'hold') {
          const gate = waitHold;
          const settlement = new Promise<Settlement>(resolve => {
            const clean = () => { page.off('requestfinished', finished); page.off('requestfailed', failed); };
            const finished = async (seen: BrowserRequest) => {
              if (seen !== request) return;
              clean();
              resolve({kind: 'response', status: (await request.response())!.status()});
            };
            const failed = (seen: BrowserRequest) => {
              if (seen !== request) return;
              clean();
              resolve({kind: 'aborted', error: request.failure()!.errorText});
            };
            page.on('requestfinished', finished); page.on('requestfailed', failed);
          });
          lateSettlements.push(settlement);
          resolveHeld?.();
          try {
            await gate;
            await route.fulfill({status: 200, contentType: 'application/json', body: privateBody});
          } catch (error) {
            if (choiceAbort(error, request)) {
              return;
            }
            throw error;
          }
          return;
        }
        if (mode === '503') return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({type: 'about:blank', title: 'unavailable', status: 503, code: 'unavailable', detail: '合成暫時失敗'})});
        if (mode === '403' || mode === '404') return route.fulfill({status: Number(mode), contentType: 'application/json', body: denied(Number(mode) as 403 | 404)});
        if (mode === 'empty') return route.fulfill({status: 200, contentType: 'application/json', body: emptyBody});
        return route.fulfill({status: 200, contentType: 'application/json', body: privateBody});
      }
      unexpected.push(`${request.method()} ${path}`);
      return route.fulfill({status: 404, body: 'unexpected'});
    });
    await page.goto('http://127.0.0.1/harness');
    await page.getByText(choiceTitle).first().waitFor({state: 'visible'});
    await page.waitForFunction(() => {
      const image = document.querySelector('img.distribution-photo-thumb') as HTMLImageElement | null;
      return image !== null && image.naturalWidth === 12;
    });
    await page.getByRole('button', {name: '改用這個素材', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '把這張素材用在公開店面？', exact: true});
    await dialog.waitFor({state: 'visible'});
    assert.match(await dialog.innerText(), new RegExp(choiceTitle));
    assert.equal(await dialog.evaluate(element => (element as HTMLDialogElement).open), true);
    assert.equal(await page.getByRole('button', {name: '取消', exact: true}).evaluate(element => element === document.activeElement), true);
    mode = '503';
    await page.evaluate(() => (window as unknown as {__reload: () => Promise<void>}).__reload());
    await dialog.waitFor({state: 'visible'});
    assert.match(await dialog.innerText(), new RegExp(choiceTitle));
    await page.getByRole('alert').waitFor({state: 'visible'});
    assert.match(await page.getByRole('alert').innerText(), /目前無法讀取店面照片/);
    await page.waitForFunction(() => (document.querySelector('img.distribution-photo-thumb') as HTMLImageElement | null)?.naturalWidth === 12);
    mode = '403';
    await page.evaluate(() => (window as unknown as {__reload: () => Promise<void>}).__reload());
    await dialogClosed(page, dialog, '403');
    await privateTitleGone(page, '403');
    assert.equal(await page.locator('img.distribution-photo-thumb').count(), 0);
    assert.equal(await page.getByRole('button', {name: '停止使用', exact: true}).count(), 0);
    assert.equal(await page.getByRole('button', {name: '改用這個素材', exact: true}).count(), 0);
    mode = 'private';
    await page.evaluate(() => (window as unknown as {__reload: () => Promise<void>}).__reload());
    await page.getByText(choiceTitle).first().waitFor({state: 'visible'});
    await page.getByRole('button', {name: '改用這個素材', exact: true}).click();
    await dialog.waitFor({state: 'visible'});
    mode = '404';
    await page.evaluate(() => (window as unknown as {__reload: () => Promise<void>}).__reload());
    await dialogClosed(page, dialog, '404');
    await privateTitleGone(page, '404');
    mode = 'private';
    await page.evaluate(() => (window as unknown as {__reload: () => Promise<void>}).__reload());
    await page.getByText(choiceTitle).first().waitFor({state: 'visible'});
    mode = 'hold';
    heldSeen = new Promise(resolve => { resolveHeld = resolve; });
    waitHold = new Promise(resolve => { releaseHold = resolve; });
    const lateReload = page.evaluate(() => (window as unknown as {__reload: () => Promise<void>}).__reload());
    await heldSeen;
    mode = 'empty';
    await page.evaluate(() => (window as unknown as {__bumpSession: () => void}).__bumpSession());
    await privateTitleGone(page, 'session generation');
    releaseHold?.();
    releaseHold = undefined;
    await lateReload;
    const outcomes = await Promise.all(lateSettlements);
    assert.equal(outcomes.length, 1);
    for (const outcome of outcomes) {
      if (outcome.kind === 'response') assert.equal(outcome.status, 200);
      else assert.equal(outcome.error, 'net::ERR_ABORTED');
    }
    console.log(`HOOK-late ${JSON.stringify(outcomes)}`);
    await privateTitleGone(page, 'settled old private read');
    assert.deepEqual(unexpected, []);
  } finally {
    releaseHold?.();
    try { await browser?.close(); } finally { await rm(dir, {recursive: true, force: true}); }
  }
});

// Transport-only regressions: the timer bounds waiting, not server execution.
// They use controlled fetch/body promises and never launch a browser or replay automatically.
import {sendGalleryPhoto} from '../../apps/portal-web/src/modules/hosted-store-photo-client.js';
import type {GalleryPhotoAttempt} from '../../apps/portal-web/src/modules/hosted-store-photo-state.js';
import {STOREFRONT_GALLERY_PROFILE} from '../../contracts/guild-launchpad/v1/storefront-gallery.js';
const photoDeadlineTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deadlinePhotoAttempt=():PhotoAttempt=>Object.freeze({...attempt,file:new File(['synthetic original bytes'],'same-original.png',{type:'image/png'})});
function deadlineGalleryAttempt(action:GalleryPhotoAttempt['action']):GalleryPhotoAttempt {
 return Object.freeze({...deadlinePhotoAttempt(),gallery:true,action,photoKey:action==='reorder'?null:'main',file:action==='upload'?deadlinePhotoAttempt().file:null,body:action==='reorder'?'{"photo_keys":["main"]}':action==='describe'?'{"alt_text":"synthetic"}':'{}'});
}
function observePhotoRequest(request:Promise<unknown>){
 const outcome:{state:'pending'|'fulfilled'|'rejected';value?:unknown}={state:'pending'};
 void request.then(value=>{outcome.state='fulfilled';outcome.value=value;},error=>{outcome.state='rejected';outcome.value=error;});
 return outcome;
}
function assertPhotoTimeout(outcome:ReturnType<typeof observePhotoRequest>){
 assert.equal(outcome.state,'rejected','a stalled transport/body must stop holding the caller');
 assert.ok(outcome.value instanceof ApiError&&outcome.value.network&&outcome.value.timedOut,'timeout remains an unknown write outcome');
}
for(const operation of ['product-upload','product-remove','gallery-upload','gallery-remove','gallery-reorder','gallery-describe'] as const){
 test(`PHOTO-DEADLINE ${operation} bounds an abort-ignoring fetch without replay`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';
  let signal:AbortSignal|null|undefined;let calls=0;
  t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init:RequestInit)=>{calls++;signal=init.signal;return new Promise<Response>(()=>{});});
  const request=operation.startsWith('gallery-')?sendGalleryPhoto(client,deadlineGalleryAttempt(operation.slice(8) as GalleryPhotoAttempt['action'])):sendProductPhoto(client,operation==='product-remove'?{...deadlinePhotoAttempt(),action:'remove',file:null}:deadlinePhotoAttempt());
  const outcome=observePhotoRequest(request);
  t.mock.timers.tick(59_999);await photoDeadlineTurn();assert.equal(outcome.state,'pending');assert.equal(calls,1);
  t.mock.timers.tick(1);await photoDeadlineTurn();assertPhotoTimeout(outcome);assert.equal(signal?.aborted,true);assert.equal(calls,1);
  t.mock.timers.tick(120_000);await photoDeadlineTurn();assert.equal(calls,1,'timeout never automatically repeats a write');
 });
}
for(const gallery of [false,true])test(`PHOTO-DEADLINE ${gallery?'gallery':'product'} bounds a stalled JSON body`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';
 let reading=false;let signal:AbortSignal|null|undefined;
 const response=Response.json(ack);t.mock.method(response,'json',()=>{reading=true;return new Promise(()=>{});});
 t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init:RequestInit)=>{signal=init.signal;return response;});
 const outcome=observePhotoRequest(gallery?sendGalleryPhoto(client,deadlineGalleryAttempt('upload')):sendProductPhoto(client,deadlinePhotoAttempt()));
 await photoDeadlineTurn();assert.equal(reading,true);t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);assert.equal(signal?.aborted,true);
});
test('PHOTO-DEADLINE a stalled Access classification is bounded and cannot expire the session later',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';
 let finish!:(text:string)=>void,reading=false,notified=0;client.onUnauthorized=()=>{notified++;};
 const response=new Response('Access expired',{status:403}),clone=response.clone();
 t.mock.method(clone,'text',()=>{reading=true;return new Promise<string>(resolve=>{finish=resolve;});});t.mock.method(response,'clone',()=>clone);
 t.mock.method(globalThis,'fetch',async()=>response);const outcome=observePhotoRequest(sendProductPhoto(client,deadlinePhotoAttempt()));
 await photoDeadlineTurn();assert.equal(reading,true);t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);
 finish('Access expired');await photoDeadlineTurn();assert.equal(client.csrfToken,'synthetic-session');assert.equal(client.accessExpired,false);assert.equal(notified,0);assertPhotoTimeout(outcome);
});
for(const late of ['json-401','access-403','healthy-ack'] as const)test(`PHOTO-DEADLINE late ${late} cannot alter auth or turn a timeout into success`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';client.accessExpired=true;
 let finish!:(value:Response)=>void,notified=0;client.onUnauthorized=()=>{notified++;};
 t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const outcome=observePhotoRequest(sendProductPhoto(client,deadlinePhotoAttempt()));t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);
 finish(late==='json-401'?Response.json({code:'session_expired'},{status:401}):late==='access-403'?new Response('Access expired',{status:403}):Response.json(ack));
 await photoDeadlineTurn();assertPhotoTimeout(outcome);assert.equal(client.csrfToken,'synthetic-session');assert.equal(client.accessExpired,true);assert.equal(notified,0);
});
test('PHOTO-DEADLINE late JSON completion does not acknowledge or release the retained original',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';const a=deadlinePhotoAttempt();
 let finish!:(value:unknown)=>void;const response=Response.json(ack);t.mock.method(response,'json',()=>new Promise(resolve=>{finish=resolve;}));t.mock.method(globalThis,'fetch',async()=>response);
 holdPhotoAttempt(client,'deadline-member',a);t.after(()=>releasePhotoAttempt(client,'deadline-member',a));
 const outcome=observePhotoRequest(sendProductPhoto(client,a));await photoDeadlineTurn();t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);
 holdPhotoAttempt(client,'deadline-member',retainedPhotoFailure(a,true));finish(ack);await photoDeadlineTurn();assertPhotoTimeout(outcome);
 const retained=heldPhotoAttempt(client,'deadline-member',a)!;assert.equal(retained.file,a.file);assert.equal(retained.key,a.key);assert.equal(retained.expected,a.expected);assert.equal(retained.hadUnknown,true);assert.equal(photoBlocksLeaving(retained,false),true);
});
test('PHOTO-DEADLINE only an explicit retry resends the exact original file, key and version',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';const a=deadlinePhotoAttempt();
 const sends:Array<{url:string;method:string|undefined;body:unknown;key:string|null;version:string|null}>=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init:RequestInit)=>{const headers=new Headers(init.headers);sends.push({url:String(input),method:init.method,body:init.body,key:headers.get('Idempotency-Key'),version:headers.get('If-Match')});return sends.length===1?new Promise<Response>(()=>{}):Response.json(ack);});
 holdPhotoAttempt(client,'deadline-member',a);t.after(()=>releasePhotoAttempt(client,'deadline-member',a));
 const outcome=observePhotoRequest(sendProductPhoto(client,a));t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);assert.equal(sends.length,1);
 const retained=retainedPhotoFailure(a,true);holdPhotoAttempt(client,'deadline-member',retained);assert.throws(()=>reviewPhotoAttempt(retained,'8','new-key'),/unknown/);
 assert.deepEqual(await sendProductPhoto(client,retained),ack);assert.equal(sends.length,2);assert.deepEqual(sends[1],sends[0]);assert.equal(sends[1].body,a.file);releasePhotoAttempt(client,'deadline-member',retained);assert.equal(heldPhotoAttempt(client,'deadline-member',a),null);
});
test('PHOTO-DEADLINE timely success clears the timer and keeps strict ACK validation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';const signals:AbortSignal[]=[];
 const fetch=t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init:RequestInit)=>{signals.push(init.signal!);return Response.json(ack);});
 assert.deepEqual(await sendProductPhoto(client,deadlinePhotoAttempt()),ack);
 fetch.mock.mockImplementation(async(_input:RequestInfo|URL,init:RequestInit)=>{signals.push(init.signal!);return Response.json({...ack,product_id:instanceId});});
 await assert.rejects(sendProductPhoto(client,deadlinePhotoAttempt()),(e:unknown)=>e instanceof ApiError&&e.network&&!e.timedOut);
 t.mock.timers.tick(60_000);assert.equal(signals.length,2);for(const signal of signals)assert.equal(signal.aborted,false);
});
test('PHOTO-DEADLINE timely refusal and transport failure clear their timers without weakening classification',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';const signals:AbortSignal[]=[];
 const fetch=t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init:RequestInit)=>{signals.push(init.signal!);return Response.json({code:'version_conflict',detail:'商品已更新'},{status:412});});
 await assert.rejects(sendProductPhoto(client,deadlinePhotoAttempt()),(e:unknown)=>e instanceof ApiError&&e.status===412&&!e.network&&!e.timedOut);
 fetch.mock.mockImplementation(async(_input:RequestInfo|URL,init:RequestInit)=>{signals.push(init.signal!);throw new Error('synthetic transport loss');});
 await assert.rejects(sendProductPhoto(client,deadlinePhotoAttempt()),(e:unknown)=>e instanceof ApiError&&e.network&&!e.timedOut);
 t.mock.timers.tick(60_000);for(const signal of signals)assert.equal(signal.aborted,false);
});
test('PHOTO-DEADLINE a delayed Access response from an ABA session never invalidates the current login',async t=>{
 const client=new PortalClient();client.csrfToken='synthetic-a';let finish!:(text:string)=>void,notified=0;client.onUnauthorized=()=>{notified++;};
 const response=new Response('expired',{status:403}),clone=response.clone();t.mock.method(clone,'text',()=>new Promise<string>(resolve=>{finish=resolve;}));t.mock.method(response,'clone',()=>clone);
 t.mock.method(globalThis,'fetch',async()=>response);const request=sendProductPhoto(client,deadlinePhotoAttempt());await photoDeadlineTurn();client.csrfToken='synthetic-b';client.csrfToken='synthetic-a';finish('expired');
 await assert.rejects(request,(e:unknown)=>e instanceof ApiError&&e.network&&!e.timedOut);assert.equal(client.csrfToken,'synthetic-a');assert.equal(client.accessExpired,false);assert.equal(notified,0);
});
test('PHOTO-DEADLINE gallery timely ACK remains bound to operation, target and completion version',async t=>{
 const client=new PortalClient();client.csrfToken='synthetic-session';const a=deadlineGalleryAttempt('remove');
 const receipt={profile:STOREFRONT_GALLERY_PROFILE,product_id:productId,operation:'remove',photo_key:'main',completed_version:'8',changed:true,current:{profile:STOREFRONT_GALLERY_PROFILE,product_id:productId,version:'8',photos:[],retained_secondary_photos:[],media_installed:true,uploads_enabled:true}};
 const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(receipt));assert.deepEqual(await sendGalleryPhoto(client,a),receipt);
 for(const changed of [{operation:'describe'},{product_id:instanceId},{completed_version:'7'}]){fetch.mock.mockImplementation(async()=>Response.json({...receipt,...changed}));await assert.rejects(sendGalleryPhoto(client,a),(e:unknown)=>e instanceof ApiError&&e.network);}
});
test('PHOTO-DEADLINE timely Access expiry still notifies the current session',async t=>{
 const client=new PortalClient();client.csrfToken='synthetic-session';let notified=0;client.onUnauthorized=()=>{notified++;assert.equal(client.csrfToken,null);assert.equal(client.accessExpired,true);};
 t.mock.method(globalThis,'fetch',async()=>new Response('Access expired',{status:403}));
 await assert.rejects(sendProductPhoto(client,deadlinePhotoAttempt()),(e:unknown)=>e instanceof ApiError&&e.accessExpired&&e.status===403&&!e.timedOut);assert.equal(notified,1);
});
test('PHOTO-DEADLINE a missing member token sends no photo request',async t=>{
 const client=new PortalClient();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not fetch');});
 await assert.rejects(sendProductPhoto(client,deadlinePhotoAttempt()),(e:unknown)=>e instanceof ApiError&&e.accessExpired&&e.status===401);assert.equal(calls,0);
});
test('PHOTO-DEADLINE an abort-aware fetch cannot replace the timeout classification',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';
 t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init.signal!.addEventListener('abort',()=>reject(new Error('transport aborted')),{once:true});}));
 const outcome=observePhotoRequest(sendProductPhoto(client,deadlinePhotoAttempt()));t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);
});
for(const action of ['describe','reorder'] as const)test(`PHOTO-DEADLINE explicit gallery ${action} retry preserves its original JSON tuple`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const client=new PortalClient();client.csrfToken='synthetic-session';const a=deadlineGalleryAttempt(action);
 const receipt={profile:STOREFRONT_GALLERY_PROFILE,product_id:productId,operation:action,photo_key:a.photoKey,completed_version:'8',changed:true,current:{profile:STOREFRONT_GALLERY_PROFILE,product_id:productId,version:'10',photos:[],retained_secondary_photos:[],media_installed:true,uploads_enabled:true}};
 const sends:Array<{url:string;method:string|undefined;body:unknown;key:string|null;version:string|null}>=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init:RequestInit)=>{const headers=new Headers(init.headers);sends.push({url:String(input),method:init.method,body:init.body,key:headers.get('Idempotency-Key'),version:headers.get('If-Match')});return sends.length===1?new Promise<Response>(()=>{}):Response.json(receipt);});
 holdPhotoAttempt(client,'deadline-gallery-member',a);t.after(()=>releasePhotoAttempt(client,'deadline-gallery-member',a));
 const outcome=observePhotoRequest(sendGalleryPhoto(client,a));t.mock.timers.tick(60_000);await photoDeadlineTurn();assertPhotoTimeout(outcome);assert.equal(sends.length,1);
 const retained=retainedPhotoFailure(a,true);holdPhotoAttempt(client,'deadline-gallery-member',retained);assert.throws(()=>holdPhotoAttempt(client,'deadline-gallery-member',{...retained,body:'{}'}),/unknown/);
 assert.deepEqual(await sendGalleryPhoto(client,retained),receipt);assert.deepEqual(sends[1],sends[0]);assert.equal(sends.length,2);assert.equal(sends[1].body,a.body);assert.equal(sends[1].method,action==='describe'?'PATCH':'POST');releasePhotoAttempt(client,'deadline-gallery-member',retained);
});
