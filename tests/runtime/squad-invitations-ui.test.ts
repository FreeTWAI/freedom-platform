import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute the actual leaf's hooks, handlers and element trees with synthetic ports.
// This models effect setup/cleanup, not React's renderer or a browser/DB journey.
const source=readFileSync('apps/portal-web/src/modules/SquadInvitations.tsx','utf8');
type Element={type:string;props:Record<string,any>};
type Read={path:string;resolve:(value:any)=>void;reject:(error:Error)=>void};
const plain=(value:any)=>JSON.parse(JSON.stringify(value));
const turn=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function children(value:any):Element[]{
  if(Array.isArray(value))return value.flatMap(children);
  return value&&typeof value==='object'&&'props'in value?[value,...children(value.props.children)]:[];
}
function text(value:any):string{
  if(Array.isArray(value))return value.map(text).join('');
  return value&&typeof value==='object'&&'props'in value?text(value.props.children):value===null||value===undefined||typeof value==='boolean'?'':String(value);
}
function harness(view:'ReceivedInvitations'|'OwnerInvitations',overrides:Record<string,any>={}){
  const slots:any[]=[],reads:Read[]=[],writes:any[]=[],trace:any[]=[],focus:string[]=[],stateWrites:any[]=[];
  let cursor=0,dirty=false,alive=true,tree:Element,writeResult:any=null;
  const scheduled:number[]=[];
  const hooks={
    useState(initial:any){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};
      return [slots[index].value,(change:any)=>{const value=typeof change==='function'?change(slots[index].value):change;if(!Object.is(value,slots[index].value)){slots[index].value=value;stateWrites.push([index,plain(value)]);dirty=true;}}];},
    useRef(initial:any){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
    useEffect(setup:()=>any,deps:any[]){const index=cursor++,previous=slots[index];
      if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))||deps.length!==previous.deps.length){slots[index]={deps:[...deps],setup,cleanup:previous?.cleanup};scheduled.push(index);}},
  };
  const h=(type:string,props:Record<string,any>|null,...nodes:any[]):Element=>{
    const value={type,props:{...props,children:nodes}};
    if(props?.ref)props.ref.current={focus:()=>focus.push(type)};
    return value;
  };
  const code=transformSync(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{loader:'tsx',jsxFactory:'h',jsxFragment:'Fragment',target:'es2023'}).code;
  const views=runInNewContext(code+';({ReceivedInvitations,OwnerInvitations})',{...hooks,h,Fragment:"fragment",Error});
  const client={get:(path:string)=>new Promise((resolve,reject)=>reads.push({path,resolve,reject}))};
  let props:any={client,busy:false,refreshToken:0,selfId:'self',squad:{squad_id:'squad-a',members:[]},
    mutate:async(...args:any[])=>{writes.push(plain(args));return writeResult;},onChanged:async(notice:string)=>trace.push(['changed',notice]),...overrides};
  function render(){assert.ok(alive);let budget=30;do{assert.ok(budget-->0,'bounded render convergence');dirty=false;cursor=0;tree=views[view](props);
    for(const index of scheduled.splice(0)){const effect=slots[index];effect.cleanup?.();effect.cleanup=effect.setup();}}while(dirty);}
  const elements=()=>children(tree);
  const one=(predicate:(value:Element)=>boolean)=>{const found=elements().filter(predicate);assert.equal(found.length,1,'one matching element');return found[0];};
  const snapshot=()=>plain({text:text(tree),buttons:elements().filter(e=>e.type==='button').map(e=>({label:e.props['aria-label']??text(e),disabled:Boolean(e.props.disabled)})),open:elements().filter(e=>e.type==='details').map(e=>e.props.open),reads:reads.map(r=>r.path),writes,trace,focus,stateWrites});
  render();
  return {reads,writes,trace,focus,render,snapshot,get tree(){return tree;},one,
    async flush(){await turn();if(alive&&dirty)render();},
    button(label:string){const node=one(e=>e.type==='button'&&(e.props['aria-label']??text(e))===label);assert.ok(!node.props.disabled,'user cannot click a disabled button');node.props.onClick();},
    change(label:string,value:any){const node=one(e=>e.type==='label'&&text(e).includes(label));const field=children(node).find(e=>e.type==='input')!;field.props.onChange({target:{value,checked:value}});render();},
    update(next:Record<string,any>){props={...props,...next};render();},
    result(value:any){writeResult=value;},
    unmount(){alive=false;for(const slot of slots)slot?.cleanup?.();},
    replay(){for(const slot of slots)slot?.cleanup?.();for(const slot of slots)if(slot?.setup)slot.cleanup=slot.setup();render();},
  };
}
const invitation=(id='invite-a',state='pending')=>({invitation_id:id,squad_id:'squad-a',squad_name:'合成小隊',owner_ref:'owner',owner_name:'合成隊主',recipient_ref:'candidate',recipient_name:'合成夥伴',state,aggregate_version:7,created_at:'synthetic',updated_at:'synthetic',resolved_at:null});
const page=(items:any[],next:number|null=null)=>({items,next_offset:next});

