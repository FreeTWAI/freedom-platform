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
