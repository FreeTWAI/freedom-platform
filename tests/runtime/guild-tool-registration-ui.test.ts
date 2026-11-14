import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
import React from 'react';

class HostNode {
  [key:string]:any;
  parentNode:HostNode|null=null;
  childNodes:HostNode[]=[];
  attributes:Record<string,string>={};
  style:Record<string,any>={setProperty(){},removeProperty(){}};
  listeners:Record<string,{fn:Function;capture:boolean}[]>={};
  namespaceURI='http://www.w3.org/1999/xhtml';
  contentWindow:any;
  constructor(public nodeType:number,public nodeName:string,public ownerDocument:any){
    if(nodeType===1)this.tagName=nodeName;
    if(nodeName==='IFRAME')this.contentWindow={};
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
const propsOf=(node:HostNode)=>{const k=Object.keys(node).find(x=>x.startsWith('__reactProps$'));return k?node[k]:{};};
const hasClass=(node:HostNode,cls:string)=>(node.attributes.class??'').split(/\s+/).includes(cls);

function loadRegisteredTools(t:TestContext,fetchImpl:typeof fetch){
  const document=new HostDocument();
  const listeners:Record<string,Function[]>={};
  const timers=new Map<number,Function>();const intervals=new Map<number,Function>();let nextId=0;
  const windowObj:any={
    document,HTMLElement:HostNode,HTMLIFrameElement:HostNode,
    location:{origin:'https://fixture.invalid',hash:'#guilds/guild_games/start',assign(){},reload(){}},
    crypto:webcrypto,fetch:fetchImpl,
    setTimeout(fn:Function){const id=++nextId;timers.set(id,fn);return id;},
    clearTimeout(id:number){timers.delete(id);},
    setInterval(fn:Function){const id=++nextId;intervals.set(id,fn);return id;},
    clearInterval(id:number){intervals.delete(id);},
    addEventListener(type:string,fn:Function){(listeners[type]??=[]).push(fn);},
    removeEventListener(type:string,fn:Function){listeners[type]=(listeners[type]??[]).filter(x=>x!==fn);},
    dispatchEvent(e:any){for(const fn of [...(listeners[e.type]??[])])fn(e);return true;},
    get event(){return undefined;},
  };
  const prev={window:(globalThis as any).window,document:(globalThis as any).document,location:(globalThis as any).location,fetch:globalThis.fetch,IS_REACT:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
  Object.assign(globalThis,{window:windowObj,document,location:windowObj.location,fetch:fetchImpl,IS_REACT_ACT_ENVIRONMENT:true});
  t.after(()=>Object.assign(globalThis,prev));
  const req=createRequire(import.meta.url);
  const {act}=req('react') as typeof React;
  const {createRoot}=req('react-dom/client');
  const fileUrl=new URL('../../apps/portal-web/src/frame-tools/RegisteredTools.tsx',import.meta.url);
  const fileReq=createRequire(fileUrl);
  const {code}=transformSync(readFileSync(fileUrl,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'});
  const mod={exports:{} as any};
  const ctx=runInNewContext('(function(require,module,exports){'+code+'\n})',{
    ...globalThis,URL,
    window:windowObj,document,location:windowObj.location,crypto:webcrypto,fetch:fetchImpl,
    setTimeout:windowObj.setTimeout,clearTimeout:windowObj.clearTimeout,
    setInterval:windowObj.setInterval,clearInterval:windowObj.clearInterval,
    addEventListener:windowObj.addEventListener,removeEventListener:windowObj.removeEventListener,
  });
  ctx((id:string)=>{
    if(id==='../guild-tools/GuildToolPage')return {GuildToolPage:({children}:any)=>React.createElement('div',{'data-testid':'guild-tool-page'},children)};
    if(id==='../guild-tools/catalog')return {GUILD_TOOLS:[],isNativeTool:false};
    if(id==='./FrameTool')return {FrameTool:()=>React.createElement('div',{'data-testid':'frame-tool'})};
    if(id==='../../../../modules/guild-tools/contract')return fileReq('../../../../modules/guild-tools/contract.ts');
    return fileReq(id);
  },mod,mod.exports);
  return {RegisteredTools:mod.exports.RegisteredTools,document,windowObj,intervals,act,createRoot};
}

test('UX-G-02: add-tool form promotes 預覽 -> 加入啟動台 as single primary, hides list actions, puts permissions under 進階, and ensures 44px tap targets',async t=>{
  const existing={id:'t-existing',tool_id:'existing',guild_key:'guild_games',title:'舊工具',entry_url:'https://tool.example.test/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'enabled',revision:1};
  const created={id:'t-new',tool_id:'tool-new',guild_key:'guild_games',title:'新工具',entry_url:'https://tool.example.test/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'pending',revision:1};
  const fetchMock:typeof fetch=async()=>new Response(JSON.stringify({items:[existing]}),{status:200,headers:{'content-type':'application/json'}});
  const {RegisteredTools,document,windowObj,act,createRoot}=loadRegisteredTools(t,fetchMock);
  const client={
    sessionGeneration:1,
    async get(path:string){return path.endsWith('/access')?{manage:true,leader:true,member:true,registration_available:true,token_exchange_available:false}:{items:[existing]};},
    async post(){return created;},
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(RegisteredTools,{guildKey:'guild_games',toolId:'existing',client:client as any,memberKey:'m1'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
  const nodes=()=>descendants(container);
  const btn=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
  const click=(node:HostNode)=>propsOf(node).onClick({preventDefault(){},target:node,currentTarget:node});
  assert.equal(Boolean(btn('新增工具')),true,'新增工具 shown before adding');
  assert.equal(Boolean(btn('停用工具')),true,'停用工具 shown before adding');

  await act(async()=>{click(btn('新增工具')!);});
  assert.equal(Boolean(btn('新增工具')),false,'新增工具 hidden while adding');
  assert.equal(Boolean(btn('修改登錄')),false,'修改登錄 hidden while adding');
  assert.equal(Boolean(btn('停用工具')),false,'停用工具 hidden while adding');

  const section=nodes().find(n=>n.nodeName==='SECTION'&&n.attributes['aria-label']==='新增工具');
  assert.equal(Boolean(section),true,'add form section mounted');
  const summaries=descendants(section!).filter(n=>n.nodeName==='SUMMARY').map(n=>n.textContent);
  assert.deepEqual(summaries,['進階'],'disclosure summary label is 進階');
  const details=descendants(section!).find(n=>n.nodeName==='DETAILS')!;
  const isCheckbox=(n:HostNode)=>n.nodeName==='INPUT'&&(n.attributes.type==='checkbox'||n.type==='checkbox');
  const checkboxCountInsideDetails=descendants(details).filter(isCheckbox).length;
  const checkboxCountTotal=descendants(section!).filter(isCheckbox).length;
  assert.equal(checkboxCountInsideDetails>0,true,'permission checkboxes exist inside 進階');
  assert.equal(checkboxCountTotal,checkboxCountInsideDetails,'no optional permission checkboxes outside 進階');

  const primariesBefore=nodes().filter(n=>hasClass(n,'btn-primary')).map(n=>n.textContent);
  assert.deepEqual(primariesBefore,['預覽'],'預覽 is the single primary button before preview');
  const guide=descendants(section!).find(n=>n.nodeName==='A'&&n.textContent==='工具製作指南')!;
  assert.equal(hasClass(guide,'btn'),true,'工具製作指南 uses .btn for >=44px tap target');

  const inputs=descendants(section!).filter(n=>n.nodeName==='INPUT'&&!isCheckbox(n)&&n.attributes.disabled===undefined&&!n.disabled);
  await act(async()=>{
    propsOf(inputs[0]).onChange({target:{value:'新工具'}});
    propsOf(inputs[1]).onChange({target:{value:'https://tool.example.test/'}});
  });
  await act(async()=>{click(btn('預覽')!);await Promise.resolve();});

  assert.equal(Boolean(btn('預覽')),false,'預覽 disappears once preview record loads');
  const joinBtn=btn('加入啟動台')!;
  assert.equal(Boolean(joinBtn),true,'加入啟動台 rendered after 預覽');
  assert.equal(Boolean(propsOf(joinBtn).disabled),true,'加入啟動台 disabled until preview ready');
  assert.equal(hasClass(joinBtn,'btn-primary'),true,'加入啟動台 has .btn-primary');

  const iframe=descendants(section!).find(n=>n.nodeName==='IFRAME')!;
  await act(async()=>{
    windowObj.dispatchEvent({type:'message',origin:'https://fixture.invalid',source:iframe.contentWindow,data:{type:'guild-tool-preview-ready',id:'t-new'}});
  });
  assert.equal(Boolean(propsOf(btn('加入啟動台')!).disabled),false,'加入啟動台 enabled after preview ready');

  const css=readFileSync(new URL('../../apps/portal-web/src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.tool-registration\s+summary[\s\S]*?min-height:\s*44px/);
  }finally{act(()=>root.unmount());}
});

test('PERF-13: RegisteredTools does not poll while the tab is hidden and resumes when visible',async t=>{
  let fetchCount=0;
  const fetchMock:typeof fetch=async()=>{
    fetchCount++;
    return new Response(JSON.stringify({items:[]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const {RegisteredTools,document,intervals,act,createRoot}=loadRegisteredTools(t,fetchMock);
  const client={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/access'))return {manage:true,leader:true,member:true,registration_available:true,token_exchange_available:false};
      fetchCount++;
      return {items:[]};
    },
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(RegisteredTools,{guildKey:'guild_games',client:client as any,memberKey:'m1'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    assert.equal(fetchCount,1,'initial fetch runs once');
    assert.equal(intervals.size,1,'polling interval active when visible');

    await act(async()=>{for(const fn of [...intervals.values()])fn();await Promise.resolve();});
    assert.equal(fetchCount,2,'polling fetches when tab is visible');

    await act(async()=>{
      document.visibilityState='hidden';
      document.dispatchEvent({type:'visibilitychange'});
      for(const fn of [...intervals.values()])fn();
      await Promise.resolve();
    });
    assert.equal(fetchCount,2,'zero background polling fetches while tab is hidden');
    assert.equal(intervals.size,0,'polling timer paused while tab is hidden');

    await act(async()=>{
      document.visibilityState='visible';
      document.dispatchEvent({type:'visibilitychange'});
      await Promise.resolve();
    });
    assert.equal(fetchCount,3,'refreshes once when tab becomes visible again');
    assert.equal(intervals.size,1,'polling timer resumes when tab becomes visible again');
  }finally{act(()=>root.unmount());}
  assert.equal(intervals.size,0,'polling timer cleaned up on unmount');
});

test('I1: registration title allows 20 chars and GuildToolPage tool button exposes full title with single-line ellipsis',async t=>{
  const fetchMock:typeof fetch=async()=>new Response(JSON.stringify({items:[]}),{status:200,headers:{'content-type':'application/json'}});
  const {RegisteredTools,document,act,createRoot}=loadRegisteredTools(t,fetchMock);
  const client={sessionGeneration:1,async get(path:string){return path.endsWith('/access')?{manage:true,leader:true,member:true,registration_available:true,token_exchange_available:false}:{items:[]};}};
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(RegisteredTools,{guildKey:'guild_games',client:client as any,memberKey:'m1'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const nodes=()=>descendants(container);
    const click=(node:HostNode)=>propsOf(node).onClick({preventDefault(){},target:node,currentTarget:node});
    const addBtn=nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent==='新增工具')!;
    await act(async()=>{click(addBtn);});
    const titleInput=nodes().find(n=>n.nodeName==='INPUT'&&!n.attributes.disabled&&!n.disabled&&n.attributes.type!=='url'&&n.attributes.type!=='checkbox')!;
    assert.equal(titleInput.attributes.maxLength,'20','title input maxLength is 20');
  }finally{act(()=>root.unmount());}

  const req=createRequire(import.meta.url);
  const {act:actPage}=req('react') as typeof React;
  const {createRoot:createPageRoot}=req('react-dom/client');
  const pageUrl=new URL('../../apps/portal-web/src/guild-tools/GuildToolPage.tsx',import.meta.url);
  const pageReq=createRequire(pageUrl);
  const {code}=transformSync(readFileSync(pageUrl,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'});
  const mod={exports:{} as any};
  const pageCtx=runInNewContext('(function(require,module,exports){'+code+'\n})',{
    ...globalThis,URL,window:globalThis.window,document,location:(globalThis as any).location,
  });
  pageCtx((id:string)=>{
    if(id==='./GuildToolPage.css')return {};
    if(id==='../../../../modules/guild-workspace/repositories/registry')return {guildRepository:()=>undefined};
    return pageReq(id);
  },mod,mod.exports);
  const GuildToolPage=mod.exports.GuildToolPage;
  const pageContainer=document.createElement('div');document.body.appendChild(pageContainer);
  const pageRoot=createPageRoot(pageContainer);
  const title20='一二三四五六七八九十一二三四五六七八九十';
  assert.equal(title20.length,20);
  await actPage(async()=>{
    pageRoot.render(React.createElement(GuildToolPage,{
      guildKey:'guild_human_design',
      loaded:true,
      tools:[{tool_id:'tool-20',guild_key:'guild_human_design',title:title20,kind:'frame',old_routes:[]}],
    }));
  });
  try{
    const btn=descendants(pageContainer).find(n=>n.nodeName==='BUTTON'&&n.textContent.includes(title20));
    assert.ok(btn,'tool button rendered');
    assert.equal(btn!.attributes.title,title20,'button title attribute holds full 20-char title');
    assert.equal(hasClass(btn!,'guild-tool-button'),true,'button has guild-tool-button class');
    const css=readFileSync(new URL('../../apps/portal-web/src/guild-tools/GuildToolPage.css',import.meta.url),'utf8');
    assert.match(css,/\.guild-tool-button[\s\S]*max-width:/,'CSS bounds guild-tool-button width');
    assert.match(css,/white-space:\s*nowrap/,'CSS keeps title on one line');
    assert.match(css,/text-overflow:\s*ellipsis/,'CSS truncates with ellipsis');
  }finally{actPage(()=>pageRoot.unmount());}
});
test('p3-l2b I4: plain member proposes, previews, and withdraws drafts; manager sees proposer name with 接受 and 不接受',async t=>{
  const draft1={id:'d-1',tool_id:'draft-one',guild_key:'guild_games',title:'成員草稿一',entry_url:'https://tool.example.test/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'pending',revision:1,draft_expires_at:'2026-11-15T10:00:00Z',registered_by:'u1',registered_by_name:'示範成員'};
  const draft2={id:'d-2',tool_id:'draft-two',guild_key:'guild_games',title:'成員草稿二',entry_url:'https://tool.example.test/2',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'pending',revision:1,draft_expires_at:'2026-11-15T10:00:00Z',registered_by:'u2',registered_by_name:'另一成員'};
  const createdDraft={id:'d-new',tool_id:'draft-new',guild_key:'guild_games',title:'新建草稿',entry_url:'https://tool.example.test/new',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read'],permissions:[],state:'pending',revision:1,draft_expires_at:'2026-11-15T10:00:00Z',registered_by:'u1'};
  const fetchMock:typeof fetch=async()=>new Response(JSON.stringify({items:[]}),{status:200,headers:{'content-type':'application/json'}});
  const {RegisteredTools,document,act,createRoot}=loadRegisteredTools(t,fetchMock);
  const posts:Array<{path:string;body:unknown;ifMatch?:number}>=[];

  // 1. Plain member view (manage=false, member=true)
  const memberClient={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/access'))return {manage:false,leader:false,member:true,registration_available:true,token_exchange_available:false};
      return {items:[draft1]};
    },
    async post(path:string,body:unknown,opts?:{ifMatch?:number}){
      posts.push({path,body,ifMatch:opts?.ifMatch});
      if(path==='/guilds/guild_games/tools')return createdDraft;
      return {state:'disabled',revision:1};
    },
  };
  const c1=document.createElement('div');document.body.appendChild(c1);
  const r1=createRoot(c1);
  await act(async()=>{
    r1.render(React.createElement(RegisteredTools,{guildKey:'guild_games',client:memberClient as any,memberKey:'u1'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const nodes=()=>descendants(c1);
    const btn=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
    const click=(node:HostNode)=>propsOf(node).onClick({preventDefault(){},target:node,currentTarget:node});
    const propose=btn('提出工具草稿');
    assert.ok(propose,'member sees 提出工具草稿');
    assert.equal(hasClass(propose!,'btn-secondary'),true,'提出工具草稿 is a secondary button');
    assert.equal(Boolean(btn('新增工具')),false,'member does not see 新增工具');
    assert.equal(c1.textContent.includes('草稿 · 24 小時內有效'),true,'draft shows 草稿 · 24 小時內有效');
    assert.ok(btn('預覽'),'draft shows 預覽');
    assert.ok(btn('撤回'),'draft shows 撤回');
    assert.equal(Boolean(btn('接受')),false,'plain member does not see 接受');
    assert.equal(Boolean(btn('不接受')),false,'plain member does not see 不接受');

    // Preview existing draft
    await act(async()=>{click(btn('預覽')!);});
    const previewIframe=nodes().find(n=>n.nodeName==='IFRAME');
    assert.ok(previewIframe,'clicking 預覽 opens preview iframe');
    assert.equal(previewIframe!.attributes.src,'/guild-tool-preview/d-1');
    await act(async()=>{click(btn('關閉')!);});

    // Open registration form via 提出工具草稿
    await act(async()=>{click(btn('提出工具草稿')!);});
    const section=nodes().find(n=>n.nodeName==='SECTION'&&n.attributes['aria-label']!==undefined)!;
    const inputs=descendants(section).filter(n=>n.nodeName==='INPUT'&&(n.attributes.type??'text')!=='checkbox'&&!n.disabled);
    await act(async()=>{
      propsOf(inputs[0]).onChange({target:{value:'新建草稿'}});
      propsOf(inputs[1]).onChange({target:{value:'https://tool.example.test/new'}});
    });
    await act(async()=>{click(btn('預覽')!);await Promise.resolve();});
    assert.equal(posts.at(-1)?.path,'/guilds/guild_games/tools');
    assert.equal(Boolean(btn('加入啟動台')),false,'plain member cannot accept their own draft');
    await act(async()=>{click(btn('關閉')!);});
    assert.equal(c1.textContent.includes('新建草稿'),true,'newly created draft appears in list after closing');

    // Withdraw draft
    const withdrawBtn=nodes().filter(n=>n.nodeName==='BUTTON'&&n.textContent==='撤回')[0];
    await act(async()=>{click(withdrawBtn);await Promise.resolve();});
    assert.equal(posts.at(-1)?.path,'/guilds/guild_games/tools/draft-one/withdraw');
    assert.equal(posts.at(-1)?.ifMatch,1);
    assert.equal(c1.textContent.includes('成員草稿一'),false,'withdrawn draft removed from list');
  }finally{act(()=>r1.unmount());}

  // 2. Non-member view (manage=false, member=false) hides 提出工具草稿
  const nonMemberClient={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/access'))return {manage:false,leader:false,member:false,registration_available:true,token_exchange_available:false};
      return {items:[]};
    },
  };
  const c2=document.createElement('div');document.body.appendChild(c2);
  const r2=createRoot(c2);
  await act(async()=>{
    r2.render(React.createElement(RegisteredTools,{guildKey:'guild_games',client:nonMemberClient as any,memberKey:'u9'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    assert.equal(Boolean(descendants(c2).find(n=>n.nodeName==='BUTTON'&&n.textContent==='提出工具草稿')),false,'non-member does not see 提出工具草稿');
  }finally{act(()=>r2.unmount());}

  // 3. Manager view (manage=true) sees proposer name, 接受 and 不接受
  const managerPosts:Array<{path:string;ifMatch?:number}>=[];
  const managerClient={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/access'))return {manage:true,leader:true,member:true,registration_available:true,token_exchange_available:false};
      return {items:[draft1,draft2]};
    },
    async post(path:string,_body:unknown,opts?:{ifMatch?:number}){
      managerPosts.push({path,ifMatch:opts?.ifMatch});
      return {state:path.endsWith('/accept')?'enabled':'disabled',revision:1};
    },
  };
  const c3=document.createElement('div');document.body.appendChild(c3);
  const r3=createRoot(c3);
  await act(async()=>{
    r3.render(React.createElement(RegisteredTools,{guildKey:'guild_games',client:managerClient as any,memberKey:'leader1'}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const nodes=()=>descendants(c3);
    const click=(node:HostNode)=>propsOf(node).onClick({preventDefault(){},target:node,currentTarget:node});
    assert.equal(c3.textContent.includes('示範成員'),true,'manager sees proposer name 示範成員');
    assert.equal(c3.textContent.includes('另一成員'),true,'manager sees proposer name 另一成員');
    const acceptBtns=nodes().filter(n=>n.nodeName==='BUTTON'&&n.textContent==='接受');
    const declineBtns=nodes().filter(n=>n.nodeName==='BUTTON'&&n.textContent==='不接受');
    assert.equal(acceptBtns.length,2,'manager sees 接受 for each draft');
    assert.equal(declineBtns.length,2,'manager sees 不接受 for each draft');
    assert.equal(nodes().some(n=>n.nodeName==='BUTTON'&&n.textContent==='撤回'),false,'manager does not see 撤回');

    await act(async()=>{click(acceptBtns[0]);await Promise.resolve();});
    assert.equal(managerPosts[0]?.path,'/guilds/guild_games/tools/draft-one/accept');
    assert.equal(managerPosts[0]?.ifMatch,1);

    const remainingDecline=nodes().filter(n=>n.nodeName==='BUTTON'&&n.textContent==='不接受')[0];
    await act(async()=>{click(remainingDecline);await Promise.resolve();});
    assert.equal(managerPosts[1]?.path,'/guilds/guild_games/tools/draft-two/withdraw');
    assert.equal(managerPosts[1]?.ifMatch,1);
    assert.equal(c3.textContent.includes('成員草稿二'),false,'declined draft removed from list');
  }finally{act(()=>r3.unmount());}
});
