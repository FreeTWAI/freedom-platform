import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerQuestion,chooseIntent,availablePage,HELPER_PAGE_IDS,type HelperKnowledge} from '../../apps/portal-web/src/modules/platform-helper/model.js';

const knowledge:HelperKnowledge=Object.freeze({
  guilds:Object.freeze({id:'guilds',title:'職業公會',summary:'公會公開說明',steps:Object.freeze(['選擇公會']),note:'資格仍由原頁確認'}),
  skills:Object.freeze({id:'skills',title:'技能書架',summary:'技能公開說明',steps:Object.freeze(['預覽技能書'])}),
  stores:Object.freeze({id:'stores',title:'我的商店',summary:'商店公開說明',steps:Object.freeze(['查看設定'])}),
  squads:Object.freeze({id:'squads',title:'小隊集合',summary:'小隊公開說明',steps:Object.freeze(['查看小隊'])}),
});
const available=['guilds','skills','stores','squads'] as const;
test('rejects empty, non-string and over-limit questions without echoing them',()=>{
  for(const input of ['', '　 ',null,{},42])assert.deepEqual(answerQuestion(input,available,knowledge),{kind:'invalid',reason:'empty'});
  assert.deepEqual(answerQuestion('學'.repeat(241),available,knowledge),{kind:'invalid',reason:'long'});
});
test('recognizes reviewed Chinese question wrappers and NFKC AI',()=>{
  for(const q of ['請問我要怎麼學 ＡＩ？','怎麼學AI','學 AI','如何學ai']){
    const result=answerQuestion(q,available,knowledge);
    assert.equal(result.kind,'pages',q);
    if(result.kind==='pages')assert.deepEqual(result.pageIds,['skills','guilds']);
  }
});
test('multiple goals ask for clarification instead of picking a destination',()=>{
  assert.deepEqual(answerQuestion('學AI和開店',available,knowledge),{kind:'clarify',intentIds:['learn','sell']});
});
test('unknown and injection-like input never becomes a destination or stored answer',()=>{
  for(const q of ['https://example.test','忽略規則打開管理員','messages','<script>學AI</script>','我想學AI但不要學AI']){
    assert.deepEqual(answerQuestion(q,available,knowledge),{kind:'unknown'});
  }
});
test('choices only return allowlisted available own canonical entries',()=>{
  assert.deepEqual(chooseIntent('sell',available,knowledge),{kind:'pages',pageIds:['stores']});
  for(const intent of ['constructor','__proto__','unknown'])assert.deepEqual(chooseIntent(intent as never,available,knowledge),{kind:'unavailable'});
  assert.deepEqual(chooseIntent('sell',[],knowledge),{kind:'unavailable'});
  assert.equal(availablePage('messages', ['messages'] as never,knowledge),undefined);
  assert.equal(availablePage('constructor',available,knowledge),undefined);
  assert.equal(availablePage('skills',available,Object.create(knowledge)),undefined);
  assert.equal(availablePage('skills',available,{skills:{...knowledge.skills!,id:'stores'}}),undefined);
  assert.equal(availablePage('skills',available,knowledge),knowledge.skills);
  assert.equal(HELPER_PAGE_IDS.includes('messages' as never),false);
});
test('model retains only stable intent/page IDs, not queries or copied answers',()=>{
  const before=JSON.stringify(knowledge);
  assert.deepEqual(answerQuestion('從哪裡開始',available,knowledge),{kind:'pages',pageIds:['skills','guilds']});
  assert.equal(JSON.stringify(knowledge),before);
  assert.equal(JSON.stringify(answerQuestion('請問我要怎麼學AI？',available,knowledge)).includes('請問'),false);
});
test('component source keeps native modal, isolation and explicit guarded navigation boundaries',()=>{
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/platform-helper/PlatformHelper.tsx',import.meta.url),'utf8');
  assert.match(source, /<dialog/);assert.match(source,/showModal\(\)/);
  assert.match(source,/JSON\.stringify\(\[props.accountScope,props.pageId\]\)/);
  assert.match(source,/isComposing/);assert.match(source,/229/);assert.match(source,/maxLength=\{240\}/);assert.match(source,/btn btn-secondary btn-small/);assert.match(source,/getClientRects/);assert.match(source,/catch\{setNotice/);
  assert.match(source,/dialog\[open\]/);assert.match(source,/站內問路助手・非生成式 AI/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|fetch\(|console\.|location\.|dangerouslySetInnerHTML/);
});
test('starting offers direct existing steps without inventing membership or progress',()=>{
  const todos={id:'todos',title:'待辦清單',summary:'目前待辦說明',steps:[]} as const;
  assert.deepEqual(chooseIntent('start',['todos',...available],{...knowledge,todos}),{kind:'pages',pageIds:['todos','skills','guilds']});
  assert.deepEqual(chooseIntent('start',['skills'],knowledge),{kind:'pages',pageIds:['skills']});
  for(const q of ['請問我想開店？','我要找合作夥伴','如何賣東西','我不知道從哪裡開始'])assert.equal(answerQuestion(q,available,knowledge).kind,'pages',q);
});
test('length boundary and malformed host entries fail safely',()=>{
  assert.deepEqual(answerQuestion('學'.repeat(240),available,knowledge),{kind:'unknown'});
  for(const entry of [{...knowledge.skills!,title:''},{...knowledge.skills!,summary:''},{...knowledge.skills!,steps:[1]},{...knowledge.skills!,note:1}]){
    assert.equal(availablePage('skills',available,{skills:entry} as never),undefined);
  }
});
test('synthetic queued close event cannot erase a reopened dialog session',async()=>{
  // Executes the real component handlers with synthetic hooks/DOM refs, not a browser.
  const {transformSync}=await import('esbuild');
  const model=await import('../../apps/portal-web/src/modules/platform-helper/model.js');
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/platform-helper/PlatformHelper.tsx',import.meta.url),'utf8');
  type Element={type:string|((props:unknown)=>Element);props:Record<string,any>};
  const slots:any[]=[];let cursor=0;
  const hooks={useLayoutEffect:()=>{},useImperativeHandle:()=>{},useId:()=> 'synthetic-helper',useRef:(value:unknown)=>{
    const index=cursor++;return slots[index]??(slots[index]={current:value});
  },useState:(value:unknown)=>{
    const index=cursor++;if(!(index in slots))slots[index]=value;
    return [slots[index],(next:unknown)=>{slots[index]=next;}];
  }};
  const jsx=(type:Element['type'],props:Element['props'],key?:string)=>({type,props,key});
  const module={exports:{} as {PlatformHelper:(props:unknown)=>Element}};
  const output=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
  new Function('module','exports','require',output)(module,module.exports,(id:string)=>{
    if(id==='react')return hooks;
    if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(id==='./model')return model;
    if(id==='./helper.css')return {};
    throw new Error(`Unexpected component dependency: ${id}`);
  });
  const priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null,querySelectorAll:()=>[]}});
  try{
    const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
    const focusTarget={isConnected:true,disabled:false,focus(){}};
    function flatten(node:unknown):Element[]{
      if(!node||typeof node!=='object')return [];
      const element=node as Element;return [element,...[element.props?.children].flat(Infinity).flatMap(flatten)];
    }
    function render(){
      cursor=0;
      const outer=module.exports.PlatformHelper({pageId:'guilds',accountScope:'opaque',availablePageIds:available,knowledge,onNavigate:()=>{},blocked:false});
      const nodes=flatten((outer.type as (props:unknown)=>Element)(outer.props));
      for(const node of nodes)if(node.props.ref)node.props.ref.current=node.type==='dialog'?dialog:focusTarget;
      return nodes;
    }
    let nodes=render();
    const launch=()=>nodes.find(node=>node.type==='button'&&node.props['aria-haspopup']==='dialog')!;
    launch().props.onClick();nodes=render();
    let prevented=false,stopped=false;
    nodes.find(node=>node.type==='form')!.props.onSubmit({preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
    assert.equal(prevented,true);assert.equal(stopped,true);nodes=render();
    const queuedClose=nodes.find(node=>node.type==='dialog')!.props.onClose;
    nodes.find(node=>node.type==='button'&&node.props.children==='關閉')!.props.onClick();nodes=render();
    launch().props.onClick();nodes=render();
    nodes.find(node=>node.type==='input')!.props.onChange({target:{value:'新的問題'}});nodes=render();
    queuedClose();nodes=render();
    assert.equal(dialog.open,true);
    assert.equal(launch().props['aria-expanded'],true);
    assert.equal(nodes.find(node=>node.type==='input')!.props.value,'新的問題');
  }finally{
    if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);
    else Reflect.deleteProperty(globalThis,'document');
  }
});

