import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import {transformSync as transformPlace} from 'esbuild';
import {runInNewContext as runPlace} from 'node:vm';
import {readFileSync as readPlace} from 'node:fs';
const placeUrl=new URL('../../apps/portal-web/src/features/PlaceView.tsx',import.meta.url);
const placeRequire=createRequire(placeUrl),placeModule={exports:{} as any};
runPlace(transformPlace(readPlace(placeUrl,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{
 module:placeModule,exports:placeModule.exports,require:(id:string)=>id==='../frame-tools/RegisteredTools'?{RegisteredTools:()=>null}:placeRequire(id),
});
const PlaceView=placeModule.exports.PlaceView;
import type {PortalFeatureContext} from '../../apps/portal-web/src/features/types.js';
import {Navigation} from '../../apps/portal-web/src/Navigation.js';
import {MEMBER_ACCESS_EXPIRED_MESSAGE} from '../../apps/portal-web/src/access-fetch.js';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {ADMIN_ACCESS_EXPIRED_MESSAGE,AdminClient,AdminRequestError} from '../../apps/portal-web/src/modules/admin-client.js';
import {uploadMemberAvatar} from '../../apps/portal-web/src/modules/avatar-client.js';

const NETWORK_MESSAGE='目前無法連線。操作不會自動重送，請重新載入確認結果。';

test('admission errors retain server detail and code through the shared panel mutation client',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({code:'store_admission_exists',detail:'這間商店已有有效的准入紀錄。'},{status:409}));
 const client=new AdminClient();client.csrf='synthetic';
 await assert.rejects(client.request('/commerce/store-admissions',{}, {key:'same-attempt'}),(cause:unknown)=>cause instanceof AdminRequestError&&cause.status===409&&cause.message==='這間商店已有有效的准入紀錄。（store_admission_exists）');
 assert.equal(client.csrf,'synthetic');
});

function opaqueRedirect():Response{
  return {type:'opaqueredirect',status:0,ok:false,headers:new Headers(),clone(){return opaqueRedirect();},text:async()=>'',json:async()=>{throw new SyntaxError('no body');}} as unknown as Response;
}
function header(init:RequestInit|undefined,name:string){return new Headers(init?.headers).get(name);}
function assertManualXhr(init?:RequestInit){
  assert.equal(init?.redirect,'manual');
  assert.equal(header(init,'X-Requested-With'),'XMLHttpRequest');
  assert.equal(init?.credentials,'same-origin');
}

test('admin client treats an opaque redirect as an expired administrator session',async t=>{
  let init:RequestInit|undefined;
  const fetcher=t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{init=options;assert.equal(input,'/admin/api/bootstrap');return opaqueRedirect();});
  const client=new AdminClient();client.csrf='keep';let expired=0;client.onAccessExpired=()=>{expired++;};
  await assert.rejects(client.request('/bootstrap'),(cause:unknown)=>{
    assert.ok(cause instanceof AdminRequestError);assert.equal(cause.accessExpired,true);assert.equal(cause.status,0);assert.equal(cause.message,ADMIN_ACCESS_EXPIRED_MESSAGE);assert.doesNotMatch(cause.message,/管理入口沒有回傳完整資料|目前無法連線/);return true;
  });
  assertManualXhr(init);assert.equal(init?.cache,'no-store');assert.equal(header(init,'Accept'),'application/json');
  assert.equal(client.csrf,'keep','an opaque redirect is not a 401 or 403');assert.equal(expired,1);assert.equal(fetcher.mock.callCount(),1);
});

test('admin client treats an HTML 401 or 403 as an expired administrator session and still clears the local CSRF token',async t=>{
  for(const status of [401,403]){
    let init:RequestInit|undefined;
    const fetcher=t.mock.method(globalThis,'fetch',async(_input:unknown,options?:RequestInit)=>{init=options;return new Response('<html>cloudflare access</html>',{status,headers:{'content-type':'text/html'}});});
    const client=new AdminClient();client.csrf='keep';
    await assert.rejects(client.request('/bootstrap'),(cause:unknown)=>{
      assert.ok(cause instanceof AdminRequestError);assert.equal(cause.accessExpired,true);assert.equal(cause.status,status);assert.equal(cause.message,ADMIN_ACCESS_EXPIRED_MESSAGE);assert.doesNotMatch(cause.message,/管理入口沒有回傳完整資料/);return true;
    });
    assertManualXhr(init);assert.equal(client.csrf,null);fetcher.mock.restore();
  }
});

