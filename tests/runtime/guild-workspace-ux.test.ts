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
  constructor(public nodeType:number,public nodeName:string,public ownerDocument:any){
    if(nodeType===1)this.tagName=nodeName;
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
}

class HostDocument extends HostNode {
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

function loadGuildWorkspace(t:TestContext){
  const document=new HostDocument();
  const listeners:Record<string,Function[]>={};
  const windowObj:any={
    document,HTMLElement:HostNode,Element:HostNode,HTMLIFrameElement:class{},
    location:{origin:'https://fixture.invalid',hash:'#guilds/manage'},
    crypto:webcrypto,
    addEventListener(type:string,fn:Function){(listeners[type]??=[]).push(fn);},
    removeEventListener(type:string,fn:Function){listeners[type]=(listeners[type]??[]).filter(x=>x!==fn);},
    get event(){return undefined;},
  };
  const prev={window:(globalThis as any).window,document:(globalThis as any).document,location:(globalThis as any).location,Element:(globalThis as any).Element,HTMLElement:(globalThis as any).HTMLElement,IS_REACT:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
  Object.assign(globalThis,{window:windowObj,document,location:windowObj.location,Element:HostNode,HTMLElement:HostNode,IS_REACT_ACT_ENVIRONMENT:true});
  t.after(()=>Object.assign(globalThis,prev));
  const req=createRequire(import.meta.url);
  const {act}=req('react') as typeof React;
  const {createRoot}=req('react-dom/client');
  const fileUrl=new URL('../../apps/portal-web/src/modules/GuildWorkspace.tsx',import.meta.url);
  const fileReq=createRequire(fileUrl);
  const {code}=transformSync(readFileSync(fileUrl,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'});
  const mod={exports:{} as any};
  const ctx=runInNewContext('(function(require,module,exports){'+code+'\n})',{
    ...globalThis,
    window:windowObj,document,location:windowObj.location,crypto:webcrypto,
    addEventListener:windowObj.addEventListener,removeEventListener:windowObj.removeEventListener,
  });
  ctx((id:string)=>{
    if(id==='./GuildWorkspace.css')return {};
    if(id==='./GuildReviews')return {GuildReviews:()=>React.createElement('div',{'data-testid':'guild-reviews'})};
    if(id==='../api')return {ApiError:class ApiError extends Error{status=0;}};
    if(id==='./skill-discovery-client')return {refreshSkillDiscovery:async()=>{}};
    if(id==='../game-console-core')return {logConsoleEvent(){}};
    if(id==='../game-console-routing')return {consoleChannel:()=>''};
    return fileReq(id);
  },mod,mod.exports);
  return {MemberGuildWorkspace:mod.exports.MemberGuildWorkspace,AdminGuildWorkspace:mod.exports.AdminGuildWorkspace,document,act,createRoot};
}

test('UX-G-05: GuildWorkspace hides tabPurpose behind 說明 after content and moves 重新載入列表 out of form actions',async t=>{
  const {MemberGuildWorkspace,document,act,createRoot}=loadGuildWorkspace(t);
  const client={
    sessionGeneration:1,
    async get(path:string){
      if(path==='/guild-workspace')return {managed_guilds:[{guild_key:'guild_games',name:'小遊戲公會'}],managed_books:[],can_discuss:true,can_review_pulls:false};
      if(path.includes('/announcements'))return {items:[]};
      return {};
    },
    async post(){return {};},
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(MemberGuildWorkspace,{client:client as any}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const nodes=()=>descendants(container);
    const allNodes=nodes();
    const purpose=allNodes.find(n=>hasClass(n,'guild-workspace-purpose'));
    assert.equal(Boolean(purpose),true,'purpose text still exists');
    const helpDetails=allNodes.find(n=>n.nodeName==='DETAILS'&&hasClass(n,'guild-workspace-help'));
    assert.equal(Boolean(helpDetails),true,'purpose sits inside details.guild-workspace-help');
    assert.equal(descendants(helpDetails!).some(n=>n.nodeName==='SUMMARY'&&n.textContent==='說明'),true,'help disclosure summary is 說明');
    assert.equal(helpDetails!.contains(purpose!),true,'purpose paragraph is inside 說明 disclosure');
    const columns=allNodes.find(n=>hasClass(n,'guild-workspace-columns'))!;
    assert.equal(allNodes.indexOf(helpDetails!)>allNodes.indexOf(columns),true,'說明 disclosure comes after main content');

    const form=allNodes.find(n=>n.nodeName==='FORM')!;
    const formButtons=descendants(form).filter(n=>n.nodeName==='BUTTON').map(n=>n.textContent);
    assert.deepEqual(formButtons,['保存公告'],'form actions contain only primary 保存公告');

    const reloadBtn=allNodes.find(n=>n.nodeName==='BUTTON'&&n.textContent==='重新載入列表');
    assert.equal(Boolean(reloadBtn),true,'重新載入列表 button still exists');
    assert.equal(form.contains(reloadBtn!),false,'重新載入列表 is moved out of form actions');

    const css=readFileSync(new URL('../../apps/portal-web/src/modules/GuildWorkspace.css',import.meta.url),'utf8');
    assert.match(css,/\.guild-workspace-help\s+summary[\s\S]*?min-height:\s*44px/);
  }finally{act(()=>root.unmount());}
});

test('UX-G-13: AdminGuildWorkspace uses 電子信箱, hides 選擇會員 until search results exist, and moves 重讀維護職務 to header',async t=>{
  const {AdminGuildWorkspace,document,act,createRoot}=loadGuildWorkspace(t);
  const client={
    sessionGeneration:1,
    async request(path:string){
      if(path==='/skill-maintainers')return {items:[{book_id:'b1',title:'測試技能書',maintainers:[]}]};
      if(path.startsWith('/members?'))return {items:[{user_id:'u2',display_name:'王小明',email:'ming@example.test',active:true}]};
      return {};
    },
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(AdminGuildWorkspace,{client:client as any}));
    await Promise.resolve();await Promise.resolve();
  });
  try{
    const nodes=()=>descendants(container);
    assert.equal(container.textContent.includes('E-mail'),false,'no English E-mail label');
    assert.equal(nodes().some(n=>n.nodeName==='LABEL'&&n.textContent.includes('搜尋姓名或電子信箱')),true,'uses 搜尋姓名或電子信箱 label');

    const head=nodes().find(n=>hasClass(n,'card-head'));
    assert.equal(Boolean(head),true,'section header uses .card-head');
    assert.equal(descendants(head!).some(n=>n.nodeName==='BUTTON'&&n.textContent==='重讀維護職務'),true,'重讀維護職務 sits in section .card-head');

    assert.equal(nodes().some(n=>n.nodeName==='LABEL'&&n.textContent.includes('選擇會員')),false,'選擇會員 hidden before search results exist');
    assert.equal(nodes().some(n=>n.nodeName==='BUTTON'&&n.textContent==='任命為技能書維護者'),false,'任命為技能書維護者 hidden before search results exist');

    const form=nodes().find(n=>n.nodeName==='FORM')!;
    await act(async()=>{await propsOf(form).onSubmit({preventDefault(){}});});
    assert.equal(nodes().some(n=>n.nodeName==='LABEL'&&n.textContent.includes('選擇會員')),true,'選擇會員 shown once search returns results');
    assert.equal(nodes().some(n=>n.nodeName==='BUTTON'&&n.textContent==='任命為技能書維護者'),true,'任命為技能書維護者 shown once search returns results');
  }finally{act(()=>root.unmount());}
});