async function withSyntheticResultSession(check:(session:{nodes:()=>any[];button:(label:string)=>any;question:(value:string)=>void;submit:()=>void;status:()=>string;updateAvailability:(ids:readonly ('guilds'|'skills'|'stores'|'squads')[])=>void;setNavigate:(callback:()=>void)=>void;dialog:{open:boolean}})=>void){
  const {transformSync}=await import('esbuild');
  const model=await import('../../apps/portal-web/src/modules/platform-helper/model.js');
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/platform-helper/PlatformHelper.tsx',import.meta.url),'utf8');
  const slots:any[]=[];let cursor=0;
  const hooks={useLayoutEffect:()=>{},useImperativeHandle:()=>{},useId:()=> 'synthetic-result-helper',useRef:(value:unknown)=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},useState:(value:unknown)=>{const index=cursor++;if(!(index in slots))slots[index]=value;return [slots[index],(next:unknown)=>{slots[index]=next;}];}};
  const jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
  const module={exports:{} as {PlatformHelper:(props:unknown)=>any}};
  new Function('module','exports','require',transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code)(module,module.exports,(id:string)=>{
    if(id==='react')return hooks;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};if(id==='./model')return model;if(id==='./helper.css')return {};
    throw new Error(`Unexpected component dependency: ${id}`);
  });
  const priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null,querySelectorAll:()=>[]}});
  try{
    const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
    const focusTarget={isConnected:true,disabled:false,focus(){}};
    const props={pageId:'guilds',accountScope:'synthetic-opaque',availablePageIds:available as readonly ('guilds'|'skills'|'stores'|'squads')[],knowledge,onNavigate:()=>{},blocked:false};
    const flatten=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(flatten)];
    const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):!node||typeof node!=='object'?'':[node.props?.children].flat(Infinity).map(text).join('');
    function render(){cursor=0;const outer=module.exports.PlatformHelper(props);const nodes=flatten(outer.type(outer.props));for(const node of nodes)if(node.props.ref)node.props.ref.current=node.type==='dialog'?dialog:focusTarget;return nodes;}
    let nodes=render();
    const button=(label:string)=>nodes.find(node=>node.type==='button'&&text(node)===label);
    button('問路助手').props.onClick();nodes=render();
    check({
      nodes:()=>nodes,button:label=>({click(){button(label).props.onClick();nodes=render();}}),dialog,
      question(value){nodes.find(node=>node.type==='input').props.onChange({target:{value}});nodes=render();},
      submit(){nodes.find(node=>node.type==='form').props.onSubmit({preventDefault(){},stopPropagation(){}});nodes=render();},
      status:()=>nodes.filter(node=>node.props?.role==='status').map(text).join(''),
      updateAvailability(ids){props.availablePageIds=ids;nodes=render();},setNavigate(callback){props.onNavigate=callback;nodes=render();},
    });
  }finally{if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);else Reflect.deleteProperty(globalThis,'document');}
}

