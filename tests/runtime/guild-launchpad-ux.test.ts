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
  showModal(){}
  close(){}
  focus(){}
  scrollIntoView(){}
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

function loadGuildLaunchpad(t:TestContext){
  const document=new HostDocument();
  const listeners:Record<string,Function[]>={};
  const windowObj:any={
    document,HTMLElement:HostNode,Element:HostNode,HTMLIFrameElement:class{},
    location:{origin:'https://fixture.invalid',hash:'#guilds/guild_games'},
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
  const fileUrl=new URL('../../apps/portal-web/src/modules/GuildLaunchpad.tsx',import.meta.url);
  const fileReq=createRequire(fileUrl);
  const {code}=transformSync(readFileSync(fileUrl,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'});
  const mod={exports:{} as any};
  const ctx=runInNewContext('(function(require,module,exports){'+code+'\n})',{
    ...globalThis,AbortController,URL,
    window:windowObj,document,location:windowObj.location,crypto:webcrypto,
    addEventListener:windowObj.addEventListener,removeEventListener:windowObj.removeEventListener,
  });
  ctx((id:string)=>{
    if(id==='./GuildLaunchpad.css')return {};
    if(id==='./GuildLaunchpadMyWork')return {MyWorkPanel:()=>React.createElement('div'),rememberActing(){}};
    if(id==='./GuildLaunchpadApplications')return {GuildLaunchpadApplications:()=>React.createElement('div'),startable:()=>true};
    if(id==='../guild-blocks/runtime')return {GuildBlock:()=>React.createElement('div')};
    if(id==='../guild-repositories/GuildRepositoryFrame')return {GuildRepositoryFrame:()=>React.createElement('div')};
    if(id==='../guild-tools/catalog')return {GUILD_TOOLS:[]};
    if(id==='./guild-launchpad-route')return {guildRoute:(g:string,s?:string)=>s?`#guilds/${g}/${s}`:`#guilds/${g}`};
    if(id==='../api')return {ApiError:class ApiError extends Error{code='';status=0;}};
    if(id==='../format')return {formatIsoLocal:(s:string)=>s};
    if(id==='../useLocalAction')return {useLocalAction:()=>({busy:false,error:'',message:'',run:async()=>{}})};
    if(id==='./shared')return {useModuleMutation:()=>({mutate:async()=>{},busy:false,error:''})};
    if(id.includes('LegacyLaunchpadPrimary'))return {LegacyLaunchpadPrimary:()=>React.createElement('div'),legacyPrimaryLabel:()=>'主要動作',legacyPrimaryVisible:()=>false,legacyStorePath:()=>'',legacyWorkNavigationGuard:()=>false};
    if(id.startsWith('../../../../'))return fileReq(id+'.ts');
    return fileReq(id);
  },mod,mod.exports);
  return {GuildLaunchpad:mod.exports.GuildLaunchpad,PublicGuildLaunchpad:mod.exports.PublicGuildLaunchpad,MyWorkUnavailable:mod.exports.MyWorkUnavailable,document,act,createRoot};
}

function makeConfig(){
  const blocks=[
    {id:'b1',kind:'mission',title:null,order:0,enabled:true},
    {id:'b2',kind:'announcements',title:null,order:1,enabled:true},
    {id:'b3',kind:'skill_books',title:null,order:2,enabled:true},
    {id:'b4',kind:'applications',title:null,order:3,enabled:false},
    {id:'b5',kind:'community_tasks',title:null,order:4,enabled:true},
    {id:'b6',kind:'my_work',title:null,order:5,enabled:true},
    {id:'b7',kind:'support',title:null,order:6,enabled:true},
  ];
  return {
    schema_version:'guild-launchpad.config/v1',
    guild_key:'guild_games',
    mission_override:null,
    blocks,
    application_refs:[],
    starter:{title_label:'',objective_hint:'',note_hint:''},
    support:{kind:'platform_help',public_url:null},
  };
}

test('UX-G-06: 調整版面 collapses each block to (name, state, 編輯), opens one row at a time, and removes developer hints',async t=>{
  const {GuildLaunchpad,document,act,createRoot}=loadGuildLaunchpad(t);
  const body=makeConfig();
  const client={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/launchpad'))return {
        guild:{name:'小遊戲公會',purpose:'做遊戲'},
        announcements:[],skill_books:[],applications:[],
        config:{body,status:'published',revision:1,pointer_version:'1',config_id:'c1',source:'guild_editor'},
        config_problem:null,membership:{member_tier:'full'},
        viewer_can_edit_config:true,viewer_can_preview_config:true,viewer_can_publish_config:true,viewer_can_manage_delegations:false,
      };
      if(path.endsWith('/launchpad-config'))return {
        body,status:'published',revision:1,pointer_version:'1',config_id:'c1',source:'guild_editor',
        config_problem:null,revisions:[],delegations:[],delegation_candidates:[],
      };
      return {};
    },
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(GuildLaunchpad,{client:client as any,guildKey:'guild_games',mode:'member',userId:'u1'}));
    for(let i=0;i<8;i++)await Promise.resolve();
  });
  try{
    const nodes=()=>descendants(container);
    const editor=nodes().find(n=>n.nodeName==='FORM'&&hasClass(n,'guild-launchpad-editor'))!;
    assert.equal(Boolean(editor),true,'editor mounted: '+container.textContent.slice(0,160));

    const editorText=editor.textContent;
    assert.equal(editorText.includes('這段文字不能換行'),false,'developer hint 這段文字不能換行 removed');
    assert.equal(editorText.includes('原有七區塊'),false,'developer v1 hint removed');
    assert.equal(editorText.includes('不接受貼入程式'),false,'developer security hint removed');
    assert.equal(container.textContent.includes('這段文字不能換行'),false,'revert dialog developer hint removed');

    const blockGroups=()=>descendants(editor).filter(n=>hasClass(n,'guild-launchpad-block'));
    assert.equal(blockGroups().length,7,'7 blocks rendered');
    assert.equal(descendants(editor).filter(n=>n.nodeName==='BUTTON'&&(n.textContent==='上移'||n.textContent==='下移')).length,0,'reorder buttons hidden while rows collapsed');
    assert.equal(descendants(editor).filter(n=>n.nodeName==='LABEL'&&n.textContent.startsWith('區塊標題')).length,0,'block title inputs hidden while rows collapsed');

    const row0Text=blockGroups()[0].textContent;
    assert.equal(row0Text.includes('使命')&&row0Text.includes('已顯示')&&row0Text.includes('編輯'),true,'row 0 shows name, state, 編輯');
    const row3Text=blockGroups()[3].textContent;
    assert.equal(row3Text.includes('應用')&&row3Text.includes('已隱藏')&&row3Text.includes('編輯'),true,'row 3 shows name, 已隱藏, 編輯');

    const savebar=nodes().find(n=>hasClass(n,'guild-editor-savebar'))!;
    const saveActions=descendants(savebar).find(n=>hasClass(n,'guild-launchpad-actions'))!;
    const topControls=saveActions.childNodes.filter(n=>n.nodeType===1);
    assert.equal(topControls.length,3,'savebar has 3 top-level controls: 預覽 menu, 儲存草稿, 發布');
    const previewMenu=topControls.find(n=>n.nodeName==='DETAILS'&&hasClass(n,'guild-launchpad-preview-menu'))!;
    assert.equal(Boolean(previewMenu),true,'preview controls collapse inside details.guild-launchpad-preview-menu');
    assert.equal(descendants(previewMenu).find(n=>n.nodeName==='SUMMARY')?.textContent,'預覽','preview menu summary is 預覽');
    assert.deepEqual(descendants(previewMenu).filter(n=>n.nodeName==='BUTTON').map(n=>n.textContent),['預覽公開','預覽會員','預覽我的工作'],'all 3 preview options stay inside 預覽 menu');
    const primaryBtns=descendants(saveActions).filter(n=>n.nodeName==='BUTTON'&&hasClass(n,'btn-primary'));
    assert.deepEqual(primaryBtns.map(n=>n.textContent),['發布'],'savebar has one primary button 發布');

    const missionInput=nodes().find(n=>n.nodeName==='INPUT'&&n.attributes.id==='launchpad-mission')!;
    await act(async()=>{propsOf(missionInput).onChange({target:{value:'第一行\n第二行'}});});
    const updatedMission=nodes().find(n=>n.nodeName==='INPUT'&&n.attributes.id==='launchpad-mission')!;
    assert.equal(updatedMission.value??propsOf(updatedMission).value,'第一行 第二行','mission_override strips newlines silently');

    const editBtn=(idx:number)=>descendants(blockGroups()[idx]).find(n=>n.nodeName==='BUTTON'&&(n.textContent==='編輯'||n.textContent==='收合'))!;
    await act(async()=>{propsOf(editBtn(0)).onClick({preventDefault(){}});});
    assert.equal(descendants(blockGroups()[0]).some(n=>n.nodeName==='BUTTON'&&n.textContent==='上移'),true,'row 0 shows reorder buttons when open');
    assert.equal(descendants(blockGroups()[0]).some(n=>n.nodeName==='LABEL'&&n.textContent.startsWith('區塊標題')),true,'row 0 shows title input when open');

    await act(async()=>{propsOf(editBtn(3)).onClick({preventDefault(){}});});
    assert.equal(descendants(blockGroups()[0]).some(n=>n.nodeName==='BUTTON'&&n.textContent==='上移'),false,'opening row 3 closes row 0');
    assert.equal(descendants(blockGroups()[3]).some(n=>n.nodeName==='BUTTON'&&n.textContent==='上移'),true,'row 3 is now open');
    assert.equal(descendants(blockGroups()[3]).some(n=>n.nodeName==='INPUT'),true,'row 3 shows inputs when open');
  }finally{act(()=>root.unmount());}
});