test('admin client keeps a JSON 401 detail and still clears the local CSRF token',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({detail:'請先通過管理員信箱驗證。'},{status:401}));
  const client=new AdminClient();client.csrf='keep';let expired=0;client.onAccessExpired=()=>{expired++;};
  await assert.rejects(client.request('/bootstrap'),(cause:unknown)=>{
    assert.ok(cause instanceof AdminRequestError);assert.equal(cause.accessExpired,false);assert.equal(cause.status,401);assert.equal(cause.message,'請先通過管理員信箱驗證。');return true;
  });
  assert.equal(client.csrf,null);assert.equal(expired,0);
});

test('admin client keeps a JSON 500 detail',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({detail:'服務暫時無法完成這項操作。'},{status:500}));
  const client=new AdminClient();client.csrf='keep';
  await assert.rejects(client.request('/bootstrap'),(cause:unknown)=>{
    assert.ok(cause instanceof AdminRequestError);assert.equal(cause.accessExpired,false);assert.equal(cause.status,500);assert.equal(cause.message,'服務暫時無法完成這項操作。');return true;
  });
  assert.equal(client.csrf,'keep');
});

test('admin client keeps the network message when fetch itself throws',async t=>{
  const fetcher=t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});
  const client=new AdminClient();
  await assert.rejects(client.request('/bootstrap'),(cause:unknown)=>{
    assert.ok(cause instanceof AdminRequestError);assert.equal(cause.accessExpired,false);assert.equal(cause.status,0);assert.equal(cause.message,NETWORK_MESSAGE);return true;
  });
  assert.equal(fetcher.mock.callCount(),1);
});

test('admin client sends a manual XHR GET and returns the JSON body',async t=>{
  let init:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{init=options;assert.equal(input,'/admin/api/bootstrap');assert.equal(options?.method,'GET');return Response.json({ok:true});});
  const client=new AdminClient();client.csrf='keep';
  assert.deepEqual(await client.request('/bootstrap'),{ok:true});
  assertManualXhr(init);assert.equal(init?.cache,'no-store');assert.equal(init?.body,undefined);
  assert.equal(header(init,'Accept'),'application/json');assert.equal(header(init,'Content-Type'),null);assert.equal(header(init,'X-Admin-CSRF'),null);assert.equal(header(init,'Idempotency-Key'),null);assert.equal(header(init,'If-Match'),null);
  assert.equal(client.csrf,'keep');
});

test('admin client sends CSRF and the idempotency key on a successful POST',async t=>{
  let init:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{init=options;assert.equal(input,'/admin/api/members/1/status');assert.equal(options?.method,'POST');return Response.json({saved:true});});
  const client=new AdminClient();client.csrf='csrf-token';
  assert.deepEqual(await client.request('/members/1/status',{active:false,reason:'測試'},{key:'idem-1',version:7}),{saved:true});
  assertManualXhr(init);assert.equal(init?.cache,'no-store');
  assert.equal(header(init,'X-Admin-CSRF'),'csrf-token');assert.equal(header(init,'Idempotency-Key'),'idem-1');assert.equal(header(init,'If-Match'),'"7"');
  assert.equal(header(init,'Content-Type'),'application/json');assert.equal(header(init,'Accept'),'application/json');
  assert.deepEqual(JSON.parse(String(init?.body)),{active:false,reason:'測試'});
});

test('an older admin success does not clear a newer expired session',async t=>{
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;if(calls===1){await gate;return Response.json({ok:true});}return new Response('<html>cloudflare access</html>',{status:401,headers:{'content-type':'text/html'}});});
  const client=new AdminClient();client.csrf='keep';let expired=0,recovered=0;
  client.onAccessExpired=()=>{expired++;};client.onAccessRecovered=()=>{recovered++;};
  const older=client.request('/bootstrap');
  await assert.rejects(client.request('/members'),(cause:unknown)=>{assert.ok(cause instanceof AdminRequestError);assert.equal(cause.accessExpired,true);assert.equal(cause.message,ADMIN_ACCESS_EXPIRED_MESSAGE);return true;});
  assert.equal(expired,1);assert.equal(client.csrf,null);
  release();
  assert.deepEqual(await older,{ok:true});
  assert.equal(recovered,0);assert.equal(expired,1);
});

