import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
import React from 'react';

class HostNode {
  [key:string]:any;
  parentNode:HostNode|null=null;
  childNodes:HostNode[]=[];
  attributes:Record<string,string>={};
  dataset:Record<string,string>={};
  style:Record<string,any>={setProperty(){},removeProperty(){}};
  listeners:Record<string,{fn:Function;capture:boolean}[]>={};
  namespaceURI='http://www.w3.org/1999/xhtml';
  contentWindow:any;
  constructor(public nodeType:number,public nodeName:string,public ownerDocument:any){
    if(nodeType===1)this.tagName=nodeName;
    if(nodeName==='IFRAME')this.contentWindow={postMessage(){}};
  }
  appendChild(node:HostNode){node.parentNode?.removeChild(node);this.childNodes.push(node);node.parentNode=this;return node;}
  removeChild(node:HostNode){const i=this.childNodes.indexOf(node);assert.notEqual(i,-1);this.childNodes.splice(i,1);node.parentNode=null;return node;}
  insertBefore(node:HostNode,before:HostNode){node.parentNode?.removeChild(node);const i=this.childNodes.indexOf(before);assert.notEqual(i,-1);this.childNodes.splice(i,0,node);node.parentNode=this;return node;}
  setAttribute(k:string,v:unknown){this.attributes[k]=String(v);}
  removeAttribute(k:string){delete this.attributes[k];}
  getAttribute(k:string){return this.attributes[k]??null;}
  setAttributeNS(_ns:string,k:string,v:unknown){this.setAttribute(k,v);}
  addEventListener(type:string,fn:Function,options?:any){(this.listeners[type]??=[]).push({fn,capture:options===true||!!options?.capture});}
  removeEventListener(type:string,fn:Function){this.listeners[type]=(this.listeners[type]??[]).filter(item=>item.fn!==fn);}
  get className(){return this.attributes.class??'';}
  set className(v:string){this.attributes.class=String(v);}
  get options():HostNode[]{return this.childNodes.flatMap(n=>n.nodeName==='OPTION'?[n]:n.options);}
  get firstChild():HostNode|null{return this.childNodes[0]??null;}
  get lastChild():HostNode|null{return this.childNodes.at(-1)??null;}
  get nextSibling():HostNode|null{return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
  get textContent():string{return this.nodeType===3?this.nodeValue:this.childNodes.map(n=>n.textContent).join('');}
  set textContent(v:string){this.childNodes.forEach(n=>{n.parentNode=null;});this.childNodes=[];if(v)this.appendChild(this.ownerDocument.createTextNode(String(v)));}
  get parentElement():HostNode|null{return this.parentNode?.nodeType===1?this.parentNode:null;}
  contains(node:HostNode):boolean{return node===this||this.childNodes.some(c=>c.contains(node));}
  dispatchEvent(e:any){for(const item of [...(this.listeners[e.type]??[])])item.fn(e);return true;}
}

class HostDocument extends HostNode {
  visibilityState='visible';
  lang='zh-TW';
  constructor(){
    super(9,'#document',null);this.ownerDocument=this;
    this.documentElement=new HostNode(1,'HTML',this);this.body=new HostNode(1,'BODY',this);
    this.appendChild(this.documentElement);this.documentElement.appendChild(this.body);this.activeElement=this.body;
  }
  createElement(name:string){return new HostNode(1,name.toUpperCase(),this);}
  createElementNS(_ns:string,name:string){return this.createElement(name);}
  createTextNode(value:string){const n=new HostNode(3,'#text',this);n.nodeValue=value;return n;}
}

const descendants=(root:HostNode):HostNode[]=>root.childNodes.flatMap(n=>[n,...descendants(n)]);
const hasClass=(node:HostNode,cls:string)=>(node.attributes.class??'').split(/\s+/).includes(cls);

function resolveLocalFile(baseFile:string,id:string):string|null{
  if(!id.startsWith('.'))return null;
  const baseDir=dirname(baseFile);
  for(const candidate of [id,`${id}.tsx`,`${id}.ts`,`${id}/index.tsx`,`${id}/index.ts`]){
    const full=resolve(baseDir,candidate);
    if(existsSync(full))return full;
  }
  return null;
}

function loadPortalUi(t:TestContext,fetchImpl:typeof fetch){
  const document=new HostDocument();
  const listeners:Record<string,Function[]>={};
  const timers=new Map<number,Function>();const intervals=new Map<number,Function>();let nextId=0;
  const storage=new Map<string,string>();
  const windowObj:any={
    document,HTMLElement:HostNode,HTMLIFrameElement:HostNode,
    location:{origin:'https://fixture.invalid',hash:'#guilds/guild_games/start',assign(){},reload(){},replace(h:string){windowObj.location.hash=h;}},
    crypto:webcrypto,fetch:fetchImpl,
    localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,v);}},
    sessionStorage:{getItem:()=>null,setItem(){}},
    setTimeout(fn:Function){const id=++nextId;timers.set(id,fn);return id;},
    clearTimeout(id:number){timers.delete(id);},
    setInterval(fn:Function){const id=++nextId;intervals.set(id,fn);return id;},
    clearInterval(id:number){intervals.delete(id);},
    addEventListener(type:string,fn:Function){(listeners[type]??=[]).push(fn);},
    removeEventListener(type:string,fn:Function){listeners[type]=(listeners[type]??[]).filter(x=>x!==fn);},
    dispatchEvent(e:any){for(const fn of [...(listeners[e.type]??[])])fn(e);return true;},
    get event(){return undefined;},
  };
  const prev={window:(globalThis as any).window,document:(globalThis as any).document,location:(globalThis as any).location,fetch:globalThis.fetch,localStorage:(globalThis as any).localStorage,sessionStorage:(globalThis as any).sessionStorage,IS_REACT:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
  Object.assign(globalThis,{window:windowObj,document,location:windowObj.location,fetch:fetchImpl,localStorage:windowObj.localStorage,sessionStorage:windowObj.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
  t.after(()=>Object.assign(globalThis,prev));
  const req=createRequire(import.meta.url);
  const {act}=req('react') as typeof React;
  const {createRoot}=req('react-dom/client');
  const cache=new Map<string,any>();
  const stubbed=(id:string)=>{
    if(id.endsWith('/MemberGameUpload'))return {MemberGameUpload:()=>null};
    if(id.endsWith('/share-port'))return {openShareComposer:async()=>({status:'cancelled'})};
    if(id.endsWith('/Community'))return {};
    return null;
  };
  function loadFile(absPath:string):any{
    if(cache.has(absPath))return cache.get(absPath);
    if(absPath.endsWith('.css'))return {};
    if(absPath.endsWith('.json')){const data=JSON.parse(readFileSync(absPath,'utf8'));cache.set(absPath,data);return data;}
    const mod={exports:{} as any};
    cache.set(absPath,mod.exports);
    const fileReq=createRequire(pathToFileURL(absPath));
    const {code}=transformSync(readFileSync(absPath,'utf8'),{loader:absPath.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'});
    const MutationObserverStub=class{observe(){}disconnect(){}};
    const ctx=runInNewContext('(function(require,module,exports){'+code+'\n})',{
      ...globalThis,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,Headers,Request,Response,AbortController,AbortSignal,MutationObserver:MutationObserverStub,
      window:windowObj,document,location:windowObj.location,crypto:webcrypto,fetch:fetchImpl,
      localStorage:windowObj.localStorage,sessionStorage:windowObj.sessionStorage,
      setTimeout:windowObj.setTimeout,clearTimeout:windowObj.clearTimeout,
      setInterval:windowObj.setInterval,clearInterval:windowObj.clearInterval,
      addEventListener:windowObj.addEventListener,removeEventListener:windowObj.removeEventListener,
    });
    ctx((id:string)=>{
      if(id.endsWith('.css'))return {};
      const stub=stubbed(id);
      if(stub)return stub;
      const local=resolveLocalFile(absPath,id);
      if(local)return loadFile(local);
      return fileReq(id);
    },mod,mod.exports);
    cache.set(absPath,mod.exports);
    return mod.exports;
  }
  const rootDir=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const {RegisteredTools}=loadFile(resolve(rootDir,'apps/portal-web/src/frame-tools/RegisteredTools.tsx'));
  const {FrameTool}=loadFile(resolve(rootDir,'apps/portal-web/src/frame-tools/FrameTool.tsx'));
  const {GuildToolPage}=loadFile(resolve(rootDir,'apps/portal-web/src/guild-tools/GuildToolPage.tsx'));
  const {GuildRepositoryFrame}=loadFile(resolve(rootDir,'apps/portal-web/src/guild-repositories/GuildRepositoryFrame.tsx'));
  return {RegisteredTools,FrameTool,GuildToolPage,GuildRepositoryFrame,document,windowObj,listeners,timers,act,createRoot};
}

test('UX-V-03: hides disabled tools from members/visitors, marks 已停用 for managers, and renders distinct disabled/pending direct views with primary 返回公會',async t=>{
  const enabled={id:'t-en',tool_id:'enabled-tool',guild_key:'guild_games',title:'可用工具',entry_url:'https://tool.example.test/en/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'enabled',revision:1};
  const disabled={id:'t-dis',tool_id:'disabled-tool',guild_key:'guild_games',title:'停用工具A',entry_url:'https://tool.example.test/dis/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'disabled',revision:1};
  const pending={id:'t-pen',tool_id:'pending-tool',guild_key:'guild_games',title:'待審工具B',entry_url:'https://tool.example.test/pen/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'pending',revision:1};
  const fetchMock:typeof fetch=async()=>new Response(JSON.stringify({items:[enabled,disabled,pending]}),{status:200,headers:{'content-type':'application/json'}});
  const {RegisteredTools,document,act,createRoot}=loadPortalUi(t,fetchMock);

  const memberBox=document.createElement('div');document.body.appendChild(memberBox);
  const memberRoot=createRoot(memberBox);
  await act(async()=>{
    memberRoot.render(React.createElement(RegisteredTools,{guildKey:'guild_games',memberKey:'guest'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const memberBtns=descendants(memberBox).filter(n=>n.nodeName==='BUTTON').map(n=>n.textContent);
    assert.equal(memberBtns.includes('可用工具'),true,'enabled tool listed for visitor/member');
    assert.equal(memberBtns.some(s=>s.includes('停用工具A')),false,'disabled tool must not be listed for visitor/member');
    assert.equal(memberBtns.some(s=>s.includes('待審工具B')),false,'pending tool must not be listed for visitor/member');
  }finally{act(()=>memberRoot.unmount());}

  const mgrBox=document.createElement('div');document.body.appendChild(mgrBox);
  const mgrRoot=createRoot(mgrBox);
  // A signed-in member reads the guild's tool list through the session client, so the mock answers both paths.
  const mgrClient={sessionGeneration:1,async get(path:string){return path.endsWith('/tools/access')?{manage:true,leader:true,registration_available:true,token_exchange_available:false}:{items:[enabled,disabled,pending]};}};
  await act(async()=>{
    mgrRoot.render(React.createElement(RegisteredTools,{guildKey:'guild_games',client:mgrClient as any,memberKey:'m1'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const mgrBtns=descendants(mgrBox).filter(n=>n.nodeName==='BUTTON').map(n=>n.textContent);
    const disabledBtn=mgrBtns.find(s=>s.includes('停用工具A'))??'';
    assert.equal(disabledBtn.includes('已停用'),true,'manager still sees disabled tool marked 已停用');
  }finally{act(()=>mgrRoot.unmount());}

  const directDisBox=document.createElement('div');document.body.appendChild(directDisBox);
  const directDisRoot=createRoot(directDisBox);
  await act(async()=>{
    directDisRoot.render(React.createElement(RegisteredTools,{guildKey:'guild_games',toolId:'disabled-tool',memberKey:'guest'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const text=directDisBox.textContent;
    assert.equal(text.includes('此工具已停用'),true,'disabled direct view shows 此工具已停用');
    assert.equal(text.includes('等待會長確認'),false,'disabled direct view must not mix pending text');
    const primaries=descendants(directDisBox).filter(n=>hasClass(n,'btn-primary'));
    assert.equal(primaries.length,1,'disabled direct view has exactly one primary control');
    assert.equal(primaries[0].textContent,'返回公會');
    assert.equal(primaries[0].attributes.href,'#guilds/guild_games/start');
  }finally{act(()=>directDisRoot.unmount());}

  const directPenBox=document.createElement('div');document.body.appendChild(directPenBox);
  const directPenRoot=createRoot(directPenBox);
  await act(async()=>{
    directPenRoot.render(React.createElement(RegisteredTools,{guildKey:'guild_games',toolId:'pending-tool',memberKey:'guest'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const text=directPenBox.textContent;
    assert.equal(text.includes('等待會長確認'),true,'pending direct view shows 等待會長確認');
    assert.equal(text.includes('此工具已停用'),false,'pending direct view must not show disabled text');
    const primaries=descendants(directPenBox).filter(n=>hasClass(n,'btn-primary'));
    assert.equal(primaries.length,1,'pending direct view has exactly one primary control');
    assert.equal(primaries[0].textContent,'返回公會');
  }finally{act(()=>directPenRoot.unmount());}
});

test('UX-M-02: empty guild tools shows short empty state + primary 返回公會 and hides unavailable 工具 option; failed repository frame shows 重試 and 返回公會',async t=>{
  const fetchMock:typeof fetch=async()=>new Response(JSON.stringify({items:[]}),{status:200,headers:{'content-type':'application/json'}});
  const {GuildToolPage,GuildRepositoryFrame,document,timers,act,createRoot}=loadPortalUi(t,fetchMock);

  const emptyBox=document.createElement('div');document.body.appendChild(emptyBox);
  const emptyRoot=createRoot(emptyBox);
  await act(async()=>{
    emptyRoot.render(React.createElement(GuildToolPage,{guildKey:'guild_human_design',tools:[],loaded:true,site:{guild_launchpad_enabled:true} as any}));
    await Promise.resolve();
  });
  try{
    const options=descendants(emptyBox).filter(n=>n.nodeName==='OPTION').map(n=>n.attributes.value);
    assert.equal(options.includes('tools'),false,'unavailable 工具 option omitted when guild has zero tools');
    const primaries=descendants(emptyBox).filter(n=>hasClass(n,'btn-primary'));
    assert.equal(primaries.length,1,'empty guild tools has one primary button/link');
    assert.equal(primaries[0].textContent,'返回公會');
    assert.equal(primaries[0].attributes.href,'#guilds/guild_human_design/start');
    assert.equal(emptyBox.textContent.includes('尚無可用工具'),true,'short empty state rendered for non-toolOnly guild');
  }finally{act(()=>emptyRoot.unmount());}

  const repoBox=document.createElement('div');document.body.appendChild(repoBox);
  const repoRoot=createRoot(repoBox);
  const navigated:string[]=[];
  const repository={guild_key:'guild_human_design',name:'人類圖公會',repository:'guild-human-design'};
  await act(async()=>{
    repoRoot.render(React.createElement(GuildRepositoryFrame,{repository:repository as any,actions:['work','skills','information'],onNavigate:(a:string)=>{navigated.push(a);}}));
    await Promise.resolve();
  });
  try{
    await act(async()=>{
      for(const fn of [...timers.values()])fn();
      await Promise.resolve();
    });
    const btns=descendants(repoBox).filter(n=>n.nodeName==='BUTTON'||n.nodeName==='A');
    const retry=btns.find(n=>n.textContent==='重試');
    const back=btns.find(n=>n.textContent==='返回公會');
    assert.equal(Boolean(retry),true,'failed repository frame renders 重試');
    assert.equal(Boolean(back),true,'failed repository frame renders 返回公會');
    const backProps=Object.keys(back!).find(k=>k.startsWith('__reactProps$'));
    if(backProps)await act(async()=>{back![backProps].onClick?.({preventDefault(){}});});
    assert.deepEqual(navigated,['information'],'返回公會 navigates away from failed frame');
  }finally{act(()=>repoRoot.unmount());}
});

test('UX-V-15: framed tool view collapses header navigation behind 更多, translates scope/source info behind 說明 with zero visible English host/keys',async t=>{
  const enabled={id:'t-sweep',tool_id:'sweep-tool',guild_key:'guild_games',title:'掃描工具',entry_url:'https://guild-tool.example.test/app/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read','share:compose','device-state:own'],permissions:[],state:'enabled',revision:1};
  const fetchMock:typeof fetch=async()=>new Response(JSON.stringify({items:[enabled]}),{status:200,headers:{'content-type':'application/json'}});
  const {RegisteredTools,document,act,createRoot}=loadPortalUi(t,fetchMock);
  const box=document.createElement('div');document.body.appendChild(box);
  const root=createRoot(box);
  await act(async()=>{
    root.render(React.createElement(RegisteredTools,{guildKey:'guild_games',toolId:'sweep-tool',memberKey:'guest'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const nodes=descendants(box);
    const outsideDetails=(node:HostNode)=>{let p=node.parentNode;while(p){if(p.nodeName==='DETAILS')return false;p=p.parentNode;}return true;};
    const visibleActionNames=nodes.filter(n=>(n.nodeName==='BUTTON'||n.nodeName==='A'||n.nodeName==='SELECT'||n.nodeName==='SUMMARY')&&outsideDetails(n)).map(n=>n.textContent);
    assert.equal(visibleActionNames.length<=3,true,`expected <=3 top-level actions, got ${visibleActionNames.join(',')}`);
    assert.deepEqual(nodes.filter(n=>n.nodeName==='SUMMARY').map(n=>n.textContent),['更多','說明']);
    const visibleParagraphText=nodes.filter(n=>n.nodeName==='P'&&outsideDetails(n)).map(n=>n.textContent).join(' ');
    assert.equal(visibleParagraphText.includes('guild-tool.example.test'),false,'visible summary must not display raw English host');
    const detailsText=nodes.filter(n=>n.nodeName==='DETAILS'&&n.childNodes.some(c=>c.nodeName==='SUMMARY'&&c.textContent==='說明')).map(n=>n.textContent).join(' ');
    assert.equal(detailsText.includes('context:read'),false,'scopes inside 說明 must be Traditional Chinese, not raw keys');
    assert.equal(detailsText.includes('有限身分'),true,'translated scope label present inside 說明');
  }finally{act(()=>root.unmount());}
});

test('PERF-13 (FrameTool): does not fetch tool registry per bridge message (0 fetches for device-state/resize, <=1 cached for privileged ops)',async t=>{
  const tool={id:'t-perf',tool_id:'perf-tool',guild_key:'guild_games',title:'效能工具',entry_url:'https://guild-tool.example.test/app/',origin:'https://guild-tool.example.test',bridge_version:'freedom.guild-launchpad/v2' as const,profile:'sandboxed' as const,scopes:['context:read','device-state:own','resize','share:compose'] as any,permissions:[],state:'enabled' as const,revision:1};
  let registryFetches=0;
  const fetchMock:typeof fetch=async()=>{
    registryFetches++;
    return new Response(JSON.stringify({items:[tool]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const {FrameTool,document,windowObj,act,createRoot}=loadPortalUi(t,fetchMock);
  const box=document.createElement('div');document.body.appendChild(box);
  const root=createRoot(box);
  await act(async()=>{
    root.render(React.createElement(FrameTool,{tool}));
    await Promise.resolve();
  });
  try{
    const iframe=descendants(box).find(n=>n.nodeName==='IFRAME')!;
    const posted:any[]=[];
    iframe.contentWindow={postMessage:(m:any)=>{posted.push(m);}};
    const iframePropsKey=Object.keys(iframe).find(k=>k.startsWith('__reactProps$'))!;
    await act(async()=>{iframe[iframePropsKey].onLoad();});
    const initMsg=posted.find(m=>m.type==='init');
    assert.equal(Boolean(initMsg?.nonce),true,'init message provides nonce');
    const sendOp=async(id:string,operation:string,payload:unknown)=>{
      await act(async()=>{
        windowObj.dispatchEvent({type:'message',source:iframe.contentWindow,origin:'null',data:{version:'freedom.guild-launchpad/v2',type:'request',tool_id:tool.tool_id,guild_key:tool.guild_key,nonce:initMsg.nonce,request_id:id,operation,payload}});
        await Promise.resolve();await Promise.resolve();await Promise.resolve();
      });
    };
    for(let i=0;i<5;i++)await sendOp(`put-${i}`,'device-state.put',{key:'k',value:`v${i}`});
    await sendOp('rs-1','resize',{height:700});
    assert.equal(registryFetches,0,'local device-state.put and resize ops make zero registry requests');

    await sendOp('ctx-1','context.get',{});
    await sendOp('ctx-2','context.get',{});
    assert.equal(registryFetches,1,'privileged context.get checks registry once and caches within 10s window');
    const responses=posted.filter(m=>m.type==='response');
    assert.equal(responses.length,8,'all 8 bridge requests received responses');
    assert.equal(responses.every(r=>r.ok===true),true,'all 8 bridge requests succeeded');
  }finally{act(()=>root.unmount());}
});