test('successful result announces only the current available count, not query or duplicated help',async()=>{
  await withSyntheticResultSession(session=>{
    session.question('請問我要怎麼學 ＡＩ？');session.submit();
    assert.equal(session.status(),'找到 2 個可用入口，請選擇下方頁面。');
    assert.equal(session.nodes().find(node=>node.type==='input').props.value,'');
    assert.doesNotMatch(session.status(),/請問|公會公開說明|技能公開說明/);
    session.updateAvailability(['skills']);
    assert.equal(session.status(),'找到 1 個可用入口，請選擇下方頁面。');
    session.updateAvailability([]);
    assert.equal(session.status(),'目前沒有可提供的入口，請查看本頁原有說明。');
  });
});
for(const recovery of ['question','intent'] as const)test(`fresh ${recovery} clears stale navigation notice without navigating or clearing ignored IME input`,async()=>{
  await withSyntheticResultSession(session=>{
    let calls=0;
    session.setNavigate(()=>{calls++;throw new Error('synthetic-private-error');});
    session.button('學 AI').click();session.button('前往技能書架').click();
    const failure='目前無法切換頁面，請稍後再試，或關閉助手後使用原有導覽。';
    assert.equal(session.status(),failure);assert.equal(session.dialog.open,true);assert.equal(calls,1);
    assert.doesNotMatch(JSON.stringify(session.nodes()),/synthetic-private-error/);
    session.question('怎麼學AI');session.nodes().find(node=>node.type==='input').props.onCompositionStart();session.submit();
    assert.equal(session.status(),failure);assert.equal(session.nodes().find(node=>node.type==='input').props.value,'怎麼學AI');
    session.nodes().find(node=>node.type==='input').props.onCompositionEnd();
    if(recovery==='question')session.submit();else session.button('學 AI').click();
    assert.equal(session.status(),'找到 2 個可用入口，請選擇下方頁面。');
    assert.equal(session.nodes().find(node=>node.type==='input').props.value,'');assert.equal(session.dialog.open,true);assert.equal(calls,1);
  });
});

