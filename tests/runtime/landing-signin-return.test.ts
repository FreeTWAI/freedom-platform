import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import postcss from 'postcss';
import {LanguagePicker,LanguageProvider} from '../../apps/portal-web/src/language.js';

const read=(name:string)=>readFileSync(new URL('../../apps/portal-web/src/'+name,import.meta.url),'utf8');

async function loadAppExports(){
  const appPath=new URL('../../apps/portal-web/src/App.tsx',import.meta.url).pathname;
  const built=await build({
    entryPoints:[appPath],
    bundle:true,
    write:false,
    format:'cjs',
    platform:'node',
    jsx:'automatic',
    external:['react','react-dom','react/jsx-runtime','react-dom/server'],
    plugins:[{
      name:'ignore-css',
      setup(build){
        build.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'ignore-css'}));
        build.onLoad({filter:/.*/,namespace:'ignore-css'},()=>({contents:'',loader:'js'}));
      },
    }],
  });
  const mod={exports:{} as Record<string,any>};
  const req=createRequire(appPath);
  const storage=new Map<string,string>();
  const fakeWindow:any={
    location:{pathname:'/',search:'',hash:'',href:'http://127.0.0.1/'},
    history:{state:null,replaceState(){},pushState(){},back(){}},
    navigator:{language:'zh-TW',languages:['zh-TW']},
    localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)},
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    addEventListener(){},
    removeEventListener(){},
    dispatchEvent(){return true;},
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  };
  const fakeDocument:any={
    documentElement:{lang:'zh-Hant'},
    visibilityState:'visible',
    addEventListener(){},
    removeEventListener(){},
    querySelector:()=>null,
  };
  const sandbox:Record<string,unknown>={
    module:mod,
    exports:mod.exports,
    require:req,
    process,
    console,
    Buffer,
    Blob,
    FormData,
    TextEncoder,
    TextDecoder,
    crypto,
    URL,
    URLSearchParams,
    AbortController,
    Headers,
    Response,
    Request,
    Event,
    HashChangeEvent:class extends Event{},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0),
    window:fakeWindow,
    document:fakeDocument,
    navigator:fakeWindow.navigator,
    localStorage:fakeWindow.localStorage,
    sessionStorage:fakeWindow.sessionStorage,
    matchMedia:fakeWindow.matchMedia,
    fetch:async()=>Response.json({}),
  };
  runInNewContext(built.outputFiles[0].text,sandbox);
  return {exports:mod.exports,fakeWindow};
}

test('LanguagePicker renders Traditional Chinese 語言 label and AppInstall.css does not clip it to 1px',()=>{
  const html=renderToStaticMarkup(createElement(LanguageProvider,null,createElement(LanguagePicker,{className:'login-language-row'})));
  assert.doesNotMatch(html,/Language/);
  assert.match(html,/<span[^>]*>語言<\/span>/);
  assert.match(html,/<select[^>]*aria-label="語言"/);

  const css=read('AppInstall.css');
  let clipped1px=false;
  postcss.parse(css).walkRules(rule=>{
    if(!rule.selector.includes('language-picker'))return;
    let width='';
    let overflow='';
    rule.walkDecls(decl=>{
      if(decl.prop==='width')width=decl.value;
      if(decl.prop==='overflow')overflow=decl.value;
    });
    if(width==='1px'&&overflow==='hidden')clipped1px=true;
  });
  assert.equal(clipped1px,false,'AppInstall.css must not clip the language label span to 1px');
});

test('resolveSignedOutHash validates member return addresses with safePortalReturn and rejects unknown hashes',async()=>{
  const {exports}=await loadAppExports();
  assert.equal(typeof exports.resolveSignedOutHash,'function');
  const expectSignedOut=(input:string,expected:{returnHash:string|null;notice:string|null})=>{
    const actual=exports.resolveSignedOutHash(input);
    assert.equal(actual.returnHash,expected.returnHash);
    assert.equal(actual.notice,expected.notice);
  };

  expectSignedOut('',{returnHash:null,notice:null});
  expectSignedOut('#home',{returnHash:null,notice:null});

  for(const [input,expected] of [
    ['#me','#me'],
    ['#me/credit','#me/credit'],
    ['#promotion','#me/credit'],
    ['#automation/agent','#automation/agent'],
    ['#guilds/manage','#guilds/manage'],
    ['#shares/00000000-0000-4000-8000-000000009999','#shares/00000000-0000-4000-8000-000000009999'],
  ] as const){
    expectSignedOut(input,{returnHash:expected,notice:'請先登入以查看此頁。'});
  }

  for(const invalid of ['#unknown-page','#evil//path','#shares/not-a-uuid']){
    expectSignedOut(invalid,{returnHash:null,notice:'找不到這個頁面，請先登入。'});
  }
  assert.equal(exports.resolvePostSignInHash('#me/credit','#me/credit'),'#me/credit');
  assert.equal(exports.resolvePostSignInHash('#home','#me/credit'),'#me/credit');
  assert.equal(exports.resolvePostSignInHash('#unknown-page',null),'#home');
  assert.equal(exports.resolvePostSignInHash('#evil//path','https://evil.invalid/#me'),'#home');
});