test('received paging retries the failed offset without duplicating the preceding page',async()=>{
  const h=harness('ReceivedInvitations');assert.equal(h.reads[0].path,'/me/squad-invitations?state=pending&limit=20&offset=0');
  h.reads[0].resolve(page([invitation()],20));await h.flush();assert.deepEqual(h.snapshot().open,[true]);
  h.button('查看更多邀請');h.render();h.reads[1].reject(new Error('synthetic page failure'));await h.flush();
  assert.ok(h.snapshot().text.includes('synthetic page failure'));h.button('重新載入邀請');h.render();
  assert.equal(h.reads[2].path,h.reads[1].path);assert.ok(h.reads[2].path.endsWith('offset=20'));
  h.reads[2].resolve(page([invitation('invite-b','accepted')]));await h.flush();
  assert.equal(children(h.tree).filter(e=>e.type==='li').length,2);assert.equal(h.snapshot().text.includes('synthetic page failure'),false);
});

test('received filter change fences a late prior response and preserves the all-history request',async()=>{
  const h=harness('ReceivedInvitations');h.change('顯示已回覆',true);
  assert.equal(h.reads[1].path,'/me/squad-invitations?state=all&limit=20&offset=0');
  h.reads[1].resolve(page([invitation('current','declined')]));await h.flush();const before=h.snapshot();
  h.reads[0].resolve(page([invitation('obsolete')]));await h.flush();assert.deepEqual(h.snapshot(),before);
});

for(const view of ['ReceivedInvitations','OwnerInvitations'] as const)for(const outcome of ['resolve','reject'] as const)test(`${view}: effect cleanup fences obsolete ${outcome}`,async()=>{
  const h=harness(view);const old=h.reads[0];h.update({refreshToken:1});
  h.reads[1].resolve(page([invitation('fresh','accepted')]));await h.flush();const before=h.snapshot();
  if(outcome==='resolve')old.resolve(page([invitation('old')]));else old.reject(new Error('synthetic obsolete failure'));
  await h.flush();assert.deepEqual(h.snapshot(),before);
  h.update({refreshToken:2});h.unmount();const after=h.snapshot();h.reads[2].resolve(page([invitation('after-unmount')]));await h.flush();assert.deepEqual(h.snapshot(),after);
});

test('effect cleanup/setup replay issues a fresh read and ignores the first result',async()=>{
  const h=harness('ReceivedInvitations');h.replay();assert.equal(h.reads.length,2);
  h.reads[1].resolve(page([invitation('fresh','accepted')]));await h.flush();const before=h.snapshot();
  h.reads[0].resolve(page([invitation('old')]));await h.flush();assert.deepEqual(h.snapshot(),before);
});

for(const action of ['accept','decline'] as const)test(`received ${action} preserves the exact version, callback and focus sequence`,async()=>{
  const h=harness('ReceivedInvitations');h.reads[0].resolve(page([invitation()]));await h.flush();h.result(invitation('invite-a',action==='accept'?'accepted':'declined'));
  h.button(`${action==='accept'?'接受':'婉拒'}邀請：合成小隊`);await h.flush();
  assert.deepEqual(h.writes,[[`/squad-invitations/invite-a/${action}`,{},7]]);
  assert.deepEqual(h.trace,[['changed',action==='accept'?'已加入「合成小隊」。':'已婉拒「合成小隊」的邀請。']]);assert.deepEqual(h.focus,['h3']);
});

test('definitive mutation failure requests refresh without success notice or focus',async()=>{
  const h=harness('ReceivedInvitations');h.reads[0].resolve(page([invitation()]));await h.flush();h.button('接受邀請：合成小隊');await h.flush();
  assert.deepEqual(h.trace,[['changed','']]);assert.deepEqual(h.focus,[]);
});