const adapterSources=()=>({
  metadata:{skills:{title:'技能書架最新標題',guidance:'不當作第二份答案'},guilds:{title:'職業公會'},stores:{title:'我的商店'},supplier:{title:'我有東西要賣'},retail:{title:'我可以賣東西'},messages:{title:'不可導向的訊息'}},
  pageHelp:{skills:{summary:'目前技能書說明',steps:['目前第一步'],note:'目前限制'},guilds:{summary:'公會說明',steps:[]},stores:{summary:'商店說明',steps:['核對設定']},supplier:{summary:'供貨說明',steps:['核對供貨']},retail:{summary:'零售說明',steps:['核對選品']},messages:{summary:'不應帶入',steps:[]}},
  availablePageIds:['retail','skills','stores','supplier','skills','guilds','messages','unknown'],guildLaunchpadEnabled:true,
});
test('canonical adapter intersects current IDs, projects only current canonical fields and feeds the real model',async()=>{
  const {buildHelperKnowledge}=await import('../../apps/portal-web/src/modules/platform-helper/knowledge.js');
  const sources=adapterSources(),result=buildHelperKnowledge(sources);
  assert.deepEqual(result.availablePageIds,['guilds','skills','stores','supplier','retail']);
  assert.deepEqual(Object.keys(result.knowledge),result.availablePageIds);
  assert.deepEqual(result.knowledge.skills,{id:'skills',title:sources.metadata.skills.title,summary:sources.pageHelp.skills.summary,steps:sources.pageHelp.skills.steps,note:sources.pageHelp.skills.note});
  assert.equal(availablePage('skills',result.availablePageIds,result.knowledge)?.title,'技能書架最新標題');
  assert.deepEqual(chooseIntent('learn',result.availablePageIds,result.knowledge),{kind:'pages',pageIds:['skills','guilds']});
  assert.equal(Object.hasOwn(result.knowledge,'messages'),false);
  assert.equal(Object.hasOwn(result.knowledge.skills!,'guidance'),false);
});
test('canonical adapter requires exact true for stores without gating supplier or retail',async()=>{
  const {buildHelperKnowledge}=await import('../../apps/portal-web/src/modules/platform-helper/knowledge.js');
  for(const flag of [false,null,undefined,'true',1,{}]){
    const result=buildHelperKnowledge({...adapterSources(),guildLaunchpadEnabled:flag} as never);
    assert.deepEqual(result.availablePageIds,['guilds','skills','supplier','retail']);
    assert.equal(Object.hasOwn(result.knowledge,'stores'),false);
  }
  assert.ok(buildHelperKnowledge(adapterSources()).availablePageIds.includes('stores'));
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),availablePageIds:[]}),{knowledge:{},availablePageIds:[]});
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),availablePageIds:['stores']}),{knowledge:{stores:{id:'stores',title:'我的商店',summary:'商店說明',steps:['核對設定']}},availablePageIds:['stores']});
});
test('canonical adapter drops missing, inherited and malformed canonical entries and fields',async()=>{
  const {buildHelperKnowledge}=await import('../../apps/portal-web/src/modules/platform-helper/knowledge.js');
  const base=adapterSources();
  for(const metadata of [{},{skills:{}},Object.create(base.metadata),{skills:{title:''}},{skills:{title:7}},{skills:Object.create({title:'繼承標題'})}]){
    assert.deepEqual(buildHelperKnowledge({...base,metadata,availablePageIds:['skills']} as never),{knowledge:{},availablePageIds:[]});
  }
  for(const pageHelp of [{},{skills:{summary:'說明'}},Object.create(base.pageHelp),{skills:null},{skills:{summary:'',steps:[]}},{skills:{summary:'說明',steps:[1]}},{skills:{summary:'說明',steps:[' ']}},{skills:{summary:'說明',steps:[],note:1}},{skills:Object.create(base.pageHelp.skills)}]){
    assert.deepEqual(buildHelperKnowledge({...base,pageHelp,availablePageIds:['skills']} as never),{knowledge:{},availablePageIds:[]});
  }
  for(const malformed of [undefined,null,[],1,'data',{},Object.create(base)])assert.deepEqual(buildHelperKnowledge(malformed as never),{knowledge:{},availablePageIds:[]});
  for(const field of ['metadata','pageHelp','availablePageIds'])assert.deepEqual(buildHelperKnowledge({...base,[field]:null} as never),{knowledge:{},availablePageIds:[]});
});
test('canonical adapter does not invoke accessor entries or inherit array indices',async()=>{
  const {buildHelperKnowledge}=await import('../../apps/portal-web/src/modules/platform-helper/knowledge.js');
  let reads=0;
  const getter={get skills(){reads++;throw new Error('must not run');}};
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),metadata:getter} as never),{knowledge:{},availablePageIds:[]});
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),pageHelp:getter} as never),{knowledge:{},availablePageIds:[]});
  const titleGetter={get title(){reads++;throw new Error('must not run');}};
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),metadata:{skills:titleGetter},availablePageIds:['skills']} as never),{knowledge:{},availablePageIds:[]});
  const ids:string[]=[];Object.defineProperty(ids,'0',{get(){reads++;throw new Error('must not run');}});
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),availablePageIds:ids}),{knowledge:{},availablePageIds:[]});
  const steps=new Array<string>(1);Object.setPrototypeOf(steps,Object.assign(Object.create(Array.prototype),{0:'繼承步驟'}));
  assert.deepEqual(buildHelperKnowledge({...adapterSources(),pageHelp:{skills:{summary:'說明',steps}},availablePageIds:['skills']}),{knowledge:{},availablePageIds:[]});
  assert.equal(reads,0);
  const sources=adapterSources();
  const nullRecord=(value:object)=>Object.assign(Object.create(null),value);
  const projected=buildHelperKnowledge(nullRecord({...sources,metadata:nullRecord(sources.metadata),pageHelp:nullRecord(sources.pageHelp)}));
  assert.equal(projected.knowledge.skills?.title,sources.metadata.skills.title);
});
test('canonical adapter never mutates or freezes sources and snapshots mutable steps without a cache',async()=>{
  const {buildHelperKnowledge}=await import('../../apps/portal-web/src/modules/platform-helper/knowledge.js');
  const sources=adapterSources(),before=JSON.stringify(sources),first=buildHelperKnowledge(sources);
  assert.equal(JSON.stringify(sources),before);assert.equal(Object.isFrozen(sources.pageHelp.skills.steps),false);
  assert.notEqual(first.knowledge.skills!.steps,sources.pageHelp.skills.steps);
  sources.metadata.skills.title=' 更新後標題 ';sources.pageHelp.skills.steps.push('更新步驟');sources.availablePageIds=['skills'];
  const next=buildHelperKnowledge(sources);
  assert.equal(first.knowledge.skills!.title,'技能書架最新標題');assert.deepEqual(first.knowledge.skills!.steps,['目前第一步']);
  assert.deepEqual(next.availablePageIds,['skills']);assert.equal(next.knowledge.skills!.title,' 更新後標題 ');assert.deepEqual(next.knowledge.skills!.steps,['目前第一步','更新步驟']);
});