test('UX-M-08: welcome guide moves helper paragraph behind 說明 after resource actions and keeps empty state <= 24 chars',async t=>{
  const {GuildLaunchpad,MyWorkUnavailable,document,act,createRoot}=loadGuildLaunchpad(t);
  const body=makeConfig();
  const client={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/launchpad'))return {
        guild:{name:'人類圖研究所',purpose:'共讀來源與限制'},
        announcements:[],skill_books:[],applications:[],
        config:{body,status:'published',revision:1,pointer_version:'1',config_id:'c1',source:'guild_editor'},
        config_problem:null,membership:{member_tier:'full'},
        viewer_can_edit_config:false,viewer_can_preview_config:false,viewer_can_publish_config:false,viewer_can_manage_delegations:false,
      };
      return {};
    },
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(GuildLaunchpad,{client:client as any,guildKey:'guild_human_design',mode:'member',userId:'u1'}));
    for(let i=0;i<8;i++)await Promise.resolve();
  });
  try{
    const allNodes=descendants(container);
    const welcome=allNodes.find(n=>hasClass(n,'guild-launchpad-welcome'))!;
    assert.equal(Boolean(welcome),true,'welcome guide rendered');
    const purpose=descendants(welcome).find(n=>hasClass(n,'guild-launchpad-purpose'))!;
    const preview=descendants(welcome).find(n=>hasClass(n,'guild-launchpad-resource-preview'))!;
    assert.equal(descendants(purpose).some(n=>hasClass(n,'muted')),false,'no muted prose helper paragraph before actions');
    const help=descendants(welcome).find(n=>n.nodeName==='DETAILS'&&hasClass(n,'guild-launchpad-help'))!;
    assert.equal(Boolean(help),true,'helper explanation sits inside details.guild-launchpad-help');
    assert.equal(descendants(help).some(n=>n.nodeName==='SUMMARY'&&n.textContent==='說明'),true,'disclosure summary is 說明');
    assert.equal(help.textContent.includes('私人工作仍依原業務空間權限存取'),true,'privacy explanation preserved inside 說明');
    assert.equal(allNodes.indexOf(help)>allNodes.indexOf(preview),true,'說明 disclosure sits after action buttons');

    const css=readFileSync(new URL('../../apps/portal-web/src/modules/GuildLaunchpad.css',import.meta.url),'utf8');
    assert.match(css,/\.guild-launchpad-help\s+summary[\s\S]*?min-height:\s*44px/);

    const emptyBox=document.createElement('div');document.body.appendChild(emptyBox);
    const emptyRoot=createRoot(emptyBox);
    await act(async()=>{emptyRoot.render(React.createElement(MyWorkUnavailable,{visitor:false}));});
    try{
      const lines=descendants(emptyBox).filter(n=>n.nodeName==='P').map(n=>n.textContent.trim());
      assert.equal(lines.every(line=>line.length<=24),true,'MyWorkUnavailable paragraphs <= 24 chars: '+lines.join(' | '));
    }finally{act(()=>emptyRoot.unmount());emptyBox.parentNode?.removeChild(emptyBox);}
  }finally{act(()=>root.unmount());}
});

