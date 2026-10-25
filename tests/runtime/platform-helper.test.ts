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
  const hooks={useId:()=> 'synthetic-helper',useRef:(value:unknown)=>{
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
  const hooks={useId:()=> 'synthetic-result-helper',useRef:(value:unknown)=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},useState:(value:unknown)=>{const index=cursor++;if(!(index in slots))slots[index]=value;return [slots[index],(next:unknown)=>{slots[index]=next;}];}};
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