/** Actual TSX with synthetic lifecycle/DOM; not React or native-browser acceptance. */
async function withControllerSession(check:(s:any)=>void){
  const {transformSync}=await import('esbuild');
  const model=await import('../../apps/portal-web/src/modules/platform-helper/model.js');
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/platform-helper/PlatformHelper.tsx',import.meta.url),'utf8');
  let slots:any[]=[],cursor=0,pending:(()=>void)[]=[],nodes:any[]=[],key:unknown;
  const effects=new Map<number,{setup:()=>void|(()=>void);cleanup?:()=>void}>();
  const layout=(setup:()=>void|(()=>void),deps:unknown[])=>{
    const index=cursor++,prior=slots[index];
    if(!prior||deps.some((v,i)=>v!==prior[i])){slots[index]=deps;pending.push(()=>{effects.get(index)?.cleanup?.();const cleanup=setup();effects.set(index,{setup,cleanup:cleanup||undefined});});}
  };
  const hooks={useId:()=> 'synthetic-controller',useRef:(v:unknown)=>{const i=cursor++;return slots[i]??(slots[i]={current:v});},useState:(v:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],(next:unknown)=>{slots[i]=next;}];},useLayoutEffect:layout,useImperativeHandle:(ref:any,create:()=>unknown,deps:unknown[])=>layout(()=>{if(ref)ref.current=create();return()=>{if(ref)ref.current=null;};},[ref,...deps])};
  const jsx=(type:unknown,props:unknown,key?:unknown)=>({type,props,key});
  const module={exports:{} as {PlatformHelper:(props:any)=>any}};
  new Function('module','exports','require',transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code)(module,module.exports,(id:string)=>{
    if(id==='react')return hooks;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};if(id==='./model')return model;if(id==='./helper.css')return {};throw Error(`Unexpected dependency ${id}`);
  });
  let foreign=false,shows=0,focuses=0;
  const doc={querySelector:()=>foreign?{}:null,querySelectorAll:()=>[],defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
  const origin={isConnected:true,ownerDocument:doc,disabled:false,matches(){return this.disabled;},closest:()=>null,getClientRects:()=>[{}],focus(){focuses++;}};
  const dialog={isConnected:true,ownerDocument:doc,open:false,showModal(){shows++;this.open=true;},close(){this.open=false;}};
  const ref={current:null as any},events:any[]=[];
  const props:any={pageId:'guilds',accountScope:'opaque',availablePageIds:available,knowledge,onNavigate:()=>{},blocked:false,controllerRef:ref,onDialogChange:(event:any)=>events.push(event)};
  const flatten=(n:any):any[]=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(flatten)];
  function teardown(){for(const e of effects.values())e.cleanup?.();effects.clear();slots=[];dialog.open=false;nodes=[];}
  function render(){cursor=0;pending=[];const outer=module.exports.PlatformHelper(props);if(!outer){teardown();key=undefined;return;}
    if(key!==outer.key){teardown();key=outer.key;cursor=0;}nodes=flatten(outer.type(outer.props));
    for(const n of nodes)if(n.props.ref)n.props.ref.current=n.type==='dialog'?dialog:origin;
    for(const setup of pending)setup();
  }
  const before=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  try{render();check({ref,events,origin,dialog,props,render,teardown,shows:()=>shows,focuses:()=>focuses,foreign:(v:boolean)=>{foreign=v;},
    strictReplay(){const entries=[...effects.values()];for(const e of entries)e.cleanup?.();for(const e of entries)e.cleanup=e.setup()||undefined;},
    input(value:string){nodes.find(n=>n.type==='input').props.onChange({target:{value}});render();},
    value:()=>nodes.find(n=>n.type==='input')?.props.value,
    compose(v:boolean){nodes.find(n=>n.type==='input').props[v?'onCompositionStart':'onCompositionEnd']();},
    submit(){nodes.find(n=>n.type==='form').props.onSubmit({preventDefault(){},stopPropagation(){}});render();},
    close(){nodes.find(n=>n.type==='button'&&n.props.children==='關閉').props.onClick();render();},
    nativeClose(){dialog.open=false;nodes.find(n=>n.type==='dialog').props.onClose();render();},
    launch(){nodes.find(n=>n.type==='button'&&n.props['aria-haspopup']==='dialog').props.onClick();render();},
    lateClose:()=>nodes.find(n=>n.type==='dialog').props.onClose,
  });}finally{teardown();if(before)Object.defineProperty(globalThis,'document',before);else Reflect.deleteProperty(globalThis,'document');}
}