test('Landing page has logo at top, one primary 免費加入, secondary 登入, and collapses demo/links behind 更多',async()=>{
  const {exports}=await loadAppExports();
  assert.equal(typeof exports.LoginView,'function');
  const {LoginView,LanguageProvider,AppInstallProvider}=exports;

  const site={
    registration_enabled:true,
    demo_accounts_enabled:true,
    community_search_enabled:true,
    community_discovery_enabled:false,
    password_recovery_enabled:false,
    guild_launchpad_enabled:false,
    commerce_checkout_enabled:false,
    event_participation_enabled:false,
    member_reporting_enabled:false,
    skill_book_star_gate_enabled:false,
    notification_preferences_enabled:false,
    message_images_enabled:false,
    member_blocking_enabled:false,
    supplier_console_enabled:false,
    commerce_console_enabled:false,
  };
  const baseProps={
    site,
    notice:null,
    bootError:null,
    onRetrySession:()=>{},
    onLoggedIn:()=>{},
    entryIntent:null,
    onChooseEntry:()=>{},
    resetToken:null,
    onCancelReset:()=>{},
    onPasswordReset:()=>{},
  };

  const landingHtml=renderToStaticMarkup(
    createElement(LanguageProvider,null,
      createElement(AppInstallProvider,null,
        createElement(LoginView,baseProps),
      ),
    ),
  );
  const logoPos=landingHtml.indexOf('class="login-entry-logo"');
  const headingPos=landingHtml.indexOf('<h1');
  const cardPos=landingHtml.indexOf('class="card login-card"');
  assert.ok(logoPos>=0&&headingPos>logoPos&&cardPos>headingPos,'logo must appear before headline and login card');

  const primaries=[...landingHtml.matchAll(/<button[^>]*class="[^"]*\bbtn-primary\b[^"]*"[^>]*>(.*?)<\/button>/g)].map(m=>m[1]);
  assert.deepEqual(primaries,['免費加入']);
  assert.match(landingHtml,/<button[^>]*class="[^"]*\bbtn-secondary\b[^"]*"[^>]*type="submit"[^>]*>登入<\/button>/);

  const moreStart=landingHtml.indexOf('<details class="login-more"');
  assert.ok(moreStart>=0,'landing page must render <details class="login-more">');
  const beforeMore=landingHtml.slice(0,moreStart);
  assert.match(landingHtml.slice(moreStart),/^<details class="login-more"[^>]*><summary>更多<\/summary>/);
  assert.doesNotMatch(beforeMore,/示範帳號|maker@local\.test|先看免費資源|近期活動|LINE・|auth-switch/);

  const registerHtml=renderToStaticMarkup(
    createElement(LanguageProvider,null,
      createElement(AppInstallProvider,null,
        createElement(LoginView,{...baseProps,initialMode:'register'}),
      ),
    ),
  );
  const registerPrimaries=[...registerHtml.matchAll(/<button[^>]*class="[^"]*\bbtn-primary\b[^"]*"[^>]*>(.*?)<\/button>/g)].map(m=>m[1]);
  assert.deepEqual(registerPrimaries,['建立帳號，先逛工坊']);
  assert.match(registerHtml,/<button[^>]*class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>會員登入<\/button>/);

  const redirectHtml=renderToStaticMarkup(
    createElement(LanguageProvider,null,
      createElement(AppInstallProvider,null,
        createElement(LoginView,{...baseProps,notice:'請先登入以查看此頁。',memberReturnHash:'#me/credit'}),
      ),
    ),
  );
  assert.match(redirectHtml,/role="status"[^>]*>請先登入以查看此頁。<\/p>/);
  const redirectPrimaries=[...redirectHtml.matchAll(/<button[^>]*class="[^"]*\bbtn-primary\b[^"]*"[^>]*>(.*?)<\/button>/g)].map(m=>m[1]);
  assert.deepEqual(redirectPrimaries,['登入']);
  assert.doesNotMatch(redirectHtml,/>免費加入<\/button>.*btn-primary/);
});