async function ownerSearch(h:ReturnType<typeof harness>,query:string){
  h.change('搜尋要邀請的夥伴',query);const form=h.one(e=>e.type==='form');form.props.onSubmit({preventDefault(){}});h.render();
}
test('owner search excludes self and respects membership/invitation state precedence',async()=>{
  const h=harness('OwnerInvitations',{squad:{squad_id:'squad-a',members:[{user_id:'active',state:'active'},{user_id:'pending-member',state:'pending'}]}});
  h.reads[0].resolve(page([{...invitation(),recipient_ref:'already-invited'},{...invitation('active-invite'),recipient_ref:'active'}]));await h.flush();
  await ownerSearch(h,'  合成 & 夥伴  ');assert.equal(h.reads[1].path,'/members?limit=20&sort=nickname&search='+encodeURIComponent('合成 & 夥伴'));
  h.reads[1].resolve({items:['self','active','pending-member','already-invited','available'].map(user_id=>({user_id,nickname:user_id}))});await h.flush();
  const list=h.one(e=>e.type==='ul'&&e.props['aria-label']==='搜尋結果');assert.equal(children(list).filter(e=>e.type==='li').length,4);
  assert.ok(text(list).includes('已在小隊'));assert.ok(text(list).includes('已邀請，等候回覆'));assert.ok(text(list).includes('已申請加入，可直接接受'));
  assert.deepEqual(children(list).filter(e=>e.type==='button').map(e=>e.props['aria-label']),['邀請 available']);
});

test('owner search late response cannot replace newer results or write after cleanup',async()=>{
  const h=harness('OwnerInvitations');h.reads[0].resolve(page([]));await h.flush();
  await ownerSearch(h,'old');await ownerSearch(h,'new');h.reads[2].resolve({items:[{user_id:'new',nickname:'新夥伴'}]});await h.flush();const before=h.snapshot();
  h.reads[1].resolve({items:[{user_id:'old',nickname:'舊夥伴'}]});await h.flush();assert.deepEqual(h.snapshot(),before);
  await ownerSearch(h,'after');h.unmount();const stopped=h.snapshot();h.reads[3].reject(new Error('synthetic late search failure'));await h.flush();assert.deepEqual(h.snapshot(),stopped);
});

test('owner invite and withdraw keep command shape, version, callback and heading focus',async()=>{
  const h=harness('OwnerInvitations');h.reads[0].resolve(page([invitation()]));await h.flush();await ownerSearch(h,'available');
  h.reads[1].resolve({items:[{user_id:'available',nickname:'可邀夥伴'}]});await h.flush();h.result({...invitation(),recipient_name:'可邀夥伴'});
  h.button('邀請 可邀夥伴');await h.flush();h.result(invitation());h.button('撤回給 合成夥伴 的邀請');await h.flush();
  assert.deepEqual(h.writes,[['/squads/squad-a/invitations',{recipient_ref:'available'}],['/squad-invitations/invite-a/withdraw',{},7]]);
  assert.deepEqual(h.trace,[['changed','已邀請 可邀夥伴，等候對方回覆。'],['changed','已撤回給 合成夥伴 的邀請。']]);assert.deepEqual(h.focus,['h4','h4']);
});

test('parent retains stable module-level imports, owner key and shared mutation/refresh props',()=>{
  const parent=readFileSync('apps/portal-web/src/modules/Squads.tsx','utf8');
  assert.match(parent,/import \{ReceivedInvitations,OwnerInvitations\} from '\.\/SquadInvitations';/);
  assert.match(parent,/<ReceivedInvitations client=\{client\} mutate=\{mutate\} busy=\{busy\} refreshToken=\{refreshToken\} onChanged=\{refreshAll\}\/>/);
  assert.match(parent,/<OwnerInvitations key=\{detail.squad_id\} client=\{client\} squad=\{detail\} selfId=\{selfId\} mutate=\{mutate\} busy=\{busy\} refreshToken=\{refreshToken\} onChanged=\{refreshAll\}\/>/);
  assert.equal(parent.includes('function ReceivedInvitations'),false);assert.equal(parent.includes('function OwnerInvitations'),false);
  assert.match(source,/data-guide-anchor="squads:invitations"/);
});