test('UX-M-10: GuildLaunchpad omits duplicate 開啟公會啟動台 button when switcher has 啟動台',async t=>{
  const {GuildLaunchpad,document,act,createRoot}=loadGuildLaunchpad(t);
  const body=makeConfig();
  const client={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/launchpad'))return {
        guild:{name:'人類圖研究所',purpose:'共讀來源與限制'},
        announcements:[],skill_books:[],applications:[],
        config:{body,status:'published',revision:1,pointer_version:'1',config_id:'c1',source:'guild_editor'},
        config_problem:null,membership:{member_tier:'full'},
        viewer_can_edit_config:false,viewer_can_preview_config:false,viewer_can_publish_config:false,viewer_can_manage_delegations:false,
      };
      return {};
    },
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(GuildLaunchpad,{client:client as any,guildKey:'guild_human_design',mode:'member',userId:'u1'}));
    for(let i=0;i<8;i++)await Promise.resolve();
  });
  try{
    const allNodes=descendants(container);
    const nav=allNodes.find(n=>n.nodeName==='NAV'&&hasClass(n,'guild-launchpad-nav'))!;
    assert.equal(descendants(nav).some(n=>n.nodeName==='BUTTON'&&n.textContent==='啟動台'),true,'nav switcher already has 啟動台');
    const mobileNav=allNodes.find(n=>hasClass(n,'guild-launchpad-mobile-nav'))!;
    assert.equal(descendants(mobileNav).some(n=>n.nodeName==='OPTION'&&n.textContent==='啟動台'),true,'mobile switcher already has 啟動台');
    assert.equal(allNodes.some(n=>n.nodeName==='BUTTON'&&n.textContent==='開啟公會啟動台'),false,'duplicate 開啟公會啟動台 button removed');
  }finally{act(()=>root.unmount());}
});