for (const accessExpired of [false, true]) {
  test(`an old admin ${accessExpired ? 'Access denial' : '401'} preserves a refreshed session`, async t => {
    let respond!: (response: Response) => void;
    t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { respond = resolve; }));
    const client = new AdminClient(); client.csrf = 'old-session';
    let expired = 0; client.onAccessExpired = () => { expired++; };
    const pending = client.request('/members');
    client.csrf = 'new-session';
    respond(accessExpired ? new Response('<html>Expired Access</html>', { status: 403 }) : Response.json({ detail: 'Expired session' }, { status: 401 }));
    await assert.rejects(pending, AdminRequestError);
    assert.equal(client.csrf, 'new-session');
    assert.equal(expired, 0);
  });
}

test('portal client treats an opaque redirect as an expired site session instead of a network failure',async t=>{
  let init:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(_input:unknown,options?:RequestInit)=>{init=options;return opaqueRedirect();});
  const client=new PortalClient();client.csrfToken='keep';let unauthorized=0;client.onUnauthorized=()=>{unauthorized++;};
  await assert.rejects(client.get('/members'),(cause:unknown)=>{
    assert.ok(cause instanceof ApiError);assert.equal(cause.accessExpired,true);assert.equal(cause.network,false);assert.equal(cause.unauthorized,false);assert.equal(cause.status,0);assert.equal(cause.message,MEMBER_ACCESS_EXPIRED_MESSAGE);assert.doesNotMatch(cause.message,/無法連線到伺服器/);return true;
  });
  assertManualXhr(init);assert.equal(client.csrfToken,'keep');assert.equal(unauthorized,1,'the shell is notified so every screen can offer a full reload');assert.equal(client.accessExpired,true);
});

test('portal client treats an HTML 401 or 403 as an expired site session',async t=>{
  for(const status of [401,403]){
    let init:RequestInit|undefined;
    const fetcher=t.mock.method(globalThis,'fetch',async(_input:unknown,options?:RequestInit)=>{init=options;return new Response('<html>expired session</html>',{status,headers:{'content-type':'text/html'}});});
    const client=new PortalClient();client.csrfToken='synthetic';let unauthorized=0;client.onUnauthorized=()=>{unauthorized++;};
    await assert.rejects(client.get('/session'),(cause:unknown)=>{
      assert.ok(cause instanceof ApiError);assert.equal(cause.accessExpired,true);assert.equal(cause.unauthorized,status===401);assert.equal(cause.status,status);assert.equal(cause.network,false);assert.equal(cause.message,MEMBER_ACCESS_EXPIRED_MESSAGE);return true;
    });
    assertManualXhr(init);assert.equal(client.csrfToken,null);assert.equal(unauthorized,1);fetcher.mock.restore();
  }
});

test('portal client keeps a JSON 401 detail and still invokes the member session handler',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({detail:'帳號或密碼不正確。'},{status:401}));
  const client=new PortalClient();client.csrfToken='synthetic';let unauthorized=0;client.onUnauthorized=()=>{unauthorized++;};
  await assert.rejects(client.post('/auth/login',{email:'a@example.test',password:'secret'},{skipAuthHandler:true}),(cause:unknown)=>{
    assert.ok(cause instanceof ApiError);assert.equal(cause.accessExpired,false);assert.equal(cause.message,'帳號或密碼不正確。');assert.equal(cause.unauthorized,true);return true;
  });
  assert.equal(unauthorized,0,'login does not treat an application 401 as a dropped session');assert.equal(client.csrfToken,'synthetic');
  await assert.rejects(client.get('/members'),(cause:unknown)=>{assert.ok(cause instanceof ApiError);assert.equal(cause.accessExpired,false);assert.equal(cause.message,'帳號或密碼不正確。');return true;});
  assert.equal(client.csrfToken,null);assert.equal(unauthorized,1);
});