test('external controller opens the same dialog once, preserving IME and repeated-open input',async()=>{
  await withControllerSession(s=>{
    const handle=s.ref.current;assert.ok(handle,'mounted helper exposes an optional controller');
    assert.equal(handle.dialogId,'synthetic-controller');assert.equal(handle.open,false);
    assert.equal(handle.requestOpen(s.origin),true);s.render();assert.equal(handle.open,true);assert.equal(s.shows(),1);
    s.input('組字中');s.compose(true);s.submit();assert.equal(s.value(),'組字中');
    assert.equal(handle.requestOpen(s.origin),false);s.render();assert.equal(s.value(),'組字中');assert.equal(s.shows(),1);
    s.compose(false);s.submit();assert.equal(s.value(),'');assert.equal(s.events.length,1);
  });
});
test('external dismissal reports origin and does not focus a suppressed/disabled guide trigger',async()=>{
  await withControllerSession(s=>{
    assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();const before=s.focuses();s.origin.disabled=true;s.close();
    assert.equal(s.focuses(),before);assert.equal(s.events.at(-1).reason,'dismiss');assert.equal(s.events.at(-1).origin,s.origin);
    assert.equal(s.ref.current.open,false);s.origin.disabled=false;s.launch();const openedFocus=s.focuses();s.close();assert.equal(s.focuses(),openedFocus+1);
  });
});
test('retained controller leases cannot reopen after page/account/blocking/route teardown or StrictMode replay',async()=>{
  await withControllerSession(s=>{
    for(const change of [()=>{s.props.pageId='skills';},()=>{s.props.accountScope='new-login';},()=>{s.props.blocked=true;}]){
      const old=s.ref.current;assert.equal(old.requestOpen(s.origin),true);s.render();change();s.render();
      assert.equal(old.requestOpen(s.origin),false);assert.equal(old.open,false);assert.equal(s.events.at(-1).reason,'teardown');
    }
    assert.equal(s.ref.current,null);s.props.blocked=false;s.render();assert.equal(s.dialog.open,false);
    const beforeReplay=s.ref.current;s.strictReplay();assert.equal(beforeReplay.requestOpen(s.origin),false);assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();
    const beforeRoute=s.ref.current;s.teardown();assert.equal(beforeRoute.requestOpen(s.origin),false);assert.equal(beforeRoute.open,false);
  });
});
test('controller rejects foreign modals and disconnected/foreign origins without queuing',async()=>{
  await withControllerSession(s=>{
    s.foreign(true);assert.equal(s.ref.current.requestOpen(s.origin),false);s.foreign(false);s.render();assert.equal(s.dialog.open,false);
    for(const origin of [{...s.origin,isConnected:false},{...s.origin,ownerDocument:{}},{...s.origin,disabled:true}])assert.equal(s.ref.current.requestOpen(origin),false);
    assert.equal(s.shows(),0);assert.equal(s.events.length,0);
    assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();s.nativeClose();assert.equal(s.events.at(-1).reason,'native');
  });
});
test('queued native close does not close a reopened controller dialog or duplicate notifications',async()=>{
  await withControllerSession(s=>{
    s.ref.current.requestOpen(s.origin);s.render();const queued=s.lateClose();s.close();
    assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();s.input('新問題');queued();s.render();
    assert.equal(s.ref.current.open,true);assert.equal(s.value(),'新問題');assert.deepEqual(s.events.map((e:any)=>e.open),[true,false,true]);
  });
});
test('controller notifications use the latest listener and cannot interrupt closing/teardown',async()=>{
  await withControllerSession(s=>{
    const changes:any[]=[];s.props.onDialogChange=(change:any)=>{changes.push(change);throw Error('private callback failure');};s.render();
    assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();s.input('不可記錄的問題');s.close();
    assert.equal(s.dialog.open,false);assert.equal(s.value(),'');assert.equal(s.events.length,0);
    assert.deepEqual(changes.map(e=>[e.open,e.reason]),[[true,undefined],[false,'dismiss']]);
    assert.equal(JSON.stringify(changes.map(({origin,...e})=>e)).includes('不可記錄'),false);
    s.ref.current.requestOpen(s.origin);s.render();s.teardown();assert.equal(changes.at(-1).reason,'teardown');
  });
});
test('controller refuses hidden triggers and native open failures without partial state',async()=>{
  await withControllerSession(s=>{
    assert.equal(s.ref.current.requestOpen({...s.origin,closest:()=>({})}),false);
    assert.equal(s.ref.current.requestOpen({...s.origin,getClientRects:()=>[]}),false);
    const visible=s.origin.ownerDocument.defaultView.getComputedStyle;s.origin.ownerDocument.defaultView.getComputedStyle=()=>({display:'none',visibility:'visible'});
    assert.equal(s.ref.current.requestOpen(s.origin),false);s.origin.ownerDocument.defaultView.getComputedStyle=visible;
    s.dialog.isConnected=false;assert.equal(s.ref.current.requestOpen(s.origin),false);s.dialog.isConnected=true;
    const nativeOpen=s.dialog.showModal;s.dialog.showModal=()=>{throw Error('native failure');};
    assert.equal(s.ref.current.requestOpen(s.origin),false);s.render();assert.equal(s.ref.current.open,false);assert.equal(s.events.length,0);
    s.dialog.showModal=nativeOpen;assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();
    s.props.blocked=true;s.render();assert.equal(s.events.at(-1).reason,'teardown');assert.equal(s.ref.current,null);
  });
});
test('layout replay of an open dialog starts a fresh closed session rather than orphaning native state',async()=>{
  await withControllerSession(s=>{
    const old=s.ref.current;assert.equal(old.requestOpen(s.origin),true);s.render();s.input('不可復活的問題');const queued=s.lateClose();
    s.strictReplay();s.render();
    assert.equal(old.open,false);assert.equal(old.requestOpen(s.origin),false);
    assert.equal(s.ref.current.open,false);assert.equal(s.dialog.open,false);assert.equal(s.value(),'');
    assert.deepEqual(s.events.map((e:any)=>[e.open,e.reason]),[[true,undefined],[false,'teardown']]);
    assert.equal(s.ref.current.requestOpen(s.origin),true);s.render();s.input('重開的新問題');queued();s.render();assert.equal(s.value(),'重開的新問題');s.close();
    assert.equal(s.events.at(-1).reason,'dismiss');assert.equal(s.events.at(-1).origin,s.origin);
  });
});