test('UX-V-15: PublicGuildLaunchpad places actions before shortened public note (<= 20 chars) with one primary and no inline styles',async t=>{
  const {PublicGuildLaunchpad,document,act,createRoot}=loadGuildLaunchpad(t);
  const body=makeConfig();
  const client={
    sessionGeneration:1,
    async get(path:string){
      if(path.endsWith('/launchpad'))return {
        guild:{name:'人類圖研究所',purpose:'共讀來源與限制'},
        announcements:[],skill_books:[{slug:'book1',title:'人類圖共讀指南',summary:'共讀'}],applications:[],
        config:{body,status:'published',revision:1,pointer_version:'1',config_id:'c1',source:'guild_editor'},
        config_problem:null,membership:null,
        viewer_can_edit_config:false,viewer_can_preview_config:false,viewer_can_publish_config:false,viewer_can_manage_delegations:false,
      };
      return {};
    },
  };
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{
    root.render(React.createElement(PublicGuildLaunchpad,{client:client as any,guildKey:'guild_human_design',onLogin(){}}));
    for(let i=0;i<8;i++)await Promise.resolve();
  });
  try{
    const allNodes=descendants(container);
    const entry=allNodes.find(n=>hasClass(n,'guild-launchpad-entry'))!;
    assert.equal(Boolean(entry),true,'public entry rendered');
    const actions=descendants(entry).find(n=>hasClass(n,'guild-launchpad-actions'))!;
    const note=descendants(entry).find(n=>n.nodeName==='P'&&hasClass(n,'muted'))!;
    assert.equal(Boolean(note),true,'public note rendered');
    assert.equal(allNodes.indexOf(actions)<allNodes.indexOf(note),true,'actions come before public note');
    assert.equal(note.textContent.trim().length<=20,true,'public note <= 20 chars: '+note.textContent);
    const isVisible=(n:HostNode)=>{for(let cur:HostNode|null=n;cur;cur=cur.parentNode){if(cur.nodeName==='DIALOG'&&cur.attributes.open===undefined)return false;}return true;};
    const primaries=allNodes.filter(n=>hasClass(n,'btn-primary')&&isVisible(n));
    assert.deepEqual(primaries.map(n=>n.textContent),['查看公會技能書'],'exactly one primary button on public guild launchpad');
    assert.equal(allNodes.some(n=>n.attributes.style!==undefined),false,'no inline style attributes');
  }finally{act(()=>root.unmount());}
});