test('avatar upload treats an HTML 401 as an expired site session and keeps the save headers',async t=>{
  let init:RequestInit|undefined;
  const fetcher=t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{init=options;assert.equal(input,'/api/v1/me/avatar');return new Response('<html>cloudflare access</html>',{status:401,headers:{'content-type':'text/html'}});});
  const client=new PortalClient();client.csrfToken='avatar-csrf';let unauthorized=0;client.onUnauthorized=()=>{unauthorized++;};
  const file=new File([new Uint8Array([1,2,3])],'portrait.png',{type:'image/png'});
  await assert.rejects(uploadMemberAvatar(client,file,4,'avatar-key'),(cause:unknown)=>{
    assert.ok(cause instanceof ApiError);assert.equal(cause.accessExpired,true);assert.equal(cause.network,false);assert.equal(cause.status,401);assert.equal(cause.message,MEMBER_ACCESS_EXPIRED_MESSAGE);assert.doesNotMatch(cause.message,/回應未完整收到|連線中斷/);return true;
  });
  assertManualXhr(init);assert.equal(init?.method,'POST');assert.equal(init?.body,file);
  assert.equal(header(init,'X-CSRF-Token'),'avatar-csrf');assert.equal(header(init,'Idempotency-Key'),'avatar-key');assert.equal(header(init,'If-Match'),'"4"');assert.equal(header(init,'Content-Type'),'image/png');
  assert.equal(client.csrfToken,null);assert.equal(unauthorized,1);assert.equal(fetcher.mock.callCount(),1);
});

test('avatar upload treats an opaque redirect as an expired site session and keeps the save headers',async t=>{
  let init:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{init=options;assert.equal(input,'/api/v1/me/avatar');return opaqueRedirect();});
  const client=new PortalClient();client.csrfToken='avatar-csrf';let unauthorized=0;client.onUnauthorized=()=>{unauthorized++;};
  const file=new File([new Uint8Array([1,2,3])],'portrait.png',{type:'image/png'});
  await assert.rejects(uploadMemberAvatar(client,file,4,'avatar-key'),(cause:unknown)=>{
    assert.ok(cause instanceof ApiError);assert.equal(cause.accessExpired,true);assert.equal(cause.network,false);assert.equal(cause.unauthorized,false);assert.equal(cause.status,0);assert.equal(cause.message,MEMBER_ACCESS_EXPIRED_MESSAGE);return true;
  });
  assertManualXhr(init);assert.equal(init?.method,'POST');assert.equal(init?.body,file);
  assert.equal(header(init,'X-CSRF-Token'),'avatar-csrf');assert.equal(header(init,'Idempotency-Key'),'avatar-key');assert.equal(header(init,'If-Match'),'"4"');
  assert.equal(client.csrfToken,'avatar-csrf','an opaque redirect is not a 401 or 403');assert.equal(unauthorized,1);
});