test('helper secondary buttons own a paired theme surface instead of the dark global fallback',()=>{
  // Declaration/token contract only, not a CSS cascade or browser acceptance claim.
  const css=readFileSync(new URL('../../apps/portal-web/src/modules/platform-helper/helper.css',import.meta.url),'utf8');
  const rule=css.match(/\.platform-helper \.btn-secondary\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule,'helper must own its secondary surface');
  assert.match(rule,/background:\s*var\(--bg-elev\)/);
  assert.match(rule,/color:\s*var\(--ink\)/);
  assert.match(rule,/border:\s*1px solid var\(--line\)/);
  assert.match(css,/\.platform-helper \.btn-secondary:hover:not\(:disabled\)/);
  assert.match(css,/\.platform-helper \.btn-secondary:focus-visible/);
  assert.match(css,/outline:\s*2px solid var\(--focus\)/);
});
test('all helper appearance palettes pair readable text and focus with the actual surface tokens',async()=>{
  const {EXPERIENCE_PROFILES}=await import('../../apps/portal-web/src/experience-profiles.js');
  function tokens(file:string){
    const css=readFileSync(new URL(`../../apps/portal-web/src/${file}`,import.meta.url),'utf8');
    return Object.fromEntries([...css.matchAll(/(--(?:ink|bg-elev|focus))\s*:\s*(#[\da-fA-F]+)/g)].map(match=>[match[1],match[2]]));
  }
  function luminance(hex:string){
    const expanded=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;
    const rgb=[1,3,5].map(i=>parseInt(expanded.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  }
  function ratio(a:string,b:string){const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (values[1]+.05)/(values[0]+.05);}
  for(const profile of Object.values(EXPERIENCE_PROFILES)){
    const palette={...tokens('styles.css'),...tokens('rpg-theme.css'),...(profile.baseTheme!=='dark'?tokens('light-theme.css'):{}),...(profile.baseTheme==='versefolk'?tokens('versefolk-theme.css'):{}),...(profile.skin==='dragon'?tokens('dragon-theme.css'):{})};
    assert.ok(ratio(palette['--ink'],palette['--bg-elev'])>=4.5,profile.id+' text');
    assert.ok(ratio(palette['--focus'],palette['--bg-elev'])>=3,profile.id+' focus');
  }
});
test('isolated helper fixture loads real appearance CSS, not only a data-theme label',()=>{
  const source=readFileSync(new URL('../e2e/platform-helper-fixture.ts',import.meta.url),'utf8');
  const main=readFileSync(new URL('../../apps/portal-web/src/main.tsx',import.meta.url),'utf8');
  const styles=[...main.matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)].map(match=>match[1]);
  assert.ok(styles.includes('light-theme.css')&&styles.includes('dragon-theme.css'));
  let previous=-1;
  for(const file of styles){const index=source.indexOf(`import '../../apps/portal-web/src/${file}'`);assert.ok(index>previous,file+' must follow actual main CSS order');previous=index;}
  assert.ok(source.indexOf("import {PlatformHelper}")>previous,'helper CSS follows the main styles as in the lazy App');
});