// Execute the current Workspace effect with deferred reads. This verifies
// ownership/order only, not React rendering or native browser focus.
const workspaceSource=readFileSync(new URL('../../apps/portal-web/src/App.tsx',import.meta.url),'utf8');
const entryStart=workspaceSource.indexOf('  // Admin navigation follows only');
const entryEnd=workspaceSource.indexOf('  const [tab, setTab]',entryStart);
assert.ok(entryStart>=0&&entryEnd>entryStart);
const entryEffect=stripTypeScriptTypes(workspaceSource.slice(entryStart,entryEnd));
function adminEntryHarness(){
 const listeners=new Map<string,()=>void>(),calls:{resolve:(value:any)=>void;reject:(cause:unknown)=>void}[]=[];
 const session={user:{user_id:'synthetic-member'},csrf_token:'synthetic-csrf'};
 let visible:any=null,expired=0,cleanup=()=>{};
 const client={sessionGeneration:1,get(path:string,options:unknown){assert.equal(path,'/session');assert.deepEqual(JSON.parse(JSON.stringify(options)),{background:true});return new Promise((resolve,reject)=>calls.push({resolve,reject}));}};
 const events={addEventListener(name:string,handler:()=>void){listeners.set(name,handler);},removeEventListener(name:string){listeners.delete(name);}};
 const document={...events,visibilityState:'visible'};
 runInNewContext(entryEffect,{client,session,document,window:{...events,setInterval(handler:()=>void,delay:number){assert.equal(delay,60000);listeners.set('interval',handler);return 1;},clearInterval(){listeners.delete('interval');}},setAdminEntrySession:(value:unknown)=>{visible=value;},onSessionExpired:()=>{expired++;},useEffect:(run:()=>()=>void)=>{cleanup=run();}});
 return {client,session,document,calls,fire:(name='focus')=>listeners.get(name)?.(),cleanup:()=>cleanup(),state:()=>({visible,expired}),reply:(index:number,allowed:unknown=true,extra:Record<string,unknown>={})=>calls[index].resolve({...session,admin_entry_visible:allowed,...extra})};
}
const settled=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('admin navigation is hidden while pending and accepts only a true server hint for its current session',async()=>{
 const h=adminEntryHarness();assert.equal(h.state().visible,null);h.reply(0);await settled();assert.equal(h.state().visible.admin_entry_visible,true);
 for(const flag of [false,null,'true',1]){h.fire();assert.equal(h.state().visible,null);h.reply(h.calls.length-1,flag);await settled();assert.equal(h.state().visible,null);}
 h.fire();h.calls[h.calls.length-1].resolve({...h.session});await settled();assert.equal(h.state().visible,null);
 assert.equal(h.state().expired,0);h.cleanup();
});

test('admin navigation discards older reads and stays hidden on network failure or hidden document',async()=>{
 const h=adminEntryHarness();h.reply(0);await settled();h.fire();assert.equal(h.state().visible,null);
 h.fire();h.reply(2,false);await settled();h.reply(1,true);await settled();assert.equal(h.state().visible,null);
 h.fire();h.reply(3);await settled();h.fire();h.calls[4].reject(new Error('offline'));await settled();assert.equal(h.state().visible,null);assert.equal(h.state().expired,0);
 h.fire();h.document.visibilityState='hidden';h.fire('visibilitychange');h.reply(5);await settled();assert.equal(h.state().visible,null);assert.equal(h.calls.length,6);
 h.document.visibilityState='visible';h.fire('visibilitychange');h.reply(6);await settled();assert.equal(h.state().visible.admin_entry_visible,true);h.cleanup();
});

test('admin navigation cannot survive another user, another session, a changed client generation or unmount',async()=>{
 for(const extra of [{user:{user_id:'another-member'}},{csrf_token:'another-session'}]){const h=adminEntryHarness();h.reply(0,true,extra);await settled();assert.equal(h.state().visible,null);assert.equal(h.state().expired,1);h.cleanup();}
 const generation=adminEntryHarness();generation.client.sessionGeneration++;generation.reply(0);await settled();assert.equal(generation.state().visible,null);assert.equal(generation.state().expired,0);generation.cleanup();
 const unmounted=adminEntryHarness();unmounted.cleanup();unmounted.reply(0);await settled();assert.equal(unmounted.state().visible,null);assert.equal(unmounted.state().expired,0);
});

test('rendered member navigation exposes the admin link only with its explicit visibility hint',()=>{
 const base={current:'home' as const,onSelect:()=>{},canManageGuild:false,guildLaunchpadEnabled:false,communitySearchEnabled:false,personalContentEnabled:false,mobileOpen:false};
 for(const extra of [{},{canManagePlatform:false},{canManageGuild:true},{guildLaunchpadEnabled:true}])assert.doesNotMatch(renderToStaticMarkup(createElement(Navigation,{...base,...extra})),/href="\/admin"/);
 const context={locationHash:'#me',site:null,selectTab(){}} as unknown as PortalFeatureContext;
 const markup=(extra:Partial<PortalFeatureContext>)=>renderToStaticMarkup(createElement(PlaceView,{context:{...context,...extra},defaultTab:'profile',render:()=>null}));
 for(const extra of [{},{canManagePlatform:false},{canManageGuild:true}])assert.doesNotMatch(markup(extra),/href="\/admin"/);
 assert.match(markup({canManagePlatform:true}),/href="\/admin"/);
 assert.doesNotMatch(markup({canManagePlatform:true,locationHash:'#explore'}),/href="\/admin"/);
});
